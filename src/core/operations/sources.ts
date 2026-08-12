import { jsonValuesEqual } from '../diff.js';
import { createStyleToolError } from '../errors.js';
import { validateInlineGeoJson } from '../geojson.js';
import type {
  JsonObject,
  JsonValue,
  OperationApplyResult,
  OperationContext,
  SourceOperation,
  StyleDocument,
  StyleSource,
  StyleToolError,
} from '../types.js';
import { applyMergePatch } from './shared.js';

const DANGEROUS_SOURCE_IDS = new Set(['__proto__', 'prototype', 'constructor']);

function notFound(sourceId: string): OperationApplyResult {
  return {
    ok: false,
    error: createStyleToolError(
      'NOT_FOUND',
      `Source "${sourceId}" was not found.`,
      '/sourceId',
      { sourceId },
    ),
  };
}

function collision(sourceId: string, path: '/sourceId' | '/newSourceId'): OperationApplyResult {
  return {
    ok: false,
    error: createStyleToolError(
      'CONFLICT',
      `Source "${sourceId}" already exists.`,
      path,
      { sourceId },
    ),
  };
}

function invalidSourceId(sourceId: string, path: '/sourceId' | '/newSourceId'):
  OperationApplyResult | undefined {
  return DANGEROUS_SOURCE_IDS.has(sourceId)
    ? {
        ok: false,
        error: createStyleToolError(
          'INVALID_INPUT',
          `Source ID "${sourceId}" is not a safe JSON object key.`,
          path,
          { sourceId },
        ),
      }
    : undefined;
}

function defineSource(
  sources: StyleDocument['sources'],
  sourceId: string,
  source: StyleSource,
): void {
  Reflect.defineProperty(sources, sourceId, {
    configurable: true,
    enumerable: true,
    value: source,
    writable: true,
  });
}

function cloneAndPatchSource(source: StyleSource, patch: JsonObject): StyleSource {
  return applyMergePatch(source, patch) as StyleSource;
}

function addSource(
  style: StyleDocument,
  operation: Extract<SourceOperation, { op: 'addSource' }>,
  context: OperationContext,
): OperationApplyResult {
  const invalid = invalidSourceId(operation.sourceId, '/sourceId');
  if (invalid !== undefined) return invalid;
  if (Object.hasOwn(style.sources, operation.sourceId)) {
    return collision(operation.sourceId, '/sourceId');
  }
  defineSource(style.sources, operation.sourceId, operation.source as StyleSource);
  context.changedSourceIds.add(operation.sourceId);
  return { ok: true, changed: true };
}

function duplicateSource(
  style: StyleDocument,
  operation: Extract<SourceOperation, { op: 'duplicateSource' }>,
  context: OperationContext,
): OperationApplyResult {
  if (!Object.hasOwn(style.sources, operation.sourceId)) return notFound(operation.sourceId);
  const invalid = invalidSourceId(operation.newSourceId, '/newSourceId');
  if (invalid !== undefined) return invalid;
  if (Object.hasOwn(style.sources, operation.newSourceId)) {
    return collision(operation.newSourceId, '/newSourceId');
  }
  const duplicate = cloneAndPatchSource(
    style.sources[operation.sourceId]!,
    operation.overrides ?? {},
  );
  defineSource(style.sources, operation.newSourceId, duplicate);
  context.changedSourceIds.add(operation.newSourceId);
  return { ok: true, changed: true };
}

function renameSource(
  style: StyleDocument,
  operation: Extract<SourceOperation, { op: 'renameSource' }>,
  context: OperationContext,
): OperationApplyResult {
  if (!Object.hasOwn(style.sources, operation.sourceId)) return notFound(operation.sourceId);
  const invalid = invalidSourceId(operation.newSourceId, '/newSourceId');
  if (invalid !== undefined) return invalid;
  if (Object.hasOwn(style.sources, operation.newSourceId)) {
    return collision(operation.newSourceId, '/newSourceId');
  }

  defineSource(style.sources, operation.newSourceId, style.sources[operation.sourceId]!);
  Reflect.deleteProperty(style.sources, operation.sourceId);
  const rewrittenLayerIds: string[] = [];
  for (const layer of style.layers) {
    if (layer.source !== operation.sourceId) continue;
    layer.source = operation.newSourceId;
    rewrittenLayerIds.push(layer.id);
  }
  context.changedSourceIds.add(operation.sourceId);
  context.changedSourceIds.add(operation.newSourceId);
  for (const layerId of rewrittenLayerIds) context.changedLayerIds.add(layerId);
  return { ok: true, changed: true };
}

function removeSource(
  style: StyleDocument,
  operation: Extract<SourceOperation, { op: 'removeSource' }>,
  context: OperationContext,
): OperationApplyResult {
  if (!Object.hasOwn(style.sources, operation.sourceId)) return notFound(operation.sourceId);
  const dependentIndexes: number[] = [];
  for (let index = 0; index < style.layers.length; index += 1) {
    if (style.layers[index]!.source === operation.sourceId) dependentIndexes.push(index);
  }
  if (dependentIndexes.length > 0 && operation.cascadeLayers !== true) {
    return {
      ok: false,
      error: createStyleToolError(
        'DEPENDENCY_CONFLICT',
        `Source "${operation.sourceId}" is referenced by one or more layers.`,
        '/sourceId',
        {
          sourceId: operation.sourceId,
          dependentLayerIds: dependentIndexes.map((index) => style.layers[index]!.id),
        },
      ),
    };
  }

  const removedLayerIds: string[] = [];
  for (let offset = dependentIndexes.length - 1; offset >= 0; offset -= 1) {
    const index = dependentIndexes[offset]!;
    const [removed] = style.layers.splice(index, 1);
    if (removed !== undefined) removedLayerIds.push(removed.id);
  }
  Reflect.deleteProperty(style.sources, operation.sourceId);
  for (const layerId of removedLayerIds) context.changedLayerIds.add(layerId);
  context.changedSourceIds.add(operation.sourceId);
  return { ok: true, changed: true };
}

function patchSource(
  style: StyleDocument,
  operation: Extract<SourceOperation, { op: 'patchSource' }>,
  context: OperationContext,
): OperationApplyResult {
  if (!Object.hasOwn(style.sources, operation.sourceId)) return notFound(operation.sourceId);
  const source = style.sources[operation.sourceId]!;
  const patched = cloneAndPatchSource(source, operation.patch);
  const changed = !jsonValuesEqual(source, patched);
  if (!changed) return { ok: true, changed: false };
  defineSource(style.sources, operation.sourceId, patched);
  context.changedSourceIds.add(operation.sourceId);
  return { ok: true, changed: true };
}

function geoJsonDataError(error: StyleToolError): OperationApplyResult {
  const nestedPath = error.path;
  const path = nestedPath === undefined || nestedPath === ''
    ? '/data'
    : `/data${nestedPath}`;
  return {
    ok: false,
    error: createStyleToolError(
      error.code,
      error.message,
      path,
      error.details,
    ),
  };
}

function setGeoJsonData(
  style: StyleDocument,
  operation: Extract<SourceOperation, { op: 'setGeoJsonData' }>,
  context: OperationContext,
): OperationApplyResult {
  if (!Object.hasOwn(style.sources, operation.sourceId)) return notFound(operation.sourceId);
  const source = style.sources[operation.sourceId]!;
  if (source.type !== 'geojson') {
    return {
      ok: false,
      error: createStyleToolError(
        'UNSUPPORTED_SOURCE',
        `Source "${operation.sourceId}" is not a GeoJSON source.`,
        '/sourceId',
        {
          sourceId: operation.sourceId,
          sourceType: typeof source.type === 'string' ? source.type : 'unknown',
        },
      ),
    };
  }

  let data: JsonValue;
  if (typeof operation.data === 'string') {
    data = operation.data;
  } else {
    const validated = validateInlineGeoJson(operation.data, {
      maxBytes: context.limits.maxStyleBytes,
    });
    if (!validated.ok) return geoJsonDataError(validated.error);
    data = validated.value;
  }

  const changed = !Object.hasOwn(source, 'data')
    || !jsonValuesEqual(source.data!, data);
  if (!changed) return { ok: true, changed: false };
  Reflect.defineProperty(source, 'data', {
    configurable: true,
    enumerable: true,
    value: data,
    writable: true,
  });
  context.changedSourceIds.add(operation.sourceId);
  return { ok: true, changed: true };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled source operation: ${JSON.stringify(value)}`);
}

export function applySourceOperation(
  style: StyleDocument,
  operation: SourceOperation,
  context: OperationContext,
): OperationApplyResult {
  switch (operation.op) {
    case 'addSource':
      return addSource(style, operation, context);
    case 'duplicateSource':
      return duplicateSource(style, operation, context);
    case 'renameSource':
      return renameSource(style, operation, context);
    case 'removeSource':
      return removeSource(style, operation, context);
    case 'patchSource':
      return patchSource(style, operation, context);
    case 'setGeoJsonData':
      return setGeoJsonData(style, operation, context);
    default:
      return assertNever(operation);
  }
}
