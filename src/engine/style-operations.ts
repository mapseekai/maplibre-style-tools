import { applyStyleTransaction } from '../core/transaction.js';
import { diffStyleDocuments } from '../core/diff.js';
import type {
  CoreExecutionLimits,
  JsonValue as CoreJsonValue,
  JsonObject as CoreJsonObject,
  OperationContext,
  SetLayerFilterOperation,
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
  StyleOperation,
  StyleOperationResult,
} from '../types.js';

const legacyPropertyValidationMessage = (
  style: StyleDocument,
  normalizedMessage: string
): string | undefined => {
  const match = /^layers\[(\d+)\]\.(paint|layout)\./.exec(normalizedMessage);
  if (!match) {
    return undefined;
  }
  const layerIndex = Number(match[1]);
  const mode = match[2];
  const pathPrefix = match[0];
  const unknownPropertyMarker = ': unknown property "';
  let property: string | undefined;

  if (normalizedMessage.endsWith('"')) {
    let markerIndex = normalizedMessage.indexOf(
      unknownPropertyMarker,
      pathPrefix.length
    );
    while (markerIndex >= 0) {
      const pathProperty = normalizedMessage.slice(
        pathPrefix.length,
        markerIndex
      );
      const detailProperty = normalizedMessage.slice(
        markerIndex + unknownPropertyMarker.length,
        -1
      );
      if (pathProperty === detailProperty) {
        property = detailProperty;
        break;
      }
      markerIndex = normalizedMessage.indexOf(
        unknownPropertyMarker,
        markerIndex + 1
      );
    }
  }

  if (property === undefined) {
    const detailIndex = normalizedMessage.indexOf(': ', pathPrefix.length);
    if (detailIndex < 0) {
      return undefined;
    }
    property = normalizedMessage.slice(pathPrefix.length, detailIndex);
  }

  const layer = style.layers[layerIndex];
  if (!layer || (mode !== 'paint' && mode !== 'layout')) {
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

const toCoreFilterOperation = (
  operation: StyleOperation
): SetLayerFilterOperation | undefined => {
  if (!Object.hasOwn(operation, 'filter')) {
    return undefined;
  }
  if (operation.filter === null) {
    return { op: 'setLayerFilter', layerId: operation.layerId, mode: 'clear' };
  }
  return {
    op: 'setLayerFilter',
    layerId: operation.layerId,
    mode: 'replace',
    filter: operation.filter as CoreJsonValue[],
  };
};

const toCoreOperations = (
  operation: StyleOperation
): Array<SetLayerPropertiesOperation | SetLayerFilterOperation> => {
  const normalized: Array<SetLayerPropertiesOperation | SetLayerFilterOperation> = [];
  if (
    operation.paint !== undefined
    || operation.layout !== undefined
    || operation.minzoom !== undefined
    || operation.maxzoom !== undefined
  ) {
    normalized.push(toCoreOperation(operation));
  }
  const filter = toCoreFilterOperation(operation);
  if (filter !== undefined) normalized.push(filter);
  return normalized;
};

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
  if (section === 'filter' && tokens.length === 3) {
    return [{
      path: `layers.${entry.target.id}.filter`,
      before: entry.before,
      after: entry.after,
    }];
  }
  return [];
});

const orderDiffSummary = (
  operations: StyleOperation[],
  coreDiff: StyleDiffEntry[]
): StyleDiffEntry[] => {
  const remaining = new Map(coreDiff.map((entry) => [entry.path, entry]));
  const ordered: StyleDiffEntry[] = [];

  operations.forEach((operation) => {
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

    if (Object.hasOwn(operation, 'filter')) {
      const path = `layers.${operation.layerId}.filter`;
      const entry = remaining.get(path);
      if (entry) {
        ordered.push(entry);
        remaining.delete(path);
      }
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

type LegacyOperationHistory = {
  changedLayers: string[];
  diffSummary: StyleDiffEntry[];
};

const historyLimits: Readonly<CoreExecutionLimits> = Object.freeze({
  maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
  maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
  maxOperations: DEFAULT_MAX_OPERATIONS,
});

const historyContext = (layerId: string): OperationContext => ({
  limits: historyLimits,
  changedLayerIds: new Set([layerId]),
  changedSourceIds: new Set(),
  warnings: [],
});

const reconstructLegacyOperationHistory = (
  original: CoreStyleDocument,
  operations: StyleOperation[]
): LegacyOperationHistory => {
  let workingStyle = structuredClone(original);
  const changedLayers: string[] = [];
  const changedLayerSet = new Set<string>();
  const diffSummary: StyleDiffEntry[] = [];
  const replayOperations: Array<SetLayerPropertiesOperation | SetLayerFilterOperation> = [];

  for (const operation of operations) {
    const normalized = toCoreOperations(operation);
    if (normalized.length === 0) continue;
    replayOperations.push(...normalized);
    const result = applyStyleTransaction(
      original,
      { operations: replayOperations, validate: false }
    );
    if (!result.ok) {
      continue;
    }

    const coreDiff = toLegacyCoreDiff(diffStyleDocuments(
      workingStyle,
      result.style,
      historyContext(operation.layerId)
    ));
    const operationDiff = orderDiffSummary(
      [operation],
      coreDiff
    );
    if (operationDiff.length > 0 && !changedLayerSet.has(operation.layerId)) {
      changedLayerSet.add(operation.layerId);
      changedLayers.push(operation.layerId);
    }
    diffSummary.push(...operationDiff);
    workingStyle = result.style;
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
    { operations: operations.flatMap(toCoreOperations) }
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
    style: coreResult.style as unknown as StyleDocument,
    changedLayers: legacyHistory.changedLayers,
    diffSummary: legacyHistory.diffSummary,
  };
};
