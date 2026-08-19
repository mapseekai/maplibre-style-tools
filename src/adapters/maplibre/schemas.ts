import { z } from 'zod';
import { expressionFilterSchema, jsonValueSchema } from '../../core/index.js';
import type { JsonObject, JsonValue } from '../../core/index.js';
import type {
  AddImageDataInput,
  AddImageFromUrlInput,
  AddSpriteInput,
  FeatureQueryLimits,
  FeatureStateInput,
  GlobalStateInput,
  ImageDataLike,
  ImageOptionsInput,
  RemoveFeatureStateInput,
  RemoveImageInput,
  RemoveSpriteInput,
  RenderedFeatureQueryInput,
  RuntimeListInput,
  SourceTileLodParamsInput,
  SourceFeatureQueryInput,
} from './types.js';

const positiveSafeIntegerSchema = z.number().int().safe().positive();
const nonEmptyStringSchema = z.string().min(1);
const nonBlankStringSchema = z.string().trim().min(1);
const screenPointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const finiteNumberSchema = z.number().finite();
const positiveFiniteNumberSchema = finiteNumberSchema.positive();
const featureIdSchema = z.union([z.string(), finiteNumberSchema]);
const runtimeListLimitSchema = positiveSafeIntegerSchema.max(500);

export const DEFAULT_RUNTIME_LIST_LIMIT = 300;
export const MAX_RUNTIME_LIST_LIMIT = 500;

export const DEFAULT_FEATURE_QUERY_LIMITS: FeatureQueryLimits = Object.freeze({
  maxFeatures: 100,
  maxSerializedBytes: 1024 * 1024,
});

function descriptorSanitized<Output>(schema: z.ZodType<Output>): z.ZodType<Output> {
  return z.preprocess((input) => {
    try {
      const parsed = jsonValueSchema.safeParse(input);
      return parsed.success ? parsed.data : z.NEVER;
    } catch {
      return z.NEVER;
    }
  }, schema);
}

function jsonObjectAfterSnapshot(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const featureTargetInputSchema = z.object({
  source: nonEmptyStringSchema,
  sourceLayer: nonEmptyStringSchema.optional(),
  id: featureIdSchema,
}).strict();

export const sourceTileLodParamsInputSchema: z.ZodType<SourceTileLodParamsInput> =
  descriptorSanitized(z.object({
    maxZoomLevelsOnScreen: positiveFiniteNumberSchema,
    tileCountMaxMinRatio: positiveFiniteNumberSchema,
    sourceId: nonEmptyStringSchema.optional(),
  }).strict());

export const featureStateInputSchema: z.ZodType<FeatureStateInput> = descriptorSanitized(
  z.object({
    target: featureTargetInputSchema,
    state: z.custom<JsonObject>(jsonObjectAfterSnapshot),
  }).strict(),
);

export const removeFeatureStateInputSchema: z.ZodType<RemoveFeatureStateInput> =
  descriptorSanitized(z.object({
    target: featureTargetInputSchema,
    key: nonEmptyStringSchema.optional(),
  }).strict());

export const globalStateInputSchema: z.ZodType<GlobalStateInput> = descriptorSanitized(
  z.object({
    propertyName: nonEmptyStringSchema,
    value: z.custom<JsonValue>(),
  }).strict(),
);

const imageContentSchema = z.tuple([
  finiteNumberSchema,
  finiteNumberSchema,
  finiteNumberSchema,
  finiteNumberSchema,
]);
const imageStretchSchema = z.array(z.tuple([
  finiteNumberSchema,
  finiteNumberSchema,
]));
const imageOptionsInnerSchema: z.ZodType<ImageOptionsInput> = z.object({
  pixelRatio: positiveFiniteNumberSchema.optional(),
  sdf: z.boolean().optional(),
  content: imageContentSchema.optional(),
  stretchX: imageStretchSchema.optional(),
  stretchY: imageStretchSchema.optional(),
}).strict();

export const imageOptionsInputSchema: z.ZodType<ImageOptionsInput> =
  descriptorSanitized(imageOptionsInnerSchema);

function ownDataRecord(input: unknown): Record<string, unknown> | undefined {
  try {
    if (typeof input !== 'object' || input === null
      || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).length !== keys.length) return undefined;
    const output: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== 'string') return undefined;
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)
        || key === '__proto__' || key === 'prototype' || key === 'constructor') {
        return undefined;
      }
      Reflect.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: descriptor.value,
        writable: true,
      });
    }
    return output;
  } catch {
    return undefined;
  }
}

function imageDataEnvelopeSnapshot(input: unknown): unknown {
  const envelope = ownDataRecord(input);
  if (envelope === undefined) return z.NEVER;
  const image = ownDataRecord(Object.getOwnPropertyDescriptor(envelope, 'image')?.value);
  if (image === undefined) return z.NEVER;
  const data = Object.getOwnPropertyDescriptor(image, 'data')?.value;
  Reflect.defineProperty(image, 'data', {
    configurable: true,
    enumerable: true,
    value: null,
    writable: true,
  });
  Reflect.defineProperty(envelope, 'image', {
    configurable: true,
    enumerable: true,
    value: image,
    writable: true,
  });
  const sanitized = jsonValueSchema.safeParse(envelope);
  if (!sanitized.success || Array.isArray(sanitized.data)
    || sanitized.data === null || typeof sanitized.data !== 'object') return z.NEVER;
  const sanitizedImage = Object.getOwnPropertyDescriptor(sanitized.data, 'image')?.value;
  if (Array.isArray(sanitizedImage) || sanitizedImage === null
    || typeof sanitizedImage !== 'object') return z.NEVER;
  Reflect.defineProperty(sanitizedImage, 'data', {
    configurable: true,
    enumerable: true,
    value: data,
    writable: true,
  });
  return sanitized.data;
}

const imageByteArraySchema = z.custom<Uint8Array | Uint8ClampedArray>((value) => (
  ArrayBuffer.isView(value)
  && (Object.getPrototypeOf(value) === Uint8Array.prototype
    || Object.getPrototypeOf(value) === Uint8ClampedArray.prototype)
));

const imageDataLikeSchema: z.ZodType<ImageDataLike> = z.object({
  width: positiveSafeIntegerSchema,
  height: positiveSafeIntegerSchema,
  data: imageByteArraySchema,
}).strict().superRefine((image, context) => {
  const expectedLength = image.width * image.height * 4;
  if (!Number.isSafeInteger(expectedLength) || image.data.length !== expectedLength) {
    context.addIssue({
      code: 'custom',
      message: 'Image data length must equal width * height * 4.',
      path: ['data'],
    });
  }
});

export const addImageDataInputSchema: z.ZodType<AddImageDataInput> = z.preprocess(
  imageDataEnvelopeSnapshot,
  z.object({
    imageId: nonEmptyStringSchema,
    image: imageDataLikeSchema,
    options: imageOptionsInputSchema.optional(),
    overwrite: z.boolean().optional(),
  }).strict(),
);

export const addImageFromUrlInputSchema: z.ZodType<AddImageFromUrlInput> =
  descriptorSanitized(z.object({
    imageId: nonEmptyStringSchema,
    url: nonEmptyStringSchema,
    options: imageOptionsInnerSchema.optional(),
    overwrite: z.boolean().optional(),
  }).strict());

export const addSpriteInputSchema: z.ZodType<AddSpriteInput> = descriptorSanitized(
  z.object({
    spriteId: nonEmptyStringSchema,
    url: nonEmptyStringSchema,
    overwrite: z.boolean().optional(),
  }).strict(),
);

export const runtimeListInputSchema: z.ZodType<RuntimeListInput> = descriptorSanitized(
  z.object({ limit: runtimeListLimitSchema.optional() }).strict(),
);

export const removeImageInputSchema: z.ZodType<RemoveImageInput> = descriptorSanitized(
  z.object({ imageId: nonEmptyStringSchema }).strict(),
);

export const removeSpriteInputSchema: z.ZodType<RemoveSpriteInput> = descriptorSanitized(
  z.object({ spriteId: nonEmptyStringSchema }).strict(),
);

function featureProjectionSchema(limits: FeatureQueryLimits) {
  return {
    propertyAllowlist: z.array(nonBlankStringSchema).refine(
      (values) => new Set(values).size === values.length,
      'propertyAllowlist must not contain duplicate values.',
    ).optional(),
    limit: positiveSafeIntegerSchema.max(limits.maxFeatures).optional(),
    maxSerializedBytes: positiveSafeIntegerSchema.max(limits.maxSerializedBytes).optional(),
  };
}

function createSourceFeatureQueryInputSchema(
  limits: FeatureQueryLimits,
): z.ZodType<SourceFeatureQueryInput> {
  return descriptorSanitized(z.object({
    sourceId: nonEmptyStringSchema,
    sourceLayer: nonEmptyStringSchema.optional(),
    filter: expressionFilterSchema.optional(),
    ...featureProjectionSchema(limits),
  }).strict());
}

function createRenderedFeatureQueryInputSchema(
  limits: FeatureQueryLimits,
): z.ZodType<RenderedFeatureQueryInput> {
  const geometrySchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('viewport') }).strict(),
    z.object({ kind: z.literal('point'), point: screenPointSchema }).strict(),
    z.object({
      kind: z.literal('bounds'),
      bounds: z.tuple([screenPointSchema, screenPointSchema]),
    }).strict(),
  ]);
  return descriptorSanitized(z.object({
    geometry: geometrySchema.default({ kind: 'viewport' }),
    layerIds: z.array(nonBlankStringSchema).refine(
      (values) => new Set(values).size === values.length,
      'layerIds must not contain duplicate values.',
    ).optional(),
    filter: expressionFilterSchema.optional(),
    ...featureProjectionSchema(limits),
  }).strict());
}

export const featureQueryLimitsSchema: z.ZodType<FeatureQueryLimits> = descriptorSanitized(
  z.object({
    maxFeatures: positiveSafeIntegerSchema,
    maxSerializedBytes: positiveSafeIntegerSchema,
  }).strict(),
);

export const sourceFeatureQueryInputSchema = createSourceFeatureQueryInputSchema(
  DEFAULT_FEATURE_QUERY_LIMITS,
);
export const renderedFeatureQueryInputSchema = createRenderedFeatureQueryInputSchema(
  DEFAULT_FEATURE_QUERY_LIMITS,
);

export function parseBoundedSourceFeatureQueryInput(
  input: unknown,
  parsedLimits: FeatureQueryLimits,
){
  return createSourceFeatureQueryInputSchema(parsedLimits).safeParse(input);
}

export function parseBoundedRenderedFeatureQueryInput(
  input: unknown,
  parsedLimits: FeatureQueryLimits,
){
  return createRenderedFeatureQueryInputSchema(parsedLimits).safeParse(input);
}
