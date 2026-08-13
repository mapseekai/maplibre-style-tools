import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

test('SDK 1.30 public subpath imports remain available', () => {
  assert.equal(typeof Client, 'function');
  assert.equal(typeof StdioClientTransport, 'function');
  assert.equal(typeof StreamableHTTPClientTransport, 'function');
  assert.equal(typeof InMemoryTransport.createLinkedPair, 'function');
  assert.equal(typeof McpServer, 'function');
  assert.equal(typeof ResourceTemplate, 'function');
  assert.equal(typeof StdioServerTransport, 'function');
  assert.equal(typeof StreamableHTTPServerTransport, 'function');
  assert.equal(typeof isInitializeRequest, 'function');
});
