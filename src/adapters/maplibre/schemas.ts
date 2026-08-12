import { z } from 'zod';
import { jsonValueSchema } from '../../core/index.js';
import type {
  FeatureQueryLimits,
  RenderedFeatureQueryInput,
  SourceFeatureQueryInput,
} from './types.js';

const positiveSafeIntegerSchema = z.number().int().safe().positive();
const nonEmptyStringSchema = z.string().min(1);
const nonBlankStringSchema = z.string().trim().min(1);
const screenPointSchema = z.tuple([z.number().finite(), z.number().finite()]);

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
    filter: z.array(jsonValueSchema).optional(),
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
    filter: z.array(jsonValueSchema).optional(),
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
