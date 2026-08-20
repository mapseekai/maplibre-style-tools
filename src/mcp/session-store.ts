import { randomUUID } from 'node:crypto';

import { createStyleToolError } from '../core/errors.js';
import { jsonValueSchema } from '../core/schemas.js';
import type {
  JsonValue,
  StyleDiffEntry,
  StyleDocument,
  StyleTransactionResult,
} from '../core/types.js';
import {
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
} from '../core/utf8.js';
import {
  applyStyleTransaction,
  finalizeStyleReplacement,
  validateStyleDocument,
} from './core-adapters.js';
import { MAX_STYLE_SESSION_ID_BYTES } from './types.js';
import type {
  ApplySessionTransactionResult,
  ApplyStyleSessionRequest,
  CloseStyleSessionResult,
  ExportStyleSessionResult,
  OpenStyleSessionResult,
  RevisionSnapshot,
  SessionSnapshot,
  StyleSessionLimits,
  StyleSessionStoreOptions,
} from './types.js';

export const DEFAULT_STYLE_SESSION_LIMITS = Object.freeze({
  maxSessions: 32,
  maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
  maxOperations: DEFAULT_MAX_OPERATIONS,
  maxHistory: 20,
  maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
  ttlMs: 30 * 60_000,
}) satisfies StyleSessionLimits;

type DeepReadonly<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value;

export interface FrozenStyleFacade {
  readonly view: DeepReadonly<StyleDocument>;
  withStyle<Result>(reader: (style: StyleDocument) => Result): Result;
}

export interface FrozenSessionSnapshot
  extends Omit<DeepReadonly<SessionSnapshot>, 'style'> {
  readonly style: FrozenStyleFacade;
}

export interface FrozenRevisionSnapshot
  extends Omit<DeepReadonly<RevisionSnapshot>, 'style'> {
  readonly style: FrozenStyleFacade;
}

const styleSessionStoreBrand: unique symbol = Symbol('StyleSessionStore');

export interface StyleSessionStore {
  readonly [styleSessionStoreBrand]: true;
  readonly size: number;
  readonly limits: Readonly<StyleSessionLimits>;
  open(style: unknown): Promise<OpenStyleSessionResult>;
  close(sessionId: string): Promise<CloseStyleSessionResult>;
  read(sessionId: string): Promise<SessionSnapshot>;
  readRevision(sessionId: string, revision: number): Promise<RevisionSnapshot>;
  apply(
    sessionId: string,
    request: ApplyStyleSessionRequest,
  ): Promise<ApplySessionTransactionResult>;
  replace(
    sessionId: string,
    expectedRevision: number,
    style: unknown,
  ): Promise<ApplySessionTransactionResult>;
  export(sessionId: string, revision?: number): Promise<ExportStyleSessionResult>;
  dispose(): void;
}

interface StyleSessionCoreDependencies {
  readonly validateStyleDocument: typeof validateStyleDocument;
  readonly applyStyleTransaction: typeof applyStyleTransaction;
}

interface ProjectionAttempt {
  readonly kind: 'project';
  readonly sessionId: string;
}

interface RevisionReadAttempt {
  readonly kind: 'readRevision' | 'projectRevision';
  readonly sessionId: string;
  readonly revision: number | undefined;
}

interface StyleSessionStoreObserver {
  onProjectionAttempt?(attempt: ProjectionAttempt): void;
  onRevisionReadAttempt?(attempt: RevisionReadAttempt): void;
}

type QueuedWorkKind =
  | 'read'
  | 'readRevision'
  | 'export'
  | 'apply'
  | 'close'
  | 'project'
  | 'projectRevision';

interface StyleSessionQueueScheduler {
  beforeQueuedWork(work: {
    readonly sessionId: string;
    readonly kind: QueuedWorkKind;
  }): Promise<void>;
}

interface StyleSessionStoreTestHooks {
  readonly observer?: StyleSessionStoreObserver;
  readonly queueScheduler?: StyleSessionQueueScheduler;
}

interface InternalRevision {
  readonly revision: number;
  readonly style: StyleDocument;
  readonly incomingDiff: readonly StyleDiffEntry[];
  readonly committedAt: number;
}

interface InternalSession {
  readonly id: string;
  current: InternalRevision;
  history: InternalRevision[];
  lastAccessedAt: number;
  expiresAt: number;
  closing: boolean;
  tail: Promise<void>;
}

interface InternalStoreCapability {
  readonly store: StyleSessionStore;
  readonly project: <Result>(
    sessionId: string,
    projector: (snapshot: FrozenSessionSnapshot) => Result,
  ) => Promise<Result>;
  readonly projectRevision: <Result>(
    sessionId: string,
    revision: number | undefined,
    projector: (snapshot: FrozenRevisionSnapshot) => Result,
  ) => Promise<Result>;
  readonly apply: <Result>(
    sessionId: string,
    request: ApplyStyleSessionRequest,
    finalizer: (result: ApplySessionTransactionResult) => Result,
  ) => Promise<Result>;
}

const factoryStoreCapabilities = new WeakMap<StyleSessionStore, InternalStoreCapability>();

const defaultCoreDependencies: StyleSessionCoreDependencies = {
  validateStyleDocument,
  applyStyleTransaction,
};

const immediateQueueScheduler: StyleSessionQueueScheduler = {
  beforeQueuedWork: () => Promise.resolve(),
};

function sessionError(
  code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'REVISION_CONFLICT' | 'INTERNAL',
  message: string,
  reason: string,
  extra?: Record<string, JsonValue>,
) {
  return createStyleToolError(code, message, undefined, { reason, ...extra });
}

function assertValidResolvedSessionLimits(limits: StyleSessionLimits): void {
  for (const name of [
    'maxSessions',
    'maxStyleBytes',
    'maxOperations',
    'maxHistory',
    'maxDiffBytes',
    'ttlMs',
  ] as const) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] <= 0) {
      throw sessionError(
        'INVALID_INPUT',
        'Style session limit must be a positive safe integer.',
        'invalidLimit',
        { limit: name },
      );
    }
  }
}

function containsLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function assertValidSessionId(value: unknown): asserts value is string {
  let encoded: string;
  if (typeof value !== 'string' || value.length === 0 || containsLoneSurrogate(value)) {
    throw sessionError(
      'INVALID_INPUT', 'Generated session ID is invalid.', 'invalidSessionId',
    );
  }
  try {
    encoded = encodeURIComponent(value);
  } catch {
    throw sessionError(
      'INVALID_INPUT', 'Generated session ID is invalid.', 'invalidSessionId',
    );
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_STYLE_SESSION_ID_BYTES || encoded.length === 0) {
    throw sessionError(
      'INVALID_INPUT', 'Generated session ID is invalid.', 'invalidSessionId',
    );
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && 'value' in descriptor) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
}

function cloneKnownJson<Value>(value: Value): Value {
  return deepFreeze(structuredClone(value));
}

function cloneProjectionResult<Result>(value: Result): Result {
  const parsed = jsonValueSchema.safeParse(value);
  if (!parsed.success) {
    throw sessionError(
      'INTERNAL', 'Session projection produced an invalid result.', 'invalidSessionProjection',
    );
  }
  return deepFreeze(parsed.data) as Result;
}

function isThenable(value: unknown): boolean {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false;
  try {
    return typeof (value as { then?: unknown }).then === 'function';
  } catch {
    return true;
  }
}

function rejectAsyncProjection(): never {
  throw sessionError(
    'INTERNAL', 'Session projections must be synchronous.', 'asyncSessionProjection',
  );
}

function requireFactoryStoreCapability(value: unknown): InternalStoreCapability {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw sessionError(
      'INVALID_INPUT', 'Style session store was not created by the factory.',
      'invalidStyleSessionStore',
    );
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, styleSessionStoreBrand);
    const capability = factoryStoreCapabilities.get(value as StyleSessionStore);
    if (descriptor?.value === true && capability?.store === value) return capability;
  } catch {
    // Reflection failures are intentionally normalized below.
  }
  throw sessionError(
    'INVALID_INPUT', 'Style session store was not created by the factory.',
    'invalidStyleSessionStore',
  );
}

export const assertFactoryStyleSessionStore = (value: unknown): StyleSessionStore =>
  requireFactoryStoreCapability(value).store;

export const projectStyleSession = async <Result>(
  store: StyleSessionStore,
  sessionId: string,
  projector: (snapshot: FrozenSessionSnapshot) => Result,
): Promise<Result> => requireFactoryStoreCapability(store).project(sessionId, projector);

export const projectStyleSessionRevision = async <Result>(
  store: StyleSessionStore,
  sessionId: string,
  revision: number | undefined,
  projector: (snapshot: FrozenRevisionSnapshot) => Result,
): Promise<Result> => requireFactoryStoreCapability(store).projectRevision(
  sessionId,
  revision,
  projector,
);

export const applyStyleSessionTransactionResult = async <Result>(
  store: StyleSessionStore,
  sessionId: string,
  request: ApplyStyleSessionRequest,
  finalizer: (result: ApplySessionTransactionResult) => Result,
): Promise<Result> => requireFactoryStoreCapability(store).apply(
  sessionId,
  request,
  finalizer,
);

export function createStyleSessionStoreWithDependencies(
  options: StyleSessionStoreOptions = {},
  coreDependencyOverrides: Partial<StyleSessionCoreDependencies> = {},
  testHooks: StyleSessionStoreTestHooks = {},
): StyleSessionStore {
  const limits = Object.freeze({
    ...DEFAULT_STYLE_SESSION_LIMITS,
    ...options.limits,
  });
  assertValidResolvedSessionLimits(limits);

  const clock = options.clock ?? { now: Date.now };
  const idFactory = options.idFactory ?? randomUUID;
  const coreDependencies = Object.freeze({
    ...defaultCoreDependencies,
    ...coreDependencyOverrides,
  });
  const queueScheduler = testHooks.queueScheduler ?? immediateQueueScheduler;
  const observer = testHooks.observer;
  const sessions = new Map<string, InternalSession>();
  let disposed = false;

  const removeGeneration = (session: InternalSession): boolean => {
    if (sessions.get(session.id) !== session) return false;
    return sessions.delete(session.id);
  };

  const isExpired = (session: InternalSession, now: number): boolean => now > session.expiresAt;

  const sweepExpired = (now: number): void => {
    for (const session of sessions.values()) {
      if (isExpired(session, now)) removeGeneration(session);
    }
  };

  const missingSession = (reason = 'sessionNotFound') => sessionError(
    'NOT_FOUND', 'Style session was not found.', reason,
  );

  const captureSession = (sessionId: string): InternalSession => {
    const session = sessions.get(sessionId);
    if (session === undefined) throw missingSession();
    if (session.closing) throw missingSession('closing');
    return session;
  };

  const assertRunnable = (session: InternalSession, now: number): void => {
    if (sessions.get(session.id) !== session) throw missingSession('expired');
    if (isExpired(session, now)) {
      removeGeneration(session);
      throw missingSession('expired');
    }
  };

  const enqueue = <Result>(
    session: InternalSession,
    kind: QueuedWorkKind,
    work: () => Result,
  ): Promise<Result> => {
    const run = async () => {
      await queueScheduler.beforeQueuedWork({ sessionId: session.id, kind });
      return work();
    };
    const next = session.tail.then(run, run);
    session.tail = next.then(() => undefined, () => undefined);
    return next;
  };

  const touch = (session: InternalSession, now: number): void => {
    if (sessions.get(session.id) !== session) return;
    session.lastAccessedAt = now;
    session.expiresAt = now + limits.ttlMs;
  };

  const selectRevision = (session: InternalSession, revision: number | undefined): InternalRevision => {
    if (revision === undefined || revision === session.current.revision) return session.current;
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw sessionError('INVALID_INPUT', 'Revision must be a non-negative safe integer.', 'invalidRevision');
    }
    const retained = session.history.find((entry) => entry.revision === revision);
    if (retained !== undefined) return retained;
    throw missingSession('revisionEvicted');
  };

  const revisionSnapshot = (revision: InternalRevision): RevisionSnapshot => cloneKnownJson({
    revision: revision.revision,
    style: revision.style,
    incomingDiff: revision.incomingDiff,
    committedAt: revision.committedAt,
  });

  const sessionSnapshot = (session: InternalSession, now: number): SessionSnapshot => cloneKnownJson({
    sessionId: session.id,
    revision: session.current.revision,
    style: session.current.style,
    history: session.history.map(({ revision, committedAt }) => ({ revision, committedAt })),
    lastAccessedAt: now,
    expiresAt: now + limits.ttlMs,
  });

  const frozenStyleFacade = (style: StyleDocument): FrozenStyleFacade => {
    const frozenStyle = cloneKnownJson(style);
    return Object.freeze({
      view: frozenStyle as DeepReadonly<StyleDocument>,
      withStyle: <Result>(reader: (candidate: StyleDocument) => Result): Result => {
        const result = reader(frozenStyle);
        if (isThenable(result)) rejectAsyncProjection();
        return result;
      },
    });
  };

  const frozenSessionSnapshot = (session: InternalSession): FrozenSessionSnapshot => Object.freeze({
    sessionId: session.id,
    revision: session.current.revision,
    style: frozenStyleFacade(session.current.style),
    history: cloneKnownJson(
      session.history.map(({ revision, committedAt }) => ({ revision, committedAt })),
    ),
    lastAccessedAt: session.lastAccessedAt,
    expiresAt: session.expiresAt,
  });

  const frozenRevisionSnapshot = (revision: InternalRevision): FrozenRevisionSnapshot => Object.freeze({
    revision: revision.revision,
    style: frozenStyleFacade(revision.style),
    incomingDiff: cloneKnownJson(revision.incomingDiff),
    committedAt: revision.committedAt,
  });

  const project = <Result>(
    sessionId: string,
    projector: (snapshot: FrozenSessionSnapshot) => Result,
  ): Promise<Result> => {
    observer?.onProjectionAttempt?.({ kind: 'project', sessionId });
    const session = captureSession(sessionId);
    return enqueue(session, 'project', () => {
      const now = clock.now();
      assertRunnable(session, now);
      const result = projector(frozenSessionSnapshot(session));
      if (isThenable(result)) rejectAsyncProjection();
      const cloned = cloneProjectionResult(result);
      touch(session, clock.now());
      return cloned;
    });
  };

  const projectRevision = <Result>(
    sessionId: string,
    revision: number | undefined,
    projector: (snapshot: FrozenRevisionSnapshot) => Result,
  ): Promise<Result> => {
    observer?.onRevisionReadAttempt?.({ kind: 'projectRevision', sessionId, revision });
    const session = captureSession(sessionId);
    return enqueue(session, 'projectRevision', () => {
      const now = clock.now();
      assertRunnable(session, now);
      const selected = selectRevision(session, revision);
      const result = projector(frozenRevisionSnapshot(selected));
      if (isThenable(result)) rejectAsyncProjection();
      const cloned = cloneProjectionResult(result);
      touch(session, clock.now());
      return cloned;
    });
  };

  const open = async (style: unknown): Promise<OpenStyleSessionResult> => {
    if (disposed) throw missingSession('storeDisposed');
    const validation = coreDependencies.validateStyleDocument(style, {
      maxStyleBytes: limits.maxStyleBytes,
    });
    if (!validation.ok) {
      throw validation.errors[0] ?? createStyleToolError(
        'STYLE_INVALID', 'MapLibre style validation failed.',
      );
    }
    const now = clock.now();
    sweepExpired(now);
    if (sessions.size >= limits.maxSessions) {
      throw sessionError(
        'CONFLICT', 'Maximum active Style sessions reached.', 'maxSessions',
      );
    }
    const candidateId: unknown = idFactory();
    assertValidSessionId(candidateId);
    if (sessions.has(candidateId)) {
      throw sessionError(
        'CONFLICT', 'Generated Style session ID already exists.', 'sessionIdCollision',
      );
    }
    let storedStyle: StyleDocument;
    try {
      storedStyle = cloneKnownJson(validation.style);
    } catch {
      throw sessionError('INTERNAL', 'Validated Style could not be cloned.', 'styleCloneFailed');
    }
    const baseline: InternalRevision = Object.freeze({
      revision: 0,
      style: storedStyle,
      incomingDiff: Object.freeze([]),
      committedAt: now,
    });
    const session: InternalSession = {
      id: candidateId,
      current: baseline,
      history: [],
      lastAccessedAt: now,
      expiresAt: now + limits.ttlMs,
      closing: false,
      tail: Promise.resolve(),
    };
    sessions.set(candidateId, session);
    return cloneKnownJson({ sessionId: candidateId, revision: 0, expiresAt: session.expiresAt });
  };

  const read = async (sessionId: string): Promise<SessionSnapshot> => {
    const session = captureSession(sessionId);
    return enqueue(session, 'read', () => {
      const now = clock.now();
      assertRunnable(session, now);
      const completedAt = clock.now();
      const result = sessionSnapshot(session, completedAt);
      touch(session, completedAt);
      return result;
    });
  };

  const readRevision = async (
    sessionId: string,
    revision: number,
  ): Promise<RevisionSnapshot> => {
    observer?.onRevisionReadAttempt?.({ kind: 'readRevision', sessionId, revision });
    const session = captureSession(sessionId);
    return enqueue(session, 'readRevision', () => {
      const now = clock.now();
      assertRunnable(session, now);
      const result = revisionSnapshot(selectRevision(session, revision));
      touch(session, clock.now());
      return result;
    });
  };

  const exportStyle = async (
    sessionId: string,
    revision?: number,
  ): Promise<ExportStyleSessionResult> => {
    const session = captureSession(sessionId);
    return enqueue(session, 'export', () => {
      const now = clock.now();
      assertRunnable(session, now);
      const selected = selectRevision(session, revision);
      const result = cloneKnownJson({
        sessionId,
        revision: selected.revision,
        style: selected.style,
      });
      touch(session, clock.now());
      return result;
    });
  };

  const applyFinalized = <Result>(
    sessionId: string,
    request: ApplyStyleSessionRequest,
    finalizer: (result: ApplySessionTransactionResult) => Result,
  ): Promise<Result> => {
    const session = captureSession(sessionId);
    return enqueue(session, 'apply', () => {
      const now = clock.now();
      assertRunnable(session, now);
      if (request.expectedRevision !== session.current.revision) {
        throw sessionError(
          'REVISION_CONFLICT',
          'Style session revision does not match the expected revision.',
          'expectedRevision',
          {
            expectedRevision: Number.isSafeInteger(request.expectedRevision)
              ? request.expectedRevision
              : null,
            actualRevision: session.current.revision,
          },
        );
      }
      const result: StyleTransactionResult = coreDependencies.applyStyleTransaction(
        session.current.style,
        request.transaction,
        {
          maxOperations: limits.maxOperations,
          maxStyleBytes: limits.maxStyleBytes,
          maxDiffBytes: limits.maxDiffBytes,
        },
      );
      if (!result.ok) throw result.error;
      const dryRun = request.dryRun === true;
      const nextRevision = dryRun ? session.current.revision : session.current.revision + 1;
      let nextStyle: StyleDocument;
      let nextDiff: readonly StyleDiffEntry[];
      try {
        nextStyle = cloneKnownJson(result.style);
        nextDiff = cloneKnownJson(result.diff);
      } catch {
        throw sessionError('INTERNAL', 'Transaction result could not be cloned.', 'resultCloneFailed');
      }
      const publicResult: ApplySessionTransactionResult = cloneKnownJson({
        revision: nextRevision,
        dryRun,
        diff: nextDiff,
        changedLayers: result.changedLayers,
        changedSources: result.changedSources,
        warnings: result.warnings,
      });
      const finalized = finalizer(publicResult);
      if (isThenable(finalized)) rejectAsyncProjection();
      const finalizedClone = cloneProjectionResult(finalized);
      if (!dryRun) {
        session.history.push(session.current);
        while (session.history.length > limits.maxHistory) session.history.shift();
        session.current = Object.freeze({
          revision: nextRevision,
          style: nextStyle,
          incomingDiff: nextDiff,
          committedAt: now,
        });
      }
      touch(session, clock.now());
      return finalizedClone;
    });
  };

  const apply = async (
    sessionId: string,
    request: ApplyStyleSessionRequest,
  ): Promise<ApplySessionTransactionResult> => applyFinalized(
    sessionId,
    request,
    (result) => result,
  );


  const replace = async (
    sessionId: string,
    expectedRevision: number,
    style: unknown,
  ): Promise<ApplySessionTransactionResult> => {
    const session = captureSession(sessionId);
    return enqueue(session, 'apply', () => {
      const now = clock.now();
      assertRunnable(session, now);
      if (expectedRevision !== session.current.revision) {
        throw sessionError(
          'REVISION_CONFLICT',
          'Style session revision does not match the expected revision.',
          'expectedRevision',
          { expectedRevision, actualRevision: session.current.revision },
        );
      }
      const result = finalizeStyleReplacement(session.current.style, style, {
        maxStyleBytes: limits.maxStyleBytes,
        maxDiffBytes: limits.maxDiffBytes,
      });
      if (!result.ok) throw result.error;
      const nextRevision = session.current.revision + 1;
      const nextStyle = cloneKnownJson(result.style);
      const nextDiff = cloneKnownJson(result.diff);
      session.history.push(session.current);
      while (session.history.length > limits.maxHistory) session.history.shift();
      session.current = Object.freeze({
        revision: nextRevision,
        style: nextStyle,
        incomingDiff: nextDiff,
        committedAt: now,
      });
      touch(session, clock.now());
      return cloneKnownJson({
        revision: nextRevision,
        dryRun: false,
        diff: nextDiff,
        changedLayers: result.changedLayers,
        changedSources: result.changedSources,
        warnings: result.warnings,
      });
    });
  };
  const close = async (sessionId: string): Promise<CloseStyleSessionResult> => {
    const session = captureSession(sessionId);
    session.closing = true;
    return enqueue(session, 'close', () => {
      assertRunnable(session, clock.now());
      removeGeneration(session);
      return cloneKnownJson({ sessionId, closed: true as const });
    });
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const session of sessions.values()) session.closing = true;
    sessions.clear();
  };

  const store = {
    get size() { return sessions.size; },
    limits,
    open,
    close,
    read,
    readRevision,
    apply,
    replace,
    export: exportStyle,
    dispose,
  } as StyleSessionStore;
  Object.defineProperty(store, styleSessionStoreBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  const capability: InternalStoreCapability = {
    store,
    project,
    projectRevision,
    apply: applyFinalized,
  };
  factoryStoreCapabilities.set(store, capability);
  return store;
}

export const createStyleSessionStore = (
  options: StyleSessionStoreOptions = {},
): StyleSessionStore => createStyleSessionStoreWithDependencies(options);
