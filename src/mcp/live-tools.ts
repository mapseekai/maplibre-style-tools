import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  createStyleToolError,
  isStyleToolError,
  jsonValueSchema,
  styleDocumentSchema,
  type JsonObject,
  type StyleToolError,
} from '../core/index.js';
import { publicBridgeErrorMessage } from '../bridge/outbound.js';
import {
  BridgeCommandVariantSchemas,
  BridgeCapabilitySchema,
  BridgeMapIdSchema,
  MapSnapshotMetadataSchema,
  BridgeTransactionReceiptResultSchema,
  type BridgeCommand,
  type BridgeImagesResult,
  type BridgeSuccessResult,
  type BridgeTransactionResult,
} from '../bridge/protocol.js';
import type { LiveMapMetadata, LiveMapRegistry } from '../bridge/registry.js';
import type { McpResponseBoundary } from './message-boundary.js';
import type { McpServerExtensionContext } from './server-extension.js';
import type { McpTextToolResult } from './types.js';

const publicMetadataSchema = z.strictObject({
  mapId: BridgeMapIdSchema,
  capabilities: z.array(z.enum([
    'style.read', 'style.write', 'features.query', 'runtime.state',
    'images.write', 'network.load',
  ])),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  styleHash: z.string().regex(/^[0-9a-f]{64}$/u),
  syncState: z.enum(['known', 'unknown']),
  connectedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lastSeenAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export const liveMapListDataSchema = z.strictObject({
  maps: z.array(publicMetadataSchema),
});
export const liveMapStyleDataSchema = z.strictObject({
  type: z.literal('style'),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  styleHash: z.string().regex(/^[0-9a-f]{64}$/u),
  style: styleDocumentSchema,
});
export const liveTransactionDataSchema = BridgeTransactionReceiptResultSchema;
export const liveMutationReceiptDataSchema = z.strictObject({
  type: z.literal('mutationReceipt'),
  command: z.enum([
    'setFeatureState', 'removeFeatureState', 'setGlobalState', 'addImage', 'removeImage',
  ]),
  accepted: z.literal(true),
});
export const liveFeatureQueryDataSchema = z.strictObject({
  type: z.literal('features'),
  features: z.array(jsonValueSchema.refine(
    (value): value is JsonObject => typeof value === 'object'
      && value !== null && !Array.isArray(value),
  )).max(100),
  returned: z.number().int().nonnegative().max(100),
  truncated: z.boolean(),
  serializedBytes: z.number().int().nonnegative().max(1024 * 1024),
  warnings: z.array(z.strictObject({
    code: z.string(), message: z.string(), path: z.string().optional(),
  })),
});

export const mapListInputSchema = z.strictObject({});
export const mapGetStyleInputSchema = z.strictObject({
  mapId: BridgeMapIdSchema,
  ...BridgeCommandVariantSchemas.getStyle.omit({ type: true }).shape,
});
export const mapApplyTransactionInputSchema = z.strictObject({
  mapId: BridgeMapIdSchema,
  ...BridgeCommandVariantSchemas.applyTransaction.omit({ type: true }).shape,
});
export const mapQuerySourceFeaturesInputSchema = z.strictObject({
  mapId: BridgeMapIdSchema,
  ...BridgeCommandVariantSchemas.querySourceFeatures.omit({ type: true }).shape,
});
export const mapQueryRenderedFeaturesInputSchema = z.strictObject({
  mapId: BridgeMapIdSchema,
  ...BridgeCommandVariantSchemas.queryRenderedFeatures.omit({ type: true }).shape,
});
export const mapSetFeatureStateInputSchema = z.strictObject({
  mapId: BridgeMapIdSchema,
  ...BridgeCommandVariantSchemas.setFeatureState.omit({ type: true }).shape,
});
export const mapRemoveFeatureStateInputSchema = z.strictObject({
  mapId: BridgeMapIdSchema,
  ...BridgeCommandVariantSchemas.removeFeatureState.omit({ type: true }).shape,
});
export const mapSetGlobalStateInputSchema = z.strictObject({
  mapId: BridgeMapIdSchema,
  ...BridgeCommandVariantSchemas.setGlobalState.omit({ type: true }).shape,
});
export const mapListImagesInputSchema = z.strictObject({
  mapId: BridgeMapIdSchema,
  ...BridgeCommandVariantSchemas.listImages.omit({ type: true }).shape,
});
export const mapAddImageInputSchema = z.strictObject({
  mapId: BridgeMapIdSchema,
  ...BridgeCommandVariantSchemas.addImage.omit({ type: true }).shape,
});
export const mapRemoveImageInputSchema = z.strictObject({
  mapId: BridgeMapIdSchema,
  ...BridgeCommandVariantSchemas.removeImage.omit({ type: true }).shape,
});

export const LIVE_TOOL_NAMES = Object.freeze([
  'map_list', 'map_get_style', 'map_apply_transaction',
  'map_query_source_features', 'map_query_rendered_features',
  'map_set_feature_state', 'map_remove_feature_state', 'map_set_global_state',
  'map_list_images', 'map_add_image', 'map_remove_image',
] as const);
export type LiveToolName = (typeof LIVE_TOOL_NAMES)[number];

export const liveToolInputSchemas = Object.freeze({
  map_list: mapListInputSchema,
  map_get_style: mapGetStyleInputSchema,
  map_apply_transaction: mapApplyTransactionInputSchema,
  map_query_source_features: mapQuerySourceFeaturesInputSchema,
  map_query_rendered_features: mapQueryRenderedFeaturesInputSchema,
  map_set_feature_state: mapSetFeatureStateInputSchema,
  map_remove_feature_state: mapRemoveFeatureStateInputSchema,
  map_set_global_state: mapSetGlobalStateInputSchema,
  map_list_images: mapListImagesInputSchema,
  map_add_image: mapAddImageInputSchema,
  map_remove_image: mapRemoveImageInputSchema,
});

const annotation = (
  readOnlyHint: boolean,
  destructiveHint: boolean,
  idempotentHint: boolean,
  openWorldHint: boolean,
): ToolAnnotations => Object.freeze({
  readOnlyHint, destructiveHint, idempotentHint, openWorldHint,
});

const metadata = Object.freeze({
  map_list: ['List live maps', 'List connected live MapLibre maps.', annotation(true, false, true, false)],
  map_get_style: ['Get live map Style', 'Read the authoritative Style from a connected map.', annotation(true, false, true, false)],
  map_apply_transaction: ['Apply live transaction', 'Apply one revision-checked Style transaction.', annotation(false, true, false, true)],
  map_query_source_features: ['Query live source features', 'Query one live source with bounded output.', annotation(true, false, true, false)],
  map_query_rendered_features: ['Query live rendered features', 'Query rendered live features with bounded output.', annotation(true, false, true, false)],
  map_set_feature_state: ['Set feature state', 'Set runtime feature state on one live map.', annotation(false, true, false, false)],
  map_remove_feature_state: ['Remove feature state', 'Remove runtime feature state on one live map.', annotation(false, true, false, false)],
  map_set_global_state: ['Set global state', 'Set one runtime global-state property.', annotation(false, true, false, false)],
  map_list_images: ['List live images', 'List runtime image IDs on one live map.', annotation(true, false, true, false)],
  map_add_image: ['Add live image', 'Add or load one runtime image on a live map.', annotation(false, true, false, true)],
  map_remove_image: ['Remove live image', 'Remove one runtime image from a live map.', annotation(false, true, false, false)],
}) satisfies Readonly<Record<LiveToolName, readonly [string, string, ToolAnnotations]>>;

type JsonSchemaObject = Record<string, unknown>;
const sdkAdvertisedSchemas = new WeakSet<object>();

const requireSdkAdvertisableInputSchema = <Schema extends z.ZodType>(schema: Schema): Schema => {
  if (sdkAdvertisedSchemas.has(schema)) return schema;
  const advertised = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchemaObject;
  Reflect.deleteProperty(advertised, '$schema');
  Object.defineProperty(schema._zod, 'toJSONSchema', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: () => {
      const parent = schema._zod.parent;
      schema._zod.parent = undefined;
      queueMicrotask(() => {
        if (schema._zod.parent === undefined) schema._zod.parent = parent;
      });
      return structuredClone(advertised);
    },
  });
  sdkAdvertisedSchemas.add(schema);
  return schema;
};

const invalidZodInput = (error: z.ZodError): StyleToolError => createStyleToolError(
  'INVALID_INPUT', error.issues[0]?.message ?? 'Live map tool input is invalid.',
);
const internalFailure = (): StyleToolError => createStyleToolError(
  'INTERNAL', 'The live map tool failed internally.',
);

const guardLiveTool = <Schema extends z.ZodType, Result>(
  schema: Schema,
  boundary: McpResponseBoundary,
  run: (input: z.output<Schema>) => McpTextToolResult<Result> | Promise<McpTextToolResult<Result>>,
  mutation = false,
) => async (input: unknown): Promise<McpTextToolResult<Result>> => {
  let parsed: z.output<Schema>;
  try { parsed = schema.parse(input); } catch (error) {
    return boundary.requireToolFailure(error instanceof z.ZodError
      ? invalidZodInput(error) : internalFailure());
  }
  try { return await run(parsed); } catch (error) {
    const authentic = isStyleToolError(error) ? error : internalFailure();
    return boundary.requireToolFailure(mutation ? projectLiveMutationError(authentic) : authentic);
  }
};

const publicMetadata = (value: LiveMapMetadata) => ({
  mapId: value.mapId,
  capabilities: [...value.capabilities],
  revision: value.revision,
  styleHash: value.styleHash,
  syncState: value.syncState,
  connectedAt: value.connectedAt,
  lastSeenAt: value.lastSeenAt,
});

const ownObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const bridgeCommandTypeSchema = z.enum([
  'getStyle', 'applyTransaction', 'querySourceFeatures', 'queryRenderedFeatures',
  'setFeatureState', 'removeFeatureState', 'setGlobalState', 'listImages',
  'addImage', 'removeImage',
]);

export const projectLiveMutationError = (error: StyleToolError): StyleToolError => {
  if (!isStyleToolError(error)) return internalFailure();
  const details = ownObject(error.details);
  const projected: JsonObject = {};
  const snapshot = ownObject(details?.currentSnapshot);
  const parsedSnapshot = MapSnapshotMetadataSchema.safeParse({
    revision: snapshot?.revision,
    styleHash: snapshot?.styleHash,
  });
  if (parsedSnapshot.success) {
    projected.currentSnapshot = parsedSnapshot.data;
  }
  if (typeof details?.rolledBack === 'boolean') projected.rolledBack = details.rolledBack;
  const rollback = ownObject(details?.rollbackError);
  if (typeof rollback?.code === 'string') {
    const code = z.enum([
      'INVALID_INPUT', 'STYLE_INVALID', 'NOT_FOUND', 'CONFLICT', 'DEPENDENCY_CONFLICT',
      'UNSUPPORTED_SOURCE', 'REVISION_CONFLICT', 'MAP_NOT_READY', 'BRIDGE_DISCONNECTED',
      'CAPABILITY_DENIED', 'IO_ERROR', 'TIMEOUT', 'INTERNAL',
    ]).safeParse(rollback.code);
    if (code.success) {
      projected.rollbackError = {
        code: code.data,
        message: publicBridgeErrorMessage(code.data),
      };
    }
  }
  if (error.code === 'INVALID_INPUT' && details?.reason === 'relative-style-url') {
    projected.reason = 'relative-style-url';
  }
  if (error.code === 'CAPABILITY_DENIED'
    && bridgeCommandTypeSchema.safeParse(details?.commandType).success
    && BridgeCapabilitySchema.safeParse(details?.requiredCapability).success) {
    projected.commandType = details?.commandType as string;
    projected.requiredCapability = details?.requiredCapability as string;
  }
  if (error.code === 'MAP_NOT_READY'
    && (details?.syncState === 'known' || details?.syncState === 'unknown')) {
    projected.syncState = details.syncState;
  }
  return createStyleToolError(
    error.code,
    publicBridgeErrorMessage(error.code),
    undefined,
    Object.keys(projected).length === 0 ? undefined : projected,
  );
};

const commandWithoutMapId = <Schema extends z.ZodObject, Type extends BridgeCommand['type']>(
  input: z.output<Schema> & { mapId: string },
  type: Type,
): Extract<BridgeCommand, { type: Type }> => {
  const { mapId, ...rest } = input;
  void mapId;
  return { type, ...rest } as unknown as Extract<BridgeCommand, { type: Type }>;
};

const readResult = (result: BridgeSuccessResult): unknown => {
  if (result.type === 'style') return liveMapStyleDataSchema.parse(result);
  if (result.type === 'features') return liveFeatureQueryDataSchema.parse(result);
  if (result.type === 'images') return result;
  throw internalFailure();
};

const transactionReceipt = (result: BridgeTransactionResult) =>
  liveTransactionDataSchema.parse({
    type: 'transaction', detail: 'receipt', revision: result.revision,
    styleHash: result.styleHash, applied: result.applied, noOp: result.noOp,
  });

const mutationReceipt = (command: BridgeCommand['type']) =>
  liveMutationReceiptDataSchema.parse({ type: 'mutationReceipt', command, accepted: true });

const preflightMutation = (
  boundary: McpResponseBoundary,
  command: Extract<BridgeCommand['type'],
    | 'applyTransaction'
    | 'setFeatureState'
    | 'removeFeatureState'
    | 'setGlobalState'
    | 'addImage'
    | 'removeImage'>,
): void => {
  if (command === 'applyTransaction') {
    boundary.requireToolSuccess(liveTransactionDataSchema.parse({
      type: 'transaction',
      detail: 'receipt',
      revision: Number.MAX_SAFE_INTEGER,
      styleHash: 'f'.repeat(64),
      applied: true,
      noOp: false,
    }));
  } else {
    boundary.requireToolSuccess(mutationReceipt(command));
  }
  boundary.requireToolFailure(projectLiveMutationError(createStyleToolError(
    'INTERNAL',
    publicBridgeErrorMessage('INTERNAL'),
    undefined,
    {
      currentSnapshot: {
        revision: Number.MAX_SAFE_INTEGER,
        styleHash: 'f'.repeat(64),
      },
      rolledBack: false,
      rollbackError: {
        code: 'INTERNAL',
        message: publicBridgeErrorMessage('INTERNAL'),
      },
    },
  )));
};

export function registerLiveMapTools(
  server: McpServer,
  registry: LiveMapRegistry,
  context: McpServerExtensionContext,
): void {
  const boundary = context.responseBoundary;
  const handlers: Record<LiveToolName, (input: unknown) => Promise<McpTextToolResult<unknown>>> = {
    map_list: guardLiveTool(mapListInputSchema, boundary, () =>
      registry.projectList((maps) => boundary.requireToolSuccess({
        maps: maps.map(publicMetadata),
      }))),
    map_get_style: guardLiveTool(mapGetStyleInputSchema, boundary, ({ mapId, ...rest }) =>
      registry.execute(mapId, { type: 'getStyle', ...rest }, undefined,
        (result) => boundary.requireToolSuccess(readResult(result)))),
    map_apply_transaction: guardLiveTool(
      mapApplyTransactionInputSchema, boundary,
      ({ mapId, ...rest }) => {
        preflightMutation(boundary, 'applyTransaction');
        return registry.execute(mapId, { type: 'applyTransaction', ...rest },
          undefined, (result) => boundary.requireToolSuccess(transactionReceipt(result)));
      },
      true,
    ),
    map_query_source_features: guardLiveTool(
      mapQuerySourceFeaturesInputSchema, boundary,
      (input) => registry.execute(input.mapId,
        commandWithoutMapId(input, 'querySourceFeatures'), undefined,
        (result) => boundary.requireToolSuccess(readResult(result))),
    ),
    map_query_rendered_features: guardLiveTool(
      mapQueryRenderedFeaturesInputSchema, boundary,
      (input) => registry.execute(input.mapId,
        commandWithoutMapId(input, 'queryRenderedFeatures'), undefined,
        (result) => boundary.requireToolSuccess(readResult(result))),
    ),
    map_set_feature_state: guardLiveTool(
      mapSetFeatureStateInputSchema, boundary,
      (input) => {
        preflightMutation(boundary, 'setFeatureState');
        return registry.execute(input.mapId,
          commandWithoutMapId(input, 'setFeatureState'), undefined,
          () => boundary.requireToolSuccess(mutationReceipt('setFeatureState')));
      }, true,
    ),
    map_remove_feature_state: guardLiveTool(
      mapRemoveFeatureStateInputSchema, boundary,
      (input) => {
        preflightMutation(boundary, 'removeFeatureState');
        return registry.execute(input.mapId,
          commandWithoutMapId(input, 'removeFeatureState'), undefined,
          () => boundary.requireToolSuccess(mutationReceipt('removeFeatureState')));
      }, true,
    ),
    map_set_global_state: guardLiveTool(
      mapSetGlobalStateInputSchema, boundary,
      (input) => {
        preflightMutation(boundary, 'setGlobalState');
        return registry.execute(input.mapId,
          commandWithoutMapId(input, 'setGlobalState'), undefined,
          () => boundary.requireToolSuccess(mutationReceipt('setGlobalState')));
      }, true,
    ),
    map_list_images: guardLiveTool(
      mapListImagesInputSchema, boundary,
      (input) => registry.execute(input.mapId, commandWithoutMapId(input, 'listImages'), undefined,
        (result: BridgeImagesResult) => boundary.requireToolSuccess(result))),
    map_add_image: guardLiveTool(
      mapAddImageInputSchema, boundary,
      (input) => {
        preflightMutation(boundary, 'addImage');
        return registry.execute(input.mapId, commandWithoutMapId(input, 'addImage'), undefined,
          () => boundary.requireToolSuccess(mutationReceipt('addImage')));
      }, true,
    ),
    map_remove_image: guardLiveTool(
      mapRemoveImageInputSchema, boundary,
      (input) => {
        preflightMutation(boundary, 'removeImage');
        return registry.execute(input.mapId, commandWithoutMapId(input, 'removeImage'), undefined,
          () => boundary.requireToolSuccess(mutationReceipt('removeImage')));
      }, true,
    ),
  };
  for (const name of LIVE_TOOL_NAMES) {
    const [title, description, annotations] = metadata[name];
    server.registerTool(name, {
      title,
      description,
      inputSchema: requireSdkAdvertisableInputSchema(liveToolInputSchemas[name]),
      annotations,
    }, handlers[name]);
  }
}
