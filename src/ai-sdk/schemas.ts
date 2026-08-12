import { z } from 'zod';
import {
  DEFAULT_MAX_OPERATIONS,
  geoJsonAnalysisInputSchema,
  geoJsonAnalysisOptionsSchema,
  jsonValueSchema,
  styleTransactionSchema,
} from '../core/index.js';
import {
  MAX_AI_TEXT_BYTES,
  normalizeLegacyOperations,
  parseJsonOrRawString,
  parseStrictJson,
} from './compatibility.js';

function boundedTextSchema(
  label: string,
  parser: (raw: string, parserLabel: string) => { ok: boolean },
): z.ZodType<string> {
  return z.string().superRefine((value, context) => {
    if (value.length > MAX_AI_TEXT_BYTES || !parser(value, label).ok) {
      context.addIssue({ code: 'custom', message: `${label} is invalid.` });
    }
  });
}

export const strictJsonTextSchema = boundedTextSchema('JSON value', parseStrictJson);
export const jsonOrRawStringTextSchema = boundedTextSchema('Value', parseJsonOrRawString);

function legacyOperationsAreValid(raw: string): { ok: boolean } {
  const normalized = normalizeLegacyOperations(raw);
  if (normalized.ok) return normalized;
  const parsed = parseStrictJson(raw, 'operationsJson');
  if (!parsed.ok || !Array.isArray(parsed.value)
    || parsed.value.length > DEFAULT_MAX_OPERATIONS) return normalized;
  for (const operation of parsed.value) {
    if (!normalizeLegacyOperations(JSON.stringify([operation])).ok) return normalized;
  }
  return { ok: true };
}

export const legacyOperationsTextSchema = boundedTextSchema(
  'operationsJson', legacyOperationsAreValid,
);
export const filterTextSchema = boundedTextSchema('filterJson', parseStrictJson);
export const styleJsonOrUrlTextSchema = boundedTextSchema(
  'styleJsonOrUrl', parseJsonOrRawString,
);

const nonEmptyStringSchema = z.string().refine(
  (value) => value.trim().length > 0,
  { message: 'Expected a non-empty string' },
);
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
const filterSchema = z.array(jsonValueSchema);
const placementShape = {
  beforeId: nonEmptyStringSchema.optional(),
  afterId: nonEmptyStringSchema.optional(),
};
const executionShape = {
  dryRun: z.boolean().default(false),
  diff: z.boolean().default(true),
};

const validatePlacement = (
  input: { beforeId?: string; afterId?: string },
  context: z.RefinementCtx,
): void => {
  if (input.beforeId !== undefined && input.afterId !== undefined) {
    context.addIssue({
      code: 'custom',
      message: 'Placement cannot specify both beforeId and afterId',
      path: ['afterId'],
    });
  }
};

const validateZooms = (
  input: { minzoom?: number; maxzoom?: number },
  context: z.RefinementCtx,
): void => {
  if (input.minzoom !== undefined && input.maxzoom !== undefined
    && input.minzoom > input.maxzoom) {
    context.addIssue({
      code: 'custom',
      message: 'minzoom must be less than or equal to maxzoom',
      path: ['maxzoom'],
    });
  }
};

export const compactAnalyzeGeoJsonInputSchema = z.object({
  data: geoJsonAnalysisInputSchema,
  options: geoJsonAnalysisOptionsSchema.optional(),
}).strict();

export const compactListSourceLayersInputSchema = z.object({
  sourceId: nonEmptyStringSchema.optional(),
}).strict();

export const compactDuplicateLayerInputSchema = z.object({
  layerId: nonEmptyStringSchema,
  newLayerId: nonEmptyStringSchema,
  overrides: jsonObjectSchema.optional(),
  ...placementShape,
  ...executionShape,
}).strict().superRefine((input, context) => {
  validatePlacement(input, context);
  if (input.overrides !== undefined && Object.hasOwn(input.overrides, 'id')) {
    context.addIssue({
      code: 'custom', message: 'Layer overrides cannot include id',
      path: ['overrides', 'id'],
    });
  }
});

export const compactAddLayerFromSourceInputSchema = z.object({
  layerId: nonEmptyStringSchema,
  sourceId: nonEmptyStringSchema,
  sourceLayer: nonEmptyStringSchema.optional(),
  type: nonEmptyStringSchema,
  paint: jsonObjectSchema.optional(),
  layout: jsonObjectSchema.optional(),
  filter: filterSchema.optional(),
  minzoom: z.number().finite().min(0).max(24).optional(),
  maxzoom: z.number().finite().min(0).max(24).optional(),
  metadata: jsonObjectSchema.optional(),
  ...placementShape,
  ...executionShape,
}).strict().superRefine((input, context) => {
  validatePlacement(input, context);
  validateZooms(input, context);
});

export const compactAddGeoJsonLayerInputSchema = z.object({
  sourceId: nonEmptyStringSchema,
  layerId: nonEmptyStringSchema,
  data: geoJsonAnalysisInputSchema,
  sourceOptions: jsonObjectSchema.optional(),
  type: z.enum(['fill', 'line', 'symbol', 'circle', 'heatmap', 'fill-extrusion']),
  paint: jsonObjectSchema.optional(),
  layout: jsonObjectSchema.optional(),
  filter: filterSchema.optional(),
  minzoom: z.number().finite().min(0).max(24).optional(),
  maxzoom: z.number().finite().min(0).max(24).optional(),
  metadata: jsonObjectSchema.optional(),
  ...placementShape,
  ...executionShape,
}).strict().superRefine((input, context) => {
  validatePlacement(input, context);
  validateZooms(input, context);
  for (const key of ['type', 'data'] as const) {
    if (input.sourceOptions !== undefined && Object.hasOwn(input.sourceOptions, key)) {
      context.addIssue({
        code: 'custom',
        message: `sourceOptions cannot include the authority key ${key}`,
        path: ['sourceOptions', key],
      });
    }
  }
});

export const compactApplyStyleTransactionInputSchema = z.object({
  transaction: styleTransactionSchema,
  dryRun: z.boolean().default(false),
  diff: z.boolean().default(true),
}).strict();
