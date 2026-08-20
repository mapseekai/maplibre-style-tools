import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMcpResponseBoundary, resolveMcpMessagePolicy } from './message-boundary.js';
import { createStyleSessionStore } from './session-store.js';
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
