import type { MapStyleApplyResult } from '../adapters/maplibre/types.js';
import {
  applyStyleTransaction,
  createStyleToolError,
  finalizeStyleReplacement,
  validateStyleDocument,
} from '../core/index.js';
import type {
  StyleDocument,
  StyleToolError,
  StyleTransaction,
  StyleTransactionResult,
  StyleWarning,
} from '../core/index.js';
import type { MapToolContext } from '../capabilities/contracts.js';
export type FileStyleApplyResult = MapStyleApplyResult;

export interface FileStyleAuthority {
  readStyle():
    | { ok: true; style: StyleDocument; warnings: StyleWarning[] }
    | { ok: false; error: StyleToolError; warnings: StyleWarning[] };
  context(): MapToolContext;
  applyTransaction(
    transaction: StyleTransaction,
    options: { diff: boolean },
  ): FileStyleApplyResult;
  applyDocument(
    source: StyleDocument | string,
    options: { diff: boolean },
  ): FileStyleApplyResult;
}

const result = (
  applied: StyleTransactionResult,
  diff: boolean,
): FileStyleApplyResult => {
  if (!applied.ok) {
    return {
      ...applied,
      applied: false,
      styleAuthority: 'current',
    };
  }
  return {
    ...applied,
    applied: true,
    diff: diff ? applied.diff : [],
    styleAuthority: 'current',
  };
};
const unavailable = (error: StyleToolError): FileStyleApplyResult => ({
  ok: false,
  applied: false,
  changedLayers: [],
  changedSources: [],
  diff: [],
  warnings: [],
  styleAuthority: 'unavailable',
  error,
});


export function createFileStyleAuthority(initialStyle: unknown): FileStyleAuthority {
  let style = initialStyle;

  return {
    readStyle() {
      const validation = validateStyleDocument(style);
      return validation.ok
        ? { ok: true, style: validation.style, warnings: validation.warnings }
        : {
          ok: false,
          error: validation.errors[0] ?? createStyleToolError(
            'STYLE_INVALID', 'MapLibre style validation failed.',
          ),
          warnings: validation.warnings,
        };
    },
    context: () => ({}),
    applyTransaction(transaction, { diff }) {
      const current = this.readStyle();
      if (!current.ok) return unavailable(current.error);
      const applied = applyStyleTransaction(current.style, transaction);
      const receipt = result(applied, diff);
      if (receipt.ok) style = applied.style;
      return receipt;
    },
    applyDocument(source, { diff }) {
      if (typeof source === 'string') {
        return unavailable(createStyleToolError(
          'INVALID_INPUT', 'Style URLs are not supported by the file authority.',
        ));
      }
      const current = this.readStyle();
      if (!current.ok) return unavailable(current.error);
      const applied = finalizeStyleReplacement(current.style, source);
      const receipt = result(applied, diff);
      if (receipt.ok) style = applied.style;
      return receipt;
    },
  };
}
