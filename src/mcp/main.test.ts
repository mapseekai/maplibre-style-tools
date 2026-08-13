import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import WebSocket from 'ws';

import { hashStyle } from '../adapters/maplibre/style-hash.js';
import type { StyleDocument } from '../core/index.js';
import { BridgeResultFrameSchema } from '../bridge/protocol.js';
import { liveMapListDataSchema } from './live-tools.js';
import * as mcp from './main.js';
import { parseMcpToolEnvelope, parseOfficialCallToolResult } from './output.js';

const bridgeOrigin = 'http://127.0.0.1:5173';
const suppliedBridgeToken = 't'.repeat(32);
const httpBearerToken = 'http-bearer-test-token';

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

const createLineReader = (stream: Readable) => {
  let pending = '';
  const lines: string[] = [];
  stream.on('data', (chunk: Buffer | string) => {
    pending += chunk.toString();
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      lines.push(pending.slice(0, newline).replace(/\r$/u, ''));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
    }
  });
  return {
    async nextLine(): Promise<string> {
      for (let attempt = 0; attempt < 300; attempt += 1) {
        const line = lines.shift();
        if (line !== undefined) return line;
        await delay(10);
      }
      assert.fail('timed out waiting for stderr line');
    },
    drain(): string[] {
      return lines.splice(0);
    },
  };
};

const stopChild = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => { child.once('close', () => resolve()); });
  child.kill('SIGTERM');
  await Promise.race([closed, delay(2_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await closed;
  }
};

const reserveLoopbackPort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error) reject(error); else resolve(); });
  });
  return address.port;
};

const assertLoopbackPortIsReleased = async (port: number): Promise<void> => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error) reject(error); else resolve(); });
  });
};

const connectWebSocket = (url: string): Promise<WebSocket> => new Promise((resolve, reject) => {
  const socket = new WebSocket(url, { origin: bridgeOrigin });
  socket.once('open', () => resolve(socket));
  socket.once('error', reject);
});

const nextWebSocketJson = <T>(socket: WebSocket): Promise<T> => new Promise((resolve, reject) => {
  socket.once('message', (raw) => {
    try { resolve(JSON.parse(raw.toString()) as T); } catch (error) { reject(error); }
  });
  socket.once('error', reject);
});

test('MCP public module is importable without starting a server', () => {
  assert.equal(typeof mcp, 'object');
  assert.equal(process.stdout.listenerCount('data'), 0);
});

test('MCP binary help writes only stderr and exits without connecting', async () => {
  const child = spawn(process.execPath, [new URL('./main.js', import.meta.url).pathname, '--help'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk); });
  child.stderr.on('data', (chunk: Buffer) => { stderr.push(chunk); });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(code, 0);
  assert.equal(Buffer.concat(stdout).toString(), '');
  assert.match(Buffer.concat(stderr).toString(), /maplibre-style-mcp/u);
});

test('installed-style symlink invokes the guarded MCP executable', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'maplibre-style-mcp-bin-'));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const binary = join(directory, 'maplibre-style-mcp');
  await symlink(new URL('./main.js', import.meta.url), binary);
  const child = spawn(process.execPath, [binary, '--help'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk); });
  child.stderr.on('data', (chunk: Buffer) => { stderr.push(chunk); });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(code, 0);
  assert.equal(Buffer.concat(stdout).toString(), '');
  assert.match(Buffer.concat(stderr).toString(), /Usage: maplibre-style-mcp/u);
});

test('generated bridge handoff is the only stderr line and stdout remains official MCP stdio', async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      new URL('./main.js', import.meta.url).pathname,
      '--bridge-port', '0',
      '--bridge-origin', bridgeOrigin,
    ],
    cwd: process.cwd(),
    stderr: 'pipe',
  });
  const stderr = transport.stderr;
  assert.ok(stderr !== null);
  const reader = createLineReader(stderr as Readable);
  const client = new Client({ name: 'binary-stdio-live-test', version: '1.0.0' });
  t.after(async () => { await Promise.allSettled([client.close(), transport.close()]); });

  await client.connect(transport);
  const info = JSON.parse(await reader.nextLine()) as Record<string, unknown>;
  assert.equal(info.event, 'bridge_listening');
  assert.equal(info.mcpTransport, 'stdio');
  assert.equal('mcpUrl' in info, false);
  assert.equal(Buffer.from(String(info.token), 'base64url').byteLength, 32);
  assert.equal(new URL(String(info.wsUrl)).search, '');
  assert.ok((await client.listTools()).tools.some(({ name }) => name === 'map_list'));
  const listed = parseMcpToolEnvelope(parseOfficialCallToolResult(await client.callTool({
    name: 'map_list', arguments: {},
  })).structuredContent);
  assert.equal(listed.ok, true);
  if (!listed.ok) assert.fail('expected map_list success');
  assert.deepEqual(liveMapListDataSchema.parse(listed.data).maps, []);
  await delay(100);
  assert.deepEqual(reader.drain(), []);
});

test('a caller-supplied bridge token is never echoed to stderr', async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      new URL('./main.js', import.meta.url).pathname,
      '--bridge-token', suppliedBridgeToken,
      '--bridge-origin', bridgeOrigin,
    ],
    cwd: process.cwd(),
    stderr: 'pipe',
  });
  const stderr = transport.stderr;
  assert.ok(stderr !== null);
  const reader = createLineReader(stderr as Readable);
  const client = new Client({ name: 'binary-supplied-token-test', version: '1.0.0' });
  t.after(async () => { await Promise.allSettled([client.close(), transport.close()]); });

  await client.connect(transport);
  const line = await reader.nextLine();
  assert.equal(line.includes(suppliedBridgeToken), false);
  const info = JSON.parse(line) as Record<string, unknown>;
  assert.equal('token' in info, false);
  assert.ok((await client.listTools()).tools.some(({ name }) => name === 'map_list'));
  await delay(100);
  assert.deepEqual(reader.drain(), []);
});

test('asynchronous stderr EPIPE closes partial MCP and bridge startup without stdout leakage', async () => {
  const bridgePort = await reserveLoopbackPort();
  const child = spawn(process.execPath, [
    new URL('./main.js', import.meta.url).pathname,
    '--bridge-port', String(bridgePort),
    '--bridge-origin', bridgeOrigin,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk); });
  child.stderr.destroy();
  const result = await Promise.race([
    new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    }),
    delay(5_000).then(async () => {
      await stopChild(child);
      assert.fail('MCP binary did not close after stderr EPIPE');
    }),
  ]);
  assert.deepEqual(result, { code: 1, signal: null });
  assert.equal(Buffer.concat(stdout).toString(), '');
  await assertLoopbackPortIsReleased(bridgePort);
});

test('HTTP binary handoff exposes both live listeners and one shared live registry', async (t) => {
  const child = spawn(process.execPath, [
    new URL('./main.js', import.meta.url).pathname,
    '--http',
    '--bearer-token', httpBearerToken,
    '--port', '0',
    '--bridge-port', '0',
    '--bridge-origin', bridgeOrigin,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk); });
  const reader = createLineReader(child.stderr);
  t.after(() => stopChild(child));

  const info = JSON.parse(await reader.nextLine()) as Record<string, unknown>;
  assert.equal(info.event, 'bridge_listening');
  assert.equal(info.mcpTransport, 'http');
  assert.equal(new URL(String(info.mcpUrl)).port.length > 0, true);
  assert.equal(new URL(String(info.wsUrl)).port.length > 0, true);
  assert.notEqual(new URL(String(info.mcpUrl)).port, new URL(String(info.wsUrl)).port);

  const socket = await connectWebSocket(String(info.wsUrl));
  t.after(() => { socket.close(); });
  const authentication = nextWebSocketJson(socket);
  socket.send(JSON.stringify({
    protocolVersion: 1,
    kind: 'auth',
    correlationId: 'auth-http-binary',
    token: info.token,
  }));
  const authenticated = BridgeResultFrameSchema.parse(await authentication);
  assert.equal(authenticated.ok && authenticated.result.type, 'authenticated');

  const style: StyleDocument = { version: 8, sources: {}, layers: [] };
  const registration = nextWebSocketJson(socket);
  socket.send(JSON.stringify({
    protocolVersion: 1,
    kind: 'register',
    correlationId: 'register-http-binary',
    registrationAttemptId: 'H'.repeat(43),
    mapId: 'http-live-map',
    capabilities: ['style.read'],
    limits: {
      maxMessageBytes: 5 * 1024 * 1024,
      maxStyleBytes: 5 * 1024 * 1024,
      maxDiffBytes: 1024 * 1024,
      maxOperations: 100,
    },
    snapshot: { revision: 0, styleHash: await hashStyle(style), style },
  }));
  const registered = BridgeResultFrameSchema.parse(await registration);
  assert.equal(registered.ok && registered.result.type, 'registered');

  const transport = new StreamableHTTPClientTransport(new URL(String(info.mcpUrl)), {
    requestInit: { headers: { authorization: `Bearer ${httpBearerToken}` } },
  });
  const client = new Client({ name: 'binary-http-live-test', version: '1.0.0' });
  t.after(async () => { await Promise.allSettled([client.close(), transport.close()]); });
  await client.connect(transport);
  const listed = parseMcpToolEnvelope(parseOfficialCallToolResult(await client.callTool({
    name: 'map_list', arguments: {},
  })).structuredContent);
  assert.equal(listed.ok, true);
  if (!listed.ok) assert.fail('expected map_list success');
  assert.equal(liveMapListDataSchema.parse(listed.data).maps[0]?.mapId, 'http-live-map');
  await delay(100);
  assert.deepEqual(reader.drain(), []);
  assert.equal(Buffer.concat(stdout).toString(), '');
});
