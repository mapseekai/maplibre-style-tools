import { hashStyle } from 'maplibre-style-tools/maplibre';
import {
  registerMapLibreWebMcpTools,
  type MapLibreWebMcpRegistration,
} from 'maplibre-style-tools/webmcp';
import type { StyleDocument } from 'maplibre-style-tools/core';
import type { Map as MapLibreMap } from 'maplibre-gl';

import { createActivityLog } from './activity-log.js';
import { createDemoStyle } from './demo-style.js';

export function renderWebMcpSupport(
  host: HTMLElement,
  registration: MapLibreWebMcpRegistration,
): void {
  host.textContent = registration.supported
    ? `Site tools available (${registration.toolNames.length})`
    : 'Site tools unavailable';
}

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

const startWebMcpExample = async (): Promise<void> => {
  const [{ Map }, ,] = await Promise.all([
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
  const secureContext = requireElement('secure-context');
  secureContext.textContent = window.isSecureContext ? 'secure context' : 'not a secure context';

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

  reset.addEventListener('click', () => {
    activity.clear();
    map.setStyle(createDemoStyle());
  });

  const lifetime = new AbortController();
  window.addEventListener('pagehide', () => lifetime.abort(), { once: true });
  const registration = await registerMapLibreWebMcpTools({
    getMap: (): MapLibreMap => map,
    allowMutations: true,
    signal: lifetime.signal,
    resourcePolicy: {
      baseUrl: document.baseURI,
      allowedResourceOrigins: [location.origin, 'https://demotiles.maplibre.org'],
    },
    authorizeInvocation: () => true,
    onInvocation: (event) => activity.append(event),
  });
  renderWebMcpSupport(support, registration);
  renderToolGroups(registeredTools, registration.toolNames);
  await updateMapDetails();
};

if (typeof document !== 'undefined' && document.querySelector('[data-testid="map"]') !== null) {
  void startWebMcpExample();
}
