import { applyStyleTransaction } from '../core/transaction.js';
import { diffStyleDocuments } from '../core/diff.js';
import { applySetLayerProperties } from '../core/operations/layers.js';
import type {
  CoreExecutionLimits,
  JsonObject as CoreJsonObject,
  OperationContext,
  SetLayerPropertiesOperation,
  StyleDiffEntry as CoreStyleDiffEntry,
  StyleDocument as CoreStyleDocument,
} from '../core/types.js';
import {
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
} from '../core/utf8.js';
import { validateStyleDocument } from '../core/validation.js';
import type {
  StyleDiffEntry,
  StyleDocument,
  StyleLayer,
  StyleOperation,
  StyleOperationResult,
} from '../types.js';

const findLayer = (
  style: StyleDocument | CoreStyleDocument,
  layerId: string
): StyleLayer | undefined => style.layers.find(
  (layer) => layer.id === layerId
) as StyleLayer | undefined;

const legacyPropertyValidationMessage = (
  style: StyleDocument,
  normalizedMessage: string
): string | undefined => {
  const match = /^layers\[(\d+)\]\.(paint|layout)\.(.+?): /.exec(
    normalizedMessage
  );
  if (!match) {
    return undefined;
  }
  const layerIndex = Number(match[1]);
  const mode = match[2];
  const property = match[3];
  const layer = style.layers[layerIndex];
  if (!layer || (mode !== 'paint' && mode !== 'layout') || !property) {
    return undefined;
  }
  return `Invalid ${mode} properties for ${layer.type} layer "${layer.id}": ${property}`;
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
  diff?: StyleDiffEntry;
};

// Temporary legacy exception: Layer/Data Task 3 replaces this with setLayerFilter.
const applyLegacyFilterCompatibility = (
  workingStyle: CoreStyleDocument,
  operation: StyleOperation
): LegacyFilterCompatibilityResult => {
  if (!Object.hasOwn(operation, 'filter')) {
    return {};
  }
  const layer = findLayer(workingStyle, operation.layerId);
  if (!layer || Object.is(layer.filter, operation.filter)) {
    return {};
  }

  const before = layer.filter;
  if (operation.filter === null) {
    delete layer.filter;
  } else {
    layer.filter = operation.filter;
  }
  return {
    diff: {
      path: `layers.${operation.layerId}.filter`,
      before,
      after: operation.filter === null ? undefined : operation.filter,
    },
  };
};

const executionLimits: Readonly<CoreExecutionLimits> = Object.freeze({
  maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
  maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
  maxOperations: DEFAULT_MAX_OPERATIONS,
});

const operationContext = (): OperationContext => ({
  limits: executionLimits,
  changedLayerIds: new Set<string>(),
  changedSourceIds: new Set<string>(),
  warnings: [],
});

type LegacyOperationHistory = {
  changedLayers: string[];
  diffSummary: StyleDiffEntry[];
};

const reconstructLegacyOperationHistory = (
  original: CoreStyleDocument,
  operations: StyleOperation[]
): LegacyOperationHistory => {
  const workingStyle = structuredClone(original);
  const changedLayers: string[] = [];
  const changedLayerSet = new Set<string>();
  const diffSummary: StyleDiffEntry[] = [];

  for (const operation of operations) {
    const before = structuredClone(workingStyle);
    const context = operationContext();
    const result = applySetLayerProperties(
      workingStyle,
      toCoreOperation(operation),
      context
    );
    if (!result.ok) {
      continue;
    }

    const coreDiff = toLegacyCoreDiff(
      diffStyleDocuments(before, workingStyle, context)
    );
    const filterCompatibility = applyLegacyFilterCompatibility(
      workingStyle,
      operation
    );
    const filterDiff = new Map<number, StyleDiffEntry>();
    if (filterCompatibility.diff) {
      filterDiff.set(0, filterCompatibility.diff);
    }
    const operationDiff = orderDiffSummary(
      [operation],
      coreDiff,
      filterDiff
    );
    if (operationDiff.length > 0 && !changedLayerSet.has(operation.layerId)) {
      changedLayerSet.add(operation.layerId);
      changedLayers.push(operation.layerId);
    }
    diffSummary.push(...operationDiff);
  }

  return { changedLayers, diffSummary };
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
      const legacyMessage = legacyPropertyValidationMessage(
        style,
        coreResult.error.message
      );
      if (legacyMessage) {
        return failure(style, legacyMessage);
      }
    }
    return failure(style, coreResult.error.message);
  }

  const workingStyle = coreResult.style;
  for (const operation of operations) {
    applyLegacyFilterCompatibility(workingStyle, operation);
  }

  const finalValidation = validateStyleDocument(workingStyle);
  if (!finalValidation.ok) {
    return failure(
      style,
      finalValidation.errors[0]?.message ?? 'MapLibre style validation failed.'
    );
  }

  const originalValidation = validateStyleDocument(style);
  if (!originalValidation.ok) {
    return failure(
      style,
      originalValidation.errors[0]?.message ?? 'MapLibre style validation failed.'
    );
  }
  const legacyHistory = reconstructLegacyOperationHistory(
    originalValidation.style,
    operations
  );

  return {
    success: true,
    message: `Applied ${operations.length} style operation${operations.length === 1 ? '' : 's'}.`,
    style: finalValidation.style as unknown as StyleDocument,
    changedLayers: legacyHistory.changedLayers,
    diffSummary: legacyHistory.diffSummary,
  };
};
