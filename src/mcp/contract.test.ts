import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMapLibreStyleMcpServer } from './create-server.js';
import { createLiveMapMcpExtension } from './live-extension.js';
import { MCP_SERVER_VERSION } from './version.generated.js';

const style = {
  version: 8,
  sources: { roads: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
  layers: [{ id: 'roads', type: 'line', source: 'roads' }],
};
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
    const opened = await client.callTool({ name: 'openStyleSession', arguments: { style } });
    assert.equal(opened.isError, undefined);
    assert.equal((opened.structuredContent as { success?: unknown } | undefined)?.success, true);
    const inspected = await client.callTool({
      name: 'inspectStyle', arguments: { target: { kind: 'session', sessionId: 'contract-session' }, input: { action: 'listLayers' } },
    });
    assert.equal(inspected.isError, undefined);
    assert.equal((inspected.structuredContent as { success?: unknown } | undefined)?.success, true);
    const exported = await client.callTool({ name: 'exportStyleSession', arguments: { sessionId: 'contract-session' } });
    assert.equal(exported.isError, undefined);
    assert.equal((exported.structuredContent as { success?: unknown } | undefined)?.success, true);
    const closed = await client.callTool({ name: 'closeStyleSession', arguments: { sessionId: 'contract-session' } });
    assert.equal(closed.isError, undefined);
    assert.equal((closed.structuredContent as { success?: unknown } | undefined)?.success, true);
    assert.deepEqual(client.getServerVersion(), { name: 'maplibre-style-mcp-server', version: MCP_SERVER_VERSION });
  } finally { await Promise.allSettled([client.close(), created.close()]); }
});

test('MCP contract routes live map style and runtime actions through the bridge authority', async () => {
  const commands: Record<string, unknown>[] = [];
  const registry = {
    execute: async (_mapId: string, command: Record<string, unknown>) => {
      commands.push(command);
      if (command.type === 'getStyle') {
        return { type: 'style', revision: 8, styleHash: 'a'.repeat(64), style };
      }
      if (command.type === 'applyStyleDocument') {
        return {
          type: 'transaction', detail: 'full', revision: 9, styleHash: 'b'.repeat(64),
          applied: true, noOp: false, changedLayerIds: ['roads'], changedSourceIds: [],
          warnings: [], style: { ...style, name: 'live' }, diff: [],
        };
      }
      return { type: 'ack', accepted: true };
    },
  };
  const created = createMapLibreStyleMcpServer({
    extensions: [createLiveMapMcpExtension(registry as never)],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'contract-test', version: '1.0.0' });
  try {
    await Promise.all([created.connect(serverTransport), client.connect(clientTransport)]);
    const applied = await client.callTool({
      name: 'applyStyleDocument',
      arguments: {
        target: { kind: 'map', mapId: 'map-1' },
        input: { source: { kind: 'style', style: { ...style, name: 'live' } }, diff: true },
      },
    });
    assert.equal(applied.isError, undefined);
    const runtime = await client.callTool({
      name: 'runMapCommand',
      arguments: {
        target: { kind: 'map', mapId: 'map-1' },
        input: {
          action: 'addSprite', spriteId: 'terrain',
          url: 'https://sprites.example/terrain.json', overwrite: true,
        },
      },
    });
    assert.equal(runtime.isError, undefined);
    assert.deepEqual(commands, [
      { type: 'getStyle' },
      {
        type: 'applyStyleDocument', expectedRevision: 8, expectedStyleHash: 'a'.repeat(64),
        source: { kind: 'style', style: { ...style, name: 'live' } }, diff: true,
      },
      {
        type: 'addSprite', spriteId: 'terrain',
        url: 'https://sprites.example/terrain.json', overwrite: true,
      },
    ]);
  } finally { await Promise.allSettled([client.close(), created.close()]); }
});
