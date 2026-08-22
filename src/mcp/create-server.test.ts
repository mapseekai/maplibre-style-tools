import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';

import type { StyleDocument } from '../core/index.js';
import { capabilityModelJsonSchema } from '../capabilities/model-schema.js';
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
  const waiters = new Map<string | number, (message: Message) => void>();
  let starts = 0;
  let closes = 0;
  const transport: Transport = {
    onmessage: undefined,
    onerror: undefined,
    onclose: undefined,
    async start() { starts += 1; },
    async send(message) {
      sent.push(message);
      const id = 'id' in message ? message.id : undefined;
      if (id !== undefined) {
        const waiter = waiters.get(id);
        if (waiter) { waiters.delete(id); waiter(message); }
      }
    },
    async close() { closes += 1; transport.onclose?.(); },
  };
  return {
    transport,
    sent,
    get starts() { return starts; },
    get closes() { return closes; },
    waitFor(id: string | number): Promise<Message> {
      // Executor form: the project lib is ES2023, so Promise.withResolvers is untyped.
      let resolve: (message: Message) => void = () => undefined;
      const promise = new Promise<Message>((resolvePromise) => { resolve = resolvePromise; });
      waiters.set(id, resolve);
      return promise;
    },
  };
};

const resourceRead = (uri: string) => ({
  jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri },
});

const stripSchemaVersion = (schema: Record<string, unknown>): Record<string, unknown> => {
  const rest = { ...schema };
  Reflect.deleteProperty(rest, '$schema');
  return rest;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const rawProperties = record.properties as Record<string, unknown> | undefined;
    const rawRequired = Array.isArray(record.required) ? record.required as unknown[] : undefined;
    const filteredRequired = rawRequired !== undefined && rawProperties !== null && typeof rawProperties === 'object'
      ? rawRequired.filter((name) => {
        const property = rawProperties?.[String(name)];
        return !(property !== null && typeof property === 'object' && 'default' in (property as Record<string, unknown>));
      })
      : rawRequired;
    const entries = Object.entries(record)
      .map(([key, item]) => [
        key === 'prefixItems' ? 'items' : key === 'anyOf' ? 'oneOf' : key,
        canonicalize(item),
      ] as const)
      .filter(([key]) => key !== 'default' && key !== 'additionalProperties')
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const object = Object.fromEntries(entries) as Record<string, unknown>;
    if (object.enum !== undefined) Reflect.deleteProperty(object, 'type');
    if (filteredRequired !== undefined) {
      if (filteredRequired.length > 0) object.required = filteredRequired.map(canonicalize);
      else Reflect.deleteProperty(object, 'required');
    }
    return object;
  }
  return value;
};

/**
 * MCP parity comparison: canonical equality, with the SDK converter's known
 * loss of nested `required` arrays inside oneOf branches relaxed to a subset
 * guarantee — the advertised schema must never require more than the model
 * schema, and every required name in the model schema must survive.
 */
const assertAdvertisedInputMatches = (
  advertised: Record<string, unknown>,
  expected: Record<string, unknown>,
  label: string,
): void => {
  const dropRequired = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(dropRequired);
    if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const entries = Object.entries(record)
        .filter(([key]) => key !== 'required')
        .map(([key, item]) => [key, dropRequired(item)] as const);
      return Object.fromEntries(entries);
    }
    return value;
  };
  assert.deepEqual(
    canonicalize(dropRequired(stripSchemaVersion(advertised))),
    canonicalize(dropRequired(expected)),
    `${label} shape`,
  );
  const walk = (actualNode: unknown, expectedNode: unknown, path: string): void => {
    if (actualNode === null || typeof actualNode !== 'object' || expectedNode === null || typeof expectedNode !== 'object') {
      return;
    }
    const actualRecord = actualNode as Record<string, unknown>;
    const expectedRecord = expectedNode as Record<string, unknown>;
    if (Array.isArray(actualRecord.required) && Array.isArray(expectedRecord.required)) {
      const properties = expectedRecord.properties as Record<string, unknown> | undefined;
      for (const name of expectedRecord.required as unknown[]) {
        const property = properties?.[String(name)];
        const hasDefault = property !== null && typeof property === 'object'
          && 'default' in (property as Record<string, unknown>);
        if (hasDefault) continue;
        assert.ok(
          (actualRecord.required as unknown[]).includes(name),
          `${label}: ${path} required ${String(name)} lost in advertised schema`,
        );
      }
    }
    for (const key of new Set([...Object.keys(actualRecord), ...Object.keys(expectedRecord)])) {
      if (key === 'required') continue;
      walk(actualRecord[key], expectedRecord[key], `${path}/${key}`);
    }
  };
  walk(advertised, expected, 'input');
};

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

test('server factory module imports without keeping the process alive', () => {
  // Dynamic import runs inside a spawned child on purpose: process exit is the
  // public seam proving the module created no lingering handles at import time.
  const moduleUrl = new URL('./create-server.js', import.meta.url).href;
  const child = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    `await import(${JSON.stringify(moduleUrl)});`,
  ], { timeout: 20_000, encoding: 'utf8' });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
});

test('every registered tool advertises object input and output schemas', async () => {
  const created = createMapLibreStyleMcpServer();
  const raw = createRecordingTransport();
  await created.connect(raw.transport);
  raw.transport.onmessage?.({
    jsonrpc: '2.0', id: 0, method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'schema-test', version: '0.0.0' },
    },
  });
  await raw.waitFor(0);
  raw.transport.onmessage?.({ jsonrpc: '2.0', method: 'notifications/initialized' });
  raw.transport.onmessage?.({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  const response = await raw.waitFor(1);
  assert.ok('result' in response);
  const { tools } = ListToolsResultSchema.parse(response.result);
  const expected = [
    'inspectStyle', 'applyStyleTransaction', 'applyStyleDocument', 'runMapCommand', 'queryMapFeatures',
    'openStyleSession', 'closeStyleSession', 'exportStyleSession',
  ];
  assert.deepEqual(tools.map((tool) => tool.name).sort(), expected.sort());
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} missing object inputSchema`);
    assert.equal(tool.outputSchema?.type, 'object', `${tool.name} missing object outputSchema`);
  }
  for (const name of ['inspectStyle', 'applyStyleTransaction', 'applyStyleDocument', 'runMapCommand', 'queryMapFeatures'] as const) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} must be advertised`);
    const advertised = (tool.inputSchema.properties as Record<string, unknown> | undefined)?.input;
    assert.ok(advertised && typeof advertised === 'object' && !Array.isArray(advertised), `${name} input shape`);
    assertAdvertisedInputMatches(
      advertised as Record<string, unknown>,
      capabilityModelJsonSchema(name),
      `${name} MCP advertised input must equal the shared model schema`,
    );
  }
  await created.close();
});

void (undefined as unknown as CreatedMapLibreStyleMcpServer);
