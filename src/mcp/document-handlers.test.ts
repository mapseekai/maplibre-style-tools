import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import {
  createStyleToolError,
  type StyleDocument,
} from '../core/index.js';
import {
  createDocumentToolHandlers,
  guardDocumentTool,
} from './document-handlers.js';
import {
  createMcpResponseBoundary,
  resolveMcpMessagePolicy,
} from './message-boundary.js';
import { parseMcpToolEnvelope } from './output.js';
import { parseDocumentToolSuccessData } from './schemas.js';
import {
  createStyleSessionStore,
  createStyleSessionStoreWithDependencies,
} from './session-store.js';
import type { McpTextToolResult } from './types.js';
import { MIN_MCP_MESSAGE_BYTES } from './types.js';

const validStyle: StyleDocument = {
  version: 8,
  sources: {
    streets: {
      type: 'vector',
      tiles: ['https://example.test/{z}/{x}/{y}.pbf'],
    },
    points: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [1, 2] },
          properties: { category: 'park' },
        }],
      },
    },
  },
  layers: [{
    id: 'roads', type: 'line', source: 'streets', 'source-layer': 'road',
    paint: { 'line-color': '#000000' },
  }],
};

const changeRoads = {
  operations: [{
    op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#ffffff' },
  }],
};

const boundary = createMcpResponseBoundary(resolveMcpMessagePolicy());
const failure = (result: McpTextToolResult<unknown>) => {
  const parsed = parseMcpToolEnvelope(result.structuredContent);
  if (parsed.ok) assert.fail('expected failure envelope');
  return parsed.error;
};
const fakeClock = () => {
  const clock = { value: 0, now: () => clock.value };
  return clock;
};

test('document handlers expose exactly the required tool set and stable validate envelope', async () => {
  const handlers = createDocumentToolHandlers(createStyleSessionStore(), boundary);
  assert.deepEqual(Object.keys(handlers), [
    'style_session_open',
    'style_session_close',
    'style_validate',
    'style_inspect',
    'style_search_layers',
    'style_analyze_geojson',
    'style_apply_transaction',
    'style_export',
  ]);
  const result = await handlers.style_validate({
    target: { kind: 'inline', style: validStyle },
  });
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(parseDocumentToolSuccessData('style_validate', result.structuredContent).ok, true);
});

test('generic guard preserves success data and returns bounded direct-parse failures', async () => {
  const guarded = guardDocumentTool(
    z.strictObject({ value: z.number() }),
    boundary,
    async ({ value }) => boundary.requireToolSuccess(value),
  );
  const invalid: McpTextToolResult<number> = await guarded({ value: 'wrong' });
  assert.equal(invalid.isError, true);
  assert.equal(failure(invalid).code, 'INVALID_INPUT');
  const success: McpTextToolResult<number> = await guarded({ value: 42 });
  assert.equal(success.structuredContent.ok && success.structuredContent.data, 42);
});

test('known business failures remain authentic and unknown or forged failures are redacted', async () => {
  const handlers = createDocumentToolHandlers(createStyleSessionStore(), boundary);
  assert.equal(failure(await handlers.style_export({ sessionId: 'missing' })).code, 'NOT_FOUND');
  assert.equal(failure(await handlers.style_validate({
    target: { kind: 'inline', style: validStyle, sessionId: 'forbidden' },
  })).code, 'INVALID_INPUT');

  for (const thrown of [
    new Error('database-password'),
    { code: 'NOT_FOUND', message: 'forged-secret' },
  ]) {
    const store = createStyleSessionStoreWithDependencies({}, {
      applyStyleTransaction: () => { throw thrown; },
    });
    const opened = await store.open(validStyle);
    const result = await createDocumentToolHandlers(store, boundary).style_apply_transaction({
      sessionId: opened.sessionId, expectedRevision: 0, transaction: changeRoads,
    });
    assert.equal(failure(result).code, 'INTERNAL');
    assert.doesNotMatch(result.content[0].text, /database-password|forged-secret/);
  }
});

test('apply keeps the opaque transaction reference until the single core boundary', async () => {
  const malformed = Object.freeze({ operations: 'not-an-array', adjacent: 7 });
  let seen: unknown;
  let calls = 0;
  const expected = createStyleToolError('INVALID_INPUT', 'Transaction is invalid.');
  const store = createStyleSessionStoreWithDependencies({}, {
    applyStyleTransaction: (style, transaction) => {
      calls += 1;
      seen = transaction;
      return {
        ok: false,
        error: expected,
        style,
        changedLayers: [], changedSources: [], diff: [], warnings: [],
      };
    },
  });
  const opened = await store.open(validStyle);
  const result = await createDocumentToolHandlers(store, boundary).style_apply_transaction({
    sessionId: opened.sessionId, expectedRevision: 0, transaction: malformed,
  });
  assert.strictEqual(seen, malformed);
  assert.equal(calls, 1);
  assert.strictEqual(failure(result).message, expected.message);
});

test('failed inspect projections do not refresh TTL while successful context does', async () => {
  for (const selection of [
    { view: 'layer' as const, layerId: 'missing' },
    { view: 'source' as const, sourceId: 'missing' },
    { view: 'sourceLayers' as const, sourceId: 'missing' },
  ]) {
    const clock = fakeClock();
    const store = createStyleSessionStore({ clock, limits: { ttlMs: 100 } });
    const opened = await store.open(validStyle);
    clock.value = 99;
    const result = await createDocumentToolHandlers(store, boundary).style_inspect({
      sessionId: opened.sessionId, selection,
    });
    assert.equal(failure(result).code, 'NOT_FOUND');
    clock.value = 101;
    await assert.rejects(
      () => store.read(opened.sessionId),
      { code: 'NOT_FOUND', details: { reason: 'expired' } },
    );
  }

  const clock = fakeClock();
  const store = createStyleSessionStore({ clock, limits: { ttlMs: 100 } });
  const opened = await store.open(validStyle);
  clock.value = 99;
  const result = await createDocumentToolHandlers(store, boundary).style_inspect({
    sessionId: opened.sessionId, selection: { view: 'context' },
  });
  assert.equal(parseDocumentToolSuccessData('style_inspect', result.structuredContent).view, 'context');
  clock.value = 101;
  assert.equal((await store.read(opened.sessionId)).revision, 0);
});

test('session GeoJSON analysis is atomic for missing, wrong-type, and successful sources', async () => {
  for (const [sourceId, code] of [
    ['missing', 'NOT_FOUND'],
    ['streets', 'INVALID_INPUT'],
  ] as const) {
    const clock = fakeClock();
    const store = createStyleSessionStore({ clock, limits: { ttlMs: 100 } });
    const opened = await store.open(validStyle);
    clock.value = 99;
    const result = await createDocumentToolHandlers(store, boundary).style_analyze_geojson({
      target: { kind: 'sessionSource', sessionId: opened.sessionId, sourceId },
    });
    assert.equal(failure(result).code, code);
    clock.value = 101;
    await assert.rejects(() => store.read(opened.sessionId), { code: 'NOT_FOUND' });
  }

  const clock = fakeClock();
  const store = createStyleSessionStore({ clock, limits: { ttlMs: 100 } });
  const opened = await store.open(validStyle);
  clock.value = 99;
  const result = await createDocumentToolHandlers(store, boundary).style_analyze_geojson({
    target: { kind: 'sessionSource', sessionId: opened.sessionId, sourceId: 'points' },
  });
  const data = parseDocumentToolSuccessData('style_analyze_geojson', result.structuredContent);
  assert.equal(data.ok && data.analysis.available, true);
  clock.value = 101;
  assert.equal((await store.read(opened.sessionId)).revision, 0);
});

test('stale apply and exact revision export use stable atomic boundaries', async () => {
  const store = createStyleSessionStore();
  const opened = await store.open(validStyle);
  const handlers = createDocumentToolHandlers(store, boundary);
  const applied = await handlers.style_apply_transaction({
    sessionId: opened.sessionId, expectedRevision: 0, transaction: changeRoads,
  });
  assert.equal(parseDocumentToolSuccessData(
    'style_apply_transaction', applied.structuredContent,
  ).revision, 1);
  const stale = await handlers.style_apply_transaction({
    sessionId: opened.sessionId, expectedRevision: 0, transaction: changeRoads,
  });
  assert.equal(failure(stale).code, 'REVISION_CONFLICT');
  assert.equal((await store.read(opened.sessionId)).revision, 1);
  const exported = await handlers.style_export({ sessionId: opened.sessionId, revision: 0 });
  assert.equal(parseDocumentToolSuccessData('style_export', exported.structuredContent).revision, 0);
});

test('minimum response policy keeps open bounded and rejects export/apply before touch or commit', async () => {
  const smallBoundary = createMcpResponseBoundary(resolveMcpMessagePolicy({
    maxMessageBytes: MIN_MCP_MESSAGE_BYTES,
  }));
  const maxIdStore = createStyleSessionStore({ idFactory: () => 'x'.repeat(512) });
  const openedAtLimit = await createDocumentToolHandlers(
    maxIdStore,
    smallBoundary,
  ).style_session_open({ style: validStyle });
  assert.equal(parseDocumentToolSuccessData(
    'style_session_open', openedAtLimit.structuredContent,
  ).sessionId.length, 512);

  const clock = fakeClock();
  const largeStyle: StyleDocument = {
    ...validStyle,
    metadata: { private: 'private-style-value'.repeat(5_000) },
  };
  const exportStore = createStyleSessionStore({ clock, limits: { ttlMs: 100 } });
  const exported = await exportStore.open(largeStyle);
  clock.value = 99;
  const tooLarge = await createDocumentToolHandlers(
    exportStore,
    smallBoundary,
  ).style_export({ sessionId: exported.sessionId });
  assert.equal(failure(tooLarge).details?.reason, 'responseTooLarge');
  assert.doesNotMatch(tooLarge.content[0].text, /private-style-value/);
  clock.value = 101;
  await assert.rejects(() => exportStore.read(exported.sessionId), { code: 'NOT_FOUND' });

  let coreCalls = 0;
  const applyStore = createStyleSessionStoreWithDependencies({}, {
    applyStyleTransaction: (style) => {
      coreCalls += 1;
      return {
        ok: true,
        style,
        changedLayers: ['x'.repeat(80_000)],
        changedSources: [], diff: [], warnings: [],
      };
    },
  });
  const applyOpened = await applyStore.open(validStyle);
  const applyTooLarge = await createDocumentToolHandlers(
    applyStore,
    smallBoundary,
  ).style_apply_transaction({
    sessionId: applyOpened.sessionId,
    expectedRevision: 0,
    transaction: changeRoads,
  });
  assert.equal(failure(applyTooLarge).details?.reason, 'responseTooLarge');
  assert.equal(coreCalls, 1);
  assert.equal((await applyStore.read(applyOpened.sessionId)).revision, 0);
});
