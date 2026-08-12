import type {
  JsonValue,
  LayerSearchQuery,
  LayerSearchResult,
  LayerSummary,
  ListSourceLayersOptions,
  SourceLayerUsage,
  StyleDocument,
  StyleLayer,
} from './types.js';
import { listSourceLayersOptionsSchema } from './schemas.js';

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

const compareCodeUnits = (left: string, right: string): number => (
  left < right ? -1 : left > right ? 1 : 0
);

export const listSourceLayers = (
  style: StyleDocument,
  options?: ListSourceLayersOptions,
): SourceLayerUsage[] => {
  const parsedOptions = listSourceLayersOptionsSchema.parse(options === undefined ? {} : options);
  const usages = new Map<string, SourceLayerUsage>();
  for (const layer of style.layers) {
    const sourceId = layer.source;
    const sourceLayer = layer['source-layer'];
    if (
      typeof sourceId !== 'string'
      || typeof sourceLayer !== 'string'
      || sourceLayer.length === 0
      || (parsedOptions.sourceId !== undefined && sourceId !== parsedOptions.sourceId)
    ) continue;
    const key = JSON.stringify([sourceId, sourceLayer]);
    let usage = usages.get(key);
    if (usage === undefined) {
      usage = { sourceId, sourceLayer, layers: [] };
      usages.set(key, usage);
    }
    usage.layers.push({ id: layer.id, type: layer.type });
  }
  return [...usages.values()].sort((left, right) => (
    compareCodeUnits(left.sourceId, right.sourceId)
    || compareCodeUnits(left.sourceLayer, right.sourceLayer)
  ));
};
