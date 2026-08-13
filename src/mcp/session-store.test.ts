import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
  createStyleToolError,
  type StyleDocument,
} from '../core/index.js';
import * as publicMcpModule from './main.js';
import {
  DEFAULT_STYLE_SESSION_LIMITS,
  assertFactoryStyleSessionStore,
  createStyleSessionStore,
  createStyleSessionStoreWithDependencies,
  projectStyleSession,
  projectStyleSessionRevision,
  type FrozenSessionSnapshot,
} from './session-store.js';

const validStyle: StyleDocument = {
  version: 8,
  sources: {
    streets: {
      type: 'vector',
      tiles: ['https://example.test/{z}/{x}/{y}.pbf'],
    },
  },
  layers: [{
    id: 'roads',
    type: 'line',
    source: 'streets',
    'source-layer': 'road',
    paint: { 'line-color': '#000000' },
  }],
};

const differentValidStyle: StyleDocument = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background' }],
};

const changeRoads = {
  operations: [{
    op: 'setLayerProperties',
    layerId: 'roads',
    paint: { 'line-color': '#ffffff' },
  }],
};

const createFakeClock = () => {
  const clock = { value: 0, now: () => clock.value };
  return clock;
};

const sequentialIds = () => {
  let next = 0;
  return () => `session-${++next}`;
};

test('session defaults retain the core authorities and reject session 33', async () => {
  assert.equal(DEFAULT_STYLE_SESSION_LIMITS.maxSessions, 32);
  assert.equal(DEFAULT_STYLE_SESSION_LIMITS.maxStyleBytes, DEFAULT_MAX_STYLE_BYTES);
  assert.equal(DEFAULT_STYLE_SESSION_LIMITS.maxOperations, DEFAULT_MAX_OPERATIONS);
  assert.equal(DEFAULT_STYLE_SESSION_LIMITS.maxHistory, 20);
  assert.equal(DEFAULT_STYLE_SESSION_LIMITS.maxDiffBytes, DEFAULT_MAX_DIFF_BYTES);
  assert.equal(DEFAULT_STYLE_SESSION_LIMITS.ttlMs, 30 * 60_000);
  assert.equal(Object.isFrozen(DEFAULT_STYLE_SESSION_LIMITS), true);

  const store = createStyleSessionStore({ clock: createFakeClock(), idFactory: sequentialIds() });
  await Promise.all(Array.from({ length: 32 }, () => store.open(validStyle)));
  await assert.rejects(
    () => store.open(validStyle),
    { code: 'CONFLICT', details: { reason: 'maxSessions' } },
  );
  assert.equal(store.size, 32);
});

test('store expires after 30 minutes and successful accesses refresh idle TTL', async () => {
  const clock = createFakeClock();
  const store = createStyleSessionStore({ clock, idFactory: () => 'ttl-session' });
  const opened = await store.open(validStyle);
  clock.value = 29 * 60_000;
  await store.read(opened.sessionId);
  clock.value += 29 * 60_000;
  await store.readRevision(opened.sessionId, 0);
  clock.value += 29 * 60_000;
  await store.export(opened.sessionId);
  clock.value += 29 * 60_000;
  await store.apply(opened.sessionId, {
    expectedRevision: 0,
    dryRun: true,
    transaction: changeRoads,
  });
  clock.value += 29 * 60_000;
  assert.equal((await store.read(opened.sessionId)).revision, 0);

  clock.value += 30 * 60_000 + 1;
  await assert.rejects(
    () => store.read(opened.sessionId),
    { code: 'NOT_FOUND', details: { reason: 'expired' } },
  );
});

test('failed access does not refresh idle TTL', async () => {
  const clock = createFakeClock();
  const store = createStyleSessionStore({ clock, limits: { ttlMs: 100 } });
  const opened = await store.open(validStyle);
  clock.value = 99;
  await assert.rejects(
    () => store.apply(opened.sessionId, {
      expectedRevision: 99,
      transaction: changeRoads,
    }),
    { code: 'REVISION_CONFLICT' },
  );
  clock.value = 101;
  await assert.rejects(
    () => store.read(opened.sessionId),
    { code: 'NOT_FOUND', details: { reason: 'expired' } },
  );
});

test('open sweeps every expired session before enforcing maxSessions', async () => {
  const clock = createFakeClock();
  const store = createStyleSessionStore({ clock, idFactory: sequentialIds() });
  await Promise.all(Array.from({ length: 32 }, () => store.open(validStyle)));
  clock.value = 30 * 60_000 + 1;
  const opened = await store.open(validStyle);
  assert.equal(opened.revision, 0);
  assert.equal(store.size, 1);
});

test('open validates through core exactly once and stores only the sanitized style', async () => {
  const calls: unknown[][] = [];
  const sanitized: StyleDocument = { version: 8, sources: {}, layers: [] };
  const store = createStyleSessionStoreWithDependencies(
    { limits: { maxStyleBytes: 777 }, idFactory: () => 'validated' },
    {
      validateStyleDocument: (style, options) => {
        calls.push([style, options]);
        return { ok: true, style: sanitized, errors: [], warnings: [] };
      },
    },
  );
  await store.open(validStyle);
  assert.deepEqual(calls, [[validStyle, { maxStyleBytes: 777 }]]);
  assert.deepEqual((await store.export('validated')).style, sanitized);
});

test('invalid or oversized styles consume no session slot', async () => {
  const store = createStyleSessionStore({ limits: { maxStyleBytes: 128 } });
  await assert.rejects(
    () => store.open({
      version: 8,
      sources: {},
      layers: [{ id: 'bad', type: 'line', paint: { 'fill-color': '#fff' } }],
    }),
    { code: 'STYLE_INVALID' },
  );
  await assert.rejects(
    () => store.open({
      version: 8,
      sources: {},
      layers: [],
      metadata: { payload: 'x'.repeat(256) },
    }),
    (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, 'INVALID_INPUT');
      assert.equal(
        (error as { details?: { reason?: unknown } }).details?.reason,
        'maxStyleBytes',
      );
      return true;
    },
  );
  assert.equal(store.size, 0);
});

test('invalid resolved numeric limits fail before store allocation', () => {
  for (const limit of [
    'maxSessions',
    'maxStyleBytes',
    'maxOperations',
    'maxHistory',
    'maxDiffBytes',
    'ttlMs',
  ] as const) {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => createStyleSessionStore({ limits: { [limit]: value } }),
        { code: 'INVALID_INPUT', details: { reason: 'invalidLimit', limit } },
      );
    }
  }
});

test('generated IDs are scalar bounded URI components and collisions preserve the original', async () => {
  for (const invalidId of ['', 'x'.repeat(513), '😀'.repeat(129), '\uD800']) {
    const store = createStyleSessionStore({ idFactory: () => invalidId });
    await assert.rejects(
      () => store.open(validStyle),
      { code: 'INVALID_INPUT', details: { reason: 'invalidSessionId' } },
    );
    assert.equal(store.size, 0);
  }

  const store = createStyleSessionStore({ idFactory: () => 'same-id' });
  const first = await store.open(validStyle);
  await assert.rejects(
    () => store.open(differentValidStyle),
    { code: 'CONFLICT', details: { reason: 'sessionIdCollision' } },
  );
  assert.deepEqual((await store.export(first.sessionId)).style, validStyle);

  const clock = createFakeClock();
  const ttlStore = createStyleSessionStore({
    clock,
    limits: { ttlMs: 100 },
    idFactory: () => 'ttl-id',
  });
  await ttlStore.open(validStyle);
  clock.value = 99;
  await assert.rejects(
    () => ttlStore.open(differentValidStyle),
    { code: 'CONFLICT', details: { reason: 'sessionIdCollision' } },
  );
  clock.value = 101;
  await assert.rejects(
    () => ttlStore.read('ttl-id'),
    { code: 'NOT_FOUND', details: { reason: 'expired' } },
  );
});

test('open calls the ID factory once and propagates hostile generator throws without allocating', async () => {
  let calls = 0;
  const thrown = new Error('generator failed');
  const store = createStyleSessionStore({
    idFactory: () => {
      calls += 1;
      throw thrown;
    },
  });
  await assert.rejects(() => store.open(validStyle), (error: unknown) => error === thrown);
  assert.equal(calls, 1);
  assert.equal(store.size, 0);
});

test('expired IDs can be reused without an older queued close deleting the replacement', async () => {
  const clock = createFakeClock();
  let releaseClose!: () => void;
  const closeGate = new Promise<void>((resolve) => { releaseClose = resolve; });
  const store = createStyleSessionStoreWithDependencies(
    { clock, limits: { ttlMs: 100 }, idFactory: () => 'reused-id' },
    undefined,
    {
      queueScheduler: {
        beforeQueuedWork: ({ kind }) => kind === 'close' ? closeGate : Promise.resolve(),
      },
    },
  );
  await store.open(validStyle);
  const oldClose = store.close('reused-id');
  clock.value = 101;
  const replacement = await store.open(differentValidStyle);
  releaseClose();
  await oldClose.catch(() => undefined);
  const current = await store.export(replacement.sessionId);
  assert.equal(current.revision, 0);
  assert.deepEqual(current.style, differentValidStyle);
  assert.equal(store.size, 1);
});

test('factory capability and atomic projection preserve immutable stored state', async () => {
  const events: string[] = [];
  const store = createStyleSessionStoreWithDependencies(
    { idFactory: () => 'projection-session' },
    undefined,
    { observer: { onProjectionAttempt: () => events.push('project') } },
  );
  assert.strictEqual(assertFactoryStyleSessionStore(store), store);
  assert.throws(
    () => assertFactoryStyleSessionStore({}),
    { code: 'INVALID_INPUT', details: { reason: 'invalidStyleSessionStore' } },
  );
  const opened = await store.open(validStyle);
  await assert.rejects(
    () => projectStyleSession(store, opened.sessionId, async () => 'not allowed'),
    { code: 'INTERNAL', details: { reason: 'asyncSessionProjection' } },
  );
  const revision = await projectStyleSession(store, opened.sessionId, (snapshot) =>
    snapshot.style.withStyle((style) => {
      assert.throws(() => {
        (style.layers as unknown as { length: number }).length = 0;
      }, TypeError);
      return snapshot.revision;
    }));
  assert.equal(revision, 0);
  assert.deepEqual(events, ['project', 'project']);
  assert.equal((await store.read(opened.sessionId)).style.layers.length, validStyle.layers.length);
  assert.equal('projectStyleSession' in publicMcpModule, false);
});

test('projection refreshes TTL only after projector and output cloning succeed', async () => {
  const failedClock = createFakeClock();
  const failedStore = createStyleSessionStore({ clock: failedClock, limits: { ttlMs: 100 } });
  const failed = await failedStore.open(validStyle);
  failedClock.value = 99;
  await assert.rejects(
    () => projectStyleSession(failedStore, failed.sessionId, () => {
      throw createStyleToolError('NOT_FOUND', 'Layer was not found.', '/layers/missing');
    }),
    { code: 'NOT_FOUND' },
  );
  failedClock.value = 101;
  await assert.rejects(
    () => failedStore.read(failed.sessionId),
    { code: 'NOT_FOUND', details: { reason: 'expired' } },
  );

  const successClock = createFakeClock();
  const successStore = createStyleSessionStore({ clock: successClock, limits: { ttlMs: 100 } });
  const succeeded = await successStore.open(validStyle);
  successClock.value = 99;
  assert.equal(
    await projectStyleSession(successStore, succeeded.sessionId, (snapshot) => snapshot.revision),
    0,
  );
  successClock.value = 101;
  assert.equal((await successStore.read(succeeded.sessionId)).revision, 0);
});

test('current and retained revision projections use exact revision values', async () => {
  const store = createStyleSessionStore({ limits: { maxHistory: 2 } });
  const opened = await store.open(validStyle);
  await store.apply(opened.sessionId, { expectedRevision: 0, transaction: changeRoads });
  assert.equal(
    await projectStyleSessionRevision(store, opened.sessionId, undefined, (snapshot) => snapshot.revision),
    1,
  );
  assert.equal(
    await projectStyleSessionRevision(store, opened.sessionId, 0, (snapshot) => snapshot.revision),
    0,
  );
  await assert.rejects(
    () => projectStyleSessionRevision(store, opened.sessionId, 99, () => null),
    { code: 'NOT_FOUND', details: { reason: 'revisionEvicted' } },
  );
});

test('public snapshots and exports are detached frozen JSON projections', async () => {
  const store = createStyleSessionStore();
  const opened = await store.open(validStyle);
  const snapshot = await store.read(opened.sessionId);
  const exported = await store.export(opened.sessionId);
  const revision = await store.readRevision(opened.sessionId, 0);
  for (const style of [snapshot.style, exported.style, revision.style]) {
    assert.equal(Object.isFrozen(style), true);
    assert.equal(Object.isFrozen(style.layers), true);
    assert.throws(() => {
      (style.layers as unknown as { length: number }).length = 0;
    }, TypeError);
  }
  assert.equal((await store.read(opened.sessionId)).style.layers.length, validStyle.layers.length);
});

const assertFrozenSnapshotTypes = (snapshot: FrozenSessionSnapshot): void => {
  // @ts-expect-error the projection view forbids nested mutation
  snapshot.style.view.layers.length = 0;
};
void assertFrozenSnapshotTypes;
