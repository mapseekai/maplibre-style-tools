import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MAX_CONFIGURABLE_MCP_MESSAGE_BYTES,
  MAX_MCP_MESSAGE_BYTES,
  MAX_MCP_METHOD_BYTES,
  MAX_MCP_REQUEST_ID_BYTES,
  MAX_MCP_RESOURCE_URI_BYTES,
  MAX_STYLE_SESSION_ID_BYTES,
  MCP_RESPONSE_ENVELOPE_RESERVE_BYTES,
  MCP_SERVER_VERSION,
  MIN_MCP_MESSAGE_BYTES,
} from './main.js';

test('MCP version matches the package manifest without runtime manifest lookup', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  assert.equal(MCP_SERVER_VERSION, manifest.version);
});

test('message byte limit and framing byte bounds remain fixed', () => {
  assert.equal(MAX_MCP_MESSAGE_BYTES, 5 * 1024 * 1024);
  assert.equal(MIN_MCP_MESSAGE_BYTES, 128 * 1024);
  assert.equal(MAX_CONFIGURABLE_MCP_MESSAGE_BYTES, 64 * 1024 * 1024);
  assert.equal(MCP_RESPONSE_ENVELOPE_RESERVE_BYTES, 64 * 1024);
  assert.equal(MAX_MCP_REQUEST_ID_BYTES, 256);
  assert.equal(MAX_MCP_METHOD_BYTES, 128);
  assert.equal(MAX_MCP_RESOURCE_URI_BYTES, 8 * 1024);
  assert.equal(MAX_STYLE_SESSION_ID_BYTES, 512);
});
