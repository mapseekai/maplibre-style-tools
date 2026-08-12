import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStyleToolError } from './errors.js';
import { applyStyleTransaction, finalizeStyleReplacement } from './transaction.js';
import {
  DEFAULT_MAX_DIFF_BYTES, DEFAULT_MAX_OPERATIONS, DEFAULT_MAX_STYLE_BYTES,
} from './utf8.js';
import type {
  StyleDocument, StyleToolError, StyleTransaction, StyleTransactionOptions,
} from './types.js';

const makeStyle = (): StyleDocument => ({
  version: 8,
  sources: { base: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] } },
  layers: [{ id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads',
    paint: { 'line-color': '#000' } }],
});

test('applyStyleTransaction is immutable and applies operations in order', () => {
  const style = makeStyle();
  const result = applyStyleTransaction(style, { operations: [
    { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#f00' } },
    { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#00f' } },
  ] });
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, 'error'), false);
  assert.equal(result.style.layers[0]?.paint?.['line-color'], '#00f');
  assert.equal(style.layers[0]?.paint?.['line-color'], '#000');
  assert.deepEqual(result.changedLayers, ['roads']);
  assert.deepEqual(result.diff.map(({ op, path, target }) => ({ op, path, target })), [{
    op: 'replace', path: '/layers/0/paint/line-color',
    target: { kind: 'layer', id: 'roads' },
  }]);
});

test('finalizeStyleReplacement owns whole-document validation and diff semantics', () => {
  const style = makeStyle();
  const replacement = structuredClone(style);
  replacement.layers[0]!.paint!['line-color'] = '#fff';
  const result = finalizeStyleReplacement(style, replacement);
  assert.equal(result.ok, true);
  assert.deepEqual(result.changedLayers, ['roads']);
  assert.deepEqual(result.diff[0]?.target, { kind: 'layer', id: 'roads' });
  const invalid = finalizeStyleReplacement(style, { version: 7, sources: {}, layers: [] });
  assert.equal(invalid.ok, false);
  assert.strictEqual(invalid.style, style);
  assert.deepEqual(invalid.diff, []);
});

test('applyStyleTransaction emits parent-container diffs that replay exactly', () => {
  const style = makeStyle();
  const added = applyStyleTransaction(style, { operations: [{
    op: 'setLayerProperties', layerId: 'roads', layout: { visibility: 'none' },
  }] });
  assert.deepEqual(added.diff, [{
    op: 'add', path: '/layers/0/layout', after: { visibility: 'none' },
    target: { kind: 'layer', id: 'roads' },
  }]);
  const removed = applyStyleTransaction(added.style, { operations: [{
    op: 'setLayerProperties', layerId: 'roads', layout: { visibility: null },
  }] });
  assert.equal(removed.diff[0]?.path, '/layers/0/layout');
  assert.equal(removed.diff[0]?.op, 'remove');
});

test('applyStyleTransaction rolls back after a later operation fails', () => {
  const style = makeStyle();
  const result = applyStyleTransaction(style, { operations: [
    { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#fff' } },
    { op: 'setLayerProperties', layerId: 'missing', paint: { 'line-color': '#000' } },
  ] });
  assert.equal(result.ok, false);
  assert.equal(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, []);
  if (result.ok) assert.fail('expected transaction failure');
  assert.equal(Object.hasOwn(result, 'error'), true);
  const error: StyleToolError = result.error;
  assert.equal(error.code, 'NOT_FOUND');
  assert.equal(isStyleToolError(error), true);
});

test('applyStyleTransaction rolls back on final style validation failure', () => {
  const style = makeStyle();
  const result = applyStyleTransaction(style, { operations: [{
    op: 'setLayerProperties', layerId: 'roads', paint: { 'fill-color': '#fff' },
  }] });
  assert.equal(result.ok, false);
  assert.equal(result.style, style);
  assert.equal(result.error?.code, 'STYLE_INVALID');
  assert.deepEqual(result.diff, []);
});

test('applyStyleTransaction reports a successful no-op with empty changes', () => {
  const style = makeStyle();
  const result = applyStyleTransaction(style, { operations: [{
    op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#000' },
  }] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, []);
});

test('structurally equal expression and metadata replacements are no-ops', () => {
  const style = makeStyle();
  style.layers[0]!.paint!['line-pattern'] = ['get', 'pattern'];
  style.layers[0]!.metadata = { owner: 'maps' };
  const result = applyStyleTransaction(style, { operations: [{
    op: 'setLayerProperties', layerId: 'roads',
    paint: { 'line-pattern': ['get', 'pattern'] }, metadata: { owner: 'maps' },
  }] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.diff, []);
});

test('applyStyleTransaction rejects a legacy operation as INVALID_INPUT', () => {
  const style = makeStyle();
  const legacy = { operations: [{ layerId: 'roads', paint: {} }] } as unknown as StyleTransaction;
  const result = applyStyleTransaction(style, legacy);
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'INVALID_INPUT');
  assert.equal(result.style, style);
});

test('the sole transaction boundary enforces default and overridden operation limits', () => {
  const style = makeStyle();
  const operations = Array.from({ length: DEFAULT_MAX_OPERATIONS + 1 }, (_, index) => ({
    op: 'setLayerProperties' as const,
    layerId: 'roads',
    paint: { 'line-width': index + 1 },
  }));
  const rejected = applyStyleTransaction(style, { operations });
  assert.equal(rejected.ok, false);
  assert.strictEqual(rejected.style, style);
  assert.deepEqual(rejected.diff, []);
  assert.equal(rejected.error?.code, 'INVALID_INPUT');
  assert.equal(rejected.error?.path, '/operations');
  assert.deepEqual(rejected.error?.details, {
    reason: 'maxOperations',
    maxOperations: DEFAULT_MAX_OPERATIONS,
    actualOperations: DEFAULT_MAX_OPERATIONS + 1,
  });

  const accepted = applyStyleTransaction(style, { operations }, {
    maxOperations: DEFAULT_MAX_OPERATIONS + 1,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.style.layers[0]?.paint?.['line-width'], DEFAULT_MAX_OPERATIONS + 1);
});

test('resolves each transaction option once before dispatch', () => {
  const reads = { maxStyleBytes: 0, maxDiffBytes: 0, maxOperations: 0 };
  const options = Object.defineProperties({}, {
    maxStyleBytes: { get: () => { reads.maxStyleBytes += 1; return DEFAULT_MAX_STYLE_BYTES; } },
    maxDiffBytes: { get: () => { reads.maxDiffBytes += 1; return DEFAULT_MAX_DIFF_BYTES; } },
    maxOperations: { get: () => { reads.maxOperations += 1; return 2; } },
  }) as StyleTransactionOptions;
  const result = applyStyleTransaction(makeStyle(), { operations: [
    { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 1 } },
    { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2 } },
  ] }, options);
  assert.equal(result.ok, true);
  assert.deepEqual(reads, { maxStyleBytes: 1, maxDiffBytes: 1, maxOperations: 1 });
});

test('candidate Style size is enforced even when Style Spec validation is disabled', () => {
  const style = makeStyle();
  const result = applyStyleTransaction(style, {
    validate: false,
    operations: [{
      op: 'setLayerProperties', layerId: 'roads',
      metadata: { padding: 'a'.repeat(DEFAULT_MAX_STYLE_BYTES) },
    }],
  });
  assert.equal(result.ok, false);
  assert.strictEqual(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.diff, []);
  assert.equal(result.error?.code, 'INVALID_INPUT');
  assert.equal(result.error?.path, '');
  assert.equal(result.error?.details?.reason, 'maxStyleBytes');
  assert.equal(result.error?.details?.maxBytes, DEFAULT_MAX_STYLE_BYTES);
});

test('oversized deterministic diff rolls back with a stable maxDiffBytes error', () => {
  const style = makeStyle();
  const result = applyStyleTransaction(style, { operations: [{
    op: 'setLayerProperties', layerId: 'roads',
    metadata: { padding: 'a'.repeat(DEFAULT_MAX_DIFF_BYTES) },
  }] });
  assert.equal(result.ok, false);
  assert.strictEqual(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, []);
  assert.equal(result.error?.code, 'INVALID_INPUT');
  assert.equal(result.error?.path, '/diff');
  assert.equal(result.error?.details?.reason, 'maxDiffBytes');
  assert.equal(result.error?.details?.maxBytes, DEFAULT_MAX_DIFF_BYTES);
  assert.equal(Number(result.error?.details?.actualBytes) > DEFAULT_MAX_DIFF_BYTES, true);
});

test('whole-document finalization shares the same overridable diff limit', () => {
  const style = makeStyle();
  const replacement = structuredClone(style);
  replacement.layers[0]!.metadata = { owner: 'maps' };
  const rejected = finalizeStyleReplacement(style, replacement, { maxDiffBytes: 1 });
  assert.equal(rejected.ok, false);
  assert.strictEqual(rejected.style, style);
  assert.equal(rejected.error?.details?.reason, 'maxDiffBytes');
  assert.deepEqual(rejected.diff, []);
  const accepted = finalizeStyleReplacement(style, replacement, { maxDiffBytes: 1024 });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.changedLayers, ['roads']);
});
