import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
  type StyleDocument,
} from '../core/index.js';
import { createMapLibreStyleMcpServer } from './create-server.js';
import { parseOfficialCallToolResult } from './output.js';
import {
  makeContextUri,
  makeDiffUri,
  makeLayerUri,
  makeSessionUri,
  makeSourceUri,
  makeStyleUri,
  styleResourceTemplates,
} from './resources.js';
import { MAX_MCP_MESSAGE_BYTES } from './types.js';
import { MCP_SERVER_VERSION } from './version.generated.js';

const exactToolMetadata = Object.freeze({
  style_session_open: ['Open style session', 'Open one bounded in-memory session from inline Style JSON.', false, false, false, false],
  style_session_close: ['Close style session', 'Close one in-memory style session.', false, true, true, false],
  style_validate: ['Validate style', 'Validate inline Style JSON or one open session snapshot.', true, false, true, false],
  style_inspect: ['Inspect style', 'Read one context, layer, source, or source-layer view from a session.', true, false, true, false],
  style_search_layers: ['Search style layers', 'Search layer summaries in one session without mutation.', true, false, true, false],
  style_analyze_geojson: ['Analyze GeoJSON', 'Analyze inline GeoJSON or one session GeoJSON source.', true, false, true, false],
  style_apply_transaction: ['Apply style transaction', 'Dry-run or commit one revision-checked `{operations:[...]}` transaction whose shape and limits core validates.', false, true, false, false],
  style_export: ['Export style snapshot', 'Export the current or one retained revision of a session.', true, false, true, false],
} as const);

const contractStyle: StyleDocument = {
  version: 8,
  sources: {
    basemap: {
      type: 'vector',
      tiles: ['https://example.test/{z}/{x}/{y}.pbf'],
    },
    points: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { name: 'Marker' },
          geometry: { type: 'Point', coordinates: [0, 0] },
        }],
      },
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } },
    {
      id: 'roads', type: 'line', source: 'basemap', 'source-layer': 'transportation',
      paint: { 'line-color': '#336699' },
    },
    { id: 'places', type: 'circle', source: 'points' },
  ],
};

const requireResourceText = (
  result: Awaited<ReturnType<Client['readResource']>>,
): string => {
  const content = result.contents[0];
  if (content === undefined || !('text' in content)) assert.fail('expected text resource');
  return content.text;
};

const inspectMcpContract = async (): Promise<{
  readonly serverVersion: ReturnType<Client['getServerVersion']>;
  readonly toolNames: string[];
  readonly resourceTemplates: string[];
  readonly limits: Readonly<{
    maxSessions: number;
    maxStyleBytes: number;
    maxOperations: number;
    maxHistory: number;
    maxDiffBytes: number;
    ttlMs: number;
  }>;
  readonly sampleToolResults: CallToolResult[];
}> => {
  const created = createMapLibreStyleMcpServer({
    storeOptions: { idFactory: () => 'contract-session' },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'contract-test', version: '1.0.0' });
  try {
    await Promise.all([created.connect(serverTransport), client.connect(clientTransport)]);
    const listedTools = await client.listTools();
    assert.deepEqual(listedTools.tools.map(({ name }) => name), Object.keys(exactToolMetadata));
    for (const tool of listedTools.tools) {
      const expected = exactToolMetadata[tool.name as keyof typeof exactToolMetadata];
      assert.ok(expected, `unexpected tool ${tool.name}`);
      assert.equal(tool.title, expected[0]);
      assert.equal(tool.description, expected[1]);
      assert.deepEqual(tool.annotations, {
        readOnlyHint: expected[2],
        destructiveHint: expected[3],
        idempotentHint: expected[4],
        openWorldHint: expected[5],
      });
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok(Object.keys(tool.inputSchema.properties ?? {}).length > 0);
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.equal(tool.outputSchema, undefined);
    }
    const templates = await client.listResourceTemplates();
    const sampleToolResults: CallToolResult[] = [];
    const call = async (name: string, arguments_: Record<string, unknown>): Promise<void> => {
      sampleToolResults.push(parseOfficialCallToolResult(await client.callTool({
        name, arguments: arguments_,
      })));
    };
    await call('style_session_open', { style: contractStyle });
    await call('style_validate', { target: { kind: 'session', sessionId: 'contract-session' } });
    await call('style_inspect', {
      sessionId: 'contract-session', selection: { view: 'context' },
    });
    await call('style_search_layers', {
      sessionId: 'contract-session', query: { query: 'road' },
    });
    await call('style_analyze_geojson', {
      target: { kind: 'sessionSource', sessionId: 'contract-session', sourceId: 'points' },
    });
    await call('style_apply_transaction', {
      sessionId: 'contract-session', expectedRevision: 0,
      transaction: { operations: [{
        op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#224466' },
      }] },
    });
    await call('style_export', { sessionId: 'contract-session' });
    for (const uri of [
      makeSessionUri('contract-session'),
      makeStyleUri('contract-session'),
      makeContextUri('contract-session'),
      makeLayerUri('contract-session', 'roads'),
      makeSourceUri('contract-session', 'basemap'),
      makeDiffUri('contract-session', 1),
    ]) JSON.parse(requireResourceText(await client.readResource({ uri: uri.href })));
    await call('style_session_close', { sessionId: 'contract-session' });
    return {
      serverVersion: client.getServerVersion(),
      toolNames: listedTools.tools.map(({ name }) => name),
      resourceTemplates: templates.resourceTemplates.map(({ uriTemplate }) => uriTemplate),
      limits: created.store.limits,
      sampleToolResults,
    };
  } finally {
    await Promise.allSettled([client.close(), created.close()]);
  }
};

interface EvaluationPair {
  readonly question: string;
  readonly answer: string;
}

const decodeXmlText = (text: string): string => {
  const entities: Readonly<Record<string, string>> = Object.freeze({
    amp: '&', apos: "'", gt: '>', lt: '<', quot: '"',
  });
  return text.replace(/&([^;]+);/gu, (_match, entity: string) => {
    const decoded = entities[entity];
    if (decoded === undefined) throw new Error(`unexpected XML entity &${entity};`);
    return decoded;
  });
};

const parseEvaluationXml = (xml: string): EvaluationPair[] => {
  if (Buffer.byteLength(xml, 'utf8') > 64 * 1024) throw new Error('evaluation XML is too large');
  const root = /^\s*<evaluation>([\s\S]*)<\/evaluation>\s*$/u.exec(xml);
  if (root?.[1] === undefined) throw new Error('malformed evaluation XML');
  const body = root[1];
  const pairPattern = /\s*<qa_pair>\s*<question>([^<]*)<\/question>\s*<answer>([^<]*)<\/answer>\s*<\/qa_pair>/guy;
  const pairs: EvaluationPair[] = [];
  let offset = 0;
  while (offset < body.length) {
    pairPattern.lastIndex = offset;
    const match = pairPattern.exec(body);
    if (match === null || match[1] === undefined || match[2] === undefined) {
      if (/^\s*$/u.test(body.slice(offset))) break;
      throw new Error('unexpected evaluation XML node');
    }
    pairs.push({ question: decodeXmlText(match[1]), answer: decodeXmlText(match[2]) });
    offset = pairPattern.lastIndex;
  }
  return pairs;
};

test('MCP contract retains exact tools, resources, store defaults, and envelope parity', async () => {
  const contract = await inspectMcpContract();
  assert.deepEqual(contract.serverVersion, {
    name: 'maplibre-style-mcp-server', version: MCP_SERVER_VERSION,
  });
  assert.deepEqual(contract.toolNames, Object.keys(exactToolMetadata));
  assert.deepEqual(contract.resourceTemplates, styleResourceTemplates);
  assert.deepEqual(contract.limits, {
    maxSessions: 32,
    maxStyleBytes: 5 * 1024 * 1024,
    maxOperations: 100,
    maxHistory: 20,
    maxDiffBytes: 1024 * 1024,
    ttlMs: 30 * 60_000,
  });
  assert.strictEqual(contract.limits.maxStyleBytes, DEFAULT_MAX_STYLE_BYTES);
  assert.strictEqual(contract.limits.maxOperations, DEFAULT_MAX_OPERATIONS);
  assert.strictEqual(contract.limits.maxDiffBytes, DEFAULT_MAX_DIFF_BYTES);
  assert.strictEqual(MAX_MCP_MESSAGE_BYTES, 5 * 1024 * 1024);
  for (const result of contract.sampleToolResults) {
    const first = result.content[0];
    if (first === undefined || first.type !== 'text') assert.fail('expected text tool content');
    assert.deepEqual(JSON.parse(first.text), result.structuredContent);
  }
});

test('MCP Builder evaluation file has ten independent read-only answers', async () => {
  const pairs = parseEvaluationXml(await readFile('evals/maplibre-style-mcp.xml', 'utf8'));
  assert.equal(pairs.length, 10);
  const sessionIds = pairs.map(({ question }) => /\beval-(?:0[1-9]|10)\b/u.exec(question)?.[0]);
  assert.deepEqual(sessionIds, Array.from({ length: 10 }, (_, index) =>
    `eval-${String(index + 1).padStart(2, '0')}`));
  assert.equal(new Set(pairs.map(({ question }) => question)).size, 10);
  for (const pair of pairs) {
    assert.ok(pair.question.trim().length > 0);
    assert.ok(pair.answer.trim().length > 0);
    assert.equal(pair.answer.includes('\n'), false);
    assert.doesNotMatch(pair.question, /style_(?:session_open|session_close|apply_transaction)/u);
    assert.doesNotMatch(pair.question, /fetch|download|internet|current time/iu);
  }
});
