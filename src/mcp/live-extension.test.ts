import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { hashStyle } from '../adapters/maplibre/style-hash.js';
import { createStyleToolError, type StyleDocument } from '../core/index.js';
import {
  createRegistrationLiveness,
  LiveMapRegistry,
  type BridgePeer,
} from '../bridge/registry.js';
import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeCapability,
  type BridgeCommandFrame,
  type BridgeRegisterFrame,
} from '../bridge/protocol.js';
import { createMapLibreStyleMcpServer } from './create-server.js';
import { createLiveMapMcpExtension } from './live-extension.js';
import {
  buildLiveMapMetadataUri,
  buildLiveMapStyleUri,
} from './live-resources.js';
import {
  LIVE_TOOL_NAMES,
  liveToolInputSchemas,
  liveMapListDataSchema,
  liveTransactionDataSchema,
  projectLiveMutationError,
} from './live-tools.js';
import { parseMcpToolEnvelope, parseOfficialCallToolResult } from './output.js';

const style: StyleDocument = { version: 8, sources: {}, layers: [] };
const styleHash = await hashStyle(style);

class FakePeer implements BridgePeer {
  readonly sent: BridgeCommandFrame[] = [];
  constructor(readonly id = 'live-peer') {}
  send(frame: BridgeCommandFrame): Promise<void> {
    this.sent.push(frame);
    return Promise.resolve();
  }
  close(): void {}
}

const registerMap = async (
  registry: LiveMapRegistry,
  options: {
    capabilities?: readonly BridgeCapability[];
    includeStyle?: boolean;
  } = {},
): Promise<FakePeer> => {
  const controller = new AbortController();
  const peer = new FakePeer();
  const capabilities = options.capabilities ?? ['style.read', 'style.write'];
  const frame: BridgeRegisterFrame = {
    protocolVersion: 1,
    kind: 'register',
    correlationId: 'register-demo-map',
    registrationAttemptId: 'A'.repeat(43),
    mapId: 'demo-map',
    capabilities: [...capabilities],
    limits: {
      maxMessageBytes: 5 * 1024 * 1024,
      maxStyleBytes: 5 * 1024 * 1024,
      maxDiffBytes: 1024 * 1024,
      maxOperations: 100,
    },
    snapshot: {
      revision: 0,
      styleHash,
      ...(options.includeStyle === false ? {} : { style }),
    },
  };
  await registry.register(
    peer,
    frame,
    createRegistrationLiveness(controller.signal, () => true),
  );
  return peer;
};

const requireText = (value: Awaited<ReturnType<Client['readResource']>>): string => {
  const first = value.contents[0];
  if (first === undefined || !('text' in first)) assert.fail('expected text resource');
  return first.text;
};

test('registers exact live tools and reads collection, metadata, and cached Style', async (t) => {
  const registry = new LiveMapRegistry();
  await registerMap(registry);
  const created = createMapLibreStyleMcpServer({
    extensions: [createLiveMapMcpExtension(registry)],
  });
  const client = new Client({ name: 'live-extension-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await Promise.allSettled([client.close(), created.close()]);
    registry.close();
  });
  await Promise.all([created.connect(serverTransport), client.connect(clientTransport)]);

  const listedTools = await client.listTools();
  const liveTools = listedTools.tools.filter(({ name }) => name.startsWith('map_'));
  assert.deepEqual(liveTools.map(({ name }) => name).sort(), [...LIVE_TOOL_NAMES].sort());
  for (const tool of liveTools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    const readOnly = [
      'map_list', 'map_get_style', 'map_query_source_features',
      'map_query_rendered_features', 'map_list_images',
    ].includes(tool.name);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: readOnly,
      destructiveHint: !readOnly,
      idempotentHint: readOnly,
      openWorldHint: tool.name === 'map_apply_transaction' || tool.name === 'map_add_image',
    });
    if (tool.name !== 'map_list') {
      assert.ok(tool.inputSchema.required?.includes('mapId'));
    }
  }

  const rawList = parseOfficialCallToolResult(await client.callTool({
    name: 'map_list', arguments: {},
  }));
  const listEnvelope = parseMcpToolEnvelope(rawList.structuredContent);
  assert.equal(listEnvelope.ok, true);
  if (!listEnvelope.ok) assert.fail('expected map_list success');
  assert.equal(liveMapListDataSchema.parse(listEnvelope.data).maps[0]?.mapId, 'demo-map');

  const resources = await client.listResources();
  assert.ok(resources.resources.some(({ uri }) => uri === 'maplibre-style://maps'));
  const templates = await client.listResourceTemplates();
  assert.deepEqual(
    templates.resourceTemplates
      .map(({ uriTemplate }) => uriTemplate)
      .filter((uri) => uri.startsWith('maplibre-style://maps/'))
      .sort(),
    ['maplibre-style://maps/~{mapId}', 'maplibre-style://maps/~{mapId}/style'],
  );
  const fixed = liveMapListDataSchema.parse(JSON.parse(requireText(await client.readResource({
    uri: 'maplibre-style://maps',
  }))));
  assert.equal(fixed.maps[0]?.mapId, 'demo-map');
  assert.equal(JSON.parse(requireText(await client.readResource({
    uri: buildLiveMapMetadataUri('demo-map'),
  }))).mapId, 'demo-map');
  assert.deepEqual(JSON.parse(requireText(await client.readResource({
    uri: buildLiveMapStyleUri('demo-map'),
  }))), style);
});

test('live resource builders retain one canonical marker and reject non-semantic IDs', () => {
  assert.equal(buildLiveMapMetadataUri('a.b'), 'maplibre-style://maps/~a.b');
  assert.equal(buildLiveMapStyleUri('a_b'), 'maplibre-style://maps/~a_b/style');
  for (const value of ['.', '..', '%2e', '%2e%2e', '%252e']) {
    assert.throws(() => buildLiveMapStyleUri(value));
  }
});

const nextCommand = async (peer: FakePeer): Promise<BridgeCommandFrame> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const command = peer.sent.shift();
    if (command !== undefined) return command;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail('expected browser command');
};

test('all live schemas are strict and a transaction returns only the fixed receipt', async (t) => {
  for (const name of LIVE_TOOL_NAMES) {
    assert.equal(liveToolInputSchemas[name].safeParse({ extra: true }).success, false);
  }
  const registry = new LiveMapRegistry();
  const peer = await registerMap(registry);
  const created = createMapLibreStyleMcpServer({
    extensions: [createLiveMapMcpExtension(registry)],
  });
  const client = new Client({ name: 'live-mutation-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => Promise.allSettled([client.close(), created.close()]).then(() => {
    registry.close();
  }));
  await Promise.all([created.connect(serverTransport), client.connect(clientTransport)]);

  const pending = client.callTool({
    name: 'map_apply_transaction',
    arguments: {
      mapId: 'demo-map',
      expectedRevision: 0,
      expectedStyleHash: styleHash,
      transaction: {
        operations: [{ op: 'replaceRootProperty', property: 'metadata', value: { next: true } }],
        validate: true,
      },
    },
  });
  const command = await nextCommand(peer);
  assert.equal(command.command.type, 'applyTransaction');
  await registry.acceptResult(peer.id, {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'result',
    correlationId: command.correlationId,
    ok: true,
    result: {
      type: 'transaction',
      detail: 'full',
      revision: 1,
      styleHash: '1'.repeat(64),
      applied: true,
      noOp: false,
      changedLayerIds: ['secret-layer-id'],
      changedSourceIds: [],
      warnings: [],
      diff: [{
        op: 'replace', path: '/metadata', before: 'secret-before', after: 'secret-after',
        target: { kind: 'style' },
      }],
    },
  });
  const official = parseOfficialCallToolResult(await pending);
  const envelope = parseMcpToolEnvelope(official.structuredContent);
  assert.equal(envelope.ok, true);
  if (!envelope.ok) assert.fail('expected receipt');
  assert.deepEqual(liveTransactionDataSchema.parse(envelope.data), {
    type: 'transaction', detail: 'receipt', revision: 1,
    styleHash: '1'.repeat(64), applied: true, noOp: false,
  });
  assert.equal(JSON.stringify(envelope).includes('secret'), false);
  assert.equal(registry.get('demo-map')?.metadata.revision, 1);
});

test('metadata-only Style resource issues one validated getStyle and canonical failures stay isolated', async (t) => {
  const registry = new LiveMapRegistry();
  const peer = await registerMap(registry, { includeStyle: false });
  const created = createMapLibreStyleMcpServer({
    extensions: [createLiveMapMcpExtension(registry)],
  });
  const client = new Client({ name: 'live-style-read-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => Promise.allSettled([client.close(), created.close()]).then(() => {
    registry.close();
  }));
  await Promise.all([created.connect(serverTransport), client.connect(clientTransport)]);

  for (const uri of [
    'maplibre-style://maps/a.b/style',
    'maplibre-style://maps/~a%2Eb/style',
    'maplibre-style://maps/~%252e/style',
    'maplibre-style://maps/foo/../~demo-map/style',
  ]) await assert.rejects(() => client.readResource({ uri }));
  assert.equal(peer.sent.length, 0);

  const pending = client.readResource({ uri: buildLiveMapStyleUri('demo-map') });
  const command = await nextCommand(peer);
  assert.equal(command.command.type, 'getStyle');
  await registry.acceptResult(peer.id, {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'result', correlationId: command.correlationId, ok: true,
    result: { type: 'style', revision: 0, styleHash, style },
  });
  assert.deepEqual(JSON.parse(requireText(await pending)), style);
  assert.deepEqual(registry.get('demo-map')?.snapshot.style, style);
  const stillUsable = parseMcpToolEnvelope(parseOfficialCallToolResult(await client.callTool({
    name: 'map_list', arguments: {},
  })).structuredContent);
  assert.equal(stillUsable.ok, true);
});

test('mutation error projection keeps only stable authoritative metadata', () => {
  const projected = projectLiveMutationError(createStyleToolError(
    'IO_ERROR', 'secret', '/secret', {
      currentSnapshot: { revision: 1, styleHash: '2'.repeat(64), style },
      rolledBack: false,
      rollbackError: {
        code: 'IO_ERROR', message: 'nested secret', path: '/nested', details: { secret: true },
      },
      secret: 'never',
    },
  ));
  assert.equal(projected.message, 'Bridge I/O failed');
  assert.deepEqual(projected.details, {
    currentSnapshot: { revision: 1, styleHash: '2'.repeat(64) },
    rolledBack: false,
    rollbackError: { code: 'IO_ERROR', message: 'Bridge I/O failed' },
  });
  assert.equal(JSON.stringify(projected).includes('secret'), false);
});
