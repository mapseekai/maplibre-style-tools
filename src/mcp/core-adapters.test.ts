import assert from 'node:assert/strict';
import test from 'node:test';

import type { StyleDocument } from '../core/types.js';
import {
  analyzeGeoJson,
  applyStyleTransaction,
  buildStyleContext,
  listSourceLayers,
  searchLayers,
  validateStyleDocument,
  type ValidationResult,
} from './core-adapters.js';

const validStyle: StyleDocument = { version: 8, sources: {}, layers: [] };
const searchableStyle: StyleDocument = {
  version: 8,
  sources: {
    streets: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] },
  },
  layers: [{
    id: 'roads',
    type: 'line',
    source: 'streets',
    'source-layer': 'road',
    paint: { 'line-color': '#000' },
  }],
};

test('validation adapter preserves existing result fields synchronously', () => {
  const result = validateStyleDocument(validStyle);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.style.version, 8);
  assert.ok(Array.isArray(result.errors));
  assert.ok(Array.isArray(result.warnings));

  // @ts-expect-error the pure validation boundary does not return a Promise
  const asyncResult: Promise<ValidationResult> = validateStyleDocument(validStyle);
  void asyncResult;
});

test('validateStyleDocument reports invalid documents synchronously', () => {
  const result = validateStyleDocument({ version: 7, layers: [] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test('transaction adapter passes op and exposes existing changed fields', () => {
  const result = applyStyleTransaction(searchableStyle, { operations: [{
    op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#fff' },
  }] });
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.changedLayers));
  assert.ok(Array.isArray(result.changedSources));
  assert.ok(Array.isArray(result.diff));

  // @ts-expect-error the transaction core remains synchronous
  const asyncResult: Promise<typeof result> = applyStyleTransaction(searchableStyle, {
    operations: [{ op: 'setLayerProperties', layerId: 'roads', paint: {} }],
  });
  void asyncResult;
});

test('analyzeGeoJson counts feature geometry types', () => {
  const result = analyzeGeoJson({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [1, 2] },
      properties: {},
    }],
  });
  assert.equal(result.ok, true);
  if (!result.ok || !result.analysis.available) assert.fail('expected available inline analysis');
  assert.deepEqual(result.analysis.geometryTypes, { Point: 1 });
});

test('context, search, and source-layer adapters preserve existing synchronous DTOs', () => {
  assert.equal(buildStyleContext(searchableStyle).layerCount, 1);
  assert.deepEqual(searchLayers(searchableStyle, { query: 'road' }).layers.map(({ id }) => id), [
    'roads',
  ]);
  assert.deepEqual(
    listSourceLayers(searchableStyle, { sourceId: 'streets' }).map((entry) => entry.sourceLayer),
    ['road'],
  );
});
