import { jsonValuesEqual } from '../diff.js';
import { createStyleToolError } from '../errors.js';
import type {
  JsonObject,
  JsonValue,
  LayerLifecycleOperation,
  OperationApplyResult,
  OperationContext,
  SetLayerPropertiesOperation,
  StyleDocument,
  StyleLayer,
} from '../types.js';
import {
  applyMergePatch,
  cloneStrictJsonValue,
  resolveInsertionIndex,
} from './shared.js';

function cloneJsonValue<Value extends JsonValue>(value: Value): Value {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('JSON serialization returned undefined for a JSON value');
  }
  return JSON.parse(serialized) as Value;
}

type PlacementPath = '/beforeId' | '/afterId';

function layerNotFound(
  layerId: string,
  path: '/layerId' | `/layerIds/${number}` = '/layerId',
): OperationApplyResult {
  return {
    ok: false,
    error: createStyleToolError(
      'NOT_FOUND',
      `Layer "${layerId}" was not found.`,
      path,
      { layerId },
    ),
  };
}

function layerCollision(layerId: string): OperationApplyResult {
  return {
    ok: false,
    error: createStyleToolError(
      'CONFLICT',
      `Layer "${layerId}" already exists.`,
      '/newLayerId',
      { layerId },
    ),
  };
}

function invalidInput(
  message: string,
  path: string,
  details?: JsonObject,
): OperationApplyResult {
  return {
    ok: false,
    error: createStyleToolError('INVALID_INPUT', message, path, details),
  };
}

function placementPath(
  placement: { beforeId?: string; afterId?: string },
): PlacementPath | undefined {
  if (placement.beforeId !== undefined) return '/beforeId';
  if (placement.afterId !== undefined) return '/afterId';
  return undefined;
}

function placementError(
  placement: { beforeId?: string; afterId?: string },
): OperationApplyResult | undefined {
  return placement.beforeId !== undefined && placement.afterId !== undefined
    ? invalidInput(
        'Placement cannot specify both beforeId and afterId.',
        '/afterId',
      )
    : undefined;
}

function missingAnchor(
  placement: { beforeId?: string; afterId?: string },
): OperationApplyResult | undefined {
  const path = placementPath(placement);
  if (path === undefined) return undefined;
  const anchorId = placement.beforeId ?? placement.afterId!;
  return {
    ok: false,
    error: createStyleToolError(
      'NOT_FOUND',
      `Placement anchor layer "${anchorId}" was not found.`,
      path,
      { layerId: anchorId },
    ),
  };
}

function resolveLayerInsertionIndex(
  layers: StyleLayer[],
  placement: { beforeId?: string; afterId?: string },
  defaultIndex: number,
): number | OperationApplyResult {
  const anchorId = placement.beforeId ?? placement.afterId;
  if (anchorId !== undefined && !layers.some((layer) => layer.id === anchorId)) {
    return missingAnchor(placement)!;
  }
  return resolveInsertionIndex(layers, placement, defaultIndex);
}

function duplicateLayer(
  style: StyleDocument,
  operation: Extract<LayerLifecycleOperation, { op: 'duplicateLayer' }>,
  context: OperationContext,
): OperationApplyResult {
  const layerIndex = style.layers.findIndex((layer) => layer.id === operation.layerId);
  if (layerIndex === -1) return layerNotFound(operation.layerId);
  if (style.layers.some((layer) => layer.id === operation.newLayerId)) {
    return layerCollision(operation.newLayerId);
  }
  const placementFailure = placementError(operation);
  if (placementFailure !== undefined) return placementFailure;

  let overrides: JsonObject;
  try {
    overrides = cloneStrictJsonValue(operation.overrides ?? {});
  } catch {
    return invalidInput(
      'Layer overrides must be a strict JSON object.',
      '/overrides',
    );
  }
  if (Object.hasOwn(overrides, 'id')) {
    return invalidInput(
      'Layer overrides cannot include the authority key id.',
      '/overrides/id',
    );
  }

  const insertion = resolveLayerInsertionIndex(
    style.layers,
    operation,
    layerIndex + 1,
  );
  if (typeof insertion !== 'number') return insertion;

  const duplicate = applyMergePatch(style.layers[layerIndex]!, overrides) as StyleLayer;
  Reflect.defineProperty(duplicate, 'id', {
    configurable: true,
    enumerable: true,
    value: operation.newLayerId,
    writable: true,
  });
  style.layers.splice(insertion, 0, duplicate);
  context.changedLayerIds.add(operation.newLayerId);
  return { ok: true, changed: true };
}

function moveLayer(
  style: StyleDocument,
  operation: Extract<LayerLifecycleOperation, { op: 'moveLayer' }>,
  context: OperationContext,
): OperationApplyResult {
  const originalIndex = style.layers.findIndex((layer) => layer.id === operation.layerId);
  if (originalIndex === -1) return layerNotFound(operation.layerId);
  const placementFailure = placementError(operation);
  if (placementFailure !== undefined) return placementFailure;
  const anchorId = operation.beforeId ?? operation.afterId;
  if (anchorId === operation.layerId) {
    return invalidInput(
      'A layer cannot be placed relative to itself.',
      operation.beforeId !== undefined ? '/beforeId' : '/afterId',
      { layerId: operation.layerId },
    );
  }
  if (anchorId !== undefined && !style.layers.some((layer) => layer.id === anchorId)) {
    return missingAnchor(operation)!;
  }

  const [layer] = style.layers.splice(originalIndex, 1);
  const insertion = resolveLayerInsertionIndex(
    style.layers,
    operation,
    style.layers.length,
  );
  if (typeof insertion !== 'number') {
    style.layers.splice(originalIndex, 0, layer!);
    return insertion;
  }
  if (insertion === originalIndex) {
    style.layers.splice(originalIndex, 0, layer!);
    return { ok: true, changed: false };
  }
  style.layers.splice(insertion, 0, layer!);
  context.changedLayerIds.add(operation.layerId);
  return { ok: true, changed: true };
}

function reorderLayers(
  style: StyleDocument,
  operation: Extract<LayerLifecycleOperation, { op: 'reorderLayers' }>,
  context: OperationContext,
): OperationApplyResult {
  if (operation.layerIds.length === 0) {
    return invalidInput('layerIds must contain at least one layer ID.', '/layerIds');
  }
  const originalIds = style.layers.map((layer) => layer.id);
  const seen = new Set<string>();
  const originalIndexes: number[] = [];
  const collected: StyleLayer[] = [];
  for (let index = 0; index < operation.layerIds.length; index += 1) {
    const layerId = operation.layerIds[index]!;
    if (seen.has(layerId)) {
      return invalidInput(
        'layerIds must contain unique layer IDs.',
        `/layerIds/${index}`,
        { layerId },
      );
    }
    seen.add(layerId);
    const layerIndex = style.layers.findIndex((layer) => layer.id === layerId);
    if (layerIndex === -1) return layerNotFound(layerId, `/layerIds/${index}`);
    originalIndexes.push(layerIndex);
    collected.push(style.layers[layerIndex]!);
  }
  const placementFailure = placementError(operation);
  if (placementFailure !== undefined) return placementFailure;
  const anchorId = operation.beforeId ?? operation.afterId;
  if (anchorId !== undefined && seen.has(anchorId)) {
    return invalidInput(
      'A reorder anchor cannot be one of the moving layers.',
      operation.beforeId !== undefined ? '/beforeId' : '/afterId',
      { layerId: anchorId },
    );
  }
  if (anchorId !== undefined && !style.layers.some((layer) => layer.id === anchorId)) {
    return missingAnchor(operation)!;
  }

  const descendingIndexes = [...originalIndexes].sort((left, right) => right - left);
  for (const index of descendingIndexes) style.layers.splice(index, 1);
  const insertion = resolveLayerInsertionIndex(
    style.layers,
    operation,
    style.layers.length,
  );
  if (typeof insertion !== 'number') return insertion;
  style.layers.splice(insertion, 0, ...collected);

  const finalIds = style.layers.map((layer) => layer.id);
  const orderChanged = originalIds.some((layerId, index) => layerId !== finalIds[index]);
  if (orderChanged) {
    for (const layerId of operation.layerIds) context.changedLayerIds.add(layerId);
  }
  return { ok: true, changed: orderChanged };
}

function removeLayer(
  style: StyleDocument,
  operation: Extract<LayerLifecycleOperation, { op: 'removeLayer' }>,
  context: OperationContext,
): OperationApplyResult {
  const layerIndex = style.layers.findIndex((layer) => layer.id === operation.layerId);
  if (layerIndex === -1) return layerNotFound(operation.layerId);
  style.layers.splice(layerIndex, 1);
  context.changedLayerIds.add(operation.layerId);
  return { ok: true, changed: true };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled layer lifecycle operation: ${JSON.stringify(value)}`);
}

export function applyLayerOperation(
  style: StyleDocument,
  operation: LayerLifecycleOperation,
  context: OperationContext,
): OperationApplyResult {
  switch (operation.op) {
    case 'duplicateLayer':
      return duplicateLayer(style, operation, context);
    case 'moveLayer':
      return moveLayer(style, operation, context);
    case 'reorderLayers':
      return reorderLayers(style, operation, context);
    case 'removeLayer':
      return removeLayer(style, operation, context);
    default:
      return assertNever(operation);
  }
}

function applyObjectPatch(
  layer: StyleLayer,
  property: 'paint' | 'layout' | 'metadata',
  patch: JsonObject,
): void {
  const existing = layer[property];
  const container: JsonObject = (
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
  ) ? existing : {};

  for (const key of Object.keys(patch)) {
    if (!Object.hasOwn(patch, key)) continue;
    const value = patch[key];
    if (value === null) {
      delete container[key];
    } else if (value !== undefined) {
      container[key] = value;
    }
  }

  if ((property === 'paint' || property === 'layout') && Object.keys(container).length === 0) {
    delete layer[property];
  } else {
    layer[property] = container;
  }
}

function applyZoom(
  layer: StyleLayer,
  operation: SetLayerPropertiesOperation,
  property: 'minzoom' | 'maxzoom',
): void {
  if (!Object.hasOwn(operation, property)) return;
  const value = operation[property];
  if (value === null) {
    delete layer[property];
  } else if (value !== undefined) {
    layer[property] = value;
  }
}

export function applySetLayerProperties(
  style: StyleDocument,
  operation: SetLayerPropertiesOperation,
  context: OperationContext,
): OperationApplyResult {
  const layerIndex = style.layers.findIndex((layer) => layer.id === operation.layerId);
  if (layerIndex === -1) {
    return {
      ok: false,
      error: createStyleToolError(
        'NOT_FOUND',
        `Layer "${operation.layerId}" was not found.`,
        '/layerId',
        { layerId: operation.layerId },
      ),
    };
  }

  const layer = style.layers[layerIndex]!;
  const before = cloneJsonValue(layer);

  if (Object.hasOwn(operation, 'paint') && operation.paint !== undefined) {
    applyObjectPatch(layer, 'paint', operation.paint);
  }
  if (Object.hasOwn(operation, 'layout') && operation.layout !== undefined) {
    applyObjectPatch(layer, 'layout', operation.layout);
  }
  if (Object.hasOwn(operation, 'metadata')) {
    if (operation.metadata === null) {
      delete layer.metadata;
    } else if (operation.metadata !== undefined) {
      applyObjectPatch(layer, 'metadata', operation.metadata);
    }
  }
  applyZoom(layer, operation, 'minzoom');
  applyZoom(layer, operation, 'maxzoom');

  const changed = !jsonValuesEqual(before, layer);
  if (changed) context.changedLayerIds.add(operation.layerId);
  return { ok: true, changed };
}
