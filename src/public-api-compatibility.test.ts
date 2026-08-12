import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCompactMapLibreStyleTools,
  createMapLibreStyleTools,
} from './index.js';

test('keeps the existing full and compact tool-name surfaces', () => {
  const full = createMapLibreStyleTools({ getMap: () => null });
  assert.equal(Object.keys(full).length, 53);
  for (const name of [
    'setLayerPaintProperty', 'setLayerLayoutProperty',
    'setLayerPaintPropertySmart', 'setLayerLayoutPropertySmart',
    'batchSetLayerPaintPropertiesSmart', 'batchSetLayerLayoutPropertiesSmart',
    'batchSetLayerPaintProperties', 'batchSetLayerLayoutProperties',
    'clearLayerPaintProperty', 'clearLayerLayoutProperty', 'setLayerFilter',
    'setLayerZoomRange', 'setLayerVisibility', 'validateStyleJson',
    'validateCurrentMapStyle',
  ]) assert.equal(name in full, true, name);

  const compact = createCompactMapLibreStyleTools({ getMap: () => null });
  assert.deepEqual(Object.keys(compact), [
    'getStyleContext', 'searchLayers', 'inspectLayersCompact',
    'applyStyleOperations', 'validateStylePatchJson',
  ]);
});
