import { hashStyle } from 'maplibre-style-tools/maplibre';
import {
  registerMapLibreWebMcpTools,
  type MapLibreWebMcpRegistration,
} from 'maplibre-style-tools/webmcp';
import type { StyleDocument } from 'maplibre-style-tools/core';
import type { Map as MapLibreMap, MapMouseEvent, Marker as MapLibreMarker } from 'maplibre-gl';
import { z } from 'zod';

import { createActivityLog } from './activity-log.js';
import {
  CommentTargetStore,
  type FeatureReference,
  type MapCommentTarget,
} from './comment-targets.js';
import { createDemoStyle } from './demo-style.js';
import { featureLabel, pickRenderedFeatures } from './feature-picker.js';

export function renderWebMcpSupport(
  host: HTMLElement,
  registration: MapLibreWebMcpRegistration,
  toolCount = registration.toolNames.length,
  supported = registration.supported,
): void {
  host.textContent = supported
    ? `Site tools available (${toolCount})`
    : 'Site tools unavailable';
}

export const addCommentTargetSafely = (
  add: () => MapCommentTarget,
  onError: (message: string) => void,
): MapCommentTarget | undefined => {
  try {
    return add();
  } catch {
    onError('Unable to create this comment target. Choose another target and try again.');
    return undefined;
  }
};

type ModelContextToolRegistrar = {
  registerTool(
    tool: {
      readonly name: string;
      readonly title: string;
      readonly description: string;
      readonly inputSchema: Readonly<Record<string, unknown>>;
      readonly annotations: { readonly readOnlyHint: boolean; readonly untrustedContentHint: boolean };
      readonly execute: (input: Record<string, unknown>, options: { readonly signal: AbortSignal }) => unknown | Promise<unknown>;
    },
    options?: { readonly signal?: AbortSignal },
  ): Promise<void>;
};

const consumeSelectionIdsSchema = z.strictObject({
  selectionIds: z.array(z.string().min(1).max(128)).min(1).max(20)
    .refine((ids) => new Set(ids).size === ids.length, 'selectionIds must be unique'),
});

export const registerMapSelectionConsumptionTool = async (
  modelContext: ModelContextToolRegistrar,
  store: CommentTargetStore,
  signal: AbortSignal,
): Promise<void> => modelContext.registerTool({
  name: 'consumeMapSelectionContexts',
  title: 'Consume map selection contexts',
  description: 'Read and remove the immutable map selection contexts referenced by submitted browser comments. Call this before applying map changes from those comments.',
  inputSchema: {
    type: 'object',
    properties: {
      selectionIds: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        uniqueItems: true,
        items: { type: 'string', minLength: 1, maxLength: 128 },
      },
    },
    required: ['selectionIds'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  execute: async (input) => {
    const parsed = consumeSelectionIdsSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: 'Selection context input is invalid.',
        error: { code: 'INVALID_INPUT', message: 'Selection context input is invalid.' },
      };
    }
    try {
      const contexts = store.consumeMany(parsed.data.selectionIds);
      return { success: true, consumed: contexts.length, contexts };
    } catch {
      return {
        success: false,
        message: 'A referenced selection context is unavailable.',
        error: { code: 'NOT_FOUND', message: 'A referenced selection context is unavailable.' },
      };
    }
  },
}, { signal });

export const createWebMcpExampleLifetimes = (): {
  readonly page: AbortController;
  readonly tools: AbortController;
} => {
  const page = new AbortController();
  const tools = new AbortController();
  page.signal.addEventListener('abort', () => tools.abort(), { once: true });
  return { page, tools };
};

export const registerCoreWebMcpToolsSafely = async (
  register: () => Promise<MapLibreWebMcpRegistration>,
  support: HTMLElement,
  toolsLifetime: AbortController,
): Promise<MapLibreWebMcpRegistration | undefined> => {
  try {
    return await register();
  } catch {
    toolsLifetime.abort();
    support.textContent = 'Site tools failed to register';
    return undefined;
  }
};

export const registerMapSelectionConsumptionToolSafely = async (
  modelContext: ModelContextToolRegistrar,
  store: CommentTargetStore,
  toolsLifetime: AbortController,
): Promise<boolean> => {
  try {
    await registerMapSelectionConsumptionTool(modelContext, store, toolsLifetime.signal);
    return true;
  } catch {
    toolsLifetime.abort();
    return false;
  }
};

const requireElement = <ElementType extends HTMLElement>(testId: string): ElementType => {
  const element = document.querySelector(`[data-testid="${testId}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing WebMCP example element: ${testId}`);
  return element as ElementType;
};

const renderToolGroups = (host: HTMLElement, toolNames: readonly string[]): void => {
  const readOnly = new Set(['inspectStyle', 'queryMapFeatures']);
  const groups = [
    ['Read-only', toolNames.filter((toolName) => readOnly.has(toolName))],
    ['Map mutations', toolNames.filter((toolName) => !readOnly.has(toolName))],
  ] as const;
  host.replaceChildren(...groups.flatMap(([label, names]) => names.length === 0 ? [] : [
    Object.assign(document.createElement('h3'), { textContent: label }),
    Object.assign(document.createElement('p'), { textContent: names.join(', ') }),
  ]));
};

const targetScopeLabel = (target: MapCommentTarget): string => {
  if (target.scope === 'feature') return 'Single feature';
  if (target.scope === 'property-class') return 'Matching property value in this layer';
  return 'All features in this layer';
};

const targetLocation = (feature: FeatureReference): string => `${feature.lngLat[0].toFixed(5)}, ${feature.lngLat[1].toFixed(5)}`;

const targetProperties = (feature: FeatureReference): string => Object.entries(feature.properties)
  .map(([name, value]) => `${name}=${String(value)}`).join(', ') || 'none';

const targetArticle = (target: MapCommentTarget, onRemove: () => void): HTMLElement => {
  const article = document.createElement('article');
  article.className = 'comment-target-card';
  article.dataset.testid = 'comment-target-card';
  article.dataset.selectionId = target.selectionId;
  const heading = document.createElement('h3');
  heading.textContent = target.selectionId;
  const selectorText = target.scope === 'property-class'
    ? `${target.selector.property}=${String(target.selector.value)}`
    : target.scope === 'feature'
      ? `feature ID=${String(target.feature.featureId)}`
      : 'all features in layer';
  const detail = document.createElement('p');
  detail.textContent = [
    `Scope: ${targetScopeLabel(target)}`,
    `Layer: ${target.feature.layerId}`,
    `Source: ${target.feature.sourceId}`,
    `Location: ${targetLocation(target.feature)}`,
    `Selector: ${selectorText}`,
    `Properties: ${targetProperties(target.feature)}`,
  ].join(' · ');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'comment-target-remove';
  remove.textContent = `Remove ${target.selectionId}`;
  remove.setAttribute('aria-label', `Remove unsubmitted target ${target.selectionId}`);
  remove.addEventListener('click', onRemove);
  article.replaceChildren(heading, detail, remove);
  return article;
};

const startWebMcpExample = async (): Promise<void> => {
  const [{ Map, Marker }, ,] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl.css'),
    import('./style.css'),
  ]);
  const activity = createActivityLog(requireElement('activity-log'), { capacity: 20 });
  const map = new Map({
    container: 'map',
    style: createDemoStyle(),
    center: [0, 0],
    zoom: 2,
    attributionControl: false,
  });
  map.getCanvas().setAttribute('data-testid', 'map-canvas');

  const support = requireElement('webmcp-support');
  const registeredTools = requireElement('registered-tools');
  const layerCount = requireElement('map-layer-count');
  const revision = requireElement('map-revision');
  const styleHash = requireElement('map-style-hash');
  const reset = requireElement<HTMLButtonElement>('reset-map');
  const targetHost = requireElement('comment-target-panel');
  const targetTitle = targetHost.querySelector('h2');
  const secureContext = requireElement('secure-context');
  secureContext.textContent = window.isSecureContext ? 'secure context' : 'not a secure context';

  const targetStatus = document.createElement('p');
  targetStatus.dataset.testid = 'comment-target-status';
  targetStatus.setAttribute('aria-live', 'polite');
  targetStatus.textContent = 'Click a map feature to create a comment target.';
  const candidateHost = document.createElement('div');
  candidateHost.className = 'feature-candidates';
  const controls = document.createElement('div');
  controls.className = 'comment-target-controls';
  const scope = document.createElement('select');
  scope.setAttribute('aria-label', 'Comment target scope');
  const addScopeOption = (value: MapCommentTarget['scope'], text: string): HTMLOptionElement => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    scope.append(option);
    return option;
  };
  const featureScope = addScopeOption('feature', 'Single feature');
  addScopeOption('property-class', 'Matching property value in this layer');
  addScopeOption('layer', 'All features in this layer');
  const selector = document.createElement('select');
  selector.setAttribute('aria-label', 'Property value selector');
  const createTarget = document.createElement('button');
  createTarget.type = 'button';
  createTarget.textContent = 'Add comment target';
  const targetCards = document.createElement('div');
  targetCards.className = 'comment-target-cards';
  controls.replaceChildren(scope, selector, createTarget);
  targetHost.replaceChildren(...(targetTitle === null ? [] : [targetTitle]), targetStatus, candidateHost, controls, targetCards);

  const markers = new globalThis.Map<string, MapLibreMarker>();
  const removeTargetVisuals = (target: MapCommentTarget): void => {
    markers.get(target.selectionId)?.remove();
    markers.delete(target.selectionId);
    targetCards.querySelector(`[data-selection-id="${CSS.escape(target.selectionId)}"]`)?.remove();
  };
  let targetId = 0;
  const targets = new CommentTargetStore({
    capacity: 20,
    idFactory: () => `map-selection-${++targetId}`,
    onRemove: removeTargetVisuals,
  });
  let currentFeature: FeatureReference | undefined;
  const renderControls = (): void => {
    featureScope.disabled = currentFeature?.featureId === undefined;
    if (featureScope.disabled && scope.value === 'feature') scope.value = 'property-class';
    scope.disabled = currentFeature === undefined;
    selector.disabled = currentFeature === undefined || scope.value !== 'property-class';
    createTarget.disabled = currentFeature === undefined
      || (scope.value === 'feature' && currentFeature.featureId === undefined)
      || (scope.value === 'property-class' && selector.value === '');
  };
  const selectFeature = (feature: FeatureReference): void => {
    currentFeature = feature;
    selector.replaceChildren();
    for (const [property, value] of Object.entries(feature.properties)) {
      const option = document.createElement('option');
      option.value = property;
      option.textContent = `${property} = ${String(value)}`;
      selector.append(option);
    }
    targetStatus.textContent = `Selected ${featureLabel(feature)}.`;
    renderControls();
  };
  const renderCandidates = (candidates: readonly FeatureReference[]): void => {
    candidateHost.replaceChildren();
    if (candidates.length === 0) {
      currentFeature = undefined;
      targetStatus.textContent = 'No rendered feature was found at that location.';
      selector.replaceChildren();
      renderControls();
      return;
    }
    if (candidates.length === 1) {
      selectFeature(candidates[0]!);
      return;
    }
    const heading = document.createElement('p');
    heading.textContent = 'Choose a feature at this location:';
    const list = document.createElement('ul');
    list.setAttribute('aria-label', 'Overlapping map features');
    for (const feature of candidates) {
      const item = document.createElement('li');
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'feature-choice';
      choose.textContent = featureLabel(feature);
      choose.addEventListener('click', () => selectFeature(feature));
      item.append(choose);
      list.append(item);
    }
    candidateHost.replaceChildren(heading, list);
    targetStatus.textContent = 'Choose one of the overlapping rendered features.';
    currentFeature = undefined;
    selector.replaceChildren();
    renderControls();
  };
  const renderTarget = (target: MapCommentTarget): void => {
    const markerElement = document.createElement('div');
    markerElement.className = 'comment-target-marker';
    markerElement.textContent = target.selectionId;
    markerElement.setAttribute('aria-label', `Comment target ${target.selectionId}`);
    const marker = new Marker({ element: markerElement })
      .setLngLat([target.feature.lngLat[0], target.feature.lngLat[1]])
      .addTo(map);
    markers.set(target.selectionId, marker);
    targetCards.append(targetArticle(target, () => targets.remove(target.selectionId)));
  };
  scope.addEventListener('change', renderControls);
  selector.addEventListener('change', renderControls);
  createTarget.addEventListener('click', () => {
    const selectedFeature = currentFeature;
    if (selectedFeature === undefined) return;
    const target = addCommentTargetSafely(() => scope.value === 'feature' && selectedFeature.featureId !== undefined
      ? targets.add({ scope: 'feature', feature: selectedFeature as FeatureReference & { readonly featureId: string | number } })
      : scope.value === 'property-class'
        ? (() => {
          const value = selectedFeature.properties[selector.value];
          if (value === undefined) throw new TypeError('The selected property is unavailable.');
          return targets.add({ scope: 'property-class', feature: selectedFeature, selector: { property: selector.value, value } });
        })()
        : targets.add({ scope: 'layer', feature: selectedFeature }), (message) => { targetStatus.textContent = message; });
    if (target === undefined) return;
    renderTarget(target);
    targetStatus.textContent = `Created unsubmitted comment target ${target.selectionId}.`;
  });
  renderControls();

  let mapRevision = 0;
  let currentHash: string | undefined;
  let observation = 0;
  const updateMapDetails = async (): Promise<void> => {
    const sequence = ++observation;
    const style = map.getStyle() as StyleDocument;
    const nextHash = await hashStyle(style);
    if (sequence !== observation) return;
    if (currentHash !== undefined && currentHash !== nextHash) mapRevision += 1;
    currentHash = nextHash;
    revision.textContent = String(mapRevision);
    styleHash.textContent = nextHash;
    layerCount.textContent = String(style.layers.length);
  };
  map.on('styledata', () => { void updateMapDetails(); });

  const { page: pageLifetime, tools: toolsLifetime } = createWebMcpExampleLifetimes();
  reset.addEventListener('click', () => {
    activity.clear();
    targets.clear();
    map.setStyle(createDemoStyle());
  }, { signal: pageLifetime.signal });

  const onMapClick = (event: MapMouseEvent): void => {
    renderCandidates(pickRenderedFeatures(map, event));
  };
  map.on('click', onMapClick);
  window.addEventListener('pagehide', () => pageLifetime.abort(), { once: true, signal: pageLifetime.signal });
  pageLifetime.signal.addEventListener('abort', () => {
    targets.clear();
    map.off('click', onMapClick);
  }, { once: true });
  const registration = await registerCoreWebMcpToolsSafely(
    () => registerMapLibreWebMcpTools({
      getMap: (): MapLibreMap => map,
      allowMutations: true,
      signal: toolsLifetime.signal,
      resourcePolicy: {
        baseUrl: document.baseURI,
        allowedResourceOrigins: [location.origin, 'https://demotiles.maplibre.org'],
      },
      authorizeInvocation: () => true,
      onInvocation: (event) => activity.append(event),
    }),
    support,
    toolsLifetime,
  );
  if (registration === undefined) {
    renderToolGroups(registeredTools, []);
    await updateMapDetails();
    return;
  }
  let supported = registration.supported;
  let toolNames: readonly string[] = registration.toolNames;
  if (registration.supported) {
    const modelContext = (document as Document & { readonly modelContext?: ModelContextToolRegistrar }).modelContext;
    let customRegistered = false;
    if (modelContext === undefined) toolsLifetime.abort();
    else customRegistered = await registerMapSelectionConsumptionToolSafely(modelContext, targets, toolsLifetime);
    if (customRegistered) {
      toolNames = [...registration.toolNames, 'consumeMapSelectionContexts'];
    } else {
      supported = false;
      toolNames = [];
    }
  }
  renderWebMcpSupport(support, registration, toolNames.length, supported);
  renderToolGroups(registeredTools, toolNames);
  await updateMapDetails();
};

if (typeof document !== 'undefined' && document.querySelector('[data-testid="map"]') !== null) {
  void startWebMcpExample();
}
