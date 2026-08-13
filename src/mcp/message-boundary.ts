import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import {
  createStyleToolError,
  isStyleToolError,
} from '../core/errors.js';
import type { StyleToolError } from '../core/types.js';
import {
  MAX_CONFIGURABLE_MCP_MESSAGE_BYTES,
  MAX_MCP_MESSAGE_BYTES,
  MAX_MCP_METHOD_BYTES,
  MAX_MCP_REQUEST_ID_BYTES,
  MAX_MCP_RESOURCE_URI_BYTES,
  MCP_RESPONSE_ENVELOPE_RESERVE_BYTES,
  MIN_MCP_MESSAGE_BYTES,
  type McpMessagePolicy,
  type McpTextToolResult,
  type McpToolMeta,
  type ResourceUriAdmission,
} from './types.js';
import {
  parseStyleToolErrorShape,
  toolFailure,
  toolSuccess,
} from './output.js';

type McpTransport = Parameters<McpServer['connect']>[0];
type McpTransportMessage = Parameters<McpTransport['send']>[0];
type McpTransportSendOptions = Parameters<McpTransport['send']>[1];
type McpMessageExtra = Parameters<NonNullable<McpTransport['onmessage']>>[1];

const utf8JsonBytes = (value: unknown): number => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Value is not JSON serializable.');
  return Buffer.byteLength(serialized, 'utf8');
};

const invalidInput = (reason: string, message: string): StyleToolError =>
  createStyleToolError('INVALID_INPUT', message, undefined, { reason });

const responseTooLarge = (): StyleToolError => invalidInput(
  'responseTooLarge',
  'The MCP response exceeds the configured message limit.',
);

function assertSafeMessageLimit(value: unknown): asserts value is number {
  if (typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < MIN_MCP_MESSAGE_BYTES
    || value > MAX_CONFIGURABLE_MCP_MESSAGE_BYTES) {
    throw invalidInput('invalidMessageLimit', 'maxMessageBytes is outside the supported range.');
  }
}

export const resolveMcpMessagePolicy = (
  options: { maxMessageBytes?: number } = {},
): McpMessagePolicy => {
  const maxMessageBytes = options.maxMessageBytes ?? MAX_MCP_MESSAGE_BYTES;
  assertSafeMessageLimit(maxMessageBytes);
  return Object.freeze({
    maxMessageBytes,
    applicationResultBytes: maxMessageBytes - MCP_RESPONSE_ENVELOPE_RESERVE_BYTES,
  });
};

export interface McpResponseBoundary {
  readonly policy: McpMessagePolicy;
  requireToolSuccess<T>(data: T, meta?: McpToolMeta): McpTextToolResult<T>;
  requireToolFailure(error: StyleToolError): McpTextToolResult<never>;
  requireResourceResult<T>(result: T): T;
  requireResourceFailure(error: StyleToolError): McpError;
}

const resourceFailure = (error: StyleToolError): McpError => {
  const sanitized = parseStyleToolErrorShape(error);
  return new McpError(ErrorCode.InvalidParams, sanitized.message, sanitized);
};

export const createMcpResponseBoundary = (
  policy: McpMessagePolicy,
): McpResponseBoundary => {
  const replacementError = responseTooLarge();
  const replacementTool = toolFailure(replacementError);
  const replacementResource = resourceFailure(replacementError);
  if (utf8JsonBytes(replacementTool) > policy.applicationResultBytes
    || utf8JsonBytes({
      code: replacementResource.code,
      message: replacementResource.message,
      data: replacementResource.data,
    }) > policy.applicationResultBytes) {
    throw invalidInput('invalidMessageLimit', 'The message limit cannot fit fixed MCP errors.');
  }

  const requireToolSuccess = <T>(data: T, meta?: McpToolMeta): McpTextToolResult<T> => {
    const result = toolSuccess(data, meta);
    if (utf8JsonBytes(result) > policy.applicationResultBytes) throw responseTooLarge();
    return result;
  };

  const requireToolFailure = (error: StyleToolError): McpTextToolResult<never> => {
    const result = toolFailure(error);
    return utf8JsonBytes(result) <= policy.applicationResultBytes
      ? result
      : replacementTool;
  };

  const requireResourceResult = <T>(result: T): T => {
    if (utf8JsonBytes(result) > policy.applicationResultBytes) throw responseTooLarge();
    return result;
  };

  const requireResourceFailure = (error: StyleToolError): McpError => {
    const result = resourceFailure(error);
    return utf8JsonBytes({ code: result.code, message: result.message, data: result.data })
      <= policy.applicationResultBytes
      ? result
      : replacementResource;
  };

  return Object.freeze({
    policy,
    requireToolSuccess,
    requireToolFailure,
    requireResourceResult,
    requireResourceFailure,
  });
};

export interface FrozenResourceUriAdmissions {
  readonly namespaces: readonly (readonly [scheme: string, authority: string])[];
  assertCanonical(rawUri: string): void;
}

export interface ResourceUriAdmissionRegistry {
  register(admission: ResourceUriAdmission): void;
  freeze(): FrozenResourceUriAdmissions;
  abort(): void;
}

const schemePattern = /^[a-z][a-z0-9+.-]*$/u;
const authorityPattern = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u;

const assertAdmissionNamespace = (admission: ResourceUriAdmission): void => {
  if (!schemePattern.test(admission.scheme) || !authorityPattern.test(admission.authority)
    || typeof admission.assertCanonical !== 'function') {
    throw invalidInput('invalidResourceAdmission', 'Resource URI admission is invalid.');
  }
};

const parseRawNamespace = (rawUri: string): readonly [string, string] => {
  if (typeof rawUri !== 'string') {
    throw invalidInput('nonCanonicalResourceUri', 'Resource URI is not canonical.');
  }
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)(?:\/|$)/u.exec(rawUri);
  if (match === null || !match[1] || !match[2] || !authorityPattern.test(match[2])) {
    throw invalidInput('nonCanonicalResourceUri', 'Resource URI is not canonical.');
  }
  return [match[1], match[2]];
};

export const createResourceUriAdmissionRegistry = (): ResourceUriAdmissionRegistry => {
  const entries = new Map<string, ResourceUriAdmission>();
  let state: 'registering' | 'frozen' | 'aborted' = 'registering';
  let frozen: FrozenResourceUriAdmissions | undefined;

  const register = (admission: ResourceUriAdmission): void => {
    if (state !== 'registering') {
      throw invalidInput('resourceAdmissionsFrozen', 'Resource URI admissions are frozen.');
    }
    assertAdmissionNamespace(admission);
    const key = `${admission.scheme}\u0000${admission.authority}`;
    if (entries.has(key)) {
      throw invalidInput(
        'duplicateResourceNamespace',
        'A resource URI admission already owns this namespace.',
      );
    }
    entries.set(key, Object.freeze({
      scheme: admission.scheme,
      authority: admission.authority,
      assertCanonical: admission.assertCanonical,
    }));
  };

  const freeze = (): FrozenResourceUriAdmissions => {
    if (state === 'aborted') {
      throw invalidInput('resourceAdmissionsFrozen', 'Resource URI admissions are frozen.');
    }
    if (frozen !== undefined) return frozen;
    state = 'frozen';
    const namespaces = Object.freeze([...entries.values()].map((entry) =>
      Object.freeze([entry.scheme, entry.authority] as const)));
    frozen = Object.freeze({
      namespaces,
      assertCanonical(rawUri: string): void {
        const [scheme, authority] = parseRawNamespace(rawUri);
        const admission = entries.get(`${scheme}\u0000${authority}`);
        if (admission === undefined) {
          throw invalidInput(
            'unregisteredResourceNamespace',
            'Resource URI namespace is not registered.',
          );
        }
        admission.assertCanonical(rawUri);
      },
    });
    return frozen;
  };

  const abort = (): void => {
    state = 'aborted';
    entries.clear();
  };

  return { register, freeze, abort };
};

export interface InboundMcpFramingContext {
  readonly totalBytesAlreadyBounded: boolean;
  readonly admissions?: FrozenResourceUriAdmissions;
}

export const createInboundMcpFramingContext = (
  options: {
    totalBytesAlreadyBounded?: boolean;
    admissions?: FrozenResourceUriAdmissions;
  } = {},
): InboundMcpFramingContext => Object.freeze({
  totalBytesAlreadyBounded: options.totalBytesAlreadyBounded ?? false,
  ...(options.admissions === undefined ? {} : { admissions: options.admissions }),
});

const ownDataValue = (value: object, key: string): unknown => {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    throw invalidInput('invalidMcpMessage', 'MCP message fields are not readable.');
  }
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw invalidInput('invalidMcpMessage', 'MCP message fields must be data properties.');
  }
  return descriptor.value;
};

const assertNoRawDotSegments = (rawUri: string): void => {
  const namespace = parseRawNamespace(rawUri);
  const prefix = `${namespace[0]}://${namespace[1]}`;
  const suffix = rawUri.slice(prefix.length);
  const path = suffix.split(/[?#]/u, 1)[0] ?? '';
  for (const segment of path.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw invalidInput('nonCanonicalResourceUri', 'Resource URI is not canonical.');
    }
    if (decoded === '.' || decoded === '..') {
      throw invalidInput('nonCanonicalResourceUri', 'Resource URI is not canonical.');
    }
  }
};

const assertSingleInboundMcpFraming = (
  value: unknown,
  policy: McpMessagePolicy,
  context: InboundMcpFramingContext | undefined,
): void => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const id = ownDataValue(value, 'id');
  if (id !== undefined && utf8JsonBytes(id) > MAX_MCP_REQUEST_ID_BYTES) {
    throw invalidInput('requestIdTooLarge', 'MCP request ID exceeds its byte limit.');
  }
  const method = ownDataValue(value, 'method');
  if (typeof method === 'string' && Buffer.byteLength(method, 'utf8') > MAX_MCP_METHOD_BYTES) {
    throw invalidInput('methodTooLarge', 'MCP method exceeds its byte limit.');
  }
  if (method !== 'resources/read') return;
  const params = ownDataValue(value, 'params');
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return;
  const uri = ownDataValue(params, 'uri');
  if (typeof uri !== 'string') return;
  if (Buffer.byteLength(uri, 'utf8') > MAX_MCP_RESOURCE_URI_BYTES) {
    throw invalidInput('resourceUriTooLarge', 'MCP resource URI exceeds its byte limit.');
  }
  assertNoRawDotSegments(uri);
  context?.admissions?.assertCanonical(uri);
};

const isAdmissionFailure = (error: unknown): error is StyleToolError =>
  isStyleToolError(error)
  && (error.details?.reason === 'nonCanonicalResourceUri'
    || error.details?.reason === 'unregisteredResourceNamespace');

const inspectSingleInboundMcpFraming = (
  value: unknown,
  policy: McpMessagePolicy,
  context: InboundMcpFramingContext | undefined,
): StyleToolError | undefined => {
  try {
    assertSingleInboundMcpFraming(value, policy, context);
    return undefined;
  } catch (error: unknown) {
    if (isAdmissionFailure(error)) return error;
    throw error;
  }
};

export const assertInboundMcpFraming = (
  value: unknown,
  policy: McpMessagePolicy,
  context?: InboundMcpFramingContext,
): void => {
  assertInboundMessageSize(value, policy, context);
  if (Array.isArray(value)) {
    for (const member of value) {
      inspectSingleInboundMcpFraming(member, policy, context);
    }
    return;
  }
  assertSingleInboundMcpFraming(value, policy, context);
};

const assertInboundMessageSize = (
  value: unknown,
  policy: McpMessagePolicy,
  context: InboundMcpFramingContext | undefined,
): void => {
  if (context?.totalBytesAlreadyBounded !== true
    && utf8JsonBytes(value) > policy.maxMessageBytes) {
    throw invalidInput('messageTooLarge', 'MCP message exceeds the configured byte limit.');
  }
};

const safeRequestId = (value: unknown): string | number | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  let id: unknown;
  try {
    id = ownDataValue(value, 'id');
  } catch {
    return undefined;
  }
  if ((typeof id !== 'string' && typeof id !== 'number')
    || !Number.isFinite(typeof id === 'number' ? id : 0)) return undefined;
  try {
    return utf8JsonBytes(id) <= MAX_MCP_REQUEST_ID_BYTES ? id : undefined;
  } catch {
    return undefined;
  }
};

const inboundAdmissionError = (
  id: string | number,
  error: StyleToolError,
): McpTransportMessage => ({
  jsonrpc: '2.0',
  id,
  error: {
    code: ErrorCode.InvalidParams,
    message: 'Resource URI is not accepted.',
    data: {
      code: 'INVALID_INPUT',
      details: { reason: error.details?.reason ?? 'nonCanonicalResourceUri' },
    },
  },
});

const oversizedResponseError = (id: string | number): McpTransportMessage => ({
  jsonrpc: '2.0',
  id,
  error: {
    code: ErrorCode.InternalError,
    message: 'MCP response exceeds the configured message limit.',
    data: { code: 'INVALID_INPUT', details: { reason: 'responseTooLarge' } },
  },
});

type CallbackKey = 'onmessage' | 'onerror' | 'onclose';

const captureOwnDescriptor = (
  raw: McpTransport,
  key: CallbackKey,
): PropertyDescriptor | undefined => {
  try {
    return Object.getOwnPropertyDescriptor(raw, key);
  } catch {
    throw invalidInput('invalidMcpTransport', 'MCP transport callbacks are not inspectable.');
  }
};

const capturedCallback = <Callback>(
  descriptor: PropertyDescriptor | undefined,
): Callback | undefined => descriptor !== undefined
  && 'value' in descriptor
  && typeof descriptor.value === 'function'
  ? descriptor.value as Callback
  : undefined;

export const createBoundedMcpTransport = (
  raw: McpTransport,
  policy: McpMessagePolicy,
  inboundContext: InboundMcpFramingContext,
  onTerminal: (error: unknown) => void | Promise<void>,
): McpTransport => {
  const priorMessageDescriptor = captureOwnDescriptor(raw, 'onmessage');
  const priorErrorDescriptor = captureOwnDescriptor(raw, 'onerror');
  const priorCloseDescriptor = captureOwnDescriptor(raw, 'onclose');
  const priorOnError = capturedCallback<NonNullable<McpTransport['onerror']>>(
    priorErrorDescriptor,
  );
  const priorOnClose = capturedCallback<NonNullable<McpTransport['onclose']>>(
    priorCloseDescriptor,
  );

  let publicOnMessage: McpTransport['onmessage'];
  let publicOnError: McpTransport['onerror'];
  let publicOnClose: McpTransport['onclose'];
  let startPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let terminalPromise: Promise<void> | undefined;
  let rawClosed = false;
  let closeNotified = false;
  let callbacksRestored = false;

  const restoreOne = (key: CallbackKey, descriptor: PropertyDescriptor | undefined): void => {
    if (descriptor === undefined) Reflect.deleteProperty(raw, key);
    else Object.defineProperty(raw, key, descriptor);
  };

  const restoreCallbacks = (): void => {
    if (callbacksRestored) return;
    callbacksRestored = true;
    restoreOne('onmessage', priorMessageDescriptor);
    restoreOne('onerror', priorErrorDescriptor);
    restoreOne('onclose', priorCloseDescriptor);
  };

  const notifyClose = (): void => {
    if (closeNotified) return;
    closeNotified = true;
    priorOnClose?.();
    publicOnClose?.();
  };

  const close = (): Promise<void> => {
    if (closePromise !== undefined) return closePromise;
    let resolveClose!: () => void;
    let rejectClose!: (error: unknown) => void;
    closePromise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    void (async () => {
      try {
        if (!rawClosed) {
          rawClosed = true;
          await raw.close();
        }
      } finally {
        notifyClose();
        restoreCallbacks();
      }
    })().then(resolveClose, rejectClose);
    return closePromise;
  };

  const signalTerminal = (error: unknown): Promise<void> => {
    if (terminalPromise !== undefined) return terminalPromise;
    let resolveTerminal!: () => void;
    terminalPromise = new Promise<void>((resolve) => {
      resolveTerminal = resolve;
    });
    void (async () => {
      try {
        await onTerminal(error);
      } catch {
        // Terminal cleanup failure is deliberately consumed by the shared latch.
      } finally {
        try {
          await close();
        } catch {
          // The triggering failure remains authoritative.
        }
      }
    })().then(resolveTerminal, resolveTerminal);
    return terminalPromise;
  };

  const rawSend = async (
    message: McpTransportMessage,
    options?: McpTransportSendOptions,
  ): Promise<void> => {
    try {
      await raw.send(message, options);
    } catch (error: unknown) {
      await signalTerminal(error);
      throw error;
    }
  };

  const send = async (
    message: McpTransportMessage,
    options?: McpTransportSendOptions,
  ): Promise<void> => {
    let bytes: number;
    try {
      bytes = utf8JsonBytes(message);
    } catch (error: unknown) {
      await signalTerminal(error);
      throw error;
    }
    if (bytes <= policy.maxMessageBytes) {
      await rawSend(message, options);
      return;
    }
    const id = safeRequestId(message);
    const isResponse = typeof message === 'object' && message !== null
      && !Array.isArray(message)
      && !('method' in message)
      && ('result' in message || 'error' in message);
    if (id === undefined || !isResponse) {
      const error = responseTooLarge();
      await signalTerminal(error);
      throw error;
    }
    const fallback = oversizedResponseError(id);
    if (utf8JsonBytes(fallback) > policy.maxMessageBytes) {
      const error = responseTooLarge();
      await signalTerminal(error);
      throw error;
    }
    await rawSend(fallback, options);
  };

  const installedOnMessage: NonNullable<McpTransport['onmessage']> = (
    message,
    extra?: McpMessageExtra,
  ): void => {
    const dispatchCheckedMember = (
      member: unknown,
      admissionFailure: StyleToolError | undefined,
    ): void => {
      try {
        if (admissionFailure !== undefined) throw admissionFailure;
        publicOnMessage?.(member as McpTransportMessage, extra);
      } catch (error: unknown) {
        if (isAdmissionFailure(error)) {
          const id = safeRequestId(member);
          if (id === undefined) return;
          const fallback = inboundAdmissionError(id, error);
          if (utf8JsonBytes(fallback) <= policy.maxMessageBytes) {
            void rawSend(fallback).catch(() => undefined);
            return;
          }
        }
        void signalTerminal(error);
      }
    };
    try {
      assertInboundMessageSize(message, policy, inboundContext);
      const inbound: unknown = message;
      if (Array.isArray(inbound)) {
        const admissionFailures = inbound.map((member) =>
          inspectSingleInboundMcpFraming(member, policy, inboundContext));
        for (const [index, member] of inbound.entries()) {
          dispatchCheckedMember(member, admissionFailures[index]);
        }
      } else {
        dispatchCheckedMember(
          inbound,
          inspectSingleInboundMcpFraming(inbound, policy, inboundContext),
        );
      }
    } catch (error: unknown) {
      void signalTerminal(error);
    }
  };

  const installedOnError: NonNullable<McpTransport['onerror']> = (error): void => {
    priorOnError?.(error);
    publicOnError?.(error);
  };

  const installedOnClose: NonNullable<McpTransport['onclose']> = (): void => {
    rawClosed = true;
    notifyClose();
    void signalTerminal(
      createStyleToolError('INTERNAL', 'The MCP transport closed.'),
    );
  };

  Object.defineProperty(raw, 'onmessage', {
    configurable: true, enumerable: priorMessageDescriptor?.enumerable ?? true,
    writable: true, value: installedOnMessage,
  });
  Object.defineProperty(raw, 'onerror', {
    configurable: true, enumerable: priorErrorDescriptor?.enumerable ?? true,
    writable: true, value: installedOnError,
  });
  Object.defineProperty(raw, 'onclose', {
    configurable: true, enumerable: priorCloseDescriptor?.enumerable ?? true,
    writable: true, value: installedOnClose,
  });

  const bounded: McpTransport = {
    start(): Promise<void> {
      startPromise ??= raw.start();
      return startPromise;
    },
    send,
    close,
    get sessionId(): string | undefined {
      return raw.sessionId;
    },
    get onmessage(): McpTransport['onmessage'] {
      return publicOnMessage;
    },
    set onmessage(value: McpTransport['onmessage']) {
      publicOnMessage = value;
    },
    get onerror(): McpTransport['onerror'] {
      return publicOnError;
    },
    set onerror(value: McpTransport['onerror']) {
      publicOnError = value;
    },
    get onclose(): McpTransport['onclose'] {
      return publicOnClose;
    },
    set onclose(value: McpTransport['onclose']) {
      publicOnClose = value;
    },
  };
  if (typeof raw.setProtocolVersion === 'function') {
    bounded.setProtocolVersion = (version: string): void => raw.setProtocolVersion?.(version);
  }
  return bounded;
};
