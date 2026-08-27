import type { Feature, FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';

import type { FeatureGeometry } from './feature-picker.js';

const SOURCE_ID = 'webmcp-comment-highlight';
const FILL_LAYER_ID = 'webmcp-comment-highlight-fill';
const LINE_LAYER_ID = 'webmcp-comment-highlight-line';
const POINT_LAYER_ID = 'webmcp-comment-highlight-point';

const emptyData: FeatureCollection = { type: 'FeatureCollection', features: [] };

export interface CommentHighlightController {
  show(owner: string, geometry: FeatureGeometry): void;
  clear(owner: string): void;
  clearAll(): void;
  restore(): void;
  destroy(): void;
}

export const createCommentHighlight = (
  map: MapLibreMap,
  signal: AbortSignal,
): CommentHighlightController => {
  let owner: string | undefined;
  let geometry: FeatureGeometry | undefined;
  let destroyed = false;

  const data = (): FeatureCollection => geometry === undefined
    ? emptyData
    : { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry } as Feature] };

  const updateData = (): void => {
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(data());
  };

  const restore = (): void => {
    if (destroyed) return;
    if (map.getSource(SOURCE_ID) === undefined) {
      map.addSource(SOURCE_ID, { type: 'geojson', data: data() });
    } else {
      updateData();
    }
    if (map.getLayer(FILL_LAYER_ID) === undefined) {
      map.addLayer({
        id: FILL_LAYER_ID,
        type: 'fill',
        source: SOURCE_ID,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.24 },
      });
    }
    if (map.getLayer(LINE_LAYER_ID) === undefined) {
      map.addLayer({
        id: LINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        filter: ['==', '$type', 'LineString'],
        paint: { 'line-color': '#f59e0b', 'line-width': 4 },
      });
    }
    if (map.getLayer(POINT_LAYER_ID) === undefined) {
      map.addLayer({
        id: POINT_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', '$type', 'Point'],
        paint: { 'circle-color': '#f59e0b', 'circle-radius': 8, 'circle-stroke-color': '#111827', 'circle-stroke-width': 2 },
      });
    }
  };

  const onStyleLoad = (): void => { restore(); };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    map.off('style.load', onStyleLoad);
    signal.removeEventListener('abort', destroy);
    for (const layerId of [FILL_LAYER_ID, LINE_LAYER_ID, POINT_LAYER_ID]) {
      if (map.getLayer(layerId) !== undefined) map.removeLayer(layerId);
    }
    if (map.getSource(SOURCE_ID) !== undefined) map.removeSource(SOURCE_ID);
  };

  map.on('style.load', onStyleLoad);
  signal.addEventListener('abort', destroy, { once: true });
  if (signal.aborted) destroy();

  return {
    show(nextOwner, nextGeometry): void {
      if (destroyed) return;
      owner = nextOwner;
      geometry = nextGeometry;
      restore();
    },
    clear(clearOwner): void {
      if (destroyed || owner !== clearOwner) return;
      owner = undefined;
      geometry = undefined;
      restore();
    },
    clearAll(): void {
      if (destroyed) return;
      owner = undefined;
      geometry = undefined;
      restore();
    },
    restore,
    destroy,
  };
};
