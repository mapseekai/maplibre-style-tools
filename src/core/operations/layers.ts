import { jsonValuesEqual } from '../diff.js';
import { createStyleToolError } from '../errors.js';
import type {
  JsonObject,
  JsonValue,
  OperationApplyResult,
  OperationContext,
  SetLayerPropertiesOperation,
  StyleDocument,
  StyleLayer,
} from '../types.js';

function cloneJsonValue<Value extends JsonValue>(value: Value): Value {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('JSON serialization returned undefined for a JSON value');
  }
  return JSON.parse(serialized) as Value;
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
