import { tool } from 'ai';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { z } from 'zod';

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

const parseStyleValue = (rawValue: string): unknown => {
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
};

const getLayerIds = (map: MapLibreMap): string[] => {
  const style = map.getStyle();
  const layers = style?.layers ?? [];
  return layers.map((layer) => layer.id);
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

        try {
          map.setPaintProperty(layerId, property, parsedValue);
          return buildResult(
            `Updated paint property: ${layerId}.${property} = ${JSON.stringify(parsedValue)}`,
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to set paint property ${layerId}.${property}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
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

        try {
          map.setLayoutProperty(layerId, property, parsedValue);
          return buildResult(
            `Updated layout property: ${layerId}.${property} = ${JSON.stringify(parsedValue)}`,
            style
          );
        } catch (error) {
          return buildResult(
            `Failed to set layout property ${layerId}.${property}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            style,
            false
          );
        }
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

        try {
          map.setLayoutProperty(layerId, 'visibility', visibility);
          return buildResult(`Layer ${layerId} visibility set to ${visibility}.`, style);
        } catch (error) {
          return buildResult(
            `Failed to set visibility for ${layerId}: ${
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
