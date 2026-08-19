import { z } from 'zod';
import {
  geoJsonAnalysisInputSchema,
  geoJsonAnalysisOptionsSchema,
  jsonValueSchema,
  styleDocumentSchema,
  styleTransactionSchema,
} from '../core/index.js';
import { runtimeGeoJsonSourceDiffSchema } from '../adapters/maplibre/index.js';
import type {
  ApplyStyleDocumentInput,
  ApplyStyleTransactionInput,
  InspectStyleInput,
  QueryMapFeaturesInput,
  RunMapCommandInput,
} from './contracts.js';

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
function descriptorSafeInputSchema<Schema extends z.ZodType>(
  schema: Schema,
): z.ZodType<z.output<Schema>> {
  return jsonValueSchema.pipe(schema as never) as z.ZodType<z.output<Schema>>;
}



const nonBlankString = z.string().trim().min(1);
const limit100Schema = z.number().int().safe().positive().max(100);
const byteLimitSchema = z.number().int().safe().positive().max(1_048_576);
const absoluteUrlSchema = z.string().url();
const imageOptionsSchema = z.object({
  pixelRatio: z.number().finite().positive().optional(),
  sdf: z.boolean().optional(),
  content: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  stretchX: z.array(z.tuple([z.number(), z.number()])).optional(),
  stretchY: z.array(z.tuple([z.number(), z.number()])).optional(),
}).strict();
const uniqueNonBlankStringArray = z.array(nonBlankString).refine(
  (values) => new Set(values).size === values.length,
  'Values must not contain duplicates.',
);
const nonBlankStringArray = z.array(nonBlankString);
const inspectionFieldSchema = z.enum(['paint', 'layout', 'filter', 'zoom']);
const nonEmptyTransactionSchema = styleTransactionSchema;

const emptyTransactionSchema = z.object({
  operations: z.tuple([]),
  validate: z.boolean().optional(),
}).strict();
const transactionToolEnvelopeSchema = z.object({
  operations: z.array(jsonValueSchema),
  validate: z.boolean().optional(),
}).strict();

export const inspectStyleInputSchema: z.ZodType<InspectStyleInput> =
  descriptorSafeInputSchema(z.discriminatedUnion('action', [
    z.object({ action: z.literal('listLayers'), query: z.string().optional(), type: z.string().optional(), source: nonBlankString.optional(), sourceLayer: nonBlankString.optional(), limit: limit100Schema.optional() }).strict(),
    z.object({ action: z.literal('listSources'), limit: limit100Schema.optional() }).strict(),
    z.object({ action: z.literal('getLayer'), layerId: nonBlankString, fields: z.array(inspectionFieldSchema).optional() }).strict(),
    z.object({ action: z.literal('getSource'), sourceId: nonBlankString }).strict(),
    z.object({ action: z.literal('getRoot') }).strict(),
    z.object({ action: z.literal('getContext'), layerLimit: limit100Schema.optional() }).strict(),
    z.object({ action: z.literal('inspectLayers'), layerIds: nonBlankStringArray.optional(), fields: z.array(inspectionFieldSchema).optional(), limit: limit100Schema.optional() }).strict(),
    z.object({ action: z.literal('getLayerCount') }).strict(),
    z.object({ action: z.literal('validateDocument'), style: styleDocumentSchema }).strict(),
    z.object({ action: z.literal('validateCurrentMap') }).strict(),
    z.object({ action: z.literal('validateTransaction'), transaction: nonEmptyTransactionSchema }).strict(),
    z.object({ action: z.literal('analyzeGeoJson'), data: geoJsonAnalysisInputSchema, options: geoJsonAnalysisOptionsSchema.optional() }).strict(),
    z.object({ action: z.literal('listSourceLayers'), sourceId: nonBlankString.optional() }).strict(),
  ])) as z.ZodType<InspectStyleInput>;

export const applyStyleTransactionToolInputSchema: z.ZodType<ApplyStyleTransactionInput> =
  descriptorSafeInputSchema(z.object({
    transaction: transactionToolEnvelopeSchema,
    dryRun: z.boolean().optional(),
    diff: z.boolean().optional(),
  }).strict()) as z.ZodType<ApplyStyleTransactionInput>;

export const applyStyleTransactionInputSchema: z.ZodType<ApplyStyleTransactionInput> =
  descriptorSafeInputSchema(z.object({
    transaction: z.union([emptyTransactionSchema, nonEmptyTransactionSchema]),
    dryRun: z.boolean().optional(),
    diff: z.boolean().optional(),
  }).strict()) as z.ZodType<ApplyStyleTransactionInput>;

export const applyStyleDocumentInputSchema: z.ZodType<ApplyStyleDocumentInput> =
  descriptorSafeInputSchema(z.object({
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('style'), style: styleDocumentSchema }).strict(),
      z.object({ kind: z.literal('url'), url: absoluteUrlSchema }).strict(),
    ]),
    diff: z.boolean().optional(),
  }).strict()) as z.ZodType<ApplyStyleDocumentInput>;

const featureStateTargetSchema = z.object({
  source: nonBlankString,
  sourceLayer: nonBlankString.optional(),
  id: z.union([nonBlankString, z.number().finite()]),
}).strict();

export const runMapCommandInputSchema: z.ZodType<RunMapCommandInput> =
  descriptorSafeInputSchema(z.discriminatedUnion('action', [
    z.object({ action: z.literal('updateGeoJsonData'), sourceId: nonBlankString, diff: runtimeGeoJsonSourceDiffSchema }).strict(),
    z.object({ action: z.literal('setSourceTileLodParams'), maxZoomLevelsOnScreen: z.number().finite().positive(), tileCountMaxMinRatio: z.number().finite().positive(), sourceId: nonBlankString.optional() }).strict(),
    z.object({ action: z.literal('setFeatureState'), target: featureStateTargetSchema, state: jsonObjectSchema }).strict(),
    z.object({ action: z.literal('removeFeatureState'), target: featureStateTargetSchema, key: nonBlankString.optional() }).strict(),
    z.object({ action: z.literal('setGlobalState'), propertyName: nonBlankString, value: jsonValueSchema }).strict(),
    z.object({ action: z.literal('listImages'), limit: limit100Schema.optional() }).strict(),
    z.object({ action: z.literal('addImageFromUrl'), imageId: nonBlankString, url: nonBlankString, options: imageOptionsSchema.optional(), overwrite: z.boolean().optional() }).strict(),
    z.object({ action: z.literal('removeImage'), imageId: nonBlankString }).strict(),
    z.object({ action: z.literal('listSprites'), limit: limit100Schema.optional() }).strict(),
    z.object({ action: z.literal('addSprite'), spriteId: nonBlankString, url: nonBlankString, overwrite: z.boolean().optional() }).strict(),
    z.object({ action: z.literal('removeSprite'), spriteId: nonBlankString }).strict(),
  ])) as z.ZodType<RunMapCommandInput>;

const featureGeometrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('viewport') }).strict(),
  z.object({ kind: z.literal('point'), point: z.tuple([z.number(), z.number()]) }).strict(),
  z.object({
    kind: z.literal('bounds'),
    bounds: z.tuple([
      z.tuple([z.number(), z.number()]),
      z.tuple([z.number(), z.number()]),
    ]),
  }).strict(),
]);
const featureProjectionShape = {
  filter: z.array(jsonValueSchema).optional(),
  propertyAllowlist: uniqueNonBlankStringArray.optional(),
  limit: limit100Schema.optional(),
  maxSerializedBytes: byteLimitSchema.optional(),
};

export const queryMapFeaturesInputSchema: z.ZodType<QueryMapFeaturesInput> =
  descriptorSafeInputSchema(z.discriminatedUnion('target', [
    z.object({
      target: z.literal('source'),
      sourceId: nonBlankString,
      sourceLayer: nonBlankString.optional(),
      ...featureProjectionShape,
    }).strict(),
    z.object({
      target: z.literal('rendered'),
      geometry: featureGeometrySchema.optional(),
      layerIds: uniqueNonBlankStringArray.optional(),
      ...featureProjectionShape,
    }).strict(),
  ])) as z.ZodType<QueryMapFeaturesInput>;

