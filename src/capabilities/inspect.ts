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
import {
  COMPACT_OUTPUT_TRUNCATED,
  boundInspectionProjection,
  invalidInputFailure,
  toFailure,
} from './boundary.js';
import type { AuthoritySource, StyleAuthority } from './authority.js';
import { authorityNotReadyError } from './authority.js';
import type {
  InspectStyleInput,
  InspectionField,
  InspectionProjection,
  CapabilityResult,
} from './contracts.js';
import { inspectStyleInputSchema } from './schemas.js';

export const INSPECT_STYLE_DESCRIPTION =
  'Inspect a MapLibre style, its validated structure, and GeoJSON inputs without mutating the map.';

const INSPECTION_MESSAGE = 'Style inspection completed.';
const DEFAULT_LIMIT = 100;
const ALL_LAYER_FIELDS: InspectionField[] = ['paint', 'layout', 'filter', 'zoom'];
const DEFAULT_INSPECT_FIELDS: InspectionField[] = ['paint', 'layout'];

const asJson = (value: unknown): JsonValue => value as JsonValue;

const layerProjection = (
  layer: StyleLayer,
  fields: readonly InspectionField[],
  includeZoom: boolean,
): JsonValue => ({
  id: layer.id,
  type: layer.type,
  source: typeof layer.source === 'string' ? layer.source : null,
  'source-layer': typeof layer['source-layer'] === 'string' ? layer['source-layer'] : null,
  ...(includeZoom ? {
    minzoom: typeof layer.minzoom === 'number' ? layer.minzoom : null,
    maxzoom: typeof layer.maxzoom === 'number' ? layer.maxzoom : null,
  } : {}),
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
  truncated = false,
) => boundInspectionProjection({
  message: INSPECTION_MESSAGE,
  action,
  projection,
  warnings,
  truncated,
});

const boundedNestedItems = (items: JsonValue[]) => {
  const bounded = items.slice(0, DEFAULT_LIMIT);
  const truncated = bounded.length < items.length;
  return {
    value: {
      items: bounded,
      returned: bounded.length,
      total: items.length,
      truncated,
      warnings: truncated ? [COMPACT_OUTPUT_TRUNCATED] : [],
    } as JsonValue,
    truncated,
  };
};

export const executeInspectStyle = (
  getAuthority: AuthoritySource<StyleAuthority>,
  rawInput: unknown,
  _execution: { abortSignal?: AbortSignal } = {},
): CapabilityResult<InspectionProjection> => {
    const parsedInput = inspectStyleInputSchema.safeParse(rawInput);
    if (!parsedInput.success) return invalidInputFailure(parsedInput.error);
    const input = parsedInput.data;
    if (input.action === 'analyzeGeoJson') {
      const analysis = analyzeGeoJson(input.data, input.options);
      if (!analysis.ok) return toFailure(analysis.error);
      const { warnings, ...value } = analysis.analysis;
      if (!analysis.analysis.available) {
        return project(input.action, { value: asJson(value) }, warnings);
      }
      const properties = boundedNestedItems(analysis.analysis.properties.map(asJson));
      return project(
        input.action,
        { value: asJson({ ...value, properties: properties.value }) },
        warnings,
        properties.truncated,
      );
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

    const authority = getAuthority();
    if (authority === null) return toFailure(authorityNotReadyError());
    const current = authority.readStyle();
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
          : project(input.action, { value: layerProjection(layer, input.fields ?? ALL_LAYER_FIELDS, true) }, warnings);
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
            ...authority.context(),
            layerLimit: input.layerLimit ?? DEFAULT_LIMIT,
          })),
        }, warnings);
      case 'inspectLayers': {
        const requested = input.layerIds ?? style.layers.slice(0, input.limit ?? DEFAULT_LIMIT).map((layer) => layer.id);
        const fields = input.fields ?? DEFAULT_INSPECT_FIELDS;
        const layers: JsonValue[] = [];
        const layersById = new Map(style.layers.map((layer) => [layer.id, layer]));
        for (const id of requested) {
          const layer = layersById.get(id);
          if (layer === undefined) return toFailure(notFound('Layer'));
          if (layers.length < (input.limit ?? DEFAULT_LIMIT)) {
            layers.push(layerProjection(layer, fields, fields.includes('zoom')));
          }
        }
        return project(input.action, { items: layers, total: requested.length }, warnings);
      }
      case 'getLayerCount':
        return project(input.action, { value: { layerCount: buildStyleContext(style, { layerLimit: 1 }).layerCount } }, warnings);
      case 'validateCurrentMap':
        return project(input.action, { value: { valid: true } }, warnings);
      case 'listSourceLayers': {
        let truncated = false;
        const usages = listSourceLayers(style, {
          ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
        }).map((usage) => {
          const layers = boundedNestedItems(usage.layers.map(asJson));
          truncated ||= layers.truncated;
          return asJson({ sourceId: usage.sourceId, sourceLayer: usage.sourceLayer, layers: layers.value });
        });
        return project(input.action, { items: usages }, warnings, truncated);
      }
    }
};
