import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatBridgeConnectionInfo,
  parseBridgeOptions,
} from './bridge-options.js';
import { parseMcpProcessOptions } from './index.js';

const token32 = 't'.repeat(32);

test('bridge options use secure loopback, ephemeral, generated-token defaults', () => {
  assert.deepEqual(parseBridgeOptions([]), {
    host: '127.0.0.1', port: 0, token: undefined, allowedOrigins: [],
  });
});

test('bridge options accept ordered unique Origins and reject unsafe values', () => {
  assert.deepEqual(parseBridgeOptions([
    '--bridge-host', '127.0.0.1',
    '--bridge-port', '7788',
    '--bridge-token', token32,
    '--bridge-origin', 'http://127.0.0.1:5173',
    '--bridge-origin', 'https://maps.example',
    '--bridge-origin', 'http://127.0.0.1:5173',
  ]), {
    host: '127.0.0.1', port: 7788, token: token32,
    allowedOrigins: ['http://127.0.0.1:5173', 'https://maps.example'],
  });
  assert.throws(() => parseBridgeOptions(['--bridge-token', 'short']), /32/u);
  assert.throws(() => parseBridgeOptions(['--bridge-port', '70000']), /port/u);
  assert.throws(() => parseBridgeOptions(['--bridge-host', '0.0.0.0']), /loopback/u);
  for (const origin of [
    'https://maps.example/restricted',
    'https://user:password@maps.example',
    'https://maps.example?scope=all',
    'data:text/plain,opaque',
    'https://*.example',
  ]) assert.throws(() => parseBridgeOptions(['--bridge-origin', origin]), /origin/ui);
});

test('connection handoff is one transport-discriminated secret-safe JSON value', () => {
  assert.deepEqual(JSON.parse(formatBridgeConnectionInfo(
    { url: 'ws://127.0.0.1:7788', generatedToken: 'g'.repeat(43) },
    ['http://127.0.0.1:5173'],
    { mcpTransport: 'stdio' },
  )), {
    event: 'bridge_listening',
    wsUrl: 'ws://127.0.0.1:7788',
    mcpTransport: 'stdio',
    token: 'g'.repeat(43),
    allowedOrigins: ['http://127.0.0.1:5173'],
  });
  assert.deepEqual(JSON.parse(formatBridgeConnectionInfo(
    { url: 'ws://127.0.0.1:7788' },
    ['https://maps.example'],
    { mcpTransport: 'http', mcpUrl: 'http://127.0.0.1:9911/mcp' },
  )), {
    event: 'bridge_listening',
    wsUrl: 'ws://127.0.0.1:7788',
    mcpTransport: 'http',
    mcpUrl: 'http://127.0.0.1:9911/mcp',
    allowedOrigins: ['https://maps.example'],
  });
});

test('one process parser keeps stdio, HTTP, and bridge flag ownership distinct', () => {
  assert.deepEqual(parseMcpProcessOptions([
    '--bridge-port', '0',
    '--stdio',
    '--bridge-origin', 'http://127.0.0.1:5173',
  ]), {
    mcpTransport: 'stdio',
    bridge: {
      host: '127.0.0.1',
      port: 0,
      token: undefined,
      allowedOrigins: ['http://127.0.0.1:5173'],
    },
  });
  assert.deepEqual(parseMcpProcessOptions([
    '--bridge-origin', 'https://maps.example',
    '--http',
    '--port', '0',
    '--bridge-port', '7788',
    '--bearer-token', 'known-http-token',
    '--allowed-origin', 'https://mcp.example',
  ]), {
    mcpTransport: 'http',
    bridge: {
      host: '127.0.0.1',
      port: 7788,
      token: undefined,
      allowedOrigins: ['https://maps.example'],
    },
    http: {
      bearerToken: 'known-http-token',
      port: 0,
      allowedOrigins: ['https://mcp.example'],
    },
  });
  assert.throws(() => parseMcpProcessOptions([
    '--stdio', '--bearer-token', 'not-stdio',
  ]), /invalid arguments/u);
  assert.throws(() => parseMcpProcessOptions(['--http']), /invalid arguments/u);
});
