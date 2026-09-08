import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMcpResponseBoundary, resolveMcpMessagePolicy } from './message-boundary.js';
import { capabilityRegistry } from '../capabilities/registry.js';
import { SessionStyleAuthority } from './session-authority.js';
import { createStyleSessionStore, createStyleSessionStoreWithDependencies } from './session-store.js';
import { createMcpToolHandlers } from './tool-handlers.js';

const style = {
  version: 8,
  sources: { points: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
  layers: [{ id: 'roads', type: 'line', source: 'points' }],
};

test('MCP session capability lifecycle commits and detects revision conflicts', async () => {
  const handlers = createMcpToolHandlers(
    createStyleSessionStore({ idFactory: () => 'session-1' }),
    createMcpResponseBoundary(resolveMcpMessagePolicy()),
  );
  await handlers.openStyleSession({ style });
  const sessionId = 'session-1';
  const inspected = await handlers.inspectStyle({
    target: { kind: 'session', sessionId }, input: { action: 'listLayers' },
  });
  assert.equal(inspected.content[0]?.type, 'text');
  assert.deepEqual(JSON.parse(inspected.content[0].text), inspected.structuredContent);
  const applied = await handlers.applyStyleTransaction({
    target: { kind: 'session', sessionId, expectedRevision: 0 },
    input: { transaction: { operations: [{ op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2 } }] } },
  });
  assert.equal(applied.content[0]?.type, 'text');
  assert.equal(applied.structuredContent.success, true);
  if (applied.structuredContent.success) {
    assert.equal((applied.structuredContent.data as { revision?: unknown }).revision, 1);
    assert.deepEqual((applied.structuredContent.data as { changedLayers?: unknown }).changedLayers, ['roads']);
  }
  const conflict = await handlers.applyStyleTransaction({
    target: { kind: 'session', sessionId, expectedRevision: 0 },
    input: { transaction: { operations: [{ op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 4 } }] } },
  });
  assert.equal(conflict.isError, true);
  assert.equal(conflict.structuredContent.success, false);
  if (!conflict.structuredContent.success) {
    assert.equal(conflict.structuredContent.error.code, 'REVISION_CONFLICT');
  }
  const exported = await handlers.exportStyleSession({ sessionId });
  assert.equal(exported.content[0]?.type, 'text');
  assert.equal(exported.structuredContent.success, true);
  if (exported.structuredContent.success) {
    const data = exported.structuredContent.data as { style?: { layers?: { paint?: object }[] } };
    assert.deepEqual(data.style?.layers?.[0]?.paint, { 'line-width': 2 });
  }
});

test('a cancelled request aborts before any session mutation', async () => {
  const handlers = createMcpToolHandlers(
    createStyleSessionStore({ idFactory: () => 'session-1' }),
    createMcpResponseBoundary(resolveMcpMessagePolicy()),
  );
  await handlers.openStyleSession({ style });
  const controller = new AbortController();
  controller.abort();
  const aborted = await handlers.applyStyleTransaction({
    target: { kind: 'session', sessionId: 'session-1' },
    input: { transaction: { operations: [{ op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 9 } }] } },
  }, controller.signal);
  assert.equal(aborted.isError, true);
  assert.equal(aborted.structuredContent.success, false);
  if (!aborted.structuredContent.success) {
    assert.equal(aborted.structuredContent.error.code, 'TIMEOUT');
    assert.deepEqual(aborted.structuredContent.error.details, { reason: 'aborted' });
  }
  const exported = await handlers.exportStyleSession({ sessionId: 'session-1' });
  assert.equal(exported.structuredContent.success, true);
  if (exported.structuredContent.success) {
    assert.equal((exported.structuredContent.data as { revision?: unknown }).revision, 0);
  }
});

for (const name of ['applyStyleTransaction', 'applyStyleDocument'] as const) {
  test(`${name} rejects an oversized receipt before committing`, async () => {
    const store = createStyleSessionStore();
    try {
      const { sessionId } = await store.open(style);
      const handlers = createMcpToolHandlers(store, createMcpResponseBoundary(
        resolveMcpMessagePolicy({ maxMessageBytes: 128 * 1024 }),
      ));
      const metadata = { note: 'x'.repeat(40_000) };
      const response = await handlers[name]({
        target: { kind: 'session', sessionId, expectedRevision: 0 },
        input: name === 'applyStyleTransaction'
          ? { transaction: { operations: [{ op: 'setStyleRootProperties', properties: { metadata } }] } }
          : { source: { kind: 'style', style: { ...style, metadata } } },
      });
      assert.equal(response.structuredContent.success, false);
      if (!response.structuredContent.success) {
        assert.equal(response.structuredContent.error.details?.reason, 'responseTooLarge');
      }
      const snapshot = await store.read(sessionId);
      assert.equal(snapshot.revision, 0);
      assert.deepEqual(snapshot.style, style);
      assert.deepEqual(snapshot.history, []);
    } finally { store.dispose(); }
  });

  test(`${name} receipts retain their own revision under concurrent commits`, async () => {
    const store = createStyleSessionStore();
    try {
      const { sessionId } = await store.open(style);
      const handlers = createMcpToolHandlers(store, createMcpResponseBoundary(resolveMcpMessagePolicy()));
      const request = (expectedRevision: number, title: string) => ({
        target: { kind: 'session', sessionId, expectedRevision },
        input: name === 'applyStyleTransaction'
          ? { transaction: { operations: [{ op: 'setStyleRootProperties', properties: { name: title } }] } }
          : { source: { kind: 'style', style: { ...style, name: title } } },
      });
      const responses = await Promise.all([
        handlers[name](request(0, 'first')),
        handlers[name](request(1, 'second')),
      ]);
      assert.deepEqual(responses.map(({ structuredContent }) => {
        assert.equal(structuredContent.success, true);
        return structuredContent.success ? (structuredContent.data as { revision: number }).revision : undefined;
      }), [1, 2]);
    } finally { store.dispose(); }
  });

  test(`${name} does not queue another session access after committing`, async () => {
    const queued: string[] = [];
    const store = createStyleSessionStoreWithDependencies({}, {}, {
      queueScheduler: { beforeQueuedWork: async ({ kind }) => { queued.push(kind); } },
    });
    try {
      const { sessionId } = await store.open(style);
      const handlers = createMcpToolHandlers(store, createMcpResponseBoundary(resolveMcpMessagePolicy()));
      const response = await handlers[name]({
        target: { kind: 'session', sessionId, expectedRevision: 0 },
        input: name === 'applyStyleTransaction'
          ? { transaction: { operations: [{ op: 'setStyleRootProperties', properties: { name: 'changed' } }] } }
          : { source: { kind: 'style', style: { ...style, name: 'changed' } } },
      });
      assert.equal(response.structuredContent.success, true);
      assert.deepEqual(queued, ['read', 'apply']);
    } finally { store.dispose(); }
  });
}

test('MCP session receipts preserve capability projection for diff, no-op and dry-run inputs', async () => {
  const transaction = { operations: [{ op: 'setStyleRootProperties', properties: { name: 'changed' } }] };
  const cases = [
    { name: 'applyStyleTransaction', input: { transaction }, revision: 1 },
    { name: 'applyStyleTransaction', input: { transaction, diff: false }, revision: 1 },
    { name: 'applyStyleTransaction', input: { transaction, dryRun: true }, revision: 0 },
    { name: 'applyStyleTransaction', input: { transaction: { operations: [] } }, revision: 0 },
    { name: 'applyStyleDocument', input: { source: { kind: 'style', style }, diff: false }, revision: 1 },
  ] as const;
  for (const { name, input, revision } of cases) {
    const store = createStyleSessionStore();
    try {
      const actualSession = await store.open(style);
      const referenceSession = await store.open(style);
      const snapshot = await store.read(referenceSession.sessionId);
      const reference = await capabilityRegistry[name].execute(
        () => new SessionStyleAuthority(store, referenceSession.sessionId, 0, snapshot.style), input,
      );
      assert.equal(reference.success, true);
      const handlers = createMcpToolHandlers(store, createMcpResponseBoundary(resolveMcpMessagePolicy()));
      const actual = await handlers[name]({ target: { kind: 'session', sessionId: actualSession.sessionId }, input });
      assert.deepEqual(actual.structuredContent, reference.success
        ? { ...reference, data: { ...reference.data, revision } }
        : reference);
      assert.equal((await store.read(actualSession.sessionId)).revision, revision);
    } finally { store.dispose(); }
  }
});
