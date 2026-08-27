import assert from 'node:assert/strict';
import test from 'node:test';

import { pendingCommentSummary } from './comment-markers.js';

test('provides a complete read-only pending comment summary', () => {
  assert.equal(pendingCommentSummary({
    selectionId: 'map-selection-1', comment: 'Inspect the lake.', scope: 'property-class',
    feature: { layerId: 'places-fill', sourceId: 'places', lngLat: [1, 2], properties: { class: 'water' } },
    selector: { property: 'class', value: 'water' },
  }), 'Pending map comment map-selection-1: Inspect the lake.; places-fill; places; property-class; selector class = water; location 1, 2.');
});
