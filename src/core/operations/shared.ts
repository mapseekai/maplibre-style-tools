import type { JsonObject, JsonValue, Placement, StyleLayer } from '../types.js';

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ownJsonEntries(value: JsonObject): [string, JsonValue][] {
  const entries: [string, JsonValue][] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || DANGEROUS_KEYS.has(key)) {
      throw new TypeError('JSON Merge Patch contains a dangerous key');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError('JSON Merge Patch must contain enumerable data properties');
    }
    entries.push([key, descriptor.value as JsonValue]);
  }
  return entries;
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item));
  if (!isJsonObject(value)) return value;
  const clone: JsonObject = {};
  for (const [key, child] of ownJsonEntries(value)) {
    Reflect.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: cloneJsonValue(child),
      writable: true,
    });
  }
  return clone;
}

function applyObjectMergePatch(
  target: JsonValue,
  patch: JsonObject,
  activePatches: WeakSet<object>,
): JsonObject {
  if (activePatches.has(patch)) {
    throw new TypeError('JSON Merge Patch cannot contain a cycle');
  }
  activePatches.add(patch);
  try {
    const result = isJsonObject(target) ? cloneJsonValue(target) as JsonObject : {};
    for (const [key, patchValue] of ownJsonEntries(patch)) {
      if (patchValue === null) {
        Reflect.deleteProperty(result, key);
        continue;
      }
      const targetValue = Object.hasOwn(result, key) ? result[key]! : null;
      Reflect.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: isJsonObject(patchValue)
          ? applyObjectMergePatch(targetValue, patchValue, activePatches)
          : cloneJsonValue(patchValue),
        writable: true,
      });
    }
    return result;
  } finally {
    activePatches.delete(patch);
  }
}

export function applyMergePatch(target: JsonValue, patch: JsonValue): JsonValue {
  return isJsonObject(patch)
    ? applyObjectMergePatch(target, patch, new WeakSet())
    : cloneJsonValue(patch);
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
