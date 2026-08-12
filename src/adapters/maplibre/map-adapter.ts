import type { Map, StyleSpecification } from 'maplibre-gl';
import { canonicalizeJson } from '../../core/canonical-json.js';
import {
  applyStyleTransaction,
  createStyleToolError,
  finalizeStyleReplacement,
  isStyleToolError,
  jsonValueSchema,
  validateStyleDocument,
} from '../../core/index.js';
import type {
  StyleDiffEntry,
  StyleDocument,
  StyleToolError,
  StyleTransactionOptions,
  StyleTransactionResult,
  StyleWarning,
} from '../../core/index.js';
import { hashStyle as defaultHashStyle } from './style-hash.js';
import type {
  ApplyTransactionToMapOptions,
  DeepReadonlyPrepared,
  MapOperationDeadline,
  MapStyleApplyResult,
  MapStyleCurrentResult,
  MapStylePreOperationResult,
  MapStyleUnavailableResult,
  PreparedMapStyleTransactionView,
  PreparedStyleApplyOptions,
  WholeStyleApplyOptions,
  WholeStyleInput,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const preparedMapStyleTransactionBrand: unique symbol = Symbol('PreparedMapStyleTransaction');

type SuccessfulTransactionResult = Extract<StyleTransactionResult, { ok: true }>;
type PreparedMapStyleTransactionAuthority = DeepReadonlyPrepared<{
  baselineStyle: StyleDocument;
  candidateStyle: StyleDocument;
  baselineCanonical: string;
  candidateCanonical: string;
  baselineHash: string;
  transactionResult: SuccessfulTransactionResult;
  limitOptions: StyleTransactionOptions;
}>;

export type PreparedMapStyleTransaction = Readonly<{
  view: PreparedMapStyleTransactionView;
  readonly [preparedMapStyleTransactionBrand]: true;
}>;

const preparedMapStyleTransactionHandles = new WeakSet<object>();
const preparedMapStyleTransactionAuthorities =
  new WeakMap<object, PreparedMapStyleTransactionAuthority>();

type ValidatedMapStyle =
  | { ok: true; style: StyleDocument; warnings: StyleWarning[] }
  | { ok: false; error: StyleToolError; warnings: StyleWarning[] };

type PreInvokeGuardResult =
  | { ok: true }
  | { ok: false; authority: 'current'; style: StyleDocument; error: StyleToolError }
  | { ok: false; authority: 'pre-operation'; error: StyleToolError };

class MapWaitFailure extends Error {
  readonly styleToolError: StyleToolError;
  readonly mutationStarted: boolean;

  constructor(
    styleToolError: StyleToolError,
    mutationStarted: boolean,
  ) {
    super(styleToolError.message);
    this.styleToolError = styleToolError;
    this.mutationStarted = mutationStarted;
  }
}

type SuccessResultLike = {
  readonly style: unknown;
  readonly changedLayers: unknown;
  readonly changedSources: unknown;
  readonly diff: unknown;
  readonly warnings: unknown;
};

function clonePreparedJson<Value>(value: unknown): Value {
  const parsed = jsonValueSchema.safeParse(value);
  if (!parsed.success) throw new TypeError('Prepared JSON snapshot failed.');
  return parsed.data as Value;
}

function deepFreeze<Value>(value: Value): DeepReadonlyPrepared<Value> {
  if (typeof value !== 'object' || value === null) {
    return value as DeepReadonlyPrepared<Value>;
  }
  const work: object[] = [value];
  const seen = new WeakSet<object>();
  while (work.length > 0) {
    const current = work.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined && 'value' in descriptor
        && typeof descriptor.value === 'object' && descriptor.value !== null) {
        work.push(descriptor.value);
      }
    }
    Object.freeze(current);
  }
  return value as DeepReadonlyPrepared<Value>;
}

function frozenJson<Value>(value: DeepReadonlyPrepared<Value>): Value {
  return value as Value;
}

function cloneSuccessResult(result: SuccessResultLike): SuccessfulTransactionResult {
  return {
    ok: true,
    style: clonePreparedJson<StyleDocument>(result.style),
    changedLayers: clonePreparedJson<string[]>(result.changedLayers),
    changedSources: clonePreparedJson<string[]>(result.changedSources),
    diff: clonePreparedJson<StyleDiffEntry[]>(result.diff),
    warnings: clonePreparedJson<StyleWarning[]>(result.warnings),
  };
}

function copyTransactionLimits(
  options: Pick<
    ApplyTransactionToMapOptions,
    'maxStyleBytes' | 'maxDiffBytes' | 'maxOperations'
  > | undefined,
): StyleTransactionOptions {
  return {
    maxStyleBytes: options?.maxStyleBytes,
    maxDiffBytes: options?.maxDiffBytes,
    maxOperations: options?.maxOperations,
  };
}

function createPreparedMapStyleTransaction(
  baselineStyle: StyleDocument,
  candidateStyle: StyleDocument,
  baselineCanonical: string,
  candidateCanonical: string,
  baselineHash: string,
  transactionResult: SuccessfulTransactionResult,
  limitOptions: StyleTransactionOptions,
): PreparedMapStyleTransaction {
  const privateLimits = deepFreeze({
    maxStyleBytes: limitOptions.maxStyleBytes,
    maxDiffBytes: limitOptions.maxDiffBytes,
    maxOperations: limitOptions.maxOperations,
  });
  const authority: PreparedMapStyleTransactionAuthority = deepFreeze({
    baselineStyle: clonePreparedJson<StyleDocument>(baselineStyle),
    candidateStyle: clonePreparedJson<StyleDocument>(candidateStyle),
    baselineCanonical,
    candidateCanonical,
    baselineHash,
    transactionResult: cloneSuccessResult(transactionResult),
    limitOptions: privateLimits,
  });
  const view: PreparedMapStyleTransactionView = deepFreeze({
    baselineHash,
    transactionResult: cloneSuccessResult(transactionResult),
    limitOptions: {
      maxStyleBytes: limitOptions.maxStyleBytes,
      maxDiffBytes: limitOptions.maxDiffBytes,
      maxOperations: limitOptions.maxOperations,
    },
  });
  const handle: PreparedMapStyleTransaction = Object.create(null);
  Object.defineProperties(handle, {
    view: {
      configurable: false,
      enumerable: true,
      value: view,
      writable: false,
    },
    [preparedMapStyleTransactionBrand]: {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    },
  });
  Object.freeze(handle);
  preparedMapStyleTransactionHandles.add(handle);
  preparedMapStyleTransactionAuthorities.set(handle, authority);
  return handle;
}

function isRecursivelyFrozen(value: object): boolean {
  const work: object[] = [value];
  const seen = new WeakSet<object>();
  try {
    while (work.length > 0) {
      const current = work.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      if (!Object.isFrozen(current)) return false;
      for (const key of Reflect.ownKeys(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor === undefined || !('value' in descriptor)) return false;
        if (typeof descriptor.value === 'object' && descriptor.value !== null) {
          work.push(descriptor.value);
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

function preparedAuthority(value: unknown): PreparedMapStyleTransactionAuthority | undefined {
  if (typeof value !== 'object' || value === null
    || !preparedMapStyleTransactionHandles.has(value)) return undefined;
  const authority = preparedMapStyleTransactionAuthorities.get(value);
  if (authority === undefined) return undefined;
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 2 || !keys.includes('view')
      || !keys.includes(preparedMapStyleTransactionBrand)) return undefined;
    const viewDescriptor = Object.getOwnPropertyDescriptor(value, 'view');
    const brandDescriptor = Object.getOwnPropertyDescriptor(
      value, preparedMapStyleTransactionBrand,
    );
    if (viewDescriptor === undefined || !('value' in viewDescriptor)
      || viewDescriptor.configurable || !viewDescriptor.enumerable || viewDescriptor.writable
      || typeof viewDescriptor.value !== 'object' || viewDescriptor.value === null
      || brandDescriptor === undefined || !('value' in brandDescriptor)
      || brandDescriptor.value !== true || brandDescriptor.configurable
      || brandDescriptor.enumerable || brandDescriptor.writable
      || !isRecursivelyFrozen(value)) return undefined;
  } catch {
    return undefined;
  }
  return authority;
}

function cloneWarnings(warnings: unknown): StyleWarning[] {
  return clonePreparedJson<StyleWarning[]>(warnings);
}

function unavailableResult(
  error: StyleToolError,
  warnings: StyleWarning[] = [],
): MapStyleUnavailableResult {
  return {
    ok: false,
    styleAuthority: 'unavailable',
    applied: false,
    changedLayers: [],
    changedSources: [],
    diff: [],
    warnings: cloneWarnings(warnings),
    error,
  };
}

function currentFailure(
  style: StyleDocument,
  error: StyleToolError,
  warnings: StyleWarning[] = [],
  rolledBack?: boolean,
  rollbackError?: StyleToolError,
): MapStyleCurrentResult {
  const result: MapStyleCurrentResult = {
    ok: false,
    style,
    styleAuthority: 'current',
    applied: false,
    changedLayers: [],
    changedSources: [],
    diff: [],
    warnings: cloneWarnings(warnings),
    error,
  };
  if (rolledBack !== undefined) result.rolledBack = rolledBack;
  if (rollbackError !== undefined) result.rollbackError = rollbackError;
  return result;
}

function preOperationFailure(
  savedStyle: StyleDocument,
  error: StyleToolError,
  warnings: StyleWarning[] = [],
  rollbackError?: StyleToolError,
): MapStylePreOperationResult {
  const result: MapStylePreOperationResult = {
    ok: false,
    style: clonePreparedJson<StyleDocument>(savedStyle),
    styleAuthority: 'pre-operation',
    applied: false,
    changedLayers: [],
    changedSources: [],
    diff: [],
    warnings: cloneWarnings(warnings),
    error,
  };
  if (rollbackError !== undefined) {
    result.rolledBack = false;
    result.rollbackError = rollbackError;
  }
  return result;
}

function currentSuccess(
  style: StyleDocument,
  transactionResult: SuccessResultLike,
  applied: boolean,
): MapStyleCurrentResult {
  const publicResult = cloneSuccessResult(transactionResult);
  return {
    ...publicResult,
    style,
    styleAuthority: 'current',
    applied,
  };
}

async function nonMutationFailureResult(
  map: Map,
  failure: MapWaitFailure,
  baselineStyle: StyleDocument,
  maxStyleBytes: number | undefined,
  warnings: StyleWarning[],
): Promise<MapStyleApplyResult> {
  await Promise.resolve();
  const fresh = readValidatedMapStyle(map, maxStyleBytes);
  return fresh.ok
    ? currentFailure(fresh.style, failure.styleToolError, warnings)
    : preOperationFailure(baselineStyle, failure.styleToolError, warnings);
}

function normalizeFailure(error: unknown, message: string): StyleToolError {
  return isStyleToolError(error)
    ? error
    : createStyleToolError('INTERNAL', message);
}

function firstValidationError(result: Extract<ValidatedMapStyle, { ok: false }>): StyleToolError {
  return result.error;
}

function readValidatedMapStyle(
  map: Map,
  maxStyleBytes: number | undefined,
): ValidatedMapStyle {
  let rawStyle: StyleSpecification;
  try {
    rawStyle = map.getStyle();
  } catch {
    return {
      ok: false,
      error: createStyleToolError('INTERNAL', 'Map style could not be read.'),
      warnings: [],
    };
  }
  const validation = validateStyleDocument(
    rawStyle,
    maxStyleBytes === undefined ? {} : { maxStyleBytes },
  );
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

function deadlineNow(deadline: MapOperationDeadline): number {
  try {
    return deadline.now === undefined ? Date.now() : deadline.now();
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function timeoutError(deadline: MapOperationDeadline): StyleToolError {
  return deadline.signal?.aborted === true
    ? createStyleToolError(
      'TIMEOUT', 'Map style operation was aborted.', '', { reason: 'aborted' },
    )
    : createStyleToolError('TIMEOUT', 'Map style operation timed out.');
}

function deadlineFailure(deadline: MapOperationDeadline): StyleToolError | undefined {
  if (deadline.signal?.aborted === true) return timeoutError(deadline);
  const now = deadlineNow(deadline);
  if (!Number.isFinite(deadline.expiresAt) || !Number.isFinite(now)
    || deadline.expiresAt <= now) return timeoutError(deadline);
  return undefined;
}

function stampDeadline(timeoutMs: number | undefined): MapOperationDeadline {
  const now = Date.now();
  return { expiresAt: now + (timeoutMs ?? DEFAULT_TIMEOUT_MS) };
}

function raceWithMapDeadline<Value>(
  work: Promise<Value>,
  deadline: MapOperationDeadline,
): Promise<Value> {
  const alreadyFailed = deadlineFailure(deadline);
  if (alreadyFailed !== undefined) {
    void work.then(() => undefined, () => undefined);
    return Promise.reject(alreadyFailed);
  }
  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    const signal = deadline.signal;
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onAbort = (): void => {
      finish(() => reject(timeoutError(deadline)));
    };
    const remaining = Math.max(0, deadline.expiresAt - deadlineNow(deadline));
    const timer = setTimeout(() => {
      finish(() => reject(timeoutError(deadline)));
    }, remaining);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted === true) onAbort();
    work.then(
      (value) => {
        const failed = deadlineFailure(deadline);
        finish(() => failed === undefined ? resolve(value) : reject(failed));
      },
      (error: unknown) => {
        const failed = deadlineFailure(deadline);
        finish(() => reject(failed ?? error));
      },
    );
  });
}

async function hashWithDeadline(
  style: StyleDocument,
  hash: (style: StyleDocument) => Promise<string>,
  deadline: MapOperationDeadline,
): Promise<string> {
  const failed = deadlineFailure(deadline);
  if (failed !== undefined) throw failed;
  const snapshot = frozenJson<StyleDocument>(deepFreeze(
    clonePreparedJson<StyleDocument>(style),
  ));
  const work = Promise.resolve().then(() => hash(snapshot));
  return raceWithMapDeadline(work, deadline);
}

function guardBaselineBeforeInvoke(
  map: Map,
  maxStyleBytes: number | undefined,
  baselineCanonical: string,
): PreInvokeGuardResult {
  const current = readValidatedMapStyle(map, maxStyleBytes);
  if (!current.ok) {
    return {
      ok: false,
      authority: 'pre-operation',
      error: firstValidationError(current),
    };
  }
  let canonical: string;
  try {
    canonical = canonicalizeJson(current.style);
  } catch {
    return {
      ok: false,
      authority: 'current',
      style: current.style,
      error: createStyleToolError(
        'INTERNAL', 'Validated Map style could not be canonicalized.',
      ),
    };
  }
  if (canonical !== baselineCanonical) {
    return {
      ok: false,
      authority: 'current',
      style: current.style,
      error: createStyleToolError(
        'REVISION_CONFLICT', 'Map style changed before live mutation.',
      ),
    };
  }
  return { ok: true };
}

async function waitForStyle(
  map: Map,
  invoke: () => void,
  expectedHash: string | undefined,
  maxStyleBytes: number | undefined,
  hash: (style: StyleDocument) => Promise<string>,
  deadline: MapOperationDeadline,
  allowPostCallLoaded: boolean,
  preInvokeGuard: () => PreInvokeGuardResult,
): Promise<StyleDocument> {
  const failed = deadlineFailure(deadline);
  if (failed !== undefined) throw new MapWaitFailure(failed, false);

  let resolveWork!: (style: StyleDocument) => void;
  let rejectWork!: (error: unknown) => void;
  let settled = false;
  let inspecting = false;
  let inspectAgain = false;
  let invoked = false;
  let invoking = false;
  let pendingInvokeLoad = false;
  let completionGeneration = 0;
  let mutationStarted = false;
  const work = new Promise<StyleDocument>((resolve, reject) => {
    resolveWork = resolve;
    rejectWork = reject;
  });
  const settleSuccess = (style: StyleDocument): void => {
    if (settled) return;
    settled = true;
    resolveWork(style);
  };
  const settleFailure = (error: unknown): void => {
    if (settled) return;
    settled = true;
    rejectWork(error);
  };
  const inspect = async (): Promise<void> => {
    if (settled) return;
    if (inspecting) {
      inspectAgain = true;
      return;
    }
    inspecting = true;
    try {
      do {
        inspectAgain = false;
        let retryUnsignaledChange = true;
        while (!settled) {
          const generation = completionGeneration;
          const current = readValidatedMapStyle(map, maxStyleBytes);
          if (!current.ok) {
            settleFailure(firstValidationError(current));
            return;
          }
          const canonical = canonicalizeJson(current.style);
          const actualHash = expectedHash === undefined
            ? undefined
            : await hashWithDeadline(current.style, hash, deadline);
          if (expectedHash === undefined) await Promise.resolve();
          const afterHashFailure = deadlineFailure(deadline);
          if (afterHashFailure !== undefined) {
            settleFailure(afterHashFailure);
            return;
          }
          const fresh = readValidatedMapStyle(map, maxStyleBytes);
          if (!fresh.ok) {
            settleFailure(firstValidationError(fresh));
            return;
          }
          const freshCanonical = canonicalizeJson(fresh.style);
          if (generation !== completionGeneration) continue;
          if (canonical !== freshCanonical) {
            if (retryUnsignaledChange) {
              retryUnsignaledChange = false;
              continue;
            }
            return;
          }
          if (expectedHash === undefined || actualHash === expectedHash) {
            settleSuccess(fresh.style);
          }
          return;
        }
      } while (inspectAgain && !settled);
    } catch (error) {
      settleFailure(error);
    } finally {
      inspecting = false;
    }
  };
  const onLoad = (): void => {
    if (invoking) {
      pendingInvokeLoad = true;
      return;
    }
    if (!invoked) return;
    completionGeneration += 1;
    void inspect();
  };
  const onError = (): void => {
    if (!invoking && !invoked) return;
    settleFailure(createStyleToolError('INTERNAL', 'Map style application failed.'));
  };

  try {
    map.on('style.load', onLoad);
    map.on('error', onError);
  } catch {
    try { map.off('style.load', onLoad); } catch { /* Best effort. */ }
    try { map.off('error', onError); } catch { /* Best effort. */ }
    throw new MapWaitFailure(
      createStyleToolError('INTERNAL', 'Map style listeners could not be installed.'),
      false,
    );
  }

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    try { map.off('style.load', onLoad); } catch { /* Best effort. */ }
    try { map.off('error', onError); } catch { /* Best effort. */ }
  };
  const raced = raceWithMapDeadline(work, deadline)
    .catch((error: unknown) => {
      if (error instanceof MapWaitFailure) throw error;
      throw new MapWaitFailure(
        normalizeFailure(error, 'Map style completion failed.'), mutationStarted,
      );
    })
    .finally(cleanup);

  const setupFailure = deadlineFailure(deadline);
  if (setupFailure !== undefined) {
    settleFailure(new MapWaitFailure(setupFailure, false));
    return raced;
  }
  const guardedDeadlineFailure = deadlineFailure(deadline);
  if (guardedDeadlineFailure !== undefined) {
    settleFailure(new MapWaitFailure(guardedDeadlineFailure, false));
    return raced;
  }
  const guard = preInvokeGuard();
  if (!guard.ok) {
    settleFailure(new MapWaitFailure(guard.error, false));
    return raced;
  }

  try {
    invoking = true;
    mutationStarted = true;
    invoke();
  } catch {
    settleFailure(createStyleToolError('INTERNAL', 'Map style application failed.'));
  } finally {
    invoking = false;
    invoked = true;
  }
  if (pendingInvokeLoad && !settled) {
    completionGeneration += 1;
    queueMicrotask(() => { void inspect(); });
  }
  if (allowPostCallLoaded && !settled) queueMicrotask(() => {
    if (settled) return;
    try {
      if (map.isStyleLoaded() === true) {
        completionGeneration += 1;
        void inspect();
      }
    } catch {
      settleFailure(createStyleToolError('INTERNAL', 'Map style state could not be read.'));
    }
  });
  return raced;
}

async function rollbackAfterFailure(
  map: Map,
  baselineStyle: StyleDocument,
  baselineHash: string,
  maxStyleBytes: number | undefined,
  diff: boolean,
  deadline: MapOperationDeadline,
  hash: (style: StyleDocument) => Promise<string>,
  primaryError: StyleToolError,
  warnings: StyleWarning[],
): Promise<MapStyleApplyResult> {
  let rollbackError: StyleToolError;
  try {
    const compatibleBaseline = toMapLibreStyleSpecification(baselineStyle);
    const restored = await waitForStyle(
      map,
      () => { map.setStyle(compatibleBaseline, { diff }); },
      baselineHash,
      maxStyleBytes,
      hash,
      deadline,
      true,
      () => ({ ok: true }),
    );
    return currentFailure(restored, primaryError, warnings, true);
  } catch (error) {
    rollbackError = error instanceof MapWaitFailure
      ? error.styleToolError
      : normalizeFailure(error, 'Map style rollback failed.');
    if (rollbackError.code === 'TIMEOUT') {
      return preOperationFailure(baselineStyle, primaryError, warnings, rollbackError);
    }
  }

  const firstState = readValidatedMapStyle(map, maxStyleBytes);
  if (firstState.ok) {
    let firstCanonical: string;
    try {
      firstCanonical = canonicalizeJson(firstState.style);
      await Promise.resolve();
    } catch {
      return preOperationFailure(baselineStyle, primaryError, warnings, rollbackError);
    }
    if (deadlineFailure(deadline) !== undefined) {
      return preOperationFailure(baselineStyle, primaryError, warnings, rollbackError);
    }
    const secondState = readValidatedMapStyle(map, maxStyleBytes);
    if (!secondState.ok) {
      return preOperationFailure(baselineStyle, primaryError, warnings, rollbackError);
    }
    let secondCanonical: string;
    try {
      secondCanonical = canonicalizeJson(secondState.style);
    } catch {
      return preOperationFailure(baselineStyle, primaryError, warnings, rollbackError);
    }
    if (firstCanonical !== secondCanonical) {
      return preOperationFailure(baselineStyle, primaryError, warnings, rollbackError);
    }
    return currentFailure(
      secondState.style, primaryError, warnings, false, rollbackError,
    );
  }
  return preOperationFailure(baselineStyle, primaryError, warnings, rollbackError);
}

export function toMapLibreStyleSpecification(style: StyleDocument): StyleSpecification {
  return style as StyleSpecification;
}

function hasStyleLifecycle(map: Map): boolean {
  return typeof map.on === 'function'
    && typeof map.off === 'function'
    && typeof map.isStyleLoaded === 'function';
}

/**
 * Compatibility boundary for legacy structural Map objects that only expose
 * getStyle/setStyle. This is intentionally a direct-module export: public
 * adapter consumers should provide the real MapLibre lifecycle.
 */
export function createLegacyMapLifecycleFacade(map: Map): Map {
  if (hasStyleLifecycle(map)) return map;

  let loaded = true;
  const listeners = new globalThis.Map<string, Set<(event: unknown) => void>>();
  const emit = (type: string, error?: StyleToolError): void => {
    const event = error === undefined ? { type } : { type, error };
    for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
  };
  const addListener = (type: string, listener: (event: unknown) => void) => {
    let registered = listeners.get(type);
    if (registered === undefined) {
      registered = new Set();
      listeners.set(type, registered);
    }
    registered.add(listener);
    return { unsubscribe: () => { registered.delete(listener); } };
  };
  const removeListener = (type: string, listener: (event: unknown) => void): Map => {
    listeners.get(type)?.delete(listener);
    return facade;
  };
  const installStyle = (
    style: Parameters<Map['setStyle']>[0],
    options?: Parameters<Map['setStyle']>[1],
  ): Map => {
    loaded = false;
    const expected = validateStyleDocument(style);
    if (!expected.ok) {
      queueMicrotask(() => emit('error', expected.errors[0]
        ?? createStyleToolError('STYLE_INVALID', 'MapLibre style validation failed.')));
      return facade;
    }
    const expectedCanonical = canonicalizeJson(expected.style);
    map.setStyle(style, options);
    queueMicrotask(() => {
      const fresh = readValidatedMapStyle(map, undefined);
      if (fresh.ok && canonicalizeJson(fresh.style) === expectedCanonical) {
        loaded = true;
        emit('style.load');
        return;
      }
      emit('error', fresh.ok
        ? createStyleToolError('INTERNAL', 'Map style application could not be verified.')
        : fresh.error);
    });
    return facade;
  };
  const facade = new Proxy(map, {
    get(target, property) {
      if (property === 'getStyle') return () => target.getStyle();
      if (property === 'isStyleLoaded') return () => loaded;
      if (property === 'on') return addListener;
      if (property === 'off') return removeListener;
      if (property === 'setStyle') return installStyle;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return facade;
}

export async function prepareTransactionForMap(
  map: Map,
  transaction: unknown,
  options?: Pick<
    ApplyTransactionToMapOptions,
    'hashStyle' | 'deadline' | 'maxStyleBytes' | 'maxDiffBytes' | 'maxOperations'
  >,
): Promise<PreparedMapStyleTransaction | MapStyleApplyResult> {
  const limitOptions = copyTransactionLimits(options);
  const deadline = options?.deadline ?? stampDeadline(undefined);
  const hash = options?.hashStyle ?? defaultHashStyle;
  const baselineRead = readValidatedMapStyle(map, limitOptions.maxStyleBytes);
  if (!baselineRead.ok) {
    return unavailableResult(firstValidationError(baselineRead), baselineRead.warnings);
  }
  const baseline = baselineRead.style;
  const preflight = finalizeStyleReplacement(baseline, baseline, {
    maxStyleBytes: limitOptions.maxStyleBytes,
    maxDiffBytes: limitOptions.maxDiffBytes,
  });
  if (!preflight.ok) {
    return currentFailure(baseline, preflight.error, preflight.warnings);
  }
  const beforeCanonical = deadlineFailure(deadline);
  if (beforeCanonical !== undefined) {
    return currentFailure(baseline, beforeCanonical, preflight.warnings);
  }

  let baselineCanonical: string;
  try {
    baselineCanonical = canonicalizeJson(baseline);
  } catch {
    return currentFailure(
      baseline,
      createStyleToolError('INTERNAL', 'Validated Map style could not be canonicalized.'),
      preflight.warnings,
    );
  }
  const afterCanonical = deadlineFailure(deadline);
  if (afterCanonical !== undefined) {
    return currentFailure(baseline, afterCanonical, preflight.warnings);
  }

  let baselineHash: string;
  try {
    baselineHash = await hashWithDeadline(baseline, hash, deadline);
  } catch (error) {
    const hashError = normalizeFailure(error, 'Map style hashing failed.');
    const latestRead = readValidatedMapStyle(map, limitOptions.maxStyleBytes);
    return latestRead.ok
      ? currentFailure(latestRead.style, hashError, preflight.warnings)
      : preOperationFailure(baseline, hashError, preflight.warnings);
  }
  const beforeTransaction = deadlineFailure(deadline);
  if (beforeTransaction !== undefined) {
    return currentFailure(baseline, beforeTransaction, preflight.warnings);
  }
  const transactionResult = applyStyleTransaction(baseline, transaction, limitOptions);
  const afterTransaction = deadlineFailure(deadline);
  if (afterTransaction !== undefined) {
    return currentFailure(baseline, afterTransaction, transactionResult.warnings);
  }
  if (!transactionResult.ok) {
    return currentFailure(
      baseline, transactionResult.error, transactionResult.warnings,
    );
  }

  let candidateCanonical: string;
  try {
    candidateCanonical = canonicalizeJson(transactionResult.style);
  } catch {
    return currentFailure(
      baseline,
      createStyleToolError('INTERNAL', 'Validated candidate Style could not be canonicalized.'),
      transactionResult.warnings,
    );
  }
  const beforeFactory = deadlineFailure(deadline);
  if (beforeFactory !== undefined) {
    return currentFailure(baseline, beforeFactory, transactionResult.warnings);
  }
  try {
    return createPreparedMapStyleTransaction(
      baseline,
      transactionResult.style,
      baselineCanonical,
      candidateCanonical,
      baselineHash,
      transactionResult,
      limitOptions,
    );
  } catch {
    return currentFailure(
      baseline,
      createStyleToolError('INTERNAL', 'Prepared Map transaction snapshot failed.'),
      transactionResult.warnings,
    );
  }
}

export async function applyPreparedStyleToMap(
  map: Map,
  prepared: PreparedMapStyleTransaction,
  options?: PreparedStyleApplyOptions,
): Promise<MapStyleApplyResult> {
  const authority = preparedAuthority(prepared);
  if (authority === undefined) {
    return unavailableResult(createStyleToolError(
      'INVALID_INPUT', 'Prepared Map style transaction is invalid.',
    ));
  }

  const deadline = options?.deadline ?? stampDeadline(undefined);
  const hash = options?.hashStyle ?? defaultHashStyle;
  const diff = options?.diff ?? true;
  const maxStyleBytes = authority.limitOptions.maxStyleBytes;
  const baselineStyle = frozenJson<StyleDocument>(authority.baselineStyle);
  const currentRead = readValidatedMapStyle(map, maxStyleBytes);
  if (!currentRead.ok) {
    return preOperationFailure(
      baselineStyle,
      firstValidationError(currentRead),
      cloneWarnings(authority.transactionResult.warnings),
    );
  }
  const current = currentRead.style;
  let currentCanonical: string;
  try {
    currentCanonical = canonicalizeJson(current);
  } catch {
    return currentFailure(
      current,
      createStyleToolError('INTERNAL', 'Validated Map style could not be canonicalized.'),
      cloneWarnings(authority.transactionResult.warnings),
    );
  }
  if (currentCanonical !== authority.baselineCanonical) {
    return currentFailure(
      current,
      createStyleToolError(
        'REVISION_CONFLICT', 'Map style changed after transaction preparation.',
      ),
      cloneWarnings(authority.transactionResult.warnings),
    );
  }
  const expired = deadlineFailure(deadline);
  if (expired !== undefined) {
    return currentFailure(
      current, expired, cloneWarnings(authority.transactionResult.warnings),
    );
  }
  if (authority.candidateCanonical === authority.baselineCanonical) {
    return currentSuccess(current, authority.transactionResult, false);
  }

  const candidateStyle = frozenJson<StyleDocument>(authority.candidateStyle);
  let baselineHash: string;
  let candidateHash: string;
  try {
    baselineHash = await hashWithDeadline(baselineStyle, hash, deadline);
    candidateHash = await hashWithDeadline(candidateStyle, hash, deadline);
  } catch (error) {
    const hashError = normalizeFailure(error, 'Map style hashing failed.');
    const latestRead = readValidatedMapStyle(map, maxStyleBytes);
    return latestRead.ok
      ? currentFailure(
        latestRead.style,
        hashError,
        cloneWarnings(authority.transactionResult.warnings),
      )
      : preOperationFailure(
        baselineStyle,
        hashError,
        cloneWarnings(authority.transactionResult.warnings),
      );
  }

  const immediateRead = readValidatedMapStyle(map, maxStyleBytes);
  if (!immediateRead.ok) {
    return preOperationFailure(
      baselineStyle,
      firstValidationError(immediateRead),
      cloneWarnings(authority.transactionResult.warnings),
    );
  }
  const immediateCurrent = immediateRead.style;
  let immediateCanonical: string;
  try {
    immediateCanonical = canonicalizeJson(immediateCurrent);
  } catch {
    return currentFailure(
      immediateCurrent,
      createStyleToolError('INTERNAL', 'Validated Map style could not be canonicalized.'),
      cloneWarnings(authority.transactionResult.warnings),
    );
  }
  if (immediateCanonical !== authority.baselineCanonical) {
    return currentFailure(
      immediateCurrent,
      createStyleToolError(
        'REVISION_CONFLICT', 'Map style changed after transaction preparation.',
      ),
      cloneWarnings(authority.transactionResult.warnings),
    );
  }
  const immediateDeadlineFailure = deadlineFailure(deadline);
  if (immediateDeadlineFailure !== undefined) {
    return currentFailure(
      immediateCurrent,
      immediateDeadlineFailure,
      cloneWarnings(authority.transactionResult.warnings),
    );
  }

  try {
    const compatibleCandidate = toMapLibreStyleSpecification(candidateStyle);
    const confirmed = await waitForStyle(
      map,
      () => { map.setStyle(compatibleCandidate, { diff }); },
      candidateHash,
      maxStyleBytes,
      hash,
      deadline,
      true,
      () => guardBaselineBeforeInvoke(
        map, maxStyleBytes, authority.baselineCanonical,
      ),
    );
    return currentSuccess(confirmed, authority.transactionResult, true);
  } catch (error) {
    if (error instanceof MapWaitFailure && !error.mutationStarted) {
      return nonMutationFailureResult(
        map,
        error,
        baselineStyle,
        maxStyleBytes,
        cloneWarnings(authority.transactionResult.warnings),
      );
    }
    const primaryError = error instanceof MapWaitFailure
      ? error.styleToolError
      : normalizeFailure(error, 'Map style application failed.');
    return rollbackAfterFailure(
      map,
      baselineStyle,
      baselineHash,
      maxStyleBytes,
      diff,
      deadline,
      hash,
      primaryError,
      cloneWarnings(authority.transactionResult.warnings),
    );
  }
}

export async function applyTransactionToMap(
  map: Map,
  transaction: unknown,
  options?: ApplyTransactionToMapOptions,
): Promise<MapStyleApplyResult> {
  const deadline = options?.deadline ?? stampDeadline(options?.timeoutMs);
  const limitOptions = copyTransactionLimits(options);
  const hash = options?.hashStyle;
  const diff = options?.diff;
  const prepared = await prepareTransactionForMap(map, transaction, {
    deadline,
    hashStyle: hash,
    maxStyleBytes: limitOptions.maxStyleBytes,
    maxDiffBytes: limitOptions.maxDiffBytes,
    maxOperations: limitOptions.maxOperations,
  });
  if ('styleAuthority' in prepared) return prepared;
  return applyPreparedStyleToMap(map, prepared, {
    deadline,
    hashStyle: hash,
    diff,
  });
}

export async function applyStyleDocumentOrUrlToMap(
  map: Map,
  input: WholeStyleInput,
  options?: WholeStyleApplyOptions,
): Promise<MapStyleApplyResult> {
  const deadline = options?.deadline ?? stampDeadline(options?.timeoutMs);
  const hash = options?.hashStyle ?? defaultHashStyle;
  const diff = options?.diff ?? true;
  const maxStyleBytes = options?.maxStyleBytes;
  const maxDiffBytes = options?.maxDiffBytes;
  const baselineRead = readValidatedMapStyle(map, maxStyleBytes);
  if (!baselineRead.ok) {
    return unavailableResult(firstValidationError(baselineRead), baselineRead.warnings);
  }
  const baseline = baselineRead.style;
  let baselineCanonical: string;
  try {
    baselineCanonical = canonicalizeJson(baseline);
  } catch {
    return currentFailure(
      baseline,
      createStyleToolError('INTERNAL', 'Validated Map style could not be canonicalized.'),
      baselineRead.warnings,
    );
  }
  const preflight = finalizeStyleReplacement(baseline, baseline, {
    maxStyleBytes,
    maxDiffBytes,
  });
  if (!preflight.ok) {
    return currentFailure(baseline, preflight.error, preflight.warnings);
  }
  const expired = deadlineFailure(deadline);
  if (expired !== undefined) {
    return currentFailure(baseline, expired, preflight.warnings);
  }

  if (typeof input !== 'string') {
    const finalizer = finalizeStyleReplacement(baseline, input, {
      maxStyleBytes,
      maxDiffBytes,
    });
    const afterFinalizer = deadlineFailure(deadline);
    if (afterFinalizer !== undefined) {
      return currentFailure(baseline, afterFinalizer, finalizer.warnings);
    }
    if (!finalizer.ok) {
      return currentFailure(baseline, finalizer.error, finalizer.warnings);
    }
    if (finalizer.diff.length === 0) {
      return currentSuccess(baseline, finalizer, false);
    }

    let baselineHash: string;
    let candidateHash: string;
    try {
      baselineHash = await hashWithDeadline(baseline, hash, deadline);
      candidateHash = await hashWithDeadline(finalizer.style, hash, deadline);
    } catch (error) {
      const hashError = normalizeFailure(error, 'Map style hashing failed.');
      const latestRead = readValidatedMapStyle(map, maxStyleBytes);
      return latestRead.ok
        ? currentFailure(latestRead.style, hashError, finalizer.warnings)
        : preOperationFailure(baseline, hashError, finalizer.warnings);
    }
    try {
      const compatibleCandidate = toMapLibreStyleSpecification(finalizer.style);
      const confirmed = await waitForStyle(
        map,
        () => { map.setStyle(compatibleCandidate, { diff }); },
        candidateHash,
        maxStyleBytes,
        hash,
        deadline,
        true,
        () => guardBaselineBeforeInvoke(map, maxStyleBytes, baselineCanonical),
      );
      return currentSuccess(confirmed, finalizer, true);
    } catch (error) {
      if (error instanceof MapWaitFailure && !error.mutationStarted) {
        return nonMutationFailureResult(
          map, error, baseline, maxStyleBytes, finalizer.warnings,
        );
      }
      return rollbackAfterFailure(
        map,
        baseline,
        baselineHash,
        maxStyleBytes,
        diff,
        deadline,
        hash,
        error instanceof MapWaitFailure
          ? error.styleToolError
          : normalizeFailure(error, 'Map style application failed.'),
        finalizer.warnings,
      );
    }
  }

  if (input.length === 0) {
    return currentFailure(
      baseline,
      createStyleToolError('INVALID_INPUT', 'Style URL must be a non-empty string.'),
      preflight.warnings,
    );
  }
  let baselineHash: string;
  try {
    baselineHash = await hashWithDeadline(baseline, hash, deadline);
  } catch (error) {
    const hashError = normalizeFailure(error, 'Map style hashing failed.');
    const latestRead = readValidatedMapStyle(map, maxStyleBytes);
    return latestRead.ok
      ? currentFailure(latestRead.style, hashError, preflight.warnings)
      : preOperationFailure(baseline, hashError, preflight.warnings);
  }

  let resolvedStyle: StyleDocument;
  try {
    resolvedStyle = await waitForStyle(
      map,
      () => { map.setStyle(input, { diff }); },
      undefined,
      maxStyleBytes,
      hash,
      deadline,
      true,
      () => guardBaselineBeforeInvoke(map, maxStyleBytes, baselineCanonical),
    );
  } catch (error) {
    if (error instanceof MapWaitFailure && !error.mutationStarted) {
      return nonMutationFailureResult(
        map, error, baseline, maxStyleBytes, preflight.warnings,
      );
    }
    return rollbackAfterFailure(
      map,
      baseline,
      baselineHash,
      maxStyleBytes,
      diff,
      deadline,
      hash,
      error instanceof MapWaitFailure
        ? error.styleToolError
        : normalizeFailure(error, 'Map style URL loading failed.'),
      preflight.warnings,
    );
  }

  const finalizer = finalizeStyleReplacement(baseline, resolvedStyle, {
    maxStyleBytes,
    maxDiffBytes,
  });
  const afterFinalizer = deadlineFailure(deadline);
  if (!finalizer.ok || afterFinalizer !== undefined) {
    return rollbackAfterFailure(
      map,
      baseline,
      baselineHash,
      maxStyleBytes,
      diff,
      deadline,
      hash,
      afterFinalizer ?? (finalizer.ok
        ? createStyleToolError('INTERNAL', 'Style finalization failed.')
        : finalizer.error),
      finalizer.warnings,
    );
  }
  return currentSuccess(resolvedStyle, finalizer, true);
}
