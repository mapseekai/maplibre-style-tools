import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStyleContext, searchLayers } from './style-context.js';
import type { StyleDocument } from '../core/types.js';

const style: StyleDocument = {
  version: 8,
  sources: {
    basemap: { type: 'vector', url: 'https://example.com/tiles.json' },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#0f172a' },
    },
    {
      id: 'road-primary',
      type: 'line',
      source: 'basemap',
      'source-layer': 'transportation',
      paint: { 'line-color': '#64748b' },
    },
    {
      id: 'road-label',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'transportation_name',
      layout: { 'text-field': ['get', 'name'] },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'water',
      paint: { 'fill-color': '#38bdf8' },
    },
  ],
};

describe('style context', () => {
  it('builds a compact summary without returning full layer definitions', () => {
    const context = buildStyleContext(style, {
      activeSourceId: 'default',
      selectedLayerId: 'road-primary',
    });

    assert.equal(context.layerCount, 4);
    assert.equal(context.sourceCount, 1);
    assert.equal(context.activeSourceId, 'default');
    assert.equal(context.selectedLayerId, 'road-primary');
    assert.deepEqual(context.layerTypes, {
      background: 1,
      line: 1,
      symbol: 1,
      fill: 1,
    });
    assert.equal(context.layers[1]?.id, 'road-primary');
    assert.equal('paint' in context.layers[1]!, false);
  });

  it('finds layers by semantic road intent and source layer text', () => {
    const result = searchLayers(style, { query: 'road' });

    assert.deepEqual(
      result.layers.map((layer) => layer.id),
      ['road-primary', 'road-label']
    );
  });
});
