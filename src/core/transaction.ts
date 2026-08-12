import { diffStyleDocuments } from './diff.js';
import { createStyleToolError, isStyleToolError } from './errors.js';
import { toJsonPointer } from './json-pointer.js';
import {
  applySetGeoJsonSourceFilter,
  applySetLayerFilter,
} from './operations/filters.js';
import {
  applyLayerOperation,
  applySetLayerProperties,
} from './operations/layers.js';
import { applyRootOperation } from './operations/root.js';
import { cloneStrictJsonValue } from './operations/shared.js';
import { applySourceOperation } from './operations/sources.js';
import { applyCompatibilityStyleOperation } from './operations/compatibility.js';
import { createStyleTransactionSchema } from './schemas.js';
import type {
  CoreExecutionLimits,
  JsonObject,
  JsonValue,
  OperationApplyResult,
  OperationContext,
  StyleDiffEntry,
  StyleDocument,
  StyleOperation,
  StyleReplacementOptions,
  StyleToolError,
  StyleTransactionOptions,
  StyleTransactionResult,
  StyleWarning,
} from './types.js';
import {
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
  jsonUtf8ByteLength,
} from './utf8.js';
import { validateStyleDocument } from './validation.js';

type LimitName = keyof CoreExecutionLimits;
type LimitResolution =
  | { ok: true; limits: Readonly<CoreExecutionLimits> }
  | { ok: false; error: StyleToolError };
type CandidateValidation =
  | { ok: true; style: StyleDocument; warnings: StyleWarning[] }
  | { ok: false; error: StyleToolError; warnings: StyleWarning[] };

function failureResult(
  style: StyleDocument,
  error: StyleToolError,
  warnings: StyleWarning[] = [],
): StyleTransactionResult {
  return {
    ok: false,
    style,
    changedLayers: [],
    changedSources: [],
    diff: [],
    warnings,
    error,
  };
}

function invalidLimit(name: LimitName): StyleToolError {
  return createStyleToolError(
    'INVALID_INPUT',
    `${name} must be a positive safe integer.`,
    `/${name}`,
  );
}

function resolveTransactionLimits(
  options: StyleTransactionOptions,
): LimitResolution {
  if (typeof options !== 'object' || options === null) {
    return {
      ok: false,
      error: createStyleToolError(
        'INVALID_INPUT', 'Transaction options must be an object.', '',
      ),
    };
  }

  let maxStyleBytes: number | undefined;
  let maxDiffBytes: number | undefined;
  let maxOperations: number | undefined;
  try {
    maxStyleBytes = options.maxStyleBytes;
    maxDiffBytes = options.maxDiffBytes;
    maxOperations = options.maxOperations;
  } catch {
    return {
      ok: false,
      error: createStyleToolError(
        'INVALID_INPUT', 'Transaction options could not be read.', '',
      ),
    };
  }

  const supplied = { maxStyleBytes, maxDiffBytes, maxOperations };
  for (const name of Object.keys(supplied) as LimitName[]) {
    const value = supplied[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      return { ok: false, error: invalidLimit(name) };
    }
  }

  return {
    ok: true,
    limits: Object.freeze({
      maxStyleBytes: maxStyleBytes ?? DEFAULT_MAX_STYLE_BYTES,
      maxDiffBytes: maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES,
      maxOperations: maxOperations ?? DEFAULT_MAX_OPERATIONS,
    }),
  };
}

function resolveReplacementLimits(
  options: StyleReplacementOptions,
): LimitResolution {
  if (typeof options !== 'object' || options === null) {
    return {
      ok: false,
      error: createStyleToolError(
        'INVALID_INPUT', 'Style replacement options must be an object.', '',
      ),
    };
  }

  let maxStyleBytes: number | undefined;
  let maxDiffBytes: number | undefined;
  try {
    maxStyleBytes = options.maxStyleBytes;
    maxDiffBytes = options.maxDiffBytes;
  } catch {
    return {
      ok: false,
      error: createStyleToolError(
        'INVALID_INPUT', 'Style replacement options could not be read.', '',
      ),
    };
  }

  if (maxStyleBytes !== undefined
    && (!Number.isSafeInteger(maxStyleBytes) || maxStyleBytes <= 0)) {
    return { ok: false, error: invalidLimit('maxStyleBytes') };
  }
  if (maxDiffBytes !== undefined
    && (!Number.isSafeInteger(maxDiffBytes) || maxDiffBytes <= 0)) {
    return { ok: false, error: invalidLimit('maxDiffBytes') };
  }

  return {
    ok: true,
    limits: Object.freeze({
      maxStyleBytes: maxStyleBytes ?? DEFAULT_MAX_STYLE_BYTES,
      maxDiffBytes: maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES,
      maxOperations: DEFAULT_MAX_OPERATIONS,
    }),
  };
}

function issueDetails(issue: unknown): JsonObject | undefined {
  if (typeof issue !== 'object' || issue === null || !('params' in issue)) return undefined;
  const params = issue.params;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return undefined;
  if (
    'reason' in params && params.reason === 'maxOperations'
    && 'maxOperations' in params && typeof params.maxOperations === 'number'
    && 'actualOperations' in params && typeof params.actualOperations === 'number'
  ) {
    return {
      reason: 'maxOperations',
      maxOperations: params.maxOperations,
      actualOperations: params.actualOperations,
    };
  }
  return undefined;
}

function schemaError(issue: {
  message: string;
  path: readonly PropertyKey[];
}): StyleToolError {
  return createStyleToolError(
    'INVALID_INPUT',
    issue.message,
    toJsonPointer(issue.path.map((segment) => String(segment))),
    issueDetails(issue),
  );
}

function maxStyleBytesError(maxBytes: number, actualBytes: number): StyleToolError {
  return createStyleToolError(
    'INVALID_INPUT',
    'Style exceeds the configured UTF-8 JSON size limit.',
    '',
    { reason: 'maxStyleBytes', maxBytes, actualBytes },
  );
}

function validateCandidateStyle(
  candidate: StyleDocument,
  context: OperationContext,
  validateStyleSpec: boolean,
): CandidateValidation {
  if (validateStyleSpec) {
    const validation = validateStyleDocument(candidate, {
      maxStyleBytes: context.limits.maxStyleBytes,
    });
    if (!validation.ok) {
      return {
        ok: false,
        error: validation.errors[0] ?? createStyleToolError(
          'STYLE_INVALID', 'MapLibre style validation failed.',
        ),
        warnings: validation.warnings,
      };
    }
    return { ok: true, style: validation.style, warnings: validation.warnings };
  }

  let actualBytes: number;
  try {
    actualBytes = jsonUtf8ByteLength(candidate);
  } catch {
    return {
      ok: false,
      error: createStyleToolError(
        'INTERNAL', 'Sanitized style could not be serialized for size validation.', '',
      ),
      warnings: [],
    };
  }
  if (actualBytes > context.limits.maxStyleBytes) {
    return {
      ok: false,
      error: maxStyleBytesError(context.limits.maxStyleBytes, actualBytes),
      warnings: [],
    };
  }
  return { ok: true, style: candidate, warnings: [] };
}

function finalChangedIds(
  diff: readonly StyleDiffEntry[],
  context: OperationContext,
): { changedLayers: string[]; changedSources: string[] } {
  const changedLayers: string[] = [];
  const changedSources: string[] = [];
  const seenLayers = new Set<string>();
  const seenSources = new Set<string>();

  for (const entry of diff) {
    if (entry.target.kind === 'layer'
      && context.changedLayerIds.has(entry.target.id)
      && !seenLayers.has(entry.target.id)) {
      seenLayers.add(entry.target.id);
      changedLayers.push(entry.target.id);
    }
    if (entry.target.kind === 'source'
      && context.changedSourceIds.has(entry.target.id)
      && !seenSources.has(entry.target.id)) {
      seenSources.add(entry.target.id);
      changedSources.push(entry.target.id);
    }
  }
  return { changedLayers, changedSources };
}

function finalizeValidatedStyle(
  failureStyle: StyleDocument,
  original: StyleDocument,
  candidate: StyleDocument,
  context: OperationContext,
): StyleTransactionResult {
  let diff: StyleDiffEntry[];
  try {
    diff = diffStyleDocuments(original, candidate, context);
  } catch {
    return failureResult(failureStyle, createStyleToolError(
      'INTERNAL', 'Style diff generation failed.', '/diff',
    ), context.warnings);
  }

  let actualBytes: number;
  try {
    actualBytes = jsonUtf8ByteLength(diff as JsonValue);
  } catch {
    return failureResult(failureStyle, createStyleToolError(
      'INTERNAL', 'Style diff could not be serialized for size validation.', '/diff',
    ), context.warnings);
  }
  if (actualBytes > context.limits.maxDiffBytes) {
    return failureResult(failureStyle, createStyleToolError(
      'INVALID_INPUT',
      'Style diff exceeds the configured UTF-8 JSON size limit.',
      '/diff',
      {
        reason: 'maxDiffBytes',
        maxBytes: context.limits.maxDiffBytes,
        actualBytes,
      },
    ), context.warnings);
  }

  const { changedLayers, changedSources } = finalChangedIds(diff, context);
  return {
    ok: true,
    style: candidate,
    changedLayers,
    changedSources,
    diff,
    warnings: context.warnings,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled style operation: ${JSON.stringify(value)}`);
}

type HandledStyleOperation = Extract<
  StyleOperation, {
    op:
      | 'setLayerProperties'
      | 'duplicateLayer'
      | 'moveLayer'
      | 'reorderLayers'
      | 'removeLayer'
      | 'addLayerFromSource'
      | 'addGeoJsonLayer'
      | 'setStyleRootProperties'
      | 'setLayerFilter'
      | 'setGeoJsonSourceFilter'
      | 'addSource'
      | 'duplicateSource'
      | 'renameSource'
      | 'removeSource'
      | 'patchSource'
      | 'setGeoJsonData'
      | 'addLayerDefinition'
      | 'deepMergeLayerDefinition'
      | 'replaceLayerDefinition'
      | 'deepMergeSourceDefinition'
      | 'replaceSourceDefinition'
      | 'replaceRootProperty'
      | 'shallowPatchRootProperty';
  }
>;
type UnhandledStyleOperation = Exclude<StyleOperation, HandledStyleOperation>;

function applyOperation(
  style: StyleDocument,
  operation: StyleOperation,
  context: OperationContext,
): OperationApplyResult {
  try {
    switch (operation.op) {
      case 'setLayerProperties':
        return applySetLayerProperties(style, operation, context);
      case 'duplicateLayer':
      case 'moveLayer':
      case 'reorderLayers':
      case 'removeLayer':
      case 'addLayerFromSource':
      case 'addGeoJsonLayer':
        return applyLayerOperation(style, operation, context);
      case 'setStyleRootProperties':
        return applyRootOperation(style, operation, context);
      case 'setLayerFilter':
        return applySetLayerFilter(style, operation, context);
      case 'setGeoJsonSourceFilter':
        return applySetGeoJsonSourceFilter(style, operation, context);
      case 'addSource':
      case 'duplicateSource':
      case 'renameSource':
      case 'removeSource':
      case 'patchSource':
      case 'setGeoJsonData':
        return applySourceOperation(style, operation, context);
      case 'addLayerDefinition':
      case 'deepMergeLayerDefinition':
      case 'replaceLayerDefinition':
      case 'deepMergeSourceDefinition':
      case 'replaceSourceDefinition':
      case 'replaceRootProperty':
      case 'shallowPatchRootProperty':
        return applyCompatibilityStyleOperation(style, operation, context);
      default:
        return assertNever(operation as UnhandledStyleOperation);
    }
  } catch (error) {
    return {
      ok: false,
      error: isStyleToolError(error)
        ? error
        : createStyleToolError('INTERNAL', 'Style operation failed unexpectedly.'),
    };
  }
}

export function applyStyleTransaction(
  style: StyleDocument,
  transaction: unknown,
  options: StyleTransactionOptions = {},
): StyleTransactionResult {
  const resolved = resolveTransactionLimits(options);
  if (!resolved.ok) return failureResult(style, resolved.error);

  const schema = createStyleTransactionSchema(resolved.limits.maxOperations);
  let parsed: ReturnType<typeof schema.safeParse>;
  try {
    parsed = schema.safeParse(transaction);
  } catch {
    return failureResult(style, createStyleToolError(
      'INVALID_INPUT', 'Transaction must be a strict JSON document.', '',
    ));
  }
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failureResult(style, issue === undefined
      ? createStyleToolError('INVALID_INPUT', 'Transaction is invalid.', '')
      : schemaError(issue));
  }

  const originalValidation = validateStyleDocument(style, {
    maxStyleBytes: resolved.limits.maxStyleBytes,
  });
  if (!originalValidation.ok) {
    return failureResult(
      style,
      originalValidation.errors[0] ?? createStyleToolError(
        'STYLE_INVALID', 'MapLibre style validation failed.',
      ),
      originalValidation.warnings,
    );
  }

  const original = originalValidation.style;
  let working: StyleDocument;
  try {
    working = cloneStrictJsonValue(original);
  } catch (error) {
    return failureResult(
      style,
      isStyleToolError(error)
        ? error
        : createStyleToolError('INTERNAL', 'Validated style could not be cloned.'),
      originalValidation.warnings,
    );
  }
  const context: OperationContext = {
    limits: resolved.limits,
    changedLayerIds: new Set(),
    changedSourceIds: new Set(),
    warnings: [],
  };
  context.warnings.push(...originalValidation.warnings);

  for (const operation of parsed.data.operations) {
    const result = applyOperation(working, operation, context);
    if (!result.ok) return failureResult(style, result.error, context.warnings);
  }

  const candidateValidation = validateCandidateStyle(
    working, context, parsed.data.validate,
  );
  if (!candidateValidation.ok) {
    return failureResult(
      style,
      candidateValidation.error,
      [...context.warnings, ...candidateValidation.warnings],
    );
  }
  context.warnings.push(...candidateValidation.warnings);
  return finalizeValidatedStyle(
    style, original, candidateValidation.style, context,
  );
}

export function finalizeStyleReplacement(
  original: StyleDocument,
  replacement: unknown,
  options: StyleReplacementOptions = {},
): StyleTransactionResult {
  const resolved = resolveReplacementLimits(options);
  if (!resolved.ok) return failureResult(original, resolved.error);

  const originalValidation = validateStyleDocument(original, {
    maxStyleBytes: resolved.limits.maxStyleBytes,
  });
  if (!originalValidation.ok) {
    return failureResult(
      original,
      originalValidation.errors[0] ?? createStyleToolError(
        'STYLE_INVALID', 'MapLibre style validation failed.',
      ),
      originalValidation.warnings,
    );
  }

  const replacementValidation = validateStyleDocument(replacement, {
    maxStyleBytes: resolved.limits.maxStyleBytes,
  });
  if (!replacementValidation.ok) {
    return failureResult(
      original,
      replacementValidation.errors[0] ?? createStyleToolError(
        'STYLE_INVALID', 'MapLibre style validation failed.',
      ),
      [...originalValidation.warnings, ...replacementValidation.warnings],
    );
  }

  const context: OperationContext = {
    limits: resolved.limits,
    changedLayerIds: new Set(),
    changedSourceIds: new Set(),
    warnings: [
      ...originalValidation.warnings,
      ...replacementValidation.warnings,
    ],
  };
  for (const layer of originalValidation.style.layers) {
    context.changedLayerIds.add(layer.id);
  }
  for (const layer of replacementValidation.style.layers) {
    context.changedLayerIds.add(layer.id);
  }
  for (const sourceId of Object.keys(originalValidation.style.sources)) {
    context.changedSourceIds.add(sourceId);
  }
  for (const sourceId of Object.keys(replacementValidation.style.sources)) {
    context.changedSourceIds.add(sourceId);
  }

  return finalizeValidatedStyle(
    original,
    originalValidation.style,
    replacementValidation.style,
    context,
  );
}
