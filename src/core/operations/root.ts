import { jsonValuesEqual } from '../diff.js';
import { createStyleToolError } from '../errors.js';
import type {
  OperationApplyResult,
  OperationContext,
  SetStyleRootPropertiesOperation,
  StyleDocument,
} from '../types.js';
import { applyMergePatch } from './shared.js';

const PROTECTED_ROOT_KEYS = new Set(['version', 'sources', 'layers']);

export function applyRootOperation(
  style: StyleDocument,
  operation: SetStyleRootPropertiesOperation,
  context: OperationContext,
): OperationApplyResult {
  void context;
  for (const key of Object.keys(operation.properties)) {
    if (PROTECTED_ROOT_KEYS.has(key)) {
      return {
        ok: false,
        error: createStyleToolError(
          'INVALID_INPUT', `Root style property "${key}" is protected.`, `/properties/${key}`,
        ),
      };
    }
  }

  let changed = false;
  for (const key of Object.keys(operation.properties)) {
    if (!Object.hasOwn(operation.properties, key)) continue;
    const patch = operation.properties[key]!;
    const hadProperty = Object.hasOwn(style, key);
    if (patch === null) {
      if (hadProperty) {
        Reflect.deleteProperty(style, key);
        changed = true;
      }
      continue;
    }
    const merged = applyMergePatch(hadProperty ? style[key]! : null, patch);
    if (!hadProperty || !jsonValuesEqual(style[key]!, merged)) {
      Reflect.defineProperty(style, key, {
        configurable: true,
        enumerable: true,
        value: merged,
        writable: true,
      });
      changed = true;
    }
  }
  return { ok: true, changed };
}
