import type { ZodError } from 'zod';
import { jsonValuesEqual } from './diff.js';
import { createStyleToolError } from './errors.js';
import { toJsonPointer } from './json-pointer.js';
import { geoJsonLimitsSchema, inlineGeoJsonSchema } from './schemas.js';
import type {
  GeoJsonFeature,
  GeoJsonGeometry,
  GeoJsonLimits,
  InlineGeoJson,
  InlineGeoJsonValidationResult,
  JsonObject,
  JsonValue,
  StyleToolError,
} from './types.js';
import { DEFAULT_MAX_STYLE_BYTES, jsonUtf8ByteLength } from './utf8.js';

export { geoJsonLimitsSchema, inlineGeoJsonSchema } from './schemas.js';

export const DEFAULT_GEOJSON_LIMITS: GeoJsonLimits = Object.freeze({
  maxBytes: DEFAULT_MAX_STYLE_BYTES,
  maxFeatures: 100_000,
  maxCoordinatePositions: 1_000_000,
  maxGeometryDepth: 16,
  maxPropertyDepth: 32,
});

type CoordinateRole =
  | 'position'
  | 'positions'
  | 'line'
  | 'lines'
  | 'ring'
  | 'polygon'
  | 'polygons';
type TraversalWork =
  | {
      kind: 'feature';
      value: GeoJsonFeature;
      path: (string | number)[];
    }
  | {
      kind: 'geometry';
      value: GeoJsonGeometry;
      path: (string | number)[];
      geometryDepth: number;
    }
  | {
      kind: 'coordinates';
      value: JsonValue;
      path: (string | number)[];
      geometryDepth: number;
      coordinateRole: CoordinateRole;
    }
  | {
      kind: 'ringClosure';
      value: JsonValue[];
      path: (string | number)[];
      geometryDepth: number;
    };
type PropertyWork = {
  value: JsonValue;
  path: (string | number)[];
  propertyDepth: number;
};
type Counts = { featureCount: number; coordinatePositionCount: number };
type CountResult =
  | { ok: true; counts: Counts }
  | { ok: false; error: StyleToolError };

function ownValue(value: object, key: string): JsonValue | undefined {
  return Object.getOwnPropertyDescriptor(value, key)?.value as JsonValue | undefined;
}

function appendOwn<T>(values: T[], value: T): void {
  Reflect.defineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function pathWith(
  path: readonly (string | number)[],
  token: string | number,
): (string | number)[] {
  const result: (string | number)[] = [];
  for (let index = 0; index < path.length; index += 1) {
    appendOwn(result, path[index]!);
  }
  appendOwn(result, token);
  return result;
}

function invalidInput(message: string, path: readonly (string | number)[]): StyleToolError {
  return createStyleToolError('INVALID_INPUT', message, toJsonPointer(path));
}

function schemaFailure(error: ZodError): StyleToolError {
  const issue = error.issues[0];
  if (issue === undefined) return invalidInput('GeoJSON input is invalid.', []);
  return createStyleToolError(
    'INVALID_INPUT',
    issue.message,
    toJsonPointer(issue.path.map((token) => String(token))),
  );
}

function limitFailure(
  reason: keyof GeoJsonLimits,
  max: number,
  actual: number,
  path: readonly (string | number)[],
): StyleToolError {
  if (reason === 'maxBytes') {
    return createStyleToolError(
      'INVALID_INPUT',
      'GeoJSON exceeds the configured UTF-8 JSON size limit.',
      '',
      { reason, maxBytes: max, actualBytes: actual },
    );
  }
  const actualName = reason === 'maxFeatures' ? 'actualFeatures'
    : reason === 'maxCoordinatePositions' ? 'actualCoordinatePositions'
      : reason === 'maxGeometryDepth' ? 'actualGeometryDepth'
        : 'actualPropertyDepth';
  return createStyleToolError(
    'INVALID_INPUT',
    `GeoJSON exceeds the configured ${reason} limit.`,
    toJsonPointer(path),
    { reason, [reason]: max, [actualName]: actual },
  );
}

function resolvedLimit(
  parsed: Partial<GeoJsonLimits>,
  name: keyof GeoJsonLimits,
): number {
  const value = Object.getOwnPropertyDescriptor(parsed, name)?.value;
  return typeof value === 'number' ? value : DEFAULT_GEOJSON_LIMITS[name];
}

function resolveLimits(limits: unknown):
  | { ok: true; limits: Readonly<GeoJsonLimits> }
  | { ok: false; error: StyleToolError } {
  let parsed: ReturnType<typeof geoJsonLimitsSchema.safeParse>;
  try {
    parsed = geoJsonLimitsSchema.safeParse(limits === undefined ? {} : limits);
  } catch {
    return { ok: false, error: invalidInput('GeoJSON limits are invalid.', []) };
  }
  if (!parsed.success) return { ok: false, error: schemaFailure(parsed.error) };
  return {
    ok: true,
    limits: Object.freeze({
      maxBytes: resolvedLimit(parsed.data, 'maxBytes'),
      maxFeatures: resolvedLimit(parsed.data, 'maxFeatures'),
      maxCoordinatePositions: resolvedLimit(parsed.data, 'maxCoordinatePositions'),
      maxGeometryDepth: resolvedLimit(parsed.data, 'maxGeometryDepth'),
      maxPropertyDepth: resolvedLimit(parsed.data, 'maxPropertyDepth'),
    }),
  };
}

function pushCoordinateChildren(
  stack: TraversalWork[],
  values: JsonValue[],
  path: (string | number)[],
  geometryDepth: number,
  coordinateRole: CoordinateRole,
): void {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    appendOwn(stack, {
      kind: 'coordinates',
      value: ownValue(values, String(index))!,
      path: pathWith(path, index),
      geometryDepth,
      coordinateRole,
    });
  }
}

function walkCoordinates(
  current: Extract<TraversalWork, { kind: 'coordinates' }>,
  stack: TraversalWork[],
  counts: Counts,
  limits: Readonly<GeoJsonLimits>,
): StyleToolError | undefined {
  if (!Array.isArray(current.value)) {
    return invalidInput('coordinates have the wrong nesting shape', current.path);
  }
  const values = current.value;
  if (current.coordinateRole === 'position') {
    if (values.length < 2) {
      return invalidInput('a position must contain at least two numbers', current.path);
    }
    for (let index = 0; index < values.length; index += 1) {
      const component = ownValue(values, String(index));
      if (typeof component !== 'number' || !Number.isFinite(component)) {
        return invalidInput(
          'position components must be finite numbers', pathWith(current.path, index),
        );
      }
    }
    counts.coordinatePositionCount += 1;
    if (counts.coordinatePositionCount > limits.maxCoordinatePositions) {
      return limitFailure(
        'maxCoordinatePositions',
        limits.maxCoordinatePositions,
        counts.coordinatePositionCount,
        current.path,
      );
    }
    return undefined;
  }
  if (current.coordinateRole === 'line' && values.length < 2) {
    return invalidInput('a LineString must contain at least two positions', current.path);
  }
  if (current.coordinateRole === 'ring' && values.length < 4) {
    return invalidInput('a linear ring must contain at least four positions', current.path);
  }
  if (current.coordinateRole === 'ring') {
    appendOwn(stack, {
      kind: 'ringClosure',
      value: values,
      path: current.path,
      geometryDepth: current.geometryDepth,
    });
    pushCoordinateChildren(
      stack, values, current.path, current.geometryDepth, 'position',
    );
    return undefined;
  }
  const childRole: CoordinateRole = current.coordinateRole === 'positions'
    || current.coordinateRole === 'line'
    ? 'position'
    : current.coordinateRole === 'lines' ? 'line'
      : current.coordinateRole === 'polygon' ? 'ring' : 'polygon';
  pushCoordinateChildren(
    stack, values, current.path, current.geometryDepth, childRole,
  );
  return undefined;
}

function pushGeometryCoordinates(
  stack: TraversalWork[],
  geometry: GeoJsonGeometry,
  path: (string | number)[],
  geometryDepth: number,
): void {
  const coordinates = ownValue(geometry, 'coordinates')!;
  const coordinateRole: CoordinateRole = geometry.type === 'Point' ? 'position'
    : geometry.type === 'MultiPoint' ? 'positions'
      : geometry.type === 'LineString' ? 'line'
        : geometry.type === 'MultiLineString' ? 'lines'
          : geometry.type === 'Polygon' ? 'polygon' : 'polygons';
  appendOwn(stack, {
    kind: 'coordinates',
    value: coordinates,
    path: pathWith(path, 'coordinates'),
    geometryDepth,
    coordinateRole,
  });
}

function walkGeometry(
  current: Extract<TraversalWork, { kind: 'geometry' }>,
  stack: TraversalWork[],
  limits: Readonly<GeoJsonLimits>,
): StyleToolError | undefined {
  if (current.geometryDepth > limits.maxGeometryDepth) {
    return limitFailure(
      'maxGeometryDepth',
      limits.maxGeometryDepth,
      current.geometryDepth,
      current.path,
    );
  }
  if (current.value.type !== 'GeometryCollection') {
    pushGeometryCoordinates(stack, current.value, current.path, current.geometryDepth);
    return undefined;
  }
  const geometries = ownValue(current.value, 'geometries') as GeoJsonGeometry[];
  const geometriesPath = pathWith(current.path, 'geometries');
  for (let index = geometries.length - 1; index >= 0; index -= 1) {
    appendOwn(stack, {
      kind: 'geometry',
      value: ownValue(geometries, String(index)) as GeoJsonGeometry,
      path: pathWith(geometriesPath, index),
      geometryDepth: current.geometryDepth + 1,
    });
  }
  return undefined;
}

function pushPropertyChildren(
  stack: PropertyWork[],
  value: JsonObject | JsonValue[],
  path: (string | number)[],
  propertyDepth: number,
): void {
  const keys = Reflect.ownKeys(value);
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const key = keys[index];
    if (typeof key !== 'string' || (Array.isArray(value) && key === 'length')) continue;
    const child = ownValue(value, key)!;
    const childIsContainer = typeof child === 'object' && child !== null;
    appendOwn(stack, {
      value: child,
      path: pathWith(path, Array.isArray(value) ? Number(key) : key),
      propertyDepth: propertyDepth + (childIsContainer ? 1 : 0),
    });
  }
}

function walkProperties(
  stack: PropertyWork[],
  limits: Readonly<GeoJsonLimits>,
): StyleToolError | undefined {
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) return invalidInput('GeoJSON property validation failed.', []);
    if (current.propertyDepth > limits.maxPropertyDepth) {
      return limitFailure(
        'maxPropertyDepth',
        limits.maxPropertyDepth,
        current.propertyDepth,
        current.path,
      );
    }
    if (typeof current.value === 'object' && current.value !== null) {
      pushPropertyChildren(
        stack,
        current.value as JsonObject | JsonValue[],
        current.path,
        current.propertyDepth,
      );
    }
  }
  return undefined;
}

function countGeoJson(
  value: InlineGeoJson,
  limits: Readonly<GeoJsonLimits>,
): CountResult {
  const counts: Counts = { featureCount: 0, coordinatePositionCount: 0 };
  const stack: TraversalWork[] = [];
  const propertyStack: PropertyWork[] = [];
  if (value.type === 'Feature') {
    appendOwn(stack, { kind: 'feature', value, path: [] });
  } else if (value.type === 'FeatureCollection') {
    for (let index = value.features.length - 1; index >= 0; index -= 1) {
      appendOwn(stack, {
        kind: 'feature', value: value.features[index]!, path: ['features', index],
      });
    }
  } else {
    appendOwn(stack, { kind: 'geometry', value, path: [], geometryDepth: 1 });
  }

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      return { ok: false, error: invalidInput('GeoJSON traversal failed.', []) };
    }
    if (current.kind === 'ringClosure') {
      const first = ownValue(current.value, '0')!;
      const last = ownValue(current.value, String(current.value.length - 1))!;
      if (!jsonValuesEqual(first, last)) {
        return { ok: false, error: invalidInput('a linear ring must be closed', current.path) };
      }
      continue;
    }
    if (current.kind === 'coordinates') {
      const error = walkCoordinates(current, stack, counts, limits);
      if (error !== undefined) return { ok: false, error };
      continue;
    }
    if (current.kind === 'geometry') {
      const error = walkGeometry(current, stack, limits);
      if (error !== undefined) return { ok: false, error };
      continue;
    }
    counts.featureCount += 1;
    if (counts.featureCount > limits.maxFeatures) {
      return {
        ok: false,
        error: limitFailure(
          'maxFeatures', limits.maxFeatures, counts.featureCount, current.path,
        ),
      };
    }
    if (current.value.properties !== null) {
      appendOwn(propertyStack, {
        value: current.value.properties,
        path: pathWith(current.path, 'properties'),
        propertyDepth: 0,
      });
      const propertyError = walkProperties(propertyStack, limits);
      if (propertyError !== undefined) return { ok: false, error: propertyError };
    }
    if (current.value.geometry !== null) {
      appendOwn(stack, {
        kind: 'geometry',
        value: current.value.geometry,
        path: pathWith(current.path, 'geometry'),
        geometryDepth: 1,
      });
    }
  }
  return { ok: true, counts };
}

export function validateInlineGeoJson(
  value: unknown,
  limits?: Partial<GeoJsonLimits>,
): InlineGeoJsonValidationResult {
  const resolved = resolveLimits(limits);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  let parsed: ReturnType<typeof inlineGeoJsonSchema.safeParse>;
  try {
    parsed = inlineGeoJsonSchema.safeParse(value);
  } catch {
    return { ok: false, error: invalidInput('GeoJSON input is invalid.', []) };
  }
  if (!parsed.success) return { ok: false, error: schemaFailure(parsed.error) };

  let counted: CountResult;
  try {
    counted = countGeoJson(parsed.data, resolved.limits);
  } catch {
    return {
      ok: false,
      error: createStyleToolError(
        'INTERNAL', 'Sanitized GeoJSON could not be traversed safely.', '',
      ),
    };
  }
  if (!counted.ok) return { ok: false, error: counted.error };

  let actualBytes: number;
  try {
    actualBytes = jsonUtf8ByteLength(parsed.data);
  } catch {
    return {
      ok: false,
      error: createStyleToolError(
        'INTERNAL', 'Sanitized GeoJSON could not be serialized for size validation.', '',
      ),
    };
  }
  if (actualBytes > resolved.limits.maxBytes) {
    return {
      ok: false,
      error: limitFailure('maxBytes', resolved.limits.maxBytes, actualBytes, []),
    };
  }

  return {
    ok: true,
    value: parsed.data,
    featureCount: counted.counts.featureCount,
    coordinatePositionCount: counted.counts.coordinatePositionCount,
  };
}
