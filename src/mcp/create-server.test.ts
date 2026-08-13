import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { StyleDocument } from '../core/index.js';
import {
  createMapLibreStyleMcpServer,
  createOwnedClose,
  preflightCreatedMcpInbound,
  type CreatedMapLibreStyleMcpServer,
} from './create-server.js';
import { makeStyleUri } from './resources.js';
import { createStyleSessionStore, type StyleSessionStore } from './session-store.js';
import type { McpServerExtension } from './server-extension.js';

type Transport = Parameters<McpServer['connect']>[0];
type Message = Parameters<Transport['send']>[0];

const validStyle: StyleDocument = { version: 8, sources: {}, layers: [] };

const createRecordingTransport = () => {
  const sent: Message[] = [];
  let starts = 0;
  let closes = 0;
  const transport: Transport = {
    onmessage: undefined,
    onerror: undefined,
    onclose: undefined,
    async start() { starts += 1; },
    async send(message) { sent.push(message); },
    async close() { closes += 1; transport.onclose?.(); },
  };
  return {
    transport,
    sent,
    get starts() { return starts; },
    get closes() { return closes; },
  };
};

const resourceRead = (uri: string) => ({
  jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri },
});

test('factory exposes exact live handle preflight and all public bounded lifecycle spellings', async () => {
  for (const spelling of ['created', 'high', 'low'] as const) {
    const created = createMapLibreStyleMcpServer();
    assert.doesNotThrow(() => preflightCreatedMcpInbound(
      created, resourceRead(makeStyleUri('s1').href),
    ));
    assert.throws(
      () => preflightCreatedMcpInbound(
        created, resourceRead('maplibre-style://sessions/../~s1/style'),
      ),
      { code: 'INVALID_INPUT', details: { reason: 'nonCanonicalResourceUri' } },
    );
    const raw = createRecordingTransport();
    if (spelling === 'created') await created.connect(raw.transport);
    else if (spelling === 'high') await created.server.connect(raw.transport);
    else await created.server.server.connect(raw.transport);
    assert.equal(raw.starts, 1);
    await created.close();
    assert.equal(raw.closes, 1);
    assert.throws(
      () => preflightCreatedMcpInbound(created, { jsonrpc: '2.0', id: 1, method: 'ping' }),
      { code: 'INVALID_INPUT', details: { reason: 'invalidMcpServerHandle' } },
    );
  }
});

test('preflight rejects clones, structural values, and foreign server identities', async () => {
  const created = createMapLibreStyleMcpServer();
  for (const candidate of [
    null,
    { ...created },
    { server: created.server, store: created.store },
    created.server,
  ]) {
    assert.throws(
      () => preflightCreatedMcpInbound(candidate, { jsonrpc: '2.0', id: 1, method: 'ping' }),
      { code: 'INVALID_INPUT', details: { reason: 'invalidMcpServerHandle' } },
    );
  }
  await created.close();
});

test('extension sees one frozen policy/context and late registration is rejected', async () => {
  const seen: unknown[] = [];
  let late: (() => void) | undefined;
  const extension: McpServerExtension = (_server, context) => {
    seen.push(context, context.messagePolicy, context.responseBoundary.policy);
    context.registerResourceUriAdmission(Object.freeze({
      scheme: 'maplibre-style', authority: 'maps', assertCanonical: () => undefined,
    }));
    late = () => context.registerResourceUriAdmission(Object.freeze({
      scheme: 'maplibre-style', authority: 'late', assertCanonical: () => undefined,
    }));
    return undefined;
  };
  const created = createMapLibreStyleMcpServer({ maxMessageBytes: 256 * 1024, extensions: [extension] });
  assert.strictEqual(seen[1], created.messagePolicy);
  assert.strictEqual(seen[1], seen[2]);
  assert.ok(Object.isFrozen(seen[0]));
  assert.throws(late!, { code: 'INVALID_INPUT', details: { reason: 'resourceAdmissionsFrozen' } });
  await created.close();
});

test('factory rejects structural stores and async extensions without stealing caller stores', async () => {
  let structuralCalls = 0;
  const structural = new Proxy({}, { get() { structuralCalls += 1; return () => undefined; } });
  assert.throws(
    () => createMapLibreStyleMcpServer({ store: structural as StyleSessionStore }),
    { code: 'INVALID_INPUT', details: { reason: 'invalidStyleSessionStore' } },
  );
  assert.equal(structuralCalls, 0);

  const callerStore = createStyleSessionStore();
  const asyncExtension = async () => undefined;
  assert.throws(
    () => createMapLibreStyleMcpServer({
      store: callerStore,
      extensions: [asyncExtension as unknown as McpServerExtension],
    }),
    { code: 'INVALID_INPUT', details: { reason: 'asyncMcpExtension' } },
  );
  await Promise.resolve();
  assert.ok((await callerStore.open(validStyle)).sessionId);
  callerStore.dispose();
});

test('owned and caller-owned stores obey close ownership and close-before-connect', async () => {
  const owned = createMapLibreStyleMcpServer();
  await owned.close();
  await assert.rejects(() => owned.store.open(validStyle), { code: 'NOT_FOUND' });
  const rejected = createRecordingTransport();
  await assert.rejects(() => owned.connect(rejected.transport), {
    code: 'INVALID_INPUT', details: { reason: 'serverClosed' },
  });
  assert.equal(rejected.starts, 0);
  assert.equal(rejected.closes, 1);

  const store = createStyleSessionStore();
  const shared = createMapLibreStyleMcpServer({ store });
  await shared.server.server.close();
  assert.ok((await store.open(validStyle)).sessionId);
  store.dispose();
});

test('owned close awaits protocol close before dispose and latches repeats', async () => {
  const order: string[] = [];
  let release!: () => void;
  const close = createOwnedClose(
    () => new Promise<void>((resolve) => { order.push('server:close'); release = resolve; }),
    () => { order.push('store:dispose'); },
  );
  const first = close();
  const second = close();
  assert.strictEqual(first, second);
  assert.deepEqual(order, ['server:close']);
  release();
  await first;
  assert.deepEqual(order, ['server:close', 'store:dispose']);
});

test('server factory module has no import-time handles', async () => {
  const activeHandles = (process as typeof process & { _getActiveHandles(): unknown[] })
    ._getActiveHandles.bind(process);
  const before = activeHandles().length;
  const imported = await import('./create-server.js');
  assert.equal(typeof imported.createMapLibreStyleMcpServer, 'function');
  assert.equal(activeHandles().length, before);
});

void (undefined as unknown as CreatedMapLibreStyleMcpServer);
