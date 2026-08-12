import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { JsonObject, StyleOperation } from './types.js';

type AssertTrue<T extends true> = T;
type StyleOperationIsJsonObject = AssertTrue<
  StyleOperation extends JsonObject ? true : false
>;

it('keeps every StyleOperation variant JSON-backed', () => {
  const compiled: StyleOperationIsJsonObject = true;
  assert.equal(compiled, true);
});
