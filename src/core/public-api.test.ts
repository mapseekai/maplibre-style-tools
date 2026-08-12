import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyStyleTransaction, finalizeStyleReplacement,
  styleTransactionSchema, validateStyleDocument,
} from './index.js';
import type { StyleDocument } from './index.js';

test('core barrel exposes the pure foundation', () => {
  assert.equal(typeof applyStyleTransaction, 'function');
  assert.equal(typeof finalizeStyleReplacement, 'function');
  assert.equal(typeof validateStyleDocument, 'function');
  assert.equal(styleTransactionSchema.safeParse({ operations: [] }).success, false);
  const original: StyleDocument = { version: 8, sources: {}, layers: [] };
  const replacement: StyleDocument = {
    version: 8, sources: {}, layers: [], metadata: { owner: 'maps' },
  };
  const finalized = finalizeStyleReplacement(original, replacement);
  assert.equal(finalized.ok, true);
  assert.deepEqual(finalized.diff.map(({ op, path }) => ({ op, path })), [{
    op: 'add', path: '/metadata',
  }]);
});
