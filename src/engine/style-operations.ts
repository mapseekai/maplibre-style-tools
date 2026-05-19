import type {
  JsonObject,
  StyleDiffEntry,
  StyleDocument,
  StyleLayer,
  StyleOperation,
  StyleOperationResult,
} from '../types.js';

const layerTypePropertyPrefixes: Record<
  string,
  { paint: string[]; layout: string[] }
> = {
  background: { paint: ['background-'], layout: ['visibility'] },
  fill: { paint: ['fill-'], layout: ['visibility'] },
  line: { paint: ['line-'], layout: ['visibility', 'line-'] },
  symbol: {
    paint: ['icon-', 'text-'],
    layout: ['visibility', 'icon-', 'text-', 'symbol-'],
  },
  circle: { paint: ['circle-'], layout: ['visibility'] },
  heatmap: { paint: ['heatmap-'], layout: ['visibility'] },
  'fill-extrusion': { paint: ['fill-extrusion-'], layout: ['visibility'] },
  raster: { paint: ['raster-'], layout: ['visibility'] },
  hillshade: { paint: ['hillshade-'], layout: ['visibility'] },
  'color-relief': { paint: ['color-relief-'], layout: ['visibility'] },
};

const cloneStyle = (style: StyleDocument): StyleDocument =>
  JSON.parse(JSON.stringify(style)) as StyleDocument;

const isPropertyAllowed = (
  layerType: string,
  property: string,
  mode: 'paint' | 'layout'
): boolean => {
  const prefixes = layerTypePropertyPrefixes[layerType]?.[mode];
  if (!prefixes) {
    return true;
  }
  return prefixes.some((prefix) =>
    prefix.endsWith('-') ? property.startsWith(prefix) : property === prefix
  );
};

const findLayer = (
  style: StyleDocument,
  layerId: string
): StyleLayer | undefined => style.layers?.find((layer) => layer.id === layerId);

const validateProperties = (
  layer: StyleLayer,
  properties: JsonObject | undefined,
  mode: 'paint' | 'layout'
): string[] => {
  if (!properties) {
    return [];
  }

  return Object.keys(properties).filter(
    (property) => !isPropertyAllowed(layer.type, property, mode)
  );
};

const applyObjectPatch = (
  layer: StyleLayer,
  layerId: string,
  targetKey: 'paint' | 'layout',
  patch: JsonObject | undefined,
  diffSummary: StyleDiffEntry[]
) => {
  if (!patch) {
    return;
  }

  const target = { ...(layer[targetKey] ?? {}) };
  for (const [property, value] of Object.entries(patch)) {
    const before = target[property];
    if (Object.is(before, value)) {
      continue;
    }
    target[property] = value;
    diffSummary.push({
      path: `layers.${layerId}.${targetKey}.${property}`,
      before,
      after: value,
    });
  }
  layer[targetKey] = target;
};

export const applyStyleOperations = (
  style: StyleDocument,
  operations: StyleOperation[]
): StyleOperationResult => {
  const nextStyle = cloneStyle(style);
  const changedLayerIds = new Set<string>();
  const diffSummary: StyleDiffEntry[] = [];

  for (const operation of operations) {
    const layer = findLayer(nextStyle, operation.layerId);
    if (!layer) {
      return {
        success: false,
        message: `Layer "${operation.layerId}" not found.`,
        style,
        changedLayers: [],
        diffSummary: [],
      };
    }

    const invalidPaint = validateProperties(layer, operation.paint, 'paint');
    if (invalidPaint.length > 0) {
      return {
        success: false,
        message: `Invalid paint properties for ${layer.type} layer "${operation.layerId}": ${invalidPaint.join(', ')}`,
        style,
        changedLayers: [],
        diffSummary: [],
      };
    }

    const invalidLayout = validateProperties(layer, operation.layout, 'layout');
    if (invalidLayout.length > 0) {
      return {
        success: false,
        message: `Invalid layout properties for ${layer.type} layer "${operation.layerId}": ${invalidLayout.join(', ')}`,
        style,
        changedLayers: [],
        diffSummary: [],
      };
    }

    applyObjectPatch(
      layer,
      operation.layerId,
      'paint',
      operation.paint,
      diffSummary
    );
    applyObjectPatch(
      layer,
      operation.layerId,
      'layout',
      operation.layout,
      diffSummary
    );

    if ('filter' in operation && !Object.is(layer.filter, operation.filter)) {
      diffSummary.push({
        path: `layers.${operation.layerId}.filter`,
        before: layer.filter,
        after: operation.filter,
      });
      layer.filter = operation.filter;
    }

    if (operation.minzoom !== undefined && layer.minzoom !== operation.minzoom) {
      diffSummary.push({
        path: `layers.${operation.layerId}.minzoom`,
        before: layer.minzoom,
        after: operation.minzoom,
      });
      layer.minzoom = operation.minzoom;
    }

    if (operation.maxzoom !== undefined && layer.maxzoom !== operation.maxzoom) {
      diffSummary.push({
        path: `layers.${operation.layerId}.maxzoom`,
        before: layer.maxzoom,
        after: operation.maxzoom,
      });
      layer.maxzoom = operation.maxzoom;
    }

    if (diffSummary.some((entry) => entry.path.startsWith(`layers.${operation.layerId}.`))) {
      changedLayerIds.add(operation.layerId);
    }
  }

  return {
    success: true,
    message: `Applied ${operations.length} style operation${operations.length === 1 ? '' : 's'}.`,
    style: nextStyle,
    changedLayers: [...changedLayerIds],
    diffSummary,
  };
};
