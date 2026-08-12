import type {
  JsonValue,
  LayerSearchQuery,
  LayerSearchResult,
  LayerSummary,
  StyleDocument,
  StyleLayer,
} from './types.js';

const DEFAULT_LAYER_LIMIT = 120;

const includesText = (value: string | undefined, query: string): boolean =>
  value?.toLowerCase().includes(query) ?? false;

const summarizeLayer = (
  layer: StyleLayer,
  source: LayerSummary['source'],
  sourceLayer: LayerSummary['sourceLayer'],
): LayerSummary => {
  const visibility: JsonValue | undefined = layer.layout?.visibility;
  return {
    id: layer.id,
    type: layer.type,
    ...(source === undefined ? {} : { source }),
    ...(sourceLayer === undefined ? {} : { sourceLayer }),
    ...(layer.minzoom === undefined ? {} : { minzoom: layer.minzoom }),
    ...(layer.maxzoom === undefined ? {} : { maxzoom: layer.maxzoom }),
    ...(visibility === undefined ? {} : { visibility }),
  };
};

export const searchLayers = (
  style: StyleDocument,
  query: LayerSearchQuery = {},
): LayerSearchResult => {
  const textQuery = query.query?.trim().toLowerCase();
  const sourceLayerQuery = query.sourceLayer?.trim().toLowerCase();
  const matches = style.layers.flatMap((layer) => {
    const source: LayerSummary['source'] =
      typeof layer.source === 'string' ? layer.source : undefined;
    const sourceLayer: LayerSummary['sourceLayer'] =
      typeof layer['source-layer'] === 'string' ? layer['source-layer'] : undefined;
    if (query.type && layer.type !== query.type) {
      return [];
    }
    if (query.source && source !== query.source) {
      return [];
    }
    if (sourceLayerQuery && !includesText(sourceLayer, sourceLayerQuery)) {
      return [];
    }
    if (textQuery && !(
      includesText(layer.id, textQuery)
      || includesText(layer.type, textQuery)
      || includesText(source, textQuery)
      || includesText(sourceLayer, textQuery)
    )) {
      return [];
    }
    return [summarizeLayer(layer, source, sourceLayer)];
  });
  const limit = query.limit ?? DEFAULT_LAYER_LIMIT;
  return { layers: matches.slice(0, limit), total: matches.length };
};
