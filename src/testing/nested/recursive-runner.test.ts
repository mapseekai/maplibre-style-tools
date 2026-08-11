import assert from 'node:assert/strict';
import { test } from 'node:test';

test('recursive test runner discovers nested tests', () => {
  assert.equal(6, 6);
});
