import { jsonValuesEqual } from '../diff.js';
import { createStyleToolError } from '../errors.js';
import { applyStyleTransaction } from '../transaction.js';
import type {
  CompatibilityStyleOperation,
  JsonObject,
  JsonValue,
  OperationApplyResult,
  OperationContext,
  StyleDocument,
  StyleLayer,
  StyleSource,
  StyleTransactionOptions,
  StyleTransactionResult,
} from '../types.js';
import { cloneStrictJsonValue } from './shared.js';

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defineValue(target: JsonObject, key: string, value: JsonValue): void {
  Reflect.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/** Legacy deep merge: recurse through objects and retain null as a value. */
function deepMergeDefinition(base: JsonValue, patch: JsonObject): JsonObject {
  const result = isJsonObject(base) ? cloneStrictJsonValue(base) : {};
  const safePatch = cloneStrictJsonValue(patch);
  const work: Array<{ target: JsonObject; patch: JsonObject }> = [{
    target: result,
    patch: safePatch,
  }];
  while (work.length > 0) {
    const frame = work.pop()!;
    for (const key of Object.keys(frame.patch)) {
      const patchValue = frame.patch[key]!;
      const current = Object.hasOwn(frame.target, key) ? frame.target[key]! : null;
      if (isJsonObject(patchValue) && isJsonObject(current)) {
        const nested = cloneStrictJsonValue(current);
        defineValue(frame.target, key, nested);
        work.push({ target: nested, patch: patchValue });
      } else if (isJsonObject(patchValue)) {
        const nested: JsonObject = {};
        defineValue(frame.target, key, nested);
        work.push({ target: nested, patch: patchValue });
      } else {
        defineValue(frame.target, key, patchValue);
      }
    }
  }
  return result;
}

function notFound(kind: 'Layer' | 'Source', id: string): OperationApplyResult {
  return {
    ok: false,
    error: createStyleToolError(
      'NOT_FOUND', `${kind} "${id}" was not found.`,
      kind === 'Layer' ? '/layerId' : '/sourceId',
      kind === 'Layer' ? { layerId: id } : { sourceId: id },
    ),
  };
}

function layerCollision(layerId: string): OperationApplyResult {
  return {
    ok: false,
    error: createStyleToolError(
      'CONFLICT', `Layer "${layerId}" already exists.`, '/layer/id', { layerId },
    ),
  };
}

function invalidLayerId(path: '/layer/id' | '/patch/id'): OperationApplyResult {
  return {
    ok: false,
    error: createStyleToolError(
      'INVALID_INPUT', 'Completed layer id must be a non-empty string.', path,
    ),
  };
}

function defineSource(
  sources: StyleDocument['sources'], sourceId: string, source: StyleSource,
): void {
  Reflect.defineProperty(sources, sourceId, {
    configurable: true,
    enumerable: true,
    value: source,
    writable: true,
  });
}

function applyLayerDefinition(
  style: StyleDocument,
  operation: Extract<CompatibilityStyleOperation, {
    op: 'addLayerDefinition' | 'deepMergeLayerDefinition' | 'replaceLayerDefinition';
  }>,
  context: OperationContext,
): OperationApplyResult {
  if (operation.op === 'addLayerDefinition') {
    const layer = cloneStrictJsonValue(operation.layer) as StyleLayer;
    if (typeof layer.id !== 'string' || layer.id.length === 0) {
      return invalidLayerId('/layer/id');
    }
    if (style.layers.some((existing) => existing.id === layer.id)) {
      return layerCollision(layer.id);
    }
    let index = style.layers.length;
    if (operation.beforeId !== undefined) {
      index = style.layers.findIndex((layer) => layer.id === operation.beforeId);
      if (index === -1) return notFound('Layer', operation.beforeId);
    }
    style.layers.splice(index, 0, layer);
    context.changedLayerIds.add(layer.id);
    return { ok: true, changed: true };
  }

  const index = style.layers.findIndex((layer) => layer.id === operation.layerId);
  if (index === -1) return notFound('Layer', operation.layerId);
  const previous = style.layers[index]!;
  const candidate = operation.op === 'deepMergeLayerDefinition'
    ? deepMergeDefinition(previous, operation.patch) as StyleLayer
    : cloneStrictJsonValue(operation.layer) as StyleLayer;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    return invalidLayerId(operation.op === 'deepMergeLayerDefinition'
      ? '/patch/id' : '/layer/id');
  }
  if (candidate.id !== operation.layerId
    && style.layers.some((layer, layerIndex) => (
      layerIndex !== index && layer.id === candidate.id
    ))) return layerCollision(candidate.id);
  if (jsonValuesEqual(previous, candidate)) return { ok: true, changed: false };
  style.layers.splice(index, 1, candidate);
  context.changedLayerIds.add(operation.layerId);
  context.changedLayerIds.add(candidate.id);
  return { ok: true, changed: true };
}

export function applyCompatibilityStyleOperation(
  style: StyleDocument,
  operation: CompatibilityStyleOperation,
  context: OperationContext,
): OperationApplyResult {
  switch (operation.op) {
    case 'addLayerDefinition':
    case 'deepMergeLayerDefinition':
    case 'replaceLayerDefinition':
      return applyLayerDefinition(style, operation, context);
    case 'deepMergeSourceDefinition': {
      if (!Object.hasOwn(style.sources, operation.sourceId)) {
        return notFound('Source', operation.sourceId);
      }
      const previous = style.sources[operation.sourceId]!;
      const candidate = deepMergeDefinition(previous, operation.patch) as StyleSource;
      if (jsonValuesEqual(previous, candidate)) return { ok: true, changed: false };
      defineSource(style.sources, operation.sourceId, candidate);
      context.changedSourceIds.add(operation.sourceId);
      return { ok: true, changed: true };
    }
    case 'replaceSourceDefinition': {
      if (!Object.hasOwn(style.sources, operation.sourceId)) {
        return notFound('Source', operation.sourceId);
      }
      const previous = style.sources[operation.sourceId]!;
      const candidate = cloneStrictJsonValue(operation.source) as StyleSource;
      if (jsonValuesEqual(previous, candidate)) return { ok: true, changed: false };
      defineSource(style.sources, operation.sourceId, candidate);
      context.changedSourceIds.add(operation.sourceId);
      return { ok: true, changed: true };
    }
    case 'replaceRootProperty': {
      const hadValue = Object.hasOwn(style, operation.property);
      if (operation.value === null) {
        if (!hadValue) return { ok: true, changed: false };
        Reflect.deleteProperty(style, operation.property);
        return { ok: true, changed: true };
      }
      const candidate = cloneStrictJsonValue(operation.value);
      if (hadValue && jsonValuesEqual(style[operation.property]!, candidate)) {
        return { ok: true, changed: false };
      }
      defineValue(style, operation.property, candidate);
      return { ok: true, changed: true };
    }
    case 'shallowPatchRootProperty': {
      const rawLight = Object.hasOwn(style, 'light') ? style.light! : {};
      const next: JsonObject = isJsonObject(rawLight)
        ? cloneStrictJsonValue(rawLight)
        : {};
      for (const key of Object.keys(operation.patch)) {
        const value = operation.patch[key]!;
        if (value === null) Reflect.deleteProperty(next, key);
        else defineValue(next, key, cloneStrictJsonValue(value));
      }
      if (Object.hasOwn(style, 'light') && jsonValuesEqual(style.light!, next)) {
        return { ok: true, changed: false };
      }
      defineValue(style, 'light', next);
      return { ok: true, changed: true };
    }
  }
}

export function applyValidatedCompatibilityEdit(
  style: StyleDocument,
  operation: CompatibilityStyleOperation,
  options: StyleTransactionOptions = {},
): StyleTransactionResult {
  return applyStyleTransaction(style, { operations: [operation] }, options);
}
