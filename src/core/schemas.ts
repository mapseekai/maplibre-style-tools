import { z } from 'zod';
import { jsonValuesEqual } from './diff.js';
import { DEFAULT_MAX_OPERATIONS } from './utf8.js';
import { classifyFilter, LEGACY_FILTER_MESSAGE } from './operations/filters.js';
import type {
  AddGeoJsonLayerOperation, AddLayerFromSourceOperation, AddSourceOperation,
  AddLayerDefinitionOperation, DefinitionStyleOperation,
  DeepMergeLayerDefinitionOperation, DeepMergeSourceDefinitionOperation,
  DuplicateLayerOperation, DuplicateSourceOperation,
  GeoJsonAnalysisInput, GeoJsonAnalysisOptions, GeoJsonLimits,
  InlineGeoJson, JsonObject, JsonPrimitive, JsonValue,
  LayerLifecycleOperation, ListSourceLayersOptions,
  MoveLayerOperation, PatchSourceOperation,
  RemoveLayerOperation, RemoveSourceOperation, RenameSourceOperation,
  ReplaceLayerDefinitionOperation, ReplaceRootPropertyOperation,
  ReplaceSourceDefinitionOperation, ShallowPatchRootPropertyOperation,
  ReorderLayersOperation,
  SetGeoJsonSourceFilterOperation,
  SetGeoJsonDataOperation,
  SetLayerFilterOperation, SetLayerPropertiesOperation,
  SetStyleRootPropertiesOperation, SourceOperation, StyleOperation, StyleTransaction,
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
type PathToken = string | number;
type LayerLifecycleIssue = z.core.$ZodIssue & { path: PathToken[] };
type PathNode = {
  parent: PathNode | undefined;
  token: PathToken;
  depth: number;
};
type Path = PathNode | undefined;
type SnapshotWork = {
  source: object;
  target: JsonContainer;
  path: Path;
};
type SnapshotResult =
  | { success: true; value: JsonValue }
  | { success: false; path: Path };
type SanitizedIssue = z.core.$ZodIssue;
type SanitizedCheck = (value: JsonValue) => SanitizedIssue | undefined;
type FallbackValidator = (value: JsonValue) => JsonValue | undefined;
type FallbackIssueResult = z.core.$ZodIssue | readonly z.core.$ZodIssue[] | undefined;
type FallbackIssue = (value: JsonValue) => FallbackIssueResult;

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

function issueItems(value: Exclude<FallbackIssueResult, undefined>): z.core.$ZodIssue[] {
  if (!Array.isArray(value)) return oneItem(value as z.core.$ZodIssue);
  const issues: z.core.$ZodIssue[] = [];
  for (const issue of value) appendOwn(issues, issue);
  return issues;
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
  path: Path,
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

function childPath(parent: Path, token: PathToken): PathNode {
  return { parent, token, depth: (parent?.depth ?? 0) + 1 };
}

function materializePath(path: Path): PathToken[] {
  if (path === undefined) return [];
  const result: PathToken[] = [];
  let current: Path = path;
  while (current !== undefined) {
    Reflect.defineProperty(result, current.depth - 1, {
      configurable: true,
      enumerable: true,
      value: current.token,
      writable: true,
    });
    current = current.parent;
  }
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
    if (typeof input !== 'object' || input === null) {
      return { success: false, path: undefined };
    }

    const seen = new WeakSet<object>();
    const work: SnapshotWork[] = [];
    const root = createSnapshotValue(input, seen, work, undefined);
    if (root === INVALID_SNAPSHOT) return { success: false, path: undefined };

    while (work.length > 0) {
      const current = work.pop();
      if (current === undefined) return { success: false, path: undefined };
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
        const valuePath = sourceIsArray && key === 'length'
          ? current.path
          : childPath(current.path, sourceIsArray ? Number(key) : key);
        const descriptor = descriptors[key];
        if (descriptor === undefined || !('value' in descriptor)) {
          return { success: false, path: valuePath };
        }
        if (sourceIsArray && key === 'length') continue;
        if (!descriptor.enumerable || DANGEROUS_KEYS.has(key)) {
          return { success: false, path: valuePath };
        }
        if (sourceIsArray) {
          if (!isCanonicalArrayIndex(key, arrayLength)) {
            return { success: false, path: valuePath };
          }
          arrayIndexes += 1;
        }
        const snapshotValue = createSnapshotValue(descriptor.value, seen, work, valuePath);
        if (snapshotValue === INVALID_SNAPSHOT) {
          return { success: false, path: valuePath };
        }
        if (!Reflect.defineProperty(current.target, sourceIsArray ? Number(key) : key, {
          configurable: true,
          enumerable: true,
          value: snapshotValue,
          writable: true,
        })) return { success: false, path: valuePath };
      }
      if (sourceIsArray && arrayIndexes !== arrayLength) {
        return { success: false, path: current.path };
      }
    }
    return { success: true, value: root };
  } catch {
    return { success: false, path: undefined };
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
const ADD_SOURCE_OPERATION_KEYS = new Set(['op', 'sourceId', 'source']);
const DUPLICATE_SOURCE_OPERATION_KEYS = new Set([
  'op', 'sourceId', 'newSourceId', 'overrides',
]);
const RENAME_SOURCE_OPERATION_KEYS = new Set(['op', 'sourceId', 'newSourceId']);
const REMOVE_SOURCE_OPERATION_KEYS = new Set(['op', 'sourceId', 'cascadeLayers']);
const PATCH_SOURCE_OPERATION_KEYS = new Set(['op', 'sourceId', 'patch']);
const SET_GEOJSON_DATA_OPERATION_KEYS = new Set(['op', 'sourceId', 'data']);
const DUPLICATE_LAYER_OPERATION_KEYS = new Set([
  'op', 'layerId', 'newLayerId', 'overrides', 'beforeId', 'afterId',
]);
const MOVE_LAYER_OPERATION_KEYS = new Set(['op', 'layerId', 'beforeId', 'afterId']);
const REORDER_LAYERS_OPERATION_KEYS = new Set([
  'op', 'layerIds', 'beforeId', 'afterId',
]);
const REMOVE_LAYER_OPERATION_KEYS = new Set(['op', 'layerId']);
const ADD_LAYER_FROM_SOURCE_OPERATION_KEYS = new Set([
  'op', 'layerId', 'sourceId', 'sourceLayer', 'type',
  'paint', 'layout', 'filter', 'minzoom', 'maxzoom', 'metadata',
  'beforeId', 'afterId',
]);
const ADD_GEOJSON_LAYER_OPERATION_KEYS = new Set([
  'op', 'sourceId', 'layerId', 'data', 'sourceOptions', 'type',
  'paint', 'layout', 'filter', 'minzoom', 'maxzoom', 'metadata',
  'beforeId', 'afterId',
]);
const ADD_LAYER_DEFINITION_OPERATION_KEYS = new Set(['op', 'layer', 'beforeId']);
const DEEP_MERGE_LAYER_DEFINITION_OPERATION_KEYS = new Set(['op', 'layerId', 'patch']);
const REPLACE_LAYER_DEFINITION_OPERATION_KEYS = new Set(['op', 'layerId', 'layer']);
const DEEP_MERGE_SOURCE_DEFINITION_OPERATION_KEYS = new Set(['op', 'sourceId', 'patch']);
const REPLACE_SOURCE_DEFINITION_OPERATION_KEYS = new Set(['op', 'sourceId', 'source']);
const REPLACE_ROOT_PROPERTY_OPERATION_KEYS = new Set(['op', 'property', 'value']);
const SHALLOW_PATCH_ROOT_PROPERTY_OPERATION_KEYS = new Set(['op', 'property', 'patch']);
const GEOJSON_LAYER_TYPE_VALUES = [
  'fill', 'line', 'symbol', 'circle', 'heatmap', 'fill-extrusion',
] as const;
const GEOJSON_LAYER_TYPES = new Set<string>(GEOJSON_LAYER_TYPE_VALUES);
const PROTECTED_ROOT_KEYS = new Set(['version', 'sources', 'layers']);
const REPLACE_ROOT_PROPERTIES = new Set([
  'metadata', 'transition', 'sky', 'projection', 'terrain',
]);

function fallbackDefinitionOperation(
  value: JsonValue,
  expectedOperation?: DefinitionStyleOperation['op'],
): JsonValue | undefined {
  if (!isJsonObject(value)) return undefined;
  const operation = ownValue(value, 'op');
  if (expectedOperation !== undefined && operation !== expectedOperation) return undefined;
  switch (operation) {
    case 'addLayerDefinition': {
      const beforeId = ownValue(value, 'beforeId');
      return hasOnlyKeys(value, ADD_LAYER_DEFINITION_OPERATION_KEYS)
        && isJsonObject(ownValue(value, 'layer'))
        && (beforeId === undefined || validLayerLifecycleId(beforeId)) ? value : undefined;
    }
    case 'deepMergeLayerDefinition':
      return hasOnlyKeys(value, DEEP_MERGE_LAYER_DEFINITION_OPERATION_KEYS)
        && validLayerLifecycleId(ownValue(value, 'layerId'))
        && isJsonObject(ownValue(value, 'patch')) ? value : undefined;
    case 'replaceLayerDefinition':
      return hasOnlyKeys(value, REPLACE_LAYER_DEFINITION_OPERATION_KEYS)
        && validLayerLifecycleId(ownValue(value, 'layerId'))
        && isJsonObject(ownValue(value, 'layer')) ? value : undefined;
    case 'deepMergeSourceDefinition':
      return hasOnlyKeys(value, DEEP_MERGE_SOURCE_DEFINITION_OPERATION_KEYS)
        && validSourceId(ownValue(value, 'sourceId'))
        && isJsonObject(ownValue(value, 'patch')) ? value : undefined;
    case 'replaceSourceDefinition':
      return hasOnlyKeys(value, REPLACE_SOURCE_DEFINITION_OPERATION_KEYS)
        && validSourceId(ownValue(value, 'sourceId'))
        && isJsonObject(ownValue(value, 'source')) ? value : undefined;
    case 'replaceRootProperty': {
      const rootValue = ownValue(value, 'value');
      return hasOnlyKeys(value, REPLACE_ROOT_PROPERTY_OPERATION_KEYS)
        && REPLACE_ROOT_PROPERTIES.has(ownValue(value, 'property') as string)
        && (rootValue === null || isJsonObject(rootValue)) ? value : undefined;
    }
    case 'shallowPatchRootProperty':
      return hasOnlyKeys(value, SHALLOW_PATCH_ROOT_PROPERTY_OPERATION_KEYS)
        && ownValue(value, 'property') === 'light'
        && isJsonObject(ownValue(value, 'patch')) ? value : undefined;
    default:
      return undefined;
  }
}

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

function validSourceId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validLayerLifecycleId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function fallbackSourceOperation(
  value: JsonValue,
  expectedOperation?: SourceOperation['op'],
): JsonValue | undefined {
  if (!isJsonObject(value)) return undefined;
  const operation = ownValue(value, 'op');
  if (expectedOperation !== undefined && operation !== expectedOperation) return undefined;
  const sourceId = ownValue(value, 'sourceId');
  if (!validSourceId(sourceId)) return undefined;

  switch (operation) {
    case 'addSource':
      return hasOnlyKeys(value, ADD_SOURCE_OPERATION_KEYS)
        && isJsonObject(ownValue(value, 'source')) ? value : undefined;
    case 'duplicateSource': {
      if (!hasOnlyKeys(value, DUPLICATE_SOURCE_OPERATION_KEYS)
        || !validSourceId(ownValue(value, 'newSourceId'))) return undefined;
      const overrides = ownValue(value, 'overrides');
      return overrides === undefined || isJsonObject(overrides) ? value : undefined;
    }
    case 'renameSource':
      return hasOnlyKeys(value, RENAME_SOURCE_OPERATION_KEYS)
        && validSourceId(ownValue(value, 'newSourceId')) ? value : undefined;
    case 'removeSource': {
      if (!hasOnlyKeys(value, REMOVE_SOURCE_OPERATION_KEYS)) return undefined;
      const cascadeLayers = ownValue(value, 'cascadeLayers');
      return cascadeLayers === undefined || typeof cascadeLayers === 'boolean'
        ? value
        : undefined;
    }
    case 'patchSource':
      return hasOnlyKeys(value, PATCH_SOURCE_OPERATION_KEYS)
        && isJsonObject(ownValue(value, 'patch')) ? value : undefined;
    case 'setGeoJsonData': {
      if (!hasOnlyKeys(value, SET_GEOJSON_DATA_OPERATION_KEYS)) return undefined;
      const data = ownValue(value, 'data') as JsonValue | undefined;
      return (typeof data === 'string' && data.trim().length > 0)
        || (data !== undefined && inlineGeoJsonIssue(data) === undefined)
        ? value
        : undefined;
    }
    default:
      return undefined;
  }
}

function validPlacement(value: JsonValue): boolean {
  if (!isJsonObject(value)) return false;
  const beforeId = ownValue(value, 'beforeId');
  const afterId = ownValue(value, 'afterId');
  return (beforeId === undefined || validLayerLifecycleId(beforeId))
    && (afterId === undefined || validLayerLifecycleId(afterId))
    && !(beforeId !== undefined && afterId !== undefined);
}

function fallbackLayerLifecycleOperation(
  value: JsonValue,
  expectedOperation?: LayerLifecycleOperation['op'],
): JsonValue | undefined {
  if (!isJsonObject(value) || !validPlacement(value)) return undefined;
  const operation = ownValue(value, 'op');
  if (expectedOperation !== undefined && operation !== expectedOperation) return undefined;

  switch (operation) {
    case 'duplicateLayer': {
      if (!hasOnlyKeys(value, DUPLICATE_LAYER_OPERATION_KEYS)
        || !validLayerLifecycleId(ownValue(value, 'layerId'))
        || !validLayerLifecycleId(ownValue(value, 'newLayerId'))) return undefined;
      const overrides = ownValue(value, 'overrides');
      return (overrides === undefined
        || (isJsonObject(overrides) && !Object.hasOwn(overrides, 'id')))
        ? value
        : undefined;
    }
    case 'moveLayer': {
      if (!hasOnlyKeys(value, MOVE_LAYER_OPERATION_KEYS)) return undefined;
      const layerId = ownValue(value, 'layerId');
      if (!validLayerLifecycleId(layerId)) return undefined;
      return ownValue(value, 'beforeId') === layerId
        || ownValue(value, 'afterId') === layerId
        ? undefined
        : value;
    }
    case 'reorderLayers': {
      if (!hasOnlyKeys(value, REORDER_LAYERS_OPERATION_KEYS)) return undefined;
      const layerIds = ownValue(value, 'layerIds');
      if (!Array.isArray(layerIds) || layerIds.length === 0) return undefined;
      const seen = new Set<string>();
      for (let index = 0; index < layerIds.length; index += 1) {
        const layerId = ownValue(layerIds, String(index));
        if (!validLayerLifecycleId(layerId) || seen.has(layerId)) return undefined;
        seen.add(layerId);
      }
      const anchorId = ownValue(value, 'beforeId') ?? ownValue(value, 'afterId');
      return typeof anchorId === 'string' && seen.has(anchorId) ? undefined : value;
    }
    case 'removeLayer':
      return hasOnlyKeys(value, REMOVE_LAYER_OPERATION_KEYS)
        && validLayerLifecycleId(ownValue(value, 'layerId')) ? value : undefined;
    case 'addLayerFromSource': {
      if (!hasOnlyKeys(value, ADD_LAYER_FROM_SOURCE_OPERATION_KEYS)
        || !validLayerLifecycleId(ownValue(value, 'layerId'))
        || !validLayerLifecycleId(ownValue(value, 'sourceId'))
        || !validLayerLifecycleId(ownValue(value, 'type'))) return undefined;
      const sourceLayer = ownValue(value, 'sourceLayer');
      if (sourceLayer !== undefined && !validLayerLifecycleId(sourceLayer)) return undefined;
      for (const field of ['paint', 'layout', 'metadata'] as const) {
        const fieldValue = ownValue(value, field);
        if (fieldValue !== undefined && !isJsonObject(fieldValue)) return undefined;
      }
      const filter = ownValue(value, 'filter');
      if (filter !== undefined && !Array.isArray(filter)) return undefined;
      const minzoom = ownValue(value, 'minzoom');
      const maxzoom = ownValue(value, 'maxzoom');
      if ((minzoom !== undefined && !(
        typeof minzoom === 'number' && Number.isFinite(minzoom)
        && minzoom >= 0 && minzoom <= 24
      )) || (maxzoom !== undefined && !(
        typeof maxzoom === 'number' && Number.isFinite(maxzoom)
        && maxzoom >= 0 && maxzoom <= 24
      ))) return undefined;
      return typeof minzoom === 'number' && typeof maxzoom === 'number'
        && minzoom > maxzoom ? undefined : value;
    }
    case 'addGeoJsonLayer': {
      if (!hasOnlyKeys(value, ADD_GEOJSON_LAYER_OPERATION_KEYS)
        || !validLayerLifecycleId(ownValue(value, 'sourceId'))
        || !validLayerLifecycleId(ownValue(value, 'layerId'))
        || !GEOJSON_LAYER_TYPES.has(ownValue(value, 'type') as string)) return undefined;
      const data = ownValue(value, 'data') as JsonValue | undefined;
      if (!((typeof data === 'string' && data.trim().length > 0)
        || (data !== undefined && inlineGeoJsonIssue(data) === undefined))) return undefined;
      const sourceOptions = ownValue(value, 'sourceOptions');
      if (sourceOptions !== undefined && (
        !isJsonObject(sourceOptions)
        || Object.hasOwn(sourceOptions, 'type')
        || Object.hasOwn(sourceOptions, 'data')
      )) return undefined;
      for (const field of ['paint', 'layout', 'metadata'] as const) {
        const fieldValue = ownValue(value, field);
        if (fieldValue !== undefined && !isJsonObject(fieldValue)) return undefined;
      }
      const filter = ownValue(value, 'filter');
      if (filter !== undefined && !Array.isArray(filter)) return undefined;
      const minzoom = ownValue(value, 'minzoom');
      const maxzoom = ownValue(value, 'maxzoom');
      if ((minzoom !== undefined && !(
        typeof minzoom === 'number' && Number.isFinite(minzoom)
        && minzoom >= 0 && minzoom <= 24
      )) || (maxzoom !== undefined && !(
        typeof maxzoom === 'number' && Number.isFinite(maxzoom)
        && maxzoom >= 0 && maxzoom <= 24
      ))) return undefined;
      return typeof minzoom === 'number' && typeof maxzoom === 'number'
        && minzoom > maxzoom ? undefined : value;
    }
    default:
      return undefined;
  }
}

function nonEmptyStringIssue(path: PathToken[]): LayerLifecycleIssue {
  return { code: 'custom', path, message: 'Expected a non-empty string' };
}

function receivedType(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function invalidTypeIssue(
  expected: 'string' | 'record' | 'array' | 'number' | 'boolean',
  value: unknown,
  path: PathToken[],
): LayerLifecycleIssue {
  return {
    expected,
    code: 'invalid_type',
    path,
    message: `Invalid input: expected ${expected}, received ${receivedType(value)}`,
  } as LayerLifecycleIssue;
}

function literalIssue(expected: string): LayerLifecycleIssue {
  return {
    code: 'invalid_value', values: [expected], path: ['op'],
    message: `Invalid input: expected ${JSON.stringify(expected)}`,
  } as LayerLifecycleIssue;
}

function minLengthStringIssue(path: PathToken[]): LayerLifecycleIssue {
  return {
    origin: 'string', code: 'too_small', minimum: 1, inclusive: true,
    path, message: 'Too small: expected string to have >=1 characters',
  } as LayerLifecycleIssue;
}

function requiredMinLengthStringIssue(
  value: JsonObject,
  field: 'layerId' | 'sourceId' | 'newSourceId',
): LayerLifecycleIssue | undefined {
  const fieldValue = ownValue(value, field);
  if (typeof fieldValue !== 'string') return invalidTypeIssue('string', fieldValue, [field]);
  return fieldValue.length > 0 ? undefined : minLengthStringIssue([field]);
}

function unrecognizedKeysIssue(
  value: JsonObject,
  allowed: ReadonlySet<string>,
): LayerLifecycleIssue | undefined {
  const keys = Reflect.ownKeys(value).filter((key): key is string => (
    typeof key === 'string' && !allowed.has(key)
  ));
  if (keys.length === 0) return undefined;
  const quoted = keys.map((key) => `"${key}"`).join(', ');
  return {
    code: 'unrecognized_keys', keys, path: [],
    message: keys.length === 1
      ? `Unrecognized key: ${quoted}`
      : `Unrecognized keys: ${quoted}`,
  } as LayerLifecycleIssue;
}

function requiredNonEmptyStringIssue(
  value: JsonObject,
  field: 'layerId' | 'newLayerId' | 'sourceId' | 'type',
): LayerLifecycleIssue | undefined {
  const fieldValue = ownValue(value, field);
  if (typeof fieldValue !== 'string') return invalidTypeIssue('string', fieldValue, [field]);
  return validLayerLifecycleId(fieldValue) ? undefined : nonEmptyStringIssue([field]);
}

function optionalNonEmptyStringIssue(
  value: JsonObject,
  field: 'sourceLayer' | 'beforeId' | 'afterId',
): LayerLifecycleIssue | undefined {
  const fieldValue = ownValue(value, field);
  if (fieldValue === undefined) return undefined;
  if (typeof fieldValue !== 'string') return invalidTypeIssue('string', fieldValue, [field]);
  return validLayerLifecycleId(fieldValue) ? undefined : nonEmptyStringIssue([field]);
}

function optionalObjectIssue(
  value: JsonObject,
  field: 'paint' | 'layout' | 'metadata',
): LayerLifecycleIssue | undefined {
  const fieldValue = ownValue(value, field);
  return fieldValue === undefined || isJsonObject(fieldValue)
    ? undefined
    : invalidTypeIssue('record', fieldValue, [field]);
}

function optionalZoomIssue(
  value: JsonObject,
  field: 'minzoom' | 'maxzoom',
): LayerLifecycleIssue | undefined {
  const fieldValue = ownValue(value, field);
  if (fieldValue === undefined) return undefined;
  if (typeof fieldValue !== 'number') return invalidTypeIssue('number', fieldValue, [field]);
  if (fieldValue < 0) {
    return {
      origin: 'number', code: 'too_small', minimum: 0, inclusive: true,
      path: [field], message: 'Too small: expected number to be >=0',
    } as LayerLifecycleIssue;
  }
  if (fieldValue > 24) {
    return {
      origin: 'number', code: 'too_big', maximum: 24, inclusive: true,
      path: [field], message: 'Too big: expected number to be <=24',
    } as LayerLifecycleIssue;
  }
  return undefined;
}

function fallbackAddLayerFromSourceIssue(
  value: JsonObject,
): LayerLifecycleIssue | undefined {
  const fieldIssue = requiredNonEmptyStringIssue(value, 'layerId')
    ?? requiredNonEmptyStringIssue(value, 'sourceId')
    ?? optionalNonEmptyStringIssue(value, 'sourceLayer')
    ?? requiredNonEmptyStringIssue(value, 'type')
    ?? optionalObjectIssue(value, 'paint')
    ?? optionalObjectIssue(value, 'layout');
  if (fieldIssue !== undefined) return fieldIssue;

  const filter = ownValue(value, 'filter');
  if (filter !== undefined && !Array.isArray(filter)) {
    return invalidTypeIssue('array', filter, ['filter']);
  }
  const laterFieldIssue = optionalZoomIssue(value, 'minzoom')
    ?? optionalZoomIssue(value, 'maxzoom')
    ?? optionalObjectIssue(value, 'metadata')
    ?? optionalNonEmptyStringIssue(value, 'beforeId')
    ?? optionalNonEmptyStringIssue(value, 'afterId');
  if (laterFieldIssue !== undefined) return laterFieldIssue;

  const unknownKeysIssue = unrecognizedKeysIssue(value, ADD_LAYER_FROM_SOURCE_OPERATION_KEYS);
  if (unknownKeysIssue !== undefined) return unknownKeysIssue;
  if (ownValue(value, 'beforeId') !== undefined
    && ownValue(value, 'afterId') !== undefined) {
    return {
      code: 'custom', message: 'Placement cannot specify both beforeId and afterId',
      path: ['afterId'],
    };
  }
  const minzoom = ownValue(value, 'minzoom');
  const maxzoom = ownValue(value, 'maxzoom');
  return typeof minzoom === 'number' && typeof maxzoom === 'number'
    && minzoom > maxzoom
    ? {
        code: 'custom', message: 'minzoom must be less than or equal to maxzoom',
        path: ['maxzoom'],
      }
    : undefined;
}

function geoJsonLayerTypeIssue(value: unknown): LayerLifecycleIssue | undefined {
  return typeof value === 'string' && GEOJSON_LAYER_TYPES.has(value)
    ? undefined
    : {
        code: 'invalid_value', values: [...GEOJSON_LAYER_TYPE_VALUES], path: ['type'],
        message: 'Invalid option: expected one of '
          + GEOJSON_LAYER_TYPE_VALUES.map((item) => `"${item}"`).join('|'),
      } as LayerLifecycleIssue;
}

function fallbackGeoJsonLayerDataIssue(
  data: JsonValue | undefined,
): LayerLifecycleIssue | undefined {
  if (typeof data === 'string') {
    return data.trim().length > 0 ? undefined : nonEmptyStringIssue(['data']);
  }
  const inlineIssue = data === undefined
    ? { code: 'custom', message: INVALID_JSON_MESSAGE, path: [] }
    : inlineGeoJsonIssue(data);
  if (inlineIssue === undefined) return undefined;
  return {
    code: 'invalid_union',
    errors: [
      [invalidTypeIssue('string', data, [])],
      [{ ...inlineIssue, path: inlineIssue.path ?? [] }],
    ],
    path: ['data'],
    message: 'Invalid input',
  } as LayerLifecycleIssue;
}

function fallbackAddGeoJsonLayerIssue(
  value: JsonObject,
): readonly LayerLifecycleIssue[] | undefined {
  const issues: LayerLifecycleIssue[] = [];
  let blocking = false;
  for (const field of ['sourceId', 'layerId'] as const) {
    const issue = requiredNonEmptyStringIssue(value, field);
    if (issue !== undefined) {
      appendOwn(issues, issue);
      if (issue.code === 'invalid_type') blocking = true;
    }
  }
  const dataIssue = fallbackGeoJsonLayerDataIssue(
    ownValue(value, 'data') as JsonValue | undefined,
  );
  if (dataIssue !== undefined) {
    appendOwn(issues, dataIssue);
    if (dataIssue.code === 'invalid_union') blocking = true;
  }

  const sourceOptions = ownValue(value, 'sourceOptions');
  if (sourceOptions !== undefined && !isJsonObject(sourceOptions)) {
    appendOwn(issues, invalidTypeIssue('record', sourceOptions, ['sourceOptions']));
    blocking = true;
  }

  const typeIssue = geoJsonLayerTypeIssue(ownValue(value, 'type'));
  if (typeIssue !== undefined) {
    appendOwn(issues, typeIssue);
    blocking = true;
  }
  for (const field of ['paint', 'layout'] as const) {
    const issue = optionalObjectIssue(value, field);
    if (issue !== undefined) {
      appendOwn(issues, issue);
      blocking = true;
    }
  }
  const filter = ownValue(value, 'filter');
  if (filter !== undefined && !Array.isArray(filter)) {
    appendOwn(issues, invalidTypeIssue('array', filter, ['filter']));
    blocking = true;
  }
  for (const field of ['minzoom', 'maxzoom'] as const) {
    const issue = optionalZoomIssue(value, field);
    if (issue !== undefined) {
      appendOwn(issues, issue);
      if (issue.code === 'invalid_type') blocking = true;
    }
  }
  const metadataIssue = optionalObjectIssue(value, 'metadata');
  if (metadataIssue !== undefined) {
    appendOwn(issues, metadataIssue);
    blocking = true;
  }
  for (const field of ['beforeId', 'afterId'] as const) {
    const issue = optionalNonEmptyStringIssue(value, field);
    if (issue !== undefined) {
      appendOwn(issues, issue);
      if (issue.code === 'invalid_type') blocking = true;
    }
  }

  const unknownKeysIssue = unrecognizedKeysIssue(value, ADD_GEOJSON_LAYER_OPERATION_KEYS);
  if (unknownKeysIssue !== undefined) appendOwn(issues, unknownKeysIssue);

  if (!blocking && unknownKeysIssue === undefined) {
    if (isJsonObject(sourceOptions)) {
      if (Object.hasOwn(sourceOptions, 'type')) {
        appendOwn(issues, {
          code: 'custom', path: ['sourceOptions', 'type'],
          message: 'sourceOptions cannot include the authority key type',
        });
      }
      if (Object.hasOwn(sourceOptions, 'data')) {
        appendOwn(issues, {
          code: 'custom', path: ['sourceOptions', 'data'],
          message: 'sourceOptions cannot include the authority key data',
        });
      }
    }
    if (ownValue(value, 'beforeId') !== undefined
      && ownValue(value, 'afterId') !== undefined) {
      appendOwn(issues, {
        code: 'custom', message: 'Placement cannot specify both beforeId and afterId',
        path: ['afterId'],
      });
    }
    const minzoom = ownValue(value, 'minzoom');
    const maxzoom = ownValue(value, 'maxzoom');
    if (typeof minzoom === 'number' && typeof maxzoom === 'number'
      && minzoom > maxzoom) {
      appendOwn(issues, {
        code: 'custom', message: 'minzoom must be less than or equal to maxzoom',
        path: ['maxzoom'],
      });
    }
  }
  return issues.length === 0 ? undefined : issues;
}

function fallbackAddGeoJsonLayerFirstIssue(
  value: JsonObject,
): LayerLifecycleIssue | undefined {
  const fieldIssue = requiredNonEmptyStringIssue(value, 'sourceId')
    ?? requiredNonEmptyStringIssue(value, 'layerId');
  if (fieldIssue !== undefined) return fieldIssue;
  const dataIssue = fallbackGeoJsonLayerDataIssue(
    ownValue(value, 'data') as JsonValue | undefined,
  );
  if (dataIssue !== undefined) return dataIssue;

  const sourceOptions = ownValue(value, 'sourceOptions');
  if (sourceOptions !== undefined && !isJsonObject(sourceOptions)) {
    return invalidTypeIssue('record', sourceOptions, ['sourceOptions']);
  }
  if (isJsonObject(sourceOptions)) {
    if (Object.hasOwn(sourceOptions, 'type')) {
      return {
        code: 'custom', path: ['sourceOptions', 'type'],
        message: 'sourceOptions cannot include the authority key type',
      };
    }
    if (Object.hasOwn(sourceOptions, 'data')) {
      return {
        code: 'custom', path: ['sourceOptions', 'data'],
        message: 'sourceOptions cannot include the authority key data',
      };
    }
  }

  const laterFieldIssue = geoJsonLayerTypeIssue(ownValue(value, 'type'))
    ?? optionalObjectIssue(value, 'paint')
    ?? optionalObjectIssue(value, 'layout');
  if (laterFieldIssue !== undefined) return laterFieldIssue;
  const filter = ownValue(value, 'filter');
  if (filter !== undefined && !Array.isArray(filter)) {
    return invalidTypeIssue('array', filter, ['filter']);
  }
  const finalFieldIssue = optionalZoomIssue(value, 'minzoom')
    ?? optionalZoomIssue(value, 'maxzoom')
    ?? optionalObjectIssue(value, 'metadata')
    ?? optionalNonEmptyStringIssue(value, 'beforeId')
    ?? optionalNonEmptyStringIssue(value, 'afterId');
  if (finalFieldIssue !== undefined) return finalFieldIssue;

  const unknownKeysIssue = unrecognizedKeysIssue(value, ADD_GEOJSON_LAYER_OPERATION_KEYS);
  if (unknownKeysIssue !== undefined) return unknownKeysIssue;
  const completeIssues = fallbackAddGeoJsonLayerIssue(value);
  return completeIssues?.[0];
}

function fallbackLayerLifecycleOperationIssue(
  value: JsonValue,
  expectedOperation?: LayerLifecycleOperation['op'],
): LayerLifecycleIssue | readonly LayerLifecycleIssue[] | undefined {
  if (!isJsonObject(value)) return undefined;
  const operation = ownValue(value, 'op');
  if (expectedOperation !== undefined && operation !== expectedOperation) {
    return literalIssue(expectedOperation);
  }

  switch (operation) {
    case 'duplicateLayer': {
      const issue = requiredNonEmptyStringIssue(value, 'layerId')
        ?? requiredNonEmptyStringIssue(value, 'newLayerId');
      if (issue !== undefined) return issue;
      const overrides = ownValue(value, 'overrides');
      if (overrides !== undefined && !isJsonObject(overrides)) {
        return invalidTypeIssue('record', overrides, ['overrides']);
      }
      return optionalNonEmptyStringIssue(value, 'beforeId')
        ?? optionalNonEmptyStringIssue(value, 'afterId')
        ?? unrecognizedKeysIssue(value, DUPLICATE_LAYER_OPERATION_KEYS);
    }
    case 'moveLayer': {
      const issue = requiredNonEmptyStringIssue(value, 'layerId')
        ?? optionalNonEmptyStringIssue(value, 'beforeId')
        ?? optionalNonEmptyStringIssue(value, 'afterId');
      return issue ?? unrecognizedKeysIssue(value, MOVE_LAYER_OPERATION_KEYS);
    }
    case 'reorderLayers': {
      const layerIds = ownValue(value, 'layerIds');
      if (!Array.isArray(layerIds)) return invalidTypeIssue('array', layerIds, ['layerIds']);
      if (layerIds.length === 0) {
        return {
          origin: 'array', code: 'too_small', minimum: 1, inclusive: true,
          path: ['layerIds'], message: 'Too small: expected array to have >=1 items',
        } as LayerLifecycleIssue;
      }
      for (let index = 0; index < layerIds.length; index += 1) {
        const layerId = ownValue(layerIds, String(index));
        if (typeof layerId !== 'string') {
          return invalidTypeIssue('string', layerId, ['layerIds', index]);
        }
        if (!validLayerLifecycleId(layerId)) {
          return nonEmptyStringIssue(['layerIds', index]);
        }
      }
      return optionalNonEmptyStringIssue(value, 'beforeId')
        ?? optionalNonEmptyStringIssue(value, 'afterId')
        ?? unrecognizedKeysIssue(value, REORDER_LAYERS_OPERATION_KEYS);
    }
    case 'removeLayer':
      return requiredNonEmptyStringIssue(value, 'layerId')
        ?? unrecognizedKeysIssue(value, REMOVE_LAYER_OPERATION_KEYS);
    case 'addLayerFromSource':
      return fallbackAddLayerFromSourceIssue(value);
    case 'addGeoJsonLayer':
      return fallbackAddGeoJsonLayerIssue(value);
    default:
      return undefined;
  }
}

function fallbackSourceOperationIssue(value: JsonValue): LayerLifecycleIssue | undefined {
  if (!isJsonObject(value)) return undefined;
  const operation = ownValue(value, 'op');
  if (operation !== 'addSource'
    && operation !== 'duplicateSource'
    && operation !== 'renameSource'
    && operation !== 'removeSource'
    && operation !== 'patchSource'
    && operation !== 'setGeoJsonData') return undefined;
  const sourceIdIssue = requiredMinLengthStringIssue(value, 'sourceId');
  if (sourceIdIssue !== undefined) return sourceIdIssue;

  switch (operation) {
    case 'addSource': {
      const source = ownValue(value, 'source');
      if (!isJsonObject(source)) return invalidTypeIssue('record', source, ['source']);
      return unrecognizedKeysIssue(value, ADD_SOURCE_OPERATION_KEYS);
    }
    case 'duplicateSource': {
      const newSourceIdIssue = requiredMinLengthStringIssue(value, 'newSourceId');
      if (newSourceIdIssue !== undefined) return newSourceIdIssue;
      const overrides = ownValue(value, 'overrides');
      if (overrides !== undefined && !isJsonObject(overrides)) {
        return invalidTypeIssue('record', overrides, ['overrides']);
      }
      return unrecognizedKeysIssue(value, DUPLICATE_SOURCE_OPERATION_KEYS);
    }
    case 'renameSource':
      return requiredMinLengthStringIssue(value, 'newSourceId')
        ?? unrecognizedKeysIssue(value, RENAME_SOURCE_OPERATION_KEYS);
    case 'removeSource': {
      const cascadeLayers = ownValue(value, 'cascadeLayers');
      if (cascadeLayers !== undefined && typeof cascadeLayers !== 'boolean') {
        return invalidTypeIssue('boolean', cascadeLayers, ['cascadeLayers']);
      }
      return unrecognizedKeysIssue(value, REMOVE_SOURCE_OPERATION_KEYS);
    }
    case 'patchSource': {
      const patch = ownValue(value, 'patch');
      if (!isJsonObject(patch)) return invalidTypeIssue('record', patch, ['patch']);
      return unrecognizedKeysIssue(value, PATCH_SOURCE_OPERATION_KEYS);
    }
    case 'setGeoJsonData':
      return unrecognizedKeysIssue(value, SET_GEOJSON_DATA_OPERATION_KEYS);
    default:
      return undefined;
  }
}

function fallbackFilterOperationIssue(value: JsonValue): LayerLifecycleIssue | undefined {
  if (!isJsonObject(value)) return undefined;
  const operation = ownValue(value, 'op');
  const isLayer = operation === 'setLayerFilter';
  if (!isLayer && operation !== 'setGeoJsonSourceFilter') return undefined;
  const mode = ownValue(value, 'mode');
  const options = isLayer ? ['replace', 'and', 'or', 'clear'] : ['replace', 'clear'];
  if (!options.includes(mode as string)) {
    return {
      code: 'invalid_union', errors: [], path: ['mode'],
      message: `Invalid discriminator value. Expected ${options.map((item) => `'${item}'`).join(' | ')}`,
      note: 'No matching discriminator', discriminator: 'mode', options,
    } as LayerLifecycleIssue;
  }
  const idField = isLayer ? 'layerId' : 'sourceId';
  const idIssue = requiredMinLengthStringIssue(value, idField);
  if (idIssue !== undefined) return idIssue;
  if (mode !== 'clear') {
    const filter = ownValue(value, 'filter');
    if (!Array.isArray(filter)) return invalidTypeIssue('array', filter, ['filter']);
  }
  const allowed = isLayer ? LAYER_FILTER_OPERATION_KEYS : SOURCE_FILTER_OPERATION_KEYS;
  return unrecognizedKeysIssue(value, allowed);
}

function fallbackOperation(value: JsonValue): JsonValue | undefined {
  return fallbackSetLayerOperation(value)
    ?? fallbackRootOperation(value)
    ?? fallbackFilterOperation(value, 'setLayerFilter')
    ?? fallbackFilterOperation(value, 'setGeoJsonSourceFilter')
    ?? fallbackSourceOperation(value)
    ?? fallbackLayerLifecycleOperation(value)
    ?? fallbackDefinitionOperation(value);
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
  if (operation === 'addGeoJsonLayer') return fallbackAddGeoJsonLayerFirstIssue(value);
  const lifecycleIssueResult = fallbackLayerLifecycleOperationIssue(value);
  const lifecycleIssue = Array.isArray(lifecycleIssueResult)
    ? lifecycleIssueResult[0]
    : lifecycleIssueResult as z.core.$ZodIssue | undefined;
  if (lifecycleIssue !== undefined) return lifecycleIssue;
  const sourceIssue = fallbackSourceOperationIssue(value);
  if (sourceIssue !== undefined) return sourceIssue;
  const filterIssue = fallbackFilterOperationIssue(value);
  if (filterIssue !== undefined) return filterIssue;
  return operation === 'setLayerProperties'
    || operation === 'setStyleRootProperties'
    || operation === 'setLayerFilter'
    || operation === 'setGeoJsonSourceFilter'
    || operation === 'addSource'
    || operation === 'duplicateSource'
    || operation === 'renameSource'
    || operation === 'removeSource'
    || operation === 'patchSource'
    || operation === 'setGeoJsonData'
    || operation === 'duplicateLayer'
    || operation === 'moveLayer'
    || operation === 'reorderLayers'
    || operation === 'removeLayer'
    || operation === 'addLayerFromSource'
    || operation === 'addGeoJsonLayer'
    || operation === 'addLayerDefinition'
    || operation === 'deepMergeLayerDefinition'
    || operation === 'replaceLayerDefinition'
    || operation === 'deepMergeSourceDefinition'
    || operation === 'replaceSourceDefinition'
    || operation === 'replaceRootProperty'
    || operation === 'shallowPatchRootProperty'
    ? undefined
    : fallbackSetLayerOperationIssue(value);
}

function fallbackOperationIssues(value: JsonValue): readonly z.core.$ZodIssue[] | undefined {
  if (isJsonObject(value) && ownValue(value, 'op') === 'addGeoJsonLayer') {
    const issues = fallbackAddGeoJsonLayerIssue(value);
    return issues === undefined ? undefined : issues;
  }
  const issue = fallbackOperationIssue(value);
  return issue === undefined ? undefined : oneItem(issue);
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

function fallbackTransactionIssue(value: JsonValue): FallbackIssueResult {
  if (isJsonObject(value)) {
    const operations = ownValue(value, 'operations');
    if (Array.isArray(operations) && operations.length === 0) {
      return {
        origin: 'array', code: 'too_small', minimum: 1, inclusive: true,
        path: ['operations'], message: 'Too small: expected array to have >=1 items',
      };
    }
    if (Array.isArray(operations)) {
      for (let index = 0; index < operations.length; index += 1) {
        const operation = ownValue(operations, String(index)) as JsonValue;
        if (fallbackOperation(operation) !== undefined) continue;
        const issues = fallbackOperationIssues(operation);
        if (issues !== undefined) {
          const prefixedIssues: z.core.$ZodIssue[] = [];
          for (const issue of issues) {
            const prefixedIssue: Record<string, unknown> = {};
            for (const key of Reflect.ownKeys(issue)) {
              if (typeof key !== 'string') continue;
              const descriptor = Object.getOwnPropertyDescriptor(issue, key);
              if (descriptor === undefined || !('value' in descriptor)) continue;
              const issueValue = key === 'path'
                ? ['operations', index, ...(descriptor.value as PathToken[])]
                : descriptor.value;
              Reflect.defineProperty(prefixedIssue, key, {
                configurable: true,
                enumerable: true,
                value: issueValue,
                writable: true,
              });
            }
            appendOwn(prefixedIssues, prefixedIssue as unknown as z.core.$ZodIssue);
          }
          return prefixedIssues;
        }
        return undefined;
      }
    }
  }
  return undefined;
}

function safeFailure<Output = unknown>(issue: FallbackIssueResult): z.ZodSafeParseError<Output> {
  const fallback = issue ?? {
    code: 'custom', message: INVALID_JSON_MESSAGE, path: [],
  };
  const error = new z.ZodError(issueItems(fallback)) as z.ZodError<Output>;
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
      code: 'custom', message: INVALID_JSON_MESSAGE,
      path: materializePath(sanitized.path),
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
        code: 'custom', message: INVALID_JSON_MESSAGE,
        path: materializePath(result.path),
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
const GEOJSON_ANALYSIS_OPTION_KEYS = new Set(['topValueLimit', 'limits']);
const LIST_SOURCE_LAYERS_OPTION_KEYS = new Set(['sourceId']);

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
      path: Path;
      role: GeoJsonObjectRole;
    }
  | {
      kind: 'coordinates';
      value: JsonValue;
      path: Path;
      role: CoordinateRole;
    }
  | {
      kind: 'ringClosure';
      value: JsonValue[];
      path: Path;
    };

function geoJsonIssue(
  message: string,
  path: Path,
): SanitizedIssue {
  return { code: 'custom', message, path: materializePath(path) };
}

function validateBbox(
  value: { [key: string]: JsonValue },
  path: Path,
): SanitizedIssue | undefined {
  const bbox = ownValue(value, 'bbox');
  if (bbox === undefined) return undefined;
  const bboxPath = childPath(path, 'bbox');
  if (!Array.isArray(bbox) || (bbox.length !== 4 && bbox.length !== 6)) {
    return geoJsonIssue('bbox must contain exactly four or six numbers', bboxPath);
  }
  for (let index = 0; index < bbox.length; index += 1) {
    const component = ownValue(bbox, String(index));
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      return geoJsonIssue('bbox components must be finite numbers', childPath(bboxPath, index));
    }
  }
  return undefined;
}

function pushStructuralObject(
  work: GeoJsonStructuralWork[],
  value: JsonValue,
  path: Path,
  role: GeoJsonObjectRole,
): void {
  appendOwn(work, { kind: 'object', value, path, role });
}

function pushCoordinates(
  work: GeoJsonStructuralWork[],
  value: JsonValue,
  path: Path,
  role: CoordinateRole,
): void {
  appendOwn(work, { kind: 'coordinates', value, path, role });
}

function pushArrayCoordinateChildren(
  work: GeoJsonStructuralWork[],
  values: JsonValue[],
  path: Path,
  role: CoordinateRole,
): void {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    pushCoordinates(work, ownValue(values, String(index)) as JsonValue, childPath(path, index), role);
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
          'position components must be finite numbers', childPath(current.path, index),
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
  path: Path,
  work: GeoJsonStructuralWork[],
): SanitizedIssue | undefined {
  if (ownValue(value, 'type') !== 'Feature') {
    return geoJsonIssue("Feature type must be 'Feature'", childPath(path, 'type'));
  }
  const bboxIssue = validateBbox(value, path);
  if (bboxIssue !== undefined) return bboxIssue;
  const id = ownValue(value, 'id');
  if (id !== undefined && !(
    typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))
  )) return geoJsonIssue('Feature id must be a string or finite number', childPath(path, 'id'));
  const geometry = ownValue(value, 'geometry');
  if (geometry === undefined) {
    return geoJsonIssue('Feature geometry is required', childPath(path, 'geometry'));
  }
  if (geometry !== null) {
    if (!isJsonObject(geometry)) {
      return geoJsonIssue('Feature geometry must be a geometry or null', childPath(path, 'geometry'));
    }
    pushStructuralObject(work, geometry, childPath(path, 'geometry'), 'geometry');
  }
  const properties = ownValue(value, 'properties');
  if (properties !== null && !isJsonObject(properties)) {
    return geoJsonIssue(
      'Feature properties must be an object or null', childPath(path, 'properties'),
    );
  }
  return undefined;
}

function checkFeatureCollectionObject(
  value: { [key: string]: JsonValue },
  path: Path,
  work: GeoJsonStructuralWork[],
): SanitizedIssue | undefined {
  const bboxIssue = validateBbox(value, path);
  if (bboxIssue !== undefined) return bboxIssue;
  const features = ownValue(value, 'features');
  const featuresPath = childPath(path, 'features');
  if (!Array.isArray(features)) {
    return geoJsonIssue('FeatureCollection features must be an array', featuresPath);
  }
  for (let index = features.length - 1; index >= 0; index -= 1) {
    pushStructuralObject(
      work,
      ownValue(features, String(index)) as JsonValue,
      childPath(featuresPath, index),
      'feature',
    );
  }
  return undefined;
}

function checkGeometryObject(
  value: { [key: string]: JsonValue },
  path: Path,
  work: GeoJsonStructuralWork[],
): SanitizedIssue | undefined {
  const type = ownValue(value, 'type');
  if (typeof type !== 'string' || !GEOJSON_GEOMETRY_TYPES.has(type)) {
    return geoJsonIssue('Unknown GeoJSON geometry type', childPath(path, 'type'));
  }
  const bboxIssue = validateBbox(value, path);
  if (bboxIssue !== undefined) return bboxIssue;
  if (type === 'GeometryCollection') {
    const geometries = ownValue(value, 'geometries');
    const geometriesPath = childPath(path, 'geometries');
    if (!Array.isArray(geometries)) {
      return geoJsonIssue('GeometryCollection geometries must be an array', geometriesPath);
    }
    for (let index = geometries.length - 1; index >= 0; index -= 1) {
      pushStructuralObject(
        work,
        ownValue(geometries, String(index)) as JsonValue,
        childPath(geometriesPath, index),
        'geometry',
      );
    }
    return undefined;
  }
  const coordinates = ownValue(value, 'coordinates');
  const coordinatesPath = childPath(path, 'coordinates');
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
  pushStructuralObject(work, value, undefined, 'top');
  while (work.length > 0) {
    const current = work.pop();
    if (current === undefined) return geoJsonIssue('GeoJSON validation failed', undefined);
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
      return geoJsonIssue('Unknown GeoJSON type', childPath(current.path, 'type'));
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

function fallbackGeoJsonAnalysisOptions(value: JsonValue): JsonValue | undefined {
  if (!isJsonObject(value) || !hasOnlyKeys(value, GEOJSON_ANALYSIS_OPTION_KEYS)) {
    return undefined;
  }
  const topValueLimit = ownValue(value, 'topValueLimit');
  if (
    topValueLimit !== undefined
    && (typeof topValueLimit !== 'number'
      || !Number.isSafeInteger(topValueLimit)
      || topValueLimit <= 0
      || topValueLimit > 100)
  ) return undefined;
  const limits = ownValue(value, 'limits');
  if (
    limits !== undefined
    && (!isJsonObject(limits) || fallbackGeoJsonLimits(limits) === undefined)
  ) {
    return undefined;
  }
  const result: { [key: string]: JsonValue } = {
    topValueLimit: typeof topValueLimit === 'number' ? topValueLimit : 10,
  };
  if (isJsonObject(limits)) result.limits = limits;
  return result;
}

function fallbackGeoJsonAnalysisInput(value: JsonValue): JsonValue | undefined {
  if (typeof value === 'string') return value.trim().length > 0 ? value : undefined;
  return inlineGeoJsonIssue(value) === undefined ? value : undefined;
}

function fallbackListSourceLayersOptions(value: JsonValue): JsonValue | undefined {
  if (!isJsonObject(value) || !hasOnlyKeys(value, LIST_SOURCE_LAYERS_OPTION_KEYS)) {
    return undefined;
  }
  const sourceId = ownValue(value, 'sourceId');
  return sourceId === undefined || (typeof sourceId === 'string' && sourceId.length > 0)
    ? value
    : undefined;
}

const topValueLimitSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value > 0 && value <= 100,
  { message: 'Expected a positive safe integer no greater than 100' },
);
const geoJsonAnalysisOptionsInnerSchema = z.object({
  topValueLimit: topValueLimitSchema.default(10),
  limits: geoJsonLimitsSchema.optional(),
}).strict() satisfies z.ZodType<GeoJsonAnalysisOptions>;

export const geoJsonAnalysisOptionsSchema = sanitizeBefore(
  geoJsonAnalysisOptionsInnerSchema,
  undefined,
  fallbackGeoJsonAnalysisOptions,
) as z.ZodType<GeoJsonAnalysisOptions>;

const listSourceLayersOptionsInnerSchema = z.object({
  sourceId: z.string().min(1).optional(),
}).strict() satisfies z.ZodType<ListSourceLayersOptions>;

export const listSourceLayersOptionsSchema = sanitizeBefore(
  listSourceLayersOptionsInnerSchema,
  undefined,
  fallbackListSourceLayersOptions,
) as z.ZodType<ListSourceLayersOptions>;

const nonEmptyStringSchema = z.string().refine(
  (value) => value.trim().length > 0,
  { message: 'Expected a non-empty string' },
);
const geoJsonAnalysisInputInnerSchema = z.union([
  nonEmptyStringSchema,
  inlineGeoJsonSchema,
]) satisfies z.ZodType<GeoJsonAnalysisInput>;

export const geoJsonAnalysisInputSchema = sanitizeBefore(
  geoJsonAnalysisInputInnerSchema,
  undefined,
  fallbackGeoJsonAnalysisInput,
) as z.ZodType<GeoJsonAnalysisInput>;

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
export const expressionFilterSchema = z.array(jsonValueInnerSchema).superRefine(
  (filter, context) => {
    if (classifyFilter(filter) === 'legacy') {
      context.addIssue({ code: 'custom', message: LEGACY_FILTER_MESSAGE });
    }
  },
);
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
    filter: expressionFilterSchema,
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
    filter: expressionFilterSchema,
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

const sourceIdSchema = z.string().min(1);
const addSourceOperationInnerSchema = z.object({
  op: z.literal('addSource'),
  sourceId: sourceIdSchema,
  source: jsonObjectInnerSchema,
}).strict() satisfies z.ZodType<AddSourceOperation>;

export const addSourceOperationSchema = sanitizeBefore(
  addSourceOperationInnerSchema,
  undefined,
  (value) => fallbackSourceOperation(value, 'addSource'),
);

const duplicateSourceOperationInnerSchema = z.object({
  op: z.literal('duplicateSource'),
  sourceId: sourceIdSchema,
  newSourceId: sourceIdSchema,
  overrides: jsonObjectInnerSchema.optional(),
}).strict() satisfies z.ZodType<DuplicateSourceOperation>;

export const duplicateSourceOperationSchema = sanitizeBefore(
  duplicateSourceOperationInnerSchema,
  undefined,
  (value) => fallbackSourceOperation(value, 'duplicateSource'),
);

const renameSourceOperationInnerSchema = z.object({
  op: z.literal('renameSource'),
  sourceId: sourceIdSchema,
  newSourceId: sourceIdSchema,
}).strict() satisfies z.ZodType<RenameSourceOperation>;

export const renameSourceOperationSchema = sanitizeBefore(
  renameSourceOperationInnerSchema,
  undefined,
  (value) => fallbackSourceOperation(value, 'renameSource'),
);

const removeSourceOperationInnerSchema = z.object({
  op: z.literal('removeSource'),
  sourceId: sourceIdSchema,
  cascadeLayers: z.boolean().optional(),
}).strict() satisfies z.ZodType<RemoveSourceOperation>;

export const removeSourceOperationSchema = sanitizeBefore(
  removeSourceOperationInnerSchema,
  undefined,
  (value) => fallbackSourceOperation(value, 'removeSource'),
);

const patchSourceOperationInnerSchema = z.object({
  op: z.literal('patchSource'),
  sourceId: sourceIdSchema,
  patch: jsonObjectInnerSchema,
}).strict() satisfies z.ZodType<PatchSourceOperation>;

export const patchSourceOperationSchema = sanitizeBefore(
  patchSourceOperationInnerSchema,
  undefined,
  (value) => fallbackSourceOperation(value, 'patchSource'),
);

const setGeoJsonDataOperationInnerSchema = z.object({
  op: z.literal('setGeoJsonData'),
  sourceId: sourceIdSchema,
  data: z.union([nonEmptyStringSchema, inlineGeoJsonSchema]),
}).strict() satisfies z.ZodType<SetGeoJsonDataOperation>;

export const setGeoJsonDataOperationSchema = sanitizeBefore(
  setGeoJsonDataOperationInnerSchema,
  undefined,
  (value) => fallbackSourceOperation(value, 'setGeoJsonData'),
);

const duplicateLayerOperationInnerSchema = z.object({
  op: z.literal('duplicateLayer'),
  layerId: nonEmptyStringSchema,
  newLayerId: nonEmptyStringSchema,
  overrides: jsonObjectInnerSchema.optional(),
  beforeId: nonEmptyStringSchema.optional(),
  afterId: nonEmptyStringSchema.optional(),
}).strict().superRefine((operation, context) => {
  if (operation.beforeId !== undefined && operation.afterId !== undefined) {
    context.addIssue({
      code: 'custom', message: 'Placement cannot specify both beforeId and afterId',
      path: ['afterId'],
    });
  }
  if (operation.overrides !== undefined && Object.hasOwn(operation.overrides, 'id')) {
    context.addIssue({
      code: 'custom', message: 'Layer overrides cannot include id', path: ['overrides', 'id'],
    });
  }
}) satisfies z.ZodType<DuplicateLayerOperation>;

export const duplicateLayerOperationSchema = sanitizeBefore(
  duplicateLayerOperationInnerSchema,
  undefined,
  (value) => fallbackLayerLifecycleOperation(value, 'duplicateLayer'),
  (value) => fallbackLayerLifecycleOperationIssue(value, 'duplicateLayer'),
);

const moveLayerOperationInnerSchema = z.object({
  op: z.literal('moveLayer'),
  layerId: nonEmptyStringSchema,
  beforeId: nonEmptyStringSchema.optional(),
  afterId: nonEmptyStringSchema.optional(),
}).strict().superRefine((operation, context) => {
  if (operation.beforeId !== undefined && operation.afterId !== undefined) {
    context.addIssue({
      code: 'custom', message: 'Placement cannot specify both beforeId and afterId',
      path: ['afterId'],
    });
  }
  if (operation.beforeId === operation.layerId) {
    context.addIssue({
      code: 'custom', message: 'A layer cannot be placed relative to itself',
      path: ['beforeId'],
    });
  }
  if (operation.afterId === operation.layerId) {
    context.addIssue({
      code: 'custom', message: 'A layer cannot be placed relative to itself',
      path: ['afterId'],
    });
  }
}) satisfies z.ZodType<MoveLayerOperation>;

export const moveLayerOperationSchema = sanitizeBefore(
  moveLayerOperationInnerSchema,
  undefined,
  (value) => fallbackLayerLifecycleOperation(value, 'moveLayer'),
  (value) => fallbackLayerLifecycleOperationIssue(value, 'moveLayer'),
);

const reorderLayersOperationInnerSchema = z.object({
  op: z.literal('reorderLayers'),
  layerIds: z.array(nonEmptyStringSchema).min(1),
  beforeId: nonEmptyStringSchema.optional(),
  afterId: nonEmptyStringSchema.optional(),
}).strict().superRefine((operation, context) => {
  if (operation.beforeId !== undefined && operation.afterId !== undefined) {
    context.addIssue({
      code: 'custom', message: 'Placement cannot specify both beforeId and afterId',
      path: ['afterId'],
    });
  }
  const seen = new Set<string>();
  for (let index = 0; index < operation.layerIds.length; index += 1) {
    const layerId = operation.layerIds[index]!;
    if (seen.has(layerId)) {
      context.addIssue({
        code: 'custom', message: 'layerIds must contain unique IDs',
        path: ['layerIds', index],
      });
    }
    seen.add(layerId);
  }
  if (operation.beforeId !== undefined && seen.has(operation.beforeId)) {
    context.addIssue({
      code: 'custom', message: 'A reorder anchor cannot be a moving layer',
      path: ['beforeId'],
    });
  }
  if (operation.afterId !== undefined && seen.has(operation.afterId)) {
    context.addIssue({
      code: 'custom', message: 'A reorder anchor cannot be a moving layer',
      path: ['afterId'],
    });
  }
}) satisfies z.ZodType<ReorderLayersOperation>;

export const reorderLayersOperationSchema = sanitizeBefore(
  reorderLayersOperationInnerSchema,
  undefined,
  (value) => fallbackLayerLifecycleOperation(value, 'reorderLayers'),
  (value) => fallbackLayerLifecycleOperationIssue(value, 'reorderLayers'),
);

const removeLayerOperationInnerSchema = z.object({
  op: z.literal('removeLayer'),
  layerId: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<RemoveLayerOperation>;

export const removeLayerOperationSchema = sanitizeBefore(
  removeLayerOperationInnerSchema,
  undefined,
  (value) => fallbackLayerLifecycleOperation(value, 'removeLayer'),
  (value) => fallbackLayerLifecycleOperationIssue(value, 'removeLayer'),
);

const addLayerFromSourceOperationInnerSchema = z.object({
  op: z.literal('addLayerFromSource'),
  layerId: nonEmptyStringSchema,
  sourceId: nonEmptyStringSchema,
  sourceLayer: nonEmptyStringSchema.optional(),
  type: nonEmptyStringSchema,
  paint: jsonObjectInnerSchema.optional(),
  layout: jsonObjectInnerSchema.optional(),
  filter: expressionFilterSchema.optional(),
  minzoom: z.number().finite().min(0).max(24).optional(),
  maxzoom: z.number().finite().min(0).max(24).optional(),
  metadata: jsonObjectInnerSchema.optional(),
  beforeId: nonEmptyStringSchema.optional(),
  afterId: nonEmptyStringSchema.optional(),
}).strict().superRefine((operation, context) => {
  if (operation.beforeId !== undefined && operation.afterId !== undefined) {
    context.addIssue({
      code: 'custom', message: 'Placement cannot specify both beforeId and afterId',
      path: ['afterId'],
    });
  }
  if (operation.minzoom !== undefined && operation.maxzoom !== undefined
    && operation.minzoom > operation.maxzoom) {
    context.addIssue({
      code: 'custom', message: 'minzoom must be less than or equal to maxzoom',
      path: ['maxzoom'],
    });
  }
}) satisfies z.ZodType<AddLayerFromSourceOperation>;

export const addLayerFromSourceOperationSchema = sanitizeBefore(
  addLayerFromSourceOperationInnerSchema,
  undefined,
  (value) => fallbackLayerLifecycleOperation(value, 'addLayerFromSource'),
  (value) => fallbackLayerLifecycleOperationIssue(value, 'addLayerFromSource'),
);

const addGeoJsonLayerOperationInnerSchema = z.object({
  op: z.literal('addGeoJsonLayer'),
  sourceId: nonEmptyStringSchema,
  layerId: nonEmptyStringSchema,
  data: z.union([nonEmptyStringSchema, inlineGeoJsonSchema]),
  sourceOptions: jsonObjectInnerSchema.optional(),
  type: z.enum(GEOJSON_LAYER_TYPE_VALUES),
  paint: jsonObjectInnerSchema.optional(),
  layout: jsonObjectInnerSchema.optional(),
  filter: expressionFilterSchema.optional(),
  minzoom: z.number().finite().min(0).max(24).optional(),
  maxzoom: z.number().finite().min(0).max(24).optional(),
  metadata: jsonObjectInnerSchema.optional(),
  beforeId: nonEmptyStringSchema.optional(),
  afterId: nonEmptyStringSchema.optional(),
}).strict().superRefine((operation, context) => {
  if (operation.sourceOptions !== undefined) {
    if (Object.hasOwn(operation.sourceOptions, 'type')) {
      context.addIssue({
        code: 'custom', message: 'sourceOptions cannot include the authority key type',
        path: ['sourceOptions', 'type'],
      });
    }
    if (Object.hasOwn(operation.sourceOptions, 'data')) {
      context.addIssue({
        code: 'custom', message: 'sourceOptions cannot include the authority key data',
        path: ['sourceOptions', 'data'],
      });
    }
  }
  if (operation.beforeId !== undefined && operation.afterId !== undefined) {
    context.addIssue({
      code: 'custom', message: 'Placement cannot specify both beforeId and afterId',
      path: ['afterId'],
    });
  }
  if (operation.minzoom !== undefined && operation.maxzoom !== undefined
    && operation.minzoom > operation.maxzoom) {
    context.addIssue({
      code: 'custom', message: 'minzoom must be less than or equal to maxzoom',
      path: ['maxzoom'],
    });
  }
}) satisfies z.ZodType<AddGeoJsonLayerOperation>;

export const addGeoJsonLayerOperationSchema = sanitizeBefore(
  addGeoJsonLayerOperationInnerSchema,
  undefined,
  (value) => fallbackLayerLifecycleOperation(value, 'addGeoJsonLayer'),
  (value) => fallbackLayerLifecycleOperationIssue(value, 'addGeoJsonLayer'),
);

function rejectLegacyEmbeddedFilter(
  payload: Record<string, JsonValue>,
  pathPrefix: string,
  context: z.RefinementCtx,
): void {
  const filter = payload['filter'];
  if (Array.isArray(filter) && classifyFilter(filter) === 'legacy') {
    context.addIssue({
      code: 'custom', message: LEGACY_FILTER_MESSAGE, path: [pathPrefix, 'filter'],
    });
  }
}

const addLayerDefinitionOperationInnerSchema = z.object({
  op: z.literal('addLayerDefinition'),
  layer: jsonObjectInnerSchema,
  beforeId: nonEmptyStringSchema.optional(),
}).strict().superRefine((operation, context) => {
  rejectLegacyEmbeddedFilter(operation.layer, 'layer', context);
}) satisfies z.ZodType<AddLayerDefinitionOperation>;

export const addLayerDefinitionOperationSchema = sanitizeBefore(
  addLayerDefinitionOperationInnerSchema,
  undefined,
  (value) => fallbackDefinitionOperation(value, 'addLayerDefinition'),
);

const deepMergeLayerDefinitionOperationInnerSchema = z.object({
  op: z.literal('deepMergeLayerDefinition'),
  layerId: nonEmptyStringSchema,
  patch: jsonObjectInnerSchema,
}).strict().superRefine((operation, context) => {
  rejectLegacyEmbeddedFilter(operation.patch, 'patch', context);
}) satisfies z.ZodType<DeepMergeLayerDefinitionOperation>;

export const deepMergeLayerDefinitionOperationSchema = sanitizeBefore(
  deepMergeLayerDefinitionOperationInnerSchema,
  undefined,
  (value) => fallbackDefinitionOperation(value, 'deepMergeLayerDefinition'),
);

const replaceLayerDefinitionOperationInnerSchema = z.object({
  op: z.literal('replaceLayerDefinition'),
  layerId: nonEmptyStringSchema,
  layer: jsonObjectInnerSchema,
}).strict().superRefine((operation, context) => {
  rejectLegacyEmbeddedFilter(operation.layer, 'layer', context);
}) satisfies z.ZodType<ReplaceLayerDefinitionOperation>;

export const replaceLayerDefinitionOperationSchema = sanitizeBefore(
  replaceLayerDefinitionOperationInnerSchema,
  undefined,
  (value) => fallbackDefinitionOperation(value, 'replaceLayerDefinition'),
);

const deepMergeSourceDefinitionOperationInnerSchema = z.object({
  op: z.literal('deepMergeSourceDefinition'),
  sourceId: sourceIdSchema,
  patch: jsonObjectInnerSchema,
}).strict() satisfies z.ZodType<DeepMergeSourceDefinitionOperation>;

export const deepMergeSourceDefinitionOperationSchema = sanitizeBefore(
  deepMergeSourceDefinitionOperationInnerSchema,
  undefined,
  (value) => fallbackDefinitionOperation(value, 'deepMergeSourceDefinition'),
);

const replaceSourceDefinitionOperationInnerSchema = z.object({
  op: z.literal('replaceSourceDefinition'),
  sourceId: sourceIdSchema,
  source: jsonObjectInnerSchema,
}).strict() satisfies z.ZodType<ReplaceSourceDefinitionOperation>;

export const replaceSourceDefinitionOperationSchema = sanitizeBefore(
  replaceSourceDefinitionOperationInnerSchema,
  undefined,
  (value) => fallbackDefinitionOperation(value, 'replaceSourceDefinition'),
);

const replaceRootPropertyOperationInnerSchema = z.object({
  op: z.literal('replaceRootProperty'),
  property: z.enum(['metadata', 'transition', 'sky', 'projection', 'terrain']),
  value: jsonObjectInnerSchema.nullable(),
}).strict() satisfies z.ZodType<ReplaceRootPropertyOperation>;

export const replaceRootPropertyOperationSchema = sanitizeBefore(
  replaceRootPropertyOperationInnerSchema,
  undefined,
  (value) => fallbackDefinitionOperation(value, 'replaceRootProperty'),
);

const shallowPatchRootPropertyOperationInnerSchema = z.object({
  op: z.literal('shallowPatchRootProperty'),
  property: z.literal('light'),
  patch: jsonObjectInnerSchema,
}).strict() satisfies z.ZodType<ShallowPatchRootPropertyOperation>;

export const shallowPatchRootPropertyOperationSchema = sanitizeBefore(
  shallowPatchRootPropertyOperationInnerSchema,
  undefined,
  (value) => fallbackDefinitionOperation(value, 'shallowPatchRootProperty'),
);

const styleOperationInnerSchema = z.discriminatedUnion('op', [
  setLayerPropertiesOperationInnerSchema,
  setStyleRootPropertiesOperationInnerSchema,
  setLayerFilterOperationInnerSchema,
  setGeoJsonSourceFilterOperationInnerSchema,
  addSourceOperationInnerSchema,
  duplicateSourceOperationInnerSchema,
  renameSourceOperationInnerSchema,
  removeSourceOperationInnerSchema,
  patchSourceOperationInnerSchema,
  setGeoJsonDataOperationInnerSchema,
  duplicateLayerOperationInnerSchema,
  moveLayerOperationInnerSchema,
  reorderLayersOperationInnerSchema,
  removeLayerOperationInnerSchema,
  addLayerFromSourceOperationInnerSchema,
  addGeoJsonLayerOperationInnerSchema,
  addLayerDefinitionOperationInnerSchema,
  deepMergeLayerDefinitionOperationInnerSchema,
  replaceLayerDefinitionOperationInnerSchema,
  deepMergeSourceDefinitionOperationInnerSchema,
  replaceSourceDefinitionOperationInnerSchema,
  replaceRootPropertyOperationInnerSchema,
  shallowPatchRootPropertyOperationInnerSchema,
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
