import type {
  AddImageDataInput,
  AddImageFromUrlInput,
  AddSpriteInput,
  BoundedFeatureQueryResult,
  FeatureStateInput,
  GlobalStateInput,
  MapRuntimeCommands,
  MapStyleApplyResult,
  RemoveFeatureStateInput,
  RemoveImageInput,
  RemoveSpriteInput,
  RenderedFeatureQueryInput,
  RuntimeGeoJsonDiffUpdate,
  RuntimeListInput,
  SourceFeatureQueryInput,
  SourceTileLodParamsInput,
} from '../adapters/maplibre/types.js';
import { DEFAULT_RUNTIME_LIST_LIMIT, runtimeListInputSchema } from '../adapters/maplibre/schemas.js';
import { hashStyle } from '../adapters/maplibre/style-hash.js';
import { STYLE_TOOL_ERROR_CODES, applyStyleTransaction, createStyleToolError, isStyleToolError, jsonValueSchema, type JsonObject, type StyleDocument, type StyleToolError, type StyleToolErrorCode, type StyleTransaction } from '../core/index.js';
import { toJsonPointer } from '../core/json-pointer.js';
import type { RuntimeAuthority, StyleAuthority } from '../capabilities/authority.js';
import type { BridgeCommand } from '../bridge/protocol.js';
import type { LiveMapRegistry } from '../bridge/registry.js';

type FreshStyleMutationCommand =
  | Omit<Extract<BridgeCommand, { type: 'applyTransaction' }>, 'expectedRevision' | 'expectedStyleHash'>
  | Omit<Extract<BridgeCommand, { type: 'applyStyleDocument' }>, 'expectedRevision' | 'expectedStyleHash'>;

const asToolError = (error: unknown): StyleToolError => isStyleToolError(error)
  ? error
  : createStyleToolError('INTERNAL', 'Live bridge command failed.');

const unavailable = (error: unknown) => ({
  ok: false as const, styleAuthority: 'unavailable' as const, applied: false as const,
  changedLayers: [] as [], changedSources: [] as [], diff: [] as [], warnings: [],
  error: asToolError(error),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const rollbackErrorFromDetails = (value: unknown): StyleToolError | undefined => {
  if (!isRecord(value) || typeof value.code !== 'string'
    || !(STYLE_TOOL_ERROR_CODES as readonly string[]).includes(value.code)
    || typeof value.message !== 'string') {
    return undefined;
  }
  return createStyleToolError(value.code as StyleToolErrorCode, value.message);
};

const parseRuntimeListInput = (input: unknown):
  | { ok: true; value: RuntimeListInput }
  | { ok: false; error: StyleToolError } => {
  try {
    const parsed = runtimeListInputSchema.safeParse(input);
    if (parsed.success) return { ok: true, value: parsed.data };
    const issue = parsed.error.issues[0];
    if (issue === undefined) {
      return {
        ok: false,
        error: createStyleToolError('INVALID_INPUT', 'Runtime command input is invalid.', ''),
      };
    }
    const details = 'params' in issue && issue.params !== undefined
      ? jsonValueSchema.safeParse(issue.params)
      : undefined;
    return {
      ok: false,
      error: createStyleToolError(
        'INVALID_INPUT',
        issue.message,
        toJsonPointer(issue.path.map((token) => typeof token === 'symbol' ? String(token) : token)),
        details?.success && !Array.isArray(details.data)
          && details.data !== null && typeof details.data === 'object'
          ? details.data
          : undefined,
      ),
    };
  } catch {
    return {
      ok: false,
      error: createStyleToolError('INVALID_INPUT', 'Runtime command input is invalid.', ''),
    };
  }
};

const limitList = <Item extends string | JsonObject>(
  items: Item[],
  returned: number,
  transportTruncated: boolean,
  input: RuntimeListInput,
) => {
  const limited = items.slice(0, input.limit ?? DEFAULT_RUNTIME_LIST_LIMIT);
  return {
    items: limited,
    returned: limited.length,
    truncated: transportTruncated || returned > limited.length,
  };
};

/** Style and runtime authority backed by one live bridge map. */
export class BridgeMapAuthority implements StyleAuthority, RuntimeAuthority {
  constructor(private readonly registry: LiveMapRegistry, private readonly mapId: string) {}

  readStyle() {
    try {
      return this.registry.projectCachedStyle(this.mapId, (style) => ({ ok: true as const, style, warnings: [] }));
    } catch (error) {
      return { ok: false as const, warnings: [], error: asToolError(error) };
    }
  }

  context() { return {}; }

  async #mutationFailure(
    error: unknown,
    baseline?: { style: StyleDocument; styleHash: string },
  ): Promise<MapStyleApplyResult> {
    const authentic = asToolError(error);
    const details = authentic.details;
    const currentSnapshot = details?.currentSnapshot;
    const snapshot = isRecord(currentSnapshot) ? currentSnapshot : undefined;
    let style = snapshot !== undefined && isRecord(snapshot.style)
      ? snapshot.style as StyleDocument
      : undefined;
    if (style === undefined && snapshot !== undefined
      && baseline !== undefined && snapshot.styleHash === baseline.styleHash) {
      style = baseline.style;
    }
    if (style === undefined && snapshot !== undefined) {
      try {
        const refreshed = await this.registry.execute(this.mapId, { type: 'getStyle' });
        if (refreshed.type === 'style') style = refreshed.style as StyleDocument;
      } catch {
        // The original authenticated mutation failure remains primary.
      }
    }
    const rollbackError = rollbackErrorFromDetails(details?.rollbackError);
    const rolledBack = typeof details?.rolledBack === 'boolean' ? details.rolledBack : undefined;
    const primaryEntries = details === undefined
      ? []
      : Object.entries(details).filter(([key]) =>
        key !== 'currentSnapshot' && key !== 'rolledBack' && key !== 'rollbackError');
    const primaryDetails = primaryEntries.length === 0
      ? undefined
      : Object.fromEntries(primaryEntries) as JsonObject;
    const primary = createStyleToolError(
      authentic.code, authentic.message, authentic.path, primaryDetails,
    );
    if (style === undefined) {
      return {
        ...unavailable(primary),
        ...(rolledBack === false ? { rolledBack } : {}),
        ...(rollbackError === undefined ? {} : { rollbackError }),
      };
    }
    return {
      ok: false, style, styleAuthority: 'current', applied: false,
      changedLayers: [], changedSources: [], diff: [], warnings: [], error: primary,
      ...(rolledBack === undefined ? {} : { rolledBack }),
      ...(rollbackError === undefined ? {} : { rollbackError }),
    };
  }

  async #applyStyleMutation(
    command: FreshStyleMutationCommand,
    options: { diff: boolean },
  ): Promise<MapStyleApplyResult> {
    let baseline: { style: StyleDocument; styleHash: string } | undefined;
    try {
      const current = await this.registry.execute(this.mapId, { type: 'getStyle' });
      if (current.type !== 'style') return unavailable(createStyleToolError('INTERNAL', 'Bridge returned an invalid style result.'));
      baseline = { style: current.style as StyleDocument, styleHash: current.styleHash };
      let projectedStyle: StyleDocument | undefined;
      if (command.type === 'applyTransaction') {
        const projected = applyStyleTransaction(current.style as StyleDocument, command.transaction);
        if (!projected.ok) return { ...projected, styleAuthority: 'pre-operation', applied: false } as MapStyleApplyResult;
        projectedStyle = projected.style;
      } else if (command.source.kind === 'style') {
        projectedStyle = command.source.style as StyleDocument;
      }
      const mutation = {
        ...command,
        expectedRevision: current.revision,
        expectedStyleHash: current.styleHash,
      } as BridgeCommand;
      const result = await this.registry.execute(this.mapId, mutation);
      if (result.type !== 'transaction' || result.detail !== 'full') {
        return unavailable(createStyleToolError('INTERNAL', 'Bridge did not return the required full transaction result.'));
      }
      if (options.diff && result.diff === undefined) {
        return unavailable(createStyleToolError('INTERNAL', 'Bridge full transaction result omitted the requested diff.'));
      }
      let style = result.style as StyleDocument | undefined;
      if (style === undefined && projectedStyle !== undefined) {
        const projectedHash = await hashStyle(projectedStyle);
        if (projectedHash !== result.styleHash) {
          return unavailable(createStyleToolError(
            'INTERNAL', 'Projected Style hash does not match the bridge transaction result.',
          ));
        }
        style = projectedStyle;
      }
      if (style === undefined) {
        return unavailable(createStyleToolError('INTERNAL', 'Bridge full transaction result omitted the current Style.'));
      }
      return {
        ok: true, style, applied: result.applied,
        changedLayers: [...result.changedLayerIds], changedSources: [...result.changedSourceIds],
        diff: options.diff ? [...(result.diff ?? [])] : [], warnings: [...result.warnings], styleAuthority: 'current',
      } as MapStyleApplyResult;
    } catch (error) { return this.#mutationFailure(error, baseline); }
  }

  async applyTransaction(transaction: StyleTransaction, options: { diff: boolean }): Promise<MapStyleApplyResult> {
    return this.#applyStyleMutation({
      type: 'applyTransaction',
      transaction: { ...transaction, validate: transaction.validate ?? true },
    }, options);
  }

  async applyDocument(source: StyleDocument | string, options: { diff: boolean }): Promise<MapStyleApplyResult> {
    return this.#applyStyleMutation({
      type: 'applyStyleDocument',
      source: typeof source === 'string'
        ? { kind: 'url', url: source }
        : { kind: 'style', style: source },
      diff: options.diff,
    }, options);
  }

  runtimeCommands(): MapRuntimeCommands {
    const execute = async <C extends BridgeCommand>(command: C) => {
      try {
        await this.registry.execute(this.mapId, command);
        return { ok: true as const, data: null };
      } catch (error) {
        return { ok: false as const, error: asToolError(error) };
      }
    };
    return {
      updateGeoJsonDataRuntime: (input: RuntimeGeoJsonDiffUpdate) => execute({
        type: 'updateGeoJsonData', sourceId: input.sourceId, diff: input.diff,
      }),
      setSourceTileLodParams: (input: SourceTileLodParamsInput) => execute({
        type: 'setSourceTileLodParams',
        maxZoomLevelsOnScreen: input.maxZoomLevelsOnScreen,
        tileCountMaxMinRatio: input.tileCountMaxMinRatio,
        ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
      }),
      setFeatureState: (input: FeatureStateInput) => execute({ type: 'setFeatureState', ...input }),
      removeFeatureState: (input: RemoveFeatureStateInput) => execute({ type: 'removeFeatureState', ...input }),
      setGlobalState: (input: GlobalStateInput) => execute({ type: 'setGlobalState', ...input }),
      listImages: async (input: RuntimeListInput = {}) => {
        const parsed = parseRuntimeListInput(input);
        if (!parsed.ok) return parsed;
        try {
          const result = await this.registry.execute(this.mapId, { type: 'listImages' });
          if (result.type !== 'images') {
            return { ok: false as const, error: createStyleToolError('INTERNAL', 'Bridge returned an invalid image list result.') };
          }
          return {
            ok: true as const,
            data: limitList(
              result.imageIds, result.returned, result.truncated, parsed.value,
            ),
          };
        } catch (error) { return { ok: false as const, error: asToolError(error) }; }
      },
      addImageData: (input: AddImageDataInput) => execute({
        type: 'addImage', imageId: input.imageId,
        image: {
          kind: 'rgba', width: input.image.width, height: input.image.height,
          data: Buffer.from(input.image.data).toString('base64'),
        },
        ...(input.options === undefined ? {} : { options: input.options }),
        ...(input.overwrite === undefined ? {} : { overwrite: input.overwrite }),
      }),
      addImageFromUrl: (input: AddImageFromUrlInput) => execute({
        type: 'addImage', imageId: input.imageId,
        image: { kind: 'url', url: input.url },
        ...(input.options === undefined ? {} : { options: input.options }),
        ...(input.overwrite === undefined ? {} : { overwrite: input.overwrite }),
      }),
      removeImage: (input: RemoveImageInput) => execute({ type: 'removeImage', imageId: input.imageId }),
      listSprites: async (input: RuntimeListInput = {}) => {
        const parsed = parseRuntimeListInput(input);
        if (!parsed.ok) return parsed;
        try {
          const result = await this.registry.execute(this.mapId, { type: 'listSprites' });
          if (result.type !== 'sprites') {
            return { ok: false as const, error: createStyleToolError('INTERNAL', 'Bridge returned an invalid sprite list result.') };
          }
          return {
            ok: true as const,
            data: limitList(
              result.items as JsonObject[], result.returned, result.truncated, parsed.value,
            ),
          };
        } catch (error) { return { ok: false as const, error: asToolError(error) }; }
      },
      addSprite: (input: AddSpriteInput) => execute({ type: 'addSprite', ...input }),
      removeSprite: (input: RemoveSpriteInput) => execute({ type: 'removeSprite', ...input }),
    } as unknown as MapRuntimeCommands;
  }

  async querySourceFeatures(input: SourceFeatureQueryInput): Promise<BoundedFeatureQueryResult> {
    try {
      const result = await this.registry.execute(this.mapId, {
        type: 'querySourceFeatures',
        sourceId: input.sourceId,
        ...(input.sourceLayer === undefined ? {} : { sourceLayer: input.sourceLayer }),
        ...(input.filter === undefined ? {} : { filter: input.filter }),
        ...(input.propertyAllowlist === undefined ? {} : { properties: input.propertyAllowlist }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      } as BridgeCommand);
      if (result.type !== 'features') {
        return { ok: false, error: createStyleToolError('INTERNAL', 'Bridge returned an invalid feature result.') } as BoundedFeatureQueryResult;
      }
      return { ok: true, features: result.features, truncated: result.truncated, warnings: result.warnings } as BoundedFeatureQueryResult;
    } catch (error) {
      return { ok: false, error: asToolError(error) } as BoundedFeatureQueryResult;
    }
  }

  async queryRenderedFeatures(input: RenderedFeatureQueryInput): Promise<BoundedFeatureQueryResult> {
    try {
      const result = await this.registry.execute(this.mapId, {
        type: 'queryRenderedFeatures',
        ...(input.geometry === undefined ? {} : { geometry: input.geometry }),
        ...(input.layerIds === undefined ? {} : { layerIds: input.layerIds }),
        ...(input.filter === undefined ? {} : { filter: input.filter }),
        ...(input.propertyAllowlist === undefined ? {} : { properties: input.propertyAllowlist }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      } as BridgeCommand);
      if (result.type !== 'features') {
        return { ok: false, error: createStyleToolError('INTERNAL', 'Bridge returned an invalid feature result.') } as BoundedFeatureQueryResult;
      }
      return { ok: true, features: result.features, truncated: result.truncated, warnings: result.warnings } as BoundedFeatureQueryResult;
    } catch (error) {
      return { ok: false, error: asToolError(error) } as BoundedFeatureQueryResult;
    }
  }
}
