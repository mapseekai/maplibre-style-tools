import assert from 'node:assert/strict';
import test from 'node:test';

import { pendingCommentSummary } from './comment-markers.js';

test('provides a complete read-only pending comment summary', () => {
  assert.equal(pendingCommentSummary({
    selectionId: 'map-selection-1', comment: 'Inspect the lake.', scope: 'feature',
    feature: { layerId: 'places-fill', sourceId: 'places', featureId: 1, lngLat: [1, 2], properties: { class: 'water', name: 'Central Lake' } },
  }), 'Pending map comment map-selection-1: Inspect the lake.; places-fill · Central Lake; places-fill; places; feature; feature ID 1; location 1, 2.');
});
