/// <reference types="node" preserve="true" />

import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import { isIP } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { createStyleToolError } from '../core/errors.js';
import {
  createMapLibreStyleMcpServerWithDependencies,
  defaultServerCompositionDependencies,
  preflightCreatedMcpInbound,
  type CreateMapLibreStyleMcpServerOptions,
  type CreatedMapLibreStyleMcpServer,
} from './create-server.js';
import {
  assertInboundMcpFraming,
  createInboundMcpFramingContext,
  resolveMcpMessagePolicy,
} from './message-boundary.js';
import {
  createStyleSessionStore,
  type StyleSessionStore,
} from './session-store.js';
import type { McpServerExtension } from './server-extension.js';
import type {
  McpMessagePolicy,
  StyleSessionStoreOptions,
} from './types.js';

export const MAX_HTTP_BEARER_TOKEN_BYTES = 4096;

type Transport = Parameters<McpServer['connect']>[0];

const defaultHost = '127.0.0.1';
const defaultPort = 0;
const endpointPath = '/mcp';

const startupError = (reason: string, message: string) => createStyleToolError(
  'INVALID_INPUT', message, undefined, { reason },
);

class HttpRequestFailure extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpRequestFailure';
    this.status = status;
  }
}

const requestFailure = (status: number, message: string): HttpRequestFailure =>
  new HttpRequestFailure(status, message);

export interface StartStreamableHttpMcpOptions {
  readonly bearerToken: string;
  readonly host?: string;
  readonly port?: number;
  readonly allowNonLoopback?: boolean;
  readonly allowedOrigins?: readonly string[];
  readonly maxMessageBytes?: number;
  readonly extensions?: readonly McpServerExtension[];
  readonly storeOptions?: StyleSessionStoreOptions;
}

export interface StartedHttpMcp {
  readonly url: string;
  readonly messagePolicy: McpMessagePolicy;
  readonly store: StyleSessionStore;
  close(): Promise<void>;
}

type RawHttpTransportOptions = NonNullable<
  ConstructorParameters<typeof StreamableHTTPServerTransport>[0]
>;

export interface HttpMcpDependencies {
  readonly resolveMessagePolicy: typeof resolveMcpMessagePolicy;
  readonly storeFactory: typeof createStyleSessionStore;
  readonly listenerFactory: (handler: RequestListener) => Server;
  readonly serverFactory: (
    options: CreateMapLibreStyleMcpServerOptions,
    policy: McpMessagePolicy,
  ) => CreatedMapLibreStyleMcpServer;
  readonly rawTransportFactory: (
    options: RawHttpTransportOptions,
  ) => StreamableHTTPServerTransport;
  readonly sessionIdFactory: () => string;
}

export const defaultHttpMcpDependencies: HttpMcpDependencies = Object.freeze({
  resolveMessagePolicy: resolveMcpMessagePolicy,
  storeFactory: createStyleSessionStore,
  listenerFactory: (handler: RequestListener) => createServer(handler),
  serverFactory: (
    options: CreateMapLibreStyleMcpServerOptions,
    policy: McpMessagePolicy,
  ) => createMapLibreStyleMcpServerWithDependencies(
    options,
    defaultServerCompositionDependencies,
    policy,
    'transport-prebounded',
  ),
  rawTransportFactory: (options: RawHttpTransportOptions) =>
    new StreamableHTTPServerTransport(options),
  sessionIdFactory: randomUUID,
});

interface ResolvedStartupOptions {
  readonly bearerToken: Buffer;
  readonly host: string;
  readonly port: number;
  readonly allowNonLoopback: boolean;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly maxMessageBytes: number | undefined;
  readonly extensions: readonly McpServerExtension[] | undefined;
  readonly storeOptions: StyleSessionStoreOptions | undefined;
}

const containsAsciiWhitespaceOrControl = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
};

const assertBearerToken = (value: unknown): Buffer => {
  if (typeof value !== 'string'
    || value.length === 0
    || containsAsciiWhitespaceOrControl(value)) {
    throw startupError('invalidBearerToken', 'HTTP bearer token is invalid.');
  }
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length === 0 || bytes.length > MAX_HTTP_BEARER_TOKEN_BYTES) {
    throw startupError('invalidBearerToken', 'HTTP bearer token is invalid.');
  }
  return bytes;
};

const isLoopbackHost = (host: string): boolean => {
  const addressKind = isIP(host);
  if (addressKind === 4) return host.startsWith('127.');
  if (addressKind === 6) return host === '::1';
  const lowered = host.toLowerCase();
  return lowered === 'localhost' || lowered.endsWith('.localhost');
};

const assertHost = (value: unknown, allowNonLoopback: boolean): string => {
  if (typeof value !== 'string'
    || value.length === 0
    || containsAsciiWhitespaceOrControl(value)
    || value.includes('/')
    || value.includes('@')
    || value.includes('[')
    || value.includes(']')) {
    throw startupError('invalidHttpHost', 'HTTP bind host is invalid.');
  }
  if (!allowNonLoopback && !isLoopbackHost(value)) {
    throw startupError(
      'nonLoopbackNotAllowed',
      'Non-loopback HTTP binding requires explicit opt-in.',
    );
  }
  return value;
};

const assertPort = (value: unknown): number => {
  if (typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
    || value > 65_535) {
    throw startupError('invalidHttpPort', 'HTTP bind port is invalid.');
  }
  return value;
};

const assertAllowedOrigins = (value: unknown): ReadonlySet<string> => {
  if (value === undefined) return new Set<string>();
  if (!Array.isArray(value)) {
    throw startupError('invalidAllowedOrigin', 'HTTP allowed origin is invalid.');
  }
  const origins = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string'
      || candidate === 'null'
      || candidate.includes('*')
      || containsAsciiWhitespaceOrControl(candidate)) {
      throw startupError('invalidAllowedOrigin', 'HTTP allowed origin is invalid.');
    }
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw startupError('invalidAllowedOrigin', 'HTTP allowed origin is invalid.');
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.username !== ''
      || parsed.password !== ''
      || parsed.pathname !== '/'
      || parsed.search !== ''
      || parsed.hash !== ''
      || parsed.origin !== candidate) {
      throw startupError('invalidAllowedOrigin', 'HTTP allowed origin is invalid.');
    }
    origins.add(candidate);
  }
  return origins;
};

const resolveStartupOptions = (
  options: StartStreamableHttpMcpOptions,
): ResolvedStartupOptions => {
  const bearerToken = assertBearerToken(options.bearerToken);
  if (options.allowNonLoopback !== undefined
    && typeof options.allowNonLoopback !== 'boolean') {
    throw startupError('invalidNonLoopbackOption', 'HTTP non-loopback option is invalid.');
  }
  const allowNonLoopback = options.allowNonLoopback ?? false;
  const host = assertHost(options.host ?? defaultHost, allowNonLoopback);
  const port = assertPort(options.port ?? defaultPort);
  const allowedOrigins = assertAllowedOrigins(options.allowedOrigins);
  return Object.freeze({
    bearerToken,
    host,
    port,
    allowNonLoopback,
    allowedOrigins,
    maxMessageBytes: options.maxMessageBytes,
    extensions: options.extensions,
    storeOptions: options.storeOptions,
  });
};

const timingSafeBearerEquals = (
  authorization: string | undefined,
  expected: Buffer,
): boolean => {
  if (authorization === undefined || !authorization.startsWith('Bearer ')) return false;
  const suppliedText = authorization.slice('Bearer '.length);
  if (suppliedText.length === 0 || containsAsciiWhitespaceOrControl(suppliedText)) return false;
  const supplied = Buffer.from(suppliedText, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};

const singleHeader = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' && !value.includes(',') ? value : undefined;

const assertRequestAllowed = (
  request: IncomingMessage,
  options: ResolvedStartupOptions,
  authority: string,
  boundOrigin: string,
): void => {
  if (!timingSafeBearerEquals(request.headers.authorization, options.bearerToken)) {
    throw requestFailure(401, 'Unauthorized');
  }
  if (singleHeader(request.headers.host) !== authority) {
    throw requestFailure(421, 'Misdirected Request');
  }
  const origin = singleHeader(request.headers.origin);
  if (request.headers.origin !== undefined
    && (origin === undefined
      || (origin !== boundOrigin && !options.allowedOrigins.has(origin)))) {
    throw requestFailure(403, 'Forbidden');
  }
};

const parseDeclaredLength = (request: IncomingMessage): number | undefined => {
  const value = singleHeader(request.headers['content-length']);
  if (value === undefined) {
    if (request.headers['content-length'] !== undefined) {
      throw requestFailure(400, 'Bad Request');
    }
    return undefined;
  }
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw requestFailure(400, 'Bad Request');
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw requestFailure(413, 'Payload Too Large');
  return length;
};

export const readBoundedJsonBody = async (
  request: IncomingMessage,
  policy: McpMessagePolicy,
): Promise<unknown> => {
  const declared = parseDeclaredLength(request);
  if (declared !== undefined && declared > policy.maxMessageBytes) {
    request.pause();
    throw requestFailure(413, 'Payload Too Large');
  }

  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;

    const cleanup = (): void => {
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('aborted', onAborted);
      request.removeListener('error', onError);
    };
    const fail = (failure: unknown, pause = false): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (pause) request.pause();
      reject(failure);
    };
    const onData = (chunk: Buffer | Uint8Array | string): void => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > policy.maxMessageBytes) {
        fail(requestFailure(413, 'Payload Too Large'), true);
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = (): void => {
      if (settled) return;
      if (declared !== undefined && bytes !== declared) {
        fail(requestFailure(400, 'Bad Request'));
        return;
      }
      settled = true;
      cleanup();
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        resolve(JSON.parse(text) as unknown);
      } catch {
        reject(requestFailure(400, 'Bad Request'));
      }
    };
    const onAborted = (): void => fail(requestFailure(400, 'Bad Request'));
    const onError = (): void => fail(requestFailure(400, 'Bad Request'));

    request.on('data', onData);
    request.once('end', onEnd);
    request.once('aborted', onAborted);
    request.once('error', onError);
  });
};

const httpErrorBody = (message: string): string => JSON.stringify({
  jsonrpc: '2.0',
  error: { code: -32_000, message },
  id: null,
});

const sendFixedHttpFailure = (
  response: ServerResponse,
  status: number,
  message: string,
): void => {
  if (response.headersSent || response.writableEnded || response.destroyed) {
    response.destroy();
    return;
  }
  const body = httpErrorBody(message);
  response.writeHead(status, {
    'cache-control': 'no-store',
    connection: 'close',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
};

const listen = async (server: Server, port: number, host: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

const closeListener = async (server: Server): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });

type PairState = 'provisional' | 'transferred' | 'closed';

interface HttpTransportPair {
  readonly created: CreatedMapLibreStyleMcpServer;
  readonly rawTransport: StreamableHTTPServerTransport;
  state: PairState;
  sessionId: string | undefined;
  closePromise: Promise<void> | undefined;
}

const createHttpTransportBridge = (
  raw: StreamableHTTPServerTransport,
): Transport => {
  const priorMessage = raw.onmessage;
  const priorError = raw.onerror;
  const priorClose = raw.onclose;
  let callbacksRestored = false;
  let closePromise: Promise<void> | undefined;
  const restoreCallbacks = (): void => {
    if (callbacksRestored) return;
    callbacksRestored = true;
    raw.onmessage = priorMessage;
    raw.onerror = priorError;
    raw.onclose = priorClose;
  };
  const bridge: Transport = {
    start: () => raw.start(),
    send: (message, options) => raw.send(message, options),
    close: () => {
      closePromise ??= Promise.resolve().then(() => raw.close()).finally(restoreCallbacks);
      return closePromise;
    },
    onmessage: undefined,
    onerror: undefined,
    onclose: undefined,
    get sessionId(): string | undefined { return raw.sessionId; },
  };
  try {
    raw.onmessage = (message, extra): void => { bridge.onmessage?.(message, extra); };
    raw.onerror = (error): void => { bridge.onerror?.(error); };
    raw.onclose = (): void => {
      try {
        bridge.onclose?.();
      } finally {
        restoreCallbacks();
      }
    };
  } catch (error: unknown) {
    restoreCallbacks();
    throw error;
  }
  return bridge;
};

const requireAddressInfo = (server: Server): AddressInfo => {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new TypeError('HTTP listener did not expose an IP address.');
  }
  return address;
};

const addressAuthority = (address: AddressInfo): string => {
  const host = address.family === 'IPv6' || address.address.includes(':')
    ? `[${address.address}]`
    : address.address;
  return `${host}:${address.port}`;
};

export const startStreamableHttpMcpWithDependencies = async (
  options: StartStreamableHttpMcpOptions,
  dependencies: HttpMcpDependencies,
): Promise<StartedHttpMcp> => {
  const resolved = resolveStartupOptions(options);
  const messagePolicy = dependencies.resolveMessagePolicy({
    maxMessageBytes: resolved.maxMessageBytes,
  });
  const store = dependencies.storeFactory(resolved.storeOptions);
  const pairs = new Set<HttpTransportPair>();
  const sessions = new Map<string, HttpTransportPair>();
  let closing = false;
  let closePromise: Promise<void> | undefined;
  let listener: Server | undefined;
  let authority = '';
  let boundOrigin = '';

  const closePair = (pair: HttpTransportPair): Promise<void> => {
    if (pair.closePromise !== undefined) return pair.closePromise;
    const priorState = pair.state;
    pair.state = 'closed';
    pairs.delete(pair);
    if (pair.sessionId !== undefined && sessions.get(pair.sessionId) === pair) {
      sessions.delete(pair.sessionId);
    }
    pair.closePromise = (async () => {
      if (priorState === 'provisional') {
        let primary: unknown;
        try {
          await pair.rawTransport.close();
        } catch (error: unknown) {
          primary = error;
        }
        try {
          await pair.created.close();
        } catch (error: unknown) {
          if (primary === undefined) primary = error;
        }
        if (primary !== undefined) throw primary;
        return;
      }
      await pair.created.close();
    })();
    return pair.closePromise;
  };

  const makePair = async (): Promise<HttpTransportPair> => {
    const created = dependencies.serverFactory({
      store,
      ...(resolved.extensions === undefined ? {} : { extensions: resolved.extensions }),
    }, messagePolicy);
    let pair!: HttpTransportPair;
    try {
      const rawTransport = dependencies.rawTransportFactory({
        sessionIdGenerator: dependencies.sessionIdFactory,
        onsessioninitialized: (sessionId): void => {
          if (closing || pair.state === 'closed' || sessions.has(sessionId)) {
            throw new Error('HTTP MCP session could not be registered.');
          }
          pair.sessionId = sessionId;
          sessions.set(sessionId, pair);
        },
        onsessionclosed: (sessionId): void => {
          if (sessions.get(sessionId) === pair) sessions.delete(sessionId);
          void closePair(pair).catch(() => undefined);
        },
        enableJsonResponse: false,
        eventStore: undefined,
      });
      pair = {
        created,
        rawTransport,
        state: 'provisional',
        sessionId: undefined,
        closePromise: undefined,
      };
      pairs.add(pair);
      const connectedTransport = createHttpTransportBridge(rawTransport);
      pair.state = 'transferred';
      await created.connect(connectedTransport, () => closePair(pair));
      created.server.server.onclose = () => {
        pairs.delete(pair);
        if (pair.sessionId !== undefined && sessions.get(pair.sessionId) === pair) {
          sessions.delete(pair.sessionId);
        }
      };
      return pair;
    } catch (error: unknown) {
      if (pair !== undefined) await closePair(pair).catch(() => undefined);
      else await created.close().catch(() => undefined);
      throw error;
    }
  };

  const dispatch = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    if (closing) throw requestFailure(503, 'Service Unavailable');
    if (request.url !== endpointPath) throw requestFailure(404, 'Not Found');
    assertRequestAllowed(request, resolved, authority, boundOrigin);

    const sessionId = singleHeader(request.headers['mcp-session-id']);
    if (request.headers['mcp-session-id'] !== undefined && sessionId === undefined) {
      throw requestFailure(400, 'Bad Request');
    }

    if (request.method === 'POST') {
      const parsedBody = await readBoundedJsonBody(request, messagePolicy);
      if (sessionId !== undefined) {
        const pair = sessions.get(sessionId);
        if (pair === undefined || pair.state !== 'transferred') {
          throw requestFailure(404, 'Not Found');
        }
        try {
          preflightCreatedMcpInbound(pair.created, parsedBody);
        } catch {
          throw requestFailure(400, 'Bad Request');
        }
        await pair.rawTransport.handleRequest(request, response, parsedBody);
        return;
      }

      try {
        assertInboundMcpFraming(
          parsedBody,
          messagePolicy,
          createInboundMcpFramingContext({ totalBytesAlreadyBounded: true }),
        );
      } catch {
        throw requestFailure(400, 'Bad Request');
      }
      if (!isInitializeRequest(parsedBody)) throw requestFailure(400, 'Bad Request');
      const pair = await makePair();
      try {
        await pair.rawTransport.handleRequest(request, response, parsedBody);
        if (pair.sessionId === undefined) await closePair(pair);
      } catch (error: unknown) {
        await closePair(pair).catch(() => undefined);
        throw error;
      }
      return;
    }

    if (request.method === 'GET' || request.method === 'DELETE') {
      if (sessionId === undefined) throw requestFailure(400, 'Bad Request');
      const pair = sessions.get(sessionId);
      if (pair === undefined || pair.state !== 'transferred') {
        throw requestFailure(404, 'Not Found');
      }
      await pair.rawTransport.handleRequest(request, response);
      return;
    }

    throw requestFailure(405, 'Method Not Allowed');
  };

  const handler: RequestListener = (request, response) => {
    void dispatch(request, response).catch((error: unknown) => {
      if (error instanceof HttpRequestFailure) {
        sendFixedHttpFailure(response, error.status, error.message);
        return;
      }
      sendFixedHttpFailure(response, 500, 'Internal Server Error');
    });
  };

  try {
    listener = dependencies.listenerFactory(handler);
    await listen(listener, resolved.port, resolved.host);
    const address = requireAddressInfo(listener);
    authority = addressAuthority(address);
    boundOrigin = `http://${authority}`;
  } catch (error: unknown) {
    try {
      if (listener?.listening === true) await closeListener(listener);
    } catch {
      // Startup's primary failure remains authoritative.
    }
    store.dispose();
    throw error;
  }

  const ownedListener = listener;
  const close = (): Promise<void> => {
    if (closePromise !== undefined) return closePromise;
    closing = true;
    closePromise = (async () => {
      let primary: unknown;
      const pairResults = await Promise.allSettled([...pairs].map(closePair));
      const rejectedPair = pairResults.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (rejectedPair !== undefined) primary = rejectedPair.reason;
      try {
        await closeListener(ownedListener);
      } catch (error: unknown) {
        if (primary === undefined) primary = error;
      } finally {
        store.dispose();
      }
      if (primary !== undefined) throw primary;
    })();
    return closePromise;
  };

  return Object.freeze({
    url: `${boundOrigin}${endpointPath}`,
    messagePolicy,
    store,
    close,
  });
};

export const startStreamableHttpMcp = (
  options: StartStreamableHttpMcpOptions,
): Promise<StartedHttpMcp> => startStreamableHttpMcpWithDependencies(
  options,
  defaultHttpMcpDependencies,
);
