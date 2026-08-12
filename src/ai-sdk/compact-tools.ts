import { tool } from 'ai';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
  analyzeGeoJson,
  applyStyleTransaction,
  buildStyleContext,
  canonicalizeJson,
  createStyleToolError,
  jsonUtf8ByteLength,
  listSourceLayers,
  searchLayers,
  validateStyleDocument,
} from '../core/index.js';
import type {
  AddGeoJsonLayerOperation,
  AddLayerFromSourceOperation,
  DuplicateLayerOperation,
  GeoJsonAnalysis,
  JsonObject,
  JsonValue,
  LayerSummary,
  OperationContext,
  SetLayerFilterOperation,
  SetLayerPropertiesOperation,
  SourceLayerUsage,
  StyleDiffEntry,
  StyleDocument,
  StyleToolError,
  StyleTransaction,
  StyleTransactionResult,
  StyleWarning,
} from '../core/index.js';
import { diffStyleDocuments } from '../core/diff.js';
import { applySetLayerFilter } from '../core/operations/filters.js';
import { applySetLayerProperties } from '../core/operations/layers.js';
import { applyTransactionToMap } from '../adapters/maplibre/index.js';
import type { MapStyleApplyResult } from '../adapters/maplibre/index.js';
import { normalizeLegacyOperations, parseStrictJson } from './compatibility.js';
import type { ParseResult } from './compatibility.js';
import { toAiToolResult } from './result.js';
import type {
  StyleDiffEntry as LegacyStyleDiffEntry,
  StyleOperation as LegacyStyleOperation,
} from '../types.js';
import {
  compactAddGeoJsonLayerInputSchema,
  compactAddLayerFromSourceInputSchema,
  compactAnalyzeGeoJsonInputSchema,
  compactApplyStyleOperationsInputSchema,
  compactApplyStyleTransactionInputSchema,
  compactDuplicateLayerInputSchema,
  compactGetStyleContextInputSchema,
  compactInspectLayersCompactInputSchema,
  compactListSourceLayersInputSchema,
  compactSearchLayersInputSchema,
  compactValidateStylePatchJsonInputSchema,
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
const COMPACT_OUTPUT_MAX_ITEMS = 100;
const COMPACT_OUTPUT_MAX_WARNINGS = 20;
const COMPACT_OUTPUT_MAX_BYTES = 1024 * 1024;
const COMPACT_TRUNCATION_WARNING: Readonly<StyleWarning> = Object.freeze({
  code: 'COMPACT_OUTPUT_TRUNCATED',
  message: 'Compact output was truncated to stay within response limits.',
});
const LEGACY_PRESENTATION_LIMITS = Object.freeze({
  maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
  maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
  maxOperations: DEFAULT_MAX_OPERATIONS,
});

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

type NormalizedCompactLegacyOperations = {
  transaction: StyleTransaction;
  operations: LegacyStyleOperation[];
};

function normalizeCompactLegacyOperations(
  raw: string,
): ParseResult<NormalizedCompactLegacyOperations> {
  const parsed = parseStrictJson(raw, 'operationsJson');
  if (!parsed.ok) return parsed;
  const normalized = normalizeLegacyOperations(raw);
  if (normalized.ok) {
    return {
      ok: true,
      value: {
        transaction: normalized.value,
        operations: parsed.value as unknown as LegacyStyleOperation[],
      },
    };
  }
  if (!parsed.ok || !Array.isArray(parsed.value)
    || parsed.value.length > DEFAULT_MAX_OPERATIONS) return normalized;
  const operations: StyleTransaction['operations'] = [];
  for (const operation of parsed.value) {
    const item = normalizeLegacyOperations(JSON.stringify([operation]));
    if (!item.ok) return item;
    operations.push(...item.value.operations);
  }
  return {
    ok: true,
    value: {
      transaction: { operations, validate: true },
      operations: parsed.value as unknown as LegacyStyleOperation[],
    },
  };
}

function hasMapLifecycle(map: MapLibreMap): boolean {
  return typeof map.on === 'function'
    && typeof map.off === 'function'
    && typeof map.isStyleLoaded === 'function';
}

function legacyLifecycleMap(map: MapLibreMap): MapLibreMap {
  if (hasMapLifecycle(map)) return map;
  let loaded = true;
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const emit = (type: string, error?: StyleToolError): void => {
    const event = error === undefined ? { type } : { type, error };
    for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
  };
  const wrapper = {
    getStyle: () => map.getStyle(),
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
      return wrapper;
    },
    setStyle: (style: unknown, options?: unknown) => {
      loaded = false;
      const expected = validateStyleDocument(style);
      if (!expected.ok) {
        queueMicrotask(() => emit('error', expected.errors[0]
          ?? createStyleToolError('STYLE_INVALID', 'MapLibre style validation failed.')));
        return wrapper;
      }
      const expectedCanonical = canonicalizeJson(expected.style);
      map.setStyle(style as never, options as never);
      queueMicrotask(() => {
        const fresh = readStyle(map);
        if (fresh.ok && canonicalizeJson(fresh.style) === expectedCanonical) {
          loaded = true;
          emit('style.load');
          return;
        }
        emit('error', fresh.ok
          ? createStyleToolError(
              'INTERNAL', 'Map style application could not be verified.',
            )
          : fresh.error);
      });
      return wrapper;
    },
  } as unknown as MapLibreMap;
  return wrapper;
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

function orderLegacyDiffSummary(
  operation: LegacyStyleOperation,
  diff: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const remaining = new Map(diff.map((entry) => [entry.path, entry]));
  const ordered: Array<Record<string, unknown>> = [];
  for (const section of ['paint', 'layout'] as const) {
    for (const property of Object.keys(operation[section] ?? {})) {
      const path = `layers.${operation.layerId}.${section}.${property}`;
      const entry = remaining.get(path);
      if (entry !== undefined) {
        ordered.push(entry);
        remaining.delete(path);
      }
    }
  }
  if (Object.hasOwn(operation, 'filter')) {
    const path = `layers.${operation.layerId}.filter`;
    const entry = remaining.get(path);
    if (entry !== undefined) {
      ordered.push(entry);
      remaining.delete(path);
    }
  }
  for (const property of ['minzoom', 'maxzoom'] as const) {
    if (operation[property] === undefined) continue;
    const path = `layers.${operation.layerId}.${property}`;
    const entry = remaining.get(path);
    if (entry !== undefined) {
      ordered.push(entry);
      remaining.delete(path);
    }
  }
  ordered.push(...remaining.values());
  return ordered;
}

function legacyPresentationContext(layerId: string): OperationContext {
  return {
    limits: LEGACY_PRESENTATION_LIMITS,
    changedLayerIds: new Set([layerId]),
    changedSourceIds: new Set(),
    warnings: [],
  };
}

function legacyCoreOperations(
  operation: LegacyStyleOperation,
): Array<SetLayerPropertiesOperation | SetLayerFilterOperation> {
  const normalized: Array<SetLayerPropertiesOperation | SetLayerFilterOperation> = [];
  if (
    operation.paint !== undefined
    || operation.layout !== undefined
    || operation.minzoom !== undefined
    || operation.maxzoom !== undefined
    || !Object.hasOwn(operation, 'filter')
  ) {
    normalized.push({
      op: 'setLayerProperties',
      layerId: operation.layerId,
      ...(operation.paint === undefined ? {} : { paint: operation.paint as never }),
      ...(operation.layout === undefined ? {} : { layout: operation.layout as never }),
      ...(operation.minzoom === undefined ? {} : { minzoom: operation.minzoom }),
      ...(operation.maxzoom === undefined ? {} : { maxzoom: operation.maxzoom }),
    });
  }
  if (Object.hasOwn(operation, 'filter')) {
    normalized.push(operation.filter === null
      ? { op: 'setLayerFilter', layerId: operation.layerId, mode: 'clear' }
      : {
          op: 'setLayerFilter',
          layerId: operation.layerId,
          mode: 'replace',
          filter: operation.filter as JsonValue[],
        });
  }
  return normalized;
}

function reconstructLegacyPresentation(
  original: StyleDocument,
  operations: LegacyStyleOperation[],
): { changedLayers: string[]; diffSummary: LegacyStyleDiffEntry[] } {
  const working = structuredClone(original);
  const changedLayers: string[] = [];
  const changedLayerSet = new Set<string>();
  const diffSummary: LegacyStyleDiffEntry[] = [];

  for (const operation of operations) {
    const before = structuredClone(working);
    const context = legacyPresentationContext(operation.layerId);
    let applied = true;
    for (const normalized of legacyCoreOperations(operation)) {
      const result = normalized.op === 'setLayerProperties'
        ? applySetLayerProperties(working, normalized, context)
        : applySetLayerFilter(working, normalized, context);
      if (!result.ok) {
        applied = false;
        break;
      }
    }
    if (!applied) continue;
    const operationDiff = orderLegacyDiffSummary(
      operation,
      legacyDiffSummary(diffStyleDocuments(before, working, context)),
    ) as unknown as LegacyStyleDiffEntry[];
    if (operationDiff.length > 0 && !changedLayerSet.has(operation.layerId)) {
      changedLayerSet.add(operation.layerId);
      changedLayers.push(operation.layerId);
    }
    diffSummary.push(...operationDiff);
  }
  return { changedLayers, diffSummary };
}

function legacyPropertyValidationMessage(
  style: StyleDocument,
  normalizedMessage: string,
): string | undefined {
  const match = /^layers\[(\d+)\]\.(paint|layout)\./.exec(normalizedMessage);
  if (match === null) return undefined;
  const layerIndex = Number(match[1]);
  const mode = match[2];
  const pathPrefix = match[0];
  const unknownPropertyMarker = ': unknown property "';
  let property: string | undefined;
  if (normalizedMessage.endsWith('"')) {
    let markerIndex = normalizedMessage.indexOf(unknownPropertyMarker, pathPrefix.length);
    while (markerIndex >= 0) {
      const pathProperty = normalizedMessage.slice(pathPrefix.length, markerIndex);
      const detailProperty = normalizedMessage.slice(
        markerIndex + unknownPropertyMarker.length,
        -1,
      );
      if (pathProperty === detailProperty) {
        property = detailProperty;
        break;
      }
      markerIndex = normalizedMessage.indexOf(unknownPropertyMarker, markerIndex + 1);
    }
  }
  if (property === undefined) {
    const detailIndex = normalizedMessage.indexOf(': ', pathPrefix.length);
    if (detailIndex < 0) return undefined;
    property = normalizedMessage.slice(pathPrefix.length, detailIndex);
  }
  const layer = style.layers[layerIndex];
  if (layer === undefined || (mode !== 'paint' && mode !== 'layout')) return undefined;
  return `Invalid ${mode} properties for ${layer.type} layer "${layer.id}": ${property}`;
}

function legacyFailureMessage(style: StyleDocument, error: StyleToolError): string {
  if (error.code === 'NOT_FOUND') {
    const layerId = error.details?.layerId;
    if (typeof layerId === 'string') return `Layer "${layerId}" not found.`;
  }
  if (error.code === 'STYLE_INVALID') {
    return legacyPropertyValidationMessage(style, error.message) ?? error.message;
  }
  return error.message;
}

type CompactProjectionItem<Item extends JsonValue> = {
  item: Item;
  truncated: boolean;
};

function compactProjectionBytes(
  base: JsonObject,
  key: string,
  itemsBytes: number,
  returned: number,
  truncated: boolean,
  warnings: StyleWarning[],
): number {
  const emptyEnvelope: JsonObject = {
    ...base,
    [key]: [],
    returned,
    truncated,
    warnings,
  };
  return jsonUtf8ByteLength(emptyEnvelope) - 2 + itemsBytes;
}

function compactArrayProjection<Item extends JsonValue>(
  base: JsonObject,
  key: string,
  sourceItems: readonly Item[],
  sourceWarnings: readonly StyleWarning[],
  project: (item: Item) => CompactProjectionItem<Item> = (item) => ({
    item,
    truncated: false,
  }),
): JsonObject {
  const acceptedWarnings: StyleWarning[] = [];
  for (let index = 0;
    index < sourceWarnings.length && index < COMPACT_OUTPUT_MAX_WARNINGS;
    index += 1) {
    const warning = sourceWarnings[index]!;
    const candidateWarnings = [...acceptedWarnings, warning, COMPACT_TRUNCATION_WARNING];
    if (compactProjectionBytes(base, key, 2, 0, true, candidateWarnings)
      > COMPACT_OUTPUT_MAX_BYTES) break;
    acceptedWarnings.push(warning);
  }
  const warningsTruncated = acceptedWarnings.length < sourceWarnings.length;
  const items: Item[] = [];
  let itemsBytes = 2;
  let nestedTruncated = false;
  const maximum = Math.min(sourceItems.length, COMPACT_OUTPUT_MAX_ITEMS);

  for (let index = 0; index < maximum; index += 1) {
    const projected = project(sourceItems[index]!);
    const itemBytes = jsonUtf8ByteLength(projected.item);
    const candidateItemsBytes = itemsBytes + (items.length === 0 ? 0 : 1) + itemBytes;
    const candidateReturned = items.length + 1;
    const candidateNestedTruncated: boolean = nestedTruncated || projected.truncated;
    const candidateTruncated = candidateReturned < sourceItems.length
      || warningsTruncated
      || candidateNestedTruncated;
    const warnings = candidateTruncated
      ? [...acceptedWarnings, COMPACT_TRUNCATION_WARNING]
      : acceptedWarnings;
    if (compactProjectionBytes(
      base,
      key,
      candidateItemsBytes,
      candidateReturned,
      candidateTruncated,
      warnings,
    ) > COMPACT_OUTPUT_MAX_BYTES) break;
    items.push(projected.item);
    itemsBytes = candidateItemsBytes;
    nestedTruncated = candidateNestedTruncated;
  }

  const truncated = items.length < sourceItems.length
    || warningsTruncated
    || nestedTruncated;
  return {
    ...base,
    [key]: items,
    returned: items.length,
    truncated,
    warnings: truncated
      ? [...acceptedWarnings, COMPACT_TRUNCATION_WARNING]
      : acceptedWarnings,
  };
}

function compactGeoJsonAnalysis(analysis: GeoJsonAnalysis): JsonObject {
  if (!analysis.available) {
    return compactArrayProjection(
      { available: false, reason: analysis.reason },
      'properties',
      [],
      analysis.warnings,
    );
  }
  const base: JsonObject = {
    available: true,
    featureCount: analysis.featureCount,
    geometryTypes: analysis.geometryTypes,
    ...(analysis.bbox === undefined ? {} : { bbox: analysis.bbox }),
  };
  return compactArrayProjection(
    base,
    'properties',
    analysis.properties as unknown as JsonValue[],
    analysis.warnings,
  );
}

function compactSourceLayerUsage(usage: SourceLayerUsage): CompactProjectionItem<JsonValue> {
  if (usage.layers.length <= COMPACT_OUTPUT_MAX_ITEMS) {
    return { item: usage as JsonValue, truncated: false };
  }
  return {
    item: {
      sourceId: usage.sourceId,
      sourceLayer: usage.sourceLayer,
      layers: usage.layers.slice(0, COMPACT_OUTPUT_MAX_ITEMS),
      returnedLayers: COMPACT_OUTPUT_MAX_ITEMS,
      truncatedLayers: true,
    },
    truncated: true,
  };
}

function compactSourceLayers(sourceLayers: SourceLayerUsage[]): JsonObject {
  return compactArrayProjection(
    {},
    'sourceLayers',
    sourceLayers as JsonValue[],
    [],
    (usage) => compactSourceLayerUsage(usage as unknown as SourceLayerUsage),
  );
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
      inputSchema: compactGetStyleContextInputSchema,
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
      inputSchema: compactSearchLayersInputSchema,
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
      inputSchema: compactInspectLayersCompactInputSchema,
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
      inputSchema: compactApplyStyleOperationsInputSchema,
      execute: async ({ operationsJson, dryRun, diff }) => {
        const outer = state();
        const map = getMap();
        if (map === null) return mapReadyError(outer);
        const parsed = normalizeCompactLegacyOperations(operationsJson);
        if (!parsed.ok) return failure(parsed.error, outer);
        if (parsed.value.transaction.operations.length === 0) {
          const current = readStyle(map);
          if (!current.ok) return failure(current.error, outer);
          return toAiToolResult({
            success: true,
            message: dryRun ? 'Style operations validated.' : 'Applied 0 style operations.',
            data: { dryRun, changedLayers: [], diffSummary: [] },
            ...outer,
          });
        }

        const operationCount = parsed.value.operations.length;
        const current = readStyle(map);
        if (!current.ok) return failure(current.error, outer);
        if (dryRun) {
          const result = applyStyleTransaction(current.style, parsed.value.transaction, {
            maxOperations: parsed.value.transaction.operations.length,
          });
          if (!result.ok) {
            const error = createStyleToolError(
              result.error.code,
              legacyFailureMessage(current.style, result.error),
              result.error.path,
              result.error.details,
            );
            return failure(error, outer, { changedLayers: [], diffSummary: [] });
          }
          const presentation = reconstructLegacyPresentation(
            current.style,
            parsed.value.operations,
          );
          return toAiToolResult({
            success: true,
            message: 'Style operations validated.',
            data: { dryRun: true, ...presentation },
            ...outer,
          });
        }

        let lifecycleMap: MapLibreMap;
        try {
          lifecycleMap = legacyLifecycleMap(map);
        } catch {
          return failure(createStyleToolError(
            'MAP_NOT_READY', 'Current map style is unavailable.',
          ), outer);
        }
        const result = await applyTransactionToMap(lifecycleMap, parsed.value.transaction, {
          diff, maxOperations: parsed.value.transaction.operations.length,
        });
        const presentation = result.ok
          ? reconstructLegacyPresentation(current.style, parsed.value.operations)
          : { changedLayers: [], diffSummary: [] };
        const data: Record<string, unknown> = {
          ...presentation,
          styleAuthority: result.styleAuthority,
        };
        if (result.styleAuthority === 'current') data.style = result.style;
        if (result.styleAuthority === 'pre-operation') {
          data.style = result.style;
          data.baselineOnly = true;
        }
        if (!result.ok) {
          const error = createStyleToolError(
            result.error.code,
            legacyFailureMessage(current.style, result.error),
            result.error.path,
            result.error.details,
          );
          return failure(error, outer, data);
        }
        return toAiToolResult({
          success: true,
          message: `Applied ${operationCount} style operation${operationCount === 1 ? '' : 's'}.`,
          data: { dryRun: false, ...data },
          ...outer,
        });
      },
    }),

    validateStylePatchJson: tool({
      description:
        'Validate that a JSON object can be parsed for future style patches. This is a lightweight syntax guard and does not apply changes.',
      inputSchema: compactValidateStylePatchJsonInputSchema,
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
              success: true,
              message: 'GeoJSON analysis completed.',
              data: compactGeoJsonAnalysis(result.analysis),
              ...outer,
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
          data: compactSourceLayers(sourceLayers),
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
