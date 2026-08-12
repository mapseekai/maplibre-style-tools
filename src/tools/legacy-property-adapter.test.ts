import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Map } from 'maplibre-gl';
import type { StyleDocument } from '../types.js';
import { applyLegacyPropertyOperationToMap } from './legacy-property-adapter.js';

const style: StyleDocument = {
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
};

test('property adapter applies one validated style diff', () => {
  const calls: unknown[][] = [];
  const map = {
    getStyle: () => structuredClone(style),
    setStyle: (...args: unknown[]) => { calls.push(args); },
  } as unknown as Map;
  const result = applyLegacyPropertyOperationToMap(map, {
    layerId: 'roads', paint: { 'line-color': '#fff' },
  });
  assert.equal(result.success, true);
  assert.equal(result.style.layers[0]?.paint?.['line-color'], '#fff');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.[1], { diff: true });
});

test('property adapter does not call setStyle after validation failure', () => {
  let calls = 0;
  const map = {
    getStyle: () => structuredClone(style),
    setStyle: () => { calls += 1; },
  } as unknown as Map;
  const result = applyLegacyPropertyOperationToMap(map, {
    layerId: 'roads', paint: { 'fill-color': '#fff' },
  });
  assert.equal(result.success, false);
  assert.equal(calls, 0);
});

test('property adapter honors an explicit diff false option', () => {
  const calls: unknown[][] = [];
  const map = {
    getStyle: () => structuredClone(style),
    setStyle: (...args: unknown[]) => { calls.push(args); },
  } as unknown as Map;
  applyLegacyPropertyOperationToMap(map, {
    layerId: 'roads', paint: { 'line-color': '#fff' },
  }, false);
  assert.deepEqual(calls[0]?.[1], { diff: false });
});

test('property adapter returns a successful no-op without setting style', () => {
  let calls = 0;
  const map = {
    getStyle: () => structuredClone(style),
    setStyle: () => { calls += 1; },
  } as unknown as Map;
  const result = applyLegacyPropertyOperationToMap(map, {
    layerId: 'roads', paint: { 'line-color': '#000' },
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.diffSummary, []);
  assert.equal(calls, 0);
});

test('property adapter does not set style for a structurally equal filter', () => {
  let calls = 0;
  const filteredStyle = structuredClone(style);
  filteredStyle.layers[0]!.filter = ['==', ['get', 'class'], 'primary'];
  const map = {
    getStyle: () => structuredClone(filteredStyle),
    setStyle: () => { calls += 1; },
  } as unknown as Map;
  const result = applyLegacyPropertyOperationToMap(map, {
    layerId: 'roads',
    filter: ['==', ['get', 'class'], 'primary'],
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.diffSummary, []);
  assert.equal(calls, 0);
});

test('property adapter does not set style when clearing an absent filter', () => {
  let calls = 0;
  const map = {
    getStyle: () => structuredClone(style),
    setStyle: () => { calls += 1; },
  } as unknown as Map;
  const result = applyLegacyPropertyOperationToMap(map, {
    layerId: 'roads',
    filter: null,
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.diffSummary, []);
  assert.equal(calls, 0);
});

test('property adapter normalizes an invalid current style', () => {
  let calls = 0;
  const map = {
    getStyle: () => undefined,
    setStyle: () => { calls += 1; },
  } as unknown as Map;
  const result = applyLegacyPropertyOperationToMap(map, {
    layerId: 'roads', paint: { 'line-color': '#fff' },
  });
  assert.equal(result.success, false);
  assert.equal(result.message.length > 0, true);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.diffSummary, []);
  assert.equal(calls, 0);
});

test('property adapter normalizes synchronous setStyle exceptions', () => {
  const map = {
    getStyle: () => structuredClone(style),
    setStyle: () => { throw new Error('style rejected by map'); },
  } as unknown as Map;
  const result = applyLegacyPropertyOperationToMap(map, {
    layerId: 'roads', paint: { 'line-color': '#fff' },
  });
  assert.equal(result.success, false);
  assert.equal(result.message, 'style rejected by map');
  assert.deepEqual(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.diffSummary, []);
});
