import {
  analyzeGeoJson,
  buildStyleContext,
  createStyleToolError,
  listSourceLayers,
  searchLayers,
} from '../core/index.js';
import type {
  GeoJsonAnalysis,
  JsonObject,
  JsonValue,
  LayerSearchQuery,
  LayerSearchResult,
  LayerSummary,
  SourceLayerUsage,
  StyleContext,
  StyleDocument,
  StyleLayer,
  StyleSource,
  StyleToolError,
  StyleWarning,
} from '../core/index.js';
import type { CliCommand } from './types.js';

export type InspectWarningDto = JsonObject & {
  code: string;
  message: string;
  path?: string;
};
export type InspectLayerSummaryDto = JsonObject & {
  id: string;
  type: string;
  source?: string;
  sourceLayer?: string;
  minzoom?: number;
  maxzoom?: number;
  visibility?: JsonValue;
};
export type InspectStyleSummaryDto = JsonObject & {
  activeSourceId?: string | null;
  selectedLayerId?: string | null;
  layerCount: number;
  sourceCount: number;
  layerTypes: Record<string, number> & JsonObject;
  layers: InspectLayerSummaryDto[];
};
export type InspectLayerSearchDto = JsonObject & {
  layers: InspectLayerSummaryDto[];
  total: number;
};
export type InspectLayerDto = StyleLayer;
export type InspectSourceDto = StyleSource;
export type InspectSourceLayersDto = JsonObject & {
  sources: Array<JsonObject & {
    sourceId: string;
    sourceLayer: string;
    layers: Array<JsonObject & { id: string; type: string }>;
  }>;
};
export type InspectGeoJsonPropertyDto = JsonObject & {
  name: string;
  types: Array<'string' | 'number' | 'boolean' | 'null' | 'array' | 'object'>;
  numericRange?: JsonObject & { min: number; max: number };
  topValues?: Array<JsonObject & {
    value: string | number | boolean | null;
    count: number;
  }>;
};
export type InspectGeoJsonDto =
  | (JsonObject & {
      available: false;
      reason: 'remote-url';
      warnings: InspectWarningDto[];
    })
  | (JsonObject & {
      available: true;
      featureCount: number;
      geometryTypes: Record<string, number> & JsonObject;
      bbox?: [number, number, number, number];
      properties: InspectGeoJsonPropertyDto[];
      warnings: InspectWarningDto[];
    });
export type InspectValue = InspectStyleSummaryDto | InspectLayerSearchDto
  | InspectLayerDto | InspectSourceDto | InspectSourceLayersDto | InspectGeoJsonDto;
export type InspectResult =
  | { ok: true; value: InspectValue }
  | { ok: false; error: StyleToolError };
export type InspectRequest = Omit<
  Extract<CliCommand, { kind: 'inspect' }>,
  'kind' | 'styleInput'
>;

const mapWarning = (warning: StyleWarning): InspectWarningDto => ({
  code: warning.code,
  message: warning.message,
  ...(warning.path === undefined ? {} : { path: warning.path }),
});

const mapLayerSummary = (layer: LayerSummary): InspectLayerSummaryDto => ({
  id: layer.id,
  type: layer.type,
  ...(layer.source === undefined ? {} : { source: layer.source }),
  ...(layer.sourceLayer === undefined ? {} : { sourceLayer: layer.sourceLayer }),
  ...(layer.minzoom === undefined ? {} : { minzoom: layer.minzoom }),
  ...(layer.maxzoom === undefined ? {} : { maxzoom: layer.maxzoom }),
  ...(layer.visibility === undefined ? {} : { visibility: layer.visibility }),
});

const mapStyleContext = (context: StyleContext): InspectStyleSummaryDto => ({
  ...(context.activeSourceId === undefined ? {} : {
    activeSourceId: context.activeSourceId,
  }),
  ...(context.selectedLayerId === undefined ? {} : {
    selectedLayerId: context.selectedLayerId,
  }),
  layerCount: context.layerCount,
  sourceCount: context.sourceCount,
  layerTypes: { ...context.layerTypes },
  layers: context.layers.map(mapLayerSummary),
});

const mapLayerSearch = (result: LayerSearchResult): InspectLayerSearchDto => ({
  layers: result.layers.map(mapLayerSummary),
  total: result.total,
});

const mapSourceLayer = (
  usage: SourceLayerUsage,
): InspectSourceLayersDto['sources'][number] => ({
  sourceId: usage.sourceId,
  sourceLayer: usage.sourceLayer,
  layers: usage.layers.map((layer) => ({ id: layer.id, type: layer.type })),
});

const mapGeoJsonAnalysis = (analysis: GeoJsonAnalysis): InspectGeoJsonDto => {
  if (!analysis.available) {
    return {
      available: false,
      reason: analysis.reason,
      warnings: analysis.warnings.map(mapWarning),
    };
  }
  return {
    available: true,
    featureCount: analysis.featureCount,
    geometryTypes: { ...analysis.geometryTypes },
    ...(analysis.bbox === undefined ? {} : { bbox: [...analysis.bbox] }),
    properties: analysis.properties.map((property) => ({
      name: property.name,
      types: [...property.types],
      ...(property.numericRange === undefined ? {} : {
        numericRange: { ...property.numericRange },
      }),
      ...(property.topValues === undefined ? {} : {
        topValues: property.topValues.map((entry) => ({ ...entry })),
      }),
    })),
    warnings: analysis.warnings.map(mapWarning),
  };
};

const missing = (kind: 'layer' | 'source', id: string): InspectResult => ({
  ok: false,
  error: createStyleToolError(
    'NOT_FOUND',
    `${kind === 'layer' ? 'Layer' : 'Source'} "${id}" was not found.`,
    `/${kind === 'layer' ? 'layers' : 'sources'}/${id}`,
  ),
});

export function inspectStyle(
  style: StyleDocument,
  request: InspectRequest,
): InspectResult {
  if (request.layerId !== undefined) {
    const layer = style.layers.find(({ id }) => id === request.layerId);
    return layer === undefined ? missing('layer', request.layerId) : { ok: true, value: layer };
  }

  if (request.sourceId !== undefined) {
    if (!Object.hasOwn(style.sources, request.sourceId)) {
      return missing('source', request.sourceId);
    }
    return { ok: true, value: style.sources[request.sourceId] as StyleSource };
  }

  if (request.sourceLayers === true) {
    const usages = listSourceLayers(
      style,
      request.source === undefined ? undefined : { sourceId: request.source },
    );
    return { ok: true, value: { sources: usages.map(mapSourceLayer) } };
  }

  if (request.analyzeGeoJsonSourceId !== undefined) {
    const sourceId = request.analyzeGeoJsonSourceId;
    if (!Object.hasOwn(style.sources, sourceId)) return missing('source', sourceId);
    const source = style.sources[sourceId] as StyleSource;
    if (source.type !== 'geojson') {
      return {
        ok: false,
        error: createStyleToolError(
          'UNSUPPORTED_SOURCE',
          `Source "${sourceId}" is not a GeoJSON source.`,
          `/sources/${sourceId}`,
        ),
      };
    }
    const result = analyzeGeoJson(source.data);
    return result.ok
      ? { ok: true, value: mapGeoJsonAnalysis(result.analysis) }
      : { ok: false, error: result.error };
  }

  const query: LayerSearchQuery = {
    ...(request.query === undefined ? {} : { query: request.query }),
    ...(request.type === undefined ? {} : { type: request.type }),
    ...(request.source === undefined ? {} : { source: request.source }),
    ...(request.sourceLayer === undefined ? {} : { sourceLayer: request.sourceLayer }),
  };
  if (Object.keys(query).length > 0) {
    return { ok: true, value: mapLayerSearch(searchLayers(style, query)) };
  }
  const result: InspectResult = { ok: true, value: mapStyleContext(buildStyleContext(style)) };
  if (result.ok) {
    const jsonValue: JsonValue = result.value;
    void jsonValue;
  }
  return result;
}
