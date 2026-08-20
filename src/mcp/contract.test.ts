import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMapLibreStyleMcpServer } from './create-server.js';
import { MCP_SERVER_VERSION } from './version.generated.js';

const style = { version: 8, sources: {}, layers: [{ id: 'roads', type: 'line' }] };
const tools = [
  'inspectStyle', 'applyStyleTransaction', 'applyStyleDocument', 'runMapCommand', 'queryMapFeatures',
  'openStyleSession', 'closeStyleSession', 'exportStyleSession',
];

test('MCP contract exposes unified capability and session tools', async () => {
  const created = createMapLibreStyleMcpServer({ storeOptions: { idFactory: () => 'contract-session' } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'contract-test', version: '1.0.0' });
  try {
    await Promise.all([created.connect(serverTransport), client.connect(clientTransport)]);
    assert.deepEqual((await client.listTools()).tools.map(({ name }) => name), tools);
    await client.callTool({ name: 'openStyleSession', arguments: { style } });
    await client.callTool({
      name: 'inspectStyle', arguments: { target: { kind: 'session', sessionId: 'contract-session' }, input: { action: 'listLayers' } },
    });
    await client.callTool({ name: 'exportStyleSession', arguments: { sessionId: 'contract-session' } });
    assert.deepEqual(client.getServerVersion(), { name: 'maplibre-style-mcp-server', version: MCP_SERVER_VERSION });
  } finally { await Promise.allSettled([client.close(), created.close()]); }
});
