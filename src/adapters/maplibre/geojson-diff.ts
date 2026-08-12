import { z } from 'zod';
import {
  DEFAULT_GEOJSON_LIMITS,
  DEFAULT_MAX_DIFF_BYTES,
  createStyleToolError,
  jsonUtf8ByteLength,
  jsonValueSchema,
  validateInlineGeoJson,
} from '../../core/index.js';
import { toJsonPointer } from '../../core/json-pointer.js';
import type {
  GeoJsonFeatureCollection,
  GeoJsonFeature,
  GeoJsonGeometry,
  JsonObject,
  JsonValue,
  StyleToolError,
} from '../../core/index.js';
import type {
  RuntimeGeoJsonAddFeature,
  RuntimeGeoJsonDiffUpdate,
  RuntimeGeoJsonFeatureId,
  RuntimeGeoJsonFeaturePatch,
  RuntimeGeoJsonPropertyPatch,
  RuntimeGeoJsonSourceDiff,
  RuntimeGeoJsonSourceDiffValidationResult,
} from './types.js';

const DANGEROUS_PROPERTY_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const nonEmptyStringSchema = z.string().min(1);
const featureIdSchema: z.ZodType<RuntimeGeoJsonFeatureId> = z.union([
  z.string(),
  z.number().finite(),
]);
const jsonValueAfterSnapshotSchema = z.custom<JsonValue>();
const geometryAfterSnapshotSchema = z.custom<GeoJsonGeometry>();
const featureAfterSnapshotSchema = z.custom<RuntimeGeoJsonAddFeature>();

function hasNonNullGeometry(
  feature: GeoJsonFeature,
): feature is RuntimeGeoJsonAddFeature {
  return feature.geometry !== null;
}

function hasUniqueValues(values: readonly (string | number)[]): boolean {
  return new Set(values).size === values.length;
}

function hasSafePropertyName(value: string): boolean {
  return value.length > 0 && !DANGEROUS_PROPERTY_KEYS.has(value);
}

const propertyPatchSchema: z.ZodType<RuntimeGeoJsonPropertyPatch> = z.object({
  key: nonEmptyStringSchema.refine(
    hasSafePropertyName,
    'Property patch keys must not be dangerous object keys.',
  ),
  value: jsonValueAfterSnapshotSchema,
}).strict();

const nonEmptyUniquePropertyNamesSchema = z.array(
  nonEmptyStringSchema.refine(
    hasSafePropertyName,
    'Property names must not be dangerous object keys.',
  ),
).min(1).refine(hasUniqueValues, 'Property names must be unique.');

const nonEmptyPropertyPatchesSchema = z.array(propertyPatchSchema).min(1).refine(
  (patches) => hasUniqueValues(patches.map((patch) => patch.key)),
  'Property patch keys must be unique.',
);

const featurePatchSchema: z.ZodType<RuntimeGeoJsonFeaturePatch> = z.object({
  id: featureIdSchema,
  newGeometry: geometryAfterSnapshotSchema.optional(),
  removeAllProperties: z.boolean().optional(),
  removeProperties: nonEmptyUniquePropertyNamesSchema.optional(),
  addOrUpdateProperties: nonEmptyPropertyPatchesSchema.optional(),
}).strict().refine(
  (patch) => patch.newGeometry !== undefined
    || patch.removeAllProperties === true
    || patch.removeProperties !== undefined
    || patch.addOrUpdateProperties !== undefined,
  'A feature update must contain at least one effective action.',
);

const diffGrammarSchema: z.ZodType<RuntimeGeoJsonSourceDiff> = z.object({
  removeAll: z.boolean().optional(),
  remove: z.array(featureIdSchema).min(1).refine(
    hasUniqueValues,
    'Removed feature IDs must be unique.',
  ).optional(),
  add: z.array(featureAfterSnapshotSchema).min(1).optional(),
  update: z.array(featurePatchSchema).min(1).refine(
    (patches) => hasUniqueValues(patches.map((patch) => patch.id)),
    'Updated feature IDs must be unique.',
  ).optional(),
}).strict().refine(
  (diff) => diff.removeAll === true
    || diff.remove !== undefined
    || diff.add !== undefined
    || diff.update !== undefined,
  'A GeoJSON source diff must contain at least one effective action.',
);

function decodePointerSegments(pointer: string | undefined): string[] {
  if (pointer === undefined || pointer === '') return [];
  return pointer.slice(1).split('/').map(
    (token) => token.replaceAll('~1', '/').replaceAll('~0', '~'),
  );
}

function decodePointer(pointer: string | undefined): Array<string | number> {
  return decodePointerSegments(pointer).map((decoded) => {
    const index = Number(decoded);
    return Number.isSafeInteger(index) && index >= 0 && String(index) === decoded
      ? index
      : decoded;
  });
}

function invalidInput(
  message: string,
  path: readonly (string | number)[] = [],
  details?: JsonObject,
): StyleToolError {
  return createStyleToolError('INVALID_INPUT', message, toJsonPointer(path), details);
}

function prefixedValidationError(
  error: StyleToolError,
  prefix: readonly (string | number)[],
): StyleToolError {
  return invalidInput(error.message, [...prefix, ...decodePointer(error.path)], error.details);
}

function additionValidationError(error: StyleToolError): StyleToolError {
  const path = decodePointer(error.path);
  const translated = path[0] === 'features' ? ['add', ...path.slice(1)] : ['add', ...path];
  return invalidInput(error.message, translated, error.details);
}

function propertyValidationError(
  error: StyleToolError,
  updateIndex: number,
  propertyIndexes: ReadonlyMap<string, number>,
): StyleToolError {
  const path = decodePointerSegments(error.path);
  if (path[0] === 'properties' && path[1] !== undefined) {
    const propertyIndex = propertyIndexes.get(path[1]);
    if (propertyIndex !== undefined) {
      return invalidInput(
        error.message,
        [
          'update', updateIndex, 'addOrUpdateProperties', propertyIndex, 'value',
          ...path.slice(2),
        ],
        error.details,
      );
    }
  }
  return prefixedValidationError(
    error,
    ['update', updateIndex, 'addOrUpdateProperties'],
  );
}

function definePropertyValue(target: JsonObject, key: string, value: JsonValue): void {
  Reflect.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function sanitizePropertyPatches(
  patches: RuntimeGeoJsonPropertyPatch[],
  updateIndex: number,
): { ok: true; value: RuntimeGeoJsonPropertyPatch[] } | { ok: false; error: StyleToolError } {
  const properties: JsonObject = {};
  const propertyIndexes = new Map<string, number>();
  for (let index = 0; index < patches.length; index += 1) {
    const patch = patches[index]!;
    propertyIndexes.set(patch.key, index);
    definePropertyValue(properties, patch.key, patch.value);
  }
  const syntheticFeature = {
    type: 'Feature' as const,
    geometry: null,
    properties,
  };
  const validated = validateInlineGeoJson(syntheticFeature);
  if (!validated.ok) {
    return {
      ok: false,
      error: propertyValidationError(validated.error, updateIndex, propertyIndexes),
    };
  }
  if (validated.value.type !== 'Feature' || validated.value.properties === null) {
    return {
      ok: false,
      error: invalidInput(
        'GeoJSON property patches could not be validated.',
        ['update', updateIndex, 'addOrUpdateProperties'],
      ),
    };
  }
  const sanitizedProperties = validated.value.properties;
  return {
    ok: true,
    value: patches.map((patch) => ({
      key: patch.key,
      value: sanitizedProperties[patch.key]!,
    })),
  };
}

function validateAndSanitizeDiff(
  plainDiff: RuntimeGeoJsonSourceDiff,
): RuntimeGeoJsonSourceDiffValidationResult {
  const changedFeatures = (plainDiff.remove?.length ?? 0)
    + (plainDiff.add?.length ?? 0)
    + (plainDiff.update?.length ?? 0);
  if (changedFeatures > DEFAULT_GEOJSON_LIMITS.maxFeatures) {
    return {
      ok: false,
      error: invalidInput(
        'GeoJSON diff exceeds the configured maxFeatures limit.',
        [],
        {
          reason: 'maxFeatures',
          maxFeatures: DEFAULT_GEOJSON_LIMITS.maxFeatures,
          actualFeatures: changedFeatures,
        },
      ),
    };
  }

  let coordinatePositionCount = 0;
  let sanitizedAdd: RuntimeGeoJsonAddFeature[] | undefined;
  if (plainDiff.add !== undefined) {
    const collection: GeoJsonFeatureCollection = {
      type: 'FeatureCollection',
      features: plainDiff.add,
    };
    const validated = validateInlineGeoJson(collection);
    if (!validated.ok) return { ok: false, error: additionValidationError(validated.error) };
    if (validated.value.type !== 'FeatureCollection') {
      return { ok: false, error: invalidInput('Added GeoJSON features are invalid.', ['add']) };
    }
    const additions: RuntimeGeoJsonAddFeature[] = [];
    for (let index = 0; index < validated.value.features.length; index += 1) {
      const feature = validated.value.features[index]!;
      if (!hasNonNullGeometry(feature)) {
        return {
          ok: false,
          error: invalidInput(
            'Added GeoJSON features must have non-null geometry.',
            ['add', index, 'geometry'],
          ),
        };
      }
      additions.push(feature);
    }
    sanitizedAdd = additions;
    coordinatePositionCount += validated.coordinatePositionCount;
  }

  let sanitizedUpdate: RuntimeGeoJsonFeaturePatch[] | undefined;
  if (plainDiff.update !== undefined) {
    sanitizedUpdate = [];
    for (let index = 0; index < plainDiff.update.length; index += 1) {
      const patch = plainDiff.update[index]!;
      let newGeometry: GeoJsonGeometry | undefined;
      if (patch.newGeometry !== undefined) {
        if (patch.newGeometry === null) {
          return {
            ok: false,
            error: invalidInput(
              'Replacement geometry must be non-null.',
              ['update', index, 'newGeometry'],
            ),
          };
        }
        const validated = validateInlineGeoJson(patch.newGeometry);
        if (!validated.ok) {
          return {
            ok: false,
            error: prefixedValidationError(
              validated.error,
              ['update', index, 'newGeometry'],
            ),
          };
        }
        if (validated.value.type === 'Feature' || validated.value.type === 'FeatureCollection') {
          return {
            ok: false,
            error: invalidInput(
              'Replacement geometry must be a GeoJSON geometry.',
              ['update', index, 'newGeometry'],
            ),
          };
        }
        newGeometry = validated.value;
        coordinatePositionCount += validated.coordinatePositionCount;
        if (coordinatePositionCount > DEFAULT_GEOJSON_LIMITS.maxCoordinatePositions) {
          return {
            ok: false,
            error: invalidInput(
              'GeoJSON diff exceeds the configured maxCoordinatePositions limit.',
              ['update', index, 'newGeometry'],
              {
                reason: 'maxCoordinatePositions',
                maxCoordinatePositions: DEFAULT_GEOJSON_LIMITS.maxCoordinatePositions,
                actualCoordinatePositions: coordinatePositionCount,
              },
            ),
          };
        }
      }

      let addOrUpdateProperties: RuntimeGeoJsonPropertyPatch[] | undefined;
      if (patch.addOrUpdateProperties !== undefined) {
        const validated = sanitizePropertyPatches(patch.addOrUpdateProperties, index);
        if (!validated.ok) return validated;
        addOrUpdateProperties = validated.value;
      }
      const sanitizedPatch: RuntimeGeoJsonFeaturePatch = { id: patch.id };
      if (newGeometry !== undefined) sanitizedPatch.newGeometry = newGeometry;
      if (patch.removeAllProperties !== undefined) {
        sanitizedPatch.removeAllProperties = patch.removeAllProperties;
      }
      if (patch.removeProperties !== undefined) {
        sanitizedPatch.removeProperties = [...patch.removeProperties];
      }
      if (addOrUpdateProperties !== undefined) {
        sanitizedPatch.addOrUpdateProperties = addOrUpdateProperties;
      }
      sanitizedUpdate.push(sanitizedPatch);
    }
  }

  if (coordinatePositionCount > DEFAULT_GEOJSON_LIMITS.maxCoordinatePositions) {
    return {
      ok: false,
      error: invalidInput(
        'GeoJSON diff exceeds the configured maxCoordinatePositions limit.',
        ['add'],
        {
          reason: 'maxCoordinatePositions',
          maxCoordinatePositions: DEFAULT_GEOJSON_LIMITS.maxCoordinatePositions,
          actualCoordinatePositions: coordinatePositionCount,
        },
      ),
    };
  }

  const sanitized: RuntimeGeoJsonSourceDiff = {};
  if (plainDiff.removeAll !== undefined) sanitized.removeAll = plainDiff.removeAll;
  if (plainDiff.remove !== undefined) sanitized.remove = [...plainDiff.remove];
  if (sanitizedAdd !== undefined) sanitized.add = sanitizedAdd;
  if (sanitizedUpdate !== undefined) sanitized.update = sanitizedUpdate;

  let actualBytes: number;
  try {
    actualBytes = jsonUtf8ByteLength(plainDiff);
  } catch {
    return {
      ok: false,
      error: invalidInput('GeoJSON diff could not be serialized for size validation.'),
    };
  }
  if (actualBytes > DEFAULT_MAX_DIFF_BYTES) {
    return {
      ok: false,
      error: invalidInput(
        'GeoJSON diff exceeds the configured UTF-8 JSON size limit.',
        [],
        {
          reason: 'maxBytes',
          maxBytes: DEFAULT_MAX_DIFF_BYTES,
          actualBytes,
        },
      ),
    };
  }
  return { ok: true, value: sanitized };
}

function addValidationIssue(
  context: z.RefinementCtx,
  error: StyleToolError,
  prefix: readonly (string | number)[] = [],
): void {
  context.addIssue({
    code: 'custom',
    message: error.message,
    path: [...prefix, ...decodePointer(error.path)],
    params: error.details,
  });
}

function addGrammarIssues(
  context: z.RefinementCtx,
  error: z.ZodError,
  prefix: readonly (string | number)[] = [],
): void {
  for (const issue of error.issues) {
    context.addIssue({
      code: 'custom',
      message: issue.message,
      path: [...prefix, ...issue.path.map((token) => (
        typeof token === 'symbol' ? String(token) : token
      ))],
    });
  }
}

function validateSanitizedDiff(
  value: JsonValue,
  context: z.RefinementCtx,
  prefix: readonly (string | number)[] = [],
): RuntimeGeoJsonSourceDiff | typeof z.NEVER {
  const grammar = diffGrammarSchema.safeParse(value);
  if (!grammar.success) {
    addGrammarIssues(context, grammar.error, prefix);
    return z.NEVER;
  }
  const result = validateAndSanitizeDiff(grammar.data);
  if (!result.ok) {
    addValidationIssue(context, result.error, prefix);
    return z.NEVER;
  }
  return result.value;
}

export const runtimeGeoJsonSourceDiffSchema: z.ZodType<RuntimeGeoJsonSourceDiff> =
  jsonValueSchema.transform<RuntimeGeoJsonSourceDiff>((value, context) => (
    validateSanitizedDiff(value, context)
  ));

const diffUpdateGrammarSchema = z.object({
  sourceId: nonEmptyStringSchema,
  diff: z.custom<JsonValue>(),
}).strict();

export const runtimeGeoJsonDiffUpdateSchema: z.ZodType<RuntimeGeoJsonDiffUpdate> =
  jsonValueSchema.transform<RuntimeGeoJsonDiffUpdate>((value, context) => {
    const envelope = diffUpdateGrammarSchema.safeParse(value);
    if (!envelope.success) {
      addGrammarIssues(context, envelope.error);
      return z.NEVER;
    }
    const diff = validateSanitizedDiff(envelope.data.diff, context, ['diff']);
    if (diff === z.NEVER) return z.NEVER;
    return { sourceId: envelope.data.sourceId, diff };
  });

function schemaError(error: z.ZodError): StyleToolError {
  const issue = error.issues[0];
  if (issue === undefined) return invalidInput('GeoJSON source diff is invalid.');
  const details = 'params' in issue && issue.params !== undefined
    ? jsonValueSchema.safeParse(issue.params)
    : undefined;
  return invalidInput(
    issue.message,
    issue.path.map((token) => typeof token === 'symbol' ? String(token) : token),
    details?.success && !Array.isArray(details.data)
      && details.data !== null && typeof details.data === 'object'
      ? details.data
      : undefined,
  );
}

export function sanitizeRuntimeGeoJsonSourceDiff(
  value: unknown,
): RuntimeGeoJsonSourceDiffValidationResult {
  try {
    const parsed = runtimeGeoJsonSourceDiffSchema.safeParse(value);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, error: schemaError(parsed.error) };
  } catch {
    return {
      ok: false,
      error: invalidInput('GeoJSON source diff is invalid.'),
    };
  }
}
