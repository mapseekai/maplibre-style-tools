import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_MAX_DIFF_BYTES, DEFAULT_MAX_OPERATIONS, DEFAULT_MAX_STYLE_BYTES,
  jsonUtf8ByteLength, utf8ByteLength,
} from './utf8.js';

test('counts UTF-8 without DOM or Node encoders', () => {
  assert.equal(utf8ByteLength('abc'), 3);
  assert.equal(utf8ByteLength('界'), 3);
  assert.equal(utf8ByteLength('😀'), 4);
  assert.equal(utf8ByteLength('\uD800'), 3);
  assert.equal(utf8ByteLength('\uDC00'), 3);
  assert.equal(jsonUtf8ByteLength('界'), 5);
});

test('exports the one authoritative default limits', () => {
  assert.equal(DEFAULT_MAX_STYLE_BYTES, 5 * 1024 * 1024);
  assert.equal(DEFAULT_MAX_DIFF_BYTES, 1 * 1024 * 1024);
  assert.equal(DEFAULT_MAX_OPERATIONS, 100);
});
