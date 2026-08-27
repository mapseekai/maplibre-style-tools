import { hashStyle } from '../adapters/maplibre/index.js';
import { DEFAULT_RUNTIME_LIST_LIMIT, runtimeListInputSchema } from '../adapters/maplibre/schemas.js';
import type {
  AddImageDataInput,
  AddImageFromUrlInput,
  AddSpriteInput,
  BoundedFeatureQueryResult,
  FeatureStateInput,
  GlobalStateInput,
  MapRuntimeCommands,
  MapStyleCurrentResult,
  MapStyleApplyResult,
  RemoveFeatureStateInput,
  RemoveImageInput,
  RemoveSpriteInput,
  RenderedFeatureQueryInput,
  RuntimeCommandExecution,
  RuntimeCommandResult,
  RuntimeGeoJsonDiffUpdate,
  RuntimeListData,
  RuntimeListInput,
  SourceFeatureQueryInput,
  SourceTileLodParamsInput,
} from '../adapters/maplibre/types.js';
import type { BrowserMapRuntime, BrowserMapState } from '../bridge/browser-runtime.js';
import type { BridgeCommand, BridgeFullTransactionResult } from '../bridge/protocol.js';
import {
  createStyleToolError,
  isStyleToolError,
  applyStyleTransaction,
  jsonValueSchema,
  STYLE_TOOL_ERROR_CODES,
  type JsonObject,
  type StyleDocument,
  type StyleToolError,
  type StyleToolErrorCode,
  type StyleTransaction,
} from '../core/index.js';
import type { AuthorityStyleRead, RuntimeAuthority, StyleAuthority } from '../capabilities/authority.js';
import type { MapToolContext } from '../capabilities/contracts.js';

type WebMcpStyleMutationCommand = Extract<
  BridgeCommand,
  { type: 'applyTransaction' | 'applyStyleDocument' }
>;

const asToolError = (error: unknown): StyleToolError => isStyleToolError(error)
  ? error
  : createStyleToolError('INTERNAL', 'WebMCP map command failed.');

const unavailable = (error: StyleToolError): MapStyleApplyResult => ({
  ok: false,
  styleAuthority: 'unavailable',
  applied: false,
  changedLayers: [],
  changedSources: [],
  diff: [],
  warnings: [],
  error,
});

const abortedMutation = (): MapStyleApplyResult => unavailable(createStyleToolError(
  'TIMEOUT', 'WebMCP map operation was aborted.', undefined, { reason: 'aborted' },
));

const ownRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const styleSnapshotFromError = (
  error: StyleToolError,
): StyleDocument | undefined => {
  const snapshot = ownRecord(error.details?.currentSnapshot);
  const style = snapshot === undefined ? undefined : ownRecord(snapshot.style) as StyleDocument | undefined;
  return style;
};

const rollbackError = (details: JsonObject | undefined): StyleToolError | undefined => {
  const value = ownRecord(details?.rollbackError);
  if (value === undefined || typeof value.code !== 'string'
    || !(STYLE_TOOL_ERROR_CODES as readonly string[]).includes(value.code)
    || typeof value.message !== 'string') {
    return undefined;
  }
  const nested = jsonValueSchema.safeParse(value.details);
  const nestedDetails = nested.success && !Array.isArray(nested.data)
    && nested.data !== null && typeof nested.data === 'object'
    ? nested.data as JsonObject
    : undefined;
  return createStyleToolError(
    value.code as StyleToolErrorCode,
    value.message,
    typeof value.path === 'string' ? value.path : undefined,
    nestedDetails,
  );
};

const currentFailure = (
  error: unknown,
): MapStyleApplyResult => {
  const authentic = asToolError(error);
  const style = styleSnapshotFromError(authentic);
  const details = authentic.details;
  const cleanedDetails = details === undefined
    ? undefined
    : Object.fromEntries(Object.entries(details).filter(([key]) =>
      key !== 'currentSnapshot' && key !== 'rolledBack' && key !== 'rollbackError')) as JsonObject;
  const primary = createStyleToolError(authentic.code, authentic.message, authentic.path,
    cleanedDetails === undefined || Object.keys(cleanedDetails).length === 0 ? undefined : cleanedDetails);
  const rolledBack = typeof details?.rolledBack === 'boolean' ? details.rolledBack : undefined;
  const restored = rollbackError(details);
  if (style === undefined) {
    return {
      ...unavailable(primary),
      ...(rolledBack === false ? { rolledBack } : {}),
      ...(restored === undefined ? {} : { rollbackError: restored }),
    };
  }
  const result: MapStyleCurrentResult = {
    ok: false,
    style,
    styleAuthority: 'current',
    applied: false,
    changedLayers: [],
    changedSources: [],
    diff: [],
    warnings: [],
    error: primary,
    ...(rolledBack === undefined ? {} : { rolledBack }),
    ...(restored === undefined ? {} : { rollbackError: restored }),
  };
  return result;
};

const runtimeFailure = (error: unknown): RuntimeCommandResult => ({
  ok: false,
  error: asToolError(error),
});

const invalidRuntimeResult = (message: string): RuntimeCommandResult => ({
  ok: false,
  error: createStyleToolError('INTERNAL', message),
});

const listInput = (input: RuntimeListInput): RuntimeListInput | StyleToolError => {
  const parsed = runtimeListInputSchema.safeParse(input);
  return parsed.success
    ? parsed.data
    : createStyleToolError('INVALID_INPUT', 'Runtime command input is invalid.', '');
};

const limitList = <Item extends string | JsonObject>(
  items: Item[],
  returned: number,
  transportTruncated: boolean,
  input: RuntimeListInput,
): RuntimeListData<Item> => {
  const maximum = input.limit ?? DEFAULT_RUNTIME_LIST_LIMIT;
  const retained = items.length > maximum ? items.slice(0, maximum) : [...items];
  return {
    items: retained,
    returned: retained.length,
    truncated: transportTruncated || retained.length < returned,
  };
};

const rgbaBase64 = (bytes: Uint8Array | Uint8ClampedArray): string => {
  let binary = '';
  const chunkSize = 8_192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return globalThis.btoa(binary);
};

export class WebMcpMapAuthority implements StyleAuthority, RuntimeAuthority {
  constructor(
    private readonly runtime: BrowserMapRuntime,
    private readonly getContext: () => MapToolContext = () => ({}),
  ) {}

  readStyle(): AuthorityStyleRead {
    const snapshot = this.runtime.snapshot();
    return { ok: true, style: structuredClone(snapshot.style), warnings: [] };
  }

  context(): MapToolContext {
    try {
      return { ...this.getContext() };
    } catch {
      return {};
    }
  }

  async applyTransaction(
    transaction: StyleTransaction,
    options: { diff: boolean; signal?: AbortSignal },
  ): Promise<MapStyleApplyResult> {
    if (options.signal?.aborted === true) return abortedMutation();
    const snapshot = this.runtime.snapshot();
    return this.applyMutation({
      type: 'applyTransaction',
      expectedRevision: snapshot.revision,
      expectedStyleHash: snapshot.styleHash,
      transaction: { ...transaction, validate: transaction.validate ?? true },
    }, snapshot, options);
  }

  async applyDocument(
    source: StyleDocument | string,
    options: { diff: boolean; signal?: AbortSignal },
  ): Promise<MapStyleApplyResult> {
    if (options.signal?.aborted === true) return abortedMutation();
    const snapshot = this.runtime.snapshot();
    return this.applyMutation({
      type: 'applyStyleDocument',
      expectedRevision: snapshot.revision,
      expectedStyleHash: snapshot.styleHash,
      source: typeof source === 'string'
        ? { kind: 'url', url: source }
        : { kind: 'style', style: source },
      diff: options.diff,
    }, snapshot, options);
  }

  private async applyMutation(
    command: WebMcpStyleMutationCommand,
    snapshot: BrowserMapState,
    options: { diff: boolean; signal?: AbortSignal },
  ): Promise<MapStyleApplyResult> {
    let projectedStyle: StyleDocument | undefined;
    if (command.type === 'applyTransaction') {
      const projected = applyStyleTransaction(snapshot.style, command.transaction);
      if (!projected.ok) {
        return { ...projected, styleAuthority: 'pre-operation', applied: false };
      }
      projectedStyle = projected.style;
    } else if (command.source.kind === 'style') {
      projectedStyle = command.source.style as StyleDocument;
    }
    try {
      const result = await this.runtime.execute(command, { signal: options.signal });
      if (result.type !== 'transaction' || result.detail !== 'full') {
        return unavailable(createStyleToolError('INTERNAL', 'WebMCP runtime did not return a full transaction result.'));
      }
      if (options.diff && result.diff === undefined) {
        return unavailable(createStyleToolError('INTERNAL', 'WebMCP full transaction result omitted the requested diff.'));
      }
      return await this.projectMutationSuccess(result, projectedStyle, options.diff);
    } catch (error) {
      return currentFailure(error);
    }
  }

  private async projectMutationSuccess(
    result: BridgeFullTransactionResult,
    projectedStyle: StyleDocument | undefined,
    includeDiff: boolean,
  ): Promise<MapStyleApplyResult> {
    let style = result.style as StyleDocument | undefined;
    if (style === undefined && projectedStyle !== undefined) {
      if (await hashStyle(projectedStyle) === result.styleHash) style = projectedStyle;
      else return unavailable(createStyleToolError(
        'INTERNAL', 'Projected Style hash does not match the WebMCP runtime transaction result.',
      ));
    }
    if (style === undefined) {
      return unavailable(createStyleToolError('INTERNAL', 'WebMCP full transaction result omitted the current Style.'));
    }
    return {
      ok: true,
      style: structuredClone(style),
      styleAuthority: 'current',
      applied: result.applied,
      changedLayers: [...result.changedLayerIds],
      changedSources: [...result.changedSourceIds],
      diff: includeDiff ? [...(result.diff ?? [])] : [],
      warnings: [...result.warnings],
    };
  }

  runtimeCommands(): MapRuntimeCommands {
    const acknowledge = async <C extends BridgeCommand>(
      command: C,
      execution?: RuntimeCommandExecution,
    ): Promise<RuntimeCommandResult> => {
      try {
        const result = await this.runtime.execute(command, execution);
        return result.type === 'ack'
          ? { ok: true, data: null }
          : invalidRuntimeResult('WebMCP runtime returned an invalid acknowledgement result.');
      } catch (error) {
        return runtimeFailure(error);
      }
    };
    const state = async <C extends BridgeCommand>(command: C): Promise<RuntimeCommandResult> => {
      try {
        const result = await this.runtime.execute(command);
        return result.type === 'state'
          ? { ok: true, data: null }
          : invalidRuntimeResult('WebMCP runtime returned an invalid state result.');
      } catch (error) {
        return runtimeFailure(error);
      }
    };
    return {
      updateGeoJsonDataRuntime: (input: RuntimeGeoJsonDiffUpdate) => acknowledge({
        type: 'updateGeoJsonData', sourceId: input.sourceId, diff: input.diff,
      }),
      setSourceTileLodParams: (input: SourceTileLodParamsInput) => acknowledge({
        type: 'setSourceTileLodParams',
        maxZoomLevelsOnScreen: input.maxZoomLevelsOnScreen,
        tileCountMaxMinRatio: input.tileCountMaxMinRatio,
        ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
      }),
      setFeatureState: (input: FeatureStateInput) => state({ type: 'setFeatureState', ...input }),
      removeFeatureState: (input: RemoveFeatureStateInput) => state({ type: 'removeFeatureState', ...input }),
      setGlobalState: (input: GlobalStateInput) => state({ type: 'setGlobalState', ...input }),
      listImages: async (input: RuntimeListInput = {}) => {
        const parsed = listInput(input);
        if ('code' in parsed) return { ok: false as const, error: parsed };
        try {
          const result = await this.runtime.execute({ type: 'listImages' });
          return result.type === 'images'
            ? { ok: true as const, data: limitList(result.imageIds, result.returned, result.truncated, parsed) }
            : { ok: false as const, error: createStyleToolError('INTERNAL', 'WebMCP runtime returned an invalid image list result.') };
        } catch (error) {
          return { ok: false as const, error: asToolError(error) };
        }
      },
      addImageData: (input: AddImageDataInput) => acknowledge({
        type: 'addImage',
        imageId: input.imageId,
        image: {
          kind: 'rgba',
          width: input.image.width,
          height: input.image.height,
          data: rgbaBase64(input.image.data),
        },
        ...(input.options === undefined ? {} : { options: input.options }),
        ...(input.overwrite === undefined ? {} : { overwrite: input.overwrite }),
      }),
      addImageFromUrl: (input: AddImageFromUrlInput, execution?: RuntimeCommandExecution) => acknowledge({
        type: 'addImage',
        imageId: input.imageId,
        image: { kind: 'url', url: input.url },
        ...(input.options === undefined ? {} : { options: input.options }),
        ...(input.overwrite === undefined ? {} : { overwrite: input.overwrite }),
      }, execution),
      removeImage: (input: RemoveImageInput) => acknowledge({ type: 'removeImage', imageId: input.imageId }),
      listSprites: async (input: RuntimeListInput = {}) => {
        const parsed = listInput(input);
        if ('code' in parsed) return { ok: false as const, error: parsed };
        try {
          const result = await this.runtime.execute({ type: 'listSprites' });
          return result.type === 'sprites'
            ? { ok: true as const, data: limitList(result.items as JsonObject[], result.returned, result.truncated, parsed) }
            : { ok: false as const, error: createStyleToolError('INTERNAL', 'WebMCP runtime returned an invalid sprite list result.') };
        } catch (error) {
          return { ok: false as const, error: asToolError(error) };
        }
      },
      addSprite: (input: AddSpriteInput) => acknowledge({ type: 'addSprite', ...input }),
      removeSprite: (input: RemoveSpriteInput) => acknowledge({ type: 'removeSprite', ...input }),
    } as unknown as MapRuntimeCommands;
  }

  async querySourceFeatures(input: SourceFeatureQueryInput): Promise<BoundedFeatureQueryResult> {
    return this.queryFeatures({
      type: 'querySourceFeatures',
      sourceId: input.sourceId,
      ...(input.sourceLayer === undefined ? {} : { sourceLayer: input.sourceLayer }),
      ...(input.filter === undefined ? {} : { filter: input.filter }),
      ...(input.propertyAllowlist === undefined ? {} : { properties: input.propertyAllowlist }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  }

  async queryRenderedFeatures(input: RenderedFeatureQueryInput): Promise<BoundedFeatureQueryResult> {
    return this.queryFeatures({
      type: 'queryRenderedFeatures',
      ...(input.geometry === undefined ? {} : { geometry: input.geometry }),
      ...(input.layerIds === undefined ? {} : { layerIds: input.layerIds }),
      ...(input.filter === undefined ? {} : { filter: input.filter }),
      ...(input.propertyAllowlist === undefined ? {} : { properties: input.propertyAllowlist }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  }

  private async queryFeatures(
    command: Extract<BridgeCommand, { type: 'querySourceFeatures' | 'queryRenderedFeatures' }>,
  ): Promise<BoundedFeatureQueryResult> {
    try {
      const result = await this.runtime.execute(command);
      if (result.type !== 'features') {
        return {
          ok: false, features: [], returned: 0, truncated: false, serializedBytes: 0, warnings: [],
          error: createStyleToolError('INTERNAL', 'WebMCP runtime returned an invalid feature result.'),
        };
      }
      return {
        ok: true,
        features: result.features as JsonObject[],
        returned: result.returned,
        truncated: result.truncated,
        serializedBytes: result.serializedBytes,
        warnings: result.warnings,
      };
    } catch (error) {
      return {
        ok: false, features: [], returned: 0, truncated: false, serializedBytes: 0, warnings: [],
        error: asToolError(error),
      };
    }
  }
}
