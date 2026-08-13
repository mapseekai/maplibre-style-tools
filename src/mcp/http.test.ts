import assert from 'node:assert/strict';
import { request } from 'node:http';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

import type { StyleDocument } from '../core/index.js';
import { parseOfficialCallToolResult } from './output.js';
import { parseDocumentToolSuccessData } from './schemas.js';
import {
  MAX_HTTP_BEARER_TOKEN_BYTES,
  defaultHttpMcpDependencies,
  startStreamableHttpMcp,
  startStreamableHttpMcpWithDependencies,
  type HttpMcpDependencies,
  type StartedHttpMcp,
} from './http.js';

const bearerToken = 'secret-test-token';

const validStyle: StyleDocument = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background' }],
};

interface RawResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

const sendRaw = async (
  url: string,
  options: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string | Buffer;
  } = {},
): Promise<RawResponse> => new Promise((resolve, reject) => {
  const target = new URL(url);
  const body = options.body;
  const outgoing = request({
    hostname: target.hostname,
    port: target.port,
    path: target.pathname,
    method: options.method ?? 'POST',
    headers: options.headers,
  }, (response) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.once('error', reject);
    response.once('end', () => resolve({
      status: response.statusCode ?? 0,
      headers: response.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    }));
  });
  outgoing.once('error', reject);
  if (body !== undefined) outgoing.write(body);
  outgoing.end();
});

const authorizedHeaders = (
  started: StartedHttpMcp,
  extra: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> => ({
  authorization: `Bearer ${bearerToken}`,
  host: new URL(started.url).host,
  accept: 'application/json, text/event-stream',
  'content-type': 'application/json',
  'mcp-protocol-version': LATEST_PROTOCOL_VERSION,
  ...extra,
});

const initializeMessage = (id: unknown = 1): unknown => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'http-raw-test', version: '1.0.0' },
  },
});

const connectClient = async (started: StartedHttpMcp) => {
  const transport = new StreamableHTTPClientTransport(new URL(started.url), {
    requestInit: { headers: { authorization: `Bearer ${bearerToken}` } },
  });
  const client = new Client({ name: 'http-test', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
};

test('HTTP rejects invalid configured bearer tokens before any allocation', async () => {
  const calls = { policy: 0, store: 0, listener: 0, server: 0, raw: 0 };
  const dependencies: HttpMcpDependencies = {
    ...defaultHttpMcpDependencies,
    resolveMessagePolicy(options) {
      calls.policy += 1;
      return defaultHttpMcpDependencies.resolveMessagePolicy(options);
    },
    storeFactory(options) {
      calls.store += 1;
      return defaultHttpMcpDependencies.storeFactory(options);
    },
    listenerFactory(handler) {
      calls.listener += 1;
      return defaultHttpMcpDependencies.listenerFactory(handler);
    },
    serverFactory(options, policy) {
      calls.server += 1;
      return defaultHttpMcpDependencies.serverFactory(options, policy);
    },
    rawTransportFactory(options) {
      calls.raw += 1;
      return defaultHttpMcpDependencies.rawTransportFactory(options);
    },
  };
  for (const token of [
    '', '   ', 'line\r\nbreak', 'x'.repeat(MAX_HTTP_BEARER_TOKEN_BYTES + 1),
    new String('boxed'), 42,
  ]) {
    await assert.rejects(
      () => startStreamableHttpMcpWithDependencies(
        { bearerToken: token as string }, dependencies,
      ),
      { code: 'INVALID_INPUT', details: { reason: 'invalidBearerToken' } },
    );
  }
  assert.deepEqual(calls, { policy: 0, store: 0, listener: 0, server: 0, raw: 0 });
});

test('HTTP defaults to random loopback and enforces bearer, exact Host, and Origin', async (t) => {
  const started = await startStreamableHttpMcp({ bearerToken });
  t.after(async () => { await started.close(); });
  assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/u);

  assert.equal((await sendRaw(started.url)).status, 401);
  assert.equal((await sendRaw(started.url, {
    headers: authorizedHeaders(started, { host: 'attacker.example' }),
  })).status, 421);
  assert.equal((await sendRaw(started.url, {
    headers: authorizedHeaders(started, { origin: 'https://attacker.example' }),
  })).status, 403);
  assert.equal((await sendRaw(started.url, {
    headers: authorizedHeaders(started),
    body: JSON.stringify({}),
  })).status, 400);
});

test('HTTP refuses non-loopback binding unless explicitly enabled', async () => {
  await assert.rejects(
    () => startStreamableHttpMcp({ bearerToken, host: '0.0.0.0' }),
    { code: 'INVALID_INPUT', details: { reason: 'nonLoopbackNotAllowed' } },
  );
  const started = await startStreamableHttpMcp({
    bearerToken,
    host: '0.0.0.0',
    allowNonLoopback: true,
  });
  assert.match(started.url, /^http:\/\/0\.0\.0\.0:\d+\/mcp$/u);
  await Promise.all([started.close(), started.close()]);
});

test('official HTTP client keeps transport and application session IDs separate', async (t) => {
  const started = await startStreamableHttpMcp({
    bearerToken,
    storeOptions: { idFactory: () => 'app-session' },
  });
  const { client, transport } = await connectClient(started);
  t.after(async () => {
    await Promise.allSettled([client.close(), started.close()]);
  });
  const opened = parseOfficialCallToolResult(await client.callTool({
    name: 'style_session_open', arguments: { style: validStyle },
  }));
  const data = parseDocumentToolSuccessData(
    'style_session_open', opened.structuredContent,
  );
  assert.ok(transport.sessionId);
  assert.equal(data.sessionId, 'app-session');
  assert.notEqual(transport.sessionId, data.sessionId);
  await transport.terminateSession();
});

test('HTTP bounds every POST and leaves a known session usable after rejection', async (t) => {
  const started = await startStreamableHttpMcp({ bearerToken });
  t.after(async () => { await started.close(); });
  const oversized = Buffer.alloc(started.messagePolicy.maxMessageBytes + 1, 0x20);
  assert.equal((await sendRaw(started.url, {
    headers: authorizedHeaders(started), body: oversized,
  })).status, 413);
  assert.equal((await sendRaw(started.url, {
    headers: authorizedHeaders(started),
    body: JSON.stringify(initializeMessage('x'.repeat(257))),
  })).status, 400);

  const { client, transport } = await connectClient(started);
  t.after(async () => { await client.close(); });
  assert.ok(transport.sessionId);
  const rejected = await sendRaw(started.url, {
    headers: authorizedHeaders(started, {
      'mcp-session-id': transport.sessionId,
    }),
    body: oversized,
  });
  assert.equal(rejected.status, 413);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 8);
});
