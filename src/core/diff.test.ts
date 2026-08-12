import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffStyleDocuments, jsonValuesEqual, replayStyleDiff } from './diff.js';
import {
  DEFAULT_MAX_DIFF_BYTES, DEFAULT_MAX_OPERATIONS, DEFAULT_MAX_STYLE_BYTES,
} from './utf8.js';
import type { CoreExecutionLimits, OperationContext, StyleDocument } from './types.js';

const DEFAULT_TEST_LIMITS: Readonly<CoreExecutionLimits> = {
  maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
  maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
  maxOperations: DEFAULT_MAX_OPERATIONS,
};

const styleWithLayers = (ids: string[]): StyleDocument => ({
  version: 8,
  sources: {},
  layers: ids.map((id) => ({ id, type: 'background' })),
});

const contextWith = (
  changedLayerIds: string[] = [],
  changedSourceIds: string[] = [],
): OperationContext => ({
  limits: DEFAULT_TEST_LIMITS,
  changedLayerIds: new Set(changedLayerIds),
  changedSourceIds: new Set(changedSourceIds),
  warnings: [],
});

test('uses structural JSON equality rather than object identity', () => {
  assert.equal(jsonValuesEqual(['get', 'class'], ['get', 'class']), true);
  assert.equal(jsonValuesEqual({ owner: 'maps' }, { owner: 'maps' }), true);
  assert.equal(jsonValuesEqual({ a: 1, z: 2 }, { z: 2, a: 1 }), true);
  assert.equal(jsonValuesEqual({ owner: 'maps' }, { owner: 'other' }), false);
});

test('emits replayable container changes and semantic targets', () => {
  const before: StyleDocument = {
    version: 8, sources: {}, layers: [{ id: 'roads', type: 'background' }],
  };
  const after = structuredClone(before);
  after.layers[0]!.layout = { visibility: 'none' };
  const context = contextWith(['roads']);
  assert.deepEqual(diffStyleDocuments(before, after, context), [{
    op: 'add', path: '/layers/0/layout', after: { visibility: 'none' },
    target: { kind: 'layer', id: 'roads' },
  }]);
  assert.deepEqual(diffStyleDocuments(after, before, context), [{
    op: 'remove', path: '/layers/0/layout', before: { visibility: 'none' },
    target: { kind: 'layer', id: 'roads' },
  }]);
});

test('reconciles the Style layer array by id with replayable add/remove/move entries', () => {
  const before = styleWithLayers(['a', 'b', 'c']);
  const after = styleWithLayers(['c', 'b', 'd']);
  const entries = diffStyleDocuments(before, after, contextWith(['a', 'b', 'c', 'd']));
  assert.deepEqual(entries.map(({ op, target }) => ({ op, target })), [
    { op: 'remove', target: { kind: 'layer', id: 'a' } },
    { op: 'move', target: { kind: 'layer', id: 'c' } },
    { op: 'add', target: { kind: 'layer', id: 'd' } },
  ]);
  assert.deepEqual(replayStyleDiff(before, entries), after);
});

test('moves the candidate layer instead of unchanged bystanders', () => {
  const before = styleWithLayers(['a', 'b', 'c']);
  const after = styleWithLayers(['b', 'c', 'a']);
  const entries = diffStyleDocuments(before, after, contextWith(['a']));
  assert.deepEqual(entries.map(({ op, from, path, target }) => ({ op, from, path, target })), [{
    op: 'move', from: '/layers/0', path: '/layers/2', target: { kind: 'layer', id: 'a' },
  }]);
  assert.deepEqual(replayStyleDiff(before, entries), after);
});

test('rejects layer orders that cannot be reached by moving candidates', () => {
  const before = styleWithLayers(['a', 'b', 'c']);
  const after = styleWithLayers(['b', 'a', 'c']);
  assert.throws(
    () => diffStyleDocuments(before, after, contextWith(['c'])),
    /candidate.*order/i,
  );
});

test('replaces ordinary arrays atomically with a style target', () => {
  const before: StyleDocument = {
    version: 8, sources: {}, layers: [], metadata: { tags: ['a', 'b'] },
  };
  const after: StyleDocument = { ...before, metadata: { tags: ['a'] } };
  const entries = diffStyleDocuments(before, after, contextWith());
  assert.deepEqual(entries, [{
    op: 'replace', path: '/metadata/tags', before: ['a', 'b'], after: ['a'],
    target: { kind: 'style' },
  }]);
  assert.deepEqual(replayStyleDiff(before, entries), after);
});

test('emits object changes in canonical key order regardless of insertion history', () => {
  const beforeA: StyleDocument = { version: 8, sources: {}, layers: [], metadata: { z: 0, a: 0 } };
  const afterA: StyleDocument = { version: 8, sources: {}, layers: [], metadata: { z: 1, a: 1, m: 1 } };
  const beforeB: StyleDocument = { version: 8, sources: {}, layers: [], metadata: { a: 0, z: 0 } };
  const afterB: StyleDocument = { version: 8, sources: {}, layers: [], metadata: { m: 1, a: 1, z: 1 } };
  const context = contextWith();
  assert.deepEqual(
    diffStyleDocuments(beforeA, afterA, context),
    diffStyleDocuments(beforeB, afterB, context),
  );
});

test('canonical ordering is UTF-16 code-unit ordering, not code-point ordering', () => {
  const before: StyleDocument = { version: 8, sources: {}, layers: [], metadata: {} };
  const after: StyleDocument = {
    version: 8, sources: {}, layers: [], metadata: { '\uE000': 1, '😀': 1 },
  };
  assert.deepEqual(
    diffStyleDocuments(before, after, contextWith()).map(({ path }) => path),
    ['/metadata/😀', '/metadata/\uE000'],
  );
});

test('never degrades an unmarked semantic change to a style target', () => {
  const before = styleWithLayers(['roads']);
  const after = structuredClone(before);
  after.layers[0]!.layout = { visibility: 'none' };
  assert.throws(
    () => diffStyleDocuments(before, after, contextWith()),
    /candidate.*roads/i,
  );
});

test('classifies source changes from structure and requires source candidates', () => {
  const before: StyleDocument = {
    version: 8,
    sources: { terrain: { type: 'vector', url: 'before' } },
    layers: [],
  };
  const after: StyleDocument = {
    version: 8,
    sources: { terrain: { type: 'vector', url: 'after' } },
    layers: [],
  };
  const entries = diffStyleDocuments(before, after, contextWith([], ['terrain']));
  assert.deepEqual(entries, [{
    op: 'replace', path: '/sources/terrain/url', before: 'before', after: 'after',
    target: { kind: 'source', id: 'terrain' },
  }]);
  assert.deepEqual(replayStyleDiff(before, entries), after);
  assert.throws(
    () => diffStyleDocuments(before, after, contextWith()),
    /candidate.*terrain/i,
  );
});

test('omits candidate IDs that have no final structural diff', () => {
  const style = styleWithLayers(['roads']);
  assert.deepEqual(diffStyleDocuments(style, structuredClone(style), contextWith(['roads'])), []);
});
