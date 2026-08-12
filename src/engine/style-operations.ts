import { applyStyleTransaction } from '../core/transaction.js';
import type {
  JsonObject as CoreJsonObject,
  SetLayerPropertiesOperation,
  StyleDiffEntry as CoreStyleDiffEntry,
  StyleDocument as CoreStyleDocument,
} from '../core/types.js';
import { validateStyleDocument } from '../core/validation.js';
import type {
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

const findLayer = (
  style: StyleDocument | CoreStyleDocument,
  layerId: string
): StyleLayer | undefined => style.layers.find(
  (layer) => layer.id === layerId
) as StyleLayer | undefined;

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

const legacyPropertyValidationMessage = (
  style: StyleDocument,
  operations: StyleOperation[]
): string | undefined => {
  for (const operation of operations) {
    const layer = findLayer(style, operation.layerId);
    if (!layer) {
      continue;
    }

    for (const mode of ['paint', 'layout'] as const) {
      const properties = operation[mode];
      if (!properties) {
        continue;
      }
      const invalid = Object.keys(properties).filter(
        (property) => !isPropertyAllowed(layer.type, property, mode)
      );
      if (invalid.length > 0) {
        return `Invalid ${mode} properties for ${layer.type} layer "${operation.layerId}": ${invalid.join(', ')}`;
      }
    }
  }
  return undefined;
};

const toCoreOperation = (
  operation: StyleOperation
): SetLayerPropertiesOperation => ({
  op: 'setLayerProperties',
  layerId: operation.layerId,
  ...(
    operation.paint === undefined
      ? {}
      : { paint: operation.paint as CoreJsonObject }
  ),
  ...(
    operation.layout === undefined
      ? {}
      : { layout: operation.layout as CoreJsonObject }
  ),
  ...(operation.minzoom === undefined ? {} : { minzoom: operation.minzoom }),
  ...(operation.maxzoom === undefined ? {} : { maxzoom: operation.maxzoom }),
});

const decodePointer = (pointer: string): string[] => pointer
  .slice(1)
  .split('/')
  .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const expandContainerDiff = (
  layerId: string,
  section: 'paint' | 'layout',
  entry: CoreStyleDiffEntry
): StyleDiffEntry[] => {
  const before = isObject(entry.before) ? entry.before : {};
  const after = isObject(entry.after) ? entry.after : {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys
    .filter((key) => !Object.is(before[key], after[key]))
    .map((key) => ({
      path: `layers.${layerId}.${section}.${key}`,
      before: before[key],
      after: after[key],
    }));
};

const toLegacyCoreDiff = (
  diff: readonly CoreStyleDiffEntry[]
): StyleDiffEntry[] => diff.flatMap((entry) => {
  if (entry.target.kind !== 'layer') {
    return [];
  }

  const tokens = decodePointer(entry.path);
  const section = tokens[2];
  if ((section === 'paint' || section === 'layout') && tokens.length === 3) {
    return expandContainerDiff(entry.target.id, section, entry);
  }
  if ((section === 'paint' || section === 'layout') && tokens.length === 4) {
    return [{
      path: `layers.${entry.target.id}.${section}.${tokens[3]}`,
      before: entry.before,
      after: entry.after,
    }];
  }
  if ((section === 'minzoom' || section === 'maxzoom') && tokens.length === 3) {
    return [{
      path: `layers.${entry.target.id}.${section}`,
      before: entry.before,
      after: entry.after,
    }];
  }
  return [];
});

const orderDiffSummary = (
  operations: StyleOperation[],
  coreDiff: StyleDiffEntry[],
  filterDiffByOperation: ReadonlyMap<number, StyleDiffEntry>
): StyleDiffEntry[] => {
  const remaining = new Map(coreDiff.map((entry) => [entry.path, entry]));
  const ordered: StyleDiffEntry[] = [];

  operations.forEach((operation, index) => {
    for (const section of ['paint', 'layout'] as const) {
      for (const property of Object.keys(operation[section] ?? {})) {
        const path = `layers.${operation.layerId}.${section}.${property}`;
        const entry = remaining.get(path);
        if (entry) {
          ordered.push(entry);
          remaining.delete(path);
        }
      }
    }

    const filterEntry = filterDiffByOperation.get(index);
    if (filterEntry) {
      ordered.push(filterEntry);
    }

    for (const property of ['minzoom', 'maxzoom'] as const) {
      if (operation[property] === undefined) {
        continue;
      }
      const path = `layers.${operation.layerId}.${property}`;
      const entry = remaining.get(path);
      if (entry) {
        ordered.push(entry);
        remaining.delete(path);
      }
    }
  });

  ordered.push(...remaining.values());
  return ordered;
};

const failure = (style: StyleDocument, message: string): StyleOperationResult => ({
  success: false,
  message,
  style,
  changedLayers: [],
  diffSummary: [],
});

type LegacyFilterCompatibilityResult = {
  diffByOperation: Map<number, StyleDiffEntry>;
  changedLayers: Set<string>;
};

// Temporary legacy exception: Layer/Data Task 3 replaces this with setLayerFilter.
const applyLegacyFilterCompatibility = (
  workingStyle: CoreStyleDocument,
  operations: StyleOperation[]
): LegacyFilterCompatibilityResult => {
  const diffByOperation = new Map<number, StyleDiffEntry>();
  const changedLayers = new Set<string>();

  operations.forEach((operation, index) => {
    if (!Object.hasOwn(operation, 'filter')) {
      return;
    }
    const layer = findLayer(workingStyle, operation.layerId);
    if (!layer || Object.is(layer.filter, operation.filter)) {
      return;
    }

    const before = layer.filter;
    if (operation.filter === null) {
      delete layer.filter;
    } else {
      layer.filter = operation.filter;
    }
    diffByOperation.set(index, {
      path: `layers.${operation.layerId}.filter`,
      before,
      after: operation.filter === null ? undefined : operation.filter,
    });
    changedLayers.add(operation.layerId);
  });

  return { diffByOperation, changedLayers };
};

export const applyStyleOperations = (
  style: StyleDocument,
  operations: StyleOperation[]
): StyleOperationResult => {
  if (operations.length === 0) {
    const validation = validateStyleDocument(style);
    if (!validation.ok) {
      return failure(
        style,
        validation.errors[0]?.message ?? 'MapLibre style validation failed.'
      );
    }
    return {
      success: true,
      message: 'Applied 0 style operations.',
      style: validation.style as unknown as StyleDocument,
      changedLayers: [],
      diffSummary: [],
    };
  }

  const coreResult = applyStyleTransaction(
    style as unknown as CoreStyleDocument,
    { operations: operations.map(toCoreOperation) }
  );
  if (!coreResult.ok) {
    if (coreResult.error.code === 'NOT_FOUND') {
      const layerId = coreResult.error.details?.layerId;
      if (typeof layerId === 'string') {
        return failure(style, `Layer "${layerId}" not found.`);
      }
    }
    if (coreResult.error.code === 'STYLE_INVALID') {
      const legacyMessage = legacyPropertyValidationMessage(style, operations);
      if (legacyMessage) {
        return failure(style, legacyMessage);
      }
    }
    return failure(style, coreResult.error.message);
  }

  const workingStyle = coreResult.style;
  const filterCompatibility = applyLegacyFilterCompatibility(
    workingStyle,
    operations
  );

  const finalValidation = validateStyleDocument(workingStyle);
  if (!finalValidation.ok) {
    return failure(
      style,
      finalValidation.errors[0]?.message ?? 'MapLibre style validation failed.'
    );
  }

  const changedLayerSet = new Set([
    ...coreResult.changedLayers,
    ...filterCompatibility.changedLayers,
  ]);
  const changedLayers = operations
    .map((operation) => operation.layerId)
    .filter((layerId, index, layerIds) =>
      changedLayerSet.has(layerId) && layerIds.indexOf(layerId) === index
    );
  const diffSummary = orderDiffSummary(
    operations,
    toLegacyCoreDiff(coreResult.diff),
    filterCompatibility.diffByOperation
  );

  return {
    success: true,
    message: `Applied ${operations.length} style operation${operations.length === 1 ? '' : 's'}.`,
    style: finalValidation.style as unknown as StyleDocument,
    changedLayers,
    diffSummary,
  };
};
