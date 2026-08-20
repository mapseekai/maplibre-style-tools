import { z } from 'zod';

import {
  createStyleTransactionSchema,
  jsonValueSchema,
  STYLE_TOOL_ERROR_CODES,
  styleDocumentSchema,
} from '../core/index.js';
import { runtimeGeoJsonSourceDiffSchema } from '../adapters/maplibre/index.js';
import type { JsonObject } from '../core/index.js';

export const BRIDGE_PROTOCOL_VERSION = 2 as const;
export const MAX_BRIDGE_MESSAGE_BYTES = 5 * 1024 * 1024;
export const REGISTRATION_REPLAY_CLIENT_BUDGET_MS = 30_000;
export const REGISTRATION_ATTEMPT_RETENTION_MS = 60_000;

const positiveSafeIntegerSchema = z.number().int().safe().positive();
const nonNegativeSafeIntegerSchema = z.number().int().safe().nonnegative();
const finiteNumberSchema = z.number().finite();
const boundedIdentifierSchema = z.string().min(1).max(128);
const styleHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const jsonObjectSchema = jsonValueSchema.refine(
  (value): value is JsonObject => typeof value === 'object'
    && value !== null
    && !Array.isArray(value),
  'Expected a JSON object',
) as z.ZodType<JsonObject>;

export const BridgeLimitSetSchema = z.strictObject({
  maxMessageBytes: positiveSafeIntegerSchema,
  maxStyleBytes: positiveSafeIntegerSchema,
  maxDiffBytes: positiveSafeIntegerSchema,
  maxOperations: positiveSafeIntegerSchema,
});

export type BridgeLimitSet = z.infer<typeof BridgeLimitSetSchema>;

export const BridgeCapabilitySchema = z.enum([
  'style.read',
  'style.write',
  'features.query',
  'runtime.state',
  'assets.write',
  'network.load',
]);

export type BridgeCapability = z.infer<typeof BridgeCapabilitySchema>;

export const BridgeMapIdSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/u)
  .refine((value) => value !== '.' && value !== '..', {
    message: 'mapId must not be a URL dot segment',
  });

export const RegistrationAttemptIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

export const BridgeTokenSchema = z.string().refine((value) => {
  const bytes = new TextEncoder().encode(value).byteLength;
  return bytes >= 32 && bytes <= 256;
}, 'token must contain 32..256 UTF-8 bytes');

export const MapSnapshotMetadataSchema = z.strictObject({
  revision: nonNegativeSafeIntegerSchema,
  styleHash: styleHashSchema,
});

export const MapSnapshotSchema = MapSnapshotMetadataSchema.extend({
  style: styleDocumentSchema.optional(),
}).strict();

export type MapSnapshotMetadata = z.infer<typeof MapSnapshotMetadataSchema>;
export type MapSnapshot = z.infer<typeof MapSnapshotSchema>;

export const BridgeAuthFrameSchema = z.strictObject({
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  kind: z.literal('auth'),
  correlationId: boundedIdentifierSchema,
  token: BridgeTokenSchema,
});

export type BridgeAuthFrame = z.infer<typeof BridgeAuthFrameSchema>;

export const BridgeRegisterFrameSchema = z.strictObject({
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  kind: z.literal('register'),
  correlationId: boundedIdentifierSchema,
  registrationAttemptId: RegistrationAttemptIdSchema,
  mapId: BridgeMapIdSchema,
  replaceLeaseId: z.string().min(32).max(256).optional(),
  capabilities: z.array(BridgeCapabilitySchema).max(6).refine(
    (capabilities) => new Set(capabilities).size === capabilities.length,
    'capabilities must be unique',
  ),
  limits: BridgeLimitSetSchema,
  snapshot: MapSnapshotSchema,
});

export type BridgeRegisterFrame = z.infer<typeof BridgeRegisterFrameSchema>;

const structuralTransactionSchema = createStyleTransactionSchema(Number.MAX_SAFE_INTEGER);
const featureTargetSchema = z.strictObject({
  source: z.string().min(1).max(256),
  sourceLayer: z.string().min(1).max(256).optional(),
  id: z.union([z.string().max(1024), finiteNumberSchema]),
});
const propertiesSchema = z.array(z.string().min(1).max(256)).max(100).refine(
  (properties) => new Set(properties).size === properties.length,
  'properties must be unique',
);
const filterSchema = z.array(jsonValueSchema);
const screenPointSchema = z.tuple([finiteNumberSchema, finiteNumberSchema]);
const renderedGeometrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('viewport') }),
  z.strictObject({ kind: z.literal('point'), point: screenPointSchema }),
  z.strictObject({
    kind: z.literal('bounds'),
    bounds: z.tuple([screenPointSchema, screenPointSchema]),
  }),
]);
const imageOptionsSchema = z.strictObject({
  pixelRatio: finiteNumberSchema.positive().optional(),
  sdf: z.boolean().optional(),
  content: z.tuple([
    finiteNumberSchema,
    finiteNumberSchema,
    finiteNumberSchema,
    finiteNumberSchema,
  ]).optional(),
  stretchX: z.array(z.tuple([finiteNumberSchema, finiteNumberSchema])).optional(),
  stretchY: z.array(z.tuple([finiteNumberSchema, finiteNumberSchema])).optional(),
});
const bridgeImageSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('rgba'),
    width: positiveSafeIntegerSchema.max(2048),
    height: positiveSafeIntegerSchema.max(2048),
    data: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
  }),
  z.strictObject({
    kind: z.literal('url'),
    url: z.string().min(1).max(MAX_BRIDGE_MESSAGE_BYTES),
  }),
]);

export const BridgeCommandVariantSchemas = Object.freeze({
  getStyle: z.strictObject({
    type: z.literal('getStyle'),
  }),
  applyTransaction: z.strictObject({
    type: z.literal('applyTransaction'),
    expectedRevision: nonNegativeSafeIntegerSchema,
    expectedStyleHash: styleHashSchema,
    transaction: structuralTransactionSchema,
  }),
  applyStyleDocument: z.strictObject({
    type: z.literal('applyStyleDocument'),
    expectedRevision: nonNegativeSafeIntegerSchema,
    expectedStyleHash: styleHashSchema,
    source: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('style'), style: styleDocumentSchema }),
      z.strictObject({ kind: z.literal('url'), url: z.string().min(1).max(MAX_BRIDGE_MESSAGE_BYTES) }),
    ]),
    diff: z.boolean(),
  }),
  updateGeoJsonData: z.strictObject({
    type: z.literal('updateGeoJsonData'),
    sourceId: z.string().min(1).max(256),
    diff: runtimeGeoJsonSourceDiffSchema,
  }),
  setSourceTileLodParams: z.strictObject({
    type: z.literal('setSourceTileLodParams'),
    maxZoomLevelsOnScreen: finiteNumberSchema.positive(),
    tileCountMaxMinRatio: finiteNumberSchema.positive(),
    sourceId: z.string().min(1).max(256).optional(),
  }),
  querySourceFeatures: z.strictObject({
    type: z.literal('querySourceFeatures'),
    sourceId: z.string().min(1).max(256),
    sourceLayer: z.string().min(1).max(256).optional(),
    filter: filterSchema.optional(),
    properties: propertiesSchema.optional(),
    limit: positiveSafeIntegerSchema.max(100).optional(),
  }),
  queryRenderedFeatures: z.strictObject({
    type: z.literal('queryRenderedFeatures'),
    geometry: renderedGeometrySchema.optional(),
    layerIds: z.array(z.string().min(1).max(256)).max(100).optional(),
    filter: filterSchema.optional(),
    properties: propertiesSchema.optional(),
    limit: positiveSafeIntegerSchema.max(100).optional(),
  }),
  setFeatureState: z.strictObject({
    type: z.literal('setFeatureState'),
    target: featureTargetSchema,
    state: jsonObjectSchema,
  }),
  removeFeatureState: z.strictObject({
    type: z.literal('removeFeatureState'),
    target: featureTargetSchema,
    key: z.string().min(1).max(256).optional(),
  }),
  setGlobalState: z.strictObject({
    type: z.literal('setGlobalState'),
    propertyName: z.string().min(1).max(256),
    value: jsonValueSchema,
  }),
  listImages: z.strictObject({
    type: z.literal('listImages'),
  }),
  listSprites: z.strictObject({
    type: z.literal('listSprites'),
  }),
  addImage: z.strictObject({
    type: z.literal('addImage'),
    imageId: z.string().min(1).max(256),
    image: bridgeImageSchema,
    options: imageOptionsSchema.optional(),
    overwrite: z.boolean().optional(),
  }),
  removeImage: z.strictObject({
    type: z.literal('removeImage'),
    imageId: z.string().min(1).max(256),
  }),
  addSprite: z.strictObject({
    type: z.literal('addSprite'),
    spriteId: z.string().min(1).max(256),
    url: z.string().min(1).max(MAX_BRIDGE_MESSAGE_BYTES),
    overwrite: z.boolean().optional(),
  }),
  removeSprite: z.strictObject({
    type: z.literal('removeSprite'),
    spriteId: z.string().min(1).max(256),
  }),
});

export const BridgeCommandSchema = z.discriminatedUnion('type', [
  BridgeCommandVariantSchemas.getStyle,
  BridgeCommandVariantSchemas.applyTransaction,
  BridgeCommandVariantSchemas.applyStyleDocument,
  BridgeCommandVariantSchemas.updateGeoJsonData,
  BridgeCommandVariantSchemas.setSourceTileLodParams,
  BridgeCommandVariantSchemas.querySourceFeatures,
  BridgeCommandVariantSchemas.queryRenderedFeatures,
  BridgeCommandVariantSchemas.setFeatureState,
  BridgeCommandVariantSchemas.removeFeatureState,
  BridgeCommandVariantSchemas.setGlobalState,
  BridgeCommandVariantSchemas.listImages,
  BridgeCommandVariantSchemas.listSprites,
  BridgeCommandVariantSchemas.addImage,
  BridgeCommandVariantSchemas.removeImage,
  BridgeCommandVariantSchemas.addSprite,
  BridgeCommandVariantSchemas.removeSprite,
]);

export type BridgeCommand = z.infer<typeof BridgeCommandSchema>;

export const BridgeCommandFrameSchema = z.strictObject({
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  kind: z.literal('command'),
  correlationId: boundedIdentifierSchema,
  mapId: BridgeMapIdSchema,
  deadlineAt: nonNegativeSafeIntegerSchema,
  command: BridgeCommandSchema,
});

export type BridgeCommandFrame = z.infer<typeof BridgeCommandFrameSchema>;

const styleDiffTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('style') }),
  z.strictObject({ kind: z.literal('layer'), id: z.string().min(1).max(256) }),
  z.strictObject({ kind: z.literal('source'), id: z.string().min(1).max(256) }),
]);
export const BridgeStyleDiffEntrySchema = z.strictObject({
  op: z.enum(['add', 'remove', 'replace', 'move']),
  path: z.string().max(2048),
  from: z.string().max(2048).optional(),
  before: jsonValueSchema.optional(),
  after: jsonValueSchema.optional(),
  target: styleDiffTargetSchema,
});
const warningSchema = z.strictObject({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(1024),
  path: z.string().max(2048).optional(),
});

export const AuthoritativeSnapshotDetailsSchema = z.strictObject({
  currentSnapshot: MapSnapshotSchema,
});

export const BridgeWireErrorSchema = z.strictObject({
  code: z.enum(STYLE_TOOL_ERROR_CODES),
  message: z.string().min(1).max(1024),
  path: z.string().max(2048).optional(),
  details: jsonObjectSchema.optional(),
});

export const BridgeAuthenticatedResultSchema = z.strictObject({
  type: z.literal('authenticated'),
  connectionId: boundedIdentifierSchema,
  limits: BridgeLimitSetSchema,
});
export const BridgeRegisteredResultSchema = z.strictObject({
  type: z.literal('registered'),
  leaseId: RegistrationAttemptIdSchema,
  limits: BridgeLimitSetSchema,
});
export const BridgeStyleResultSchema = z.strictObject({
  type: z.literal('style'),
  revision: nonNegativeSafeIntegerSchema,
  styleHash: styleHashSchema,
  style: styleDocumentSchema,
});

const semanticTransactionResult = <Schema extends z.ZodTypeAny>(schema: Schema): Schema =>
  schema.superRefine((value, context) => {
    const candidate = value as { applied?: unknown; noOp?: unknown };
    if (!((candidate.applied === true && candidate.noOp === false)
      || (candidate.applied === false && candidate.noOp === true))) {
      context.addIssue({
        code: 'custom',
        message: 'transaction must be exactly applied or no-op',
      });
    }
  }) as Schema;

const omittedSchema = z.strictObject({
  style: z.literal(true).optional(),
  diff: z.literal(true).optional(),
}).refine((omitted) => omitted.style === true || omitted.diff === true, {
  message: 'omitted must mark Style or diff',
});

export const BridgeFullTransactionResultSchema = semanticTransactionResult(z.strictObject({
  type: z.literal('transaction'),
  detail: z.literal('full'),
  revision: nonNegativeSafeIntegerSchema,
  styleHash: styleHashSchema,
  applied: z.boolean(),
  noOp: z.boolean(),
  changedLayerIds: z.array(z.string().min(1).max(256)),
  changedSourceIds: z.array(z.string().min(1).max(256)),
  warnings: z.array(warningSchema),
  style: styleDocumentSchema.optional(),
  diff: z.array(BridgeStyleDiffEntrySchema).optional(),
  omitted: omittedSchema.optional(),
}).superRefine((value, context) => {
  if (value.omitted?.style === true && value.style !== undefined) {
    context.addIssue({ code: 'custom', message: 'omitted Style cannot also be present' });
  }
  if (value.omitted?.diff === true && value.diff !== undefined) {
    context.addIssue({ code: 'custom', message: 'omitted diff cannot also be present' });
  }
}));

export const BridgeTransactionReceiptResultSchema = semanticTransactionResult(z.strictObject({
  type: z.literal('transaction'),
  detail: z.literal('receipt'),
  revision: nonNegativeSafeIntegerSchema,
  styleHash: styleHashSchema,
  applied: z.boolean(),
  noOp: z.boolean(),
}));

export const BridgeTransactionResultSchema = z.discriminatedUnion('detail', [
  BridgeFullTransactionResultSchema,
  BridgeTransactionReceiptResultSchema,
]);

export const BridgeFeaturesResultSchema = z.strictObject({
  type: z.literal('features'),
  features: z.array(jsonObjectSchema).max(100),
  returned: nonNegativeSafeIntegerSchema.max(100),
  truncated: z.boolean(),
  serializedBytes: nonNegativeSafeIntegerSchema.max(1024 * 1024),
  warnings: z.array(warningSchema),
}).refine((value) => value.returned === value.features.length, {
  message: 'returned must equal features length',
  path: ['returned'],
});
export const BridgeStateResultSchema = z.strictObject({
  type: z.literal('state'),
  accepted: z.literal(true),
});
export const BridgeImagesResultSchema = z.strictObject({
  type: z.literal('images'),
  imageIds: z.array(z.string().min(1).max(256)).max(500),
  returned: nonNegativeSafeIntegerSchema.max(500),
  truncated: z.boolean(),
  serializedBytes: nonNegativeSafeIntegerSchema.max(64 * 1024),
}).refine((value) => value.returned === value.imageIds.length, {
  message: 'returned must equal imageIds length',
  path: ['returned'],
});
export const BridgeSpritesResultSchema = z.strictObject({
  type: z.literal('sprites'),
  items: z.array(jsonObjectSchema).max(500),
  returned: nonNegativeSafeIntegerSchema.max(500),
  truncated: z.boolean(),
  serializedBytes: nonNegativeSafeIntegerSchema.max(64 * 1024),
}).refine((value) => value.returned === value.items.length, {
  message: 'returned must equal items length',
  path: ['returned'],
});
export const BridgeAckResultSchema = z.strictObject({
  type: z.literal('ack'),
  accepted: z.literal(true),
});

export const BridgeSuccessResultSchema = z.union([
  BridgeAuthenticatedResultSchema,
  BridgeRegisteredResultSchema,
  BridgeStyleResultSchema,
  BridgeTransactionResultSchema,
  BridgeFeaturesResultSchema,
  BridgeStateResultSchema,
  BridgeImagesResultSchema,
  BridgeSpritesResultSchema,
  BridgeAckResultSchema,
]);

export const BridgeResultFrameSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
    kind: z.literal('result'),
    correlationId: boundedIdentifierSchema,
    ok: z.literal(true),
    result: BridgeSuccessResultSchema,
  }),
  z.strictObject({
    protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
    kind: z.literal('result'),
    correlationId: boundedIdentifierSchema,
    ok: z.literal(false),
    error: BridgeWireErrorSchema,
  }),
]);

export type BridgeAuthenticatedResult = z.infer<typeof BridgeAuthenticatedResultSchema>;
export type BridgeRegisteredResult = z.infer<typeof BridgeRegisteredResultSchema>;
export type BridgeStyleResult = z.infer<typeof BridgeStyleResultSchema>;
export type BridgeFullTransactionResult = z.infer<typeof BridgeFullTransactionResultSchema>;
export type BridgeTransactionReceiptResult = z.infer<
  typeof BridgeTransactionReceiptResultSchema
>;
export type BridgeTransactionResult = z.infer<typeof BridgeTransactionResultSchema>;
export type BridgeFeaturesResult = z.infer<typeof BridgeFeaturesResultSchema>;
export type BridgeStateResult = z.infer<typeof BridgeStateResultSchema>;
export type BridgeImagesResult = z.infer<typeof BridgeImagesResultSchema>;
export type BridgeSpritesResult = z.infer<typeof BridgeSpritesResultSchema>;
export type BridgeAckResult = z.infer<typeof BridgeAckResultSchema>;
export type BridgeSuccessResult = z.infer<typeof BridgeSuccessResultSchema>;
export type BridgeResultFrame = z.infer<typeof BridgeResultFrameSchema>;

export const BridgeEventFrameSchema = z.discriminatedUnion('event', [
  z.strictObject({
    protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
    kind: z.literal('event'),
    event: z.literal('mapSnapshot'),
    mapId: BridgeMapIdSchema,
    snapshot: MapSnapshotSchema,
  }),
  z.strictObject({
    protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
    kind: z.literal('event'),
    event: z.literal('externalStyleChange'),
    mapId: BridgeMapIdSchema,
    snapshot: MapSnapshotSchema,
  }),
  z.strictObject({
    protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
    kind: z.literal('event'),
    event: z.literal('mapStatus'),
    mapId: BridgeMapIdSchema,
    syncState: z.literal('unknown'),
  }),
]);

export type BridgeEventFrame = z.infer<typeof BridgeEventFrameSchema>;

export const BridgeFrameSchema = z.union([
  BridgeAuthFrameSchema,
  BridgeRegisterFrameSchema,
  BridgeCommandFrameSchema,
  BridgeResultFrameSchema,
  BridgeEventFrameSchema,
]);

export type BridgeFrame = z.infer<typeof BridgeFrameSchema>;

export const BRIDGE_COMMAND_RESULT_TYPES = Object.freeze({
  getStyle: 'style',
  applyTransaction: 'transaction',
  applyStyleDocument: 'transaction',
  updateGeoJsonData: 'ack',
  setSourceTileLodParams: 'ack',
  querySourceFeatures: 'features',
  queryRenderedFeatures: 'features',
  setFeatureState: 'state',
  removeFeatureState: 'state',
  setGlobalState: 'state',
  listImages: 'images',
  listSprites: 'sprites',
  addImage: 'ack',
  removeImage: 'ack',
  addSprite: 'ack',
  removeSprite: 'ack',
} as const satisfies Record<BridgeCommand['type'], BridgeSuccessResult['type']>);

export interface BridgeCommandResultMap {
  getStyle: BridgeStyleResult;
  applyTransaction: BridgeTransactionResult;
  applyStyleDocument: BridgeTransactionResult;
  updateGeoJsonData: BridgeAckResult;
  setSourceTileLodParams: BridgeAckResult;
  querySourceFeatures: BridgeFeaturesResult;
  queryRenderedFeatures: BridgeFeaturesResult;
  setFeatureState: BridgeStateResult;
  removeFeatureState: BridgeStateResult;
  setGlobalState: BridgeStateResult;
  listImages: BridgeImagesResult;
  listSprites: BridgeSpritesResult;
  addImage: BridgeAckResult;
  removeImage: BridgeAckResult;
  addSprite: BridgeAckResult;
  removeSprite: BridgeAckResult;
}

export type BridgeResultFor<C extends BridgeCommand> = BridgeCommandResultMap[C['type']];
