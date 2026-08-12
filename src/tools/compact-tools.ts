import { tool } from 'ai';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { z } from 'zod';
import { buildStyleContext, searchLayers } from '../engine/style-context.js';
import { applyStyleOperations } from '../engine/style-operations.js';
import { validateStyleDocument } from '../core/validation.js';
import type { StyleDocument as CoreStyleDocument } from '../core/types.js';
import type {
  JsonObject,
  LayerSummary,
  StyleDocument as LegacyStyleDocument,
  StyleOperation,
} from '../types.js';

export type CompactMapAccessor = () => MapLibreMap | null;

export interface CompactToolContext {
  activeSourceId?: string | null;
  selectedLayerId?: string | null;
}

export interface CreateCompactMapLibreStyleToolsOptions {
  getMap: CompactMapAccessor;
  getContext?: () => CompactToolContext;
}

interface CompactToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

const compactResult = (
  message: string,
  data?: unknown,
  success = true
): CompactToolResult => ({
  success,
  message,
  ...(data === undefined ? {} : { data }),
});

const mapReadyError = () =>
  compactResult('Map is not ready yet. Please wait until the preview loads, then retry.', undefined, false);

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJson = (rawValue: string): unknown => JSON.parse(rawValue) as unknown;

const parseJsonObject = (
  rawValue: string,
  label: string
): { ok: true; value: JsonObject } | { ok: false; message: string } => {
  try {
    const parsed = parseJson(rawValue);
    if (!isRecord(parsed)) {
      return { ok: false, message: `${label} must be a JSON object.` };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    return {
      ok: false,
      message: `${label} is not valid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
};

const parseOperations = (
  rawValue: string
): { ok: true; value: StyleOperation[] } | { ok: false; message: string } => {
  try {
    const parsed = parseJson(rawValue);
    if (!Array.isArray(parsed)) {
      return { ok: false, message: 'operationsJson must be a JSON array.' };
    }
    return { ok: true, value: parsed as StyleOperation[] };
  } catch (error) {
    return {
      ok: false,
      message: `operationsJson is not valid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
};

const getStyleDocument = (
  map: MapLibreMap
): { ok: true; style: CoreStyleDocument } | { ok: false; message: string } => {
  const result = validateStyleDocument(map.getStyle());
  if (!result.ok) {
    return {
      ok: false,
      message: result.errors[0]?.message ?? 'Current map style is unavailable.',
    };
  }
  return { ok: true, style: result.style };
};

const toLegacyStyleDocument = (style: CoreStyleDocument): LegacyStyleDocument =>
  style as unknown as LegacyStyleDocument;

const inspectLayer = (
  style: CoreStyleDocument,
  layerId: string,
  fields: Array<'paint' | 'layout' | 'filter' | 'zoom'>
): JsonObject | null => {
  const layer = style.layers.find((item) => item.id === layerId);
  if (!layer) {
    return null;
  }

  const summary: JsonObject = {
    id: layer.id,
    type: layer.type,
    source: layer.source,
    sourceLayer: layer['source-layer'],
  };

  if (fields.includes('paint')) {
    summary.paint = layer.paint ?? {};
  }
  if (fields.includes('layout')) {
    summary.layout = layer.layout ?? {};
  }
  if (fields.includes('filter')) {
    summary.filter = layer.filter;
  }
  if (fields.includes('zoom')) {
    summary.minzoom = layer.minzoom;
    summary.maxzoom = layer.maxzoom;
  }

  return summary;
};

const summarizeLayerIds = (layers: LayerSummary[]) =>
  layers.map((layer) => layer.id).join(', ') || '<none>';

export const createCompactMapLibreStyleTools = ({
  getMap,
  getContext,
}: CreateCompactMapLibreStyleToolsOptions) => ({
  getStyleContext: tool({
    description:
      'Return a compact summary of the current MapLibre style: layer counts, source counts, layer type counts, active source, selected layer, and layer summaries. Does not return full style JSON.',
    inputSchema: z.object({
      layerLimit: z.number().min(1).max(300).default(120),
    }),
    execute: ({ layerLimit }) => {
      const map = getMap();
      if (!map) {
        return mapReadyError();
      }

      const styleResult = getStyleDocument(map);
      if (!styleResult.ok) {
        return compactResult(styleResult.message, undefined, false);
      }

      const context = buildStyleContext(styleResult.style, {
        ...getContext?.(),
        layerLimit,
      });
      return compactResult(
        `Current style has ${context.layerCount} layers and ${context.sourceCount} sources.`,
        context
      );
    },
  }),

  searchLayers: tool({
    description:
      'Search current style layers by text, type, source, or source-layer. Use this before edits when the target layer id is ambiguous.',
    inputSchema: z.object({
      query: z.string().optional(),
      type: z.string().optional(),
      source: z.string().optional(),
      sourceLayer: z.string().optional(),
      limit: z.number().min(1).max(300).default(80),
    }),
    execute: (input) => {
      const map = getMap();
      if (!map) {
        return mapReadyError();
      }

      const styleResult = getStyleDocument(map);
      if (!styleResult.ok) {
        return compactResult(styleResult.message, undefined, false);
      }

      const result = searchLayers(styleResult.style, input);
      return compactResult(
        `Found ${result.total} matching layer${result.total === 1 ? '' : 's'}: ${summarizeLayerIds(result.layers)}`,
        result
      );
    },
  }),

  inspectLayersCompact: tool({
    description:
      'Inspect selected layers and return only requested fields. Prefer this over inspecting full style JSON.',
    inputSchema: z.object({
      layerIdsJson: z.string().describe('JSON array of layer ids.'),
      fields: z
        .array(z.enum(['paint', 'layout', 'filter', 'zoom']))
        .default(['paint', 'layout']),
    }),
    execute: ({ layerIdsJson, fields }) => {
      const map = getMap();
      if (!map) {
        return mapReadyError();
      }

      const styleResult = getStyleDocument(map);
      if (!styleResult.ok) {
        return compactResult(styleResult.message, undefined, false);
      }

      let layerIds: string[];
      try {
        const parsed = parseJson(layerIdsJson);
        if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
          return compactResult('layerIdsJson must be a JSON array of strings.', undefined, false);
        }
        layerIds = parsed;
      } catch (error) {
        return compactResult(
          `layerIdsJson is not valid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
          undefined,
          false
        );
      }

      const inspected = layerIds.map((layerId) =>
        inspectLayer(styleResult.style, layerId, fields)
      );
      const missing = layerIds.filter((_, index) => inspected[index] === null);
      if (missing.length > 0) {
        return compactResult(`Layers not found: ${missing.join(', ')}`, undefined, false);
      }

      return compactResult(`Inspected ${inspected.length} layer${inspected.length === 1 ? '' : 's'}.`, {
        layers: inspected,
      });
    },
  }),

  applyStyleOperations: tool({
    description:
      'Apply validated style operations to one or more layers and return changed layer ids plus compact diff summary. operationsJson is a JSON array of { layerId, paint, layout, filter, minzoom, maxzoom }.',
    inputSchema: z.object({
      operationsJson: z.string(),
      dryRun: z.boolean().default(false),
      diff: z.boolean().default(true),
    }),
    execute: ({ operationsJson, dryRun, diff }) => {
      const map = getMap();
      if (!map) {
        return mapReadyError();
      }

      const styleResult = getStyleDocument(map);
      if (!styleResult.ok) {
        return compactResult(styleResult.message, undefined, false);
      }

      const parsedOperations = parseOperations(operationsJson);
      if (!parsedOperations.ok) {
        return compactResult(parsedOperations.message, undefined, false);
      }

      const result = applyStyleOperations(
        toLegacyStyleDocument(styleResult.style),
        parsedOperations.value,
      );
      if (!result.success) {
        return compactResult(result.message, {
          changedLayers: result.changedLayers,
          diffSummary: result.diffSummary,
        }, false);
      }

      if (!dryRun) {
        try {
          map.setStyle(result.style as never, { diff } as never);
        } catch (error) {
          return compactResult(
            `Failed to apply style operations to map: ${error instanceof Error ? error.message : 'Unknown error'}`,
            {
              changedLayers: result.changedLayers,
              diffSummary: result.diffSummary,
            },
            false
          );
        }
      }

      return compactResult(dryRun ? 'Style operations validated.' : result.message, {
        dryRun,
        changedLayers: result.changedLayers,
        diffSummary: result.diffSummary,
      });
    },
  }),

  validateStylePatchJson: tool({
    description:
      'Validate that a JSON object can be parsed for future style patches. This is a lightweight syntax guard and does not apply changes.',
    inputSchema: z.object({
      patchJson: z.string(),
    }),
    execute: ({ patchJson }) => {
      const parsed = parseJsonObject(patchJson, 'patchJson');
      if (!parsed.ok) {
        return compactResult(parsed.message, undefined, false);
      }
      return compactResult('Patch JSON is valid.', { keys: Object.keys(parsed.value) });
    },
  }),
});
