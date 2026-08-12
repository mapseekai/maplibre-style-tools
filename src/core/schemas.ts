import { z } from 'zod';
import { DEFAULT_MAX_OPERATIONS } from './utf8.js';
import type {
  JsonPrimitive, JsonValue, SetLayerPropertiesOperation, StyleOperation,
  StyleTransaction,
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
  params: { [key: string]: JsonValue };
};
type SanitizedCheck = (value: JsonValue) => SanitizedIssue | undefined;

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
  work.push({ source: value, target });
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

function sanitizeBefore<Schema extends z.ZodType>(
  schema: Schema,
  check?: SanitizedCheck,
) {
  return z.preprocess((input, context) => {
    const result = sanitizeJsonTree(input);
    if (!result.success) {
      context.addIssue({ code: 'custom', message: INVALID_JSON_MESSAGE });
      return z.NEVER;
    }
    const issue = check?.(result.value);
    if (issue !== undefined) {
      context.addIssue(issue);
      return z.NEVER;
    }
    return result.value;
  }, schema);
}

const jsonValueInnerSchema = z.custom<JsonValue>();
const jsonObjectInnerSchema = z.record(z.string(), jsonValueInnerSchema);

export const jsonValueSchema = sanitizeBefore(jsonValueInnerSchema);

const styleLayerEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
}).catchall(jsonValueInnerSchema);

const styleDocumentInnerSchema = z.object({
  version: z.literal(8),
  sources: z.record(z.string(), jsonObjectInnerSchema),
  layers: z.array(styleLayerEnvelopeSchema),
}).catchall(jsonValueInnerSchema);

export const styleDocumentSchema = sanitizeBefore(styleDocumentInnerSchema);

const zoomSchema = z.number().finite().min(0).max(24).nullable();
const setLayerPropertiesOperationInnerSchema = z.object({
  op: z.literal('setLayerProperties'),
  layerId: z.string().min(1),
  paint: jsonObjectInnerSchema.optional(),
  layout: jsonObjectInnerSchema.optional(),
  metadata: jsonObjectInnerSchema.nullable().optional(),
  minzoom: zoomSchema.optional(),
  maxzoom: zoomSchema.optional(),
}).strict().refine((operation) => (
  typeof operation.minzoom !== 'number'
  || typeof operation.maxzoom !== 'number'
  || operation.minzoom <= operation.maxzoom
), {
  message: 'minzoom must be less than or equal to maxzoom',
  path: ['maxzoom'],
}) satisfies z.ZodType<SetLayerPropertiesOperation>;

export const setLayerPropertiesOperationSchema = sanitizeBefore(
  setLayerPropertiesOperationInnerSchema,
);

const styleOperationInnerSchema = z.discriminatedUnion('op', [
  setLayerPropertiesOperationInnerSchema,
]) satisfies z.ZodType<StyleOperation>;

export const styleOperationSchema = sanitizeBefore(styleOperationInnerSchema);

export function createStyleTransactionSchema(
  maxOperations = DEFAULT_MAX_OPERATIONS,
) {
  if (!Number.isSafeInteger(maxOperations) || maxOperations <= 0) {
    throw new RangeError('maxOperations must be a positive safe integer');
  }

  const transactionInnerSchema = z.object({
    operations: z.array(styleOperationInnerSchema).min(1),
    validate: z.boolean().default(true),
  }).strict() satisfies z.ZodType<StyleTransaction>;

  return sanitizeBefore(transactionInnerSchema, (value) => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const operationsDescriptor = Object.getOwnPropertyDescriptor(value, 'operations');
      const operations = operationsDescriptor?.value;
      if (Array.isArray(operations) && operations.length > maxOperations) {
        return {
          code: 'custom',
          message: 'Too many operations',
          path: ['operations'],
          params: {
            reason: 'maxOperations',
            maxOperations,
            actualOperations: operations.length,
          },
        };
      }
    }
    return undefined;
  });
}

export const styleTransactionSchema = createStyleTransactionSchema();
