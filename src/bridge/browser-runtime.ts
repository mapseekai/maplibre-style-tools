import type { Map as MapLibreMap } from 'maplibre-gl';

import {
  applyPreparedStyleToMap,
  applyStyleDocumentOrUrlToMap,
  createMapRuntimeCommands,
  hashStyle,
  prepareTransactionForMap,
  queryRenderedFeaturesBounded,
  querySourceFeaturesBounded,
  type MapOperationDeadline,
  type MapStyleApplyResult,
  type ImageDataLike,
  type RuntimeCommandResult,
  type RuntimeImageLoader,
} from '../adapters/maplibre/index.js';
import {
  createStyleToolError,
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
  isStyleToolError,
  jsonUtf8ByteLength,
  validateStyleDocument,
  type CoreExecutionLimits,
  type JsonObject,
  type JsonValue,
  type StyleDocument,
  type StyleToolError,
} from '../core/index.js';
import { assertCapability } from './capabilities.js';
import {
  BridgeCapabilitySchema,
  BridgeCommandSchema,
  type BridgeCapability,
  type BridgeCommand,
  type BridgeFeaturesResult,
  type BridgeResultFor,
  type BridgeTransactionResult,
} from './protocol.js';
import {
  assertRuntimeImageResourcePolicy,
  assertStyleDocumentUrlPolicy,
  assertStyleResourcePolicy,
  normalizeResourcePolicy,
  type NormalizedResourcePolicy,
  type ResourcePolicy,
} from './resource-policy.js';

const MAX_COMMAND_WINDOW_MS = 10_000;
const MAX_FEATURES = 100;
const MAX_FEATURE_BYTES = 1024 * 1024;
const MAX_STATE_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_IDS = 500;
const MAX_IMAGE_LIST_BYTES = 64 * 1024;

export interface BrowserMapState {
  revision: number;
  styleHash: string;
  style: StyleDocument;
}

export interface BrowserRuntimeOptions {
  capabilities: readonly BridgeCapability[];
  resourcePolicy: ResourcePolicy;
  timeoutMs?: number;
  maxQueryFeatures?: number;
  maxQueryBytes?: number;
  maxRuntimeStateBytes?: number;
  maxImageBytes?: number;
  maxStyleBytes?: number;
  maxDiffBytes?: number;
  maxOperations?: number;
  imageLoader?: RuntimeImageLoader;
  onExternalStyleChange?: (snapshot: BrowserMapState) => void;
  onSyncStateChange?: (event: {
    syncState: 'unknown';
    reason: 'invalid-map-style' | 'adapter-authority-unavailable';
  }) => void;
}

export type BrowserRuntimeResult<C extends BridgeCommand> = BridgeResultFor<C>;

export interface BrowserMapRuntime {
  snapshot(): BrowserMapState;
  noteExternalStyle(): Promise<BrowserMapState>;
  execute<C extends BridgeCommand>(
    command: C,
    execution?: { deadlineAt?: number; signal?: AbortSignal },
  ): Promise<BrowserRuntimeResult<C>>;
}

type SyncReason = 'invalid-map-style' | 'adapter-authority-unavailable';
type PendingRecovery = {
  resolve(): void;
};

type CommandDeadline = {
  deadline: MapOperationDeadline;
  cleanup(): void;
};

type CommandExecutionState = {
  nonAbortableMapWorkStarted: boolean;
};

const snapshotJson = (state: BrowserMapState, includeStyle: boolean): JsonObject => ({
  revision: state.revision,
  styleHash: state.styleHash,
  ...(includeStyle ? { style: structuredClone(state.style) } : {}),
});

const ownData = (value: object, key: PropertyKey): unknown => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
};

const ownOptionalData = (
  value: unknown,
  key: PropertyKey,
): { ok: true; present: boolean; value?: unknown } | { ok: false } => {
  if (typeof value !== 'object' || value === null) return { ok: false };
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return { ok: true, present: false };
    return 'value' in descriptor
      ? { ok: true, present: true, value: descriptor.value }
      : { ok: false };
  } catch {
    return { ok: false };
  }
};

const positiveSafeInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw createStyleToolError('INVALID_INPUT', `${name} must be a positive safe integer.`);
  }
  return value;
};

const cloneState = (state: BrowserMapState): BrowserMapState => ({
  revision: state.revision,
  styleHash: state.styleHash,
  style: structuredClone(state.style),
});

const publicFailure = (fallback: string, error: unknown): StyleToolError =>
  isStyleToolError(error)
    ? error
    : createStyleToolError('INTERNAL', fallback);

const firstValidationError = (raw: unknown, maxStyleBytes: number): StyleDocument => {
  const validated = validateStyleDocument(raw, { maxStyleBytes });
  if (!validated.ok) {
    const first = validated.errors[0];
    throw first === undefined
      ? createStyleToolError('INVALID_INPUT', 'Map style is invalid or over limit.')
      : createStyleToolError(
          'INVALID_INPUT', 'Map style is invalid or over limit.', first.path, first.details,
        );
  }
  return validated.style;
};

const readValidatedMapStyle = (map: MapLibreMap, maxStyleBytes: number): StyleDocument => {
  let raw: unknown;
  try {
    raw = map.getStyle();
  } catch {
    throw createStyleToolError('INTERNAL', 'Map style authority is unavailable.');
  }
  return firstValidationError(raw, maxStyleBytes);
};

const validateImageData = (raw: unknown, maxBytes: number): ImageDataLike => {
  if (typeof raw !== 'object' || raw === null) {
    throw createStyleToolError('INVALID_INPUT', 'Decoded image is invalid.');
  }
  const width = ownData(raw, 'width');
  const height = ownData(raw, 'height');
  const data = ownData(raw, 'data');
  if (!Number.isSafeInteger(width) || (width as number) <= 0 || (width as number) > 2048
    || !Number.isSafeInteger(height) || (height as number) <= 0 || (height as number) > 2048
    || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray)) {
    throw createStyleToolError('INVALID_INPUT', 'Decoded image is invalid.');
  }
  const expected = (width as number) * (height as number) * 4;
  if (!Number.isSafeInteger(expected) || expected > maxBytes || data.byteLength !== expected) {
    throw createStyleToolError('INVALID_INPUT', 'Decoded image exceeds limits or has invalid bytes.');
  }
  return {
    width: width as number,
    height: height as number,
    data: new Uint8Array(data),
  };
};

const readBoundedResponse = async (
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> => {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const claimed = Number(contentLength);
    if (!Number.isSafeInteger(claimed) || claimed < 0 || claimed > maxBytes) {
      throw createStyleToolError('INVALID_INPUT', 'Image response exceeds the encoded byte limit.');
    }
  }
  if (!response.ok || (response.status >= 300 && response.status < 400)) {
    throw createStyleToolError('IO_ERROR', 'Image request failed.');
  }
  if (response.body === null) {
    throw createStyleToolError('IO_ERROR', 'Image response body is unavailable.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw timeoutError();
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw createStyleToolError('INVALID_INPUT', 'Image response exceeds the encoded byte limit.');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const decodeImageBytes = async (
  bytes: Uint8Array,
  maxBytes: number,
  signal: AbortSignal,
): Promise<ImageDataLike> => {
  if (signal.aborted) throw timeoutError();
  if (typeof globalThis.createImageBitmap !== 'function') {
    throw createStyleToolError('INTERNAL', 'Image decoding is unavailable.');
  }
  const bitmap = await globalThis.createImageBitmap(
    new Blob([Uint8Array.from(bytes).buffer]),
  );
  try {
    if (signal.aborted) throw timeoutError();
    if (bitmap.width > 2048 || bitmap.height > 2048) {
      throw createStyleToolError('INVALID_INPUT', 'Decoded image dimensions exceed limits.');
    }
    let pixels: Uint8ClampedArray;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (context === null) throw createStyleToolError('INTERNAL', 'Image decoding is unavailable.');
      context.drawImage(bitmap, 0, 0);
      pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (context === null) throw createStyleToolError('INTERNAL', 'Image decoding is unavailable.');
      context.drawImage(bitmap, 0, 0);
      pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    } else {
      throw createStyleToolError('INTERNAL', 'Image decoding is unavailable.');
    }
    return validateImageData({ width: bitmap.width, height: bitmap.height, data: pixels }, maxBytes);
  } finally {
    bitmap.close();
  }
};

const defaultImageLoader = (maxBytes: number): RuntimeImageLoader => ({
  async load(url, { signal }) {
    let response: Response;
    try {
      response = await fetch(url, {
        credentials: 'omit',
        redirect: 'manual',
        signal,
      });
    } catch {
      if (signal.aborted) throw timeoutError();
      throw createStyleToolError('IO_ERROR', 'Image request failed.');
    }
    const bytes = await readBoundedResponse(response, maxBytes, signal);
    return decodeImageBytes(bytes, maxBytes, signal);
  },
});

const boundedImageLoader = (
  loader: RuntimeImageLoader,
  maxBytes: number,
): RuntimeImageLoader => ({
  async load(url, options) {
    const raw = await loader.load(url, options);
    if (options.signal.aborted) throw timeoutError();
    return validateImageData(raw, maxBytes);
  },
});

const createCommandDeadline = (
  deadlineAt: number,
  callerSignal: AbortSignal | undefined,
): CommandDeadline => {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (callerSignal?.aborted === true) abort();
  else callerSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, Math.max(0, deadlineAt - Date.now()));
  return {
    deadline: { expiresAt: deadlineAt, signal: controller.signal },
    cleanup() {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abort);
    },
  };
};

const hashWithDeadline = (
  style: StyleDocument,
  deadline: MapOperationDeadline,
): Promise<string> => {
  const work = hashStyle(style);
  if (deadline.signal?.aborted === true || Date.now() >= deadline.expiresAt) {
    void work.then(() => undefined, () => undefined);
    return Promise.reject(timeoutError());
  }
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      deadline.signal?.removeEventListener('abort', onAbort);
      action();
    };
    const onAbort = (): void => finish(() => reject(timeoutError()));
    const timer = setTimeout(onAbort, Math.max(0, deadline.expiresAt - Date.now()));
    deadline.signal?.addEventListener('abort', onAbort, { once: true });
    if (deadline.signal?.aborted === true) onAbort();
    void work.then(
      (hash) => finish(() => resolve(hash)),
      () => finish(() => reject(createStyleToolError('INTERNAL', 'Map style hashing failed.'))),
    );
  });
};

const byteArrayFromBase64 = (value: string): Uint8Array => {
  try {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
      throw new Error('invalid base64');
    }
    if (typeof globalThis.atob === 'function') {
      const decoded = globalThis.atob(value);
      return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    }
  } catch {
    throw createStyleToolError('INVALID_INPUT', 'Image data is not valid base64.');
  }
  throw createStyleToolError('INVALID_INPUT', 'Base64 decoding is unavailable.');
};

const mapRuntimeError = <Value extends JsonValue>(
  result: RuntimeCommandResult<Value>,
): Value => {
  if (!result.ok) throw result.error;
  return result.data;
};

const timeoutError = (): StyleToolError =>
  createStyleToolError('TIMEOUT', 'Browser map command timed out.');

const deadlineExpired = (deadline: MapOperationDeadline): boolean =>
  deadline.signal?.aborted === true || Date.now() >= deadline.expiresAt;

const mapNotReadyError = (): StyleToolError =>
  createStyleToolError('MAP_NOT_READY', 'Map is not ready.');

const conflictError = (state: BrowserMapState, includeStyle: boolean): StyleToolError =>
  createStyleToolError(
    'REVISION_CONFLICT',
    'Live map revision conflict.',
    undefined,
    { currentSnapshot: snapshotJson(state, includeStyle) },
  );

const errorWithSnapshot = (
  primary: StyleToolError,
  state: BrowserMapState,
  includeStyle: boolean,
  result: MapStyleApplyResult,
): StyleToolError => {
  const details: JsonObject = {
    currentSnapshot: snapshotJson(state, includeStyle),
  };
  if ('rolledBack' in result && typeof result.rolledBack === 'boolean') {
    details.rolledBack = result.rolledBack;
  }
  if ('rollbackError' in result && result.rollbackError !== undefined) {
    details.rollbackError = {
      code: result.rollbackError.code,
      message: result.rollbackError.message,
      ...(result.rollbackError.path === undefined ? {} : { path: result.rollbackError.path }),
    };
  }
  return createStyleToolError(primary.code, primary.message, primary.path, details);
};

const transactionOutput = (
  result: Extract<MapStyleApplyResult, { ok: true }>,
  state: BrowserMapState,
  includeStyle: boolean,
  maxStyleBytes: number,
  maxDiffBytes: number,
): BridgeTransactionResult => {
  if (!includeStyle) {
    return {
      type: 'transaction', detail: 'receipt', revision: state.revision,
      styleHash: state.styleHash, applied: result.applied, noOp: !result.applied,
    };
  }
  const diffBytes = jsonUtf8ByteLength(result.diff as JsonValue);
  const styleBytes = jsonUtf8ByteLength(state.style as JsonValue);
  const output: BridgeTransactionResult = {
    type: 'transaction', detail: 'full', revision: state.revision,
    styleHash: state.styleHash, applied: result.applied, noOp: !result.applied,
    changedLayerIds: [...result.changedLayers],
    changedSourceIds: [...result.changedSources],
    warnings: structuredClone(result.warnings),
  };
  if (styleBytes <= maxStyleBytes) output.style = structuredClone(state.style);
  if (diffBytes <= maxDiffBytes) output.diff = structuredClone(result.diff);
  if (output.style === undefined || output.diff === undefined) {
    output.omitted = {
      ...(output.style === undefined ? { style: true as const } : {}),
      ...(output.diff === undefined ? { diff: true as const } : {}),
    };
  }
  return output;
};

export async function createBrowserMapRuntime(
  map: MapLibreMap,
  options: BrowserRuntimeOptions,
): Promise<BrowserMapRuntime> {
  if (typeof options !== 'object' || options === null) {
    throw createStyleToolError('INVALID_INPUT', 'Browser runtime options must be an object.');
  }
  const limits: Readonly<CoreExecutionLimits> = Object.freeze({
    maxStyleBytes: positiveSafeInteger(
      options.maxStyleBytes ?? DEFAULT_MAX_STYLE_BYTES, 'maxStyleBytes',
    ),
    maxDiffBytes: positiveSafeInteger(
      options.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES, 'maxDiffBytes',
    ),
    maxOperations: positiveSafeInteger(
      options.maxOperations ?? DEFAULT_MAX_OPERATIONS, 'maxOperations',
    ),
  });
  const localTimeoutMs = positiveSafeInteger(
    Math.min(options.timeoutMs ?? MAX_COMMAND_WINDOW_MS, MAX_COMMAND_WINDOW_MS),
    'timeoutMs',
  );
  const maxQueryFeatures = Math.min(positiveSafeInteger(
    options.maxQueryFeatures ?? MAX_FEATURES, 'maxQueryFeatures',
  ), MAX_FEATURES);
  const maxQueryBytes = Math.min(positiveSafeInteger(
    options.maxQueryBytes ?? MAX_FEATURE_BYTES, 'maxQueryBytes',
  ), MAX_FEATURE_BYTES);
  const maxRuntimeStateBytes = Math.min(positiveSafeInteger(
    options.maxRuntimeStateBytes ?? MAX_STATE_BYTES, 'maxRuntimeStateBytes',
  ), MAX_STATE_BYTES);
  const maxImageBytes = Math.min(positiveSafeInteger(
    options.maxImageBytes ?? MAX_IMAGE_BYTES, 'maxImageBytes',
  ), MAX_IMAGE_BYTES);
  let capabilities: readonly BridgeCapability[];
  try {
    if (!Array.isArray(options.capabilities)) throw new TypeError('capabilities must be an array');
    const parsedCapabilities = options.capabilities.map((capability) =>
      BridgeCapabilitySchema.parse(capability));
    if (new Set(parsedCapabilities).size !== parsedCapabilities.length) {
      throw new TypeError('capabilities must be unique');
    }
    capabilities = Object.freeze(parsedCapabilities);
  } catch {
    throw createStyleToolError('INVALID_INPUT', 'Browser runtime capabilities are invalid.');
  }
  let resourcePolicy: NormalizedResourcePolicy;
  try {
    resourcePolicy = normalizeResourcePolicy(options.resourcePolicy);
  } catch {
    throw createStyleToolError('INVALID_INPUT', 'Browser resource policy is invalid.');
  }
  const configuredImageLoader = options.imageLoader;
  const runtimeCommands = createMapRuntimeCommands(map, {
    imageLoader: boundedImageLoader(
      configuredImageLoader ?? defaultImageLoader(maxImageBytes),
      maxImageBytes,
    ),
  });
  const initialStyle = readValidatedMapStyle(map, limits.maxStyleBytes);
  let state: BrowserMapState = {
    revision: 0,
    styleHash: await hashStyle(initialStyle),
    style: initialStyle,
  };
  let synchronized = true;
  let tail: Promise<void> = Promise.resolve();
  let pendingRecovery: PendingRecovery | undefined;

  const includeStyle = capabilities.includes('style.read');

  const setUnknown = (reason: SyncReason): void => {
    if (!synchronized) return;
    synchronized = false;
    try {
      options.onSyncStateChange?.({ syncState: 'unknown', reason });
    } catch {
      // Notification failures cannot change map authority.
    }
  };

  const waitForRecovery = (reason: SyncReason): Promise<void> =>
    new Promise<void>((resolve) => {
      pendingRecovery = { resolve };
      setUnknown(reason);
    });

  const observe = async (
    publishExternal: boolean,
    deadline?: MapOperationDeadline,
  ): Promise<BrowserMapState> => {
    let observed: StyleDocument;
    try {
      observed = readValidatedMapStyle(map, limits.maxStyleBytes);
    } catch (error) {
      setUnknown('invalid-map-style');
      throw error;
    }
    let observedHash: string;
    try {
      observedHash = deadline === undefined
        ? await hashStyle(observed)
        : await hashWithDeadline(observed, deadline);
    } catch (error) {
      if (isStyleToolError(error) && error.code === 'TIMEOUT') throw error;
      setUnknown('invalid-map-style');
      throw publicFailure('Map style hashing failed.', error);
    }
    const changed = observedHash !== state.styleHash;
    if (changed) {
      state = { revision: state.revision + 1, styleHash: observedHash, style: observed };
    } else if (!synchronized) {
      state = { ...state, style: observed };
    }
    synchronized = true;
    if (changed && publishExternal) {
      try {
        options.onExternalStyleChange?.(cloneState(state));
      } catch {
        // Notification failures cannot change map authority.
      }
    }
    if (pendingRecovery !== undefined) {
      const recovery = pendingRecovery;
      pendingRecovery = undefined;
      recovery.resolve();
    }
    return cloneState(state);
  };

  const reconcileResult = async (
    result: MapStyleApplyResult,
    baselineHash: string,
    candidateHash: string | undefined,
    deadline: MapOperationDeadline,
  ): Promise<BridgeTransactionResult> => {
    if (result.styleAuthority !== 'current') {
      await waitForRecovery('adapter-authority-unavailable');
      const primary = deadline.signal?.aborted === true || Date.now() >= deadline.expiresAt
        ? timeoutError()
        : result.error;
      throw errorWithSnapshot(primary, state, includeStyle, result);
    }
    let currentStyle: StyleDocument;
    let currentHash: string;
    try {
      currentStyle = firstValidationError(result.style, limits.maxStyleBytes);
      currentHash = await hashWithDeadline(currentStyle, deadline);
    } catch {
      await waitForRecovery('invalid-map-style');
      const primary = deadline.signal?.aborted === true || Date.now() >= deadline.expiresAt
        ? timeoutError()
        : createStyleToolError('INTERNAL', 'Map returned invalid current Style.');
      throw errorWithSnapshot(primary, state, includeStyle, result);
    }
    const changed = currentHash !== state.styleHash;
    if (changed) {
      state = { revision: state.revision + 1, styleHash: currentHash, style: currentStyle };
    } else {
      state = { ...state, style: currentStyle };
    }
    if (!result.ok) {
      throw errorWithSnapshot(result.error, state, includeStyle, result);
    }
    if (!result.applied && currentHash !== baselineHash) throw conflictError(state, includeStyle);
    if (result.applied && candidateHash !== currentHash) {
      throw errorWithSnapshot(
        createStyleToolError('INTERNAL', 'Applied Map Style does not match the prepared candidate.'),
        state,
        includeStyle,
        result,
      );
    }
    if (deadline.signal?.aborted === true || Date.now() >= deadline.expiresAt) {
      throw errorWithSnapshot(timeoutError(), state, includeStyle, result);
    }
    return transactionOutput(
      result, state, includeStyle, limits.maxStyleBytes, limits.maxDiffBytes,
    );
  };

  const executeQueued = async <C extends BridgeCommand>(
    command: C,
    sharedDeadline: MapOperationDeadline,
    executionState: CommandExecutionState,
  ): Promise<BrowserRuntimeResult<C>> => {
    assertCapability(capabilities, command);
    if (deadlineExpired(sharedDeadline)) {
      throw timeoutError();
    }
    if (!synchronized) throw mapNotReadyError();
    const reconciled = await observe(true, sharedDeadline);
    if (deadlineExpired(sharedDeadline)) {
      throw timeoutError();
    }
    switch (command.type) {
      case 'getStyle':
        return {
          type: 'style', revision: reconciled.revision,
          styleHash: reconciled.styleHash, style: structuredClone(reconciled.style),
        } as BridgeResultFor<Extract<C, { type: 'getStyle' }>> as BrowserRuntimeResult<C>;
      case 'applyTransaction': {
        if (command.expectedRevision !== reconciled.revision
          || command.expectedStyleHash !== reconciled.styleHash) {
          throw conflictError(reconciled, includeStyle);
        }
        const preparedOrResult = await prepareTransactionForMap(map, command.transaction, {
          ...limits,
          deadline: sharedDeadline,
        });
        if ('applied' in preparedOrResult) {
          if (preparedOrResult.styleAuthority !== 'current') {
            executionState.nonAbortableMapWorkStarted = true;
          }
          return await reconcileResult(
            preparedOrResult, reconciled.styleHash, undefined, sharedDeadline,
          ) as BrowserRuntimeResult<C>;
        }
        const prepared = preparedOrResult;
        if (prepared.view.baselineHash !== reconciled.styleHash) {
          await observe(true);
          throw conflictError(state, includeStyle);
        }
        const candidateValidation = validateStyleDocument(
          prepared.view.transactionResult.style,
          { maxStyleBytes: limits.maxStyleBytes },
        );
        if (!candidateValidation.ok) {
          throw candidateValidation.errors[0]
            ?? createStyleToolError('INVALID_INPUT', 'Prepared Style is invalid.');
        }
        const validatedCandidate = candidateValidation.style;
        if (jsonUtf8ByteLength(validatedCandidate as JsonValue) > limits.maxStyleBytes) {
          throw createStyleToolError('INVALID_INPUT', 'Prepared Style exceeds configured limit.');
        }
        const candidateHash = await hashWithDeadline(validatedCandidate, sharedDeadline);
        try {
          assertStyleResourcePolicy({
            baseline: reconciled.style,
            candidate: validatedCandidate,
            capabilities,
            policy: resourcePolicy,
          });
        } catch (error) {
          if (isStyleToolError(error)) throw error;
          throw createStyleToolError('INVALID_INPUT', 'Prepared Style resource URL is invalid.');
        }
        executionState.nonAbortableMapWorkStarted = true;
        const applied = await applyPreparedStyleToMap(map, prepared, {
          deadline: sharedDeadline,
        });
        return await reconcileResult(
          applied, reconciled.styleHash, candidateHash, sharedDeadline,
        ) as BrowserRuntimeResult<C>;
      }
      case 'applyStyleDocument': {
        if (command.expectedRevision !== reconciled.revision
          || command.expectedStyleHash !== reconciled.styleHash) {
          throw conflictError(reconciled, includeStyle);
        }
        if (command.source.kind === 'style') {
          const candidate = firstValidationError(command.source.style, limits.maxStyleBytes);
          let candidateHash: string;
          try {
            assertStyleResourcePolicy({
              baseline: reconciled.style,
              candidate,
              capabilities,
              policy: resourcePolicy,
            });
            candidateHash = await hashWithDeadline(candidate, sharedDeadline);
          } catch (error) {
            if (isStyleToolError(error)) throw error;
            throw createStyleToolError('INVALID_INPUT', 'Style document resource URL is invalid.');
          }
          executionState.nonAbortableMapWorkStarted = true;
          const applied = await applyStyleDocumentOrUrlToMap(map, candidate, {
            deadline: sharedDeadline,
            diff: command.diff,
            maxStyleBytes: limits.maxStyleBytes,
            maxDiffBytes: limits.maxDiffBytes,
          });
          return await reconcileResult(
            applied, reconciled.styleHash, candidateHash, sharedDeadline,
          ) as BrowserRuntimeResult<C>;
        }

        let approved: { resolvedUrl: string };
        try {
          approved = assertStyleDocumentUrlPolicy({
            url: command.source.url,
            capabilities,
            policy: resourcePolicy,
          });
        } catch (error) {
          if (isStyleToolError(error)) throw error;
          throw createStyleToolError('INVALID_INPUT', 'Style document URL is invalid.');
        }
        executionState.nonAbortableMapWorkStarted = true;
        const applied = await applyStyleDocumentOrUrlToMap(map, approved.resolvedUrl, {
          deadline: sharedDeadline,
          diff: command.diff,
          maxStyleBytes: limits.maxStyleBytes,
          maxDiffBytes: limits.maxDiffBytes,
        });
        if (!applied.ok || applied.styleAuthority !== 'current') {
          return await reconcileResult(
            applied, reconciled.styleHash, undefined, sharedDeadline,
          ) as BrowserRuntimeResult<C>;
        }
        const resolvedStyle = firstValidationError(applied.style, limits.maxStyleBytes);
        let resolvedHash: string;
        try {
          assertStyleResourcePolicy({
            baseline: reconciled.style,
            candidate: resolvedStyle,
            capabilities,
            policy: resourcePolicy,
          });
          resolvedHash = await hashWithDeadline(resolvedStyle, sharedDeadline);
        } catch (error) {
          const policyError = isStyleToolError(error)
            ? error
            : createStyleToolError('INVALID_INPUT', 'Resolved Style resource URL is invalid.');
          const restored = await applyStyleDocumentOrUrlToMap(map, reconciled.style, {
            deadline: sharedDeadline,
            diff: command.diff,
            maxStyleBytes: limits.maxStyleBytes,
            maxDiffBytes: limits.maxDiffBytes,
          });
          if (!restored.ok || restored.styleAuthority !== 'current') {
            await waitForRecovery('adapter-authority-unavailable');
            const primary = deadlineExpired(sharedDeadline) ? timeoutError() : policyError;
            const failedRestore: MapStyleApplyResult = {
              ...restored,
              rolledBack: false,
              ...(!restored.ok ? { rollbackError: restored.error } : {}),
            };
            throw errorWithSnapshot(primary, state, includeStyle, failedRestore);
          }
          const rejected: MapStyleApplyResult = {
            ...restored,
            ok: false,
            applied: false,
            changedLayers: [],
            changedSources: [],
            diff: [],
            error: policyError,
            rolledBack: true,
          };
          return await reconcileResult(
            rejected, reconciled.styleHash, undefined, sharedDeadline,
          ) as BrowserRuntimeResult<C>;
        }
        return await reconcileResult(
          applied, reconciled.styleHash, resolvedHash, sharedDeadline,
        ) as BrowserRuntimeResult<C>;
      }
      case 'querySourceFeatures': {
        const queried = querySourceFeaturesBounded(map, {
          sourceId: command.sourceId,
          ...(command.sourceLayer === undefined ? {} : { sourceLayer: command.sourceLayer }),
          ...(command.filter === undefined ? {} : { filter: command.filter }),
          ...(command.properties === undefined ? {} : { propertyAllowlist: command.properties }),
          limit: Math.min(command.limit ?? maxQueryFeatures, maxQueryFeatures),
        }, { maxFeatures: maxQueryFeatures, maxSerializedBytes: maxQueryBytes });
        if (!queried.ok) throw queried.error;
        return {
          type: 'features', features: queried.features, returned: queried.returned,
          truncated: queried.truncated,
          serializedBytes: jsonUtf8ByteLength(queried.features as JsonValue),
          warnings: queried.warnings,
        } as BrowserRuntimeResult<C>;
      }
      case 'queryRenderedFeatures': {
        const queried = queryRenderedFeaturesBounded(map, {
          ...(command.geometry === undefined ? {} : { geometry: command.geometry }),
          ...(command.layerIds === undefined ? {} : { layerIds: command.layerIds }),
          ...(command.filter === undefined ? {} : { filter: command.filter }),
          ...(command.properties === undefined ? {} : { propertyAllowlist: command.properties }),
          limit: Math.min(command.limit ?? maxQueryFeatures, maxQueryFeatures),
        }, { maxFeatures: maxQueryFeatures, maxSerializedBytes: maxQueryBytes });
        if (!queried.ok) throw queried.error;
        const result: BridgeFeaturesResult = {
          type: 'features', features: queried.features, returned: queried.returned,
          truncated: queried.truncated,
          serializedBytes: jsonUtf8ByteLength(queried.features as JsonValue),
          warnings: queried.warnings,
        };
        return result as BrowserRuntimeResult<C>;
      }
      case 'setFeatureState':
        mapRuntimeError(runtimeCommands.setFeatureState({
          target: command.target, state: command.state,
        }));
        return { type: 'state', accepted: true } as BrowserRuntimeResult<C>;
      case 'removeFeatureState':
        mapRuntimeError(runtimeCommands.removeFeatureState({
          target: command.target,
          ...(command.key === undefined ? {} : { key: command.key }),
        }));
        return { type: 'state', accepted: true } as BrowserRuntimeResult<C>;
      case 'setGlobalState':
        mapRuntimeError(runtimeCommands.setGlobalState({
          propertyName: command.propertyName, value: command.value,
        }));
        return { type: 'state', accepted: true } as BrowserRuntimeResult<C>;
      case 'listImages': {
        const listed = mapRuntimeError(runtimeCommands.listImages({ limit: MAX_IMAGE_IDS }));
        let imageIds = listed.items;
        while (jsonUtf8ByteLength(imageIds) > MAX_IMAGE_LIST_BYTES) imageIds = imageIds.slice(0, -1);
        return {
          type: 'images', imageIds,
          serializedBytes: jsonUtf8ByteLength(imageIds),
        } as BrowserRuntimeResult<C>;
      }
      case 'addImage': {
        let result: RuntimeCommandResult;
        if (command.image.kind === 'rgba') {
          const data = byteArrayFromBase64(command.image.data);
          const expected = command.image.width * command.image.height * 4;
          if (!Number.isSafeInteger(expected) || expected > maxImageBytes || data.byteLength !== expected) {
            throw createStyleToolError('INVALID_INPUT', 'Image data length or size is invalid.');
          }
          result = runtimeCommands.addImageData({
            imageId: command.imageId,
            image: { width: command.image.width, height: command.image.height, data },
            ...(command.options === undefined ? {} : { options: command.options }),
            ...(command.overwrite === undefined ? {} : { overwrite: command.overwrite }),
          });
        } else {
          let approved: { resolvedUrl: string };
          try {
            approved = assertRuntimeImageResourcePolicy({
              imageId: command.imageId,
              url: command.image.url,
              capabilities,
              policy: resourcePolicy,
            });
          } catch (error) {
            if (isStyleToolError(error)) throw error;
            throw createStyleToolError('INVALID_INPUT', 'Runtime image URL is invalid.');
          }
          const scheme = new URL(approved.resolvedUrl).protocol;
          if (configuredImageLoader === undefined
            && scheme !== 'http:' && scheme !== 'https:' && scheme !== 'data:') {
            throw createStyleToolError(
              'CAPABILITY_DENIED',
              'Custom protocol image loading requires an injected protocol-aware loader.',
            );
          }
          result = await runtimeCommands.addImageFromUrl({
            imageId: command.imageId,
            url: approved.resolvedUrl,
            ...(command.options === undefined ? {} : { options: command.options }),
            ...(command.overwrite === undefined ? {} : { overwrite: command.overwrite }),
          }, { signal: sharedDeadline.signal ?? new AbortController().signal });
        }
        mapRuntimeError(result);
        return { type: 'ack', accepted: true } as BrowserRuntimeResult<C>;
      }
      case 'removeImage':
        mapRuntimeError(runtimeCommands.removeImage({ imageId: command.imageId }));
        return { type: 'ack', accepted: true } as BrowserRuntimeResult<C>;
      case 'updateGeoJsonData':
      case 'setSourceTileLodParams':
      case 'listSprites':
      case 'addSprite':
      case 'removeSprite':
        throw createStyleToolError('CAPABILITY_DENIED', 'Bridge command is not supported by this runtime.');
      default:
        throw createStyleToolError('CAPABILITY_DENIED', 'Bridge command is not supported by this runtime.');
    }
  };

  const runtime: BrowserMapRuntime = {
    snapshot() {
      if (!synchronized) throw mapNotReadyError();
      return cloneState(state);
    },
    async noteExternalStyle() {
      return observe(true);
    },
    execute<C extends BridgeCommand>(
      rawCommand: C,
      execution: { deadlineAt?: number; signal?: AbortSignal } = {},
    ): Promise<BrowserRuntimeResult<C>> {
      const parsed = BridgeCommandSchema.safeParse(rawCommand);
      if (!parsed.success) {
        return Promise.reject(createStyleToolError('INVALID_INPUT', 'Invalid browser map command.'));
      }
      try {
        assertCapability(capabilities, parsed.data);
        if (parsed.data.type === 'setFeatureState'
          && jsonUtf8ByteLength({
            target: parsed.data.target,
            state: parsed.data.state,
          }) > maxRuntimeStateBytes) {
          throw createStyleToolError('INVALID_INPUT', 'Runtime state exceeds configured limit.');
        }
        if (parsed.data.type === 'removeFeatureState'
          && jsonUtf8ByteLength({
            target: parsed.data.target,
            ...(parsed.data.key === undefined ? {} : { key: parsed.data.key }),
          }) > maxRuntimeStateBytes) {
          throw createStyleToolError('INVALID_INPUT', 'Runtime state target exceeds configured limit.');
        }
        if (parsed.data.type === 'setGlobalState'
          && jsonUtf8ByteLength({
            propertyName: parsed.data.propertyName,
            value: parsed.data.value,
          }) > maxRuntimeStateBytes) {
          throw createStyleToolError('INVALID_INPUT', 'Runtime state exceeds configured limit.');
        }
      } catch (error) {
        return Promise.reject(publicFailure('Browser command preflight failed.', error));
      }
      const deadlineProperty = ownOptionalData(execution, 'deadlineAt');
      const signalProperty = ownOptionalData(execution, 'signal');
      if (!deadlineProperty.ok || !signalProperty.ok) {
        return Promise.reject(createStyleToolError(
          'INVALID_INPUT', 'Browser command execution options are invalid.',
        ));
      }
      const now = Date.now();
      const explicitDeadline = deadlineProperty.present ? deadlineProperty.value : undefined;
      let deadlineAt: number;
      if (explicitDeadline === undefined) {
        deadlineAt = now + localTimeoutMs;
      } else if (!Number.isSafeInteger(explicitDeadline)) {
        return Promise.reject(createStyleToolError('INVALID_INPUT', 'deadlineAt must be a safe integer.'));
      } else if ((explicitDeadline as number) <= now) {
        return Promise.reject(timeoutError());
      } else if ((explicitDeadline as number) > now + MAX_COMMAND_WINDOW_MS) {
        return Promise.reject(createStyleToolError('INVALID_INPUT', 'deadlineAt exceeds the command window.'));
      } else {
        deadlineAt = explicitDeadline as number;
      }
      const signalValue = signalProperty.present ? signalProperty.value : undefined;
      let signal: AbortSignal | undefined;
      if (signalValue !== undefined) {
        try {
          if (!(signalValue instanceof AbortSignal)) {
            return Promise.reject(createStyleToolError(
              'INVALID_INPUT', 'signal must be an AbortSignal.',
            ));
          }
          signal = signalValue;
        } catch {
          return Promise.reject(createStyleToolError(
            'INVALID_INPUT', 'signal must be an AbortSignal.',
          ));
        }
      }
      const commandDeadline = createCommandDeadline(deadlineAt, signal);
      const executionState: CommandExecutionState = { nonAbortableMapWorkStarted: false };
      let resolve!: (value: BrowserRuntimeResult<C>) => void;
      let reject!: (reason: unknown) => void;
      let callerSettled = false;
      const result = new Promise<BrowserRuntimeResult<C>>((resolveResult, rejectResult) => {
        resolve = (value) => {
          if (callerSettled) return;
          callerSettled = true;
          resolveResult(value);
        };
        reject = (reason) => {
          if (callerSettled) return;
          callerSettled = true;
          rejectResult(reason);
        };
      });
      const onDeadlineAbort = (): void => {
        if (!executionState.nonAbortableMapWorkStarted) reject(timeoutError());
      };
      commandDeadline.deadline.signal?.addEventListener('abort', onDeadlineAbort, { once: true });
      if (commandDeadline.deadline.signal?.aborted === true) onDeadlineAbort();
      tail = tail.then(async () => {
        try {
          const executed = await executeQueued(
            parsed.data,
            commandDeadline.deadline,
            executionState,
          ) as BrowserRuntimeResult<C>;
          if (!executionState.nonAbortableMapWorkStarted
            && deadlineExpired(commandDeadline.deadline)) {
            throw timeoutError();
          }
          resolve(executed);
        } catch (error) {
          reject(publicFailure('Browser map command failed.', error));
        } finally {
          commandDeadline.deadline.signal?.removeEventListener('abort', onDeadlineAbort);
          commandDeadline.cleanup();
        }
      });
      return result;
    },
  };
  return runtime;
}
