import type { Map as MapLibreMap } from 'maplibre-gl';

import type { RuntimeImageLoader } from '../adapters/maplibre/index.js';
import {
  createStyleToolError,
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
  isStyleToolError,
  type StyleToolError,
} from '../core/index.js';
import {
  createBrowserMapRuntime,
  type BrowserMapRuntime,
  type BrowserMapState,
} from './browser-runtime.js';
import { assertCorrelated, decodeBridgeFrame, encodeBridgeFrame } from './codec.js';
import { prepareOutboundBridgeFrame } from './outbound.js';
import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeAuthFrameSchema,
  BridgeCapabilitySchema,
  BridgeCommandFrameSchema,
  BridgeLimitSetSchema,
  BridgeMapIdSchema,
  BridgeResultFrameSchema,
  BridgeTokenSchema,
  MAX_BRIDGE_MESSAGE_BYTES,
  REGISTRATION_REPLAY_CLIENT_BUDGET_MS,
  type BridgeAuthFrame,
  type BridgeCapability,
  type BridgeCommand,
  type BridgeCommandFrame,
  type BridgeEventFrame,
  type BridgeLimitSet,
  type BridgeRegisterFrame,
  type BridgeResultFrame,
} from './protocol.js';
import {
  normalizeResourcePolicy,
  type NormalizedResourcePolicy,
} from './resource-policy.js';

const SOCKET_OPEN = 1;
const SOCKET_CLOSING = 2;
const TRANSIENT_CLOSE_CODES = new Set([1006, 1011, 1012, 1013, 4002]);

export type MapLibreBridgeStatus =
  | 'authenticating'
  | 'initializing'
  | 'registering'
  | 'connected'
  | 'reconnecting'
  | 'terminal';

export interface WebSocketLike {
  readonly url?: string;
  readyState: number;
  binaryType: BinaryType;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void;
  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface ConnectMapLibreBridgeOptions {
  mapId: string;
  url: string;
  token: string;
  capabilities: readonly BridgeCapability[];
  resourceBaseUrl?: string;
  document?: Pick<Document, 'baseURI'>;
  allowedResourceOrigins: readonly string[];
  allowedUrlPrefixes?: readonly string[];
  allowDataUrls?: boolean;
  allowedProtocols?: readonly string[];
  isProtocolRegistered?: (scheme: string) => boolean;
  maxMessageBytes?: number;
  maxStyleBytes?: number;
  maxDiffBytes?: number;
  maxOperations?: number;
  imageLoader?: RuntimeImageLoader;
  websocketFactory?: (url: string) => WebSocketLike;
  reconnect?: false | {
    initialDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
  };
}

export interface MapLibreBridgeConnection {
  readonly status: MapLibreBridgeStatus;
  whenReady(): Promise<void>;
  snapshot(): BrowserMapState;
  subscribe(listener: (status: MapLibreBridgeStatus) => void): () => void;
  close(): void;
}

type Generation = {
  id: number;
  socket: WebSocketLike;
  abortController: AbortController;
  state: 'authenticating' | 'initializing' | 'registering' | 'registered' | 'terminal';
  authFrame: BridgeAuthFrame;
  commandTail: Promise<void>;
  activeCorrelations: Map<string, BridgeCommand>;
  replayedAttempt: boolean;
  listeners: {
    open(event: unknown): void;
    message(event: unknown): void;
    close(event: unknown): void;
    error(event: unknown): void;
  };
};

type RegistrationAttempt = {
  frame: BridgeRegisterFrame;
  encoded: string;
  firstSentAt: number;
  replayTimer: ReturnType<typeof setTimeout>;
};

type ReconnectPolicy = {
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
};

type MapEventTarget = {
  on(type: 'style.load' | 'styledata' | 'error', listener: (event: unknown) => void): unknown;
  off(type: 'style.load' | 'styledata' | 'error', listener: (event: unknown) => void): unknown;
};

const mapNotReadyError = (): StyleToolError =>
  createStyleToolError('MAP_NOT_READY', 'Map is not ready.');

const disconnectedError = (): StyleToolError =>
  createStyleToolError('BRIDGE_DISCONNECTED', 'Browser bridge disconnected.');

const invalidInput = (message: string): StyleToolError =>
  createStyleToolError('INVALID_INPUT', message);

const ownDataValue = (value: unknown, key: PropertyKey): unknown => {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
};

const closeCode = (event: unknown): number => {
  const value = ownDataValue(event, 'code');
  return typeof value === 'number' && Number.isInteger(value) ? value : 1006;
};

const messageData = (event: unknown): string | ArrayBuffer | ArrayBufferView => {
  const value = ownDataValue(event, 'data');
  if (typeof value === 'string' || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return value;
  }
  throw new TypeError('bridge WebSocket message data is invalid');
};

const positiveSafeInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be positive`);
  return value;
};

const limitsEqual = (left: BridgeLimitSet, right: BridgeLimitSet): boolean =>
  left.maxMessageBytes === right.maxMessageBytes
  && left.maxStyleBytes === right.maxStyleBytes
  && left.maxDiffBytes === right.maxDiffBytes
  && left.maxOperations === right.maxOperations;

const randomBase64Url = (): string => {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

const authenticWireError = (frame: Extract<BridgeResultFrame, { ok: false }>): StyleToolError =>
  createStyleToolError(frame.error.code, frame.error.message, frame.error.path, frame.error.details);

const safeFailure = (error: unknown): StyleToolError =>
  isStyleToolError(error)
    ? error
    : createStyleToolError('INTERNAL', 'Browser bridge operation failed.');

const websocketFactoryDefault = (url: string): WebSocketLike => new WebSocket(url);

const resolveReconnectPolicy = (
  input: ConnectMapLibreBridgeOptions['reconnect'],
): ReconnectPolicy | undefined => {
  if (input === false) return undefined;
  const value = input ?? {};
  const initialDelayMs = positiveSafeInteger(value.initialDelayMs ?? 250, 'initialDelayMs');
  const maxDelayMs = positiveSafeInteger(value.maxDelayMs ?? 5_000, 'maxDelayMs');
  const factor = value.factor ?? 2;
  if (!Number.isFinite(factor) || factor < 1) throw new TypeError('factor must be at least one');
  if (initialDelayMs > maxDelayMs) throw new TypeError('initialDelayMs exceeds maxDelayMs');
  return { initialDelayMs, maxDelayMs, factor };
};

const selectEffectiveLimits = (
  server: BridgeLimitSet,
  options: ConnectMapLibreBridgeOptions,
): BridgeLimitSet => {
  const select = (
    name: keyof BridgeLimitSet,
    explicit: number | undefined,
    fallback: number,
  ): number => {
    if (explicit !== undefined) {
      positiveSafeInteger(explicit, name);
      if (explicit > server[name]) throw invalidInput(`${name} exceeds server ceiling.`);
      return explicit;
    }
    return Math.min(fallback, server[name]);
  };
  return BridgeLimitSetSchema.parse({
    maxMessageBytes: select(
      'maxMessageBytes', options.maxMessageBytes, MAX_BRIDGE_MESSAGE_BYTES,
    ),
    maxStyleBytes: select('maxStyleBytes', options.maxStyleBytes, DEFAULT_MAX_STYLE_BYTES),
    maxDiffBytes: select('maxDiffBytes', options.maxDiffBytes, DEFAULT_MAX_DIFF_BYTES),
    maxOperations: select('maxOperations', options.maxOperations, DEFAULT_MAX_OPERATIONS),
  });
};

const snapshotForEvent = (snapshot: BrowserMapState): BrowserMapState => ({
  revision: snapshot.revision,
  styleHash: snapshot.styleHash,
  style: structuredClone(snapshot.style),
});

export function connectMapLibreBridge(
  map: MapLibreMap,
  options: ConnectMapLibreBridgeOptions,
): MapLibreBridgeConnection {
  let mapId: string;
  let token: string;
  let capabilities: readonly BridgeCapability[];
  let resourcePolicy: NormalizedResourcePolicy;
  let reconnectPolicy: ReconnectPolicy | undefined;
  try {
    mapId = BridgeMapIdSchema.parse(options.mapId);
    token = BridgeTokenSchema.parse(options.token);
    if (!Array.isArray(options.capabilities)) throw new TypeError('capabilities must be an array');
    const parsedCapabilities = options.capabilities.map((capability) =>
      BridgeCapabilitySchema.parse(capability));
    if (new Set(parsedCapabilities).size !== parsedCapabilities.length) {
      throw new TypeError('capabilities must be unique');
    }
    capabilities = Object.freeze(parsedCapabilities);
    for (const [name, value] of [
      ['maxMessageBytes', options.maxMessageBytes],
      ['maxStyleBytes', options.maxStyleBytes],
      ['maxDiffBytes', options.maxDiffBytes],
      ['maxOperations', options.maxOperations],
    ] as const) {
      if (value !== undefined) positiveSafeInteger(value, name);
    }
    const documentValue = options.document
      ?? (typeof document === 'undefined' ? undefined : document);
    const resourceBaseUrl = options.resourceBaseUrl ?? documentValue?.baseURI;
    if (resourceBaseUrl === undefined) throw new TypeError('resourceBaseUrl is required');
    resourcePolicy = normalizeResourcePolicy({
      baseUrl: resourceBaseUrl,
      allowedResourceOrigins: options.allowedResourceOrigins,
      ...(options.allowedUrlPrefixes === undefined
        ? {}
        : { allowedUrlPrefixes: options.allowedUrlPrefixes }),
      ...(options.allowDataUrls === undefined ? {} : { allowDataUrls: options.allowDataUrls }),
      ...(options.allowedProtocols === undefined
        ? {}
        : { allowedProtocols: options.allowedProtocols }),
      ...(options.isProtocolRegistered === undefined
        ? {}
        : { isProtocolRegistered: options.isProtocolRegistered }),
    });
    reconnectPolicy = resolveReconnectPolicy(options.reconnect);
    const url = new URL(options.url);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new TypeError('bridge URL must use ws');
  } catch (error) {
    throw error instanceof TypeError || error instanceof RangeError
      ? error
      : new TypeError('bridge client options are invalid');
  }

  const websocketFactory = options.websocketFactory ?? websocketFactoryDefault;
  const subscribers = new Set<(status: MapLibreBridgeStatus) => void>();
  const mapEvents = map as unknown as MapEventTarget;
  let status: MapLibreBridgeStatus = 'authenticating';
  let generationNumber = 0;
  let current: Generation | undefined;
  let runtime: BrowserMapRuntime | undefined;
  let runtimeReady: Promise<BrowserMapRuntime> | undefined;
  let effectiveLimits: BridgeLimitSet | undefined;
  let pendingAttempt: RegistrationAttempt | undefined;
  let lastLease: string | undefined;
  let everConnected = false;
  let terminal = false;
  let localClose = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let readySettled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  let externalScheduled = false;
  let externalDirty = false;
  let activeCommandCount = 0;
  let recoveryPromise: Promise<void> | undefined;
  let recoveryRunning = false;
  let unknownStatusGeneration: number | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const publishStatus = (next: MapLibreBridgeStatus): void => {
    if (status === next) return;
    status = next;
    for (const subscriber of [...subscribers]) {
      try { subscriber(next); } catch { /* Subscriber isolation. */ }
    }
  };

  const removeGenerationListeners = (generation: Generation): void => {
    generation.socket.removeEventListener('open', generation.listeners.open);
    generation.socket.removeEventListener('message', generation.listeners.message);
    generation.socket.removeEventListener('close', generation.listeners.close);
    generation.socket.removeEventListener('error', generation.listeners.error);
  };

  const removeMapListeners = (): void => {
    mapEvents.off('style.load', onMapStyleEvent);
    mapEvents.off('styledata', onMapStyleEvent);
    mapEvents.off('error', onMapStyleEvent);
  };

  const clearAttempt = (): void => {
    if (pendingAttempt !== undefined) clearTimeout(pendingAttempt.replayTimer);
    pendingAttempt = undefined;
  };

  const enterTerminal = (error: StyleToolError, closeSocket = true): void => {
    if (terminal) return;
    terminal = true;
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    clearAttempt();
    const generation = current;
    current = undefined;
    if (generation !== undefined) {
      generation.state = 'terminal';
      generation.abortController.abort();
      generation.activeCorrelations.clear();
      removeGenerationListeners(generation);
      if (closeSocket && generation.socket.readyState < SOCKET_CLOSING) {
        try { generation.socket.close(1000, 'bridge client closed'); } catch { /* no-op */ }
      }
    }
    removeMapListeners();
    publishStatus('terminal');
    subscribers.clear();
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
  };

  const sendEncoded = (generation: Generation, encoded: string): void => {
    if (terminal || current !== generation || generation.socket.readyState !== SOCKET_OPEN) {
      throw disconnectedError();
    }
    generation.socket.send(encoded);
  };

  const closeGeneration = (generation: Generation, code: number, reason: string): void => {
    if (current !== generation || generation.state === 'terminal') return;
    generation.state = 'terminal';
    generation.abortController.abort();
    try { generation.socket.close(code, reason); } catch {
      enterTerminal(disconnectedError(), false);
    }
  };

  const sendEvent = (
    generation: Generation,
    event: BridgeEventFrame,
  ): void => {
    const limits = effectiveLimits;
    if (limits === undefined) throw disconnectedError();
    const projected = prepareOutboundBridgeFrame(
      event, capabilities, limits.maxMessageBytes,
    );
    sendEncoded(generation, projected.encoded);
  };

  const scheduleRecovery = (generation: Generation): Promise<void> => {
    if (terminal || current !== generation || generation.state !== 'registered') {
      return Promise.resolve();
    }
    if (recoveryRunning) return recoveryPromise ?? Promise.resolve();
    recoveryRunning = true;
    recoveryPromise = (async () => {
      try {
        if (unknownStatusGeneration !== generation.id) {
          sendEvent(generation, {
            protocolVersion: BRIDGE_PROTOCOL_VERSION,
            kind: 'event', event: 'mapStatus', mapId, syncState: 'unknown',
          });
          unknownStatusGeneration = generation.id;
        }
        const activeRuntime = runtime;
        if (activeRuntime === undefined) return;
        let snapshot: BrowserMapState;
        try {
          snapshot = await activeRuntime.noteExternalStyle();
        } catch {
          return;
        }
        if (terminal || current !== generation || generation.state !== 'registered') return;
        sendEvent(generation, {
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          kind: 'event', event: 'mapSnapshot', mapId,
          snapshot: snapshotForEvent(snapshot),
        });
        unknownStatusGeneration = undefined;
      } catch {
        if (!terminal && current === generation) {
          closeGeneration(generation, 1011, 'bridge recovery failed');
        }
      } finally {
        if (current === generation) {
          recoveryRunning = false;
          recoveryPromise = undefined;
        }
      }
    })();
    return recoveryPromise;
  };

  const observeExternal = async (generation: Generation): Promise<void> => {
    const activeRuntime = runtime;
    if (activeRuntime === undefined || terminal || current !== generation
      || generation.state !== 'registered') return;
    let before: BrowserMapState | undefined;
    try { before = activeRuntime.snapshot(); } catch { /* Unknown state. */ }
    try {
      const snapshot = await activeRuntime.noteExternalStyle();
      if (terminal || current !== generation || generation.state !== 'registered') return;
      if (before === undefined || before.styleHash !== snapshot.styleHash) {
        sendEvent(generation, {
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          kind: 'event', event: 'externalStyleChange', mapId,
          snapshot: snapshotForEvent(snapshot),
        });
      }
    } catch {
      await scheduleRecovery(generation);
    }
  };

  function onMapStyleEvent(): void {
    if (terminal) return;
    if (activeCommandCount > 0) {
      externalDirty = true;
      return;
    }
    if (externalScheduled) return;
    externalScheduled = true;
    queueMicrotask(() => {
      externalScheduled = false;
      const generation = current;
      if (generation !== undefined) {
        if (unknownStatusGeneration === generation.id) void scheduleRecovery(generation);
        else void observeExternal(generation);
      }
    });
  }

  mapEvents.on('style.load', onMapStyleEvent);
  mapEvents.on('styledata', onMapStyleEvent);
  mapEvents.on('error', onMapStyleEvent);

  const makeAttempt = async (): Promise<RegistrationAttempt> => {
    const activeRuntime = runtime;
    const limits = effectiveLimits;
    if (activeRuntime === undefined || limits === undefined) throw disconnectedError();
    const snapshot = await activeRuntime.noteExternalStyle();
    const attemptId = randomBase64Url();
    const frame: BridgeRegisterFrame = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      kind: 'register',
      correlationId: `register-${attemptId.slice(0, 32)}`,
      registrationAttemptId: attemptId,
      mapId,
      ...(lastLease === undefined ? {} : { replaceLeaseId: lastLease }),
      capabilities: [...capabilities],
      limits,
      snapshot: snapshotForEvent(snapshot),
    };
    const encoded = prepareOutboundBridgeFrame(
      frame, capabilities, limits.maxMessageBytes,
    ).encoded;
    const firstSentAt = Date.now();
    const replayTimer = setTimeout(() => {
      if (pendingAttempt?.frame.registrationAttemptId === attemptId) {
        enterTerminal(disconnectedError());
      }
    }, REGISTRATION_REPLAY_CLIENT_BUDGET_MS);
    return { frame, encoded, firstSentAt, replayTimer };
  };

  const finishRegistration = async (
    generation: Generation,
    frame: Extract<BridgeResultFrame, { ok: true }>,
  ): Promise<void> => {
    const attempt = pendingAttempt;
    const limits = effectiveLimits;
    if (attempt === undefined || limits === undefined) throw new Error('registration owner missing');
    assertCorrelated(attempt.frame, frame);
    if (frame.result.type !== 'registered' || !limitsEqual(frame.result.limits, limits)) {
      throw new Error('registered acknowledgement limits mismatch');
    }
    lastLease = frame.result.leaseId;
    generation.state = 'registered';
    if (generation.replayedAttempt) {
      const activeRuntime = runtime;
      if (activeRuntime === undefined) throw new Error('runtime unavailable');
      const snapshot = await activeRuntime.noteExternalStyle();
      if (terminal || current !== generation) return;
      sendEvent(generation, {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        kind: 'event', event: 'mapSnapshot', mapId,
        snapshot: snapshotForEvent(snapshot),
      });
    }
    clearAttempt();
    reconnectAttempt = 0;
    everConnected = true;
    publishStatus('connected');
    if (!readySettled) {
      readySettled = true;
      resolveReady();
    }
    if (externalDirty) {
      externalDirty = false;
      onMapStyleEvent();
    }
  };

  const sendRegistration = async (generation: Generation): Promise<void> => {
    if (pendingAttempt !== undefined) {
      if (Date.now() - pendingAttempt.firstSentAt >= REGISTRATION_REPLAY_CLIENT_BUDGET_MS) {
        throw disconnectedError();
      }
      generation.replayedAttempt = true;
    } else {
      pendingAttempt = await makeAttempt();
      generation.replayedAttempt = false;
    }
    if (terminal || current !== generation) return;
    generation.state = 'registering';
    publishStatus('registering');
    sendEncoded(generation, pendingAttempt.encoded);
  };

  const initializeAfterAuth = async (
    generation: Generation,
    frame: Extract<BridgeResultFrame, { ok: true }>,
  ): Promise<void> => {
    assertCorrelated(generation.authFrame, frame);
    if (frame.result.type !== 'authenticated') throw new Error('expected authenticated result');
    const chosen = selectEffectiveLimits(frame.result.limits, options);
    if (effectiveLimits !== undefined && !limitsEqual(effectiveLimits, chosen)) {
      throw invalidInput('Reconnect server ceilings changed effective limits.');
    }
    effectiveLimits = chosen;
    generation.state = 'initializing';
    publishStatus('initializing');
    if (runtimeReady === undefined) {
      runtimeReady = createBrowserMapRuntime(map, {
        capabilities,
        resourcePolicy,
        maxStyleBytes: chosen.maxStyleBytes,
        maxDiffBytes: chosen.maxDiffBytes,
        maxOperations: chosen.maxOperations,
        ...(options.imageLoader === undefined ? {} : { imageLoader: options.imageLoader }),
        onSyncStateChange: () => {
          const activeGeneration = current;
          if (activeGeneration !== undefined) void scheduleRecovery(activeGeneration);
        },
      });
      void runtimeReady.catch(() => undefined);
    }
    runtime = await runtimeReady;
    if (terminal || current !== generation) return;
    await sendRegistration(generation);
  };

  const sendResult = (
    generation: Generation,
    request: BridgeCommandFrame,
    frame: BridgeResultFrame,
  ): void => {
    const limits = effectiveLimits;
    if (limits === undefined) throw disconnectedError();
    try {
      const projected = prepareOutboundBridgeFrame(
        frame, capabilities, request.command, limits.maxMessageBytes,
      );
      sendEncoded(generation, projected.encoded);
    } catch (error) {
      if (!(error instanceof RangeError) || !frame.ok || request.command.type !== 'getStyle') {
        throw error;
      }
      const fallback: BridgeResultFrame = {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        kind: 'result', correlationId: request.correlationId, ok: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid bridge input' },
      };
      const projected = prepareOutboundBridgeFrame(
        fallback, capabilities, request.command, limits.maxMessageBytes,
      );
      sendEncoded(generation, projected.encoded);
    }
  };

  const dispatchCommand = (generation: Generation, request: BridgeCommandFrame): void => {
    if (request.mapId !== mapId) {
      closeGeneration(generation, 1008, 'bridge map mismatch');
      return;
    }
    if (generation.activeCorrelations.has(request.correlationId)) {
      closeGeneration(generation, 1008, 'duplicate active correlation');
      return;
    }
    const now = Date.now();
    if (request.deadlineAt > now + 10_000) {
      closeGeneration(generation, 1008, 'bridge deadline exceeds window');
      return;
    }
    if (request.command.type === 'applyTransaction'
      && effectiveLimits !== undefined
      && request.command.transaction.operations.length > effectiveLimits.maxOperations) {
      closeGeneration(generation, 1008, 'bridge transaction exceeds operation limit');
      return;
    }
    generation.activeCorrelations.set(request.correlationId, request.command);
    if (request.deadlineAt <= now) {
      try {
        sendResult(generation, request, {
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          kind: 'result', correlationId: request.correlationId, ok: false,
          error: { code: 'TIMEOUT', message: 'Bridge operation timed out' },
        });
      } finally {
        generation.activeCorrelations.delete(request.correlationId);
      }
      return;
    }
    generation.commandTail = generation.commandTail.then(async () => {
      if (terminal || current !== generation || generation.state !== 'registered'
        || generation.abortController.signal.aborted) {
        generation.activeCorrelations.delete(request.correlationId);
        return;
      }
      const activeRuntime = runtime;
      if (activeRuntime === undefined) return;
      activeCommandCount += 1;
      try {
        const result = await activeRuntime.execute(request.command, {
          deadlineAt: request.deadlineAt,
          signal: generation.abortController.signal,
        });
        if (recoveryPromise !== undefined) await recoveryPromise;
        if (terminal || current !== generation || generation.state !== 'registered') return;
        sendResult(generation, request, {
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          kind: 'result', correlationId: request.correlationId, ok: true, result,
        });
      } catch (error) {
        if (recoveryPromise !== undefined) await recoveryPromise;
        if (terminal || current !== generation || generation.state !== 'registered') return;
        const safe = safeFailure(error);
        const wireError: Extract<BridgeResultFrame, { ok: false }>['error'] = {
          code: safe.code,
          message: safe.message,
          ...(safe.path === undefined ? {} : { path: safe.path }),
          ...(safe.details === undefined ? {} : { details: safe.details }),
        };
        sendResult(generation, request, {
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          kind: 'result', correlationId: request.correlationId, ok: false,
          error: wireError,
        });
      } finally {
        activeCommandCount -= 1;
        generation.activeCorrelations.delete(request.correlationId);
        if (externalDirty && activeCommandCount === 0) {
          externalDirty = false;
          onMapStyleEvent();
        }
      }
    }).catch(() => {
      if (!terminal && current === generation) {
        closeGeneration(generation, 1011, 'bridge command dispatch failed');
      }
    });
  };

  const handleMessage = async (generation: Generation, event: unknown): Promise<void> => {
    if (terminal || current !== generation) return;
    const data = messageData(event);
    if (generation.state === 'registered') {
      const limits = effectiveLimits;
      if (limits === undefined) throw new Error('effective limits unavailable');
      const request = decodeBridgeFrame(data, BridgeCommandFrameSchema, limits.maxMessageBytes);
      dispatchCommand(generation, request);
      return;
    }
    const result = decodeBridgeFrame(
      data,
      BridgeResultFrameSchema,
      effectiveLimits?.maxMessageBytes ?? MAX_BRIDGE_MESSAGE_BYTES,
    );
    if (!result.ok) {
      enterTerminal(authenticWireError(result));
      return;
    }
    if (generation.state === 'authenticating') {
      await initializeAfterAuth(generation, result);
      return;
    }
    if (generation.state === 'registering') await finishRegistration(generation, result);
  };

  const scheduleReconnect = (): void => {
    if (reconnectPolicy === undefined) {
      enterTerminal(disconnectedError(), false);
      return;
    }
    const delay = Math.min(
      reconnectPolicy.initialDelayMs * reconnectPolicy.factor ** reconnectAttempt,
      reconnectPolicy.maxDelayMs,
    );
    reconnectAttempt += 1;
    publishStatus('reconnecting');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      if (!terminal) openGeneration();
    }, delay);
  };

  const handleClose = (generation: Generation, event: unknown): void => {
    if (terminal || current !== generation) return;
    generation.state = 'terminal';
    generation.abortController.abort();
    generation.activeCorrelations.clear();
    removeGenerationListeners(generation);
    current = undefined;
    recoveryRunning = false;
    recoveryPromise = undefined;
    unknownStatusGeneration = undefined;
    const code = closeCode(event);
    const registrationMayHaveCommitted = pendingAttempt !== undefined;
    if (!localClose && TRANSIENT_CLOSE_CODES.has(code)
      && (everConnected || registrationMayHaveCommitted)) {
      scheduleReconnect();
      return;
    }
    enterTerminal(disconnectedError(), false);
  };

  function openGeneration(): void {
    generationNumber += 1;
    const socket = websocketFactory(options.url);
    socket.binaryType = 'arraybuffer';
    const authFrame = BridgeAuthFrameSchema.parse({
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      kind: 'auth', correlationId: `auth-${generationNumber}`, token,
    });
    const listeners = {
      open: () => {
        if (terminal || current !== generation) return;
        try { sendEncoded(generation, encodeBridgeFrame(authFrame)); }
        catch { enterTerminal(disconnectedError()); }
      },
      message: (event: unknown) => {
        void handleMessage(generation, event).catch((error: unknown) => {
          if (terminal || current !== generation) return;
          const code = error instanceof RangeError ? 1009 : 1002;
          closeGeneration(generation, code, 'bridge protocol failure');
        });
      },
      close: (event: unknown) => handleClose(generation, event),
      error: () => { /* The following close event owns reconnect classification. */ },
    };
    const generation: Generation = {
      id: generationNumber,
      socket,
      abortController: new AbortController(),
      state: 'authenticating',
      authFrame,
      commandTail: Promise.resolve(),
      activeCorrelations: new Map(),
      replayedAttempt: false,
      listeners,
    };
    current = generation;
    publishStatus(everConnected || pendingAttempt !== undefined ? 'reconnecting' : 'authenticating');
    socket.addEventListener('open', listeners.open);
    socket.addEventListener('message', listeners.message);
    socket.addEventListener('close', listeners.close);
    socket.addEventListener('error', listeners.error);
  }

  const connection: MapLibreBridgeConnection = {
    get status() { return status; },
    whenReady() { return ready; },
    snapshot() {
      if (!everConnected || runtime === undefined || status !== 'connected') throw mapNotReadyError();
      return runtime.snapshot();
    },
    subscribe(listener) {
      if (terminal) return () => undefined;
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    close() {
      if (terminal) return;
      localClose = true;
      enterTerminal(disconnectedError());
    },
  };

  openGeneration();
  return connection;
}
