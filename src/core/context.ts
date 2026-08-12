import type {
  JsonValue,
  LayerSummary,
  StyleContext,
  StyleContextOptions,
  StyleDocument,
  StyleLayer,
} from './types.js';

const DEFAULT_LAYER_LIMIT = 120;

const summarizeLayer = (layer: StyleLayer): LayerSummary => {
  const source: LayerSummary['source'] =
    typeof layer.source === 'string' ? layer.source : undefined;
  const sourceLayer: LayerSummary['sourceLayer'] =
    typeof layer['source-layer'] === 'string' ? layer['source-layer'] : undefined;
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

export const buildStyleContext = (
  style: StyleDocument,
  options: StyleContextOptions = {},
): StyleContext => {
  const layerTypes = style.layers.reduce<Record<string, number>>((counts, layer) => {
    counts[layer.type] = (counts[layer.type] ?? 0) + 1;
    return counts;
  }, {});
  const layerLimit = options.layerLimit ?? DEFAULT_LAYER_LIMIT;

  return {
    ...(options.activeSourceId === undefined ? {} : {
      activeSourceId: options.activeSourceId,
    }),
    ...(options.selectedLayerId === undefined ? {} : {
      selectedLayerId: options.selectedLayerId,
    }),
    layerCount: style.layers.length,
    sourceCount: Object.keys(style.sources).length,
    layerTypes,
    layers: style.layers.slice(0, layerLimit).map(summarizeLayer),
  };
};
