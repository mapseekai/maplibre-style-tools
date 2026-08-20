import {
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
  canonicalizeJson,
  createStyleToolError,
  jsonUtf8ByteLength,
  validateStyleDocument,
  type JsonObject,
  type StyleDocument,
  type StyleToolError,
} from '../core/index.js';
import { hashStyle as defaultHashStyle } from '../adapters/maplibre/style-hash.js';
import { assertCapability } from './capabilities.js';
import { assertCorrelated, encodeBridgeFrame } from './codec.js';
import {
  assertInboundEventAllowed,
  assertInboundResultAllowed,
} from './outbound.js';
import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeCommandSchema,
  BridgeEventFrameSchema,
  BridgeLimitSetSchema,
  BridgeRegisterFrameSchema,
  BridgeResultFrameSchema,
  MAX_BRIDGE_MESSAGE_BYTES,
  REGISTRATION_ATTEMPT_RETENTION_MS,
  type BridgeCapability,
  type BridgeCommand,
  type BridgeCommandFrame,
  type BridgeEventFrame,
  type BridgeLimitSet,
  type BridgeRegisterFrame,
  type BridgeResultFor,
  type BridgeResultFrame,
  type BridgeSuccessResult,
  type MapSnapshot,
} from './protocol.js';

const MAX_OPERATION_TIMEOUT_MS = 10_000;
const DEFAULT_TRANSPORT_GRACE_MS = 1_000;
const DEFAULT_MAX_RETAINED_ATTEMPTS = 1_024;
const POLICY_CLOSE_CODE = 1008;
const REPLACED_CLOSE_CODE = 4001;
const RESYNC_CLOSE_CODE = 4002;

export interface BridgePeer {
  readonly id: string;
  send(frame: BridgeCommandFrame): Promise<void>;
  close(code: number, reason: string): void;
}

export interface LiveMapMetadata {
  mapId: string;
  capabilities: readonly BridgeCapability[];
  limits: BridgeLimitSet;
  revision: number;
  styleHash: string;
  syncState: 'known' | 'unknown';
  connectedAt: number;
  lastSeenAt: number;
}

export interface LiveMapHandle {
  readonly peerId: string;
  readonly leaseId: string;
  readonly metadata: LiveMapMetadata;
  readonly snapshot: MapSnapshot;
  readonly syncState: 'known' | 'unknown';
}

interface RegistrationLivenessState {
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
}

export type RegistrationLiveness = Readonly<RegistrationLivenessState>;

const registrationLivenessTokens = new WeakSet<object>();

export function createRegistrationLiveness(
  signal: AbortSignal,
  isCurrent: () => boolean,
): RegistrationLiveness {
  if (!(signal instanceof AbortSignal) || typeof isCurrent !== 'function') {
    throw new TypeError('invalid registration liveness inputs');
  }
  const token = Object.freeze({ signal, isCurrent });
  registrationLivenessTokens.add(token);
  return token;
}

type TimerHandle = ReturnType<typeof setTimeout>;
type HashStyle = (style: StyleDocument) => Promise<string>;

export interface LiveMapRegistryOptions {
  limitCeilings?: BridgeLimitSet;
  operationTimeoutMs?: number;
  transportGraceMs?: number;
  registrationAttemptRetentionMs?: number;
  maxRetainedRegistrationAttempts?: number;
  now?: () => number;
  hashStyle?: HashStyle;
  setTimeout?: (callback: () => void, milliseconds: number) => TimerHandle;
  clearTimeout?: (timer: TimerHandle) => void;
}

interface CachedStyle {
  style: StyleDocument;
  styleHash: string;
}

interface QueueEntry {
  command: BridgeCommand;
  frame: BridgeCommandFrame;
  deadlineAt: number;
  finalize?: (result: never) => unknown;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  callerTimer?: TimerHandle;
  callerSettled: boolean;
  skipped: boolean;
}

interface PendingCorrelation extends QueueEntry {
  peerId: string;
  baselineRevision: number;
  baselineStyleHash: string;
  dispatchSyncEpoch: number;
  graceTimer?: TimerHandle;
}

interface InternalHandle {
  mapId: string;
  peer: BridgePeer;
  leaseId: string;
  registrationAttemptId: string;
  metadata: LiveMapMetadata;
  cachedStyle?: CachedStyle;
  queue: QueueEntry[];
  active?: PendingCorrelation;
  syncEpoch: number;
  closed: boolean;
  awaitingReplayConfirmation: boolean;
}

interface AttemptRecord {
  mapId: string;
  attemptId: string;
  fingerprint: string;
  leaseId: string;
  capabilities: readonly BridgeCapability[];
  limits: BridgeLimitSet;
  mirror: MapSnapshot;
  expiresAt: number;
}

interface ValidatedSnapshot extends MapSnapshot {
  style?: StyleDocument;
}

const defaultLimits: BridgeLimitSet = Object.freeze({
  maxMessageBytes: MAX_BRIDGE_MESSAGE_BYTES,
  maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
  maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
  maxOperations: DEFAULT_MAX_OPERATIONS,
});

const positiveSafeInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
};

const cloneJson = <T>(value: T): T => structuredClone(value);

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && 'value' in descriptor) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
};

const randomBase64Url = (): string => {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += alphabet[first >> 2];
    encoded += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined) {
      encoded += alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    }
    if (third !== undefined) encoded += alphabet[third & 63];
  }
  return encoded;
};

const disconnectedError = (): StyleToolError => createStyleToolError(
  'BRIDGE_DISCONNECTED',
  'Browser bridge disconnected.',
);
const timeoutError = (): StyleToolError => createStyleToolError(
  'TIMEOUT',
  'Bridge operation timed out.',
);
const mapNotReadyError = (): StyleToolError => createStyleToolError(
  'MAP_NOT_READY',
  'Map is not ready.',
  undefined,
  { syncState: 'unknown' },
);
const notFoundError = (mapId: string): StyleToolError => createStyleToolError(
  'NOT_FOUND',
  'Live map was not found.',
  undefined,
  { mapId },
);
const invalidInputError = (message = 'Invalid live bridge input.'): StyleToolError =>
  createStyleToolError('INVALID_INPUT', message);

const safeLivenessCurrent = (token: RegistrationLiveness): boolean => {
  if (!registrationLivenessTokens.has(token as object) || token.signal.aborted) return false;
  try {
    return token.isCurrent() === true;
  } catch {
    return false;
  }
};

const assertLive = (token: RegistrationLiveness): void => {
  if (!safeLivenessCurrent(token)) throw disconnectedError();
};

const metadataClone = (metadata: LiveMapMetadata): LiveMapMetadata => deepFreeze(cloneJson(metadata));

const snapshotFromHandle = (handle: InternalHandle): MapSnapshot => {
  const snapshot: MapSnapshot = {
    revision: handle.metadata.revision,
    styleHash: handle.metadata.styleHash,
  };
  if (handle.cachedStyle?.styleHash === handle.metadata.styleHash) {
    snapshot.style = cloneJson(handle.cachedStyle.style);
  }
  return deepFreeze(snapshot);
};

const publicHandle = (handle: InternalHandle): LiveMapHandle => deepFreeze({
  peerId: handle.peer.id,
  leaseId: handle.leaseId,
  metadata: metadataClone(handle.metadata),
  snapshot: snapshotFromHandle(handle),
  syncState: handle.metadata.syncState,
});

const asJsonObject = (value: unknown): JsonObject | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;

export class LiveMapRegistry {
  readonly limitCeilings: BridgeLimitSet;

  readonly #handles = new Map<string, InternalHandle>();
  readonly #attempts = new Map<string, AttemptRecord>();
  readonly #operationTimeoutMs: number;
  readonly #transportGraceMs: number;
  readonly #registrationAttemptRetentionMs: number;
  readonly #maxRetainedRegistrationAttempts: number;
  readonly #now: () => number;
  readonly #hashStyle: HashStyle;
  readonly #setTimer: (callback: () => void, milliseconds: number) => TimerHandle;
  readonly #clearTimer: (timer: TimerHandle) => void;
  #closed = false;

  constructor(options: LiveMapRegistryOptions = {}) {
    this.limitCeilings = deepFreeze(BridgeLimitSetSchema.parse(options.limitCeilings ?? defaultLimits));
    this.#operationTimeoutMs = Math.min(
      positiveSafeInteger(options.operationTimeoutMs ?? MAX_OPERATION_TIMEOUT_MS, 'operationTimeoutMs'),
      MAX_OPERATION_TIMEOUT_MS,
    );
    this.#transportGraceMs = positiveSafeInteger(
      options.transportGraceMs ?? DEFAULT_TRANSPORT_GRACE_MS,
      'transportGraceMs',
    );
    this.#registrationAttemptRetentionMs = positiveSafeInteger(
      options.registrationAttemptRetentionMs ?? REGISTRATION_ATTEMPT_RETENTION_MS,
      'registrationAttemptRetentionMs',
    );
    if (this.#registrationAttemptRetentionMs > REGISTRATION_ATTEMPT_RETENTION_MS) {
      throw new RangeError('registrationAttemptRetentionMs may only be lowered for tests');
    }
    this.#maxRetainedRegistrationAttempts = positiveSafeInteger(
      options.maxRetainedRegistrationAttempts ?? DEFAULT_MAX_RETAINED_ATTEMPTS,
      'maxRetainedRegistrationAttempts',
    );
    if (this.#maxRetainedRegistrationAttempts > DEFAULT_MAX_RETAINED_ATTEMPTS) {
      throw new RangeError('maxRetainedRegistrationAttempts may only be lowered for tests');
    }
    this.#now = options.now ?? Date.now;
    this.#hashStyle = options.hashStyle ?? defaultHashStyle;
    this.#setTimer = options.setTimeout ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
    this.#clearTimer = options.clearTimeout ?? ((timer) => clearTimeout(timer));
  }

  async register(
    peer: BridgePeer,
    frame: BridgeRegisterFrame,
    liveness: RegistrationLiveness,
  ): Promise<{ leaseId: string; metadata: LiveMapMetadata }> {
    assertLive(liveness);
    if (this.#closed) throw disconnectedError();
    this.sweepExpiredRegistrationAttempts();

    let parsed: BridgeRegisterFrame;
    try {
      parsed = BridgeRegisterFrameSchema.parse(frame);
    } catch {
      throw invalidInputError('Invalid bridge registration.');
    }
    assertLive(liveness);
    const priorAttempt = this.#attempts.get(parsed.mapId);
    const borrowedAttempt = [...this.#attempts.values()].some((record) =>
      record.mapId !== parsed.mapId && record.attemptId === parsed.registrationAttemptId);
    if (borrowedAttempt) throw createStyleToolError('CONFLICT', 'Registration attempt is already owned.');
    if (priorAttempt === undefined
      && this.#attempts.size >= this.#maxRetainedRegistrationAttempts) {
      throw createStyleToolError('CONFLICT', 'Registration attempt capacity reached.');
    }
    for (const key of Object.keys(this.limitCeilings) as Array<keyof BridgeLimitSet>) {
      if (parsed.limits[key] > this.limitCeilings[key]) {
        throw invalidInputError('Registration limit exceeds the server ceiling.');
      }
    }
    try {
      encodeBridgeFrame(parsed, parsed.limits.maxMessageBytes);
    } catch {
      throw invalidInputError('Registration frame exceeds its negotiated limit.');
    }
    if (parsed.snapshot.style !== undefined && !parsed.capabilities.includes('style.read')) {
      throw createStyleToolError('CAPABILITY_DENIED', 'Registration Style requires style.read.');
    }

    const validatedSnapshot = await this.#validateSnapshot(parsed.snapshot, parsed.limits);
    assertLive(liveness);
    const fingerprint = canonicalizeJson({
      mapId: parsed.mapId,
      replaceLeaseId: parsed.replaceLeaseId ?? null,
      capabilities: parsed.capabilities,
      limits: parsed.limits,
      snapshot: {
        revision: validatedSnapshot.revision,
        styleHash: validatedSnapshot.styleHash,
        hasStyle: validatedSnapshot.style !== undefined,
      },
    });

    assertLive(liveness);
    const current = this.#handles.get(parsed.mapId);
    if (priorAttempt?.attemptId === parsed.registrationAttemptId) {
      if (priorAttempt.fingerprint !== fingerprint) {
        throw createStyleToolError('CONFLICT', 'Registration attempt fingerprint changed.');
      }
      if (current !== undefined && current.leaseId !== priorAttempt.leaseId) {
        throw createStyleToolError('CONFLICT', 'Registration attempt no longer owns the map.');
      }
      assertLive(liveness);
      if (current !== undefined) this.#retireHandle(current, REPLACED_CLOSE_CODE, 'bridge generation replaced');
      const replay = this.#createHandle(
        peer,
        parsed,
        priorAttempt.leaseId,
        priorAttempt.mirror,
        true,
      );
      this.#handles.set(parsed.mapId, replay);
      return { leaseId: replay.leaseId, metadata: metadataClone(replay.metadata) };
    }

    if (current !== undefined) {
      if (parsed.replaceLeaseId !== current.leaseId) {
        throw createStyleToolError('CONFLICT', 'Live map already has an active owner.');
      }
      this.#assertReplacementSnapshot(current.metadata, validatedSnapshot);
    } else if (priorAttempt !== undefined) {
      if (parsed.replaceLeaseId !== priorAttempt.leaseId) {
        throw createStyleToolError('CONFLICT', 'Live map replacement lease is required.');
      }
      this.#assertReplacementSnapshot({
        mapId: parsed.mapId,
        capabilities: priorAttempt.capabilities,
        limits: priorAttempt.limits,
        revision: priorAttempt.mirror.revision,
        styleHash: priorAttempt.mirror.styleHash,
        syncState: 'unknown',
        connectedAt: this.#now(),
        lastSeenAt: this.#now(),
      }, validatedSnapshot);
    } else if (parsed.replaceLeaseId !== undefined) {
      throw createStyleToolError('CONFLICT', 'No prior live map lease exists.');
    }

    assertLive(liveness);
    const leaseId = randomBase64Url();
    if (current !== undefined) this.#retireHandle(current, REPLACED_CLOSE_CODE, 'live map replaced');
    const installed = this.#createHandle(peer, parsed, leaseId, validatedSnapshot, false);
    this.#handles.set(parsed.mapId, installed);
    this.#attempts.set(parsed.mapId, {
      mapId: parsed.mapId,
      attemptId: parsed.registrationAttemptId,
      fingerprint,
      leaseId,
      capabilities: deepFreeze([...parsed.capabilities]),
      limits: deepFreeze(cloneJson(parsed.limits)),
      mirror: deepFreeze(cloneJson(validatedSnapshot)),
      expiresAt: this.#now() + this.#registrationAttemptRetentionMs,
    });
    return { leaseId, metadata: metadataClone(installed.metadata) };
  }

  list(): LiveMapMetadata[] {
    return [...this.#handles.values()]
      .filter((handle) => !handle.closed)
      .map((handle) => metadataClone(handle.metadata))
      .sort((left, right) => left.mapId.localeCompare(right.mapId));
  }

  get(mapId: string): LiveMapHandle | undefined {
    const handle = this.#handles.get(mapId);
    return handle === undefined || handle.closed ? undefined : publicHandle(handle);
  }

  projectList<T>(finalize: (maps: LiveMapMetadata[]) => T): T {
    const handles = [...this.#handles.values()].filter((handle) => !handle.closed);
    const candidate = handles.map((handle) => metadataClone(handle.metadata))
      .sort((left, right) => left.mapId.localeCompare(right.mapId));
    const result = finalize(candidate);
    const now = this.#now();
    for (const handle of handles) {
      if (this.#handles.get(handle.mapId) === handle && !handle.closed) handle.metadata.lastSeenAt = now;
    }
    return result;
  }

  projectMetadata<T>(mapId: string, finalize: (metadata: LiveMapMetadata) => T): T {
    const handle = this.#requireHandle(mapId);
    const result = finalize(metadataClone(handle.metadata));
    if (this.#handles.get(mapId) === handle && !handle.closed) handle.metadata.lastSeenAt = this.#now();
    return result;
  }

  projectCachedStyle<T>(mapId: string, finalize: (style: StyleDocument) => T): T {
    const handle = this.#requireKnownHandle(mapId);
    if (handle.cachedStyle?.styleHash !== handle.metadata.styleHash) throw mapNotReadyError();
    const candidate = deepFreeze(cloneJson(handle.cachedStyle.style));
    const result = finalize(candidate);
    if (this.#handles.get(mapId) === handle && !handle.closed) handle.metadata.lastSeenAt = this.#now();
    return result;
  }

  execute<C extends BridgeCommand, T = BridgeResultFor<C>>(
    mapId: string,
    command: C,
    timeoutMs?: number,
    finalize?: (result: BridgeResultFor<C>) => T,
  ): Promise<T> {
    let handle: InternalHandle;
    let parsed: BridgeCommand;
    try {
      handle = this.#requireKnownHandle(mapId);
      const parsedCommand = BridgeCommandSchema.safeParse(command);
      if (!parsedCommand.success) throw invalidInputError('Invalid live bridge command.');
      parsed = parsedCommand.data;
      assertCapability(handle.metadata.capabilities, parsed);
      if (parsed.type === 'applyStyleDocument'
        || parsed.type === 'updateGeoJsonData'
        || parsed.type === 'setSourceTileLodParams'
        || parsed.type === 'listSprites'
        || parsed.type === 'addSprite'
        || parsed.type === 'removeSprite') {
        throw createStyleToolError('CAPABILITY_DENIED', 'Bridge command is not supported by this registry.');
      }
      if (parsed.type === 'applyTransaction'
        && parsed.transaction.operations.length > handle.metadata.limits.maxOperations) {
        throw invalidInputError('Transaction exceeds negotiated operation limit.');
      }
    } catch (error) {
      return Promise.reject(error);
    }
    let effectiveTimeout: number;
    try {
      effectiveTimeout = Math.min(
        positiveSafeInteger(timeoutMs ?? this.#operationTimeoutMs, 'timeoutMs'),
        MAX_OPERATION_TIMEOUT_MS,
      );
    } catch (error) {
      return Promise.reject(invalidInputError(error instanceof Error ? error.message : undefined));
    }
    const now = this.#now();
    const deadlineAt = now + effectiveTimeout;
    if (!Number.isSafeInteger(deadlineAt)) return Promise.reject(invalidInputError('deadlineAt is unsafe.'));
    const frame: BridgeCommandFrame = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      kind: 'command',
      correlationId: randomBase64Url(),
      mapId,
      deadlineAt,
      command: parsed,
    };
    try {
      encodeBridgeFrame(frame, handle.metadata.limits.maxMessageBytes);
    } catch {
      return Promise.reject(invalidInputError('Command exceeds negotiated frame limit.'));
    }

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry = {
        command: parsed,
        frame,
        deadlineAt,
        ...(finalize === undefined
          ? {}
          : { finalize: finalize as unknown as (result: never) => unknown }),
        resolve: resolve as (value: unknown) => void,
        reject,
        callerSettled: false,
        skipped: false,
      };
      entry.callerTimer = this.#setTimer(() => this.#onCallerDeadline(handle, entry), effectiveTimeout);
      handle.queue.push(entry);
      this.#pump(handle);
    });
  }

  async acceptResult(peerId: string, result: BridgeResultFrame): Promise<void> {
    const handle = this.#findPeerHandle(peerId);
    if (handle === undefined) throw new Error('bridge result came from an unknown peer');
    const pending = handle.active;
    if (pending === undefined) return this.#policyViolation(handle, 'bridge result has no correlation owner');
    let parsed: BridgeResultFrame;
    try {
      parsed = BridgeResultFrameSchema.parse(result);
      encodeBridgeFrame(parsed, handle.metadata.limits.maxMessageBytes);
      assertCorrelated(pending.frame, parsed);
      assertInboundResultAllowed(handle.metadata.capabilities, pending.command, parsed);
    } catch {
      return this.#policyViolation(handle, 'bridge result violates protocol');
    }

    try {
      if (parsed.ok) {
        const validated = await this.#validateSuccessResult(handle, pending, parsed.result);
        this.#assertPendingOwned(handle, pending);
        let projected: unknown = validated.result;
        if (pending.finalize !== undefined) {
          try {
            projected = pending.finalize(deepFreeze(cloneJson(validated.result)) as never);
          } catch (error) {
            this.#completePending(handle, pending, false, error, false);
            return;
          }
        }
        if (pending.dispatchSyncEpoch === handle.syncEpoch && validated.snapshot !== undefined) {
          this.#mergeMirrorRevision(handle, validated.snapshot, true);
        }
        this.#completePending(handle, pending, true, projected, false);
        return;
      }

      const validatedError = await this.#validateFailureResult(handle, pending, parsed);
      this.#assertPendingOwned(handle, pending);
      if (pending.dispatchSyncEpoch === handle.syncEpoch
        && validatedError.snapshot !== undefined) {
        this.#mergeMirrorRevision(handle, validatedError.snapshot, true);
      }
      const authentic = createStyleToolError(
        parsed.error.code,
        parsed.error.message,
        parsed.error.path,
        parsed.error.details,
      );
      this.#completePending(handle, pending, false, authentic, false);
    } catch {
      return this.#policyViolation(handle, 'bridge result failed protocol validation');
    }
  }

  async acceptEvent(peerId: string, event: BridgeEventFrame): Promise<void> {
    const handle = this.#findPeerHandle(peerId);
    if (handle === undefined) throw new Error('bridge event came from an unknown peer');
    let parsed: BridgeEventFrame;
    try {
      parsed = BridgeEventFrameSchema.parse(event);
      encodeBridgeFrame(parsed, handle.metadata.limits.maxMessageBytes);
      if (parsed.mapId !== handle.mapId) throw new Error('bridge event map mismatch');
      assertInboundEventAllowed(handle.metadata.capabilities, parsed);
    } catch {
      return this.#policyViolation(handle, 'bridge event violates protocol');
    }

    if (parsed.event === 'mapStatus') {
      handle.syncEpoch += 1;
      handle.metadata.syncState = 'unknown';
      handle.metadata.lastSeenAt = this.#now();
      handle.cachedStyle = undefined;
      this.#rejectQueuedAsNotReady(handle);
      return;
    }
    if (handle.awaitingReplayConfirmation && parsed.event !== 'mapSnapshot') {
      return this.#policyViolation(handle, 'replay requires a mapSnapshot confirmation');
    }
    let snapshot: ValidatedSnapshot;
    try {
      snapshot = await this.#validateSnapshot(parsed.snapshot, handle.metadata.limits);
      this.#assertHandleOwned(handle);
      this.#mergeMirrorRevision(handle, snapshot, true);
      if (parsed.event === 'mapSnapshot') {
        handle.awaitingReplayConfirmation = false;
        const attempt = this.#attempts.get(handle.mapId);
        if (attempt?.leaseId === handle.leaseId) this.#attempts.delete(handle.mapId);
      }
    } catch {
      return this.#policyViolation(handle, 'bridge event snapshot hash/revision protocol validation failed');
    }
  }

  disconnect(peerId: string): void {
    const handles = [...this.#handles.values()].filter((handle) => handle.peer.id === peerId);
    for (const handle of handles) {
      if (this.#handles.get(handle.mapId) !== handle) continue;
      this.#handles.delete(handle.mapId);
      this.#rejectHandleWork(handle, disconnectedError);
      handle.closed = true;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const handle of [...this.#handles.values()]) {
      this.#rejectHandleWork(handle, disconnectedError);
      handle.closed = true;
      try {
        handle.peer.close(1001, 'bridge registry closed');
      } catch {
        // A transport close failure cannot retain registry work.
      }
    }
    this.#handles.clear();
    this.#attempts.clear();
  }

  sweepExpiredRegistrationAttempts(): void {
    const now = this.#now();
    for (const [mapId, attempt] of this.#attempts) {
      if (attempt.expiresAt <= now) this.#attempts.delete(mapId);
    }
  }

  #createHandle(
    peer: BridgePeer,
    frame: BridgeRegisterFrame,
    leaseId: string,
    snapshot: MapSnapshot,
    replay: boolean,
  ): InternalHandle {
    const now = this.#now();
    const metadata: LiveMapMetadata = {
      mapId: frame.mapId,
      capabilities: deepFreeze([...frame.capabilities]),
      limits: deepFreeze(cloneJson(frame.limits)),
      revision: snapshot.revision,
      styleHash: snapshot.styleHash,
      syncState: replay ? 'unknown' : 'known',
      connectedAt: now,
      lastSeenAt: now,
    };
    return {
      mapId: frame.mapId,
      peer,
      leaseId,
      registrationAttemptId: frame.registrationAttemptId,
      metadata,
      ...(replay || snapshot.style === undefined
        ? {}
        : { cachedStyle: {
          style: deepFreeze(cloneJson(snapshot.style)) as StyleDocument,
          styleHash: snapshot.styleHash,
        } }),
      queue: [],
      syncEpoch: replay ? 1 : 0,
      closed: false,
      awaitingReplayConfirmation: replay,
    };
  }

  async #validateSnapshot(
    snapshot: MapSnapshot,
    limits: BridgeLimitSet,
  ): Promise<ValidatedSnapshot> {
    if (snapshot.style === undefined) {
      return { revision: snapshot.revision, styleHash: snapshot.styleHash };
    }
    const validation = validateStyleDocument(snapshot.style, { maxStyleBytes: limits.maxStyleBytes });
    if (!validation.ok) throw invalidInputError('Bridge snapshot Style is invalid or over limit.');
    let actualHash: string;
    try {
      actualHash = await this.#hashStyle(validation.style);
    } catch {
      throw invalidInputError('Bridge snapshot hash validation failed.');
    }
    if (actualHash !== snapshot.styleHash) {
      throw invalidInputError('Bridge snapshot hash does not match its Style.');
    }
    return {
      revision: snapshot.revision,
      styleHash: snapshot.styleHash,
      style: deepFreeze(cloneJson(validation.style)),
    };
  }

  #assertReplacementSnapshot(current: LiveMapMetadata, candidate: MapSnapshot): void {
    if (candidate.revision < current.revision) {
      throw createStyleToolError(
        'REVISION_CONFLICT',
        'Replacement snapshot is older than the current mirror.',
        undefined,
        { currentSnapshot: { revision: current.revision, styleHash: current.styleHash } },
      );
    }
    if (candidate.revision === current.revision && candidate.styleHash !== current.styleHash) {
      throw createStyleToolError('CONFLICT', 'Replacement snapshot conflicts with the current hash.');
    }
  }

  #requireHandle(mapId: string): InternalHandle {
    const handle = this.#handles.get(mapId);
    if (handle === undefined || handle.closed) throw notFoundError(mapId);
    return handle;
  }

  #requireKnownHandle(mapId: string): InternalHandle {
    const handle = this.#requireHandle(mapId);
    if (handle.metadata.syncState !== 'known') throw mapNotReadyError();
    return handle;
  }

  #findPeerHandle(peerId: string): InternalHandle | undefined {
    return [...this.#handles.values()].find((handle) => !handle.closed && handle.peer.id === peerId);
  }

  #assertHandleOwned(handle: InternalHandle): void {
    if (handle.closed || this.#handles.get(handle.mapId) !== handle) {
      throw new Error('bridge peer ownership changed during validation');
    }
  }

  #assertPendingOwned(handle: InternalHandle, pending: PendingCorrelation): void {
    this.#assertHandleOwned(handle);
    if (handle.active !== pending) throw new Error('bridge correlation ownership changed');
  }

  #onCallerDeadline(handle: InternalHandle, entry: QueueEntry): void {
    if (entry.callerSettled) return;
    entry.callerSettled = true;
    entry.reject(timeoutError());
    if (handle.active === entry) {
      const pending = entry as PendingCorrelation;
      pending.graceTimer = this.#setTimer(
        () => this.#onTransportGrace(handle, pending),
        this.#transportGraceMs,
      );
    } else {
      entry.skipped = true;
    }
  }

  #onTransportGrace(handle: InternalHandle, pending: PendingCorrelation): void {
    if (handle.active !== pending || handle.closed) return;
    handle.active = undefined;
    handle.syncEpoch += 1;
    handle.metadata.syncState = 'unknown';
    handle.cachedStyle = undefined;
    this.#rejectQueued(handle, disconnectedError);
    try {
      handle.peer.close(RESYNC_CLOSE_CODE, 'bridge command settlement timed out');
    } catch {
      // Registry state is already terminal for dispatch.
    }
  }

  #pump(handle: InternalHandle): void {
    if (handle.closed || handle.active !== undefined || this.#handles.get(handle.mapId) !== handle) return;
    while (handle.queue.length > 0) {
      const entry = handle.queue.shift()!;
      if (entry.skipped || entry.callerSettled || entry.deadlineAt <= this.#now()) {
        if (!entry.callerSettled) {
          entry.callerSettled = true;
          entry.reject(timeoutError());
        }
        this.#clearEntryTimer(entry);
        continue;
      }
      if (handle.metadata.syncState !== 'known') {
        this.#settleEntry(entry, false, mapNotReadyError());
        continue;
      }
      if (entry.command.type === 'applyTransaction'
        && (entry.command.expectedRevision !== handle.metadata.revision
          || entry.command.expectedStyleHash !== handle.metadata.styleHash)) {
        this.#settleEntry(entry, false, createStyleToolError(
          'REVISION_CONFLICT',
          'Live map revision conflict.',
          undefined,
          { currentSnapshot: {
            revision: handle.metadata.revision,
            styleHash: handle.metadata.styleHash,
          } },
        ));
        continue;
      }
      const pending = Object.assign(entry, {
        peerId: handle.peer.id,
        baselineRevision: handle.metadata.revision,
        baselineStyleHash: handle.metadata.styleHash,
        dispatchSyncEpoch: handle.syncEpoch,
      }) as PendingCorrelation;
      handle.active = pending;
      let sending: Promise<void>;
      try {
        sending = handle.peer.send(pending.frame);
      } catch {
        this.disconnect(handle.peer.id);
        return;
      }
      void Promise.resolve(sending).then(
        () => {
          if (this.#handles.get(handle.mapId) !== handle || handle.active !== pending) return;
          if (pending.deadlineAt <= this.#now() && !pending.callerSettled) {
            this.#onCallerDeadline(handle, pending);
          }
        },
        () => {
          if (this.#handles.get(handle.mapId) === handle) this.disconnect(handle.peer.id);
        },
      );
      return;
    }
  }

  async #validateSuccessResult(
    handle: InternalHandle,
    pending: PendingCorrelation,
    result: BridgeSuccessResult,
  ): Promise<{ result: BridgeSuccessResult; snapshot?: ValidatedSnapshot }> {
    switch (result.type) {
      case 'style': {
        const snapshot = await this.#validateSnapshot(result, handle.metadata.limits);
        this.#assertPendingOwned(handle, pending);
        return { result: { ...result, style: snapshot.style! }, snapshot };
      }
      case 'transaction': {
        if (result.detail === 'full' && result.diff !== undefined) {
          const diffBytes = jsonUtf8ByteLength(result.diff);
          if (diffBytes > handle.metadata.limits.maxDiffBytes) {
            throw new Error('transaction diff exceeds negotiated limit');
          }
        }
        this.#assertTransactionSemantics(pending, result);
        let snapshot: ValidatedSnapshot = {
          revision: result.revision,
          styleHash: result.styleHash,
        };
        let normalized = result;
        if (result.detail === 'full' && result.style !== undefined) {
          snapshot = await this.#validateSnapshot({
            revision: result.revision,
            styleHash: result.styleHash,
            style: result.style,
          }, handle.metadata.limits);
          this.#assertPendingOwned(handle, pending);
          normalized = { ...result, style: snapshot.style };
        }
        return { result: normalized, snapshot };
      }
      case 'features': {
        const bytes = jsonUtf8ByteLength(result.features);
        if (bytes !== result.serializedBytes || bytes > 1024 * 1024) {
          throw new Error('feature result bytes violate protocol');
        }
        if (pending.command.type !== 'querySourceFeatures'
          && pending.command.type !== 'queryRenderedFeatures') {
          throw new Error('feature result has wrong command');
        }
        const maximum = Math.min(pending.command.limit ?? 100, 100);
        if (result.returned !== result.features.length || result.returned > maximum) {
          throw new Error('feature result count violates protocol');
        }
        if (pending.command.properties !== undefined) {
          const allowed = new Set(pending.command.properties);
          for (const feature of result.features) {
            const properties = asJsonObject(feature.properties);
            if (properties !== undefined
              && Object.keys(properties).some((key) => !allowed.has(key))) {
              throw new Error('feature properties violate command allowlist');
            }
          }
        }
        return { result };
      }
      case 'images': {
        const bytes = jsonUtf8ByteLength(result.imageIds);
        if (bytes !== result.serializedBytes || bytes > 64 * 1024
          || result.imageIds.length > 500) {
          throw new Error('image result bytes violate protocol');
        }
        return { result };
      }
      case 'state':
      case 'ack':
        return { result };
      case 'sprites':
        throw new Error('Sprite results are not supported by this registry.');
      case 'authenticated':
      case 'registered':
        throw new Error('control result cannot settle a map command');
      default:
        throw new Error('Unsupported bridge command result.');
    }
  }

  async #validateFailureResult(
    handle: InternalHandle,
    pending: PendingCorrelation,
    frame: Extract<BridgeResultFrame, { ok: false }>,
  ): Promise<{ snapshot?: ValidatedSnapshot }> {
    const current = frame.error.details?.currentSnapshot;
    if (current === undefined) {
      if (pending.command.type === 'applyTransaction' && frame.error.code === 'TIMEOUT') {
        throw new Error('mutation timeout requires an authoritative current snapshot');
      }
      return {};
    }
    if (pending.command.type !== 'applyTransaction') {
      throw new Error('authoritative error snapshot requires mutation command');
    }
    const snapshot = await this.#validateSnapshot(current as MapSnapshot, handle.metadata.limits);
    this.#assertPendingOwned(handle, pending);
    const unchanged = snapshot.revision === pending.baselineRevision
      && snapshot.styleHash === pending.baselineStyleHash;
    const advanced = snapshot.revision === pending.baselineRevision + 1
      && snapshot.styleHash !== pending.baselineStyleHash;
    if (!unchanged && !advanced) throw new Error('authoritative error snapshot violates revision semantics');
    return { snapshot };
  }

  #assertTransactionSemantics(
    pending: PendingCorrelation,
    result: Extract<BridgeSuccessResult, { type: 'transaction' }>,
  ): void {
    const unchanged = result.applied === false && result.noOp === true
      && result.revision === pending.baselineRevision
      && result.styleHash === pending.baselineStyleHash;
    const advanced = result.applied === true && result.noOp === false
      && result.revision === pending.baselineRevision + 1
      && result.styleHash !== pending.baselineStyleHash;
    if (!unchanged && !advanced) throw new Error('transaction revision/hash semantics violate protocol');
  }

  #mergeMirrorRevision(
    handle: InternalHandle,
    snapshot: ValidatedSnapshot,
    restoreKnown: boolean,
  ): void {
    if (snapshot.revision < handle.metadata.revision) return;
    if (snapshot.revision === handle.metadata.revision
      && snapshot.styleHash !== handle.metadata.styleHash) {
      throw new Error('same revision has a different Style hash');
    }
    if (snapshot.revision > handle.metadata.revision) {
      handle.metadata.revision = snapshot.revision;
      if (snapshot.styleHash !== handle.metadata.styleHash) handle.cachedStyle = undefined;
      handle.metadata.styleHash = snapshot.styleHash;
    }
    if (snapshot.style !== undefined
      && handle.metadata.capabilities.includes('style.read')
      && snapshot.styleHash === handle.metadata.styleHash) {
      handle.cachedStyle = {
        style: deepFreeze(cloneJson(snapshot.style)),
        styleHash: snapshot.styleHash,
      };
    }
    if (handle.cachedStyle?.styleHash !== handle.metadata.styleHash) handle.cachedStyle = undefined;
    if (restoreKnown) handle.metadata.syncState = 'known';
    handle.metadata.lastSeenAt = this.#now();
    const attempt = this.#attempts.get(handle.mapId);
    if (attempt?.leaseId === handle.leaseId) {
      attempt.mirror = deepFreeze(cloneJson(snapshotFromHandle(handle)));
    }
  }

  #completePending(
    handle: InternalHandle,
    pending: PendingCorrelation,
    success: boolean,
    value: unknown,
    preserveActive: boolean,
  ): void {
    if (handle.active !== pending) return;
    this.#clearEntryTimer(pending);
    if (pending.graceTimer !== undefined) this.#clearTimer(pending.graceTimer);
    if (!pending.callerSettled) {
      pending.callerSettled = true;
      if (success) pending.resolve(value);
      else pending.reject(value);
    }
    if (!preserveActive) handle.active = undefined;
    this.#pump(handle);
  }

  #settleEntry(entry: QueueEntry, success: boolean, value: unknown): void {
    this.#clearEntryTimer(entry);
    if (entry.callerSettled) return;
    entry.callerSettled = true;
    if (success) entry.resolve(value);
    else entry.reject(value);
  }

  #clearEntryTimer(entry: QueueEntry): void {
    if (entry.callerTimer !== undefined) {
      this.#clearTimer(entry.callerTimer);
      entry.callerTimer = undefined;
    }
  }

  #rejectQueued(handle: InternalHandle, errorFactory: () => StyleToolError): void {
    for (const entry of handle.queue.splice(0)) this.#settleEntry(entry, false, errorFactory());
  }

  #rejectQueuedAsNotReady(handle: InternalHandle): void {
    for (const entry of handle.queue.splice(0)) this.#settleEntry(entry, false, mapNotReadyError());
  }

  #rejectHandleWork(handle: InternalHandle, errorFactory: () => StyleToolError): void {
    const pending = handle.active;
    if (pending !== undefined) {
      this.#clearEntryTimer(pending);
      if (pending.graceTimer !== undefined) this.#clearTimer(pending.graceTimer);
      if (!pending.callerSettled) {
        pending.callerSettled = true;
        pending.reject(errorFactory());
      }
      handle.active = undefined;
    }
    this.#rejectQueued(handle, errorFactory);
  }

  #retireHandle(handle: InternalHandle, code: number, reason: string): void {
    this.#rejectHandleWork(handle, disconnectedError);
    handle.closed = true;
    try {
      handle.peer.close(code, reason);
    } catch {
      // The replacement is authoritative even if the old transport cannot close cleanly.
    }
  }

  #policyViolation(handle: InternalHandle, message: string): never {
    try {
      handle.peer.close(POLICY_CLOSE_CODE, 'bridge protocol violation');
    } catch {
      // Server close/error handling owns eventual disconnect.
    }
    throw new Error(message);
  }
}
