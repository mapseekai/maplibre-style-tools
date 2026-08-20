import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StyleDocument } from '../core/index.js';
import { createFileStyleAuthority } from './file-authority.js';

describe('createFileStyleAuthority', () => {
  it('validates its loaded style and applies transactions in memory', () => {
    const authority = createFileStyleAuthority({
      version: 8,
      sources: { roads: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] } },
      layers: [{ id: 'road', type: 'line', source: 'roads', 'source-layer': 'roads' }],
    });

    assert.equal(authority.readStyle().ok, true);
    const result = authority.applyTransaction({
      operations: [{ op: 'setLayerProperties', layerId: 'road', paint: { 'line-color': '#fff' } }],
    }, { diff: true });
    assert.equal(result.ok, true);
    if (!result.ok) assert.fail('expected transaction to succeed');
    assert.deepEqual(result.changedLayers, ['road']);
    assert.equal(result.styleAuthority, 'current');
    const current = authority.readStyle();
    assert.equal(current.ok, true);
    if (!current.ok) assert.fail('expected valid style');
    assert.equal(current.style.layers[0]?.paint?.['line-color'], '#fff');
  });

  it('rejects invalid loaded and replacement styles', () => {
    const invalid = createFileStyleAuthority({ version: 7, sources: {}, layers: [] });
    assert.equal(invalid.readStyle().ok, false);

    const authority = createFileStyleAuthority({ version: 8, sources: {}, layers: [] });
    const result = authority.applyDocument(
      { version: 7, sources: {}, layers: [] } as unknown as StyleDocument,
      { diff: true },
    );
    assert.equal(result.ok, false);
  });
});
