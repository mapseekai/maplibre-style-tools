import type {
  BoundedFeatureQueryResult,
  MapRuntimeCommands,
  MapStyleApplyResult,
  RenderedFeatureQueryInput,
  SourceFeatureQueryInput,
} from '../adapters/maplibre/types.js';
import { applyStyleTransaction, createStyleToolError, isStyleToolError, type StyleDocument, type StyleToolError, type StyleTransaction } from '../core/index.js';
import type { RuntimeAuthority, StyleAuthority } from '../capabilities/authority.js';
import type { BridgeCommand } from '../bridge/protocol.js';
import type { LiveMapRegistry } from '../bridge/registry.js';

const asToolError = (error: unknown): StyleToolError => isStyleToolError(error)
  ? error
  : createStyleToolError('INTERNAL', 'Live bridge command failed.');

const unavailable = (error: unknown) => ({
  ok: false as const, styleAuthority: 'unavailable' as const, applied: false as const,
  changedLayers: [] as [], changedSources: [] as [], diff: [] as [], warnings: [],
  error: asToolError(error),
});

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

  async applyTransaction(transaction: StyleTransaction, options: { diff: boolean }): Promise<MapStyleApplyResult> {
    try {
      const current = await this.registry.execute(this.mapId, { type: 'getStyle' } as BridgeCommand);
      if (current.type !== 'style') return unavailable(createStyleToolError('INTERNAL', 'Bridge returned an invalid style result.'));
      const projected = applyStyleTransaction(current.style as StyleDocument, transaction);
      if (!projected.ok) return { ...projected, styleAuthority: 'pre-operation', applied: false } as MapStyleApplyResult;
      const result = await this.registry.execute(this.mapId, {
        type: 'applyTransaction', expectedRevision: current.revision, expectedStyleHash: current.styleHash, transaction,
      } as BridgeCommand);
      if (result.type !== 'transaction' || result.detail !== 'full') {
        return unavailable(createStyleToolError('INTERNAL', 'Bridge did not return the required full transaction result.'));
      }
      if (options.diff && result.diff === undefined) {
        return unavailable(createStyleToolError('INTERNAL', 'Bridge full transaction result omitted the requested diff.'));
      }
      return {
        ok: true, style: result.style ?? projected.style, applied: result.applied,
        changedLayers: [...result.changedLayerIds], changedSources: [...result.changedSourceIds],
        diff: options.diff ? [...(result.diff ?? [])] : [], warnings: [...result.warnings], styleAuthority: 'current',
      } as MapStyleApplyResult;
    } catch (error) { return unavailable(error); }
  }

  async applyDocument(source: StyleDocument | string, options: { diff: boolean }): Promise<MapStyleApplyResult> {
    void source;
    void options;
    return unavailable(createStyleToolError('CAPABILITY_DENIED', 'Applying a whole style document is not supported by the live bridge.'));
  }

  runtimeCommands(): MapRuntimeCommands {
    const execute = async (command: BridgeCommand) => {
      try {
        await this.registry.execute(this.mapId, command);
        return { ok: true as const, data: undefined };
      } catch (error) {
        return { ok: false as const, error: asToolError(error) };
      }
    };
    const unsupported = () => ({ ok: false as const, error: createStyleToolError('CAPABILITY_DENIED', 'This runtime command is not supported by the live bridge.') });
    return {
      updateGeoJsonDataRuntime: unsupported,
      setSourceTileLodParams: unsupported,
      setFeatureState: (input: unknown) => execute({ type: 'setFeatureState', ...(input as object) } as BridgeCommand),
      removeFeatureState: (input: unknown) => execute({ type: 'removeFeatureState', ...(input as object) } as BridgeCommand),
      setGlobalState: (input: unknown) => execute({ type: 'setGlobalState', ...(input as object) } as BridgeCommand),
      listImages: async (input: unknown) => {
        try {
          const result = await this.registry.execute(this.mapId, { type: 'listImages', ...(input as object) } as BridgeCommand);
          return result.type === 'images' ? { ok: true as const, data: { items: result.imageIds, truncated: false } } : unsupported();
        } catch (error) { return { ok: false as const, error: asToolError(error) }; }
      },
      addImageData: unsupported,
      addImageFromUrl: () => unsupported(),
      removeImage: (input: unknown) => execute({ type: 'removeImage', ...(input as object) } as BridgeCommand),
      listSprites: unsupported,
      addSprite: unsupported,
      removeSprite: unsupported,
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
