import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';

import {
  createStyleToolError,
  type StyleDocument,
} from '../core/index.js';
import { createMapLibreStyleMcpServer } from './create-server.js';
import {
  parseMcpToolEnvelope,
  parseOfficialCallToolResult,
  parseStyleToolErrorShape,
} from './output.js';
import {
  makeContextUri,
  makeDiffUri,
  makeLayerUri,
  makeSessionUri,
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
  createStyleSessionStore,
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

const evaluationGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Alpha' },
      geometry: { type: 'Point', coordinates: [0, 0] },
    },
    {
      type: 'Feature',
      properties: { name: 'Beta' },
      geometry: { type: 'Point', coordinates: [1, 1] },
    },
  ],
};

const evaluationStyle: StyleDocument = {
  version: 8,
  name: 'MapLibre Style MCP read-only evaluation fixture',
  metadata: { purpose: 'deterministic-read-only-evaluation' },
  sources: {
    basemap: {
      type: 'vector',
      tiles: ['https://example.test/{z}/{x}/{y}.pbf'],
    },
    points: { type: 'geojson', data: evaluationGeoJson },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } },
    {
      id: 'roads', type: 'line', source: 'basemap', 'source-layer': 'transportation',
      paint: { 'line-color': '#336699' },
    },
    {
      id: 'boundaries', type: 'fill', source: 'basemap', 'source-layer': 'boundaries',
      paint: { 'fill-color': '#cccccc' },
    },
    {
      id: 'places', type: 'circle', source: 'points',
      paint: { 'circle-color': '#cc3300' },
    },
  ],
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

test('official source resources reject inherited names authentically without touching TTL', async (t) => {
  const clock = { value: 0, now: () => clock.value };
  const store = createStyleSessionStore({
    clock, limits: { ttlMs: 100 }, idFactory: () => 'empty-sources',
  });
  await store.open({ version: 8, sources: {}, layers: [] });
  const created = createMapLibreStyleMcpServer({ store });
  const client = new Client({ name: 'source-resource-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await Promise.allSettled([client.close(), created.close()]);
    store.dispose();
  });
  await Promise.all([created.connect(serverTransport), client.connect(clientTransport)]);

  clock.value = 99;
  for (const sourceId of ['toString', 'constructor', '__proto__']) {
    await assert.rejects(
      () => client.readResource({ uri: makeSourceUri('empty-sources', sourceId).href }),
      (error) => {
        if (!(error instanceof McpError)) return false;
        const parsed = parseStyleToolErrorShape(error.data);
        return parsed.code === 'NOT_FOUND'
          && parsed.details?.reason === 'sourceNotFound';
      },
    );
  }
  clock.value = 101;
  await assert.rejects(() => store.read('empty-sources'), { code: 'NOT_FOUND' });
});

void (undefined as unknown as DocumentToolName);

type JsonRecord = Record<string, unknown>;

const requireJsonRecord = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    assert.fail(`expected ${label} object`);
  }
  return value as JsonRecord;
};

const requireJsonString = (value: unknown, label: string): string => {
  if (typeof value !== 'string') assert.fail(`expected ${label} string`);
  return value;
};

const parseJsonText = (text: string): unknown => JSON.parse(text) as unknown;

const expandResourceTemplate = (
  index: number,
  variables: Readonly<Record<string, string>>,
  expected: URL,
): string => {
  const source = styleResourceTemplates[index];
  assert.ok(source);
  const expanded = new ResourceTemplate(source, { list: undefined })
    .uriTemplate.expand(variables);
  assert.equal(expanded, expected.href);
  return expanded;
};

const readTemplatedResource = async (
  client: Client,
  index: number,
  variables: Readonly<Record<string, string>>,
  expected: URL,
): Promise<unknown> => parseJsonText(requireText(await client.readResource({
  uri: expandResourceTemplate(index, variables, expected),
})));

const withIndependentEvaluationSession = async (
  sessionId: string,
  solve: (client: Client) => Promise<string>,
): Promise<string> => {
  const store = createStyleSessionStore({ idFactory: () => sessionId });
  const created = createMapLibreStyleMcpServer({ store });
  const client = new Client({ name: `evaluation-${sessionId}`, version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    const opened = await store.open(evaluationStyle);
    assert.equal(opened.sessionId, sessionId);
    assert.equal(opened.revision, 0);
    assert.equal(Number.isFinite(opened.expiresAt), true);
    await Promise.all([created.connect(serverTransport), client.connect(clientTransport)]);
    return await solve(client);
  } finally {
    await Promise.allSettled([client.close(), created.close()]);
    store.dispose();
  }
};

const solveEvaluation = async (client: Client, sessionId: string): Promise<string> => {
  switch (sessionId) {
    case 'eval-01': {
      const validated = parseDocumentToolSuccessData(
        'style_validate',
        parseOfficialCallToolResult(await client.callTool({
          name: 'style_validate',
          arguments: { target: { kind: 'inline', style: evaluationStyle } },
        })).structuredContent,
      );
      const context = requireJsonRecord(await readTemplatedResource(
        client, 2, { sessionId }, makeContextUri(sessionId),
      ), 'context resource');
      return validated.ok && context.layerCount === evaluationStyle.layers.length
        ? 'True' : 'False';
    }
    case 'eval-02': {
      const inspected = parseDocumentToolSuccessData(
        'style_inspect',
        parseOfficialCallToolResult(await client.callTool({
          name: 'style_inspect',
          arguments: { sessionId, selection: { view: 'context' } },
        })).structuredContent,
      );
      const searched = parseDocumentToolSuccessData(
        'style_search_layers',
        parseOfficialCallToolResult(await client.callTool({
          name: 'style_search_layers',
          arguments: { sessionId, query: { query: 'road' } },
        })).structuredContent,
      );
      if (inspected.view !== 'context') assert.fail('expected context inspection');
      const selected = searched.layers.find(({ id }) =>
        inspected.context.layers.some((layer) => layer.id === id));
      if (selected === undefined || searched.total !== 1) assert.fail('expected one road layer');
      return selected.id;
    }
    case 'eval-03': {
      const searched = parseDocumentToolSuccessData(
        'style_search_layers',
        parseOfficialCallToolResult(await client.callTool({
          name: 'style_search_layers',
          arguments: { sessionId, query: { query: 'road' } },
        })).structuredContent,
      );
      const layerId = searched.layers[0]?.id;
      if (layerId === undefined) assert.fail('expected road layer');
      const roadResource = requireJsonRecord(await readTemplatedResource(
        client, 3, { sessionId, layerId }, makeLayerUri(sessionId, layerId),
      ), 'road resource');
      await readTemplatedResource(
        client, 3, { sessionId, layerId: 'background' },
        makeLayerUri(sessionId, 'background'),
      );
      const layer = requireJsonRecord(roadResource.layer, 'road layer');
      const paint = requireJsonRecord(layer.paint, 'road paint');
      return requireJsonString(paint['line-color'], 'road line-color');
    }
    case 'eval-04': {
      const inspected = parseDocumentToolSuccessData(
        'style_inspect',
        parseOfficialCallToolResult(await client.callTool({
          name: 'style_inspect',
          arguments: {
            sessionId, selection: { view: 'sourceLayers', sourceId: 'basemap' },
          },
        })).structuredContent,
      );
      const sourceResource = requireJsonRecord(await readTemplatedResource(
        client, 4, { sessionId, sourceId: 'basemap' },
        makeSourceUri(sessionId, 'basemap'),
      ), 'basemap source resource');
      const source = requireJsonRecord(sourceResource.source, 'basemap source');
      assert.equal(source.type, 'vector');
      if (inspected.view !== 'sourceLayers') assert.fail('expected source-layer inspection');
      const usage = inspected.sourceLayers.find(({ layers }) =>
        layers.some(({ id }) => id === 'roads'));
      if (usage === undefined) assert.fail('expected roads source-layer usage');
      return usage.sourceLayer;
    }
    case 'eval-05': {
      const analyzed = parseDocumentToolSuccessData(
        'style_analyze_geojson',
        parseOfficialCallToolResult(await client.callTool({
          name: 'style_analyze_geojson',
          arguments: { target: { kind: 'inline', data: evaluationGeoJson } },
        })).structuredContent,
      );
      const validated = parseDocumentToolSuccessData(
        'style_validate',
        parseOfficialCallToolResult(await client.callTool({
          name: 'style_validate',
          arguments: { target: { kind: 'inline', style: evaluationStyle } },
        })).structuredContent,
      );
      if (!validated.ok || !analyzed.ok || !analyzed.analysis.available) {
        assert.fail('expected valid inline fixture analysis');
      }
      return String(analyzed.analysis.featureCount);
    }
    case 'eval-06': {
      const analyzed = parseDocumentToolSuccessData(
        'style_analyze_geojson',
        parseOfficialCallToolResult(await client.callTool({
          name: 'style_analyze_geojson',
          arguments: {
            target: { kind: 'sessionSource', sessionId, sourceId: 'points' },
          },
        })).structuredContent,
      );
      const sourceResource = requireJsonRecord(await readTemplatedResource(
        client, 4, { sessionId, sourceId: 'points' }, makeSourceUri(sessionId, 'points'),
      ), 'points source resource');
      const styleResource = requireJsonRecord(await readTemplatedResource(
        client, 1, { sessionId }, makeStyleUri(sessionId),
      ), 'style resource');
      assert.deepEqual(
        requireJsonRecord(sourceResource.source, 'points source'),
        requireJsonRecord(styleResource.sources, 'style sources').points,
      );
      if (!analyzed.ok || !analyzed.analysis.available) {
        assert.fail('expected available session GeoJSON analysis');
      }
      const geometry = Object.entries(analyzed.analysis.geometryTypes)
        .find(([, count]) => count !== undefined && count > 0)?.[0];
      if (geometry === undefined) assert.fail('expected one geometry type');
      return geometry;
    }
    case 'eval-07': {
      const exported = parseDocumentToolSuccessData(
        'style_export',
        parseOfficialCallToolResult(await client.callTool({
          name: 'style_export', arguments: { sessionId },
        })).structuredContent,
      );
      const styleResource = await readTemplatedResource(
        client, 1, { sessionId }, makeStyleUri(sessionId),
      );
      assert.deepEqual(styleResource, exported.style);
      return String(exported.revision);
    }
    case 'eval-08': {
      const metadata = requireJsonRecord(await readTemplatedResource(
        client, 0, { sessionId }, makeSessionUri(sessionId),
      ), 'session metadata');
      const context = requireJsonRecord(await readTemplatedResource(
        client, 2, { sessionId }, makeContextUri(sessionId),
      ), 'context resource');
      const exported = parseDocumentToolSuccessData(
        'style_export',
        parseOfficialCallToolResult(await client.callTool({
          name: 'style_export', arguments: { sessionId },
        })).structuredContent,
      );
      assert.equal(metadata.sessionId, sessionId);
      assert.equal(exported.style.layers.length, context.layerCount);
      return String(context.layerCount);
    }
    case 'eval-09': {
      const searched = parseDocumentToolSuccessData(
        'style_search_layers',
        parseOfficialCallToolResult(await client.callTool({
          name: 'style_search_layers',
          arguments: { sessionId, query: { query: 'places' } },
        })).structuredContent,
      );
      const layerId = searched.layers[0]?.id;
      if (layerId === undefined) assert.fail('expected places layer');
      const layerResource = requireJsonRecord(await readTemplatedResource(
        client, 3, { sessionId, layerId }, makeLayerUri(sessionId, layerId),
      ), 'places layer resource');
      const layer = requireJsonRecord(layerResource.layer, 'places layer');
      const sourceId = requireJsonString(layer.source, 'places source ID');
      const sourceResource = requireJsonRecord(await readTemplatedResource(
        client, 4, { sessionId, sourceId }, makeSourceUri(sessionId, sourceId),
      ), 'places source resource');
      assert.equal(requireJsonRecord(sourceResource.source, 'places source').type, 'geojson');
      return sourceId;
    }
    case 'eval-10': {
      const validated = parseDocumentToolSuccessData(
        'style_validate',
        parseOfficialCallToolResult(await client.callTool({
          name: 'style_validate',
          arguments: { target: { kind: 'session', sessionId } },
        })).structuredContent,
      );
      const context = requireJsonRecord(await readTemplatedResource(
        client, 2, { sessionId }, makeContextUri(sessionId),
      ), 'context resource');
      const roadResource = requireJsonRecord(await readTemplatedResource(
        client, 3, { sessionId, layerId: 'roads' }, makeLayerUri(sessionId, 'roads'),
      ), 'roads layer resource');
      const road = requireJsonRecord(roadResource.layer, 'roads layer');
      const consistent = validated.ok
        && context.layerCount === 4
        && road.type === 'line'
        && road.source === 'basemap'
        && road['source-layer'] === 'transportation';
      return consistent ? 'True' : 'False';
    }
    default:
      assert.fail(`unexpected evaluation session ${sessionId}`);
  }
};

const readEvaluationAnswers = async (): Promise<readonly string[]> => {
  const xml = await readFile('evals/maplibre-style-mcp.xml', 'utf8');
  assert.ok(Buffer.byteLength(xml, 'utf8') <= 64 * 1024);
  const answers = Array.from(xml.matchAll(/<answer>([^<]*)<\/answer>/gu), (match) => match[1]);
  assert.equal(answers.length, 10);
  assert.equal(answers.every((answer): answer is string => answer !== undefined), true);
  return answers as string[];
};

test('all ten MCP Builder answers are reproduced from independent read-only sessions', async () => {
  const expectedAnswers = await readEvaluationAnswers();
  for (let index = 0; index < expectedAnswers.length; index += 1) {
    const sessionId = `eval-${String(index + 1).padStart(2, '0')}`;
    const answer = await withIndependentEvaluationSession(
      sessionId,
      (client) => solveEvaluation(client, sessionId),
    );
    assert.equal(answer, expectedAnswers[index], sessionId);
  }
});

test('built evaluation fixture server exposes eval-01 over official stdio', async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['evals/maplibre-style-mcp-fixture-server.mjs'],
    cwd: process.cwd(),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'evaluation-stdio-test', version: '1.0.0' });
  t.after(async () => {
    await Promise.allSettled([client.close(), transport.close()]);
  });
  await client.connect(transport);
  const context = requireJsonRecord(parseJsonText(requireText(await client.readResource({
    uri: makeContextUri('eval-01').href,
  }))), 'eval-01 context');
  assert.equal(context.layerCount, 4);
});
