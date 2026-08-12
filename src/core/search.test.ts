import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchLayers } from './search.js';
import type { JsonObject, JsonValue, StyleDocument } from './types.js';

const style: StyleDocument = {
  version: 8,
  sources: { basemap: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] } },
  layers: [
    { id: 'road-primary', type: 'line', source: 'basemap', 'source-layer': 'Transportation' },
    { id: 'road-label', type: 'symbol', source: 'basemap', 'source-layer': 'transportation_name' },
  ],
};

test('searchLayers matches id type source and source-layer case-insensitively', () => {
  const result = searchLayers(style, { query: 'ROAD' });
  const resultObject: JsonObject = result;
  const resultValue: JsonValue = result;
  assert.deepEqual(result.layers.map(({ id }) => id), ['road-primary', 'road-label']);
  assert.deepEqual(searchLayers(style, { sourceLayer: 'transportation' }).layers.map(({ id }) => id),
    ['road-primary', 'road-label']);
  assert.equal(searchLayers(style, { type: 'line', source: 'basemap' }).total, 1);
  const first = result.layers[0];
  assert.ok(first);
  assert.equal(Object.hasOwn(first, 'minzoom'), false);
  void resultValue;
  void resultObject;
});

test('searchLayers reports total before applying limit', () => {
  const result = searchLayers(style, { query: 'road', limit: 1 });
  assert.equal(result.total, 2);
  assert.deepEqual(result.layers.map(({ id }) => id), ['road-primary']);
});
