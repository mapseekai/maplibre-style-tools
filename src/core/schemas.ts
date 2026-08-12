import { z } from 'zod';
import { jsonValuesEqual } from './diff.js';
import { DEFAULT_MAX_OPERATIONS } from './utf8.js';
import type {
  GeoJsonLimits, InlineGeoJson, JsonPrimitive, JsonValue,
  SetGeoJsonSourceFilterOperation,
  SetLayerFilterOperation, SetLayerPropertiesOperation,
  SetStyleRootPropertiesOperation, StyleOperation, StyleTransaction,
} from './types.js';

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const OBJECT_PROTOTYPE_KEYS = Object.freeze([
  'constructor', '__defineGetter__', '__defineSetter__', 'hasOwnProperty',
  '__lookupGetter__', '__lookupSetter__', 'isPrototypeOf',
  'propertyIsEnumerable', 'toString', 'valueOf', 'toLocaleString', '__proto__',
] as const);
const NORMAL_OBJECT_PROTOTYPE_DESCRIPTORS: ReadonlyMap<
  string, Readonly<PropertyDescriptor>
> = (() => {
  const descriptors = new Map<string, Readonly<PropertyDescriptor>>();
  for (const key of OBJECT_PROTOTYPE_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
    if (descriptor !== undefined) descriptors.set(key, Object.freeze(descriptor));
  }
  return descriptors;
})();
const PROPERTY_DESCRIPTOR_FIELDS = Object.freeze([
  'configurable', 'enumerable', 'writable', 'value', 'get', 'set',
] as const);
const INVALID_SNAPSHOT = Symbol('invalidSnapshot');
const INVALID_JSON_MESSAGE = 'Input must be a strict JSON tree';

type JsonContainer = JsonValue[] | { [key: string]: JsonValue };
type SnapshotWork = {
  source: object;
  target: JsonContainer;
  path: (string | number)[];
};
type SnapshotResult =
  | { success: true; value: JsonValue }
  | { success: false; path: (string | number)[] };
type SanitizedIssue = z.core.$ZodIssue;
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
  path: (string | number)[],
): JsonValue | typeof INVALID_SNAPSHOT {
  if (isJsonPrimitive(value)) return value;
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return INVALID_SNAPSHOT;
  }
  const target: JsonContainer = Array.isArray(value) ? [] : {};
  seen.add(value);
  if (!appendOwn(work, { source: value, target, path })) return INVALID_SNAPSHOT;
  return target;
}

function pathWith(
  path: readonly (string | number)[],
  token: string | number,
): (string | number)[] {
  const result: (string | number)[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(path, String(index));
    if (descriptor !== undefined && 'value' in descriptor) appendOwn(result, descriptor.value);
  }
  appendOwn(result, token);
  return result;
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
    if (typeof input !== 'object' || input === null) return { success: false, path: [] };

    const seen = new WeakSet<object>();
    const work: SnapshotWork[] = [];
    const root = createSnapshotValue(input, seen, work, []);
    if (root === INVALID_SNAPSHOT) return { success: false, path: [] };

    while (work.length > 0) {
      const current = work.pop();
      if (current === undefined) return { success: false, path: [] };
      const sourceIsArray = Array.isArray(current.source);
      const prototype = Object.getPrototypeOf(current.source);
      if (
        (sourceIsArray && prototype !== Array.prototype)
        || (!sourceIsArray && prototype !== Object.prototype)
      ) return { success: false, path: current.path };

      const keys = Reflect.ownKeys(current.source);
      const descriptors = Object.getOwnPropertyDescriptors(current.source);
      if (!descriptorsMatchKeys(keys, descriptors)) {
        return { success: false, path: current.path };
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
        ) return { success: false, path: current.path };
        arrayLength = lengthDescriptor.value;
      }

      let arrayIndexes = 0;
      for (const key of keys) {
        if (typeof key !== 'string') return { success: false, path: current.path };
        const childPath = sourceIsArray && key === 'length'
          ? current.path
          : pathWith(current.path, sourceIsArray ? Number(key) : key);
        const descriptor = descriptors[key];
        if (descriptor === undefined || !('value' in descriptor)) {
          return { success: false, path: childPath };
        }
        if (sourceIsArray && key === 'length') continue;
        if (!descriptor.enumerable || DANGEROUS_KEYS.has(key)) {
          return { success: false, path: childPath };
        }
        if (sourceIsArray) {
          if (!isCanonicalArrayIndex(key, arrayLength)) {
            return { success: false, path: childPath };
          }
          arrayIndexes += 1;
        }
        const snapshotValue = createSnapshotValue(descriptor.value, seen, work, childPath);
        if (snapshotValue === INVALID_SNAPSHOT) {
          return { success: false, path: childPath };
        }
        if (!Reflect.defineProperty(current.target, sourceIsArray ? Number(key) : key, {
          configurable: true,
          enumerable: true,
          value: snapshotValue,
          writable: true,
        })) return { success: false, path: childPath };
      }
      if (sourceIsArray && arrayIndexes !== arrayLength) {
        return { success: false, path: current.path };
      }
    }
    return { success: true, value: root };
  } catch {
    return { success: false, path: [] };
  }
}

function isNormalObjectPrototypeDescriptor(
  key: string | symbol,
  descriptor: PropertyDescriptor,
): boolean {
  if (typeof key !== 'string') return false;
  const expected = NORMAL_OBJECT_PROTOTYPE_DESCRIPTORS.get(key);
  if (expected === undefined) return false;
  for (const field of PROPERTY_DESCRIPTOR_FIELDS) {
    const actualField = Object.getOwnPropertyDescriptor(descriptor, field);
    const expectedField = Object.getOwnPropertyDescriptor(expected, field);
    if (actualField === undefined || expectedField === undefined) {
      if (actualField !== expectedField) return false;
    } else if (actualField.value !== expectedField.value) {
      return false;
    }
  }
  return true;
}

function hasPollutedPrototype(): boolean {
  try {
    const seen = new Set<object>();
    let prototype: object | null = Array.prototype;
    while (prototype !== null) {
      if (seen.has(prototype)) return true;
      seen.add(prototype);
      for (const key of Reflect.ownKeys(prototype)) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
        if (descriptor === undefined) return true;
        if (
          typeof key === 'string'
          && isCanonicalArrayIndex(key, 0xffff_ffff)
          && (!('value' in descriptor) || descriptor.writable === false)
        ) return true;
        if (
          prototype === Object.prototype
          && !isNormalObjectPrototypeDescriptor(key, descriptor)
        ) return true;
      }
      prototype = Object.getPrototypeOf(prototype);
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
const ROOT_OPERATION_KEYS = new Set(['op', 'properties']);
const LAYER_FILTER_OPERATION_KEYS = new Set(['op', 'layerId', 'mode', 'filter']);
const SOURCE_FILTER_OPERATION_KEYS = new Set(['op', 'sourceId', 'mode', 'filter']);
const PROTECTED_ROOT_KEYS = new Set(['version', 'sources', 'layers']);

function fallbackSetLayerOperation(value: JsonValue): JsonValue | undefined {
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

function fallbackRootOperation(value: JsonValue): JsonValue | undefined {
  if (!isJsonObject(value) || !hasOnlyKeys(value, ROOT_OPERATION_KEYS)) return undefined;
  if (ownValue(value, 'op') !== 'setStyleRootProperties') return undefined;
  const properties = ownValue(value, 'properties');
  if (!isJsonObject(properties)) return undefined;
  if (Object.keys(properties).some((key) => PROTECTED_ROOT_KEYS.has(key))) return undefined;
  return value;
}

function fallbackFilterOperation(
  value: JsonValue,
  op: 'setLayerFilter' | 'setGeoJsonSourceFilter',
): JsonValue | undefined {
  if (!isJsonObject(value)) return undefined;
  const isLayer = op === 'setLayerFilter';
  if (!hasOnlyKeys(value, isLayer
    ? LAYER_FILTER_OPERATION_KEYS
    : SOURCE_FILTER_OPERATION_KEYS)) return undefined;
  if (ownValue(value, 'op') !== op) return undefined;
  const id = ownValue(value, isLayer ? 'layerId' : 'sourceId');
  if (typeof id !== 'string' || id.length === 0) return undefined;
  const mode = ownValue(value, 'mode');
  if (mode === 'clear') {
    return ownValue(value, 'filter') === undefined ? value : undefined;
  }
  const validMode = isLayer
    ? mode === 'replace' || mode === 'and' || mode === 'or'
    : mode === 'replace';
  return validMode && Array.isArray(ownValue(value, 'filter')) ? value : undefined;
}

function fallbackOperation(value: JsonValue): JsonValue | undefined {
  return fallbackSetLayerOperation(value)
    ?? fallbackRootOperation(value)
    ?? fallbackFilterOperation(value, 'setLayerFilter')
    ?? fallbackFilterOperation(value, 'setGeoJsonSourceFilter');
}

function fallbackSetLayerOperationIssue(value: JsonValue): z.core.$ZodIssue | undefined {
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

function fallbackOperationIssue(value: JsonValue): z.core.$ZodIssue | undefined {
  if (!isJsonObject(value)) return undefined;
  const operation = ownValue(value, 'op');
  return operation === 'setLayerProperties'
    || operation === 'setStyleRootProperties'
    || operation === 'setLayerFilter'
    || operation === 'setGeoJsonSourceFilter'
    ? undefined
    : fallbackSetLayerOperationIssue(value);
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

function safeFailure<Output = unknown>(issue: z.core.$ZodIssue = {
  code: 'custom', message: INVALID_JSON_MESSAGE, path: [],
}): z.ZodSafeParseError<Output> {
  const error = new z.ZodError(oneItem(issue)) as z.ZodError<Output>;
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
  const originalSafeParseAsync = schema.safeParseAsync.bind(schema);
  const originalParseAsync = schema.parseAsync.bind(schema);
  const fallbackSafeParse = (input: unknown): z.ZodSafeParseResult<z.output<Schema>> => {
    const sanitized = sanitizeJsonTree(input);
    if (!sanitized.success) return safeFailure({
      code: 'custom', message: INVALID_JSON_MESSAGE, path: sanitized.path,
    });
    const boundaryIssue = check?.(sanitized.value);
    if (boundaryIssue !== undefined) return safeFailure(boundaryIssue);
    const output = fallback(sanitized.value);
    return output === undefined
      ? safeFailure(fallbackIssue?.(sanitized.value))
      : { success: true as const, data: output as z.output<Schema> };
  };
  const safeParse = (
    input: unknown, params?: z.core.ParseContext<z.core.$ZodIssue>,
  ) => hasPollutedPrototype()
    ? fallbackSafeParse(input)
    : originalSafeParse(input, params);
  const parse = (
    input: unknown, params?: z.core.ParseContext<z.core.$ZodIssue>,
  ) => {
    if (!hasPollutedPrototype()) return originalParse(input, params);
    const result = fallbackSafeParse(input);
    if (!result.success) throw result.error;
    return result.data;
  };
  const safeParseAsync = async (
    input: unknown, params?: z.core.ParseContext<z.core.$ZodIssue>,
  ) => hasPollutedPrototype()
    ? fallbackSafeParse(input)
    : originalSafeParseAsync(input, params);
  const parseAsync = async (
    input: unknown, params?: z.core.ParseContext<z.core.$ZodIssue>,
  ) => {
    if (!hasPollutedPrototype()) return originalParseAsync(input, params);
    const result = fallbackSafeParse(input);
    if (!result.success) throw result.error;
    return result.data;
  };
  Object.defineProperties(schema, {
    parse: { configurable: true, value: parse, writable: true },
    safeParse: { configurable: true, value: safeParse, writable: true },
    parseAsync: { configurable: true, value: parseAsync, writable: true },
    safeParseAsync: { configurable: true, value: safeParseAsync, writable: true },
    spa: { configurable: true, value: safeParseAsync, writable: true },
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
      context.addIssue({
        code: 'custom', message: INVALID_JSON_MESSAGE, path: result.path,
      });
      return z.NEVER;
    }
    const issue = check?.(result.value);
    if (issue !== undefined) {
      context.addIssue(issue as Parameters<typeof context.addIssue>[0]);
      return z.NEVER;
    }
    return result.value;
  }, inner);
  return createSafeBoundary(schema, check, fallback, fallbackIssue);
}

const jsonValueInnerSchema = z.custom<JsonValue>();
const jsonObjectInnerSchema = z.record(z.string(), jsonValueInnerSchema);

export const jsonValueSchema = sanitizeBefore(jsonValueInnerSchema);

const GEOJSON_TYPES = new Set([
  'Feature', 'FeatureCollection', 'Point', 'MultiPoint', 'LineString',
  'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection',
]);
const GEOJSON_GEOMETRY_TYPES = new Set([
  'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon',
  'MultiPolygon', 'GeometryCollection',
]);
const GEOJSON_LIMIT_KEYS = new Set([
  'maxBytes', 'maxFeatures', 'maxCoordinatePositions',
  'maxGeometryDepth', 'maxPropertyDepth',
]);

type GeoJsonObjectRole = 'top' | 'feature' | 'geometry';
type CoordinateRole =
  | 'position'
  | 'positions'
  | 'line'
  | 'lines'
  | 'ring'
  | 'polygon'
  | 'polygons';
type GeoJsonStructuralWork =
  | {
      kind: 'object';
      value: JsonValue;
      path: (string | number)[];
      role: GeoJsonObjectRole;
    }
  | {
      kind: 'coordinates';
      value: JsonValue;
      path: (string | number)[];
      role: CoordinateRole;
    }
  | {
      kind: 'ringClosure';
      value: JsonValue[];
      path: (string | number)[];
    };

function geoJsonIssue(
  message: string,
  path: (string | number)[],
): SanitizedIssue {
  return { code: 'custom', message, path };
}

function validateBbox(
  value: { [key: string]: JsonValue },
  path: readonly (string | number)[],
): SanitizedIssue | undefined {
  const bbox = ownValue(value, 'bbox');
  if (bbox === undefined) return undefined;
  const bboxPath = pathWith(path, 'bbox');
  if (!Array.isArray(bbox) || (bbox.length !== 4 && bbox.length !== 6)) {
    return geoJsonIssue('bbox must contain exactly four or six numbers', bboxPath);
  }
  for (let index = 0; index < bbox.length; index += 1) {
    const component = ownValue(bbox, String(index));
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      return geoJsonIssue('bbox components must be finite numbers', pathWith(bboxPath, index));
    }
  }
  return undefined;
}

function pushStructuralObject(
  work: GeoJsonStructuralWork[],
  value: JsonValue,
  path: (string | number)[],
  role: GeoJsonObjectRole,
): void {
  appendOwn(work, { kind: 'object', value, path, role });
}

function pushCoordinates(
  work: GeoJsonStructuralWork[],
  value: JsonValue,
  path: (string | number)[],
  role: CoordinateRole,
): void {
  appendOwn(work, { kind: 'coordinates', value, path, role });
}

function pushArrayCoordinateChildren(
  work: GeoJsonStructuralWork[],
  values: JsonValue[],
  path: (string | number)[],
  role: CoordinateRole,
): void {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    pushCoordinates(work, ownValue(values, String(index)) as JsonValue, pathWith(path, index), role);
  }
}

function checkCoordinateWork(
  current: Extract<GeoJsonStructuralWork, { kind: 'coordinates' }>,
  work: GeoJsonStructuralWork[],
): SanitizedIssue | undefined {
  if (!Array.isArray(current.value)) {
    return geoJsonIssue('coordinates have the wrong nesting shape', current.path);
  }
  const values = current.value;
  if (current.role === 'position') {
    if (values.length < 2) {
      return geoJsonIssue('a position must contain at least two numbers', current.path);
    }
    for (let index = 0; index < values.length; index += 1) {
      const component = ownValue(values, String(index));
      if (typeof component !== 'number' || !Number.isFinite(component)) {
        return geoJsonIssue(
          'position components must be finite numbers', pathWith(current.path, index),
        );
      }
    }
    return undefined;
  }
  if (current.role === 'line' && values.length < 2) {
    return geoJsonIssue('a LineString must contain at least two positions', current.path);
  }
  if (current.role === 'ring' && values.length < 4) {
    return geoJsonIssue('a linear ring must contain at least four positions', current.path);
  }
  if (current.role === 'ring') {
    appendOwn(work, { kind: 'ringClosure', value: values, path: current.path });
    pushArrayCoordinateChildren(work, values, current.path, 'position');
    return undefined;
  }
  const childRole: CoordinateRole = current.role === 'positions'
    || current.role === 'line'
    ? 'position'
    : current.role === 'lines' ? 'line'
      : current.role === 'polygon' ? 'ring' : 'polygon';
  pushArrayCoordinateChildren(work, values, current.path, childRole);
  return undefined;
}

function checkFeatureObject(
  value: { [key: string]: JsonValue },
  path: (string | number)[],
  work: GeoJsonStructuralWork[],
): SanitizedIssue | undefined {
  if (ownValue(value, 'type') !== 'Feature') {
    return geoJsonIssue("Feature type must be 'Feature'", pathWith(path, 'type'));
  }
  const bboxIssue = validateBbox(value, path);
  if (bboxIssue !== undefined) return bboxIssue;
  const id = ownValue(value, 'id');
  if (id !== undefined && !(
    typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))
  )) return geoJsonIssue('Feature id must be a string or finite number', pathWith(path, 'id'));
  const geometry = ownValue(value, 'geometry');
  if (geometry === undefined) {
    return geoJsonIssue('Feature geometry is required', pathWith(path, 'geometry'));
  }
  if (geometry !== null) {
    if (!isJsonObject(geometry)) {
      return geoJsonIssue('Feature geometry must be a geometry or null', pathWith(path, 'geometry'));
    }
    pushStructuralObject(work, geometry, pathWith(path, 'geometry'), 'geometry');
  }
  const properties = ownValue(value, 'properties');
  if (properties !== null && !isJsonObject(properties)) {
    return geoJsonIssue(
      'Feature properties must be an object or null', pathWith(path, 'properties'),
    );
  }
  return undefined;
}

function checkFeatureCollectionObject(
  value: { [key: string]: JsonValue },
  path: (string | number)[],
  work: GeoJsonStructuralWork[],
): SanitizedIssue | undefined {
  const bboxIssue = validateBbox(value, path);
  if (bboxIssue !== undefined) return bboxIssue;
  const features = ownValue(value, 'features');
  const featuresPath = pathWith(path, 'features');
  if (!Array.isArray(features)) {
    return geoJsonIssue('FeatureCollection features must be an array', featuresPath);
  }
  for (let index = features.length - 1; index >= 0; index -= 1) {
    pushStructuralObject(
      work,
      ownValue(features, String(index)) as JsonValue,
      pathWith(featuresPath, index),
      'feature',
    );
  }
  return undefined;
}

function checkGeometryObject(
  value: { [key: string]: JsonValue },
  path: (string | number)[],
  work: GeoJsonStructuralWork[],
): SanitizedIssue | undefined {
  const type = ownValue(value, 'type');
  if (typeof type !== 'string' || !GEOJSON_GEOMETRY_TYPES.has(type)) {
    return geoJsonIssue('Unknown GeoJSON geometry type', pathWith(path, 'type'));
  }
  const bboxIssue = validateBbox(value, path);
  if (bboxIssue !== undefined) return bboxIssue;
  if (type === 'GeometryCollection') {
    const geometries = ownValue(value, 'geometries');
    const geometriesPath = pathWith(path, 'geometries');
    if (!Array.isArray(geometries)) {
      return geoJsonIssue('GeometryCollection geometries must be an array', geometriesPath);
    }
    for (let index = geometries.length - 1; index >= 0; index -= 1) {
      pushStructuralObject(
        work,
        ownValue(geometries, String(index)) as JsonValue,
        pathWith(geometriesPath, index),
        'geometry',
      );
    }
    return undefined;
  }
  const coordinates = ownValue(value, 'coordinates');
  const coordinatesPath = pathWith(path, 'coordinates');
  if (coordinates === undefined) {
    return geoJsonIssue('Geometry coordinates are required', coordinatesPath);
  }
  const coordinateRole: CoordinateRole = type === 'Point' ? 'position'
    : type === 'MultiPoint' ? 'positions'
      : type === 'LineString' ? 'line'
        : type === 'MultiLineString' ? 'lines'
          : type === 'Polygon' ? 'polygon' : 'polygons';
  pushCoordinates(work, coordinates as JsonValue, coordinatesPath, coordinateRole);
  return undefined;
}

function inlineGeoJsonIssue(value: JsonValue): SanitizedIssue | undefined {
  const work: GeoJsonStructuralWork[] = [];
  pushStructuralObject(work, value, [], 'top');
  while (work.length > 0) {
    const current = work.pop();
    if (current === undefined) return geoJsonIssue('GeoJSON validation failed', []);
    if (current.kind === 'ringClosure') {
      const first = ownValue(current.value, '0') as JsonValue;
      const last = ownValue(current.value, String(current.value.length - 1)) as JsonValue;
      if (!jsonValuesEqual(first, last)) {
        return geoJsonIssue('a linear ring must be closed', current.path);
      }
      continue;
    }
    if (current.kind === 'coordinates') {
      const issue = checkCoordinateWork(current, work);
      if (issue !== undefined) return issue;
      continue;
    }
    if (!isJsonObject(current.value)) {
      return geoJsonIssue('GeoJSON members must be objects', current.path);
    }
    if (current.role === 'feature') {
      const issue = checkFeatureObject(current.value, current.path, work);
      if (issue !== undefined) return issue;
      continue;
    }
    if (current.role === 'geometry') {
      const issue = checkGeometryObject(current.value, current.path, work);
      if (issue !== undefined) return issue;
      continue;
    }
    const type = ownValue(current.value, 'type');
    if (typeof type !== 'string' || !GEOJSON_TYPES.has(type)) {
      return geoJsonIssue('Unknown GeoJSON type', pathWith(current.path, 'type'));
    }
    const issue = type === 'Feature'
      ? checkFeatureObject(current.value, current.path, work)
      : type === 'FeatureCollection'
        ? checkFeatureCollectionObject(current.value, current.path, work)
        : checkGeometryObject(current.value, current.path, work);
    if (issue !== undefined) return issue;
  }
  return undefined;
}

function fallbackGeoJsonLimits(value: JsonValue): JsonValue | undefined {
  if (!isJsonObject(value) || !hasOnlyKeys(value, GEOJSON_LIMIT_KEYS)) return undefined;
  for (const key of GEOJSON_LIMIT_KEYS) {
    const limit = ownValue(value, key);
    if (limit !== undefined && (!Number.isSafeInteger(limit) || (limit as number) <= 0)) {
      return undefined;
    }
  }
  return value;
}

const positiveSafeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value > 0,
  { message: 'Expected a positive safe integer' },
);
const geoJsonLimitsInnerSchema = z.object({
  maxBytes: positiveSafeIntegerSchema,
  maxFeatures: positiveSafeIntegerSchema,
  maxCoordinatePositions: positiveSafeIntegerSchema,
  maxGeometryDepth: positiveSafeIntegerSchema,
  maxPropertyDepth: positiveSafeIntegerSchema,
}).strict().partial() satisfies z.ZodType<Partial<GeoJsonLimits>>;

export const geoJsonLimitsSchema = sanitizeBefore(
  geoJsonLimitsInnerSchema, undefined, fallbackGeoJsonLimits,
) as z.ZodType<Partial<GeoJsonLimits>>;

const inlineGeoJsonInnerSchema = z.custom<InlineGeoJson>();
export const inlineGeoJsonSchema = sanitizeBefore(
  inlineGeoJsonInnerSchema,
  inlineGeoJsonIssue,
) as z.ZodType<InlineGeoJson>;

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
const filterArrayInnerSchema = z.array(jsonValueInnerSchema);
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
  undefined,
  fallbackSetLayerOperation,
  fallbackSetLayerOperationIssue,
);

const setStyleRootPropertiesOperationInnerSchema = z.object({
  op: z.literal('setStyleRootProperties'),
  properties: jsonObjectInnerSchema,
}).strict().refine((operation) => (
  Object.keys(operation.properties).every((key) => !PROTECTED_ROOT_KEYS.has(key))
), {
  message: 'Root style properties cannot include version, sources, or layers',
  path: ['properties'],
}) satisfies z.ZodType<SetStyleRootPropertiesOperation>;

export const setStyleRootPropertiesOperationSchema = sanitizeBefore(
  setStyleRootPropertiesOperationInnerSchema,
  undefined,
  fallbackRootOperation,
);

const setLayerFilterOperationInnerSchema = z.discriminatedUnion('mode', [
  z.object({
    op: z.literal('setLayerFilter'),
    layerId: z.string().min(1),
    mode: z.enum(['replace', 'and', 'or']),
    filter: filterArrayInnerSchema,
  }).strict(),
  z.object({
    op: z.literal('setLayerFilter'),
    layerId: z.string().min(1),
    mode: z.literal('clear'),
  }).strict(),
]) satisfies z.ZodType<SetLayerFilterOperation>;

export const setLayerFilterOperationSchema = sanitizeBefore(
  setLayerFilterOperationInnerSchema,
  undefined,
  (value) => fallbackFilterOperation(value, 'setLayerFilter'),
);

const setGeoJsonSourceFilterOperationInnerSchema = z.discriminatedUnion('mode', [
  z.object({
    op: z.literal('setGeoJsonSourceFilter'),
    sourceId: z.string().min(1),
    mode: z.literal('replace'),
    filter: filterArrayInnerSchema,
  }).strict(),
  z.object({
    op: z.literal('setGeoJsonSourceFilter'),
    sourceId: z.string().min(1),
    mode: z.literal('clear'),
  }).strict(),
]) satisfies z.ZodType<SetGeoJsonSourceFilterOperation>;

export const setGeoJsonSourceFilterOperationSchema = sanitizeBefore(
  setGeoJsonSourceFilterOperationInnerSchema,
  undefined,
  (value) => fallbackFilterOperation(value, 'setGeoJsonSourceFilter'),
);

const styleOperationInnerSchema = z.discriminatedUnion('op', [
  setLayerPropertiesOperationInnerSchema,
  setStyleRootPropertiesOperationInnerSchema,
  setLayerFilterOperationInnerSchema,
  setGeoJsonSourceFilterOperationInnerSchema,
]) satisfies z.ZodType<StyleOperation>;

type StyleOperationSchemaOutput = StyleOperation & Pick<
  SetLayerPropertiesOperation, 'paint'
>;

export const styleOperationSchema = sanitizeBefore(
  styleOperationInnerSchema,
  fallbackOperationIssue,
  fallbackOperation,
  fallbackOperationIssue,
) as z.ZodType<StyleOperationSchemaOutput>;

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
