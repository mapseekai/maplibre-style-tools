import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStyleContext } from './context.js';
import type { JsonObject, JsonValue, StyleDocument } from './types.js';

const style: StyleDocument = {
  version: 8,
  sources: { basemap: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] } },
  layers: [
    { id: 'background', type: 'background', layout: { visibility: 'none' },
      paint: { 'background-color': '#000' } },
    { id: 'road-primary', type: 'line', source: 'basemap', 'source-layer': 'transportation' },
    { id: 'road-label', type: 'symbol', source: 'basemap', 'source-layer': 'transportation_name' },
    { id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water' },
  ],
};

test('buildStyleContext omits complete layer definitions', () => {
  const result = buildStyleContext(style, { selectedLayerId: 'road-primary' });
  assert.equal(result.layerCount, 4);
  assert.equal(result.sourceCount, 1);
  assert.equal(result.selectedLayerId, 'road-primary');
  assert.equal('paint' in result.layers[0]!, false);
  const first = result.layers[0];
  assert.ok(first);
  const visibility: JsonValue | undefined = first.visibility;
  const summaryObject: JsonObject = first;
  const summaryValue: JsonValue = first;
  const contextObject: JsonObject = result;
  assert.equal(visibility, 'none');
  assert.equal(Object.hasOwn(summaryObject, 'source'), false);
  assert.equal(Object.hasOwn(contextObject, 'activeSourceId'), false);
  void summaryValue;
});

test('buildStyleContext reports counts before applying layerLimit', () => {
  const result = buildStyleContext(style, { layerLimit: 1 });
  assert.equal(result.layerCount, 4);
  assert.equal(result.layers.length, 1);
  assert.deepEqual(result.layerTypes, { background: 1, line: 1, symbol: 1, fill: 1 });
});
