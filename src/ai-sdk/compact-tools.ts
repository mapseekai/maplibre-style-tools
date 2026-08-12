import { tool } from 'ai';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { z } from 'zod';
import {
  DEFAULT_MAX_OPERATIONS,
  analyzeGeoJson,
  applyStyleTransaction,
  buildStyleContext,
  createStyleToolError,
  listSourceLayers,
  searchLayers,
  validateStyleDocument,
} from '../core/index.js';
import type {
  AddGeoJsonLayerOperation,
  AddLayerFromSourceOperation,
  DuplicateLayerOperation,
  JsonObject,
  JsonValue,
  LayerSummary,
  StyleDiffEntry,
  StyleDocument,
  StyleToolError,
  StyleTransaction,
  StyleTransactionResult,
} from '../core/index.js';
import { applyTransactionToMap } from '../adapters/maplibre/index.js';
import type { MapStyleApplyResult } from '../adapters/maplibre/index.js';
import { normalizeLegacyOperations, parseStrictJson } from './compatibility.js';
import type { ParseResult } from './compatibility.js';
import { toAiToolResult } from './result.js';
import {
  compactAddGeoJsonLayerInputSchema,
  compactAddLayerFromSourceInputSchema,
  compactAnalyzeGeoJsonInputSchema,
  compactApplyStyleTransactionInputSchema,
  compactDuplicateLayerInputSchema,
  compactListSourceLayersInputSchema,
  legacyOperationsTextSchema,
} from './schemas.js';
export { COMPACT_LEGACY_TOOL_NAMES } from './tool-contracts.js';

export type CompactMapAccessor = () => MapLibreMap | null;

export interface CompactToolContext {
  activeSourceId?: string | null;
  selectedLayerId?: string | null;
}

export interface CreateCompactMapLibreStyleToolsOptions<TStyle = unknown> {
  getMap: CompactMapAccessor;
  getContext?: () => CompactToolContext;
  getState?: () => TStyle;
}

type ApplicationState<TStyle> = { style?: TStyle };

const MAP_NOT_READY_MESSAGE =
  'Map is not ready yet. Please wait until the preview loads, then retry.';

function applicationState<TStyle>(getState?: () => TStyle): ApplicationState<TStyle> {
  if (getState === undefined) return {};
  return { style: getState() };
}

function mapReadyError<TStyle>(state: ApplicationState<TStyle>) {
  return toAiToolResult({
    success: false,
    message: MAP_NOT_READY_MESSAGE,
    error: createStyleToolError('MAP_NOT_READY', MAP_NOT_READY_MESSAGE),
    ...state,
  });
}

function failure<TStyle>(
  error: StyleToolError,
  state: ApplicationState<TStyle>,
  data?: unknown,
) {
  return toAiToolResult({
    success: false,
    message: error.message,
    error,
    ...(data === undefined ? {} : { data }),
    ...state,
  });
}

function readStyle(map: MapLibreMap):
  | { ok: true; style: StyleDocument }
  | { ok: false; error: StyleToolError } {
  let rawStyle: unknown;
  try {
    rawStyle = map.getStyle();
  } catch {
    return {
      ok: false,
      error: createStyleToolError('MAP_NOT_READY', 'Current map style is unavailable.'),
    };
  }
  const validation = validateStyleDocument(rawStyle);
  return validation.ok
    ? { ok: true, style: validation.style }
    : {
        ok: false,
        error: validation.errors[0]
          ?? createStyleToolError('STYLE_INVALID', 'Current map style is unavailable.'),
      };
}

function normalizeCompactLegacyOperations(raw: string): ParseResult<StyleTransaction> {
  const normalized = normalizeLegacyOperations(raw);
  if (normalized.ok) return normalized;
  const parsed = parseStrictJson(raw, 'operationsJson');
  if (!parsed.ok || !Array.isArray(parsed.value)
    || parsed.value.length > DEFAULT_MAX_OPERATIONS) return normalized;
  const operations: StyleTransaction['operations'] = [];
  for (const operation of parsed.value) {
    const item = normalizeLegacyOperations(JSON.stringify([operation]));
    if (!item.ok) return item;
    operations.push(...item.value.operations);
  }
  return { ok: true, value: { operations, validate: true } };
}

function hasMapLifecycle(map: MapLibreMap): boolean {
  return typeof map.on === 'function'
    && typeof map.off === 'function'
    && typeof map.isStyleLoaded === 'function';
}

function legacyLifecycleMap(map: MapLibreMap): MapLibreMap {
  if (hasMapLifecycle(map)) return map;
  let currentStyle = map.getStyle();
  let loaded = true;
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const emit = (type: string): void => {
    for (const listener of [...(listeners.get(type) ?? [])]) listener({ type });
  };
  return {
    getStyle: () => currentStyle,
    isStyleLoaded: () => loaded,
    on: (type: string, listener: (event: unknown) => void) => {
      let registered = listeners.get(type);
      if (registered === undefined) {
        registered = new Set();
        listeners.set(type, registered);
      }
      registered.add(listener);
      return { unsubscribe: () => { registered!.delete(listener); } };
    },
    off: (type: string, listener: (event: unknown) => void) => {
      listeners.get(type)?.delete(listener);
      return map;
    },
    setStyle: (style: unknown, options?: unknown) => {
      loaded = false;
      map.setStyle(style as never, options as never);
      currentStyle = style as typeof currentStyle;
      queueMicrotask(() => {
        loaded = true;
        emit('style.load');
      });
      return map;
    },
  } as unknown as MapLibreMap;
}

function inspectLayer(
  style: StyleDocument,
  layerId: string,
  fields: Array<'paint' | 'layout' | 'filter' | 'zoom'>,
): Record<string, unknown> | null {
  const layer = style.layers.find((item) => item.id === layerId);
  if (layer === undefined) return null;
  const summary: Record<string, unknown> = {
    id: layer.id,
    type: layer.type,
    source: layer.source,
    sourceLayer: layer['source-layer'],
  };
  if (fields.includes('paint')) summary.paint = layer.paint ?? {};
  if (fields.includes('layout')) summary.layout = layer.layout ?? {};
  if (fields.includes('filter')) summary.filter = layer.filter;
  if (fields.includes('zoom')) {
    summary.minzoom = layer.minzoom;
    summary.maxzoom = layer.maxzoom;
  }
  return summary;
}

const summarizeLayerIds = (layers: LayerSummary[]) =>
  layers.map((layer) => layer.id).join(', ') || '<none>';

function decodePointer(pointer: string): string[] {
  return pointer.slice(1).split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toLegacyDiffEntry(entry: StyleDiffEntry): Array<Record<string, unknown>> {
  if (entry.target.kind !== 'layer') return [];
  const layerId = entry.target.id;
  const tokens = decodePointer(entry.path);
  const section = tokens[2];
  if ((section === 'paint' || section === 'layout') && tokens.length === 3) {
    const before = isJsonObject(entry.before) ? entry.before : {};
    const after = isJsonObject(entry.after) ? entry.after : {};
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.filter((key) => !Object.is(before[key], after[key])).map((key) => ({
      path: `layers.${layerId}.${section}.${key}`,
      before: before[key],
      after: after[key],
    }));
  }
  if (
    (section === 'paint' || section === 'layout' || section === 'filter'
      || section === 'minzoom' || section === 'maxzoom')
    && tokens.length >= 3
  ) {
    const suffix = tokens.slice(2).join('.');
    return [{
      path: `layers.${layerId}.${suffix}`,
      before: entry.before,
      after: entry.after,
    }];
  }
  return [];
}

function legacyDiffSummary(diff: StyleDiffEntry[]): Array<Record<string, unknown>> {
  return diff.flatMap(toLegacyDiffEntry);
}

function transactionData(result: StyleTransactionResult, dryRun: boolean): JsonObject {
  return {
    dryRun,
    changedLayers: result.changedLayers,
    changedSources: result.changedSources,
    diff: result.diff,
    warnings: result.warnings,
  };
}

function mapTransactionData(result: MapStyleApplyResult, dryRun = false): JsonObject {
  const data: JsonObject = {
    dryRun,
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

function structuredMessage(result: StyleTransactionResult, dryRun: boolean): string {
  if (!result.ok) return result.error.message;
  if (dryRun) return 'Style transaction validated.';
  return result.diff.length === 0
    ? 'Style transaction completed without changes.'
    : 'Style transaction applied.';
}

function mapStructuredMessage(result: MapStyleApplyResult): string {
  if (!result.ok) return result.error.message;
  return result.applied
    ? 'Style transaction applied.'
    : 'Style transaction completed without changes.';
}

export const createCompactMapLibreStyleTools = <TStyle = unknown>({
  getMap,
  getContext,
  getState,
}: CreateCompactMapLibreStyleToolsOptions<TStyle>) => {
  const state = () => applicationState(getState);

  const runStructuredTransaction = async (
    transaction: StyleTransaction,
    dryRun: boolean,
    diff: boolean,
  ) => {
    const outer = state();
    const map = getMap();
    if (map === null) return mapReadyError(outer);
    if (dryRun) {
      const current = readStyle(map);
      if (!current.ok) return failure(current.error, outer);
      const result = applyStyleTransaction(current.style, transaction);
      const data = transactionData(result, true);
      return result.ok
        ? toAiToolResult({ success: true, message: structuredMessage(result, true), data, ...outer })
        : failure(result.error, outer, data);
    }
    const result = await applyTransactionToMap(map, transaction, { diff });
    const data = mapTransactionData(result);
    return result.ok
      ? toAiToolResult({ success: true, message: mapStructuredMessage(result), data, ...outer })
      : failure(result.error, outer, data);
  };

  return {
    getStyleContext: tool({
      description:
        'Return a compact summary of the current MapLibre style: layer counts, source counts, layer type counts, active source, selected layer, and layer summaries. Does not return full style JSON.',
      inputSchema: z.object({
        layerLimit: z.number().min(1).max(300).default(120),
      }),
      execute: ({ layerLimit }) => {
        const outer = state();
        const map = getMap();
        if (map === null) return mapReadyError(outer);
        const current = readStyle(map);
        if (!current.ok) return failure(current.error, outer);
        const context = buildStyleContext(current.style, {
          ...getContext?.(), layerLimit,
        });
        return toAiToolResult({
          success: true,
          message: `Current style has ${context.layerCount} layers and ${context.sourceCount} sources.`,
          data: context,
          ...outer,
        });
      },
    }),

    searchLayers: tool({
      description:
        'Search current style layers by text, type, source, or source-layer. Use this before edits when the target layer id is ambiguous.',
      inputSchema: z.object({
        query: z.string().optional(),
        type: z.string().optional(),
        source: z.string().optional(),
        sourceLayer: z.string().optional(),
        limit: z.number().min(1).max(300).default(80),
      }),
      execute: (input) => {
        const outer = state();
        const map = getMap();
        if (map === null) return mapReadyError(outer);
        const current = readStyle(map);
        if (!current.ok) return failure(current.error, outer);
        const result = searchLayers(current.style, input);
        return toAiToolResult({
          success: true,
          message: `Found ${result.total} matching layer${result.total === 1 ? '' : 's'}: ${summarizeLayerIds(result.layers)}`,
          data: result,
          ...outer,
        });
      },
    }),

    inspectLayersCompact: tool({
      description:
        'Inspect selected layers and return only requested fields. Prefer this over inspecting full style JSON.',
      inputSchema: z.object({
        layerIdsJson: z.string().describe('JSON array of layer ids.'),
        fields: z.array(z.enum(['paint', 'layout', 'filter', 'zoom']))
          .default(['paint', 'layout']),
      }),
      execute: ({ layerIdsJson, fields }) => {
        const outer = state();
        const map = getMap();
        if (map === null) return mapReadyError(outer);
        const current = readStyle(map);
        if (!current.ok) return failure(current.error, outer);
        const parsed = parseStrictJson(layerIdsJson, 'layerIdsJson');
        if (!parsed.ok) return failure(parsed.error, outer);
        if (!Array.isArray(parsed.value)
          || !parsed.value.every((value) => typeof value === 'string')) {
          return failure(createStyleToolError(
            'INVALID_INPUT', 'layerIdsJson must be a JSON array of strings.',
          ), outer);
        }
        const inspected = parsed.value.map((layerId) =>
          inspectLayer(current.style, layerId as string, fields));
        const missing = parsed.value.filter((_, index) => inspected[index] === null);
        if (missing.length > 0) {
          return failure(createStyleToolError(
            'NOT_FOUND', `Layers not found: ${missing.join(', ')}`,
          ), outer);
        }
        return toAiToolResult({
          success: true,
          message: `Inspected ${inspected.length} layer${inspected.length === 1 ? '' : 's'}.`,
          data: { layers: inspected },
          ...outer,
        });
      },
    }),

    applyStyleOperations: tool({
      description:
        'Apply validated style operations to one or more layers and return changed layer ids plus compact diff summary. operationsJson is a JSON array of { layerId, paint, layout, filter, minzoom, maxzoom }.',
      inputSchema: z.object({
        operationsJson: legacyOperationsTextSchema,
        dryRun: z.boolean().default(false),
        diff: z.boolean().default(true),
      }),
      execute: async ({ operationsJson, dryRun, diff }) => {
        const outer = state();
        const map = getMap();
        if (map === null) return mapReadyError(outer);
        const parsed = normalizeCompactLegacyOperations(operationsJson);
        if (!parsed.ok) return failure(parsed.error, outer);
        if (parsed.value.operations.length === 0) {
          const current = readStyle(map);
          if (!current.ok) return failure(current.error, outer);
          return toAiToolResult({
            success: true,
            message: dryRun ? 'Style operations validated.' : 'Applied 0 style operations.',
            data: { dryRun, changedLayers: [], diffSummary: [] },
            ...outer,
          });
        }

        const operationCount = (JSON.parse(operationsJson) as unknown[]).length;
        if (dryRun) {
          const current = readStyle(map);
          if (!current.ok) return failure(current.error, outer);
          const result = applyStyleTransaction(current.style, parsed.value, {
            maxOperations: parsed.value.operations.length,
          });
          const data: Record<string, unknown> = {
            changedLayers: result.changedLayers,
            diffSummary: legacyDiffSummary(result.diff),
          };
          return result.ok
            ? toAiToolResult({
                success: true,
                message: 'Style operations validated.',
                data: { dryRun: true, ...data },
                ...outer,
              })
            : failure(result.error, outer, data);
        }

        let lifecycleMap: MapLibreMap;
        try {
          lifecycleMap = legacyLifecycleMap(map);
        } catch {
          return failure(createStyleToolError(
            'MAP_NOT_READY', 'Current map style is unavailable.',
          ), outer);
        }
        const result = await applyTransactionToMap(lifecycleMap, parsed.value, {
          diff, maxOperations: parsed.value.operations.length,
        });
        const data: Record<string, unknown> = {
          changedLayers: result.changedLayers,
          diffSummary: legacyDiffSummary(result.diff),
          styleAuthority: result.styleAuthority,
        };
        if (result.styleAuthority === 'current') data.style = result.style;
        if (result.styleAuthority === 'pre-operation') {
          data.style = result.style;
          data.baselineOnly = true;
        }
        return result.ok
          ? toAiToolResult({
              success: true,
              message: `Applied ${operationCount} style operation${operationCount === 1 ? '' : 's'}.`,
              data: { dryRun: false, ...data },
              ...outer,
            })
          : failure(result.error, outer, data);
      },
    }),

    validateStylePatchJson: tool({
      description:
        'Validate that a JSON object can be parsed for future style patches. This is a lightweight syntax guard and does not apply changes.',
      inputSchema: z.object({ patchJson: z.string() }),
      execute: ({ patchJson }) => {
        const outer = state();
        const parsed = parseStrictJson(patchJson, 'patchJson');
        if (!parsed.ok) return failure(parsed.error, outer);
        if (!isJsonObject(parsed.value)) {
          return failure(createStyleToolError(
            'INVALID_INPUT', 'patchJson must be a JSON object.',
          ), outer);
        }
        return toAiToolResult({
          success: true,
          message: 'Patch JSON is valid.',
          data: { keys: Object.keys(parsed.value) },
          ...outer,
        });
      },
    }),

    analyzeGeoJson: tool({
      description:
        'Analyze inline GeoJSON or identify remote GeoJSON without fetching it. Returns bounded geometry and property summaries.',
      inputSchema: compactAnalyzeGeoJsonInputSchema,
      execute: ({ data, options }) => {
        const outer = state();
        const result = analyzeGeoJson(data, options);
        return result.ok
          ? toAiToolResult({
              success: true, message: 'GeoJSON analysis completed.', data: result.analysis, ...outer,
            })
          : failure(result.error, outer);
      },
    }),

    listSourceLayers: tool({
      description:
        'List source-layer names referenced by current style layers, optionally for one exact source id.',
      inputSchema: compactListSourceLayersInputSchema,
      execute: (input) => {
        const outer = state();
        const map = getMap();
        if (map === null) return mapReadyError(outer);
        const current = readStyle(map);
        if (!current.ok) return failure(current.error, outer);
        const sourceLayers = listSourceLayers(current.style, input);
        return toAiToolResult({
          success: true,
          message: `Found ${sourceLayers.length} referenced source layer${sourceLayers.length === 1 ? '' : 's'}.`,
          data: { sourceLayers },
          ...outer,
        });
      },
    }),

    duplicateLayer: tool({
      description: 'Duplicate an existing layer with a new id and optional structured overrides.',
      inputSchema: compactDuplicateLayerInputSchema,
      execute: ({ dryRun, diff, ...input }) => runStructuredTransaction({
        operations: [{ op: 'duplicateLayer', ...input } satisfies DuplicateLayerOperation],
      }, dryRun, diff),
    }),

    addLayerFromSource: tool({
      description: 'Add a structured layer referencing an existing style source.',
      inputSchema: compactAddLayerFromSourceInputSchema,
      execute: ({ dryRun, diff, ...input }) => runStructuredTransaction({
        operations: [{ op: 'addLayerFromSource', ...input } satisfies AddLayerFromSourceOperation],
      }, dryRun, diff),
    }),

    addGeoJsonLayer: tool({
      description: 'Atomically add a GeoJSON source and a layer using an inline object or URL.',
      inputSchema: compactAddGeoJsonLayerInputSchema,
      execute: ({ dryRun, diff, ...input }) => runStructuredTransaction({
        operations: [{ op: 'addGeoJsonLayer', ...input } satisfies AddGeoJsonLayerOperation],
      }, dryRun, diff),
    }),

    applyStyleTransaction: tool({
      description:
        'Apply one strict structured style transaction. diff controls only MapLibre application and never changes the semantic result diff.',
      inputSchema: compactApplyStyleTransactionInputSchema,
      execute: ({ transaction, dryRun, diff }) =>
        runStructuredTransaction(transaction, dryRun, diff),
    }),
  };
};
