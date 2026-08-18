import {
  analyzeGeoJson,
  buildStyleContext,
  createStyleToolError,
  listSourceLayers,
  searchLayers,
  styleTransactionSchema,
  validateStyleDocument,
} from '../core/index.js';
import type { JsonValue, StyleDocument, StyleLayer, StyleWarning } from '../core/index.js';
import { boundInspectionProjection, createAiTool, toFailure } from './boundary.js';
import type {
  CreateMapLibreStyleToolsOptions,
  InspectStyleInput,
  InspectionField,
  InspectionProjection,
  MapLibreAiTool,
} from './contracts.js';
import { inspectStyleInputSchema } from './schemas.js';
import { readValidatedMapStyle, snapshotMapToolContext } from './shared.js';

const INSPECTION_MESSAGE = 'Style inspection completed.';
const DEFAULT_LIMIT = 100;
const ALL_LAYER_FIELDS: InspectionField[] = ['paint', 'layout', 'filter', 'zoom'];
const DEFAULT_INSPECT_FIELDS: InspectionField[] = ['paint', 'layout'];

const asJson = (value: unknown): JsonValue => value as JsonValue;

const layerProjection = (
  layer: StyleLayer,
  fields: readonly InspectionField[],
): JsonValue => ({
  id: layer.id,
  type: layer.type,
  source: typeof layer.source === 'string' ? layer.source : null,
  'source-layer': typeof layer['source-layer'] === 'string' ? layer['source-layer'] : null,
  minzoom: typeof layer.minzoom === 'number' ? layer.minzoom : null,
  maxzoom: typeof layer.maxzoom === 'number' ? layer.maxzoom : null,
  ...(fields.includes('paint') ? { paint: asJson(layer.paint ?? {}) } : {}),
  ...(fields.includes('layout') ? { layout: asJson(layer.layout ?? {}) } : {}),
  ...(fields.includes('filter') ? { filter: asJson(layer.filter ?? null) } : {}),
});

const rootProjection = (style: StyleDocument): JsonValue => {
  const {
    version, name, metadata, transition, center, zoom, bearing, pitch, light, sky,
    projection, terrain, glyphs, sprite,
  } = style;
  return {
    version,
    ...(name === undefined ? {} : { name }),
    ...(metadata === undefined ? {} : { metadata: asJson(metadata) }),
    ...(transition === undefined ? {} : { transition: asJson(transition) }),
    ...(center === undefined ? {} : { center: asJson(center) }),
    ...(zoom === undefined ? {} : { zoom }),
    ...(bearing === undefined ? {} : { bearing }),
    ...(pitch === undefined ? {} : { pitch }),
    ...(light === undefined ? {} : { light: asJson(light) }),
    ...(sky === undefined ? {} : { sky: asJson(sky) }),
    ...(projection === undefined ? {} : { projection: asJson(projection) }),
    ...(terrain === undefined ? {} : { terrain: asJson(terrain) }),
    ...(glyphs === undefined ? {} : { glyphs }),
    ...(sprite === undefined ? {} : { sprite }),
  } as JsonValue;
};

const notFound = (kind: 'Layer' | 'Source') => createStyleToolError(
  'NOT_FOUND', `Requested ${kind.toLowerCase()} was not found.`,
);

const project = (
  action: InspectStyleInput['action'],
  projection: { items: JsonValue[]; total?: number } | { value: JsonValue },
  warnings: readonly StyleWarning[] = [],
) => boundInspectionProjection({
  message: INSPECTION_MESSAGE,
  action,
  projection,
  warnings,
});

export const createInspectStyleTool = (
  options: Pick<CreateMapLibreStyleToolsOptions, 'getMap' | 'getContext'>,
): MapLibreAiTool<InspectStyleInput, InspectionProjection> => createAiTool(
  inspectStyleInputSchema,
  'Inspect a MapLibre style, its validated structure, and GeoJSON inputs without mutating the map.',
  (input) => {
    if (input.action === 'analyzeGeoJson') {
      const analysis = analyzeGeoJson(input.data, input.options);
      return analysis.ok
        ? project(input.action, { value: asJson(analysis.analysis) })
        : toFailure(analysis.error);
    }
    if (input.action === 'validateDocument') {
      const validation = validateStyleDocument(input.style);
      return validation.ok
        ? project(input.action, { value: { valid: true } }, validation.warnings)
        : toFailure(validation.errors[0] ?? createStyleToolError('STYLE_INVALID', 'MapLibre style validation failed.'));
    }
    if (input.action === 'validateTransaction') {
      const validation = styleTransactionSchema.safeParse(input.transaction);
      return validation.success
        ? project(input.action, { value: { valid: true } })
        : toFailure(createStyleToolError('INVALID_INPUT', validation.error.issues[0]?.message ?? 'Style transaction is invalid.'));
    }

    const current = readValidatedMapStyle(options.getMap);
    if (!current.ok) return toFailure(current.error);
    const { style, warnings } = current;

    switch (input.action) {
      case 'listLayers': {
        const result = searchLayers(style, {
          query: input.query,
          type: input.type,
          source: input.source,
          sourceLayer: input.sourceLayer,
          limit: input.limit ?? DEFAULT_LIMIT,
        });
        return project(input.action, { items: result.layers.map(asJson), total: result.total }, warnings);
      }
      case 'listSources': {
        const entries = Object.entries(style.sources).map(([id, source]) => ({ id, source }));
        return project(input.action, { items: entries.slice(0, input.limit ?? DEFAULT_LIMIT).map(asJson), total: entries.length }, warnings);
      }
      case 'getLayer': {
        const layer = style.layers.find((candidate) => candidate.id === input.layerId);
        return layer === undefined
          ? toFailure(notFound('Layer'))
          : project(input.action, { value: layerProjection(layer, input.fields ?? ALL_LAYER_FIELDS) }, warnings);
      }
      case 'getSource': {
        const source = style.sources[input.sourceId];
        return source === undefined
          ? toFailure(notFound('Source'))
          : project(input.action, { value: asJson({ id: input.sourceId, source }) }, warnings);
      }
      case 'getRoot':
        return project(input.action, { value: rootProjection(style) }, warnings);
      case 'getContext':
        return project(input.action, {
          value: asJson(buildStyleContext(style, {
            ...snapshotMapToolContext(options.getContext),
            layerLimit: input.layerLimit ?? DEFAULT_LIMIT,
          })),
        }, warnings);
      case 'inspectLayers': {
        const requested = input.layerIds ?? style.layers.slice(0, input.limit ?? DEFAULT_LIMIT).map((layer) => layer.id);
        const layers: JsonValue[] = [];
        for (const id of requested.slice(0, input.limit ?? DEFAULT_LIMIT)) {
          const layer = style.layers.find((candidate) => candidate.id === id);
          if (layer === undefined) return toFailure(notFound('Layer'));
          layers.push(layerProjection(layer, input.fields ?? DEFAULT_INSPECT_FIELDS));
        }
        return project(input.action, { items: layers, total: requested.length }, warnings);
      }
      case 'getLayerCount':
        return project(input.action, { value: { layerCount: buildStyleContext(style, { layerLimit: 1 }).layerCount } }, warnings);
      case 'validateCurrentMap':
        return project(input.action, { value: { valid: true } }, warnings);
      case 'listSourceLayers':
        return project(input.action, { items: listSourceLayers(style, { sourceId: input.sourceId }).map(asJson) }, warnings);
    }
  },
) as unknown as MapLibreAiTool<InspectStyleInput, InspectionProjection>;
