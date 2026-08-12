import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStyleOperations } from './style-operations.js';
import type { StyleDocument } from '../types.js';

const makeStyle = (): StyleDocument => ({
  version: 8,
  sources: {
    base: {
      type: 'vector',
      tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
    },
  },
  layers: [{
    id: 'roads',
    type: 'line',
    source: 'base',
    'source-layer': 'roads',
    paint: { 'line-color': '#000' },
  }],
});

test('legacy operations without op still apply through the shim', () => {
  const result = applyStyleOperations(makeStyle(), [{
    layerId: 'roads', paint: { 'line-color': '#fff' },
  }]);
  assert.equal(result.success, true);
  assert.equal(result.style.layers[0]?.paint?.['line-color'], '#fff');
  assert.deepEqual(result.diffSummary[0], {
    path: 'layers.roads.paint.line-color', before: '#000', after: '#fff',
  });
});

test('legacy filter remains supported without entering strict core StyleOperation', () => {
  const filtered = applyStyleOperations(makeStyle(), [{
    layerId: 'roads', filter: ['==', ['get', 'class'], 'primary'],
  }]);
  assert.equal(filtered.success, true);
  assert.deepEqual(filtered.style.layers[0]?.filter, ['==', ['get', 'class'], 'primary']);
  const cleared = applyStyleOperations(filtered.style, [{ layerId: 'roads', filter: null }]);
  assert.equal(cleared.success, true);
  assert.equal('filter' in cleared.style.layers[0]!, false);
});

test('legacy failure returns success false and the original style', () => {
  const style = makeStyle();
  const result = applyStyleOperations(style, [{
    layerId: 'missing', paint: { 'line-color': '#fff' },
  }]);
  assert.equal(result.success, false);
  assert.equal(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.diffSummary, []);
});

test('legacy empty operation batches retain their successful envelope', () => {
  const style = makeStyle();
  const result = applyStyleOperations(style, []);
  assert.equal(result.success, true);
  assert.equal(result.message, 'Applied 0 style operations.');
  assert.notEqual(result.style, style);
  assert.deepEqual(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.diffSummary, []);
});

test('legacy repeated writes preserve every sequential diff transition', () => {
  const result = applyStyleOperations(makeStyle(), [
    { layerId: 'roads', paint: { 'line-color': '#fff' } },
    { layerId: 'roads', paint: { 'line-color': '#00f' } },
  ]);
  assert.equal(result.success, true);
  assert.deepEqual(result.changedLayers, ['roads']);
  assert.deepEqual(result.diffSummary, [
    {
      path: 'layers.roads.paint.line-color',
      before: '#000',
      after: '#fff',
    },
    {
      path: 'layers.roads.paint.line-color',
      before: '#fff',
      after: '#00f',
    },
  ]);
});

test('legacy repeated writes remain changed when the final value reverts', () => {
  const result = applyStyleOperations(makeStyle(), [
    { layerId: 'roads', paint: { 'line-color': '#fff' } },
    { layerId: 'roads', paint: { 'line-color': '#000' } },
  ]);
  assert.equal(result.success, true);
  assert.deepEqual(result.changedLayers, ['roads']);
  assert.deepEqual(result.diffSummary, [
    {
      path: 'layers.roads.paint.line-color',
      before: '#000',
      after: '#fff',
    },
    {
      path: 'layers.roads.paint.line-color',
      before: '#fff',
      after: '#000',
    },
  ]);
});

test('legacy validation message identifies the first normalized failing property', () => {
  const style = makeStyle();
  const result = applyStyleOperations(style, [
    { layerId: 'roads', paint: { 'line-color': 42 } },
    { layerId: 'roads', paint: { 'fill-color': '#fff' } },
  ]);
  assert.equal(result.success, false);
  assert.equal(
    result.message,
    'Invalid paint properties for line layer "roads": line-color'
  );
  assert.equal(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.diffSummary, []);
});

test('legacy validation message preserves unusual ids and colon property names', () => {
  const style = makeStyle();
  style.layers[0]!.id = 'roads:west/[0]~.x';
  const result = applyStyleOperations(style, [{
    layerId: 'roads:west/[0]~.x',
    paint: { 'line-custom:state': 42 },
  }]);
  assert.equal(result.success, false);
  assert.equal(
    result.message,
    'Invalid paint properties for line layer "roads:west/[0]~.x": line-custom:state'
  );
  assert.equal(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.diffSummary, []);
});

test('legacy validation message preserves colon-space property names', () => {
  const style = makeStyle();
  style.layers[0]!.id = 'roads:west/[0]~.x';
  const result = applyStyleOperations(style, [{
    layerId: 'roads:west/[0]~.x',
    paint: { 'line-custom: state': 42 },
  }]);
  assert.equal(result.success, false);
  assert.equal(
    result.message,
    'Invalid paint properties for line layer "roads:west/[0]~.x": line-custom: state'
  );
  assert.equal(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.diffSummary, []);
});

test('legacy validation message preserves quoted property content', () => {
  const style = makeStyle();
  const result = applyStyleOperations(style, [{
    layerId: 'roads',
    paint: { 'line-custom: "state"\\west': 42 },
  }]);
  assert.equal(result.success, false);
  assert.equal(
    result.message,
    'Invalid paint properties for line layer "roads": line-custom: "state"\\west'
  );
  assert.equal(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.diffSummary, []);
});
