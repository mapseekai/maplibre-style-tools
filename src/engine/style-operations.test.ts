import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyStyleOperations } from './style-operations.js';
import type { StyleDocument, StyleOperation } from '../types.js';

const style: StyleDocument = {
  version: 8,
  sources: {
    basemap: {
      type: 'vector',
      tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
    },
  },
  layers: [
    {
      id: 'road-primary',
      type: 'line',
      source: 'basemap',
      'source-layer': 'roads',
      paint: { 'line-color': '#64748b', 'line-width': 1 },
    },
  ],
};

describe('style operations', () => {
  it('patches paint and layout and returns a compact diff', () => {
    const operations: StyleOperation[] = [
      {
        layerId: 'road-primary',
        paint: { 'line-color': '#38bdf8', 'line-width': 2 },
        layout: { visibility: 'visible' },
      },
    ];

    const result = applyStyleOperations(style, operations);

    assert.equal(result.success, true);
    assert.deepEqual(result.changedLayers, ['road-primary']);
    assert.deepEqual(result.diffSummary, [
      {
        path: 'layers.road-primary.paint.line-color',
        before: '#64748b',
        after: '#38bdf8',
      },
      { path: 'layers.road-primary.paint.line-width', before: 1, after: 2 },
      {
        path: 'layers.road-primary.layout.visibility',
        before: undefined,
        after: 'visible',
      },
    ]);
    assert.equal(result.style.layers[0]?.paint?.['line-color'], '#38bdf8');
    assert.equal(style.layers[0]?.paint?.['line-color'], '#64748b');
  });

  it('rejects invalid paint prefixes for the layer type', () => {
    const result = applyStyleOperations(style, [
      { layerId: 'road-primary', paint: { 'fill-color': '#fff' } },
    ]);

    assert.equal(result.success, false);
    assert.match(result.message, /Invalid paint properties/);
  });
});
