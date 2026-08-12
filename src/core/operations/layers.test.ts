import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySetLayerProperties } from './layers.js';
import {
  DEFAULT_MAX_DIFF_BYTES, DEFAULT_MAX_OPERATIONS, DEFAULT_MAX_STYLE_BYTES,
} from '../utf8.js';
import type {
  CoreExecutionLimits, OperationContext, StyleDocument,
} from '../types.js';

const DEFAULT_TEST_LIMITS: Readonly<CoreExecutionLimits> = {
  maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
  maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
  maxOperations: DEFAULT_MAX_OPERATIONS,
};

const original: StyleDocument = {
  version: 8,
  sources: { base: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] } },
  layers: [{ id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads',
    paint: { 'line-color': '#000', 'line-width': 2 }, metadata: { owner: 'maps' } }],
};

test('setLayerProperties replaces and adds properties with RFC 6901 paths', () => {
  const working = structuredClone(original);
  const context: OperationContext = {
    limits: DEFAULT_TEST_LIMITS,
    changedLayerIds: new Set(), changedSourceIds: new Set(), warnings: [],
  };
  const result = applySetLayerProperties(working, {
    op: 'setLayerProperties', layerId: 'roads',
    paint: { 'line-color': '#fff' }, layout: { visibility: 'none' }, minzoom: 4,
  }, context);
  assert.deepEqual(result, { ok: true, changed: true });
  assert.equal(working.layers[0]?.paint?.['line-color'], '#fff');
  assert.equal(working.layers[0]?.layout?.visibility, 'none');
  assert.deepEqual([...context.changedLayerIds], ['roads']);
  assert.deepEqual([...context.changedSourceIds], []);
  assert.strictEqual(context.limits, DEFAULT_TEST_LIMITS);
  assert.equal(original.layers[0]?.paint?.['line-color'], '#000');
});

test('setLayerProperties null removes properties and whole metadata', () => {
  const working = structuredClone(original);
  const context: OperationContext = {
    limits: DEFAULT_TEST_LIMITS,
    changedLayerIds: new Set(), changedSourceIds: new Set(), warnings: [],
  };
  applySetLayerProperties(working, {
    op: 'setLayerProperties', layerId: 'roads',
    paint: { 'line-width': null }, metadata: null,
  }, context);
  assert.equal('line-width' in (working.layers[0]?.paint ?? {}), false);
  assert.equal('metadata' in working.layers[0]!, false);
  assert.deepEqual([...context.changedLayerIds], ['roads']);
});

test('setLayerProperties returns NOT_FOUND for an unknown layer', () => {
  const result = applySetLayerProperties(structuredClone(original), {
    op: 'setLayerProperties', layerId: 'missing', paint: { 'line-color': '#fff' },
  }, {
    limits: DEFAULT_TEST_LIMITS,
    changedLayerIds: new Set(), changedSourceIds: new Set(), warnings: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'NOT_FOUND');
});
