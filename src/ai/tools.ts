import { tool } from 'ai';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { z } from 'zod';

import { MapStyleAuthority } from '../capabilities/map-authority.js';
import { capabilityRegistry } from '../capabilities/registry.js';
import type {
  AuthoritySource,
  RuntimeAuthority,
  StyleAuthority,
} from '../capabilities/authority.js';
import type {
  ApplyStyleDocumentInput,
  ApplyStyleTransactionInput,
  CapabilityResult,
  FeatureQueryProjection,
  InspectStyleInput,
  InspectionProjection,
  MapCommandReceipt,
  MapToolContext,
  QueryMapFeaturesInput,
  RunMapCommandInput,
  StyleMutationReceipt,
} from '../capabilities/index.js';
import type { RuntimeImageLoader } from '../adapters/maplibre/index.js';

export type MapAccessor = () => MapLibreMap | null;
export interface CreateMapLibreStyleToolsOptions {
  getMap: MapAccessor;
  getContext?: () => MapToolContext;
  imageLoader?: RuntimeImageLoader;
}

export interface MapLibreAiTool<TInput, TData> {
  execute(input: TInput): Promise<CapabilityResult<TData>>;
}
export interface MapLibreStyleTools {
  inspectStyle: MapLibreAiTool<InspectStyleInput, InspectionProjection>;
  applyStyleTransaction: MapLibreAiTool<ApplyStyleTransactionInput, StyleMutationReceipt>;
  applyStyleDocument: MapLibreAiTool<ApplyStyleDocumentInput, StyleMutationReceipt>;
  runMapCommand: MapLibreAiTool<RunMapCommandInput, MapCommandReceipt>;
  queryMapFeatures: MapLibreAiTool<QueryMapFeaturesInput, FeatureQueryProjection>;
}

const wrap = <TData>(
  schema: z.ZodType,
  description: string,
  execute: (
    rawInput: unknown,
    execution: { abortSignal?: AbortSignal },
  ) => Promise<CapabilityResult<TData>> | CapabilityResult<TData>,
) => tool({
  description,
  inputSchema: schema,
  execute: async (rawInput, execution) => execute(rawInput, {
    ...(execution?.abortSignal === undefined
      ? {} : { abortSignal: execution.abortSignal }),
  }),
});

export function createMapLibreStyleTools(
  options: CreateMapLibreStyleToolsOptions,
): MapLibreStyleTools {
  const authority: AuthoritySource<StyleAuthority & RuntimeAuthority> = () => {
    let map: MapLibreMap | null;
    try {
      map = options.getMap();
    } catch {
      map = null;
    }
    return map === null
      ? null
      : new MapStyleAuthority(map, {
        ...(options.getContext === undefined ? {} : { getContext: options.getContext }),
        ...(options.imageLoader === undefined ? {} : { imageLoader: options.imageLoader }),
      });
  };
  return {
    inspectStyle: wrap(
      capabilityRegistry.inspectStyle.inputSchema,
      capabilityRegistry.inspectStyle.description,
      (input) => capabilityRegistry.inspectStyle.execute(authority, input),
    ) as unknown as MapLibreAiTool<InspectStyleInput, InspectionProjection>,
    applyStyleTransaction: wrap(
      capabilityRegistry.applyStyleTransaction.inputSchema,
      capabilityRegistry.applyStyleTransaction.description,
      (input) => capabilityRegistry.applyStyleTransaction.execute(authority, input),
    ) as unknown as MapLibreAiTool<ApplyStyleTransactionInput, StyleMutationReceipt>,
    applyStyleDocument: wrap(
      capabilityRegistry.applyStyleDocument.inputSchema,
      capabilityRegistry.applyStyleDocument.description,
      (input) => capabilityRegistry.applyStyleDocument.execute(authority, input),
    ) as unknown as MapLibreAiTool<ApplyStyleDocumentInput, StyleMutationReceipt>,
    runMapCommand: wrap(
      capabilityRegistry.runMapCommand.inputSchema,
      capabilityRegistry.runMapCommand.description,
      (input, execution) => capabilityRegistry.runMapCommand.execute(authority, input, execution),
    ) as unknown as MapLibreAiTool<RunMapCommandInput, MapCommandReceipt>,
    queryMapFeatures: wrap(
      capabilityRegistry.queryMapFeatures.inputSchema,
      capabilityRegistry.queryMapFeatures.description,
      (input) => capabilityRegistry.queryMapFeatures.execute(authority, input),
    ) as unknown as MapLibreAiTool<QueryMapFeaturesInput, FeatureQueryProjection>,
  };
}
