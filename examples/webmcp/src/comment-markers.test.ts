import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initialPendingCommentMarkerState,
  pendingCommentSummary,
  reducePendingCommentMarkerState,
} from './comment-markers.js';

test('provides a complete read-only pending comment summary', () => {
  assert.equal(pendingCommentSummary({
    selectionId: 'map-selection-1', comment: 'Inspect the lake.', scope: 'feature',
    feature: { layerId: 'places-fill', sourceId: 'places', featureId: 1, lngLat: [1, 2], properties: { class: 'water', name: 'Central Lake' } },
  }), '待处理评论 map-selection-1：Inspect the lake.；places-fill · Central Lake；图层 places-fill；数据源 places；范围 要素；要素 ID 1；位置 1, 2。');
});

test('keeps pins compact outside their interaction region and toggles persistent expansion', () => {
  let state = initialPendingCommentMarkerState();
  assert.equal(state.expanded, false);
  state = reducePendingCommentMarkerState(state, { type: 'enter' });
  assert.equal(state.expanded, true);
  state = reducePendingCommentMarkerState(state, { type: 'leave' });
  assert.equal(state.expanded, false);
  state = reducePendingCommentMarkerState(state, { type: 'activate' });
  assert.equal(state.expanded, true);
  state = reducePendingCommentMarkerState(state, { type: 'leave' });
  assert.equal(state.expanded, true);
  state = reducePendingCommentMarkerState(state, { type: 'activate' });
  assert.equal(state.expanded, false);
});
