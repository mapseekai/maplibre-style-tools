import assert from 'node:assert/strict';
import test from 'node:test';

import type { StyleDocument } from '../core/types.js';
import {
  validateStyleDocument,
  type ValidationResult,
} from './core-adapters.js';

const validStyle: StyleDocument = { version: 8, sources: {}, layers: [] };

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
