import type { JsonObject, JsonValue, Placement, StyleLayer } from '../types.js';
import { jsonValueSchema } from '../schemas.js';

const INVALID_MERGE_INPUT = 'JSON Merge Patch inputs must be strict JSON trees';

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strictJsonSnapshot(value: unknown): JsonValue {
  try {
    const result = jsonValueSchema.safeParse(value);
    if (result.success) return result.data;
  } catch {
    // Normalize every hostile input to the same public helper error.
  }
  throw new TypeError(INVALID_MERGE_INPUT);
}

function applySanitizedMergePatch(
  target: JsonValue,
  patch: JsonObject,
): JsonObject {
  const result = isJsonObject(target) ? target : {};
  for (const key of Object.keys(patch)) {
    const patchValue = patch[key]!;
    if (patchValue === null) {
      Reflect.deleteProperty(result, key);
      continue;
    }
    const targetValue = Object.hasOwn(result, key) ? result[key]! : null;
    Reflect.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: isJsonObject(patchValue)
        ? applySanitizedMergePatch(targetValue, patchValue)
        : patchValue,
      writable: true,
    });
  }
  return result;
}

export function applyMergePatch(target: JsonValue, patch: JsonValue): JsonValue {
  const safeTarget = strictJsonSnapshot(target);
  const safePatch = strictJsonSnapshot(patch);
  return isJsonObject(safePatch)
    ? applySanitizedMergePatch(safeTarget, safePatch)
    : safePatch;
}

export function resolveInsertionIndex(
  layers: StyleLayer[],
  placement: Placement,
  defaultIndex: number,
): number {
  if (placement.beforeId !== undefined && placement.afterId !== undefined) {
    throw new Error('Placement cannot specify both beforeId and afterId');
  }
  const anchorId = placement.beforeId ?? placement.afterId;
  if (anchorId === undefined) return defaultIndex;
  const anchorIndex = layers.findIndex((layer) => layer.id === anchorId);
  if (anchorIndex === -1) {
    throw new Error(`Placement anchor layer "${anchorId}" was not found`);
  }
  return placement.afterId === undefined ? anchorIndex : anchorIndex + 1;
}
