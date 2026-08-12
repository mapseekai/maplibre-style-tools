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
type FallbackValidator = (value: JsonValue) => JsonValue | undefined;
type FallbackIssue = (value: JsonValue) => z.core.$ZodIssue | undefined;

function appendOwn<T>(values: T[], value: T): boolean {
  return Reflect.defineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function oneItem<T>(value: T): T[] {
  const values: T[] = [];
  appendOwn(values, value);
  return values;
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
  if (isJsonPrimitive(value)) return value;
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
  if (descriptorKeys.length !== keys.length) return false;
  const descriptorKeySet = new Set(descriptorKeys);
  return keys.every((key) => descriptorKeySet.has(key));
}

function sanitizeJsonTree(input: unknown): SnapshotResult {
  try {
    if (isJsonPrimitive(input)) return { success: true, value: input };
    if (typeof input !== 'object' || input === null) return { success: false };

    const seen = new WeakSet<object>();
    const work: SnapshotWork[] = [];
    const root = createSnapshotValue(input, seen, work);
    if (root === INVALID_SNAPSHOT) return { success: false };

    while (work.length > 0) {
      const current = work.pop();
      if (current === undefined) return { success: false };
      const sourceIsArray = Array.isArray(current.source);
      const prototype = Object.getPrototypeOf(current.source);
      if (
        (sourceIsArray && prototype !== Array.prototype)
        || (!sourceIsArray && prototype !== Object.prototype)
      ) return { success: false };

      const keys = Reflect.ownKeys(current.source);
      const descriptors = Object.getOwnPropertyDescriptors(current.source);
      if (!descriptorsMatchKeys(keys, descriptors)) return { success: false };

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
        ) return { success: false };
        arrayLength = lengthDescriptor.value;
      }

      let arrayIndexes = 0;
      for (const key of keys) {
        if (typeof key !== 'string') return { success: false };
        const descriptor = descriptors[key];
        if (descriptor === undefined || !('value' in descriptor)) return { success: false };
        if (sourceIsArray && key === 'length') continue;
        if (!descriptor.enumerable || DANGEROUS_KEYS.has(key)) return { success: false };
        if (sourceIsArray) {
          if (!isCanonicalArrayIndex(key, arrayLength)) return { success: false };
          arrayIndexes += 1;
        }
        const snapshotValue = createSnapshotValue(descriptor.value, seen, work);
        if (snapshotValue === INVALID_SNAPSHOT) return { success: false };
        if (!Reflect.defineProperty(current.target, sourceIsArray ? Number(key) : key, {
          configurable: true,
          enumerable: true,
          value: snapshotValue,
          writable: true,
        })) return { success: false };
      }
      if (sourceIsArray && arrayIndexes !== arrayLength) return { success: false };
    }
    return { success: true, value: root };
  } catch {
    return { success: false };
  }
}

function hasPollutedPrototype(): boolean {
  try {
    for (const key of Reflect.ownKeys(Array.prototype)) {
      if (typeof key !== 'string' || !isCanonicalArrayIndex(key, 0xffff_ffff)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, key);
      if (descriptor !== undefined && !('value' in descriptor)) return true;
    }
    for (const key of Reflect.ownKeys(Object.prototype)) {
      if (typeof key === 'string' && DANGEROUS_KEYS.has(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
      if (descriptor !== undefined && !('value' in descriptor)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function ownValue(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function isJsonObject(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: object, allowed: ReadonlySet<string>): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowed.has(key));
}

function validZoom(value: unknown): boolean {
  return value === undefined || value === null
    || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 24);
}

function fallbackStyleDocument(value: JsonValue): JsonValue | undefined {
  if (!isJsonObject(value) || ownValue(value, 'version') !== 8) return undefined;
  const sources = ownValue(value, 'sources');
  const layers = ownValue(value, 'layers');
  if (!isJsonObject(sources) || !Array.isArray(layers)) return undefined;
  for (const sourceId of Reflect.ownKeys(sources)) {
    if (typeof sourceId !== 'string' || !isJsonObject(ownValue(sources, sourceId))) return undefined;
  }
  for (let index = 0; index < layers.length; index += 1) {
    const layer = ownValue(layers, String(index));
    if (!isJsonObject(layer)) return undefined;
    const id = ownValue(layer, 'id');
    const type = ownValue(layer, 'type');
    if (typeof id !== 'string' || id.length === 0 || typeof type !== 'string' || type.length === 0) {
      return undefined;
    }
  }
  return value;
}

function fallbackStyleDocumentIssue(value: JsonValue): z.core.$ZodIssue | undefined {
  if (isJsonObject(value) && ownValue(value, 'version') !== 8) {
    return {
      code: 'invalid_value', values: [8], path: ['version'],
      message: 'Invalid input: expected 8',
    };
  }
  return undefined;
}

const OPERATION_KEYS = new Set([
  'op', 'layerId', 'paint', 'layout', 'metadata', 'minzoom', 'maxzoom',
]);

function fallbackOperation(value: JsonValue): JsonValue | undefined {
  if (!isJsonObject(value) || !hasOnlyKeys(value, OPERATION_KEYS)) return undefined;
  if (ownValue(value, 'op') !== 'setLayerProperties') return undefined;
  const layerId = ownValue(value, 'layerId');
  if (typeof layerId !== 'string' || layerId.length === 0) return undefined;
  for (const key of ['paint', 'layout'] as const) {
    const field = ownValue(value, key);
    if (field !== undefined && !isJsonObject(field)) return undefined;
  }
  const metadata = ownValue(value, 'metadata');
  if (metadata !== undefined && metadata !== null && !isJsonObject(metadata)) return undefined;
  const minzoom = ownValue(value, 'minzoom');
  const maxzoom = ownValue(value, 'maxzoom');
  if (!validZoom(minzoom) || !validZoom(maxzoom)) return undefined;
  if (typeof minzoom === 'number' && typeof maxzoom === 'number' && minzoom > maxzoom) return undefined;
  return value;
}

function fallbackOperationIssue(value: JsonValue): z.core.$ZodIssue | undefined {
  if (isJsonObject(value) && ownValue(value, 'op') !== 'setLayerProperties') {
    const issue: z.core.$ZodIssue = {
      code: 'invalid_union', errors: [], path: ['op'],
      message: "Invalid discriminator value. Expected 'setLayerProperties'",
    };
    for (const [key, field] of [
      ['note', 'No matching discriminator'],
      ['discriminator', 'op'],
      ['options', ['setLayerProperties']],
    ] as const) {
      Reflect.defineProperty(issue, key, {
        configurable: true, enumerable: true, value: field, writable: true,
      });
    }
    return issue;
  }
  return undefined;
}

function fallbackTransaction(maxOperations: number): FallbackValidator {
  return (value) => {
    if (!isJsonObject(value) || !hasOnlyKeys(value, new Set(['operations', 'validate']))) {
      return undefined;
    }
    const operations = ownValue(value, 'operations');
    if (!Array.isArray(operations) || operations.length === 0 || operations.length > maxOperations) {
      return undefined;
    }
    for (let index = 0; index < operations.length; index += 1) {
      const operation = ownValue(operations, String(index)) as JsonValue;
      if (fallbackOperation(operation) === undefined) return undefined;
    }
    const validate = ownValue(value, 'validate');
    if (validate === undefined) {
      if (!Reflect.defineProperty(value, 'validate', {
        configurable: true, enumerable: true, value: true, writable: true,
      })) return undefined;
    } else if (typeof validate !== 'boolean') return undefined;
    return value;
  };
}

function fallbackTransactionIssue(value: JsonValue): z.core.$ZodIssue | undefined {
  if (isJsonObject(value)) {
    const operations = ownValue(value, 'operations');
    if (Array.isArray(operations) && operations.length === 0) {
      return {
        origin: 'array', code: 'too_small', minimum: 1, inclusive: true,
        path: ['operations'], message: 'Too small: expected array to have >=1 items',
      };
    }
  }
  return undefined;
}

function safeFailure(issue: z.core.$ZodIssue = {
  code: 'custom', message: INVALID_JSON_MESSAGE, path: [],
}) {
  const error = new z.ZodError(oneItem(issue));
  return { success: false as const, error };
}

function createSafeBoundary<Schema extends z.ZodType>(
  schema: Schema,
  check: SanitizedCheck | undefined,
  fallback: FallbackValidator,
  fallbackIssue?: FallbackIssue,
): Schema {
  const originalSafeParse = schema.safeParse.bind(schema);
  const originalParse = schema.parse.bind(schema);
  const safeParse = (input: unknown) => {
    if (!hasPollutedPrototype()) return originalSafeParse(input);
    const sanitized = sanitizeJsonTree(input);
    if (!sanitized.success) return safeFailure();
    const boundaryIssue = check?.(sanitized.value);
    if (boundaryIssue !== undefined) return safeFailure(boundaryIssue);
    const output = fallback(sanitized.value);
    return output === undefined
      ? safeFailure(fallbackIssue?.(sanitized.value))
      : { success: true as const, data: output as z.output<Schema> };
  };
  const parse = (input: unknown) => {
    if (!hasPollutedPrototype()) return originalParse(input);
    const result = safeParse(input);
    if (!result.success) throw result.error;
    return result.data;
  };
  Object.defineProperties(schema, {
    parse: { configurable: true, value: parse, writable: true },
    safeParse: { configurable: true, value: safeParse, writable: true },
  });
  return schema;
}

function sanitizeBefore<Schema extends z.ZodType>(
  inner: Schema,
  check?: SanitizedCheck,
  fallback: FallbackValidator = (value) => value,
  fallbackIssue?: FallbackIssue,
) {
  const schema = z.preprocess((input, context) => {
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
  }, inner);
  return createSafeBoundary(schema, check, fallback, fallbackIssue);
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

export const styleDocumentSchema = sanitizeBefore(
  styleDocumentInnerSchema, undefined, fallbackStyleDocument, fallbackStyleDocumentIssue,
);

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
  setLayerPropertiesOperationInnerSchema, undefined, fallbackOperation, fallbackOperationIssue,
);

const styleOperationInnerSchema = z.discriminatedUnion('op', [
  setLayerPropertiesOperationInnerSchema,
]) satisfies z.ZodType<StyleOperation>;

export const styleOperationSchema = sanitizeBefore(
  styleOperationInnerSchema, undefined, fallbackOperation, fallbackOperationIssue,
);

export function createStyleTransactionSchema(maxOperations = DEFAULT_MAX_OPERATIONS) {
  if (!Number.isSafeInteger(maxOperations) || maxOperations <= 0) {
    throw new RangeError('maxOperations must be a positive safe integer');
  }
  const transactionInnerSchema = z.object({
    operations: z.array(styleOperationInnerSchema).min(1),
    validate: z.boolean().default(true),
  }).strict() satisfies z.ZodType<StyleTransaction>;
  const check: SanitizedCheck = (value) => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const operations = Object.getOwnPropertyDescriptor(value, 'operations')?.value;
      if (Array.isArray(operations) && operations.length > maxOperations) {
        return {
          code: 'custom',
          message: 'Too many operations',
          path: ['operations'],
          params: {
            reason: 'maxOperations', maxOperations, actualOperations: operations.length,
          },
        };
      }
    }
    return undefined;
  };
  return sanitizeBefore(
    transactionInnerSchema,
    check,
    fallbackTransaction(maxOperations),
    fallbackTransactionIssue,
  );
}

export const styleTransactionSchema = createStyleTransactionSchema();
