import assert from 'node:assert/strict';
import test from 'node:test';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createStyleToolError, isStyleToolError } from '../core/errors.js';
import {
  MAX_CONFIGURABLE_MCP_MESSAGE_BYTES,
  MAX_MCP_MESSAGE_BYTES,
  MAX_MCP_METHOD_BYTES,
  MAX_MCP_REQUEST_ID_BYTES,
  MAX_MCP_RESOURCE_URI_BYTES,
  MIN_MCP_MESSAGE_BYTES,
} from './types.js';
import {
  assertInboundMcpFraming,
  createBoundedMcpTransport,
  createInboundMcpFramingContext,
  createMcpResponseBoundary,
  createResourceUriAdmissionRegistry,
  resolveMcpMessagePolicy,
} from './message-boundary.js';
import { parseMcpToolEnvelope, parseStyleToolErrorShape } from './output.js';

type Transport = Parameters<McpServer['connect']>[0];
type TransportMessage = Parameters<Transport['send']>[0];
type TransportSendOptions = Parameters<Transport['send']>[1];
type MessageExtra = Parameters<NonNullable<Transport['onmessage']>>[1];

const utf8JsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

const parseFailure = (value: { structuredContent: unknown }) => {
  const envelope = parseMcpToolEnvelope(value.structuredContent);
  if (envelope.ok) assert.fail('expected failure envelope');
  return envelope;
};

class RecordingTransport implements Transport {
  onmessage?: Transport['onmessage'];
  onerror?: Transport['onerror'];
  onclose?: Transport['onclose'];
  sessionId?: string;
  readonly sent: TransportMessage[] = [];
  readonly sendOptions: Array<TransportSendOptions> = [];
  readonly protocolVersions: string[] = [];
  startCalls = 0;
  closeCalls = 0;
  sendCalls = 0;
  rejectSendWith?: Error;

  async start(): Promise<void> {
    this.startCalls += 1;
  }

  async send(message: TransportMessage, options?: TransportSendOptions): Promise<void> {
    this.sendCalls += 1;
    if (this.rejectSendWith) throw this.rejectSendWith;
    this.sent.push(message);
    this.sendOptions.push(options);
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }

  setProtocolVersion = (version: string): void => {
    this.protocolVersions.push(version);
  };

  emitMessage(message: TransportMessage, extra?: MessageExtra): void {
    this.onmessage?.(message, extra);
  }

  emitError(error: Error): void {
    this.onerror?.(error);
  }

  emitClose(): void {
    this.onclose?.();
  }
}

const makeResponseOfSize = (bytes: number, id: string | number = 'safe-id'): TransportMessage => {
  const base = { jsonrpc: '2.0' as const, id, result: { padding: '' } };
  const padding = 'x'.repeat(bytes - utf8JsonBytes(base));
  const result = { ...base, result: { padding } };
  assert.equal(utf8JsonBytes(result), bytes);
  return result;
};

const makeNotificationOfSize = (bytes: number): TransportMessage => {
  const base = { jsonrpc: '2.0' as const, method: 'notifications/test', params: { padding: '' } };
  const padding = 'x'.repeat(bytes - utf8JsonBytes(base));
  const result = { ...base, params: { padding } };
  assert.equal(utf8JsonBytes(result), bytes);
  return result;
};

const resourceRead = (uri: string, id: string | number = 'safe-id'): TransportMessage => ({
  jsonrpc: '2.0',
  id,
  method: 'resources/read',
  params: { uri },
});

const smallRequest: TransportMessage = {
  jsonrpc: '2.0', id: 'safe-id', method: 'tools/list', params: {},
};

const exampleAdmission = {
  scheme: 'example-resource',
  authority: 'items',
  assertCanonical(rawUri: string): void {
    if (rawUri !== 'example-resource://items/~.') {
      throw createStyleToolError(
        'INVALID_INPUT', 'Resource URI is not canonical.', undefined,
        { reason: 'nonCanonicalResourceUri' },
      );
    }
  },
};

test('response boundary measures duplicated text and structured content without leaking data', () => {
  const boundary = createMcpResponseBoundary(resolveMcpMessagePolicy({
    maxMessageBytes: MIN_MCP_MESSAGE_BYTES,
  }));
  const secret = 'private-style-value'.repeat(20_000);
  assert.throws(
    () => boundary.requireToolSuccess({ style: secret }),
    (error) => isStyleToolError(error)
      && error.code === 'INVALID_INPUT'
      && error.details?.reason === 'responseTooLarge'
      && !JSON.stringify(error).includes('private-style-value'),
  );
  const boundedFailure = boundary.requireToolFailure(createStyleToolError(
    'INVALID_INPUT', 'private-error-value'.repeat(20_000), '/private/path'.repeat(20_000),
  ));
  assert.equal(parseFailure(boundedFailure).error.details?.reason, 'responseTooLarge');
  assert.doesNotMatch(boundedFailure.content[0].text, /private-error-value|private\/path/u);
  assert.ok(utf8JsonBytes(boundedFailure) <= boundary.policy.applicationResultBytes);
  const resourceError = boundary.requireResourceFailure(createStyleToolError(
    'INVALID_INPUT', 'private-resource-error'.repeat(20_000),
  ));
  assert.equal(parseStyleToolErrorShape(resourceError.data).details?.reason, 'responseTooLarge');
  assert.doesNotMatch(JSON.stringify(resourceError.data), /private-resource-error/u);
});

test('message policy accepts explicit lower and raised bounds but rejects unsafe values', () => {
  assert.equal(resolveMcpMessagePolicy({
    maxMessageBytes: MIN_MCP_MESSAGE_BYTES,
  }).maxMessageBytes, MIN_MCP_MESSAGE_BYTES);
  assert.equal(resolveMcpMessagePolicy({
    maxMessageBytes: 8 * 1024 * 1024,
  }).maxMessageBytes, 8 * 1024 * 1024);
  assert.equal(resolveMcpMessagePolicy({}).maxMessageBytes, MAX_MCP_MESSAGE_BYTES);
  for (const value of [
    0,
    MIN_MCP_MESSAGE_BYTES - 1,
    MAX_CONFIGURABLE_MCP_MESSAGE_BYTES + 1,
    1.5,
    Number.NaN,
  ]) {
    assert.throws(
      () => resolveMcpMessagePolicy({ maxMessageBytes: value }),
      { code: 'INVALID_INPUT', details: { reason: 'invalidMessageLimit' } },
    );
  }
});

test('raw resource URI admission rejects aliases before protocol URL parsing', () => {
  const policy = resolveMcpMessagePolicy({});
  const registry = createResourceUriAdmissionRegistry();
  registry.register(exampleAdmission);
  registry.register({
    scheme: 'example-resource',
    authority: 'maps',
    assertCanonical(rawUri: string): void {
      if (rawUri !== 'example-resource://maps/~map-1') {
        throw createStyleToolError(
          'INVALID_INPUT', 'Resource URI is not canonical.', undefined,
          { reason: 'nonCanonicalResourceUri' },
        );
      }
    },
  });
  assert.throws(
    () => registry.register(exampleAdmission),
    { code: 'INVALID_INPUT', details: { reason: 'duplicateResourceNamespace' } },
  );
  const admissions = registry.freeze();
  assert.throws(
    () => registry.register({ ...exampleAdmission, authority: 'late' }),
    { code: 'INVALID_INPUT', details: { reason: 'resourceAdmissionsFrozen' } },
  );
  const context = createInboundMcpFramingContext({ admissions });
  assert.doesNotThrow(() => assertInboundMcpFraming(
    resourceRead('example-resource://items/~.'), policy, context,
  ));
  for (const rawUri of [
    'example-resource://items/..',
    'example-resource://items/%2e%2e',
    'example-resource://items/foo/../~.',
    'unknown-resource://items/~.',
    'example-resource://unknown/~.',
  ]) {
    assert.throws(() => assertInboundMcpFraming(resourceRead(rawUri), policy, context), {
      code: 'INVALID_INPUT',
    });
  }
});

test('unsafe framing and prebounded payload semantics are enforced before dispatch', () => {
  const policy = resolveMcpMessagePolicy({ maxMessageBytes: MIN_MCP_MESSAGE_BYTES });
  assert.throws(() => assertInboundMcpFraming({
    jsonrpc: '2.0', id: 'x'.repeat(MAX_MCP_REQUEST_ID_BYTES), method: 'tools/list',
  }, policy), { code: 'INVALID_INPUT', details: { reason: 'requestIdTooLarge' } });
  assert.throws(() => assertInboundMcpFraming(resourceRead(
    `example-resource://items/${'x'.repeat(MAX_MCP_RESOURCE_URI_BYTES)}`,
  ), policy), { code: 'INVALID_INPUT', details: { reason: 'resourceUriTooLarge' } });
  assert.throws(() => assertInboundMcpFraming({
    jsonrpc: '2.0', id: 'safe', method: 'x'.repeat(MAX_MCP_METHOD_BYTES + 1),
  }, policy), { code: 'INVALID_INPUT', details: { reason: 'methodTooLarge' } });

  const expanded = {
    jsonrpc: '2.0',
    id: 'safe',
    method: 'tools/call',
    params: { values: Array.from({ length: 19_000 }, () => 1e100) },
  } as TransportMessage;
  const compactWireBytes = Buffer.byteLength(
    JSON.stringify(expanded).replaceAll('1e+100', '1e100'),
    'utf8',
  );
  assert.ok(compactWireBytes <= policy.maxMessageBytes);
  assert.ok(utf8JsonBytes(expanded) > policy.maxMessageBytes);
  assert.doesNotThrow(() => assertInboundMcpFraming(
    expanded,
    policy,
    createInboundMcpFramingContext({ totalBytesAlreadyBounded: true }),
  ));
  assert.throws(() => assertInboundMcpFraming(
    expanded,
    policy,
    createInboundMcpFramingContext({ totalBytesAlreadyBounded: false }),
  ), { code: 'INVALID_INPUT', details: { reason: 'messageTooLarge' } });
});

test('bounded transport sends exact bytes once and replaces an oversized response once', async () => {
  const raw = new RecordingTransport();
  const terminal: unknown[] = [];
  const policy = resolveMcpMessagePolicy({ maxMessageBytes: MIN_MCP_MESSAGE_BYTES });
  const bounded = createBoundedMcpTransport(
    raw,
    policy,
    createInboundMcpFramingContext(),
    (error) => { terminal.push(error); },
  );
  await bounded.send(makeResponseOfSize(policy.maxMessageBytes));
  assert.equal(utf8JsonBytes(raw.sent[0]), policy.maxMessageBytes);
  await bounded.send(makeResponseOfSize(policy.maxMessageBytes + 1));
  assert.equal(raw.sent.length, 2);
  assert.equal('id' in raw.sent[1]! && raw.sent[1].id, 'safe-id');
  assert.equal(
    'error' in raw.sent[1]! && (raw.sent[1].error.data as { details: { reason: string } })
      .details.reason,
    'responseTooLarge',
  );
  assert.ok(utf8JsonBytes(raw.sent[1]) <= policy.maxMessageBytes);
  assert.deepEqual(terminal, []);
});

test('unsafe inbound and oversized uncorrelatable output share one terminal latch', async () => {
  const raw = new RecordingTransport();
  let terminalCalls = 0;
  const bounded = createBoundedMcpTransport(
    raw,
    resolveMcpMessagePolicy({}),
    createInboundMcpFramingContext(),
    () => { terminalCalls += 1; },
  );
  let protocolCalls = 0;
  bounded.onmessage = () => { protocolCalls += 1; };
  await bounded.start();
  raw.emitMessage({
    jsonrpc: '2.0', id: 'x'.repeat(MAX_MCP_REQUEST_ID_BYTES), method: 'tools/list',
  });
  assert.equal(protocolCalls, 0);
  await assert.rejects(() => bounded.send(makeNotificationOfSize(MAX_MCP_MESSAGE_BYTES + 1)));
  assert.equal(raw.sent.length, 0);
  assert.equal(terminalCalls, 1);
  await bounded.close();
  await bounded.close();
  assert.equal(raw.startCalls, 1);
  assert.equal(raw.closeCalls, 1);
});

test('correlatable resource admission failure replies once and keeps connection usable', async () => {
  const registry = createResourceUriAdmissionRegistry();
  registry.register(exampleAdmission);
  const raw = new RecordingTransport();
  let terminalCalls = 0;
  const bounded = createBoundedMcpTransport(
    raw,
    resolveMcpMessagePolicy({}),
    createInboundMcpFramingContext({ admissions: registry.freeze() }),
    () => { terminalCalls += 1; },
  );
  let protocolCalls = 0;
  bounded.onmessage = () => { protocolCalls += 1; };
  await bounded.start();
  raw.emitMessage(resourceRead('example-resource://items/%2e%2e'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(protocolCalls, 0);
  assert.equal(raw.sent.length, 1);
  raw.emitMessage(smallRequest);
  assert.equal(protocolCalls, 1);
  assert.equal(terminalCalls, 0);
  await bounded.close();
});

test('raw send rejection enters the terminal latch for ordinary and fallback sends', async () => {
  for (const message of [smallRequest, makeResponseOfSize(MIN_MCP_MESSAGE_BYTES + 1)]) {
    const primary = new Error('raw-send-primary');
    const raw = new RecordingTransport();
    raw.rejectSendWith = primary;
    let terminalCalls = 0;
    const bounded = createBoundedMcpTransport(
      raw,
      resolveMcpMessagePolicy({ maxMessageBytes: MIN_MCP_MESSAGE_BYTES }),
      createInboundMcpFramingContext(),
      () => { terminalCalls += 1; },
    );
    await assert.rejects(() => bounded.send(message), (error) => error === primary);
    assert.equal(terminalCalls, 1);
    assert.equal(raw.sendCalls, 1);
    assert.equal(raw.closeCalls, 1);
  }
});

test('bounded decorator is transparent for the complete SDK 1.30 transport surface', async () => {
  const priorErrors: Error[] = [];
  let priorCloses = 0;
  const raw = new RecordingTransport();
  const priorOnMessage = raw.onmessage;
  const priorOnError = (error: Error): void => { priorErrors.push(error); };
  const priorOnClose = (): void => { priorCloses += 1; };
  raw.onerror = priorOnError;
  raw.onclose = priorOnClose;
  raw.sessionId = 'before-init';
  let terminalCalls = 0;
  const bounded = createBoundedMcpTransport(
    raw,
    resolveMcpMessagePolicy({}),
    createInboundMcpFramingContext(),
    () => { terminalCalls += 1; },
  );
  assert.equal(bounded.sessionId, 'before-init');
  raw.sessionId = 'after-init';
  assert.equal(bounded.sessionId, 'after-init');
  bounded.setProtocolVersion?.('2025-11-25');
  assert.deepEqual(raw.protocolVersions, ['2025-11-25']);

  const options: TransportSendOptions = {
    relatedRequestId: 'request-1',
    resumptionToken: 'token-1',
    onresumptiontoken: () => undefined,
  };
  await bounded.send({ jsonrpc: '2.0', id: 'request-1', result: {} }, options);
  assert.strictEqual(raw.sendOptions[0], options);

  const extra = { authInfo: { token: 'opaque', clientId: 'client', scopes: [] } };
  let forwarded: unknown[] | undefined;
  bounded.onmessage = (...args) => { forwarded = args; };
  raw.emitMessage(smallRequest, extra);
  assert.deepEqual(forwarded, [smallRequest, extra]);

  const routine = new Error('ordinary HTTP request error');
  const observedErrors: Error[] = [];
  bounded.onerror = (error) => { observedErrors.push(error); };
  raw.emitError(routine);
  assert.deepEqual(observedErrors, [routine]);
  assert.deepEqual(priorErrors, [routine]);
  assert.equal(terminalCalls, 0);

  let closes = 0;
  bounded.onclose = () => { closes += 1; };
  raw.emitClose();
  await new Promise((resolve) => setImmediate(resolve));
  await bounded.close();
  assert.equal(closes, 1);
  assert.equal(priorCloses, 1);
  assert.equal(raw.closeCalls, 0);
  assert.strictEqual(raw.onmessage, priorOnMessage);
  assert.strictEqual(raw.onerror, priorOnError);
  assert.strictEqual(raw.onclose, priorOnClose);
});
