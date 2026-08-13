import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import { isStyleToolError, type StyleDocument } from '../core/index.js';
import {
  createMcpResponseBoundary,
  resolveMcpMessagePolicy,
} from './message-boundary.js';
import {
  createResourceResolver,
  documentResourceUriAdmission,
  makeContextUri,
  makeDiffUri,
  makeLayerUri,
  makeSessionUri,
  makeSourceUri,
  makeStyleUri,
  parseLayerUri,
  parseSourceUri,
  styleResourceTemplates,
} from './resources.js';
import { createStyleSessionStore } from './session-store.js';
import { MIN_MCP_MESSAGE_BYTES } from './types.js';

const validStyle: StyleDocument = {
  version: 8,
  sources: {
    'source .': {
      type: 'vector',
      tiles: ['https://example.test/{z}/{x}/{y}.pbf'],
    },
  },
  layers: [{
    id: 'road & rail', type: 'line', source: 'source .', 'source-layer': 'roads',
    paint: { 'line-color': '#000000' },
  }],
};
const changeRoads = {
  operations: [{
    op: 'setLayerProperties', layerId: 'road & rail', paint: { 'line-color': '#fff' },
  }],
};
const boundary = createMcpResponseBoundary(resolveMcpMessagePolicy());
const fakeClock = () => {
  const clock = { value: 0, now: () => clock.value };
  return clock;
};

test('resource URI helpers round trip encoded and marked semantic IDs', async () => {
  assert.deepEqual(styleResourceTemplates, [
    'maplibre-style://sessions/~{sessionId}',
    'maplibre-style://sessions/~{sessionId}/style',
    'maplibre-style://sessions/~{sessionId}/context',
    'maplibre-style://sessions/~{sessionId}/layers/~{layerId}',
    'maplibre-style://sessions/~{sessionId}/sources/~{sourceId}',
    'maplibre-style://sessions/~{sessionId}/revisions/~{revision}/diff',
  ]);
  assert.deepEqual(parseLayerUri(makeLayerUri('percent%~', 'a/b%~')), {
    sessionId: 'percent%~', layerId: 'a/b%~',
  });
  assert.deepEqual(parseLayerUri(makeLayerUri('.', '..')), {
    sessionId: '.', layerId: '..',
  });
  assert.equal(parseSourceUri(makeSourceUri('..', '.')).sourceId, '.');
  assert.equal(parseLayerUri(makeLayerUri('~', '%2F')).sessionId, '~');

  const expanded = new ResourceTemplate(styleResourceTemplates[1], { list: undefined })
    .uriTemplate.expand({ sessionId: 'city/one' });
  assert.equal(expanded, makeStyleUri('city/one').href);
  const expandedLayer = new ResourceTemplate(styleResourceTemplates[3], { list: undefined })
    .uriTemplate.expand({ sessionId: 'percent%~', layerId: 'a/b%~' });
  assert.equal(expandedLayer, makeLayerUri('percent%~', 'a/b%~').href);

  const store = createStyleSessionStore({ idFactory: () => 'city/one' });
  await store.open(validStyle);
  const result = await createResourceResolver(store, boundary).resolve(
    makeLayerUri('city/one', 'road & rail'),
  );
  assert.equal(JSON.parse(result.contents[0]!.text).layer.id, 'road & rail');
});

test('document raw URI admission rejects normalization and encoding aliases', () => {
  for (const uri of [
    makeSessionUri('.').href,
    makeStyleUri('s1').href,
    makeContextUri('s1').href,
    makeLayerUri('s1', '..').href,
    makeSourceUri('percent%~', 'a/b%~').href,
    makeDiffUri('s1', 1).href,
  ]) assert.doesNotThrow(() => documentResourceUriAdmission.assertCanonical(uri));

  for (const alias of [
    'maplibre-style://sessions/s1/style',
    'maplibre-style://sessions/../~s1/style',
    'maplibre-style://sessions/%2e%2e/~s1/style',
    'maplibre-style://sessions/~s1/layers/../~roads',
    'maplibre-style://sessions/~s1/layers/%2E/~roads',
    'maplibre-style://sessions/~s1/layers/~%72oads',
    'maplibre-style://sessions/%2573%2531/style',
    'maplibre-style://sessions/~s1/style?alias=1',
    'maplibre-style://sessions/~s1/style#alias',
    'MAPLIBRE-STYLE://sessions/~s1/style',
  ]) {
    assert.throws(
      () => documentResourceUriAdmission.assertCanonical(alias),
      { code: 'INVALID_INPUT', details: { reason: 'nonCanonicalResourceUri' } },
    );
  }
});

test('resolver returns all current resource views and rejects visible unmarked aliases', async () => {
  const store = createStyleSessionStore({ idFactory: () => 's1' });
  await store.open(validStyle);
  const resolver = createResourceResolver(store, boundary);
  assert.equal(JSON.parse((await resolver.resolve(makeSessionUri('s1'))).contents[0]!.text).revision, 0);
  assert.equal(JSON.parse((await resolver.resolve(makeStyleUri('s1'))).contents[0]!.text).version, 8);
  assert.equal(JSON.parse((await resolver.resolve(makeContextUri('s1'))).contents[0]!.text).layerCount, 1);
  assert.equal(JSON.parse((await resolver.resolve(makeSourceUri('s1', 'source .'))).contents[0]!.text).source.type, 'vector');
  await assert.rejects(
    () => resolver.resolve(new URL('maplibre-style://sessions/s1/style')),
    { code: 'INVALID_INPUT', details: { reason: 'nonCanonicalResourceUri' } },
  );
});

test('revision diff uses exact post-state revision and rejects baseline before touching TTL', async () => {
  const clock = fakeClock();
  const store = createStyleSessionStore({
    clock, limits: { ttlMs: 100 }, idFactory: () => 'ttl-session',
  });
  const opened = await store.open(validStyle);
  await store.apply(opened.sessionId, { expectedRevision: 0, transaction: changeRoads });
  const resolver = createResourceResolver(store, boundary);
  const diff = JSON.parse((await resolver.resolve(makeDiffUri(opened.sessionId, 1))).contents[0]!.text);
  assert.equal(diff.revision, 1);
  assert.ok(diff.diff.length > 0);

  const untouchedClock = fakeClock();
  const untouched = createStyleSessionStore({
    clock: untouchedClock, limits: { ttlMs: 100 }, idFactory: () => 'baseline',
  });
  await untouched.open(validStyle);
  untouchedClock.value = 99;
  await assert.rejects(
    () => createResourceResolver(untouched, boundary).resolve(makeDiffUri('baseline', 0)),
    { code: 'INVALID_INPUT', details: { reason: 'baselineHasNoDiff' } },
  );
  untouchedClock.value = 101;
  await assert.rejects(() => untouched.read('baseline'), { code: 'NOT_FOUND' });
});

test('unknown layer and source resources fail without refreshing TTL', async () => {
  for (const makeMissing of [
    (sessionId: string) => makeLayerUri(sessionId, 'missing'),
    (sessionId: string) => makeSourceUri(sessionId, 'missing'),
  ]) {
    const clock = fakeClock();
    const store = createStyleSessionStore({ clock, limits: { ttlMs: 100 } });
    const opened = await store.open(validStyle);
    clock.value = 99;
    await assert.rejects(
      () => createResourceResolver(store, boundary).resolve(makeMissing(opened.sessionId)),
      { code: 'NOT_FOUND' },
    );
    clock.value = 101;
    await assert.rejects(() => store.read(opened.sessionId), { code: 'NOT_FOUND' });
  }
});

test('source resources require own data properties without reading inherited accessors', async () => {
  const clock = fakeClock();
  const store = createStyleSessionStore({
    clock, limits: { ttlMs: 100 }, idFactory: () => 'empty-sources',
  });
  await store.open({ version: 8, sources: {}, layers: [] });
  const resolver = createResourceResolver(store, boundary);
  const originalProto = Object.getOwnPropertyDescriptor(Object.prototype, '__proto__');
  if (originalProto === undefined || originalProto.get === undefined) {
    assert.fail('expected the built-in __proto__ accessor');
  }
  let inheritedGets = 0;
  try {
    Object.defineProperty(Object.prototype, '__proto__', {
      ...originalProto,
      get() {
        inheritedGets += 1;
        return originalProto.get?.call(this);
      },
    });
    clock.value = 99;
    for (const sourceId of ['toString', 'constructor', '__proto__']) {
      await assert.rejects(
        () => resolver.resolve(makeSourceUri('empty-sources', sourceId)),
        (error) => isStyleToolError(error)
          && error.code === 'NOT_FOUND'
          && error.details?.reason === 'sourceNotFound',
      );
    }
  } finally {
    Object.defineProperty(Object.prototype, '__proto__', originalProto);
  }
  assert.equal(inheritedGets, 0);
  clock.value = 101;
  await assert.rejects(() => store.read('empty-sources'), { code: 'NOT_FOUND' });
});

test('successful and over-budget resource projections update TTL only after completion', async () => {
  const successClock = fakeClock();
  const successStore = createStyleSessionStore({ clock: successClock, limits: { ttlMs: 100 } });
  const success = await successStore.open(validStyle);
  successClock.value = 99;
  await createResourceResolver(successStore, boundary).resolve(makeStyleUri(success.sessionId));
  successClock.value = 101;
  assert.equal((await successStore.read(success.sessionId)).revision, 0);

  const failedClock = fakeClock();
  const failedStore = createStyleSessionStore({ clock: failedClock, limits: { ttlMs: 100 } });
  const failed = await failedStore.open({
    ...validStyle,
    metadata: { private: 'private-style-value'.repeat(5_000) },
  });
  const smallBoundary = createMcpResponseBoundary(resolveMcpMessagePolicy({
    maxMessageBytes: MIN_MCP_MESSAGE_BYTES,
  }));
  failedClock.value = 99;
  await assert.rejects(
    () => createResourceResolver(failedStore, smallBoundary).resolve(makeStyleUri(failed.sessionId)),
    { code: 'INVALID_INPUT', details: { reason: 'responseTooLarge' } },
  );
  failedClock.value = 101;
  await assert.rejects(() => failedStore.read(failed.sessionId), { code: 'NOT_FOUND' });
});
