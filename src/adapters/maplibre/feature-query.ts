import type { ZodError } from 'zod';
import type {
  FilterSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type {
  Map,
  QueryRenderedFeaturesOptions,
  QuerySourceFeatureOptions,
} from 'maplibre-gl';
import {
  createStyleToolError,
  jsonUtf8ByteLength,
  jsonValueSchema,
} from '../../core/index.js';
import { toJsonPointer } from '../../core/json-pointer.js';
import type {
  JsonObject,
  JsonValue,
  StyleToolError,
  StyleWarning,
} from '../../core/types.js';
import {
  DEFAULT_FEATURE_QUERY_LIMITS,
  featureQueryLimitsSchema,
  parseBoundedRenderedFeatureQueryInput,
  parseBoundedSourceFeatureQueryInput,
} from './schemas.js';
import type {
  BoundedFeatureQueryResult,
  FeatureQueryLimits,
  RenderedFeatureQueryGeometry,
  RenderedFeatureQueryInput,
  SourceFeatureQueryInput,
} from './types.js';

export { DEFAULT_FEATURE_QUERY_LIMITS } from './schemas.js';

type ParsedQuery<Input> =
  | { ok: true; limits: FeatureQueryLimits; input: Input }
  | { ok: false; error: StyleToolError };

type QueryFeatures = () => unknown;

function schemaError(error: ZodError): StyleToolError {
  const issue = error.issues[0];
  if (issue === undefined) {
    return createStyleToolError('INVALID_INPUT', 'Feature query input is invalid.', '');
  }
  return createStyleToolError(
    'INVALID_INPUT', issue.message, toJsonPointer(issue.path.map((token) => String(token))),
  );
}

function emptyFailure(error: StyleToolError): BoundedFeatureQueryResult {
  return {
    ok: false,
    features: [],
    returned: 0,
    truncated: false,
    serializedBytes: 2,
    warnings: [],
    error,
  };
}

function parseSourceQuery(
  input: SourceFeatureQueryInput,
  limits: FeatureQueryLimits | undefined,
): ParsedQuery<SourceFeatureQueryInput> {
  const parsedLimits = featureQueryLimitsSchema.safeParse(
    limits === undefined ? DEFAULT_FEATURE_QUERY_LIMITS : limits,
  );
  if (!parsedLimits.success) return { ok: false, error: schemaError(parsedLimits.error) };
  const parsedInput = parseBoundedSourceFeatureQueryInput(input, parsedLimits.data);
  return parsedInput.success
    ? { ok: true, limits: parsedLimits.data, input: parsedInput.data }
    : { ok: false, error: schemaError(parsedInput.error) };
}

function parseRenderedQuery(
  input: RenderedFeatureQueryInput,
  limits: FeatureQueryLimits | undefined,
): ParsedQuery<RenderedFeatureQueryInput> {
  const parsedLimits = featureQueryLimitsSchema.safeParse(
    limits === undefined ? DEFAULT_FEATURE_QUERY_LIMITS : limits,
  );
  if (!parsedLimits.success) return { ok: false, error: schemaError(parsedLimits.error) };
  const parsedInput = parseBoundedRenderedFeatureQueryInput(input, parsedLimits.data);
  return parsedInput.success
    ? { ok: true, limits: parsedLimits.data, input: parsedInput.data }
    : { ok: false, error: schemaError(parsedInput.error) };
}

type OwnDataValue =
  | { kind: 'absent' }
  | { kind: 'data'; value: unknown }
  | { kind: 'failure' };

function ownDataValue(value: unknown, key: string): OwnDataValue {
  if (typeof value !== 'object' || value === null) return { kind: 'failure' };
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return { kind: 'absent' };
    if (!descriptor.enumerable || !('value' in descriptor)) return { kind: 'failure' };
    return { kind: 'data', value: descriptor.value };
  } catch {
    return { kind: 'failure' };
  }
}

function defineJsonValue(target: JsonObject, key: string, value: unknown): void {
  if (value === undefined) return;
  Reflect.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function projectProperties(
  value: unknown,
  allowlist: readonly string[] | undefined,
): JsonValue | undefined {
  const parsed = jsonValueSchema.safeParse(value);
  if (!parsed.success || Array.isArray(parsed.data) || parsed.data === null
    || typeof parsed.data !== 'object') return undefined;
  if (allowlist === undefined) return parsed.data;
  const projected: JsonObject = {};
  for (const key of allowlist) {
    const property = ownDataValue(parsed.data, key);
    if (property.kind === 'failure') return undefined;
    if (property.kind === 'data') defineJsonValue(projected, key, property.value);
  }
  return projected;
}

function projectLayer(value: unknown): JsonObject | undefined | false {
  if (typeof value !== 'object' || value === null) return false;
  const projected: JsonObject = {};
  for (const key of ['id', 'type'] as const) {
    const layerValue = ownDataValue(value, key);
    if (layerValue.kind === 'failure') return false;
    if (layerValue.kind === 'data') defineJsonValue(projected, key, layerValue.value);
  }
  return Object.keys(projected).length === 0 ? undefined : projected;
}

function projectFeature(
  feature: unknown,
  propertyAllowlist: readonly string[] | undefined,
): JsonObject | undefined {
  if (typeof feature !== 'object' || feature === null) return undefined;
  const projected: JsonObject = {};
  for (const key of ['type', 'id', 'geometry', 'source', 'sourceLayer'] as const) {
    const featureValue = ownDataValue(feature, key);
    if (featureValue.kind === 'failure') return undefined;
    if (featureValue.kind === 'data') defineJsonValue(projected, key, featureValue.value);
  }
  const properties = ownDataValue(feature, 'properties');
  if (properties.kind === 'failure') return undefined;
  if (properties.kind === 'data') {
    const projectedProperties = projectProperties(properties.value, propertyAllowlist);
    if (projectedProperties === undefined) return undefined;
    defineJsonValue(projected, 'properties', projectedProperties);
  }
  const rawLayer = ownDataValue(feature, 'layer');
  if (rawLayer.kind === 'failure') return undefined;
  if (rawLayer.kind === 'data') {
    const layer = projectLayer(rawLayer.value);
    if (layer === false) return undefined;
    if (layer !== undefined) defineJsonValue(projected, 'layer', layer);
  }
  const parsed = jsonValueSchema.safeParse(projected);
  return parsed.success && !Array.isArray(parsed.data) && parsed.data !== null
    && typeof parsed.data === 'object'
    ? parsed.data as JsonObject
    : undefined;
}

function boundFeatures(
  query: QueryFeatures,
  input: Pick<SourceFeatureQueryInput, 'propertyAllowlist' | 'limit' | 'maxSerializedBytes'>,
  limits: FeatureQueryLimits,
): BoundedFeatureQueryResult {
  let rawFeatures: unknown;
  try {
    rawFeatures = query();
  } catch {
    return emptyFailure(createStyleToolError('INTERNAL', 'MapLibre feature query failed.'));
  }
  if (!Array.isArray(rawFeatures)) {
    return emptyFailure(createStyleToolError('INTERNAL', 'MapLibre feature query returned an invalid result.'));
  }

  const maxFeatures = input.limit ?? limits.maxFeatures;
  const maxSerializedBytes = input.maxSerializedBytes ?? limits.maxSerializedBytes;
  const features: JsonObject[] = [];
  let serializedBytes = 2;
  let truncated = false;

  for (const rawFeature of rawFeatures) {
    if (features.length >= maxFeatures) {
      truncated = true;
      break;
    }
    const projected = projectFeature(rawFeature, input.propertyAllowlist);
    if (projected === undefined) {
      return emptyFailure(createStyleToolError(
        'INTERNAL', 'MapLibre returned a feature that could not be safely projected.',
      ));
    }
    let featureBytes: number;
    try {
      featureBytes = jsonUtf8ByteLength(projected);
    } catch {
      return emptyFailure(createStyleToolError(
        'INTERNAL', 'Projected MapLibre feature could not be serialized.',
      ));
    }
    const nextSerializedBytes = serializedBytes + (features.length === 0 ? 0 : 1) + featureBytes;
    if (nextSerializedBytes > maxSerializedBytes) {
      truncated = true;
      break;
    }
    features.push(projected);
    serializedBytes = nextSerializedBytes;
  }

  const warnings: StyleWarning[] = truncated
    ? [{
        code: 'FEATURE_QUERY_TRUNCATED',
        message: 'MapLibre feature query result was truncated by configured limits.',
      }]
    : [];
  return {
    ok: true,
    features,
    returned: features.length,
    truncated,
    serializedBytes,
    warnings,
  };
}

export function querySourceFeaturesBounded(
  map: Map,
  input: SourceFeatureQueryInput,
  limits?: FeatureQueryLimits,
): BoundedFeatureQueryResult {
  const parsed = parseSourceQuery(input, limits);
  if (!parsed.ok) return emptyFailure(parsed.error);
  const options: QuerySourceFeatureOptions = {};
  if (parsed.input.sourceLayer !== undefined) options.sourceLayer = parsed.input.sourceLayer;
  if (parsed.input.filter !== undefined) options.filter = parsed.input.filter as FilterSpecification;
  return boundFeatures(
    () => map.querySourceFeatures(parsed.input.sourceId, options),
    parsed.input,
    parsed.limits,
  );
}

export function queryRenderedFeaturesBounded(
  map: Map,
  input: RenderedFeatureQueryInput,
  limits?: FeatureQueryLimits,
): BoundedFeatureQueryResult {
  const parsed = parseRenderedQuery(input, limits);
  if (!parsed.ok) return emptyFailure(parsed.error);
  const options: QueryRenderedFeaturesOptions = {};
  if (parsed.input.layerIds !== undefined) options.layers = [...parsed.input.layerIds];
  if (parsed.input.filter !== undefined) options.filter = parsed.input.filter as FilterSpecification;
  const geometry: RenderedFeatureQueryGeometry = parsed.input.geometry ?? { kind: 'viewport' };
  const mapGeometry = geometry.kind === 'viewport'
    ? undefined
    : geometry.kind === 'point'
      ? geometry.point
      : geometry.bounds;
  return boundFeatures(
    () => map.queryRenderedFeatures(mapGeometry, options),
    parsed.input,
    parsed.limits,
  );
}
