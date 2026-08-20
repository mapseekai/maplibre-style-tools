import assert from 'node:assert/strict';
import test from 'node:test';

import WebSocket from 'ws';

import type { StyleDocument, StyleToolError } from '../core/index.js';
import { hashStyle } from '../adapters/maplibre/style-hash.js';
import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeResultFrameSchema,
  type BridgeAuthFrame,
  type BridgeCommandFrame,
  type BridgeRegisterFrame,
  type BridgeResultFrame,
} from './protocol.js';
import { LiveMapRegistry } from './registry.js';
import { createBridgeServer, type BridgeServerHandle } from './server.js';

const token = 't'.repeat(32);
const origin = 'http://127.0.0.1:5173';
const style = { version: 8 as const, sources: {}, layers: [] } as StyleDocument;
const styleHash = await hashStyle(style);

const connect = (
  url: string,
  requestedOrigin: string | null = origin,
): Promise<WebSocket> => new Promise((resolve, reject) => {
  const socket = new WebSocket(url, requestedOrigin === null ? {} : { origin: requestedOrigin });
  socket.once('open', () => resolve(socket));
  socket.once('unexpected-response', (_request, response) => {
    reject(new Error(`unexpected server response ${response.statusCode}`));
  });
  socket.once('error', reject);
});

const nextJson = <T>(socket: WebSocket): Promise<T> => new Promise((resolve, reject) => {
  socket.once('message', (data) => {
    try {
      resolve(JSON.parse(data.toString()) as T);
    } catch (error) {
      reject(error);
    }
  });
  socket.once('error', reject);
});

const nextClose = (socket: WebSocket): Promise<number> => new Promise((resolve) => {
  socket.once('close', (code) => resolve(code));
});

const authFrame = (authenticationToken = token): BridgeAuthFrame => ({
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  kind: 'auth',
  correlationId: 'auth-1',
  token: authenticationToken,
});

let attempt = 0;
const registerFrame = (
  mapId = 'demo-map',
  replaceLeaseId?: string,
  capabilities: BridgeRegisterFrame['capabilities'] = ['style.read', 'style.write'],
): BridgeRegisterFrame => {
  attempt += 1;
  const prefix = attempt.toString(36);
  return {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'register',
    correlationId: `register-${mapId}`,
    registrationAttemptId: `${prefix}${'A'.repeat(43 - prefix.length)}`,
    mapId,
    ...(replaceLeaseId === undefined ? {} : { replaceLeaseId }),
    capabilities,
    limits: {
      maxMessageBytes: 5 * 1024 * 1024,
      maxStyleBytes: 5 * 1024 * 1024,
      maxDiffBytes: 1024 * 1024,
      maxOperations: 100,
    },
    snapshot: capabilities.includes('style.read')
      ? { revision: 0, styleHash, style }
      : { revision: 0, styleHash },
  };
};

const authenticate = async (socket: WebSocket): Promise<void> => {
  socket.send(JSON.stringify(authFrame()));
  const frame = BridgeResultFrameSchema.parse(await nextJson(socket));
  assert.equal(frame.ok && frame.result.type, 'authenticated');
};

const register = async (
  socket: WebSocket,
  frame = registerFrame(),
): Promise<Extract<BridgeResultFrame, { ok: true }>['result']> => {
  socket.send(JSON.stringify(frame));
  const result = BridgeResultFrameSchema.parse(await nextJson(socket));
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.result;
};

const start = (overrides: Parameters<typeof createBridgeServer>[0] = {
  allowedOrigins: [origin],
}): Promise<BridgeServerHandle> => createBridgeServer({
  port: 0,
  token,
  ...overrides,
  allowedOrigins: overrides.allowedOrigins ?? [origin],
});

test('starts on loopback with a generated 32-byte token and no URL secret', async (t) => {
  const server = await createBridgeServer({ port: 0, allowedOrigins: [origin] });
  t.after(() => server.close());
  assert.equal(server.host, '127.0.0.1');
  assert.equal(Buffer.from(server.generatedToken ?? '', 'base64url').byteLength, 32);
  assert.equal(new URL(server.url).search, '');
});

test('never exposes a supplied token on the public server handle', async (t) => {
  const server = await start();
  t.after(() => server.close());
  assert.equal(server.generatedToken, undefined);
  assert.equal(JSON.stringify(server).includes(token), false);
});

test('rejects missing or unlisted Origin before WebSocket acceptance', async (t) => {
  const server = await start();
  t.after(() => server.close());
  await assert.rejects(connect(server.url, null), /403|unexpected server response/iu);
  await assert.rejects(connect(server.url, 'https://evil.example'), /403|unexpected server response/iu);
  const socket = await connect(server.url);
  socket.close();
});

test('rejects lossy or non-HTTP Origin allowlist entries before listening', async () => {
  for (const badOrigin of [
    'https://app.example/restricted',
    'https://user:password@app.example',
    'https://app.example?scope=all',
    'data:text/plain,opaque',
    'https://*.example',
  ]) {
    await assert.rejects(createBridgeServer({ port: 0, allowedOrigins: [badOrigin] }), /origin/iu);
  }
});

test('requires auth as the first frame and closes wrong tokens with policy violation', async (t) => {
  const server = await start();
  t.after(() => server.close());
  const unauthenticated = await connect(server.url);
  const unauthenticatedClose = nextClose(unauthenticated);
  unauthenticated.send(JSON.stringify(registerFrame()));
  assert.equal(await unauthenticatedClose, 1008);

  const wrong = await connect(server.url);
  const wrongClose = nextClose(wrong);
  wrong.send(JSON.stringify(authFrame('wrong-token-with-at-least-thirty-two-bytes')));
  assert.equal(await wrongClose, 1008);
});

test('closes auth timeout, wrong version, and oversized clients with exact code classes', async (t) => {
  const server = await start({
    allowedOrigins: [origin],
    authTimeoutMs: 20,
    limitCeilings: { maxMessageBytes: 256 },
  });
  t.after(() => server.close());
  const idle = await connect(server.url);
  assert.equal(await nextClose(idle), 1008);
  const wrongVersion = await connect(server.url);
  const versionClose = nextClose(wrongVersion);
  wrongVersion.send(JSON.stringify({ ...authFrame(), protocolVersion: 1 }));
  assert.equal(await versionClose, 1002);
  const oversized = await connect(server.url);
  const oversizedClose = nextClose(oversized);
  oversized.send('x'.repeat(257));
  assert.equal(await oversizedClose, 1009);
});

test('uses a separate bounded registration timer after authentication', async (t) => {
  const server = await start({
    allowedOrigins: [origin],
    authTimeoutMs: 1_000,
    registrationTimeoutMs: 20,
  });
  t.after(() => server.close());
  const socket = await connect(server.url);
  await authenticate(socket);
  assert.equal(await nextClose(socket), 1008);
});

test('registers one map and routes correlated results through the registry', async (t) => {
  const server = await start();
  t.after(() => server.close());
  const socket = await connect(server.url);
  await authenticate(socket);
  const registered = await register(socket);
  assert.equal(registered.type, 'registered');
  if (registered.type !== 'registered') assert.fail('expected registered result');
  assert.match(registered.leaseId, /^[A-Za-z0-9_-]{43}$/u);

  const commandPromise = nextJson<BridgeCommandFrame>(socket);
  const pending = server.registry.execute('demo-map', { type: 'getStyle' });
  const command = await commandPromise;
  socket.send(JSON.stringify({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'result',
    correlationId: command.correlationId,
    ok: true,
    result: { type: 'style', revision: 0, styleHash, style },
  }));
  assert.equal((await pending).type, 'style');
});

test('only the matching private lease replaces an active map', async (t) => {
  const server = await start();
  t.after(() => server.close());
  const first = await connect(server.url);
  await authenticate(first);
  const firstResult = await register(first);
  if (firstResult.type !== 'registered') assert.fail('expected registered result');

  const duplicate = await connect(server.url);
  await authenticate(duplicate);
  duplicate.send(JSON.stringify(registerFrame()));
  const denied = BridgeResultFrameSchema.parse(await nextJson(duplicate));
  assert.equal(denied.ok, false);
  if (denied.ok) assert.fail('expected registration failure');
  assert.equal(denied.error.code, 'CONFLICT');

  const replacement = await connect(server.url);
  await authenticate(replacement);
  const oldClose = nextClose(first);
  const replaced = await register(replacement, registerFrame('demo-map', firstResult.leaseId));
  assert.equal(replaced.type, 'registered');
  assert.equal(await oldClose, 4001);
});

test('a write-only browser that returns a forged full transaction is policy-closed', async (t) => {
  const server = await start();
  t.after(() => server.close());
  const socket = await connect(server.url);
  await authenticate(socket);
  await register(socket, registerFrame('demo-map', undefined, ['style.write']));
  const commandPromise = nextJson<BridgeCommandFrame>(socket);
  const pending = server.registry.execute('demo-map', {
    type: 'applyTransaction',
    expectedRevision: 0,
    expectedStyleHash: styleHash,
    transaction: {
      operations: [{ op: 'setLayerFilter', layerId: 'roads', mode: 'clear' }],
      validate: true,
    },
  });
  const disconnected = assert.rejects(pending, (error: unknown) =>
    (error as StyleToolError).code === 'BRIDGE_DISCONNECTED');
  const command = await commandPromise;
  const close = nextClose(socket);
  socket.send(JSON.stringify({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'result',
    correlationId: command.correlationId,
    ok: true,
    result: {
      type: 'transaction', detail: 'full', revision: 1,
      styleHash: '1'.repeat(64), applied: true, noOp: false,
      changedLayerIds: [], changedSourceIds: [], warnings: [], style,
    },
  }));
  assert.equal(await close, 1008);
  await disconnected;
});

test('serializes delayed registration before later inbound events and closes cleanly', async (t) => {
  let releaseHash: ((hash: string) => void) | undefined;
  let markHashStarted: (() => void) | undefined;
  let hashCalls = 0;
  const hashStarted = new Promise<void>((resolve) => { markHashStarted = resolve; });
  const registry = new LiveMapRegistry({
    hashStyle: () => {
      hashCalls += 1;
      if (hashCalls > 1) return Promise.resolve(styleHash);
      return new Promise((resolve) => {
        releaseHash = resolve;
        markHashStarted?.();
      });
    },
  });
  t.after(() => registry.close());
  const server = await start({ allowedOrigins: [origin], registry });
  t.after(() => server.close());
  const socket = await connect(server.url);
  await authenticate(socket);
  socket.send(JSON.stringify(registerFrame()));
  socket.send(JSON.stringify({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'event',
    event: 'externalStyleChange',
    mapId: 'demo-map',
    snapshot: { revision: 1, styleHash, style },
  }));
  await hashStarted;
  assert.equal(server.registry.get('demo-map'), undefined);
  releaseHash?.(styleHash);
  const registered = BridgeResultFrameSchema.parse(await nextJson(socket));
  assert.equal(registered.ok && registered.result.type, 'registered');
  await server.waitForInboundIdle();
  assert.equal(server.registry.get('demo-map')?.metadata.revision, 1);
});
