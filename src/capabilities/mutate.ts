import type { MapStyleApplyResult } from '../adapters/maplibre/types.js';
import { applyStyleTransaction, createStyleToolError, styleTransactionSchema } from '../core/index.js';
import type { StyleDiffEntry, StyleWarning } from '../core/index.js';
import { boundStyleMutationReceipt, invalidInputFailure, toFailure } from './boundary.js';
import type { AuthoritySource, StyleAuthority } from './authority.js';
import { authorityNotReadyError } from './authority.js';
import type {
  CapabilityResult,
  StyleMutationReceipt,
} from './contracts.js';
import { applyStyleDocumentInputSchema, applyStyleTransactionToolInputSchema } from './schemas.js';

export const APPLY_STYLE_TRANSACTION_DESCRIPTION =
  'Apply a strict MapLibre style transaction to the current map.';
export const APPLY_STYLE_DOCUMENT_DESCRIPTION =
  'Apply a validated MapLibre style document or absolute style URL to the current map.';

const EMPTY_TRANSACTION_MESSAGE = 'Style transaction completed without changes.';
const TRANSACTION_MESSAGE = 'Style transaction completed.';
const DOCUMENT_MESSAGE = 'Style document completed.';

const transactionIssuePath = (path: PropertyKey[]): string =>
  `/transaction${path.length === 0 ? '' : `/${path.map((part) => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`}`;

type MutationResult = {
  applied: boolean;
  changedLayers: string[];
  changedSources: string[];
  diff: StyleDiffEntry[];
  warnings: StyleWarning[];
  styleAuthority: 'current' | 'not-checked';
};

const receipt = (
  message: string,
  result: MutationResult,
  diff: boolean,
): CapabilityResult<StyleMutationReceipt> => boundStyleMutationReceipt({
  message,
  applied: result.applied,
  noOp: false,
  changedLayers: result.changedLayers,
  changedSources: result.changedSources,
  ...(diff ? { diff: result.diff } : {}),
  warnings: result.warnings,
  styleAuthority: result.styleAuthority,
});
const failure = (result: Extract<MapStyleApplyResult, { ok: false }>) => {
  if (result.rolledBack === undefined && result.rollbackError === undefined) {
    return toFailure(result.error);
  }
  const rollback = {
    ...(result.rolledBack === undefined ? {} : { rolledBack: result.rolledBack }),
    ...(result.rollbackError === undefined ? {} : {
      error: {
        code: result.rollbackError.code,
        message: result.rollbackError.message,
        ...(result.rollbackError.path === undefined ? {} : { path: result.rollbackError.path }),
        ...(result.rollbackError.details === undefined ? {} : { details: result.rollbackError.details }),
      },
    }),
  };
  return toFailure(createStyleToolError(
    result.error.code,
    result.error.message,
    result.error.path,
    { ...(result.error.details ?? {}), rollback },
  ));
};


export const executeApplyStyleTransaction = async (
  getAuthority: AuthoritySource<StyleAuthority>,
  rawInput: unknown,
): Promise<CapabilityResult<StyleMutationReceipt>> => {
    const parsedInput = applyStyleTransactionToolInputSchema.safeParse(rawInput);
    if (!parsedInput.success) return invalidInputFailure(parsedInput.error);
    const input = parsedInput.data;
    const includeDiff = input.diff ?? true;
    if (input.transaction.operations.length === 0) {
      return boundStyleMutationReceipt({
        message: EMPTY_TRANSACTION_MESSAGE,
        applied: false,
        noOp: true,
        changedLayers: [],
        changedSources: [],
        ...(includeDiff ? { diff: [] } : {}),
        warnings: [],
        styleAuthority: 'not-checked',
      });
    }

    const parsedTransaction = styleTransactionSchema.safeParse(input.transaction);
    if (!parsedTransaction.success) {
      const issue = parsedTransaction.error.issues[0];
      return toFailure(createStyleToolError(
        'INVALID_INPUT',
        issue?.message ?? 'Tool input is invalid.',
        transactionIssuePath(issue?.path ?? []),
      ));
    }
    const transaction = parsedTransaction.data;

    if (input.dryRun === true) {
      const authority = getAuthority();
      if (authority === null) return toFailure(authorityNotReadyError());
      const current = authority.readStyle();
      if (!current.ok) return toFailure(current.error);
      const result = applyStyleTransaction(current.style, transaction);
      if (!result.ok) return toFailure(result.error);
      return receipt(TRANSACTION_MESSAGE, {
        applied: false,
        changedLayers: result.changedLayers,
        changedSources: result.changedSources,
        diff: result.diff,
        warnings: result.warnings,
        styleAuthority: 'not-checked',
      }, includeDiff);
    }

    const authority = getAuthority();
    if (authority === null) return toFailure(authorityNotReadyError());
    const result = await authority.applyTransaction(
      transaction,
      { diff: includeDiff },
    );
    if (!result.ok) return failure(result);
    return receipt(TRANSACTION_MESSAGE, {
      applied: result.applied,
      changedLayers: result.changedLayers,
      changedSources: result.changedSources,
      diff: result.diff,
      warnings: result.warnings,
      styleAuthority: result.styleAuthority === 'current' ? 'current' : 'not-checked',
    }, includeDiff);
};
export const executeApplyStyleDocument = async (
  getAuthority: AuthoritySource<StyleAuthority>,
  rawInput: unknown,
): Promise<CapabilityResult<StyleMutationReceipt>> => {
    const parsedInput = applyStyleDocumentInputSchema.safeParse(rawInput);
    if (!parsedInput.success) return invalidInputFailure(parsedInput.error);
    const input = parsedInput.data;
    const authority = getAuthority();
    if (authority === null) return toFailure(authorityNotReadyError());
    const result = await authority.applyDocument(
      input.source.kind === 'style' ? input.source.style : input.source.url,
      { diff: input.diff ?? true },
    );
    if (!result.ok) return failure(result);
    return receipt(DOCUMENT_MESSAGE, {
      applied: result.applied,
      changedLayers: result.changedLayers,
      changedSources: result.changedSources,
      diff: result.diff,
      warnings: result.warnings,
      styleAuthority: result.styleAuthority === 'current' ? 'current' : 'not-checked',
    }, input.diff ?? true);
};
