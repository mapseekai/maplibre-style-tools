import { hashStyle } from 'maplibre-style-tools/maplibre';
import { registerMapLibreWebMcpTools, type MapLibreWebMcpRegistration } from 'maplibre-style-tools/webmcp';
import type { StyleDocument } from 'maplibre-style-tools/core';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { z } from 'zod';

import { createActivityLog } from './activity-log.js';
import { createMapCommentController } from './comment-controller.js';
import { createCommentHighlight } from './comment-highlight.js';
import { createPendingCommentMarkerView } from './comment-markers.js';
import { PendingMapCommentStore } from './comment-targets.js';

const DEMO_STYLE_URL = 'https://demotiles.maplibre.org/style.json';

export function renderWebMcpSupport(host: HTMLElement, registration: MapLibreWebMcpRegistration, toolCount = registration.toolNames.length, supported = registration.supported): void {
  host.textContent = supported ? `Site tools available (${toolCount})` : 'Site tools unavailable · local preview';
}

type ModelContextToolRegistrar = { registerTool(tool: { readonly name: string; readonly title: string; readonly description: string; readonly inputSchema: Readonly<Record<string, unknown>>; readonly annotations: { readonly readOnlyHint: boolean; readonly untrustedContentHint: boolean }; readonly execute: (input: Record<string, unknown>, options: { readonly signal: AbortSignal }) => unknown | Promise<unknown> }, options?: { readonly signal?: AbortSignal }): Promise<void> };
const consumeSelectionIdsSchema = z.strictObject({ selectionIds: z.array(z.string().min(1).max(128)).min(1).max(20).refine((ids) => new Set(ids).size === ids.length, 'selectionIds must be unique') });

export const registerMapSelectionConsumptionTool = async (modelContext: ModelContextToolRegistrar, store: PendingMapCommentStore, signal: AbortSignal): Promise<void> => modelContext.registerTool({
  name: 'consumeMapSelectionContexts', title: 'Consume map selection contexts',
  description: 'Read and remove the immutable map selection contexts referenced by submitted browser comments. Call this before applying map changes from those comments.',
  inputSchema: { type: 'object', properties: { selectionIds: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 128 } } }, required: ['selectionIds'], additionalProperties: false },
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  execute: async (input) => {
    const parsed = consumeSelectionIdsSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: 'Selection context input is invalid.', error: { code: 'INVALID_INPUT', message: 'Selection context input is invalid.' } };
    try { const contexts = store.consumeMany(parsed.data.selectionIds); return { success: true, consumed: contexts.length, contexts }; }
    catch { return { success: false, message: 'A referenced selection context is unavailable.', error: { code: 'NOT_FOUND', message: 'A referenced selection context is unavailable.' } }; }
  },
}, { signal });

export const createWebMcpExampleLifetimes = (): { readonly page: AbortController; readonly tools: AbortController } => {
  const page = new AbortController(); const tools = new AbortController();
  page.signal.addEventListener('abort', () => tools.abort(), { once: true });
  return { page, tools };
};
export const registerCoreWebMcpToolsSafely = async (register: () => Promise<MapLibreWebMcpRegistration>, support: HTMLElement, toolsLifetime: AbortController): Promise<MapLibreWebMcpRegistration | undefined> => {
  try { return await register(); } catch { toolsLifetime.abort(); support.textContent = 'Site tools failed to register'; return undefined; }
};
export const registerMapSelectionConsumptionToolSafely = async (modelContext: ModelContextToolRegistrar, store: PendingMapCommentStore, toolsLifetime: AbortController): Promise<boolean> => {
  try { await registerMapSelectionConsumptionTool(modelContext, store, toolsLifetime.signal); return true; } catch { toolsLifetime.abort(); return false; }
};

const requireElement = <T extends HTMLElement>(testId: string): T => {
  const element = document.querySelector(`[data-testid="${testId}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing WebMCP example element: ${testId}`);
  return element as T;
};
const renderToolGroups = (host: HTMLElement, toolNames: readonly string[]): void => {
  const readOnly = new Set(['inspectStyle', 'queryMapFeatures']);
  host.replaceChildren(...[['Read-only', toolNames.filter((name) => readOnly.has(name))], ['Map mutations', toolNames.filter((name) => !readOnly.has(name))]].flatMap(([label, names]) => (names as string[]).length === 0 ? [] : [Object.assign(document.createElement('h3'), { textContent: label }), Object.assign(document.createElement('p'), { textContent: (names as string[]).join(', ') })]));
};

const startWebMcpExample = async (): Promise<void> => {
  const [{ Map, Marker }, ,] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css'), import('./style.css')]);
  const { page: pageLifetime, tools: toolsLifetime } = createWebMcpExampleLifetimes();
  const activity = createActivityLog(requireElement('activity-log'), { capacity: 20 });
  const status = requireElement('comment-status');
  const error = requireElement('map-load-error');
  const retry = requireElement<HTMLButtonElement>('retry-map');
  const reset = requireElement<HTMLButtonElement>('reset-map');
  const support = requireElement('webmcp-support');
  const registeredTools = requireElement('registered-tools');
  const layerCount = requireElement('map-layer-count');
  const revision = requireElement('map-revision');
  const styleHash = requireElement('map-style-hash');
  requireElement('secure-context').textContent = window.isSecureContext ? 'secure context' : 'not a secure context';
  const map = new Map({ container: 'map', style: DEMO_STYLE_URL, center: [0, 20], zoom: 1.5, attributionControl: {} });
  map.getCanvas().setAttribute('data-testid', 'map-canvas');
  const highlight = createCommentHighlight(map, pageLifetime.signal);
  let store!: PendingMapCommentStore;
  const markers = createPendingCommentMarkerView({ map, highlight, createMarker: (element) => new Marker({ element }), onCancel: (selectionId) => { store.remove(selectionId); } });
  store = new PendingMapCommentStore({ capacity: 20, idFactory: () => `map-selection-${crypto.randomUUID()}`, onRemove: ({ selectionId }) => markers.remove(selectionId) });
  const controller = createMapCommentController({ map, store, markers, highlight, status, signal: pageLifetime.signal });
  let loaded = false;
  let mapRevision = 0;
  let currentHash: string | undefined;
  let observation = 0;
  const updateMapDetails = async (): Promise<void> => {
    if (!map.isStyleLoaded()) return;
    const sequence = ++observation;
    const style = map.getStyle() as StyleDocument;
    const nextHash = await hashStyle(style);
    if (sequence !== observation) return;
    if (currentHash !== undefined && currentHash !== nextHash) mapRevision += 1;
    currentHash = nextHash; revision.textContent = String(mapRevision); styleHash.textContent = nextHash; layerCount.textContent = String(style.layers.length);
  };
  const onStyleLoad = (): void => {
    if (loaded) { controller.cancelDraftForStyleChange(); highlight.restore(); }
    loaded = true; error.hidden = true; controller.setEnabled(true); void updateMapDetails();
  };
  const onStyleData = (): void => { void updateMapDetails(); };
  const onError = (): void => { if (!loaded && !map.isStyleLoaded()) { error.hidden = false; controller.setEnabled(false, 'Map is loading.'); } };
  map.on('style.load', onStyleLoad); map.on('styledata', onStyleData); map.on('error', onError);
  retry.addEventListener('click', () => { error.hidden = true; controller.setEnabled(false, 'Map is loading.'); map.setStyle(DEMO_STYLE_URL); }, { signal: pageLifetime.signal });
  reset.addEventListener('click', () => { activity.clear(); controller.clear(); controller.setEnabled(false, 'Map is loading.'); map.setStyle(DEMO_STYLE_URL); }, { signal: pageLifetime.signal });
  window.addEventListener('pagehide', () => pageLifetime.abort(), { once: true, signal: pageLifetime.signal });
  pageLifetime.signal.addEventListener('abort', () => { controller.destroy(); markers.destroy(); highlight.destroy(); map.off('style.load', onStyleLoad); map.off('styledata', onStyleData); map.off('error', onError); }, { once: true });
  const registration = await registerCoreWebMcpToolsSafely(() => registerMapLibreWebMcpTools({ getMap: (): MapLibreMap => map, allowMutations: true, signal: toolsLifetime.signal, resourcePolicy: { baseUrl: document.baseURI, allowedResourceOrigins: [location.origin, 'https://demotiles.maplibre.org'] }, authorizeInvocation: () => true, onInvocation: (event) => activity.append(event) }), support, toolsLifetime);
  if (registration === undefined) { renderToolGroups(registeredTools, []); return; }
  let supported = registration.supported;
  let toolNames: readonly string[] = registration.toolNames;
  if (registration.supported) {
    const modelContext = (document as Document & { readonly modelContext?: ModelContextToolRegistrar }).modelContext;
    const customRegistered = modelContext === undefined ? false : await registerMapSelectionConsumptionToolSafely(modelContext, store, toolsLifetime);
    if (customRegistered) toolNames = [...registration.toolNames, 'consumeMapSelectionContexts']; else { supported = false; toolNames = []; }
  }
  renderWebMcpSupport(support, registration, toolNames.length, supported); renderToolGroups(registeredTools, toolNames);
};
if (typeof document !== 'undefined' && document.querySelector('[data-testid="map"]') !== null) void startWebMcpExample();
