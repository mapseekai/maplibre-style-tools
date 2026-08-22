import { createStyleToolError } from '../core/index.js';
import type { GeoJsonFeature, JsonValue } from '../core/index.js';
import { boundFeatureQueryProjection, boundMapCommandReceipt, invalidInputFailure, toFailure } from './boundary.js';
import type { AuthoritySource, RuntimeAuthority } from './authority.js';
import { authorityNotReadyError } from './authority.js';
import type {
  CapabilityResult,
  FeatureQueryProjection,
  MapCommandReceipt,
} from './contracts.js';
import { queryMapFeaturesInputSchema, runMapCommandInputSchema } from './schemas.js';

const RUNTIME_MESSAGE = 'Map command completed.';
const FEATURE_QUERY_MESSAGE = 'Map feature query completed.';

export const RUN_MAP_COMMAND_DESCRIPTION = 'Run a bounded MapLibre runtime command.';
export const QUERY_MAP_FEATURES_DESCRIPTION = 'Query bounded MapLibre source or rendered features.';

export const executeRunMapCommand = async (
  getAuthority: AuthoritySource<RuntimeAuthority>,
  rawInput: unknown,
  execution: { abortSignal?: AbortSignal } = {},
): Promise<CapabilityResult<MapCommandReceipt>> => {
    const parsedInput = runMapCommandInputSchema.safeParse(rawInput);
    if (!parsedInput.success) return invalidInputFailure(parsedInput.error);
    const input = parsedInput.data;
    const authority = getAuthority();
    if (authority === null) return toFailure(authorityNotReadyError());
    const commands = authority.runtimeCommands();
    const result = await (async () => {
      switch (input.action) {
        case 'updateGeoJsonData':
          return commands.updateGeoJsonDataRuntime({ sourceId: input.sourceId, diff: input.diff });
        case 'setSourceTileLodParams':
          return commands.setSourceTileLodParams({
            maxZoomLevelsOnScreen: input.maxZoomLevelsOnScreen,
            tileCountMaxMinRatio: input.tileCountMaxMinRatio,
            ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
          });
        case 'setFeatureState':
          return commands.setFeatureState({ target: input.target, state: input.state });
        case 'removeFeatureState':
          return commands.removeFeatureState({
            target: input.target,
            ...(input.key === undefined ? {} : { key: input.key }),
          });
        case 'setGlobalState':
          return commands.setGlobalState({ propertyName: input.propertyName, value: input.value });
        case 'listImages':
          return commands.listImages({ limit: input.limit ?? 100 });
        case 'addImageFromUrl':
          return commands.addImageFromUrl(
            {
              imageId: input.imageId,
              url: input.url,
              ...(input.options === undefined ? {} : { options: input.options }),
              ...(input.overwrite === undefined ? {} : { overwrite: input.overwrite }),
            },
            ...(execution.abortSignal === undefined ? [] : [{ signal: execution.abortSignal }]),
          );
        case 'removeImage':
          return commands.removeImage({ imageId: input.imageId });
        case 'listSprites':
          return commands.listSprites({ limit: input.limit ?? 100 });
        case 'addSprite':
          return commands.addSprite({
            spriteId: input.spriteId,
            url: input.url,
            ...(input.overwrite === undefined ? {} : { overwrite: input.overwrite }),
          });
        case 'removeSprite':
          return commands.removeSprite({ spriteId: input.spriteId });
      }
    })();
    if (!result.ok) return toFailure(result.error ?? createStyleToolError('INTERNAL', 'Map command failed.'));
    if (input.action === 'listImages' || input.action === 'listSprites') {
      const list = result.data as { items: JsonValue[]; truncated: boolean };
      return boundMapCommandReceipt({
        message: RUNTIME_MESSAGE,
        action: input.action,
        kind: 'list',
        applied: true,
        result: list,
        warnings: [],
        truncated: list.truncated,
      });
    }
    return boundMapCommandReceipt({
      message: RUNTIME_MESSAGE,
      action: input.action,
      kind: 'acknowledgement',
      applied: true,
      warnings: [],
    });
};

export const executeQueryMapFeatures = async (
  getAuthority: AuthoritySource<RuntimeAuthority>,
  rawInput: unknown,
  _execution: { abortSignal?: AbortSignal } = {},
): Promise<CapabilityResult<FeatureQueryProjection>> => {
    const parsedInput = queryMapFeaturesInputSchema.safeParse(rawInput);
    if (!parsedInput.success) return invalidInputFailure(parsedInput.error);
    const input = parsedInput.data;
    const authority = getAuthority();
    if (authority === null) return toFailure(authorityNotReadyError());
    const result = await (input.target === 'source'
      ? authority.querySourceFeatures({
          sourceId: input.sourceId,
          ...(input.sourceLayer === undefined ? {} : { sourceLayer: input.sourceLayer }),
          ...(input.filter === undefined ? {} : { filter: input.filter }),
          ...(input.propertyAllowlist === undefined
            ? {} : { propertyAllowlist: input.propertyAllowlist }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.maxSerializedBytes === undefined
            ? {} : { maxSerializedBytes: input.maxSerializedBytes }),
        })
      : authority.queryRenderedFeatures({
          ...(input.geometry === undefined ? {} : { geometry: input.geometry }),
          ...(input.layerIds === undefined ? {} : { layerIds: input.layerIds }),
          ...(input.filter === undefined ? {} : { filter: input.filter }),
          ...(input.propertyAllowlist === undefined
            ? {} : { propertyAllowlist: input.propertyAllowlist }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.maxSerializedBytes === undefined
            ? {} : { maxSerializedBytes: input.maxSerializedBytes }),
        }));
    if (!result.ok) return toFailure(result.error ?? createStyleToolError('INTERNAL', 'Map feature query failed.'));
    return boundFeatureQueryProjection({
      message: FEATURE_QUERY_MESSAGE,
      target: input.target,
      features: result.features as GeoJsonFeature[],
      warnings: result.warnings,
      maxSerializedBytes: input.maxSerializedBytes,
      truncated: result.truncated,
    });
};
