import { applyStyleDocumentOrUrlToMap, applyTransactionToMap, type MapStyleApplyResult } from '../adapters/maplibre/index.js';
import { applyStyleTransaction, createStyleToolError, styleTransactionSchema } from '../core/index.js';
import type { StyleDiffEntry, StyleWarning } from '../core/index.js';
import { boundStyleMutationReceipt, createAiTool, toFailure } from './boundary.js';
import type {
  AiStyleToolResult,
  ApplyStyleDocumentInput,
  ApplyStyleTransactionInput,
  CreateMapLibreStyleToolsOptions,
  MapLibreAiTool,
  StyleMutationReceipt,
} from './contracts.js';
import { applyStyleDocumentInputSchema, applyStyleTransactionInputSchema } from './schemas.js';
import { getAvailableMap, readValidatedMapStyle } from './shared.js';

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
): AiStyleToolResult<StyleMutationReceipt> => boundStyleMutationReceipt({
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


export const createApplyStyleTransactionTool = (
  options: Pick<CreateMapLibreStyleToolsOptions, 'getMap' | 'getContext'>,
): MapLibreAiTool<ApplyStyleTransactionInput, StyleMutationReceipt> => createAiTool(
  applyStyleTransactionInputSchema,
  'Apply a strict MapLibre style transaction to the current map.',
  async (input) => {
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
      const current = readValidatedMapStyle(options.getMap);
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

    const available = getAvailableMap(options.getMap);
    if (!available.ok) return toFailure(available.error);
    const result = await applyTransactionToMap(
      available.map,
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
  },
) as unknown as MapLibreAiTool<ApplyStyleTransactionInput, StyleMutationReceipt>;
export const createApplyStyleDocumentTool = (
  options: Pick<CreateMapLibreStyleToolsOptions, 'getMap' | 'getContext'>,
): MapLibreAiTool<ApplyStyleDocumentInput, StyleMutationReceipt> => createAiTool(
  applyStyleDocumentInputSchema,
  'Apply a validated MapLibre style document or absolute style URL to the current map.',
  async (input) => {
    const available = getAvailableMap(options.getMap);
    if (!available.ok) return toFailure(available.error);
    const result = await applyStyleDocumentOrUrlToMap(
      available.map,
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
  },
) as unknown as MapLibreAiTool<ApplyStyleDocumentInput, StyleMutationReceipt>;
