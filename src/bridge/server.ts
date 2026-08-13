import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import WebSocket, { WebSocketServer } from 'ws';

import {
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
  isStyleToolError,
} from '../core/index.js';
import { decodeBridgeFrame, encodeBridgeFrame } from './codec.js';
import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeAuthFrameSchema,
  BridgeEventFrameSchema,
  BridgeLimitSetSchema,
  BridgeRegisterFrameSchema,
  BridgeResultFrameSchema,
  BridgeTokenSchema,
  MAX_BRIDGE_MESSAGE_BYTES,
  type BridgeFrame,
  type BridgeLimitSet,
  type BridgeRegisterFrame,
  type BridgeResultFrame,
} from './protocol.js';
import {
  createRegistrationLiveness,
  LiveMapRegistry,
  type BridgePeer,
} from './registry.js';

const DEFAULT_AUTH_TIMEOUT_MS = 5_000;
const DEFAULT_REGISTRATION_TIMEOUT_MS = 5_000;

export interface BridgeServerOptions {
  host?: string;
  port?: number;
  token?: string;
  allowedOrigins: readonly string[];
  authTimeoutMs?: number;
  registrationTimeoutMs?: number;
  operationTimeoutMs?: number;
  limitCeilings?: Partial<BridgeLimitSet>;
  registry?: LiveMapRegistry;
}

export interface BridgeServerHandle {
  host: string;
  port: number;
  url: string;
  generatedToken?: string;
  limitCeilings: BridgeLimitSet;
  registry: LiveMapRegistry;
  waitForInboundIdle(): Promise<void>;
  outstandingSendCount(): number;
  close(): Promise<void>;
}

type ConnectionState =
  | 'authenticating'
  | 'authenticating-ack'
  | 'authenticated'
  | 'registering'
  | 'registered'
  | 'terminal';
type OutstandingSend = {
  settle(error?: Error | null): void;
};

interface Connection {
  socket: WebSocket;
  peer: BridgePeer;
  state: ConnectionState;
  terminal: boolean;
  registered: boolean;
  generation: number;
  abortController: AbortController;
  liveness: ReturnType<typeof createRegistrationLiveness>;
  authTimer?: ReturnType<typeof setTimeout>;
  registrationTimer?: ReturnType<typeof setTimeout>;
  effectiveMaxMessageBytes: number;
  inboundTail: Promise<void>;
  outstanding: Set<OutstandingSend>;
  pendingPostAuth: BridgeRawData[];
}

type BridgeRawData = string | ArrayBuffer | ArrayBufferView;

const positiveSafeInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
};

const normalizeOrigin = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('allowed origin must be an absolute URL');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.origin === 'null'
    || url.pathname !== '/'
    || url.search !== ''
    || url.hash !== ''
    || url.username !== ''
    || url.password !== ''
    || url.hostname.includes('*')) {
    throw new TypeError('allowed origin must be one lossless HTTP(S) origin');
  }
  return url.origin;
};

const resolveLimitCeilings = (partial: Partial<BridgeLimitSet> | undefined): BridgeLimitSet =>
  Object.freeze(BridgeLimitSetSchema.parse({
    maxMessageBytes: partial?.maxMessageBytes ?? MAX_BRIDGE_MESSAGE_BYTES,
    maxStyleBytes: partial?.maxStyleBytes ?? DEFAULT_MAX_STYLE_BYTES,
    maxDiffBytes: partial?.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES,
    maxOperations: partial?.maxOperations ?? DEFAULT_MAX_OPERATIONS,
  }));

const limitsEqual = (left: BridgeLimitSet, right: BridgeLimitSet): boolean =>
  left.maxMessageBytes === right.maxMessageBytes
  && left.maxStyleBytes === right.maxStyleBytes
  && left.maxDiffBytes === right.maxDiffBytes
  && left.maxOperations === right.maxOperations;

const tokenMatches = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
};

const rawDataInput = (
  raw: WebSocket.RawData | BridgeRawData,
): BridgeRawData => Array.isArray(raw) ? Buffer.concat(raw) : raw;

const writeUpgradeRejection = (socket: Socket, statusCode: number, statusText: string): void => {
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
};

const publicRegistrationError = (
  correlationId: string,
  error: unknown,
): BridgeResultFrame => {
  const authentic = isStyleToolError(error) ? error : undefined;
  return BridgeResultFrameSchema.parse({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'result',
    correlationId,
    ok: false,
    error: {
      code: authentic?.code ?? 'INTERNAL',
      message: authentic?.code === 'CONFLICT'
        ? 'Bridge request conflict'
        : authentic?.code === 'REVISION_CONFLICT'
          ? 'Live map revision conflict'
          : authentic?.code === 'CAPABILITY_DENIED'
            ? 'Bridge capability denied'
            : authentic?.code === 'INVALID_INPUT'
              ? 'Invalid bridge input'
              : 'Bridge operation failed',
    },
  });
};

export async function createBridgeServer(
  options: BridgeServerOptions,
): Promise<BridgeServerHandle> {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('bridge server options must be an object');
  }
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError('port must be an integer from 0 through 65535');
  }
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizeOrigin));
  if (allowedOrigins.size === 0) throw new TypeError('at least one allowed origin is required');
  const authTimeoutMs = positiveSafeInteger(
    options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS,
    'authTimeoutMs',
  );
  const registrationTimeoutMs = positiveSafeInteger(
    options.registrationTimeoutMs ?? DEFAULT_REGISTRATION_TIMEOUT_MS,
    'registrationTimeoutMs',
  );
  const generated = options.token === undefined;
  const authenticationToken = options.token ?? randomBytes(32).toString('base64url');
  BridgeTokenSchema.parse(authenticationToken);
  const limitCeilings = resolveLimitCeilings(options.limitCeilings);
  const ownsRegistry = options.registry === undefined;
  const registry = options.registry ?? new LiveMapRegistry({
    limitCeilings,
    ...(options.operationTimeoutMs === undefined
      ? {}
      : { operationTimeoutMs: options.operationTimeoutMs }),
  });
  if (!limitsEqual(registry.limitCeilings, limitCeilings)) {
    throw new TypeError('injected registry limit ceilings must match the server');
  }

  const httpServer: HttpServer = createServer((_request, response) => {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: limitCeilings.maxMessageBytes,
  });
  const connections = new Set<Connection>();
  let nextConnectionId = 0;
  let generation = 0;
  let closingPromise: Promise<void> | undefined;

  const clearConnectionTimers = (connection: Connection): void => {
    if (connection.authTimer !== undefined) {
      clearTimeout(connection.authTimer);
      connection.authTimer = undefined;
    }
    if (connection.registrationTimer !== undefined) {
      clearTimeout(connection.registrationTimer);
      connection.registrationTimer = undefined;
    }
  };

  const terminal = (
    connection: Connection,
    code?: number,
    reason = 'bridge connection closed',
  ): void => {
    if (connection.terminal) return;
    connection.terminal = true;
    connection.state = 'terminal';
    connection.abortController.abort();
    clearConnectionTimers(connection);
    const error = new Error('bridge transport disconnected');
    for (const outstanding of [...connection.outstanding]) outstanding.settle(error);
    connection.outstanding.clear();
    if (connection.registered) registry.disconnect(connection.peer.id);
    connections.delete(connection);
    if (code !== undefined
      && connection.socket.readyState !== WebSocket.CLOSED
      && connection.socket.readyState !== WebSocket.CLOSING) {
      try {
        connection.socket.close(code, reason.slice(0, 123));
      } catch {
        connection.socket.terminate();
      }
    }
  };

  const sendEncoded = (connection: Connection, encoded: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (connection.terminal || connection.socket.readyState !== WebSocket.OPEN) {
        reject(new Error('bridge transport disconnected'));
        return;
      }
      let settled = false;
      const outstanding: OutstandingSend = {
        settle(error) {
          if (settled) return;
          settled = true;
          connection.outstanding.delete(outstanding);
          if (error === undefined || error === null) resolve();
          else reject(error);
        },
      };
      connection.outstanding.add(outstanding);
      try {
        connection.socket.send(encoded, (error) => outstanding.settle(error));
      } catch (error) {
        outstanding.settle(error instanceof Error ? error : new Error('bridge send failed'));
      }
    });

  const sendFrame = (connection: Connection, frame: BridgeFrame): Promise<void> => {
    const encoded = encodeBridgeFrame(frame, connection.effectiveMaxMessageBytes);
    return sendEncoded(connection, encoded);
  };

  const handleRegisteredFrame = async (
    connection: Connection,
    raw: BridgeRawData,
  ): Promise<void> => {
    const resultParsed = (() => {
      try {
        return decodeBridgeFrame(rawDataInput(raw), BridgeResultFrameSchema, connection.effectiveMaxMessageBytes);
      } catch {
        return undefined;
      }
    })();
    if (resultParsed !== undefined) {
      await registry.acceptResult(connection.peer.id, resultParsed);
      return;
    }
    const eventParsed = decodeBridgeFrame(
      rawDataInput(raw),
      BridgeEventFrameSchema,
      connection.effectiveMaxMessageBytes,
    );
    await registry.acceptEvent(connection.peer.id, eventParsed);
  };

  const handleRegistration = async (
    connection: Connection,
    raw: BridgeRawData,
  ): Promise<void> => {
    let frame: BridgeRegisterFrame;
    try {
      frame = decodeBridgeFrame(rawDataInput(raw), BridgeRegisterFrameSchema, limitCeilings.maxMessageBytes);
    } catch {
      terminal(connection, 1002, 'invalid bridge registration');
      return;
    }
    connection.state = 'registering';
    let accepted: Awaited<ReturnType<LiveMapRegistry['register']>>;
    try {
      accepted = await registry.register(connection.peer, frame, connection.liveness);
    } catch (error) {
      if (connection.terminal) return;
      const failure = publicRegistrationError(frame.correlationId, error);
      try {
        await sendFrame(connection, failure);
      } catch {
        terminal(connection);
      }
      if (!connection.terminal) connection.state = 'authenticated';
      return;
    }
    if (connection.terminal || connection.state !== 'registering') return;
    connection.registered = true;
    connection.effectiveMaxMessageBytes = accepted.metadata.limits.maxMessageBytes;
    try {
      await sendFrame(connection, {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        kind: 'result',
        correlationId: frame.correlationId,
        ok: true,
        result: {
          type: 'registered',
          leaseId: accepted.leaseId,
          limits: accepted.metadata.limits,
        },
      });
      if (connection.terminal) return;
      if (connection.registrationTimer !== undefined) {
        clearTimeout(connection.registrationTimer);
      connection.registrationTimer = undefined;
      }
      connection.state = 'registered';
    } catch {
      terminal(connection);
    }
  };

  const enqueuePostAuth = (connection: Connection, raw: BridgeRawData): void => {
    connection.inboundTail = connection.inboundTail.then(async () => {
      if (connection.terminal) return;
      if (connection.state === 'authenticated') {
        await handleRegistration(connection, raw);
        return;
      }
      if (connection.state === 'registering') {
        terminal(connection, 1008, 'registration is already in progress');
        return;
      }
      if (connection.state === 'registered') {
        await handleRegisteredFrame(connection, raw);
      }
    }).catch(() => {
      terminal(connection, 1008, 'bridge protocol violation');
    });
  };

  webSocketServer.on('connection', (socket) => {
    nextConnectionId += 1;
    generation += 1;
    const connectionId = `connection-${nextConnectionId}`;
    const abortController = new AbortController();
    const peer: BridgePeer = {
      id: connectionId,
      send(frame) {
        return sendFrame(connection, frame);
      },
      close(code, reason) {
        terminal(connection, code, reason);
      },
    };
    const ownedGeneration = generation;
    const connection: Connection = {
      socket,
      peer,
      state: 'authenticating',
      terminal: false,
      registered: false,
      generation: ownedGeneration,
      abortController,
      liveness: createRegistrationLiveness(
        abortController.signal,
        () => !connection.terminal && connection.generation === ownedGeneration,
      ),
      effectiveMaxMessageBytes: limitCeilings.maxMessageBytes,
      inboundTail: Promise.resolve(),
      outstanding: new Set(),
      pendingPostAuth: [],
    };
    connections.add(connection);
    connection.authTimer = setTimeout(() => {
      terminal(connection, 1008, 'bridge authentication timed out');
    }, authTimeoutMs);

    socket.once('close', () => terminal(connection));
    socket.once('error', () => terminal(connection));
    socket.on('message', (raw) => {
      if (connection.terminal) return;
      if (connection.state === 'authenticating-ack') {
        connection.pendingPostAuth.push(rawDataInput(raw));
        return;
      }
      if (connection.state !== 'authenticating') {
        enqueuePostAuth(connection, rawDataInput(raw));
        return;
      }
      let frame: ReturnType<typeof BridgeAuthFrameSchema.parse>;
      try {
        frame = decodeBridgeFrame(rawDataInput(raw), BridgeAuthFrameSchema, limitCeilings.maxMessageBytes);
      } catch {
        let firstFrameWasRegistration = false;
        try {
          decodeBridgeFrame(rawDataInput(raw), BridgeRegisterFrameSchema, limitCeilings.maxMessageBytes);
          firstFrameWasRegistration = true;
        } catch {
          // Non-registration framing errors are protocol errors.
        }
        terminal(
          connection,
          firstFrameWasRegistration ? 1008 : 1002,
          firstFrameWasRegistration
            ? 'bridge authentication required'
            : 'invalid bridge authentication frame',
        );
        return;
      }
      if (!tokenMatches(frame.token, authenticationToken)) {
        terminal(connection, 1008, 'bridge authentication failed');
        return;
      }
      connection.state = 'authenticating-ack';
      void sendFrame(connection, {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        kind: 'result',
        correlationId: frame.correlationId,
        ok: true,
        result: { type: 'authenticated', connectionId, limits: limitCeilings },
      }).then(() => {
        if (connection.terminal || connection.state !== 'authenticating-ack') return;
        if (connection.authTimer !== undefined) {
          clearTimeout(connection.authTimer);
          connection.authTimer = undefined;
        }
        connection.registrationTimer = setTimeout(() => {
          terminal(connection, 1008, 'bridge registration timed out');
        }, registrationTimeoutMs);
        connection.state = 'authenticated';
        const queued = connection.pendingPostAuth.splice(0);
        for (const queuedRaw of queued) enqueuePostAuth(connection, queuedRaw);
      }, () => terminal(connection));
    });
  });

  httpServer.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const requestOrigin = request.headers.origin;
    if (typeof requestOrigin !== 'string' || !allowedOrigins.has(requestOrigin)) {
      writeUpgradeRejection(socket, 403, 'Forbidden');
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request);
    });
  });

  const listening = new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      httpServer.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      httpServer.off('error', onError);
      resolve();
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
  });
  httpServer.listen(port, host);
  try {
    await listening;
  } catch (error) {
    if (ownsRegistry) registry.close();
    throw error;
  }
  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    if (ownsRegistry) registry.close();
    throw new Error('bridge server did not expose a TCP address');
  }
  const assigned = address as AddressInfo;

  const handle: BridgeServerHandle = {
    host,
    port: assigned.port,
    url: `ws://${host}:${assigned.port}`,
    ...(generated ? { generatedToken: authenticationToken } : {}),
    limitCeilings,
    registry,
    async waitForInboundIdle() {
      await Promise.all([...connections].map((connection) => connection.inboundTail));
    },
    outstandingSendCount() {
      let count = 0;
      for (const connection of connections) count += connection.outstanding.size;
      return count;
    },
    close() {
      if (closingPromise !== undefined) return closingPromise;
      closingPromise = (async () => {
        httpServer.removeAllListeners('upgrade');
        const closingConnections = [...connections];
        for (const connection of closingConnections) {
          terminal(connection, 1001, 'bridge server closed');
        }
        await Promise.all(closingConnections.map((connection) => connection.inboundTail));
        await new Promise<void>((resolve, reject) => {
          webSocketServer.close(() => {
            httpServer.close((error) => {
              if (error !== undefined && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
                reject(error);
              } else {
                resolve();
              }
            });
          });
        });
        if (ownsRegistry) registry.close();
      })();
      return closingPromise;
    },
  };
  return handle;
}
