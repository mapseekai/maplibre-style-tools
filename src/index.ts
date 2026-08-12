import { tool } from 'ai';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { z } from 'zod';
import { validateStyleDocument } from './core/validation.js';
import { applyLegacyPropertyOperationToMap } from './tools/legacy-property-adapter.js';
export { createCompactMapLibreStyleTools } from './tools/compact-tools.js';
export type {
  LayerSearchQuery,
  LayerSearchResult,
  LayerSummary,
  StyleContext,
  StyleContextOptions,
  StyleDiffEntry,
  StyleDocument,
  StyleLayer,
  StyleOperation,
  StyleOperationResult,
} from './types.js';
export type {
  CoreExecutionLimits,
  StyleOperation as CoreStyleOperation,
  StyleDiffEntry as CoreStyleDiffEntry,
  StyleReplacementOptions,
  StyleTransaction,
  StyleTransactionOptions,
  StyleTransactionResult as CoreStyleTransactionResult,
  StyleToolError,
  StyleWarning,
} from './core/index.js';
export { applyStyleTransaction, validateStyleDocument } from './core/index.js';

export interface ToolCallResult<TStyle = unknown> {
  success: boolean;
  message: string;
  style?: TStyle;
}

export type MapAccessor = () => MapLibreMap | null;
export type StyleAccessor<TStyle = unknown> = () => TStyle;

export interface CreateMapLibreStyleToolsOptions<TStyle = unknown> {
  getMap: MapAccessor;
  getState?: StyleAccessor<TStyle>;
}

type JsonObject = Record<string, unknown>;

const parseStyleValue = (rawValue: string): unknown => {
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
};

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseObjectInput = (
  rawValue: string,
  label: string
): { ok: true; value: JsonObject } | { ok: false; message: string } => {
  const parsed = parseStyleValue(rawValue);
  if (!isRecord(parsed)) {
    return { ok: false, message: `${label} must be a JSON object.` };
  }
  return { ok: true, value: parsed };
};

const getLayerIds = (map: MapLibreMap): string[] => {
  const style = map.getStyle();
  const layers = style?.layers ?? [];
  return layers.map((layer) => layer.id);
};

const getStyleSources = (map: MapLibreMap): Record<string, unknown> => {
  const style = map.getStyle();
  if (!style || !isRecord(style.sources)) {
    return {};
  }
  return style.sources;
};

const buildResult = <TStyle>(
  message: string,
  style: TStyle | undefined,
  success = true
): ToolCallResult<TStyle> => ({
  success,
  message,
  ...(style === undefined ? {} : { style }),
});

const mapReadyError = <TStyle>(style: TStyle | undefined) =>
  buildResult(
    'Map is not ready yet. Please wait until the preview loads, then retry.',
    style,
    false
  );

const missingLayerError = <TStyle>(layerId: string, style: TStyle | undefined) =>
  buildResult(`Layer "${layerId}" not found in current style.`, style, false);

const missingSourceError = <TStyle>(sourceId: string, style: TStyle | undefined) =>
  buildResult(`Source "${sourceId}" not found in current style.`, style, false);

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cloneCurrentStyle = (
  map: MapLibreMap
): { ok: true; style: JsonObject } | { ok: false; message: string } => {
  const currentStyle = map.getStyle();
  if (!isRecord(currentStyle)) {
    return { ok: false, message: 'Current map style is unavailable.' };
  }

  try {
    const cloned = cloneJson(currentStyle);
    if (!isRecord(cloned)) {
      return { ok: false, message: 'Current map style is not a JSON object.' };
    }
    return { ok: true, style: cloned };
  } catch {
    return { ok: false, message: 'Current map style cannot be cloned safely.' };
  }
};

const mergeObjects = (base: JsonObject, patch: JsonObject): JsonObject => {
  const next: JsonObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isRecord(value) && isRecord(next[key])) {
      next[key] = mergeObjects(next[key] as JsonObject, value);
    } else {
      next[key] = value;
    }
  }
  return next;
};

const isJsonArray = (value: unknown): value is unknown[] => Array.isArray(value);

export const createMapLibreStyleTools = <TStyle = unknown>({
  getMap,
  getState,
}: CreateMapLibreStyleToolsOptions<TStyle>) => {
  const readState = () => getState?.();

  return {
    listAllLayers: tool({
      description: 'List all loaded layers from the current MapLibre style.',
      inputSchema: z.object({
        limit: z.number().min(1).max(300).default(120),
      }),
      execute: ({ limit }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const layers = map.getStyle()?.layers ?? [];
        if (layers.length === 0) {
          return buildResult('No layers found in current style.', style, false);
        }

        const summary = layers
          .slice(0, limit)
          .map((layer, index) => {
            const source =
              'source' in layer && layer.source ? `, source: ${layer.source}` : '';
            const sourceLayer =
              'source-layer' in layer && layer['source-layer']
                ? `, source-layer: ${layer['source-layer']}`
                : '';
            return `${index + 1}. ${layer.id} (type: ${layer.type}${source}${sourceLayer})`;
          })
          .join('\n');

        return buildResult(
          `Loaded layers (${layers.length} total):\n${summary}`,
          style
        );
      },
    }),

    listAllSources: tool({
      description: 'List all loaded sources from the current MapLibre style.',
      inputSchema: z.object({
        limit: z.number().min(1).max(300).default(120),
      }),
      execute: ({ limit }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const sources = getStyleSources(map);
        const entries = Object.entries(sources);
        if (entries.length === 0) {
          return buildResult('No sources found in current style.', style, false);
        }

        const summary = entries
          .slice(0, limit)
          .map(([sourceId, source], index) => {
            const sourceObject = isRecord(source) ? source : {};
            const sourceType =
              typeof sourceObject.type === 'string' ? sourceObject.type : 'unknown';
            const urlPart =
              typeof sourceObject.url === 'string' ? `, url: ${sourceObject.url}` : '';
            const tilesPart = Array.isArray(sourceObject.tiles)
              ? `, tiles: ${sourceObject.tiles.length}`
              : '';
            const dataPart =
              typeof sourceObject.data === 'string' ? ', data: <url>' : '';
            return `${index + 1}. ${sourceId} (type: ${sourceType}${urlPart}${tilesPart}${dataPart})`;
          })
          .join('\n');

        return buildResult(
          `Loaded sources (${entries.length} total):\n${summary}`,
          style
        );
      },
    }),

    inspectLayerStyle: tool({
      description:
        'Inspect a layer by id and return its paint/layout/filter definitions.',
      inputSchema: z.object({
        layerId: z.string().describe('Layer id from listAllLayers output'),
      }),
      execute: ({ layerId }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const layer = (map.getStyle()?.layers ?? []).find(
          (item) => item.id === layerId
        );
        if (!layer) {
          return missingLayerError(layerId, style);
        }

        const paint = 'paint' in layer && layer.paint ? layer.paint : {};
        const layout = 'layout' in layer && layer.layout ? layer.layout : {};
        const filter = 'filter' in layer ? layer.filter : undefined;

        return buildResult(
          `Layer ${layerId} details:\n${JSON.stringify(
            {
              id: layer.id,
              type: layer.type,
              source: 'source' in layer ? layer.source : undefined,
              sourceLayer:
                'source-layer' in layer ? layer['source-layer'] : undefined,
              paint,
              layout,
              filter,
            },
            null,
            2
          )}`,
          style
        );
      },
    }),

    inspectSource: tool({
      description: 'Inspect a source by id and return its full source definition.',
      inputSchema: z.object({
        sourceId: z.string().describe('Source id from listAllSources output'),
      }),
      execute: ({ sourceId }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const source = getStyleSources(map)[sourceId];
        if (!source) {
          return missingSourceError(sourceId, style);
        }

        return buildResult(
          `Source ${sourceId} details:\n${JSON.stringify(source, null, 2)}`,
          style
        );
      },
    }),

    setLayerPaintProperty: tool({
      description:
        'Set a paint property for any existing layer. valueJson can be JSON literal (number/array/object) or plain string.',
      inputSchema: z.object({
        layerId: z.string(),
        property: z
          .string()
          .describe('For example fill-color, line-width, text-color'),
        valueJson: z
          .string()
          .describe(
            'JSON literal or string. Example: "#ff0000", 1.2, ["interpolate", ...]'
          ),
      }),
      execute: ({ layerId, property, valueJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (!map.getLayer(layerId)) {
          return missingLayerError(layerId, style);
        }
        const parsedValue = parseStyleValue(valueJson);
        const result = applyLegacyPropertyOperationToMap(map, {
          layerId,
          paint: { [property]: parsedValue },
        });
        return result.success
          ? buildResult(
              `Updated paint property: ${layerId}.${property} = ${JSON.stringify(parsedValue)}`,
              style
            )
          : buildResult(
              `Failed to set paint property ${layerId}.${property}: ${result.message}`,
              style,
              false
            );
      },
    }),

    setLayerLayoutProperty: tool({
      description:
        'Set a layout property for any existing layer. valueJson can be JSON literal or plain string.',
      inputSchema: z.object({
        layerId: z.string(),
        property: z
          .string()
          .describe('For example visibility, text-size, line-cap'),
        valueJson: z
          .string()
          .describe('JSON literal or string. Example: "visible", 14'),
      }),
      execute: ({ layerId, property, valueJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (!map.getLayer(layerId)) {
          return missingLayerError(layerId, style);
        }
        const parsedValue = parseStyleValue(valueJson);
        const result = applyLegacyPropertyOperationToMap(map, {
          layerId,
          layout: { [property]: parsedValue },
        });
        return result.success
          ? buildResult(
              `Updated layout property: ${layerId}.${property} = ${JSON.stringify(parsedValue)}`,
              style
            )
          : buildResult(
              `Failed to set layout property ${layerId}.${property}: ${result.message}`,
              style,
              false
            );
      },
    }),

    setLayerPaintPropertySmart: tool({
      description:
        'Set a paint property with layer-type guard. Example: line layer accepts line-* but rejects fill-*.',
      inputSchema: z.object({
        layerId: z.string(),
        property: z.string(),
        valueJson: z.string(),
      }),
      execute: ({ layerId, property, valueJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        const parsedValue = parseStyleValue(valueJson);
        const result = applyLegacyPropertyOperationToMap(map, {
          layerId,
          paint: { [property]: parsedValue },
        });
        return result.success
          ? buildResult(
              `Updated paint property (smart): ${layerId}.${property} = ${JSON.stringify(parsedValue)}`,
              style
            )
          : buildResult(
              `Failed to set paint property ${layerId}.${property}: ${result.message}`,
              style,
              false
            );
      },
    }),

    setLayerLayoutPropertySmart: tool({
      description:
        'Set a layout property with layer-type guard. visibility is always allowed.',
      inputSchema: z.object({
        layerId: z.string(),
        property: z.string(),
        valueJson: z.string(),
      }),
      execute: ({ layerId, property, valueJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        const parsedValue = parseStyleValue(valueJson);
        const result = applyLegacyPropertyOperationToMap(map, {
          layerId,
          layout: { [property]: parsedValue },
        });
        return result.success
          ? buildResult(
              `Updated layout property (smart): ${layerId}.${property} = ${JSON.stringify(parsedValue)}`,
              style
            )
          : buildResult(
              `Failed to set layout property ${layerId}.${property}: ${result.message}`,
              style,
              false
            );
      },
    }),

    batchSetLayerPaintPropertiesSmart: tool({
      description:
        'Batch set paint properties with layer-type guard. Rejects the whole request if any property is invalid.',
      inputSchema: z.object({
        layerId: z.string(),
        propertiesJson: z.string(),
      }),
      execute: ({ layerId, propertiesJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        const parsedProps = parseObjectInput(propertiesJson, 'propertiesJson');
        if (!parsedProps.ok) {
          return buildResult(parsedProps.message, style, false);
        }

        const entries = Object.entries(parsedProps.value);
        if (entries.length === 0) {
          return buildResult('propertiesJson is empty.', style, false);
        }
        const result = applyLegacyPropertyOperationToMap(map, {
          layerId,
          paint: parsedProps.value,
        });
        return result.success
          ? buildResult(
              `Updated ${entries.length} paint properties for layer "${layerId}" (smart).`,
              style
            )
          : buildResult(
              `Failed to batch set paint properties for ${layerId}: ${result.message}`,
              style,
              false
            );
      },
    }),

    batchSetLayerLayoutPropertiesSmart: tool({
      description:
        'Batch set layout properties with layer-type guard. visibility is always allowed.',
      inputSchema: z.object({
        layerId: z.string(),
        propertiesJson: z.string(),
      }),
      execute: ({ layerId, propertiesJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        const parsedProps = parseObjectInput(propertiesJson, 'propertiesJson');
        if (!parsedProps.ok) {
          return buildResult(parsedProps.message, style, false);
        }

        const entries = Object.entries(parsedProps.value);
        if (entries.length === 0) {
          return buildResult('propertiesJson is empty.', style, false);
        }
        const result = applyLegacyPropertyOperationToMap(map, {
          layerId,
          layout: parsedProps.value,
        });
        return result.success
          ? buildResult(
              `Updated ${entries.length} layout properties for layer "${layerId}" (smart).`,
              style
            )
          : buildResult(
              `Failed to batch set layout properties for ${layerId}: ${result.message}`,
              style,
              false
            );
      },
    }),

    batchSetLayerPaintProperties: tool({
      description:
        'Set multiple paint properties in one call. propertiesJson must be an object of paint-property -> value.',
      inputSchema: z.object({
        layerId: z.string(),
        propertiesJson: z.string().describe('JSON object, e.g. {"fill-color":"#fff","fill-opacity":0.6}'),
      }),
      execute: ({ layerId, propertiesJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (!map.getLayer(layerId)) {
          return missingLayerError(layerId, style);
        }
        const parsedProps = parseObjectInput(propertiesJson, 'propertiesJson');
        if (!parsedProps.ok) {
          return buildResult(parsedProps.message, style, false);
        }

        const entries = Object.entries(parsedProps.value);
        if (entries.length === 0) {
          return buildResult('propertiesJson is empty.', style, false);
        }
        const result = applyLegacyPropertyOperationToMap(map, {
          layerId,
          paint: parsedProps.value,
        });
        return result.success
          ? buildResult(
              `Updated ${entries.length} paint properties for layer "${layerId}".`,
              style
            )
          : buildResult(
              `Failed to batch set paint properties for ${layerId}: ${result.message}`,
              style,
              false
            );
      },
    }),

    batchSetLayerLayoutProperties: tool({
      description:
        'Set multiple layout properties in one call. propertiesJson must be an object of layout-property -> value.',
      inputSchema: z.object({
        layerId: z.string(),
        propertiesJson: z.string().describe('JSON object, e.g. {"text-size":14,"text-font":["Noto Sans Regular"]}'),
      }),
      execute: ({ layerId, propertiesJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (!map.getLayer(layerId)) {
          return missingLayerError(layerId, style);
        }
        const parsedProps = parseObjectInput(propertiesJson, 'propertiesJson');
        if (!parsedProps.ok) {
          return buildResult(parsedProps.message, style, false);
        }

        const entries = Object.entries(parsedProps.value);
        if (entries.length === 0) {
          return buildResult('propertiesJson is empty.', style, false);
        }
        const result = applyLegacyPropertyOperationToMap(map, {
          layerId,
          layout: parsedProps.value,
        });
        return result.success
          ? buildResult(
              `Updated ${entries.length} layout properties for layer "${layerId}".`,
              style
            )
          : buildResult(
              `Failed to batch set layout properties for ${layerId}: ${result.message}`,
              style,
              false
            );
      },
    }),

    clearLayerPaintProperty: tool({
      description: 'Clear a paint property by setting it to null.',
      inputSchema: z.object({
        layerId: z.string(),
        property: z.string(),
      }),
      execute: ({ layerId, property }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (!map.getLayer(layerId)) {
          return missingLayerError(layerId, style);
        }
        const result = applyLegacyPropertyOperationToMap(map, {
          layerId,
          paint: { [property]: null },
        });
        return result.success
          ? buildResult(`Cleared paint property: ${layerId}.${property}`, style)
          : buildResult(
              `Failed to clear paint property ${layerId}.${property}: ${result.message}`,
              style,
              false
            );
      },
    }),

    clearLayerLayoutProperty: tool({
      description:
        'Clear a layout property by setting it to null. Some layout properties may reject null.',
      inputSchema: z.object({
        layerId: z.string(),
        property: z.string(),
      }),
      execute: ({ layerId, property }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (!map.getLayer(layerId)) {
          return missingLayerError(layerId, style);
        }
        const result = applyLegacyPropertyOperationToMap(map, {
          layerId,
          layout: { [property]: null },
        });
        return result.success
          ? buildResult(`Cleared layout property: ${layerId}.${property}`, style)
          : buildResult(
              `Failed to clear layout property ${layerId}.${property}: ${result.message}`,
              style,
              false
            );
      },
    }),

    setLayerFilter: tool({
      description:
        'Set the filter expression for a layer. Use JSON array expression, or null to clear filter.',
      inputSchema: z.object({
        layerId: z.string(),
        filterJson: z
          .string()
          .describe(
            'JSON filter expression or null. Example: ["==", ["get", "class"], "primary"]'
          ),
      }),
      execute: ({ layerId, filterJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (!map.getLayer(layerId)) {
          return missingLayerError(layerId, style);
        }
        const parsedFilter = parseStyleValue(filterJson);
        const result = applyLegacyPropertyOperationToMap(map, {
          layerId,
          filter: parsedFilter,
        });
        return result.success
          ? buildResult(
              `Updated filter: ${layerId}.filter = ${JSON.stringify(parsedFilter)}`,
              style
            )
          : buildResult(
              `Failed to set filter for ${layerId}: ${result.message}`,
              style,
              false
            );
      },
    }),

    setLayerZoomRange: tool({
      description: 'Set minzoom and maxzoom for a layer.',
      inputSchema: z.object({
        layerId: z.string(),
        minzoom: z.number().min(0).max(24),
        maxzoom: z.number().min(0).max(24),
      }),
      execute: ({ layerId, minzoom, maxzoom }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (!map.getLayer(layerId)) {
          return missingLayerError(layerId, style);
        }
        if (minzoom > maxzoom) {
          return buildResult('minzoom must be less than or equal to maxzoom.', style, false);
        }
        const result = applyLegacyPropertyOperationToMap(map, {
          layerId,
          minzoom,
          maxzoom,
        });
        return result.success
          ? buildResult(
              `Updated zoom range: ${layerId} minzoom=${minzoom}, maxzoom=${maxzoom}`,
              style
            )
          : buildResult(
              `Failed to set zoom range for ${layerId}: ${result.message}`,
              style,
              false
            );
      },
    }),

    setLayerVisibility: tool({
      description: 'Set layer visibility to visible or none.',
      inputSchema: z.object({
        layerId: z.string(),
        visibility: z.enum(['visible', 'none']),
      }),
      execute: ({ layerId, visibility }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (!map.getLayer(layerId)) {
          return missingLayerError(layerId, style);
        }
        const result = applyLegacyPropertyOperationToMap(map, {
          layerId,
          layout: { visibility },
        });
        return result.success
          ? buildResult(`Layer ${layerId} visibility set to ${visibility}.`, style)
          : buildResult(
              `Failed to set visibility for ${layerId}: ${result.message}`,
              style,
              false
            );
      },
    }),

    addLayer: tool({
      description:
        'Add a new style layer. layerJson must be a full layer object (id/type/source/...); optional beforeId controls z-order.',
      inputSchema: z.object({
        layerJson: z.string().describe('Full JSON layer object'),
        beforeId: z.string().optional(),
      }),
      execute: ({ layerJson, beforeId }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        if (beforeId && !map.getLayer(beforeId)) {
          return missingLayerError(beforeId, style);
        }

        const parsedLayer = parseObjectInput(layerJson, 'layerJson');
        if (!parsedLayer.ok) {
          return buildResult(parsedLayer.message, style, false);
        }

        const layerId = parsedLayer.value.id;
        if (typeof layerId !== 'string' || layerId.length === 0) {
          return buildResult('layerJson.id must be a non-empty string.', style, false);
        }
        if (map.getLayer(layerId)) {
          return buildResult(`Layer "${layerId}" already exists.`, style, false);
        }

        try {
          map.addLayer(parsedLayer.value as never, beforeId);
          return buildResult(
            `Added layer "${layerId}"${beforeId ? ` before "${beforeId}"` : ''}.`,
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to add layer "${layerId}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    moveLayer: tool({
      description: 'Move an existing layer before another layer. Omit beforeId to move to top.',
      inputSchema: z.object({
        layerId: z.string(),
        beforeId: z.string().optional(),
      }),
      execute: ({ layerId, beforeId }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (!map.getLayer(layerId)) {
          return missingLayerError(layerId, style);
        }
        if (beforeId && !map.getLayer(beforeId)) {
          return missingLayerError(beforeId, style);
        }
        if (beforeId && beforeId === layerId) {
          return buildResult('beforeId cannot be the same as layerId.', style, false);
        }

        try {
          map.moveLayer(layerId, beforeId);
          return buildResult(
            `Moved layer "${layerId}"${beforeId ? ` before "${beforeId}"` : ' to top'}.`,
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to move layer "${layerId}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    removeLayer: tool({
      description: 'Remove an existing layer by id.',
      inputSchema: z.object({
        layerId: z.string(),
      }),
      execute: ({ layerId }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (!map.getLayer(layerId)) {
          return missingLayerError(layerId, style);
        }

        try {
          map.removeLayer(layerId);
          return buildResult(`Removed layer "${layerId}".`, style);
        } catch (error) {
          return buildResult(
            `Failed to remove layer "${layerId}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    patchLayerDefinition: tool({
      description:
        'Patch an existing layer definition (deep merge). Supports paint/layout/filter/metadata/minzoom/maxzoom/etc.',
      inputSchema: z.object({
        layerId: z.string(),
        patchJson: z.string().describe('JSON object patch'),
        diff: z.boolean().default(true),
      }),
      execute: ({ layerId, patchJson, diff }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (!map.getLayer(layerId)) {
          return missingLayerError(layerId, style);
        }

        const parsedPatch = parseObjectInput(patchJson, 'patchJson');
        if (!parsedPatch.ok) {
          return buildResult(parsedPatch.message, style, false);
        }
        if (
          typeof parsedPatch.value.id === 'string' &&
          parsedPatch.value.id !== layerId &&
          map.getLayer(parsedPatch.value.id)
        ) {
          return buildResult(
            `Layer id "${parsedPatch.value.id}" already exists. Cannot patch layer id to duplicate.`,
            style,
            false
          );
        }

        const clonedStyle = cloneCurrentStyle(map);
        if (!clonedStyle.ok) {
          return buildResult(clonedStyle.message, style, false);
        }

        const layersValue = clonedStyle.style.layers;
        if (!isJsonArray(layersValue)) {
          return buildResult('Current style has no valid layers array.', style, false);
        }

        const layerIndex = layersValue.findIndex(
          (layer) => isRecord(layer) && layer.id === layerId
        );
        if (layerIndex < 0) {
          return missingLayerError(layerId, style);
        }

        const existingLayer = layersValue[layerIndex];
        if (!isRecord(existingLayer)) {
          return buildResult(`Layer "${layerId}" is not a JSON object.`, style, false);
        }

        layersValue[layerIndex] = mergeObjects(existingLayer, parsedPatch.value);

        try {
          map.setStyle(clonedStyle.style as never, { diff } as never);
          return buildResult(`Patched layer definition "${layerId}" (diff=${diff}).`, style);
        } catch (error) {
          return buildResult(
            `Failed to patch layer "${layerId}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    replaceLayerDefinition: tool({
      description:
        'Replace an existing layer definition with layerJson, then apply via setStyle.',
      inputSchema: z.object({
        layerId: z.string(),
        layerJson: z.string().describe('Full JSON layer object'),
        diff: z.boolean().default(true),
      }),
      execute: ({ layerId, layerJson, diff }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (!map.getLayer(layerId)) {
          return missingLayerError(layerId, style);
        }

        const parsedLayer = parseObjectInput(layerJson, 'layerJson');
        if (!parsedLayer.ok) {
          return buildResult(parsedLayer.message, style, false);
        }
        const nextLayerId = parsedLayer.value.id;
        if (typeof nextLayerId !== 'string' || nextLayerId.length === 0) {
          return buildResult('layerJson.id must be a non-empty string.', style, false);
        }
        if (nextLayerId !== layerId && map.getLayer(nextLayerId)) {
          return buildResult(`Layer "${nextLayerId}" already exists.`, style, false);
        }

        const clonedStyle = cloneCurrentStyle(map);
        if (!clonedStyle.ok) {
          return buildResult(clonedStyle.message, style, false);
        }

        const layersValue = clonedStyle.style.layers;
        if (!isJsonArray(layersValue)) {
          return buildResult('Current style has no valid layers array.', style, false);
        }

        const layerIndex = layersValue.findIndex(
          (layer) => isRecord(layer) && layer.id === layerId
        );
        if (layerIndex < 0) {
          return missingLayerError(layerId, style);
        }

        layersValue[layerIndex] = parsedLayer.value;
        try {
          map.setStyle(clonedStyle.style as never, { diff } as never);
          return buildResult(
            `Replaced layer definition "${layerId}" with "${nextLayerId}" (diff=${diff}).`,
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to replace layer "${layerId}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    addSource: tool({
      description:
        'Add a new source by id. sourceJson must be a valid source definition object.',
      inputSchema: z.object({
        sourceId: z.string(),
        sourceJson: z.string().describe('Full JSON source object'),
      }),
      execute: ({ sourceId, sourceJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (map.getSource(sourceId)) {
          return buildResult(`Source "${sourceId}" already exists.`, style, false);
        }

        const parsedSource = parseObjectInput(sourceJson, 'sourceJson');
        if (!parsedSource.ok) {
          return buildResult(parsedSource.message, style, false);
        }

        try {
          map.addSource(sourceId, parsedSource.value as never);
          return buildResult(`Added source "${sourceId}".`, style);
        } catch (error) {
          return buildResult(
            `Failed to add source "${sourceId}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    removeSource: tool({
      description:
        'Remove a source by id. Source must not be referenced by any remaining layer.',
      inputSchema: z.object({
        sourceId: z.string(),
      }),
      execute: ({ sourceId }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (!map.getSource(sourceId)) {
          return missingSourceError(sourceId, style);
        }

        const dependentLayers = (map.getStyle()?.layers ?? []).filter(
          (layer) => 'source' in layer && layer.source === sourceId
        );
        if (dependentLayers.length > 0) {
          return buildResult(
            `Source "${sourceId}" is still used by layers: ${dependentLayers
              .map((layer) => layer.id)
              .join(', ')}. Remove or update those layers first.`,
            style,
            false
          );
        }

        try {
          map.removeSource(sourceId);
          return buildResult(`Removed source "${sourceId}".`, style);
        } catch (error) {
          return buildResult(
            `Failed to remove source "${sourceId}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    updateGeoJsonSourceData: tool({
      description:
        'Update data of a GeoJSON source via setData/updateData. dataJson can be URL string or inline GeoJSON object.',
      inputSchema: z.object({
        sourceId: z.string(),
        dataJson: z.string(),
        method: z.enum(['setData', 'updateData']).default('setData'),
      }),
      execute: async ({ sourceId, dataJson, method }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const source = map.getSource(sourceId) as
          | {
              setData?: (data: unknown) => void | Promise<void>;
              updateData?: (data: unknown) => void | Promise<void>;
            }
          | undefined;
        if (!source) {
          return missingSourceError(sourceId, style);
        }

        const data = parseStyleValue(dataJson);
        try {
          if (method === 'updateData' && typeof source.updateData === 'function') {
            await Promise.resolve(source.updateData(data));
            return buildResult(`Updated GeoJSON source "${sourceId}" via updateData.`, style);
          }
          if (typeof source.setData === 'function') {
            await Promise.resolve(source.setData(data));
            return buildResult(`Updated GeoJSON source "${sourceId}" via setData.`, style);
          }

          return buildResult(
            `Source "${sourceId}" does not support setData/updateData (likely not geojson).`,
            style,
            false
          );
        } catch (error) {
          return buildResult(
            `Failed to update source "${sourceId}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    setGeoJsonClusterOptions: tool({
      description:
        'Set clustering options on an existing GeoJSON source via setClusterOptions.',
      inputSchema: z.object({
        sourceId: z.string(),
        optionsJson: z.string().describe('JSON object for GeoJSON cluster options'),
      }),
      execute: ({ sourceId, optionsJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const source = map.getSource(sourceId) as
          | {
              setClusterOptions?: (options: unknown) => void;
            }
          | undefined;
        if (!source) {
          return missingSourceError(sourceId, style);
        }

        const parsedOptions = parseObjectInput(optionsJson, 'optionsJson');
        if (!parsedOptions.ok) {
          return buildResult(parsedOptions.message, style, false);
        }

        if (typeof source.setClusterOptions !== 'function') {
          return buildResult(
            `Source "${sourceId}" does not support setClusterOptions (likely not geojson).`,
            style,
            false
          );
        }

        try {
          source.setClusterOptions(parsedOptions.value);
          return buildResult(`Updated cluster options for source "${sourceId}".`, style);
        } catch (error) {
          return buildResult(
            `Failed to set cluster options for "${sourceId}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    setSourceTileLodParams: tool({
      description:
        'Adjust source tile LOD behavior for pitched views. If sourceId is omitted, applies to all sources.',
      inputSchema: z.object({
        maxZoomLevelsOnScreen: z.number().positive(),
        tileCountMaxMinRatio: z.number().positive(),
        sourceId: z.string().optional(),
      }),
      execute: ({ maxZoomLevelsOnScreen, tileCountMaxMinRatio, sourceId }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        if (sourceId && !map.getSource(sourceId)) {
          return missingSourceError(sourceId, style);
        }

        try {
          map.setSourceTileLodParams(
            maxZoomLevelsOnScreen,
            tileCountMaxMinRatio,
            sourceId
          );
          return buildResult(
            `Updated source tile LOD params (maxZoomLevelsOnScreen=${maxZoomLevelsOnScreen}, tileCountMaxMinRatio=${tileCountMaxMinRatio}${sourceId ? `, sourceId=${sourceId}` : ''}).`,
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to set source tile LOD params: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    patchSourceDefinition: tool({
      description:
        'Patch an existing source definition by deep-merging patchJson into style.sources[sourceId], then apply via setStyle.',
      inputSchema: z.object({
        sourceId: z.string(),
        patchJson: z.string().describe('JSON object patch'),
        diff: z.boolean().default(true),
      }),
      execute: ({ sourceId, patchJson, diff }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const parsedPatch = parseObjectInput(patchJson, 'patchJson');
        if (!parsedPatch.ok) {
          return buildResult(parsedPatch.message, style, false);
        }

        const clonedStyle = cloneCurrentStyle(map);
        if (!clonedStyle.ok) {
          return buildResult(clonedStyle.message, style, false);
        }

        const sources = clonedStyle.style.sources;
        if (!isRecord(sources)) {
          return buildResult('Current style has no valid sources object.', style, false);
        }
        if (!isRecord(sources[sourceId])) {
          return missingSourceError(sourceId, style);
        }

        sources[sourceId] = mergeObjects(sources[sourceId] as JsonObject, parsedPatch.value);
        try {
          map.setStyle(clonedStyle.style as never, { diff } as never);
          return buildResult(
            `Patched source definition "${sourceId}" (diff=${diff}).`,
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to patch source "${sourceId}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    replaceSourceDefinition: tool({
      description:
        'Replace an existing source definition with sourceJson, then apply via setStyle.',
      inputSchema: z.object({
        sourceId: z.string(),
        sourceJson: z.string().describe('Full JSON source object'),
        diff: z.boolean().default(true),
      }),
      execute: ({ sourceId, sourceJson, diff }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const parsedSource = parseObjectInput(sourceJson, 'sourceJson');
        if (!parsedSource.ok) {
          return buildResult(parsedSource.message, style, false);
        }

        const clonedStyle = cloneCurrentStyle(map);
        if (!clonedStyle.ok) {
          return buildResult(clonedStyle.message, style, false);
        }

        const sources = clonedStyle.style.sources;
        if (!isRecord(sources)) {
          return buildResult('Current style has no valid sources object.', style, false);
        }
        if (!isRecord(sources[sourceId])) {
          return missingSourceError(sourceId, style);
        }

        sources[sourceId] = parsedSource.value;
        try {
          map.setStyle(clonedStyle.style as never, { diff } as never);
          return buildResult(
            `Replaced source definition "${sourceId}" (diff=${diff}).`,
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to replace source "${sourceId}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    setStyleJsonOrUrl: tool({
      description:
        'Set a full map style via URL string or full style JSON object. diff=true applies style diff when possible.',
      inputSchema: z.object({
        styleJsonOrUrl: z
          .string()
          .describe('Either style URL, or full style JSON object string'),
        diff: z.boolean().default(true),
      }),
      execute: ({ styleJsonOrUrl, diff }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const parsed = parseStyleValue(styleJsonOrUrl);
        const nextStyle = typeof parsed === 'string' ? parsed.trim() : parsed;

        if (typeof nextStyle === 'string' && nextStyle.length === 0) {
          return buildResult('styleJsonOrUrl cannot be empty.', style, false);
        }
        if (!(typeof nextStyle === 'string' || isRecord(nextStyle))) {
          return buildResult(
            'styleJsonOrUrl must be a URL string or full JSON style object.',
            style,
            false
          );
        }

        try {
          map.setStyle(nextStyle as never, { diff } as never);
          return buildResult(
            `Style update requested via ${typeof nextStyle === 'string' ? 'URL' : 'JSON object'} (diff=${diff}).`,
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to set style: ${error instanceof Error ? error.message : 'Unknown error'}`,
            style,
            false
          );
        }
      },
    }),

    inspectRootStyle: tool({
      description:
        'Inspect root-level style fields such as name, metadata, transition, camera defaults, sprite, glyphs, projection, terrain, light and sky.',
      inputSchema: z.object({}),
      execute: () => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const currentStyle = map.getStyle();
        if (!isRecord(currentStyle)) {
          return buildResult('Current map style is unavailable.', style, false);
        }

        const summary = {
          name: currentStyle.name,
          metadata: currentStyle.metadata,
          transition: currentStyle.transition,
          center: currentStyle.center,
          zoom: currentStyle.zoom,
          bearing: currentStyle.bearing,
          pitch: currentStyle.pitch,
          roll: currentStyle.roll,
          centerAltitude: currentStyle.centerAltitude,
          sprite: currentStyle.sprite,
          glyphs: currentStyle.glyphs,
          projection: currentStyle.projection,
          terrain: currentStyle.terrain,
          light: currentStyle.light,
          sky: currentStyle.sky,
          state: currentStyle.state,
          layerCount: Array.isArray(currentStyle.layers) ? currentStyle.layers.length : 0,
          sourceCount: isRecord(currentStyle.sources)
            ? Object.keys(currentStyle.sources).length
            : 0,
        };

        return buildResult(`Root style summary:\n${JSON.stringify(summary, null, 2)}`, style);
      },
    }),

    setStyleName: tool({
      description: 'Set root style name via style diff update.',
      inputSchema: z.object({
        name: z.string(),
        diff: z.boolean().default(true),
      }),
      execute: ({ name, diff }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const clonedStyle = cloneCurrentStyle(map);
        if (!clonedStyle.ok) {
          return buildResult(clonedStyle.message, style, false);
        }
        clonedStyle.style.name = name;

        try {
          map.setStyle(clonedStyle.style as never, { diff } as never);
          return buildResult(`Updated style name to "${name}" (diff=${diff}).`, style);
        } catch (error) {
          return buildResult(
            `Failed to set style name: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    setStyleMetadata: tool({
      description: 'Set root style metadata object, or null to clear metadata.',
      inputSchema: z.object({
        metadataJson: z.string().describe('JSON object or null'),
        diff: z.boolean().default(true),
      }),
      execute: ({ metadataJson, diff }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const parsedMetadata = parseStyleValue(metadataJson);
        if (parsedMetadata !== null && !isRecord(parsedMetadata)) {
          return buildResult('metadataJson must be a JSON object or null.', style, false);
        }

        const clonedStyle = cloneCurrentStyle(map);
        if (!clonedStyle.ok) {
          return buildResult(clonedStyle.message, style, false);
        }
        if (parsedMetadata === null) {
          delete clonedStyle.style.metadata;
        } else {
          clonedStyle.style.metadata = parsedMetadata;
        }

        try {
          map.setStyle(clonedStyle.style as never, { diff } as never);
          return buildResult(
            parsedMetadata === null
              ? `Cleared style metadata (diff=${diff}).`
              : `Updated style metadata (diff=${diff}).`,
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to set style metadata: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    setStyleTransition: tool({
      description:
        'Set root transition object, or null to clear transition defaults.',
      inputSchema: z.object({
        transitionJson: z.string().describe('JSON object or null'),
        diff: z.boolean().default(true),
      }),
      execute: ({ transitionJson, diff }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const parsedTransition = parseStyleValue(transitionJson);
        if (parsedTransition !== null && !isRecord(parsedTransition)) {
          return buildResult('transitionJson must be a JSON object or null.', style, false);
        }

        const clonedStyle = cloneCurrentStyle(map);
        if (!clonedStyle.ok) {
          return buildResult(clonedStyle.message, style, false);
        }
        if (parsedTransition === null) {
          delete clonedStyle.style.transition;
        } else {
          clonedStyle.style.transition = parsedTransition;
        }

        try {
          map.setStyle(clonedStyle.style as never, { diff } as never);
          return buildResult(
            parsedTransition === null
              ? `Cleared style transition (diff=${diff}).`
              : `Updated style transition (diff=${diff}).`,
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to set style transition: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    setStyleCameraDefaults: tool({
      description:
        'Set root camera defaults (center/zoom/bearing/pitch/roll/centerAltitude) in the style JSON.',
      inputSchema: z.object({
        centerJson: z.string().optional().describe('JSON array [lng, lat]'),
        zoom: z.number().optional(),
        bearing: z.number().optional(),
        pitch: z.number().optional(),
        roll: z.number().optional(),
        centerAltitude: z.number().optional(),
        diff: z.boolean().default(true),
      }),
      execute: ({ centerJson, zoom, bearing, pitch, roll, centerAltitude, diff }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const hasAny =
          centerJson !== undefined ||
          zoom !== undefined ||
          bearing !== undefined ||
          pitch !== undefined ||
          roll !== undefined ||
          centerAltitude !== undefined;
        if (!hasAny) {
          return buildResult(
            'At least one camera field must be provided.',
            style,
            false
          );
        }

        let parsedCenter: unknown[] | undefined;
        if (centerJson !== undefined) {
          const centerValue = parseStyleValue(centerJson);
          if (
            !isJsonArray(centerValue) ||
            centerValue.length !== 2 ||
            typeof centerValue[0] !== 'number' ||
            typeof centerValue[1] !== 'number'
          ) {
            return buildResult('centerJson must be a JSON array [lng, lat].', style, false);
          }
          parsedCenter = centerValue;
        }

        const clonedStyle = cloneCurrentStyle(map);
        if (!clonedStyle.ok) {
          return buildResult(clonedStyle.message, style, false);
        }

        if (parsedCenter) clonedStyle.style.center = parsedCenter;
        if (zoom !== undefined) clonedStyle.style.zoom = zoom;
        if (bearing !== undefined) clonedStyle.style.bearing = bearing;
        if (pitch !== undefined) clonedStyle.style.pitch = pitch;
        if (roll !== undefined) clonedStyle.style.roll = roll;
        if (centerAltitude !== undefined) clonedStyle.style.centerAltitude = centerAltitude;

        try {
          map.setStyle(clonedStyle.style as never, { diff } as never);
          return buildResult('Updated style camera defaults.', style);
        } catch (error) {
          return buildResult(
            `Failed to set style camera defaults: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    validateStyleJson: tool({
      description:
        'Validate a full style JSON object against MapLibre style spec without applying it to the map.',
      inputSchema: z.object({
        styleJson: z.string().describe('Full style JSON object string'),
      }),
      execute: ({ styleJson }) => {
        const style = readState();
        const parsedStyle = parseObjectInput(styleJson, 'styleJson');
        if (!parsedStyle.ok) {
          return buildResult(parsedStyle.message, style, false);
        }

        const validation = validateStyleDocument(parsedStyle.value);
        if (validation.ok) {
          return buildResult('Style JSON validation passed (0 errors).', style);
        }

        return buildResult(
          `Style JSON validation failed (${validation.errors.length} errors):\n${validation.errors
            .slice(0, 20)
            .map(
              (error, index) =>
                `${index + 1}. ${error.path || '<root>'}: ${error.message}`
            )
            .join('\n')}`,
          style,
          false
        );
      },
    }),

    validateCurrentMapStyle: tool({
      description:
        'Validate the currently loaded map style against MapLibre style spec.',
      inputSchema: z.object({}),
      execute: () => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        try {
          const currentStyle = map.getStyle();
          if (!currentStyle || !isRecord(currentStyle)) {
            return buildResult(
              'Current map style is unavailable.',
              style,
              false
            );
          }

          const validation = validateStyleDocument(currentStyle);
          if (validation.ok) {
            return buildResult(
              'Current map style validation passed (0 errors).',
              style
            );
          }

          return buildResult(
            `Current map style validation failed (${validation.errors.length} errors):\n${validation.errors
              .slice(0, 20)
              .map(
                (error, index) =>
                  `${index + 1}. ${error.path || '<root>'}: ${error.message}`
              )
              .join('\n')}`,
            style,
            false
          );
        } catch (error) {
          return buildResult(
            `Current style validation failed unexpectedly: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    setMapLight: tool({
      description: 'Set root light specification using a full JSON object.',
      inputSchema: z.object({
        lightJson: z.string().describe('JSON object for light spec'),
      }),
      execute: ({ lightJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const parsedLight = parseObjectInput(lightJson, 'lightJson');
        if (!parsedLight.ok) {
          return buildResult(parsedLight.message, style, false);
        }

        try {
          map.setLight(parsedLight.value as never);
          return buildResult('Updated map light specification.', style);
        } catch (error) {
          return buildResult(
            `Failed to set light: ${error instanceof Error ? error.message : 'Unknown error'}`,
            style,
            false
          );
        }
      },
    }),

    setMapSky: tool({
      description:
        'Set root sky specification using JSON object. Use null to clear sky where supported.',
      inputSchema: z.object({
        skyJson: z.string().describe('JSON object for sky spec, or null'),
      }),
      execute: ({ skyJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const parsedSky = parseStyleValue(skyJson);
        if (parsedSky !== null && !isRecord(parsedSky)) {
          return buildResult('skyJson must be a JSON object or null.', style, false);
        }

        try {
          map.setSky(parsedSky as never);
          return buildResult(
            parsedSky === null ? 'Cleared map sky specification.' : 'Updated map sky specification.',
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to set sky: ${error instanceof Error ? error.message : 'Unknown error'}`,
            style,
            false
          );
        }
      },
    }),

    setMapProjection: tool({
      description: 'Set root projection specification.',
      inputSchema: z.object({
        projectionJson: z.string().describe('JSON projection object'),
      }),
      execute: ({ projectionJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const parsedProjection = parseStyleValue(projectionJson);
        if (!isRecord(parsedProjection)) {
          return buildResult('projectionJson must be a JSON object.', style, false);
        }

        try {
          map.setProjection(parsedProjection as never);
          return buildResult('Updated map projection specification.', style);
        } catch (error) {
          return buildResult(
            `Failed to set projection: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    setMapTerrain: tool({
      description:
        'Set root terrain specification using JSON object. Use null to disable terrain.',
      inputSchema: z.object({
        terrainJson: z.string().describe('JSON object for terrain spec, or null'),
      }),
      execute: ({ terrainJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const parsedTerrain = parseStyleValue(terrainJson);
        if (parsedTerrain !== null && !isRecord(parsedTerrain)) {
          return buildResult('terrainJson must be a JSON object or null.', style, false);
        }

        try {
          map.setTerrain(parsedTerrain as never);
          return buildResult(
            parsedTerrain === null
              ? 'Terrain disabled.'
              : 'Updated map terrain specification.',
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to set terrain: ${error instanceof Error ? error.message : 'Unknown error'}`,
            style,
            false
          );
        }
      },
    }),

    setMapGlyphs: tool({
      description: 'Set root glyphs URL. Use null to unset glyphs.',
      inputSchema: z.object({
        glyphsUrlJson: z.string().describe('JSON string URL or null'),
      }),
      execute: ({ glyphsUrlJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const parsedGlyphs = parseStyleValue(glyphsUrlJson);
        if (!(typeof parsedGlyphs === 'string' || parsedGlyphs === null)) {
          return buildResult('glyphsUrlJson must be a JSON string or null.', style, false);
        }

        try {
          map.setGlyphs(parsedGlyphs);
          return buildResult(
            parsedGlyphs === null ? 'Glyphs unset.' : `Updated glyphs URL to "${parsedGlyphs}".`,
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to set glyphs: ${error instanceof Error ? error.message : 'Unknown error'}`,
            style,
            false
          );
        }
      },
    }),

    setMapSprite: tool({
      description: 'Set root sprite URL. Use null to unset sprite.',
      inputSchema: z.object({
        spriteUrlJson: z.string().describe('JSON string URL or null'),
      }),
      execute: ({ spriteUrlJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const parsedSprite = parseStyleValue(spriteUrlJson);
        if (!(typeof parsedSprite === 'string' || parsedSprite === null)) {
          return buildResult('spriteUrlJson must be a JSON string or null.', style, false);
        }

        try {
          map.setSprite(parsedSprite);
          return buildResult(
            parsedSprite === null ? 'Sprite unset.' : `Updated sprite URL to "${parsedSprite}".`,
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to set sprite: ${error instanceof Error ? error.message : 'Unknown error'}`,
            style,
            false
          );
        }
      },
    }),

    listSprites: tool({
      description: 'List all sprite definitions currently set in style root.',
      inputSchema: z.object({}),
      execute: () => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        try {
          const sprites = map.getSprite();
          if (!Array.isArray(sprites) || sprites.length === 0) {
            return buildResult('No sprites configured in current style.', style, false);
          }

          const summary = sprites
            .map((sprite, index) => `${index + 1}. ${sprite.id}: ${sprite.url}`)
            .join('\n');
          return buildResult(`Configured sprites (${sprites.length}):\n${summary}`, style);
        } catch (error) {
          return buildResult(
            `Failed to list sprites: ${error instanceof Error ? error.message : 'Unknown error'}`,
            style,
            false
          );
        }
      },
    }),

    addSprite: tool({
      description:
        'Add a sprite definition to the style root. Use overwrite=true to replace an existing sprite id.',
      inputSchema: z.object({
        spriteId: z.string(),
        url: z.string().url(),
        overwrite: z.boolean().default(false),
      }),
      execute: ({ spriteId, url, overwrite }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        try {
          const sprites = map.getSprite();
          const exists = sprites.some((sprite) => sprite.id === spriteId);
          if (exists && !overwrite) {
            return buildResult(
              `Sprite "${spriteId}" already exists. Set overwrite=true to replace it.`,
              style,
              false
            );
          }

          if (exists) {
            map.removeSprite(spriteId);
          }
          map.addSprite(spriteId, url);
          return buildResult(
            `${exists ? 'Replaced' : 'Added'} sprite "${spriteId}" -> ${url}`,
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to add sprite "${spriteId}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    removeSprite: tool({
      description: 'Remove a sprite definition by sprite id.',
      inputSchema: z.object({
        spriteId: z.string(),
      }),
      execute: ({ spriteId }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        try {
          const sprites = map.getSprite();
          const exists = sprites.some((sprite) => sprite.id === spriteId);
          if (!exists) {
            return buildResult(`Sprite "${spriteId}" not found.`, style, false);
          }

          map.removeSprite(spriteId);
          return buildResult(`Removed sprite "${spriteId}".`, style);
        } catch (error) {
          return buildResult(
            `Failed to remove sprite "${spriteId}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    setFeatureState: tool({
      description:
        'Set feature-state for a specific feature identifier target. targetJson must include source/sourceLayer/id as needed.',
      inputSchema: z.object({
        targetJson: z.string().describe('Feature identifier JSON object'),
        stateJson: z.string().describe('State JSON object to merge'),
      }),
      execute: ({ targetJson, stateJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const parsedTarget = parseObjectInput(targetJson, 'targetJson');
        if (!parsedTarget.ok) {
          return buildResult(parsedTarget.message, style, false);
        }
        const parsedState = parseObjectInput(stateJson, 'stateJson');
        if (!parsedState.ok) {
          return buildResult(parsedState.message, style, false);
        }

        try {
          map.setFeatureState(parsedTarget.value as never, parsedState.value);
          return buildResult('Updated feature-state.', style);
        } catch (error) {
          return buildResult(
            `Failed to set feature-state: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    removeFeatureState: tool({
      description:
        'Remove feature-state by feature target; optionally provide a key to remove only one state key.',
      inputSchema: z.object({
        targetJson: z.string().describe('Feature identifier JSON object'),
        key: z.string().optional(),
      }),
      execute: ({ targetJson, key }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const parsedTarget = parseObjectInput(targetJson, 'targetJson');
        if (!parsedTarget.ok) {
          return buildResult(parsedTarget.message, style, false);
        }

        try {
          map.removeFeatureState(parsedTarget.value as never, key);
          return buildResult(
            key
              ? `Removed feature-state key "${key}".`
              : 'Removed feature-state object.',
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to remove feature-state: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    setGlobalStateProperty: tool({
      description:
        'Set root global state property for use in global-state expressions.',
      inputSchema: z.object({
        propertyName: z.string(),
        valueJson: z.string().describe('JSON value for global state'),
      }),
      execute: ({ propertyName, valueJson }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const parsedValue = parseStyleValue(valueJson);
        try {
          map.setGlobalStateProperty(propertyName, parsedValue);
          return buildResult(
            `Updated global state: ${propertyName} = ${JSON.stringify(parsedValue)}`,
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to set global state "${propertyName}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    listImages: tool({
      description: 'List all currently available style image IDs.',
      inputSchema: z.object({
        limit: z.number().min(1).max(500).default(300),
      }),
      execute: ({ limit }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const images = map.listImages();
        if (images.length === 0) {
          return buildResult('No style images found.', style, false);
        }

        const summary = images
          .slice(0, limit)
          .map((id, index) => `${index + 1}. ${id}`)
          .join('\n');

        return buildResult(
          `Loaded style images (${images.length} total):\n${summary}`,
          style
        );
      },
    }),

    addImageFromUrl: tool({
      description:
        'Load an image from URL and add it to style sprite images by imageId. If overwrite=true and image exists, update it.',
      inputSchema: z.object({
        imageId: z.string(),
        url: z.string().url(),
        overwrite: z.boolean().default(false),
      }),
      execute: async ({ imageId, url, overwrite }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        if (map.hasImage(imageId) && !overwrite) {
          return buildResult(
            `Image "${imageId}" already exists. Set overwrite=true to replace it.`,
            style,
            false
          );
        }

        try {
          const imageResponse = await map.loadImage(url);
          if (map.hasImage(imageId)) {
            map.updateImage(imageId, imageResponse.data);
            return buildResult(`Updated existing image "${imageId}" from URL.`, style);
          }

          map.addImage(imageId, imageResponse.data);
          return buildResult(`Added image "${imageId}" from URL.`, style);
        } catch (error) {
          return buildResult(
            `Failed to add/update image "${imageId}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    removeImage: tool({
      description: 'Remove a style image by id.',
      inputSchema: z.object({
        imageId: z.string(),
      }),
      execute: ({ imageId }) => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }
        if (!map.hasImage(imageId)) {
          return buildResult(`Image "${imageId}" not found in current style.`, style, false);
        }

        try {
          map.removeImage(imageId);
          return buildResult(`Removed image "${imageId}".`, style);
        } catch (error) {
          return buildResult(
            `Failed to remove image "${imageId}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
      },
    }),

    getLayerCount: tool({
      description: 'Return number of layers currently loaded in map style.',
      inputSchema: z.object({}),
      execute: () => {
        const style = readState();
        const map = getMap();
        if (!map) {
          return mapReadyError(style);
        }

        const count = getLayerIds(map).length;
        return buildResult(`Current loaded layer count: ${count}`, style);
      },
    }),
  };
};
