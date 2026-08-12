import { z } from 'zod';
import { DEFAULT_MAX_OPERATIONS } from './utf8.js';
import type {
  JsonObject, JsonPrimitive, JsonValue, SetLayerPropertiesOperation,
  StyleOperation, StyleTransaction,
} from './types.js';

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const INVALID_SNAPSHOT = Symbol('invalidSnapshot');
const INVALID_JSON_MESSAGE = 'Input must be a strict JSON tree';

type JsonContainer = JsonValue[] | { [key: string]: JsonValue };
type SnapshotWork = { source: object; target: JsonContainer };
type SnapshotResult =
  | { success: true; value: JsonValue }
  | { success: false };
type SanitizedIssue = {
  code: 'custom';
  message: string;
  path: (string | number)[];
  params?: { [key: string]: JsonValue };
};
type SanitizedCheck = (value: JsonValue) => SanitizedIssue[];
type StyleLayerEnvelope = JsonObject & { id: string; type: string };
type StyleDocumentEnvelope = JsonObject & {
  version: 8;
  sources: Record<string, JsonObject>;
  layers: StyleLayerEnvelope[];
};
type ParsedStyleTransaction = StyleTransaction & { validate: boolean };

function appendOwn<T>(values: T[], value: T): boolean {
  return Reflect.defineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function createSnapshotValue(
  value: unknown,
  seen: WeakSet<object>,
  work: SnapshotWork[],
): JsonValue | typeof INVALID_SNAPSHOT {
  if (isJsonPrimitive(value)) {
    return value;
  }
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return INVALID_SNAPSHOT;
  }

  const target: JsonContainer = Array.isArray(value) ? [] : {};
  seen.add(value);
  if (!appendOwn(work, { source: value, target })) return INVALID_SNAPSHOT;
  return target;
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isInteger(index)
    && index >= 0
    && index < length
    && index < 0xffff_ffff
    && String(index) === key;
}

function descriptorsMatchKeys(
  keys: (string | symbol)[],
  descriptors: PropertyDescriptorMap,
): boolean {
  const descriptorKeys = Reflect.ownKeys(descriptors);
  if (descriptorKeys.length !== keys.length) {
    return false;
  }
  const descriptorKeySet = new Set(descriptorKeys);
  return keys.every((key) => descriptorKeySet.has(key));
}

function sanitizeJsonTree(input: unknown): SnapshotResult {
  try {
    if (isJsonPrimitive(input)) {
      return { success: true, value: input };
    }
    if (typeof input !== 'object' || input === null) {
      return { success: false };
    }

    const seen = new WeakSet<object>();
    const work: SnapshotWork[] = [];
    const root = createSnapshotValue(input, seen, work);
    if (root === INVALID_SNAPSHOT) {
      return { success: false };
    }

    while (work.length > 0) {
      const current = work.pop();
      if (current === undefined) {
        return { success: false };
      }

      const sourceIsArray = Array.isArray(current.source);
      const prototype = Object.getPrototypeOf(current.source);
      if (
        (sourceIsArray && prototype !== Array.prototype)
        || (!sourceIsArray && prototype !== Object.prototype)
      ) {
        return { success: false };
      }

      const keys = Reflect.ownKeys(current.source);
      const descriptors = Object.getOwnPropertyDescriptors(current.source);
      if (!descriptorsMatchKeys(keys, descriptors)) {
        return { success: false };
      }

      let arrayLength = -1;
      if (sourceIsArray) {
        const lengthDescriptor = descriptors.length;
        if (
          lengthDescriptor === undefined
          || !('value' in lengthDescriptor)
          || lengthDescriptor.enumerable
          || typeof lengthDescriptor.value !== 'number'
          || !Number.isInteger(lengthDescriptor.value)
          || lengthDescriptor.value < 0
          || lengthDescriptor.value > 0xffff_ffff
        ) {
          return { success: false };
        }
        arrayLength = lengthDescriptor.value;
      }

      let arrayIndexes = 0;
      for (const key of keys) {
        if (typeof key !== 'string') {
          return { success: false };
        }
        const descriptor = descriptors[key];
        if (descriptor === undefined || !('value' in descriptor)) {
          return { success: false };
        }

        if (sourceIsArray && key === 'length') {
          continue;
        }
        if (!descriptor.enumerable || DANGEROUS_KEYS.has(key)) {
          return { success: false };
        }

        if (sourceIsArray) {
          if (!isCanonicalArrayIndex(key, arrayLength)) {
            return { success: false };
          }
          arrayIndexes += 1;
        }

        const snapshotValue = createSnapshotValue(descriptor.value, seen, work);
        if (snapshotValue === INVALID_SNAPSHOT) {
          return { success: false };
        }
        const targetKey = sourceIsArray ? Number(key) : key;
        if (!Reflect.defineProperty(current.target, targetKey, {
          configurable: true,
          enumerable: true,
          value: snapshotValue,
          writable: true,
        })) {
          return { success: false };
        }
      }

      if (sourceIsArray && arrayIndexes !== arrayLength) {
        return { success: false };
      }
    }

    return { success: true, value: root };
  } catch {
    return { success: false };
  }
}

function sanitizeBefore<Output extends JsonValue>(
  check: SanitizedCheck = () => [],
) {
  return z.preprocess((input, context) => {
    const result = sanitizeJsonTree(input);
    if (!result.success) {
      context.addIssue({ code: 'custom', message: INVALID_JSON_MESSAGE });
      return z.NEVER;
    }
    const issues = check(result.value);
    if (issues.length > 0) {
      for (const issue of issues) context.addIssue(issue);
      return z.NEVER;
    }
    return result.value;
  }, z.custom<Output>());
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ownValue(object: JsonObject, key: string): JsonValue | undefined {
  return Object.getOwnPropertyDescriptor(object, key)?.value as JsonValue | undefined;
}

function issue(message: string, path: (string | number)[]): SanitizedIssue {
  return { code: 'custom', message, path };
}

function validateStyleDocument(value: JsonValue): SanitizedIssue[] {
  if (!isJsonObject(value)) return [issue('Expected a style object', [])];
  const issues: SanitizedIssue[] = [];
  if (ownValue(value, 'version') !== 8) {
    issues.push(issue('Expected version 8', ['version']));
  }
  const sources = ownValue(value, 'sources');
  if (!isJsonObject(sources)) {
    issues.push(issue('Expected a sources object', ['sources']));
  } else {
    for (const sourceId of Reflect.ownKeys(sources)) {
      const source = ownValue(sources, sourceId as string);
      if (!isJsonObject(source)) {
        issues.push(issue('Expected a source object', ['sources', sourceId as string]));
      }
    }
  }
  const layers = ownValue(value, 'layers');
  if (!Array.isArray(layers)) {
    issues.push(issue('Expected a layers array', ['layers']));
  } else {
    for (let index = 0; index < layers.length; index += 1) {
      const layer = Object.getOwnPropertyDescriptor(layers, String(index))?.value as
        JsonValue | undefined;
      if (!isJsonObject(layer)) {
        issues.push(issue('Expected a layer object', ['layers', index]));
        continue;
      }
      const id = ownValue(layer, 'id');
      if (typeof id !== 'string' || id.length === 0) {
        issues.push(issue('Expected a non-empty layer id', ['layers', index, 'id']));
      }
      const type = ownValue(layer, 'type');
      if (typeof type !== 'string' || type.length === 0) {
        issues.push(issue('Expected a non-empty layer type', ['layers', index, 'type']));
      }
    }
  }
  return issues;
}

const OPERATION_KEYS = new Set([
  'op', 'layerId', 'paint', 'layout', 'metadata', 'minzoom', 'maxzoom',
]);

function validateStyleOperation(
  value: JsonValue,
  path: (string | number)[] = [],
): SanitizedIssue[] {
  if (!isJsonObject(value)) return [issue('Expected an operation object', path)];
  const issues: SanitizedIssue[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (!OPERATION_KEYS.has(key as string)) {
      issues.push(issue('Unrecognized operation field', [...path, key as string]));
    }
  }
  if (ownValue(value, 'op') !== 'setLayerProperties') {
    issues.push(issue('Expected setLayerProperties operation', [...path, 'op']));
  }
  const layerId = ownValue(value, 'layerId');
  if (typeof layerId !== 'string' || layerId.length === 0) {
    issues.push(issue('Expected a non-empty layerId', [...path, 'layerId']));
  }
  for (const key of ['paint', 'layout'] as const) {
    const property = ownValue(value, key);
    if (property !== undefined && !isJsonObject(property)) {
      issues.push(issue(`Expected ${key} to be an object`, [...path, key]));
    }
  }
  const metadata = ownValue(value, 'metadata');
  if (metadata !== undefined && metadata !== null && !isJsonObject(metadata)) {
    issues.push(issue('Expected metadata to be an object or null', [...path, 'metadata']));
  }
  const minzoom = ownValue(value, 'minzoom');
  const maxzoom = ownValue(value, 'maxzoom');
  for (const [key, zoom] of [['minzoom', minzoom], ['maxzoom', maxzoom]] as const) {
    if (zoom !== undefined && zoom !== null
      && (typeof zoom !== 'number' || zoom < 0 || zoom > 24)) {
      issues.push(issue(`Expected ${key} between 0 and 24`, [...path, key]));
    }
  }
  if (typeof minzoom === 'number' && typeof maxzoom === 'number' && minzoom > maxzoom) {
    issues.push(issue(
      'minzoom must be less than or equal to maxzoom', [...path, 'maxzoom'],
    ));
  }
  return issues;
}

export const jsonValueSchema = sanitizeBefore<JsonValue>();
export const styleDocumentSchema = sanitizeBefore<StyleDocumentEnvelope>(
  validateStyleDocument,
);
export const setLayerPropertiesOperationSchema = sanitizeBefore<
  SetLayerPropertiesOperation
>(validateStyleOperation);
export const styleOperationSchema = sanitizeBefore<StyleOperation>(validateStyleOperation);

export function createStyleTransactionSchema(
  maxOperations = DEFAULT_MAX_OPERATIONS,
) {
  if (!Number.isSafeInteger(maxOperations) || maxOperations <= 0) {
    throw new RangeError('maxOperations must be a positive safe integer');
  }

  return sanitizeBefore<ParsedStyleTransaction>((value) => {
    if (!isJsonObject(value)) return [issue('Expected a transaction object', [])];
    const issues: SanitizedIssue[] = [];
    for (const key of Reflect.ownKeys(value)) {
      if (key !== 'operations' && key !== 'validate') {
        issues.push(issue('Unrecognized transaction field', [key as string]));
      }
    }
    const operations = ownValue(value, 'operations');
    if (!Array.isArray(operations)) {
      issues.push(issue('Expected an operations array', ['operations']));
    } else if (operations.length > maxOperations) {
      return [{
          code: 'custom',
          message: 'Too many operations',
          path: ['operations'],
          params: {
            reason: 'maxOperations',
            maxOperations,
            actualOperations: operations.length,
          },
      }];
    } else if (operations.length === 0) {
      issues.push(issue('Expected at least one operation', ['operations']));
    } else {
      for (let index = 0; index < operations.length; index += 1) {
        const operationValue = Object.getOwnPropertyDescriptor(
          operations, String(index),
        )?.value as JsonValue;
        issues.push(...validateStyleOperation(operationValue, ['operations', index]));
      }
    }
    const validate = ownValue(value, 'validate');
    if (validate === undefined) {
      if (!Reflect.defineProperty(value, 'validate', {
        configurable: true, enumerable: true, value: true, writable: true,
      })) {
        issues.push(issue('Could not default validate', ['validate']));
      }
    } else if (typeof validate !== 'boolean') {
      issues.push(issue('Expected validate to be boolean', ['validate']));
    }
    return issues;
  });
}

export const styleTransactionSchema = createStyleTransactionSchema();
