import type { ZodError } from 'zod';
import { createStyleToolError } from './errors.js';
import { validateInlineGeoJson } from './geojson.js';
import { toJsonPointer } from './json-pointer.js';
import {
  geoJsonAnalysisInputSchema,
  geoJsonAnalysisOptionsSchema,
} from './schemas.js';
import type {
  GeoJsonAnalysisOptions,
  GeoJsonAnalysisAvailable,
  GeoJsonAnalysisResult,
  GeoJsonFeature,
  GeoJsonGeometry,
  GeoJsonGeometryCounts,
  GeoJsonGeometryType,
  GeoJsonPosition,
  GeoJsonPropertyAnalysis,
  GeoJsonPropertyType,
  InlineGeoJson,
  JsonPrimitive,
  JsonValue,
  StyleToolError,
  StyleWarning,
} from './types.js';

export {
  geoJsonAnalysisInputSchema,
  geoJsonAnalysisOptionsSchema,
} from './schemas.js';

const GEOMETRY_TYPES: readonly GeoJsonGeometryType[] = Object.freeze([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
]);
const PROPERTY_TYPES: readonly GeoJsonPropertyType[] = Object.freeze([
  'string', 'number', 'boolean', 'null', 'array', 'object',
]);

type PropertyAccumulator = {
  types: Set<GeoJsonPropertyType>;
  numericMin: number | undefined;
  numericMax: number | undefined;
  frequencies: Map<JsonPrimitive, number>;
};
type AnalysisAccumulators = {
  bbox: [number, number, number, number] | undefined;
  geometryCounts: Map<GeoJsonGeometryType, number>;
  properties: Map<string, PropertyAccumulator>;
};

function schemaFailure(error: ZodError): StyleToolError {
  const issue = error.issues[0];
  if (issue === undefined) {
    return createStyleToolError('INVALID_INPUT', 'GeoJSON analysis input is invalid.', '');
  }
  return createStyleToolError(
    'INVALID_INPUT',
    issue.message,
    toJsonPointer(issue.path.map((token) => String(token))),
  );
}

function safeParseOptions(options: unknown):
  | { ok: true; value: GeoJsonAnalysisOptions }
  | { ok: false; error: StyleToolError } {
  try {
    const parsed = geoJsonAnalysisOptionsSchema.safeParse(
      options === undefined ? {} : options,
    );
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, error: schemaFailure(parsed.error) };
  } catch {
    return {
      ok: false,
      error: createStyleToolError(
        'INVALID_INPUT', 'GeoJSON analysis options are invalid.', '',
      ),
    };
  }
}

function safeParseInput(input: unknown):
  | { ok: true; value: string | InlineGeoJson }
  | { ok: false; error: StyleToolError } {
  try {
    const parsed = geoJsonAnalysisInputSchema.safeParse(input);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, error: schemaFailure(parsed.error) };
  } catch {
    return {
      ok: false,
      error: createStyleToolError(
        'INVALID_INPUT', 'GeoJSON analysis input is invalid.', '',
      ),
    };
  }
}

function appendPosition(
  accumulators: AnalysisAccumulators,
  position: GeoJsonPosition,
): void {
  const west = position[0];
  const south = position[1];
  if (accumulators.bbox === undefined) {
    accumulators.bbox = [west, south, west, south];
    return;
  }
  accumulators.bbox[0] = Math.min(accumulators.bbox[0], west);
  accumulators.bbox[1] = Math.min(accumulators.bbox[1], south);
  accumulators.bbox[2] = Math.max(accumulators.bbox[2], west);
  accumulators.bbox[3] = Math.max(accumulators.bbox[3], south);
}

function appendGeometryCoordinates(
  accumulators: AnalysisAccumulators,
  geometry: Exclude<GeoJsonGeometry, { type: 'GeometryCollection' }>,
): void {
  switch (geometry.type) {
    case 'Point':
      appendPosition(accumulators, geometry.coordinates);
      break;
    case 'MultiPoint':
    case 'LineString':
      for (const position of geometry.coordinates) {
        appendPosition(accumulators, position);
      }
      break;
    case 'MultiLineString':
    case 'Polygon':
      for (const line of geometry.coordinates) {
        for (const position of line) appendPosition(accumulators, position);
      }
      break;
    case 'MultiPolygon':
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          for (const position of ring) appendPosition(accumulators, position);
        }
      }
      break;
  }
}

function appendGeometries(
  accumulators: AnalysisAccumulators,
  root: GeoJsonGeometry,
): void {
  const stack: GeoJsonGeometry[] = [root];
  while (stack.length > 0) {
    const geometry = stack.pop();
    if (geometry === undefined) continue;
    accumulators.geometryCounts.set(
      geometry.type,
      (accumulators.geometryCounts.get(geometry.type) ?? 0) + 1,
    );
    if (geometry.type !== 'GeometryCollection') {
      appendGeometryCoordinates(accumulators, geometry);
      continue;
    }
    for (let index = geometry.geometries.length - 1; index >= 0; index -= 1) {
      const child = geometry.geometries[index];
      if (child !== undefined) stack.push(child);
    }
  }
}

function propertyType(value: JsonValue): GeoJsonPropertyType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  return 'boolean';
}

function appendProperty(
  accumulators: AnalysisAccumulators,
  name: string,
  value: JsonValue,
): void {
  let property = accumulators.properties.get(name);
  if (property === undefined) {
    property = {
      types: new Set(),
      numericMin: undefined,
      numericMax: undefined,
      frequencies: new Map(),
    };
    accumulators.properties.set(name, property);
  }
  const type = propertyType(value);
  property.types.add(type);
  if (typeof value === 'number') {
    property.numericMin = property.numericMin === undefined
      ? value : Math.min(property.numericMin, value);
    property.numericMax = property.numericMax === undefined
      ? value : Math.max(property.numericMax, value);
  }
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    property.frequencies.set(value, (property.frequencies.get(value) ?? 0) + 1);
  }
}

function appendFeature(
  accumulators: AnalysisAccumulators,
  feature: GeoJsonFeature,
): void {
  if (feature.geometry !== null) appendGeometries(accumulators, feature.geometry);
  if (feature.properties === null) return;
  for (const name of Object.keys(feature.properties)) {
    const descriptor = Object.getOwnPropertyDescriptor(feature.properties, name);
    if (descriptor !== undefined && 'value' in descriptor) {
      appendProperty(accumulators, name, descriptor.value);
    }
  }
}

function stablePrimitive(value: JsonPrimitive): string {
  return `${String(value)}:${value === null ? 'null' : typeof value}`;
}

function summarizeProperty(
  name: string,
  accumulator: PropertyAccumulator,
  topValueLimit: number,
): GeoJsonPropertyAnalysis {
  const analysis: GeoJsonPropertyAnalysis = {
    name,
    types: PROPERTY_TYPES.filter((type) => accumulator.types.has(type)),
  };
  if (
    accumulator.numericMin !== undefined
    && accumulator.numericMax !== undefined
  ) {
    analysis.numericRange = {
      min: accumulator.numericMin,
      max: accumulator.numericMax,
    };
  }
  if (accumulator.frequencies.size > 0) {
    analysis.topValues = [...accumulator.frequencies.entries()]
      .sort((left, right) => (
        right[1] - left[1]
        || stablePrimitive(left[0]).localeCompare(stablePrimitive(right[0]), 'en')
      ))
      .slice(0, topValueLimit)
      .map(([value, count]) => ({ value, count }));
  }
  return analysis;
}

function propertyWarnings(
  properties: readonly GeoJsonPropertyAnalysis[],
): StyleWarning[] {
  const warnings: StyleWarning[] = [];
  for (const property of properties) {
    if (property.types.some((type) => type === 'array' || type === 'object')) {
      warnings.push({
        code: 'GEOJSON_PROPERTY_UNSUPPORTED',
        message: `Property "${property.name}" contains array or object values.`,
        path: `/properties/${property.name}`,
      });
    }
    if (property.types.length > 1) {
      warnings.push({
        code: 'GEOJSON_PROPERTY_MIXED_TYPES',
        message: `Property "${property.name}" contains mixed value types.`,
        path: `/properties/${property.name}`,
      });
    }
  }
  return warnings;
}

function geometryCounts(
  counts: ReadonlyMap<GeoJsonGeometryType, number>,
): GeoJsonGeometryCounts {
  const result: GeoJsonGeometryCounts = {};
  for (const type of GEOMETRY_TYPES) {
    const count = counts.get(type);
    if (count !== undefined) result[type] = count;
  }
  return result;
}

function analyzeValidated(
  value: InlineGeoJson,
  featureCount: number,
  topValueLimit: number,
): GeoJsonAnalysisResult {
  const accumulators: AnalysisAccumulators = {
    bbox: undefined,
    geometryCounts: new Map(),
    properties: new Map(),
  };
  if (value.type === 'Feature') {
    appendFeature(accumulators, value);
  } else if (value.type === 'FeatureCollection') {
    for (const feature of value.features) appendFeature(accumulators, feature);
  } else {
    appendGeometries(accumulators, value);
  }

  const properties = [...accumulators.properties.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([name, accumulator]) => (
      summarizeProperty(name, accumulator, topValueLimit)
    ));
  const analysis: GeoJsonAnalysisAvailable = {
    available: true,
    featureCount,
    geometryTypes: geometryCounts(accumulators.geometryCounts),
    properties,
    warnings: propertyWarnings(properties),
  };
  return accumulators.bbox === undefined
    ? { ok: true, analysis }
    : { ok: true, analysis: { ...analysis, bbox: accumulators.bbox } };
}

export function analyzeGeoJson(
  input: unknown,
  options?: GeoJsonAnalysisOptions,
): GeoJsonAnalysisResult {
  const parsedOptions = safeParseOptions(options);
  if (!parsedOptions.ok) return { ok: false, error: parsedOptions.error };

  const parsedInput = safeParseInput(input);
  if (!parsedInput.ok) return { ok: false, error: parsedInput.error };
  if (typeof parsedInput.value === 'string') {
    return {
      ok: true,
      analysis: {
        available: false,
        reason: 'remote-url',
        warnings: [{
          code: 'GEOJSON_ANALYSIS_UNAVAILABLE',
          message: 'Remote GeoJSON cannot be analyzed without fetching it.',
        }],
      },
    };
  }

  const validated = validateInlineGeoJson(
    parsedInput.value,
    parsedOptions.value.limits,
  );
  if (!validated.ok) return { ok: false, error: validated.error };
  return analyzeValidated(
    validated.value,
    validated.featureCount,
    parsedOptions.value.topValueLimit ?? 10,
  );
}
