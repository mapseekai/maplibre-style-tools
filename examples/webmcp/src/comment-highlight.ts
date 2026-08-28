import type { Map as MapLibreMap } from 'maplibre-gl';

import type { FeatureReference, Scalar } from './comment-targets.js';
import type { FeatureGeometry } from './feature-picker.js';

const STATE_KEY = 'webmcp-comment-highlight';
const LAYER_PREFIX = 'webmcp-comment-highlight';

export const isCommentHighlightLayer = (layerId: string | undefined): boolean =>
  typeof layerId === 'string' && layerId.startsWith(`${LAYER_PREFIX}:`);

const HIGHLIGHT_COLOR = '#f59e0b';

export type HighlightKind = 'Point' | 'LineString' | 'Polygon';

export interface HighlightTarget {
  readonly sourceId: string;
  readonly sourceLayer?: string;
  readonly featureId?: string | number;
  readonly properties: Readonly<Record<string, Scalar>>;
  readonly kind: HighlightKind;
}

export interface CommentHighlightController {
  show(owner: string, target: HighlightTarget): void;
  clear(owner: string): void;
  clearAll(): void;
  restore(): void;
  destroy(): void;
}

export const highlightTargetFor = (feature: FeatureReference, geometry: FeatureGeometry): HighlightTarget => {
  const type = geometry.type;
  const kind: HighlightKind = type === 'Point' || type === 'MultiPoint'
    ? 'Point'
    : type === 'LineString' || type === 'MultiLineString'
      ? 'LineString'
      : 'Polygon';
  return {
    sourceId: feature.sourceId,
    ...(feature.sourceLayer === undefined ? {} : { sourceLayer: feature.sourceLayer }),
    ...(feature.featureId === undefined ? {} : { featureId: feature.featureId }),
    properties: feature.properties,
    kind,
  };
};

const stateOpacity = (highlighted: number): unknown => ['case', ['boolean', ['feature-state', STATE_KEY], false], highlighted, 0];

const overlayLayerId = (target: HighlightTarget): string =>
  `${LAYER_PREFIX}:${target.sourceId}:${target.sourceLayer ?? ''}:${target.kind}`;

const overlayLayer = (target: HighlightTarget): Record<string, unknown> => {
  const base = {
    id: overlayLayerId(target),
    source: target.sourceId,
    ...(target.sourceLayer === undefined ? {} : { 'source-layer': target.sourceLayer }),
    filter: ['==', ['geometry-type'], target.kind],
  };
  if (target.kind === 'Polygon') {
    return { ...base, type: 'fill', paint: { 'fill-color': HIGHLIGHT_COLOR, 'fill-opacity': stateOpacity(0.38), 'fill-outline-color': '#b45309' } };
  }
  if (target.kind === 'LineString') {
    return { ...base, type: 'line', paint: { 'line-color': HIGHLIGHT_COLOR, 'line-width': 6, 'line-opacity': stateOpacity(1) } };
  }
  return {
    ...base,
    type: 'circle',
    paint: {
      'circle-color': HIGHLIGHT_COLOR,
      'circle-radius': 10,
      'circle-stroke-color': '#111827',
      'circle-stroke-width': 2.5,
      'circle-opacity': stateOpacity(1),
      'circle-stroke-opacity': stateOpacity(1),
    },
  };
};

const matchLayerId = (owner: string): string => `${LAYER_PREFIX}:match:${owner}`;

const matchLayer = (owner: string, target: HighlightTarget): Record<string, unknown> => {
  const paint = target.kind === 'Polygon'
    ? { 'fill-color': HIGHLIGHT_COLOR, 'fill-opacity': 0.38, 'fill-outline-color': '#b45309' }
    : target.kind === 'LineString'
      ? { 'line-color': HIGHLIGHT_COLOR, 'line-width': 6 }
      : {
        'circle-color': HIGHLIGHT_COLOR,
        'circle-radius': 10,
        'circle-stroke-color': '#111827',
        'circle-stroke-width': 2.5,
      };
  return {
    id: matchLayerId(owner),
    type: target.kind === 'Polygon' ? 'fill' : target.kind === 'LineString' ? 'line' : 'circle',
    source: target.sourceId,
    ...(target.sourceLayer === undefined ? {} : { 'source-layer': target.sourceLayer }),
    filter: [
      'all',
      ['==', ['geometry-type'], target.kind],
      ...Object.entries(target.properties).map(([property, value]) => ['==', ['get', property], value]),
    ],
    paint,
  };
};

const featureStateTarget = (target: HighlightTarget): { source: string; sourceLayer?: string; id: string | number } => ({
  source: target.sourceId,
  ...(target.sourceLayer === undefined ? {} : { sourceLayer: target.sourceLayer }),
  id: target.featureId ?? 0,
});

export const createCommentHighlight = (
  map: MapLibreMap,
  signal: AbortSignal,
): CommentHighlightController => {
  const actives = new Map<string, HighlightTarget>();
  let destroyed = false;

  const sharesFeature = (target: HighlightTarget): boolean => {
    for (const other of actives.values()) {
      if (other !== target && other.sourceId === target.sourceId
        && other.sourceLayer === target.sourceLayer && other.featureId === target.featureId) return true;
    }
    return false;
  };

  const clearTarget = (owner: string, target: HighlightTarget): void => {
    if (target.featureId !== undefined) {
      if (map.getSource(target.sourceId) !== undefined && !sharesFeature(target)) {
        map.removeFeatureState(featureStateTarget(target), STATE_KEY);
      }
    } else if (map.getLayer(matchLayerId(owner)) !== undefined) {
      map.removeLayer(matchLayerId(owner));
    }
  };

  const applyTarget = (owner: string, target: HighlightTarget): void => {
    if (map.getSource(target.sourceId) === undefined) return;
    if (target.featureId !== undefined) {
      const layerId = overlayLayerId(target);
      if (map.getLayer(layerId) === undefined) map.addLayer(overlayLayer(target) as never);
      map.setFeatureState(featureStateTarget(target), { [STATE_KEY]: true });
      return;
    }
    if (Object.keys(target.properties).length === 0) return;
    if (map.getLayer(matchLayerId(owner)) !== undefined) map.removeLayer(matchLayerId(owner));
    map.addLayer(matchLayer(owner, target) as never);
  };

  const restore = (): void => {
    if (destroyed) return;
    for (const [owner, target] of actives) applyTarget(owner, target);
  };

  const onStyleLoad = (): void => { restore(); };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    map.off('style.load', onStyleLoad);
    signal.removeEventListener('abort', destroy);
    for (const [owner, target] of actives) clearTarget(owner, target);
    actives.clear();
    for (const layer of map.getStyle()?.layers ?? []) {
      if (layer.id.startsWith(`${LAYER_PREFIX}:`) && map.getLayer(layer.id) !== undefined) map.removeLayer(layer.id);
    }
  };

  map.on('style.load', onStyleLoad);
  signal.addEventListener('abort', destroy, { once: true });
  if (signal.aborted) destroy();

  return {
    show(owner, target): void {
      if (destroyed) return;
      const previous = actives.get(owner);
      if (previous !== undefined) clearTarget(owner, previous);
      actives.set(owner, target);
      applyTarget(owner, target);
    },
    clear(owner): void {
      if (destroyed) return;
      const target = actives.get(owner);
      if (target === undefined) return;
      actives.delete(owner);
      clearTarget(owner, target);
    },
    clearAll(): void {
      if (destroyed) return;
      for (const [owner, target] of actives) clearTarget(owner, target);
      actives.clear();
    },
    restore,
    destroy,
  };
};
