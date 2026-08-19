import { createStyleToolError } from '../core/index.js';
import type { GeoJsonFeature, JsonValue } from '../core/index.js';
import {
  createMapRuntimeCommands,
  queryRenderedFeaturesBounded,
  querySourceFeaturesBounded,
} from '../adapters/maplibre/index.js';
import { boundFeatureQueryProjection, boundMapCommandReceipt, createAiTool, toFailure } from './boundary.js';
import type {
  CreateMapLibreStyleToolsOptions,
  FeatureQueryProjection,
  MapCommandReceipt,
  MapLibreAiTool,
  QueryMapFeaturesInput,
  RunMapCommandInput,
} from './contracts.js';
import { queryMapFeaturesInputSchema, runMapCommandInputSchema } from './schemas.js';

const RUNTIME_MESSAGE = 'Map command completed.';
const FEATURE_QUERY_MESSAGE = 'Map feature query completed.';

export const createRunMapCommandTool = (
  options: Pick<CreateMapLibreStyleToolsOptions, 'getMap' | 'imageLoader'>,
): MapLibreAiTool<RunMapCommandInput, MapCommandReceipt> => createAiTool(
  runMapCommandInputSchema,
  'Run a bounded MapLibre runtime command.',
  async (input, execution) => {
    const map = options.getMap();
    if (map === null) return toFailure(createStyleToolError('MAP_NOT_READY', 'Map is not ready.'));
    const commands = createMapRuntimeCommands(map, { imageLoader: options.imageLoader });
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
  },
) as unknown as MapLibreAiTool<RunMapCommandInput, MapCommandReceipt>;

export const createQueryMapFeaturesTool = (
  options: Pick<CreateMapLibreStyleToolsOptions, 'getMap'>,
): MapLibreAiTool<QueryMapFeaturesInput, FeatureQueryProjection> => createAiTool(
  queryMapFeaturesInputSchema,
  'Query bounded MapLibre source or rendered features.',
  (input) => {
    const map = options.getMap();
    if (map === null) return toFailure(createStyleToolError('MAP_NOT_READY', 'Map is not ready.'));
    const result = input.target === 'source'
      ? querySourceFeaturesBounded(map, {
          sourceId: input.sourceId,
          ...(input.sourceLayer === undefined ? {} : { sourceLayer: input.sourceLayer }),
          ...(input.filter === undefined ? {} : { filter: input.filter }),
          ...(input.propertyAllowlist === undefined
            ? {} : { propertyAllowlist: input.propertyAllowlist }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.maxSerializedBytes === undefined
            ? {} : { maxSerializedBytes: input.maxSerializedBytes }),
        })
      : queryRenderedFeaturesBounded(map, {
          ...(input.geometry === undefined ? {} : { geometry: input.geometry }),
          ...(input.layerIds === undefined ? {} : { layerIds: input.layerIds }),
          ...(input.filter === undefined ? {} : { filter: input.filter }),
          ...(input.propertyAllowlist === undefined
            ? {} : { propertyAllowlist: input.propertyAllowlist }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.maxSerializedBytes === undefined
            ? {} : { maxSerializedBytes: input.maxSerializedBytes }),
        });
    if (!result.ok) return toFailure(result.error ?? createStyleToolError('INTERNAL', 'Map feature query failed.'));
    return boundFeatureQueryProjection({
      message: FEATURE_QUERY_MESSAGE,
      target: input.target,
      features: result.features as GeoJsonFeature[],
      warnings: result.warnings,
      maxSerializedBytes: input.maxSerializedBytes,
      truncated: result.truncated,
    });
  },
) as unknown as MapLibreAiTool<QueryMapFeaturesInput, FeatureQueryProjection>;
