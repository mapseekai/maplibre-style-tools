/// <reference types="node" preserve="true" />
/// <reference types="geojson" preserve="true" />

import { tool } from 'ai';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { z } from 'zod';
import {
  buildStyleContext,
  createStyleToolError,
  validateStyleDocument,
} from '../core/index.js';
import type {
  JsonObject,
  StyleDocument,
  StyleOperation,
  StyleToolError,
  StyleTransaction,
} from '../core/index.js';
import {
  applyStyleDocumentOrUrlToMap,
  applyTransactionToMap,
  createMapRuntimeCommands,
  queryRenderedFeaturesBounded,
  querySourceFeaturesBounded,
} from '../adapters/maplibre/index.js';
import type {
  MapStyleApplyResult,
  RuntimeCommandResult,
  RuntimeImageLoader,
} from '../adapters/maplibre/index.js';
import { createCompactMapLibreStyleTools } from './compact-tools.js';
import { parseJsonOrRawString, parseStrictJson } from './compatibility.js';
import { toAiToolResult } from './result.js';
import type { AiStyleToolResult } from './result.js';
import * as schemas from './schemas.js';

export type ToolCallResult<TStyle = unknown> = AiStyleToolResult<unknown, TStyle>;
export type MapAccessor = () => MapLibreMap | null;
export type StyleAccessor<TStyle = unknown> = () => TStyle;

export interface CreateMapLibreStyleToolsOptions<TStyle = unknown> {
  getMap: MapAccessor;
  getState?: StyleAccessor<TStyle>;
  getContext?: () => {
    activeSourceId?: string | null;
    selectedLayerId?: string | null;
  };
  imageLoader?: RuntimeImageLoader;
}

type ApplicationState<TStyle> = { style?: TStyle };
type ReadyStyle<TStyle> =
  | {
      ok: true;
      map: MapLibreMap;
      current: StyleDocument;
      outer: ApplicationState<TStyle>;
    }
  | { ok: false; result: AiStyleToolResult<unknown, TStyle> };

const MAP_NOT_READY_MESSAGE =
  'Map is not ready yet. Please wait until the preview loads, then retry.';

function applicationState<TStyle>(
  getState: StyleAccessor<TStyle> | undefined,
): ApplicationState<TStyle> {
  return getState === undefined ? {} : { style: getState() };
}

function failure<TStyle>(
  error: StyleToolError,
  outer: ApplicationState<TStyle>,
  data?: unknown,
): AiStyleToolResult<unknown, TStyle> {
  return toAiToolResult({
    success: false,
    message: error.message,
    error,
    ...(data === undefined ? {} : { data }),
    ...outer,
  });
}

function legacyFailure<TStyle>(
  message: string,
  outer: ApplicationState<TStyle>,
  code: StyleToolError['code'] = 'INVALID_INPUT',
): AiStyleToolResult<unknown, TStyle> {
  return failure(createStyleToolError(code, message), outer);
}

function success<TStyle>(
  message: string,
  outer: ApplicationState<TStyle>,
  data?: unknown,
): AiStyleToolResult<unknown, TStyle> {
  return toAiToolResult({
    success: true,
    message,
    ...(data === undefined ? {} : { data }),
    ...outer,
  });
}

function readStyle(map: MapLibreMap):
  | { ok: true; style: StyleDocument }
  | { ok: false; error: StyleToolError } {
  let raw: unknown;
  try {
    raw = map.getStyle();
  } catch {
    return {
      ok: false,
      error: createStyleToolError('MAP_NOT_READY', 'Current map style is unavailable.'),
    };
  }
  const validation = validateStyleDocument(raw);
  return validation.ok
    ? { ok: true, style: validation.style }
    : {
        ok: false,
        error: validation.errors[0]
          ?? createStyleToolError('STYLE_INVALID', 'Current map style is unavailable.'),
      };
}

function mapTransactionData(result: MapStyleApplyResult): Record<string, unknown> {
  const data: Record<string, unknown> = {
    applied: result.applied,
    changedLayers: result.changedLayers,
    changedSources: result.changedSources,
    diff: result.diff,
    warnings: result.warnings,
    styleAuthority: result.styleAuthority,
  };
  if (result.styleAuthority === 'current') data.style = result.style;
  if (result.styleAuthority === 'pre-operation') {
    data.style = result.style;
    data.baselineOnly = true;
  }
  if (result.rolledBack !== undefined) data.rolledBack = result.rolledBack;
  if (result.rollbackError !== undefined) data.rollbackError = result.rollbackError;
  return data;
}

function parsedObject(
  raw: string,
  label: string,
): { ok: true; value: JsonObject } | { ok: false; error: StyleToolError } {
  const parsed = parseStrictJson(raw, label);
  if (!parsed.ok) return parsed;
  if (typeof parsed.value !== 'object' || parsed.value === null
    || Array.isArray(parsed.value)) {
    return {
      ok: false,
      error: createStyleToolError('INVALID_INPUT', label + ' must be a JSON object.'),
    };
  }
  return { ok: true, value: parsed.value };
}

function parsedObjectOrNull(
  raw: string,
  label: string,
): { ok: true; value: JsonObject | null } | { ok: false; error: StyleToolError } {
  const parsed = parseStrictJson(raw, label);
  if (!parsed.ok) return parsed;
  if (parsed.value === null) return { ok: true, value: null };
  if (typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return {
      ok: false,
      error: createStyleToolError(
        'INVALID_INPUT', label + ' must be a JSON object or null.',
      ),
    };
  }
  return { ok: true, value: parsed.value };
}

function layerMissing<TStyle>(
  layerId: string,
  outer: ApplicationState<TStyle>,
): AiStyleToolResult<unknown, TStyle> {
  return legacyFailure(
    'Layer "' + layerId + '" not found in current style.',
    outer,
    'NOT_FOUND',
  );
}

function sourceMissing<TStyle>(
  sourceId: string,
  outer: ApplicationState<TStyle>,
): AiStyleToolResult<unknown, TStyle> {
  return legacyFailure(
    'Source "' + sourceId + '" not found in current style.',
    outer,
    'NOT_FOUND',
  );
}

function hasLayer(style: StyleDocument, layerId: string): boolean {
  return style.layers.some((layer) => layer.id === layerId);
}

export const createMapLibreStyleTools = <TStyle = unknown>({
  getMap,
  getState,
  getContext,
  imageLoader,
}: CreateMapLibreStyleToolsOptions<TStyle>) => {
  const state = () => applicationState(getState);

  const ready = (): ReadyStyle<TStyle> => {
    const outer = state();
    const map = getMap();
    if (map === null) {
      return {
        ok: false,
        result: failure(
          createStyleToolError('MAP_NOT_READY', MAP_NOT_READY_MESSAGE),
          outer,
        ),
      };
    }
    const current = readStyle(map);
    return current.ok
      ? { ok: true, map, current: current.style, outer }
      : { ok: false, result: failure(current.error, outer) };
  };

  const runtimeReady = ():
    | { ok: true; map: MapLibreMap; outer: ApplicationState<TStyle> }
    | { ok: false; result: AiStyleToolResult<unknown, TStyle> } => {
    const outer = state();
    const map = getMap();
    return map === null
      ? {
          ok: false,
          result: failure(
            createStyleToolError('MAP_NOT_READY', MAP_NOT_READY_MESSAGE),
            outer,
          ),
        }
      : { ok: true, map, outer };
  };

  const applyOperations = async (
    map: MapLibreMap,
    outer: ApplicationState<TStyle>,
    operations: StyleOperation[],
    message: string,
    diff?: boolean,
  ): Promise<AiStyleToolResult<unknown, TStyle>> => {
    const transaction: StyleTransaction = { operations };
    const result = await applyTransactionToMap(
      map,
      transaction,
      diff === undefined ? undefined : { diff },
    );
    const data = mapTransactionData(result);
    return result.ok
      ? success(message, outer, data)
      : failure(result.error, outer, data);
  };

  const runRuntime = async (
    outer: ApplicationState<TStyle>,
    result: RuntimeCommandResult | Promise<RuntimeCommandResult>,
    message: string,
  ): Promise<AiStyleToolResult<unknown, TStyle>> => {
    const resolved = await result;
    return resolved.ok
      ? success(message, outer, resolved.data)
      : failure(resolved.error, outer);
  };

  const register = <Schema extends z.ZodType>(
    description: string,
    inputSchema: Schema,
    execute: (input: z.output<Schema>) =>
      | AiStyleToolResult<unknown, TStyle>
      | Promise<AiStyleToolResult<unknown, TStyle>>,
  ) => tool({
    description,
    inputSchema,
    execute: async (rawInput) => {
      const parsed = inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const error = createStyleToolError(
          'INVALID_INPUT',
          issue?.message ?? 'Tool input is invalid.',
        );
        return failure(error, {});
      }
      return execute(parsed.data);
    },
  });

  const legacyTools = {
    listAllLayers: register(
      'List all loaded layers from the validated current MapLibre style.',
      schemas.fullListAllLayersInputSchema,
      ({ limit }) => {
        const context = ready();
        if (!context.ok) return context.result;
        const discovered = buildStyleContext(context.current, { layerLimit: limit });
        if (discovered.layerCount === 0) {
          return legacyFailure('No layers found in current style.', context.outer);
        }
        const summary = discovered.layers.map((layer, index) => {
          const source = layer.source === undefined ? '' : ', source: ' + layer.source;
          const sourceLayer = layer.sourceLayer === undefined
            ? '' : ', source-layer: ' + layer.sourceLayer;
          return String(index + 1) + '. ' + layer.id + ' (type: ' + layer.type
            + source + sourceLayer + ')';
        }).join('\n');
        return success(
          'Loaded layers (' + discovered.layerCount + ' total):\n' + summary,
          context.outer,
          discovered,
        );
      },
    ),

    listAllSources: register(
      'List all sources from the validated current MapLibre style.',
      schemas.fullListAllSourcesInputSchema,
      ({ limit }) => {
        const context = ready();
        if (!context.ok) return context.result;
        const entries = Object.entries(context.current.sources);
        if (entries.length === 0) {
          return legacyFailure('No sources found in current style.', context.outer);
        }
        const summary = entries.slice(0, limit).map(([id, source], index) => {
          const type = typeof source.type === 'string' ? source.type : 'unknown';
          return String(index + 1) + '. ' + id + ' (type: ' + type + ')';
        }).join('\n');
        return success(
          'Loaded sources (' + entries.length + ' total):\n' + summary,
          context.outer,
          { sources: entries.slice(0, limit), total: entries.length },
        );
      },
    ),

    inspectLayerStyle: register(
      'Inspect one layer from the validated current Style document.',
      schemas.fullInspectLayerStyleInputSchema,
      ({ layerId }) => {
        const context = ready();
        if (!context.ok) return context.result;
        const layer = context.current.layers.find((item) => item.id === layerId);
        if (layer === undefined) return layerMissing(layerId, context.outer);
        return success(
          'Layer ' + layerId + ' details:\n' + JSON.stringify(layer, null, 2),
          context.outer,
          { layer },
        );
      },
    ),

    inspectSource: register(
      'Inspect one source from the validated current Style document.',
      schemas.fullInspectSourceInputSchema,
      ({ sourceId }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!Object.hasOwn(context.current.sources, sourceId)) {
          return sourceMissing(sourceId, context.outer);
        }
        const source = context.current.sources[sourceId]!;
        return success(
          'Source ' + sourceId + ' details:\n' + JSON.stringify(source, null, 2),
          context.outer,
          { sourceId, source },
        );
      },
    ),

    setLayerPaintProperty: register(
      'Set one paint property through one validated Style transaction.',
      schemas.fullSetLayerPaintPropertyInputSchema,
      async ({ layerId, property, valueJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        const parsed = parseJsonOrRawString(valueJson, 'valueJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'setLayerProperties', layerId, paint: { [property]: parsed.value },
        }], 'Updated paint property: ' + layerId + '.' + property
          + ' = ' + JSON.stringify(parsed.value));
      },
    ),

    setLayerLayoutProperty: register(
      'Set one layout property through one validated Style transaction.',
      schemas.fullSetLayerLayoutPropertyInputSchema,
      async ({ layerId, property, valueJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        const parsed = parseJsonOrRawString(valueJson, 'valueJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'setLayerProperties', layerId, layout: { [property]: parsed.value },
        }], 'Updated layout property: ' + layerId + '.' + property
          + ' = ' + JSON.stringify(parsed.value));
      },
    ),

    setLayerPaintPropertySmart: register(
      'Set one paint property with completed-Style validation.',
      schemas.fullSetLayerPaintPropertySmartInputSchema,
      async ({ layerId, property, valueJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        const parsed = parseJsonOrRawString(valueJson, 'valueJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'setLayerProperties', layerId, paint: { [property]: parsed.value },
        }], 'Updated paint property (smart): ' + layerId + '.' + property
          + ' = ' + JSON.stringify(parsed.value));
      },
    ),

    setLayerLayoutPropertySmart: register(
      'Set one layout property with completed-Style validation.',
      schemas.fullSetLayerLayoutPropertySmartInputSchema,
      async ({ layerId, property, valueJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        const parsed = parseJsonOrRawString(valueJson, 'valueJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'setLayerProperties', layerId, layout: { [property]: parsed.value },
        }], 'Updated layout property (smart): ' + layerId + '.' + property
          + ' = ' + JSON.stringify(parsed.value));
      },
    ),

    batchSetLayerPaintPropertiesSmart: register(
      'Atomically set multiple paint properties with completed-Style validation.',
      schemas.fullBatchSetLayerPaintPropertiesSmartInputSchema,
      async ({ layerId, propertiesJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        const parsed = parsedObject(propertiesJson, 'propertiesJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        const count = Object.keys(parsed.value).length;
        if (count === 0) return legacyFailure('propertiesJson is empty.', context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'setLayerProperties', layerId, paint: parsed.value,
        }], 'Updated ' + count + ' paint properties for layer "' + layerId + '" (smart).');
      },
    ),

    batchSetLayerLayoutPropertiesSmart: register(
      'Atomically set multiple layout properties with completed-Style validation.',
      schemas.fullBatchSetLayerLayoutPropertiesSmartInputSchema,
      async ({ layerId, propertiesJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        const parsed = parsedObject(propertiesJson, 'propertiesJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        const count = Object.keys(parsed.value).length;
        if (count === 0) return legacyFailure('propertiesJson is empty.', context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'setLayerProperties', layerId, layout: parsed.value,
        }], 'Updated ' + count + ' layout properties for layer "' + layerId + '" (smart).');
      },
    ),

    batchSetLayerPaintProperties: register(
      'Atomically set multiple paint properties.',
      schemas.fullBatchSetLayerPaintPropertiesInputSchema,
      async ({ layerId, propertiesJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        const parsed = parsedObject(propertiesJson, 'propertiesJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        const count = Object.keys(parsed.value).length;
        if (count === 0) return legacyFailure('propertiesJson is empty.', context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'setLayerProperties', layerId, paint: parsed.value,
        }], 'Updated ' + count + ' paint properties for layer "' + layerId + '".');
      },
    ),

    batchSetLayerLayoutProperties: register(
      'Atomically set multiple layout properties.',
      schemas.fullBatchSetLayerLayoutPropertiesInputSchema,
      async ({ layerId, propertiesJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        const parsed = parsedObject(propertiesJson, 'propertiesJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        const count = Object.keys(parsed.value).length;
        if (count === 0) return legacyFailure('propertiesJson is empty.', context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'setLayerProperties', layerId, layout: parsed.value,
        }], 'Updated ' + count + ' layout properties for layer "' + layerId + '".');
      },
    ),

    clearLayerPaintProperty: register(
      'Clear one paint property through a null property patch.',
      schemas.fullClearLayerPaintPropertyInputSchema,
      async ({ layerId, property }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'setLayerProperties', layerId, paint: { [property]: null },
        }], 'Cleared paint property: ' + layerId + '.' + property);
      },
    ),

    clearLayerLayoutProperty: register(
      'Clear one layout property through a null property patch.',
      schemas.fullClearLayerLayoutPropertyInputSchema,
      async ({ layerId, property }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'setLayerProperties', layerId, layout: { [property]: null },
        }], 'Cleared layout property: ' + layerId + '.' + property);
      },
    ),

    setLayerFilter: register(
      'Replace or clear a layer filter through one validated transaction.',
      schemas.fullSetLayerFilterInputSchema,
      async ({ layerId, filterJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        const parsed = parseStrictJson(filterJson, 'filterJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        if (parsed.value !== null && !Array.isArray(parsed.value)) {
          return legacyFailure(
            'filterJson must be a JSON array expression or null.',
            context.outer,
          );
        }
        const operation: StyleOperation = parsed.value === null
          ? { op: 'setLayerFilter', layerId, mode: 'clear' }
          : { op: 'setLayerFilter', layerId, mode: 'replace', filter: parsed.value };
        return applyOperations(
          context.map,
          context.outer,
          [operation],
          'Updated filter: ' + layerId + '.filter = ' + JSON.stringify(parsed.value),
        );
      },
    ),

    setLayerZoomRange: register(
      'Set layer minzoom and maxzoom through one transaction.',
      schemas.fullSetLayerZoomRangeInputSchema,
      async ({ layerId, minzoom, maxzoom }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        if (minzoom > maxzoom) {
          return legacyFailure(
            'minzoom must be less than or equal to maxzoom.',
            context.outer,
          );
        }
        return applyOperations(context.map, context.outer, [{
          op: 'setLayerProperties', layerId, minzoom, maxzoom,
        }], 'Updated zoom range: ' + layerId + ' minzoom=' + minzoom
          + ', maxzoom=' + maxzoom);
      },
    ),

    setLayerVisibility: register(
      'Set layer visibility through one layout transaction.',
      schemas.fullSetLayerVisibilityInputSchema,
      async ({ layerId, visibility }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'setLayerProperties', layerId, layout: { visibility },
        }], 'Layer ' + layerId + ' visibility set to ' + visibility + '.');
      },
    ),

    addLayer: register(
      'Add one full raw layer definition through the compatibility operation.',
      schemas.fullAddLayerInputSchema,
      async ({ layerJson, beforeId }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (beforeId !== undefined && !hasLayer(context.current, beforeId)) {
          return layerMissing(beforeId, context.outer);
        }
        const parsed = parsedObject(layerJson, 'layerJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        const rawId = parsed.value.id;
        if (typeof rawId !== 'string' || rawId.length === 0) {
          return legacyFailure('layerJson.id must be a non-empty string.', context.outer);
        }
        if (hasLayer(context.current, rawId)) {
          return legacyFailure(
            'Layer "' + rawId + '" already exists.',
            context.outer,
            'CONFLICT',
          );
        }
        return applyOperations(context.map, context.outer, [{
          op: 'addLayerDefinition', layer: parsed.value,
          ...(beforeId === undefined ? {} : { beforeId }),
        }], 'Added layer "' + rawId + '"'
          + (beforeId === undefined ? '.' : ' before "' + beforeId + '".'));
      },
    ),

    moveLayer: register(
      'Move one layer through the core moveLayer transaction.',
      schemas.fullMoveLayerInputSchema,
      async ({ layerId, beforeId }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        if (beforeId !== undefined && !hasLayer(context.current, beforeId)) {
          return layerMissing(beforeId, context.outer);
        }
        if (beforeId === layerId) {
          return legacyFailure('beforeId cannot be the same as layerId.', context.outer);
        }
        return applyOperations(context.map, context.outer, [{
          op: 'moveLayer', layerId,
          ...(beforeId === undefined ? {} : { beforeId }),
        }], 'Moved layer "' + layerId + '"'
          + (beforeId === undefined ? ' to top.' : ' before "' + beforeId + '".'));
      },
    ),

    removeLayer: register(
      'Remove one layer through the core removeLayer transaction.',
      schemas.fullRemoveLayerInputSchema,
      async ({ layerId }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'removeLayer', layerId,
        }], 'Removed layer "' + layerId + '".');
      },
    ),

    patchLayerDefinition: register(
      'Legacy deep-merge a raw layer definition while retaining null values.',
      schemas.fullPatchLayerDefinitionInputSchema,
      async ({ layerId, patchJson, diff }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        const parsed = parsedObject(patchJson, 'patchJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'deepMergeLayerDefinition', layerId, patch: parsed.value,
        }], 'Patched layer definition "' + layerId + '" (diff=' + diff + ').', diff);
      },
    ),

    replaceLayerDefinition: register(
      'Replace a raw layer definition atomically.',
      schemas.fullReplaceLayerDefinitionInputSchema,
      async ({ layerId, layerJson, diff }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!hasLayer(context.current, layerId)) return layerMissing(layerId, context.outer);
        const parsed = parsedObject(layerJson, 'layerJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'replaceLayerDefinition', layerId, layer: parsed.value,
        }], 'Replaced layer definition "' + layerId + '" (diff=' + diff + ').', diff);
      },
    ),

    addSource: register(
      'Add one source through the core addSource transaction.',
      schemas.fullAddSourceInputSchema,
      async ({ sourceId, sourceJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (Object.hasOwn(context.current.sources, sourceId)) {
          return legacyFailure(
            'Source "' + sourceId + '" already exists.',
            context.outer,
            'CONFLICT',
          );
        }
        const parsed = parsedObject(sourceJson, 'sourceJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'addSource', sourceId, source: parsed.value,
        }], 'Added source "' + sourceId + '".');
      },
    ),

    removeSource: register(
      'Remove one source through the core removeSource transaction.',
      schemas.fullRemoveSourceInputSchema,
      async ({ sourceId }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!Object.hasOwn(context.current.sources, sourceId)) {
          return sourceMissing(sourceId, context.outer);
        }
        return applyOperations(context.map, context.outer, [{
          op: 'removeSource', sourceId,
        }], 'Removed source "' + sourceId + '".');
      },
    ),

    updateGeoJsonSourceData: register(
      'Use a core document transaction for setData or a strict runtime diff command for updateData.',
      schemas.fullUpdateGeoJsonSourceDataInputSchema,
      async ({ sourceId, dataJson, method }) => {
        const parsed = method === 'updateData'
          ? parseStrictJson(dataJson, 'dataJson')
          : parseJsonOrRawString(dataJson, 'dataJson');
        if (!parsed.ok) return failure(parsed.error, state());
        if (method === 'updateData') {
          const context = runtimeReady();
          if (!context.ok) return context.result;
          if (typeof parsed.value !== 'object' || parsed.value === null
            || Array.isArray(parsed.value)) {
            return legacyFailure(
              'dataJson must be a strict GeoJSON source diff object for updateData.',
              context.outer,
            );
          }
          return runRuntime(
            context.outer,
            createMapRuntimeCommands(context.map, { imageLoader })
              .updateGeoJsonDataRuntime({ sourceId, diff: parsed.value as never }),
            'Updated GeoJSON source "' + sourceId + '" via updateData.',
          );
        }
        const context = ready();
        if (!context.ok) return context.result;
        if (!Object.hasOwn(context.current.sources, sourceId)) {
          return sourceMissing(sourceId, context.outer);
        }
        return applyOperations(context.map, context.outer, [{
          op: 'setGeoJsonData', sourceId, data: parsed.value as never,
        }], 'Updated GeoJSON source "' + sourceId + '" via setData.');
      },
    ),

    setGeoJsonClusterOptions: register(
      'Patch GeoJSON clustering options through the native core patchSource operation.',
      schemas.fullSetGeoJsonClusterOptionsInputSchema,
      async ({ sourceId, optionsJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!Object.hasOwn(context.current.sources, sourceId)) {
          return sourceMissing(sourceId, context.outer);
        }
        const parsed = parsedObject(optionsJson, 'optionsJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'patchSource', sourceId, patch: parsed.value,
        }], 'Updated cluster options for source "' + sourceId + '".');
      },
    ),

    setSourceTileLodParams: register(
      'Set source tile LOD parameters through the runtime command boundary.',
      schemas.fullSetSourceTileLodParamsInputSchema,
      async (input) => {
        const context = runtimeReady();
        if (!context.ok) return context.result;
        return runRuntime(
          context.outer,
          createMapRuntimeCommands(context.map, { imageLoader })
            .setSourceTileLodParams(input),
          'Updated source tile LOD params.',
        );
      },
    ),

    patchSourceDefinition: register(
      'Legacy deep-merge a raw source definition while retaining null values.',
      schemas.fullPatchSourceDefinitionInputSchema,
      async ({ sourceId, patchJson, diff }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!Object.hasOwn(context.current.sources, sourceId)) {
          return sourceMissing(sourceId, context.outer);
        }
        const parsed = parsedObject(patchJson, 'patchJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'deepMergeSourceDefinition', sourceId, patch: parsed.value,
        }], 'Patched source definition "' + sourceId + '" (diff=' + diff + ').', diff);
      },
    ),

    replaceSourceDefinition: register(
      'Replace a raw source definition atomically.',
      schemas.fullReplaceSourceDefinitionInputSchema,
      async ({ sourceId, sourceJson, diff }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (!Object.hasOwn(context.current.sources, sourceId)) {
          return sourceMissing(sourceId, context.outer);
        }
        const parsed = parsedObject(sourceJson, 'sourceJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'replaceSourceDefinition', sourceId, source: parsed.value,
        }], 'Replaced source definition "' + sourceId + '" (diff=' + diff + ').', diff);
      },
    ),

    setStyleJsonOrUrl: register(
      'Apply a strict full Style document or raw Style URL through the completion-aware adapter.',
      schemas.fullSetStyleJsonOrUrlInputSchema,
      async ({ styleJsonOrUrl, diff }) => {
        const outer = state();
        const map = getMap();
        if (map === null) {
          return failure(createStyleToolError('MAP_NOT_READY', MAP_NOT_READY_MESSAGE), outer);
        }
        const parsed = parseJsonOrRawString(styleJsonOrUrl, 'styleJsonOrUrl');
        if (!parsed.ok) return failure(parsed.error, outer);
        const nextStyle = typeof parsed.value === 'string'
          ? parsed.value.trim()
          : parsed.value;
        if (typeof nextStyle === 'string' && nextStyle.length === 0) {
          return legacyFailure('styleJsonOrUrl cannot be empty.', outer);
        }
        if (typeof nextStyle !== 'string') {
          if (typeof nextStyle !== 'object' || nextStyle === null
            || Array.isArray(nextStyle)) {
            return legacyFailure(
              'styleJsonOrUrl must be a URL string or full JSON style object.',
              outer,
            );
          }
          const validation = validateStyleDocument(nextStyle);
          if (!validation.ok) {
            return failure(
              validation.errors[0]
                ?? createStyleToolError('STYLE_INVALID', 'MapLibre style validation failed.'),
              outer,
            );
          }
        }
        const result = await applyStyleDocumentOrUrlToMap(
          map,
          nextStyle as StyleDocument | string,
          { diff },
        );
        const data = mapTransactionData(result);
        return result.ok
          ? success(
              'Style update requested via '
                + (typeof nextStyle === 'string' ? 'URL' : 'JSON object')
                + ' (diff=' + diff + ').',
              outer,
              data,
            )
          : failure(result.error, outer, data);
      },
    ),

    inspectRootStyle: register(
      'Inspect bounded root-level fields from the validated Style document.',
      schemas.fullInspectRootStyleInputSchema,
      () => {
        const context = ready();
        if (!context.ok) return context.result;
        const root: Record<string, unknown> = {};
        for (const key of [
          'name', 'metadata', 'transition', 'center', 'zoom', 'bearing', 'pitch',
          'roll', 'centerAltitude', 'sprite', 'glyphs', 'projection', 'terrain',
          'light', 'sky', 'state',
        ]) {
          if (Object.hasOwn(context.current, key)) root[key] = context.current[key];
        }
        root.layerCount = context.current.layers.length;
        root.sourceCount = Object.keys(context.current.sources).length;
        return success(
          'Root style summary:\n' + JSON.stringify(root, null, 2),
          context.outer,
          root,
        );
      },
    ),

    setStyleName: register(
      'Set the root Style name through setStyleRootProperties.',
      schemas.fullSetStyleNameInputSchema,
      async ({ name, diff }) => {
        const context = ready();
        if (!context.ok) return context.result;
        return applyOperations(context.map, context.outer, [{
          op: 'setStyleRootProperties', properties: { name },
        }], 'Updated style name to "' + name + '" (diff=' + diff + ').', diff);
      },
    ),

    setStyleMetadata: register(
      'Replace or clear the complete root metadata value.',
      schemas.fullSetStyleMetadataInputSchema,
      async ({ metadataJson, diff }) => {
        const context = ready();
        if (!context.ok) return context.result;
        const parsed = parsedObjectOrNull(metadataJson, 'metadataJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'replaceRootProperty', property: 'metadata', value: parsed.value,
        }], (parsed.value === null ? 'Cleared' : 'Updated')
          + ' style metadata (diff=' + diff + ').', diff);
      },
    ),

    setStyleTransition: register(
      'Replace or clear the complete root transition value.',
      schemas.fullSetStyleTransitionInputSchema,
      async ({ transitionJson, diff }) => {
        const context = ready();
        if (!context.ok) return context.result;
        const parsed = parsedObjectOrNull(transitionJson, 'transitionJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'replaceRootProperty', property: 'transition', value: parsed.value,
        }], (parsed.value === null ? 'Cleared' : 'Updated')
          + ' style transition (diff=' + diff + ').', diff);
      },
    ),

    setStyleCameraDefaults: register(
      'Set supplied root camera defaults through setStyleRootProperties.',
      schemas.fullSetStyleCameraDefaultsInputSchema,
      async ({ centerJson, zoom, bearing, pitch, roll, centerAltitude, diff }) => {
        const context = ready();
        if (!context.ok) return context.result;
        if (centerJson === undefined && zoom === undefined && bearing === undefined
          && pitch === undefined && roll === undefined && centerAltitude === undefined) {
          return legacyFailure('At least one camera field must be provided.', context.outer);
        }
        const properties: JsonObject = {};
        if (centerJson !== undefined) {
          const parsed = parseStrictJson(centerJson, 'centerJson');
          if (!parsed.ok) return failure(parsed.error, context.outer);
          if (!Array.isArray(parsed.value) || parsed.value.length !== 2
            || !parsed.value.every((value) => typeof value === 'number')) {
            return legacyFailure(
              'centerJson must be a JSON array [lng, lat].',
              context.outer,
            );
          }
          properties.center = parsed.value;
        }
        for (const [key, value] of Object.entries({
          zoom, bearing, pitch, roll, centerAltitude,
        })) {
          if (value !== undefined) properties[key] = value;
        }
        return applyOperations(context.map, context.outer, [{
          op: 'setStyleRootProperties', properties,
        }], 'Updated style camera defaults (diff=' + diff + ').', diff);
      },
    ),

    validateStyleJson: register(
      'Validate a complete strict JSON Style document without applying it.',
      schemas.fullValidateStyleJsonInputSchema,
      ({ styleJson }) => {
        const outer = state();
        const parsed = parsedObject(styleJson, 'styleJson');
        if (!parsed.ok) return failure(parsed.error, outer);
        const validation = validateStyleDocument(parsed.value);
        if (validation.ok) {
          return success('Style JSON validation passed (0 errors).', outer, {
            warnings: validation.warnings,
          });
        }
        const message = 'Style JSON validation failed ('
          + validation.errors.length + ' errors):\n'
          + validation.errors.slice(0, 20).map(
            (error, index) => String(index + 1) + '. '
              + (error.path || '<root>') + ': ' + error.message,
          ).join('\n');
        return failure(
          validation.errors[0]
            ?? createStyleToolError('STYLE_INVALID', message),
          outer,
          { errors: validation.errors, warnings: validation.warnings },
        );
      },
    ),

    validateCurrentMapStyle: register(
      'Validate the current Map Style snapshot.',
      schemas.fullValidateCurrentMapStyleInputSchema,
      () => {
        const context = ready();
        if (!context.ok) return context.result;
        const validation = validateStyleDocument(context.current);
        return validation.ok
          ? success(
              'Current map style validation passed (0 errors).',
              context.outer,
              { warnings: validation.warnings },
            )
          : failure(
              validation.errors[0]
                ?? createStyleToolError('STYLE_INVALID', 'Style validation failed.'),
              context.outer,
              { errors: validation.errors, warnings: validation.warnings },
            );
      },
    ),

    setMapLight: register(
      'Shallow-patch root light one top-level key at a time.',
      schemas.fullSetMapLightInputSchema,
      async ({ lightJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        const parsed = parsedObject(lightJson, 'lightJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'shallowPatchRootProperty', property: 'light', patch: parsed.value,
        }], 'Updated map light specification.');
      },
    ),

    setMapSky: register(
      'Replace or clear the complete root sky value.',
      schemas.fullSetMapSkyInputSchema,
      async ({ skyJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        const parsed = parsedObjectOrNull(skyJson, 'skyJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'replaceRootProperty', property: 'sky', value: parsed.value,
        }], parsed.value === null
          ? 'Cleared map sky specification.'
          : 'Updated map sky specification.');
      },
    ),

    setMapProjection: register(
      'Replace or clear the complete root projection value.',
      schemas.fullSetMapProjectionInputSchema,
      async ({ projectionJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        const parsed = parsedObject(projectionJson, 'projectionJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'replaceRootProperty', property: 'projection', value: parsed.value,
        }], 'Updated map projection specification.');
      },
    ),

    setMapTerrain: register(
      'Replace or clear the complete root terrain value.',
      schemas.fullSetMapTerrainInputSchema,
      async ({ terrainJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        const parsed = parsedObjectOrNull(terrainJson, 'terrainJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return applyOperations(context.map, context.outer, [{
          op: 'replaceRootProperty', property: 'terrain', value: parsed.value,
        }], parsed.value === null ? 'Terrain disabled.' : 'Updated map terrain specification.');
      },
    ),

    setMapGlyphs: register(
      'Set or unset the root glyphs URL through setStyleRootProperties.',
      schemas.fullSetMapGlyphsInputSchema,
      async ({ glyphsUrlJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        const parsed = parseStrictJson(glyphsUrlJson, 'glyphsUrlJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        if (parsed.value !== null && typeof parsed.value !== 'string') {
          return legacyFailure(
            'glyphsUrlJson must be a JSON string or null.',
            context.outer,
          );
        }
        return applyOperations(context.map, context.outer, [{
          op: 'setStyleRootProperties', properties: { glyphs: parsed.value },
        }], parsed.value === null
          ? 'Glyphs unset.'
          : 'Updated glyphs URL to "' + parsed.value + '".');
      },
    ),

    setMapSprite: register(
      'Set or unset the document-representable root sprite URL.',
      schemas.fullSetMapSpriteInputSchema,
      async ({ spriteUrlJson }) => {
        const context = ready();
        if (!context.ok) return context.result;
        const parsed = parseStrictJson(spriteUrlJson, 'spriteUrlJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        if (parsed.value !== null && typeof parsed.value !== 'string') {
          return legacyFailure(
            'spriteUrlJson must be a JSON string or null.',
            context.outer,
          );
        }
        return applyOperations(context.map, context.outer, [{
          op: 'setStyleRootProperties', properties: { sprite: parsed.value },
        }], parsed.value === null
          ? 'Sprite unset.'
          : 'Updated sprite URL to "' + parsed.value + '".');
      },
    ),

    listSprites: register(
      'List bounded runtime sprite definitions.',
      schemas.fullListSpritesInputSchema,
      async () => {
        const context = runtimeReady();
        if (!context.ok) return context.result;
        const result = createMapRuntimeCommands(
          context.map,
          { imageLoader },
        ).listSprites({});
        if (!result.ok) return failure(result.error, context.outer);
        const items = result.data.items;
        if (items.length === 0) {
          return legacyFailure(
            'No sprites configured in current style.',
            context.outer,
            'NOT_FOUND',
          );
        }
        const summary = items.map((sprite, index) => (
          String(index + 1) + '. ' + String(sprite.id) + ': ' + String(sprite.url)
        )).join('\n');
        return success(
          'Configured sprites (' + result.data.returned + '):\n' + summary,
          context.outer,
          result.data,
        );
      },
    ),

    addSprite: register(
      'Add or replace a sprite through the runtime command boundary.',
      schemas.fullAddSpriteInputSchema,
      async (input) => {
        const context = runtimeReady();
        if (!context.ok) return context.result;
        return runRuntime(
          context.outer,
          createMapRuntimeCommands(context.map, { imageLoader }).addSprite(input),
          'Updated sprite "' + input.spriteId + '" -> ' + input.url,
        );
      },
    ),

    removeSprite: register(
      'Remove a sprite through the runtime command boundary.',
      schemas.fullRemoveSpriteInputSchema,
      async (input) => {
        const context = runtimeReady();
        if (!context.ok) return context.result;
        return runRuntime(
          context.outer,
          createMapRuntimeCommands(context.map, { imageLoader }).removeSprite(input),
          'Removed sprite "' + input.spriteId + '".',
        );
      },
    ),

    setFeatureState: register(
      'Set feature state through the runtime command boundary.',
      schemas.fullSetFeatureStateInputSchema,
      async ({ targetJson, stateJson }) => {
        const context = runtimeReady();
        if (!context.ok) return context.result;
        const target = parsedObject(targetJson, 'targetJson');
        if (!target.ok) return failure(target.error, context.outer);
        const featureState = parsedObject(stateJson, 'stateJson');
        if (!featureState.ok) return failure(featureState.error, context.outer);
        return runRuntime(
          context.outer,
          createMapRuntimeCommands(context.map, { imageLoader }).setFeatureState({
            target: target.value as never,
            state: featureState.value,
          }),
          'Updated feature-state.',
        );
      },
    ),

    removeFeatureState: register(
      'Remove feature state through the runtime command boundary.',
      schemas.fullRemoveFeatureStateInputSchema,
      async ({ targetJson, key }) => {
        const context = runtimeReady();
        if (!context.ok) return context.result;
        const target = parsedObject(targetJson, 'targetJson');
        if (!target.ok) return failure(target.error, context.outer);
        return runRuntime(
          context.outer,
          createMapRuntimeCommands(context.map, { imageLoader }).removeFeatureState({
            target: target.value as never,
            ...(key === undefined ? {} : { key }),
          }),
          key === undefined
            ? 'Removed feature-state object.'
            : 'Removed feature-state key "' + key + '".',
        );
      },
    ),

    setGlobalStateProperty: register(
      'Set global state through the runtime command boundary.',
      schemas.fullSetGlobalStatePropertyInputSchema,
      async ({ propertyName, valueJson }) => {
        const context = runtimeReady();
        if (!context.ok) return context.result;
        const parsed = parseStrictJson(valueJson, 'valueJson');
        if (!parsed.ok) return failure(parsed.error, context.outer);
        return runRuntime(
          context.outer,
          createMapRuntimeCommands(context.map, { imageLoader }).setGlobalState({
            propertyName,
            value: parsed.value,
          }),
          'Updated global state: ' + propertyName + ' = ' + JSON.stringify(parsed.value),
        );
      },
    ),

    listImages: register(
      'List bounded runtime image IDs.',
      schemas.fullListImagesInputSchema,
      async ({ limit }) => {
        const context = runtimeReady();
        if (!context.ok) return context.result;
        const result = createMapRuntimeCommands(
          context.map,
          { imageLoader },
        ).listImages({ limit });
        if (!result.ok) return failure(result.error, context.outer);
        if (result.data.items.length === 0) {
          return legacyFailure('No style images found.', context.outer, 'NOT_FOUND');
        }
        const summary = result.data.items.map(
          (id, index) => String(index + 1) + '. ' + id,
        ).join('\n');
        return success(
          'Loaded style images (' + result.data.returned + ' total):\n' + summary,
          context.outer,
          result.data,
        );
      },
    ),

    addImageFromUrl: register(
      'Load and add an image through the injected runtime image loader.',
      schemas.fullAddImageFromUrlInputSchema,
      async (input) => {
        const context = runtimeReady();
        if (!context.ok) return context.result;
        return runRuntime(
          context.outer,
          createMapRuntimeCommands(context.map, { imageLoader }).addImageFromUrl(input),
          'Added or updated image "' + input.imageId + '" from URL.',
        );
      },
    ),

    removeImage: register(
      'Remove an image through the runtime command boundary.',
      schemas.fullRemoveImageInputSchema,
      async (input) => {
        const context = runtimeReady();
        if (!context.ok) return context.result;
        return runRuntime(
          context.outer,
          createMapRuntimeCommands(context.map, { imageLoader }).removeImage(input),
          'Removed image "' + input.imageId + '".',
        );
      },
    ),

    getLayerCount: register(
      'Return the layer count from core context discovery.',
      schemas.fullGetLayerCountInputSchema,
      () => {
        const context = ready();
        if (!context.ok) return context.result;
        const discovered = buildStyleContext(context.current, { layerLimit: 1 });
        return success(
          'Current loaded layer count: ' + discovered.layerCount,
          context.outer,
          { layerCount: discovered.layerCount },
        );
      },
    ),
  };

  const compact = createCompactMapLibreStyleTools({
    getMap,
    getState,
    getContext,
  });
  const structuredTools = {
    analyzeGeoJson: compact.analyzeGeoJson,
    listSourceLayers: compact.listSourceLayers,
    duplicateLayer: compact.duplicateLayer,
    addLayerFromSource: compact.addLayerFromSource,
    addGeoJsonLayer: compact.addGeoJsonLayer,
    applyStyleTransaction: compact.applyStyleTransaction,
  };

  const queryTools = {
    querySourceFeatures: register(
      'Query source features with package-enforced count and byte bounds.',
      schemas.fullQuerySourceFeaturesInputSchema,
      (input) => {
        const context = runtimeReady();
        if (!context.ok) return context.result;
        const result = querySourceFeaturesBounded(context.map, input);
        return result.ok
          ? success(
              'Returned ' + result.returned + ' bounded source features.',
              context.outer,
              result,
            )
          : failure(
              result.error
                ?? createStyleToolError('INTERNAL', 'Source feature query failed.'),
              context.outer,
              result,
            );
      },
    ),
    queryRenderedFeatures: register(
      'Query rendered features with package-enforced count and byte bounds.',
      schemas.fullQueryRenderedFeaturesInputSchema,
      (input) => {
        const context = runtimeReady();
        if (!context.ok) return context.result;
        const result = queryRenderedFeaturesBounded(context.map, input);
        return result.ok
          ? success(
              'Returned ' + result.returned + ' bounded rendered features.',
              context.outer,
              result,
            )
          : failure(
              result.error
                ?? createStyleToolError('INTERNAL', 'Rendered feature query failed.'),
              context.outer,
              result,
            );
      },
    ),
  };

  return {
    ...legacyTools,
    ...structuredTools,
    ...queryTools,
  };
};
