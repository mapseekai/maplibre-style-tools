import type {
  LayerSearchQuery,
  LayerSearchResult,
  LayerSummary,
  StyleContext,
  StyleContextOptions,
  StyleDocument,
  StyleLayer,
} from '../types.js';

const DEFAULT_LAYER_LIMIT = 120;

const summarizeLayer = (layer: StyleLayer): LayerSummary => ({
  id: layer.id,
  type: layer.type,
  source: layer.source,
  sourceLayer: layer['source-layer'],
  minzoom: layer.minzoom,
  maxzoom: layer.maxzoom,
  visibility: layer.layout?.visibility,
});

const includesText = (value: unknown, query: string): boolean =>
  typeof value === 'string' && value.toLowerCase().includes(query);

const matchesQuery = (layer: StyleLayer, rawQuery: string): boolean => {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return (
    includesText(layer.id, query) ||
    includesText(layer.type, query) ||
    includesText(layer.source, query) ||
    includesText(layer['source-layer'], query)
  );
};

export const buildStyleContext = (
  style: StyleDocument,
  options: StyleContextOptions = {}
): StyleContext => {
  const layers = style.layers ?? [];
  const layerTypes = layers.reduce<Record<string, number>>((counts, layer) => {
    counts[layer.type] = (counts[layer.type] ?? 0) + 1;
    return counts;
  }, {});

  const layerLimit = options.layerLimit ?? DEFAULT_LAYER_LIMIT;

  return {
    activeSourceId: options.activeSourceId,
    selectedLayerId: options.selectedLayerId,
    layerCount: layers.length,
    sourceCount: Object.keys(style.sources ?? {}).length,
    layerTypes,
    layers: layers.slice(0, layerLimit).map(summarizeLayer),
  };
};

export const searchLayers = (
  style: StyleDocument,
  query: LayerSearchQuery = {}
): LayerSearchResult => {
  const limit = query.limit ?? DEFAULT_LAYER_LIMIT;
  const sourceLayerQuery = query.sourceLayer?.trim().toLowerCase();

  const matches = (style.layers ?? []).filter((layer) => {
    if (query.type && layer.type !== query.type) {
      return false;
    }
    if (query.source && layer.source !== query.source) {
      return false;
    }
    if (
      sourceLayerQuery &&
      !includesText(layer['source-layer'], sourceLayerQuery)
    ) {
      return false;
    }
    if (query.query && !matchesQuery(layer, query.query)) {
      return false;
    }
    return true;
  });

  return {
    layers: matches.slice(0, limit).map(summarizeLayer),
    total: matches.length,
  };
};
