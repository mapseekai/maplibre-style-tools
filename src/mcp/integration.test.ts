import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  createStyleToolError,
  type StyleDocument,
} from '../core/index.js';
import { createMapLibreStyleMcpServer } from './create-server.js';
import {
  parseMcpToolEnvelope,
  parseOfficialCallToolResult,
} from './output.js';
import {
  makeDiffUri,
  makeLayerUri,
  makeSourceUri,
  makeStyleUri,
  styleResourceTemplates,
} from './resources.js';
import {
  parseDocumentToolSuccessData,
  type DocumentToolName,
} from './schemas.js';
import {
  assertFactoryStyleSessionStore,
  createStyleSessionStoreWithDependencies,
} from './session-store.js';
import type { McpServerExtension } from './server-extension.js';
import { MCP_SERVER_VERSION } from './version.generated.js';

const validStyle: StyleDocument = {
  version: 8,
  sources: {
    '..': {
      type: 'vector',
      tiles: ['https://example.test/{z}/{x}/{y}.pbf'],
    },
  },
  layers: [{
    id: '.', type: 'line', source: '..', 'source-layer': 'roads',
    paint: { 'line-color': '#000000' },
  }],
};

const changeRoads = {
  operations: [{
    op: 'setLayerProperties', layerId: '.', paint: { 'line-color': '#ffffff' },
  }],
};

const expectedMetadata = Object.freeze({
  style_session_open: ['Open style session', 'Open one bounded in-memory session from inline Style JSON.', false, false, false, false],
  style_session_close: ['Close style session', 'Close one in-memory style session.', false, true, true, false],
  style_validate: ['Validate style', 'Validate inline Style JSON or one open session snapshot.', true, false, true, false],
  style_inspect: ['Inspect style', 'Read one context, layer, source, or source-layer view from a session.', true, false, true, false],
  style_search_layers: ['Search style layers', 'Search layer summaries in one session without mutation.', true, false, true, false],
  style_analyze_geojson: ['Analyze GeoJSON', 'Analyze inline GeoJSON or one session GeoJSON source.', true, false, true, false],
  style_apply_transaction: ['Apply style transaction', 'Dry-run or commit one revision-checked `{operations:[...]}` transaction whose shape and limits core validates.', false, true, false, false],
  style_export: ['Export style snapshot', 'Export the current or one retained revision of a session.', true, false, true, false],
} as const);

const requireText = (resource: Awaited<ReturnType<Client['readResource']>>): string => {
  const first = resource.contents[0];
  if (first === undefined || !('text' in first)) assert.fail('expected text resource');
  return first.text;
};

test('official Client advertises exact contracts and executes bounded tools and resources', async (t) => {
  const projections = { value: 0 };
  const store = createStyleSessionStoreWithDependencies(
    { idFactory: () => 's1' },
    {},
    { observer: {
      onProjectionAttempt: () => { projections.value += 1; },
      onRevisionReadAttempt: () => { projections.value += 1; },
    } },
  );
  assert.strictEqual(assertFactoryStyleSessionStore(store), store);
  const created = createMapLibreStyleMcpServer({ store });
  const client = new Client({ name: 'maplibre-style-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await Promise.allSettled([client.close(), created.close()]);
    store.dispose();
  });
  await Promise.all([created.connect(serverTransport), client.connect(clientTransport)]);

  assert.deepEqual(client.getServerVersion(), {
    name: 'maplibre-style-mcp-server', version: MCP_SERVER_VERSION,
  });
  const listedTools = await client.listTools();
  assert.deepEqual(listedTools.tools.map(({ name }) => name), Object.keys(expectedMetadata));
  for (const tool of listedTools.tools) {
    const expected = expectedMetadata[tool.name as keyof typeof expectedMetadata];
    assert.ok(expected);
    assert.equal(tool.title, expected[0]);
    assert.equal(tool.description, expected[1]);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: expected[2], destructiveHint: expected[3],
      idempotentHint: expected[4], openWorldHint: expected[5],
    });
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  const templates = await client.listResourceTemplates();
  assert.deepEqual(
    templates.resourceTemplates.map(({ uriTemplate }) => uriTemplate),
    styleResourceTemplates,
  );

  const invalid = parseOfficialCallToolResult(await client.callTool({
    name: 'style_session_open', arguments: { style: validStyle, forbidden: true },
  }));
  assert.equal(invalid.isError, true);
  assert.equal(invalid.structuredContent, undefined);
  assert.equal(store.size, 0);

  const opened = parseOfficialCallToolResult(await client.callTool({
    name: 'style_session_open', arguments: { style: validStyle },
  }));
  assert.equal(
    parseDocumentToolSuccessData('style_session_open', opened.structuredContent).sessionId,
    's1',
  );
  const applied = parseOfficialCallToolResult(await client.callTool({
    name: 'style_apply_transaction',
    arguments: { sessionId: 's1', expectedRevision: 0, transaction: changeRoads },
  }));
  assert.equal(
    parseDocumentToolSuccessData('style_apply_transaction', applied.structuredContent).revision,
    1,
  );

  assert.equal(JSON.parse(requireText(await client.readResource({
    uri: makeStyleUri('s1').href,
  }))).version, 8);
  assert.equal(JSON.parse(requireText(await client.readResource({
    uri: makeLayerUri('s1', '.').href,
  }))).layer.id, '.');
  assert.equal(JSON.parse(requireText(await client.readResource({
    uri: makeSourceUri('s1', '..').href,
  }))).source.type, 'vector');
  assert.match(requireText(await client.readResource({
    uri: makeDiffUri('s1', 1).href,
  })), /line-color/u);

  const readsBeforeAliases = projections.value;
  for (const uri of [
    'maplibre-style://sessions/s1/style',
    'maplibre-style://sessions/../~s1/style',
    'maplibre-style://sessions/%2e%2e/~s1/style',
    'maplibre-style://sessions/~s1/layers/../~roads',
    'maplibre-style://sessions/%2573%2531/style',
  ]) await assert.rejects(() => client.readResource({ uri }));
  assert.equal(projections.value, readsBeforeAliases);
  const stillUsable = parseOfficialCallToolResult(await client.callTool({
    name: 'style_export', arguments: { sessionId: 's1' },
  }));
  assert.equal(parseDocumentToolSuccessData('style_export', stillUsable.structuredContent).revision, 1);
});

test('official Client multiplexes document and same-scheme extension admissions', async (t) => {
  const calls = { live: 0 };
  const liveAdmission = Object.freeze({
    scheme: 'maplibre-style',
    authority: 'maps',
    assertCanonical(rawUri: string): void {
      if (!/^maplibre-style:\/\/maps\/~[A-Za-z0-9-]+$/u.test(rawUri)) {
        throw createStyleToolError(
          'INVALID_INPUT', 'Resource URI is not canonical.', undefined,
          { reason: 'nonCanonicalResourceUri' },
        );
      }
    },
  });
  const extension: McpServerExtension = (server, context) => {
    context.registerResourceUriAdmission(liveAdmission);
    server.registerResource(
      'test-live-map',
      new ResourceTemplate('maplibre-style://maps/~{mapId}', { list: undefined }),
      { title: 'Test live map', description: 'Read one deterministic test live map.' },
      context.guardResourceHandler(async (uri) => {
        calls.live += 1;
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: '{}' }] };
      }),
    );
    return undefined;
  };
  const created = createMapLibreStyleMcpServer({
    extensions: [extension], storeOptions: { idFactory: () => 's1' },
  });
  const client = new Client({ name: 'maplibre-style-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => Promise.allSettled([client.close(), created.close()]).then(() => undefined));
  await Promise.all([created.connect(serverTransport), client.connect(clientTransport)]);
  await client.callTool({ name: 'style_session_open', arguments: { style: validStyle } });
  await client.readResource({ uri: makeStyleUri('s1').href });
  await client.readResource({ uri: 'maplibre-style://maps/~map-1' });
  assert.equal(calls.live, 1);
  for (const uri of [
    'maplibre-style://maps/../~map-1',
    'maplibre-style://maps/%2e/~map-1',
    'maplibre-style://unknown/~map-1',
  ]) await assert.rejects(() => client.readResource({ uri }));
  assert.equal(calls.live, 1);
  assert.ok((await client.listResourceTemplates()).resourceTemplates.some(
    ({ uriTemplate }) => uriTemplate === 'maplibre-style://maps/~{mapId}',
  ));
});

test('official Client separates SDK rejection from stable core business failures', async (t) => {
  const created = createMapLibreStyleMcpServer({ storeOptions: {
    idFactory: () => 's1', limits: { maxOperations: 1 },
  } });
  const client = new Client({ name: 'maplibre-style-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => Promise.allSettled([client.close(), created.close()]).then(() => undefined));
  await Promise.all([created.connect(serverTransport), client.connect(clientTransport)]);

  const missing = parseOfficialCallToolResult(await client.callTool({
    name: 'style_export', arguments: { sessionId: 'missing' },
  }));
  const missingEnvelope = parseMcpToolEnvelope(missing.structuredContent);
  assert.equal(missingEnvelope.ok, false);
  if (missingEnvelope.ok) assert.fail('expected failure');
  assert.equal(missingEnvelope.error.code, 'NOT_FOUND');

  await client.callTool({ name: 'style_session_open', arguments: { style: validStyle } });
  const malformed = parseOfficialCallToolResult(await client.callTool({
    name: 'style_apply_transaction',
    arguments: {
      sessionId: 's1', expectedRevision: 0,
      transaction: { operations: 'wrong' },
    },
  }));
  const malformedEnvelope = parseMcpToolEnvelope(malformed.structuredContent);
  assert.equal(malformedEnvelope.ok, false);
  if (malformedEnvelope.ok) assert.fail('expected failure');
  assert.equal(malformedEnvelope.error.code, 'INVALID_INPUT');
  assert.equal((await created.store.read('s1')).revision, 0);

  const tooMany = parseOfficialCallToolResult(await client.callTool({
    name: 'style_apply_transaction',
    arguments: {
      sessionId: 's1', expectedRevision: 0,
      transaction: { operations: [changeRoads.operations[0], changeRoads.operations[0]] },
    },
  }));
  const tooManyEnvelope = parseMcpToolEnvelope(tooMany.structuredContent);
  assert.equal(tooManyEnvelope.ok, false);
  if (tooManyEnvelope.ok) assert.fail('expected failure');
  assert.equal(tooManyEnvelope.error.code, 'INVALID_INPUT');
  assert.equal((await created.store.read('s1')).revision, 0);
});

void (undefined as unknown as DocumentToolName);
