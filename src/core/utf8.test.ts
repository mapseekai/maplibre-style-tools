import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_MAX_DIFF_BYTES, DEFAULT_MAX_OPERATIONS, DEFAULT_MAX_STYLE_BYTES,
  jsonUtf8ByteLength, utf8ByteLength,
} from './utf8.js';
import type { JsonValue } from './types.js';

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

test('matches native JSON serialization for tricky shallow JSON values', () => {
  const fixtures: readonly JsonValue[] = [
    null,
    true,
    false,
    0,
    -12.5,
    'quote" slash\\ controls\b\f\n\r\t\u0000\u001f',
    'BMP \u754c astral \ud83d\ude00 high \ud800 low \udc00',
    ['first', 2, false, null],
    { second: '\ud800', first: ['\\', '"', '\ud83d\ude00'] },
  ];
  for (const fixture of fixtures) {
    const serialized = JSON.stringify(fixture);
    if (serialized === undefined) assert.fail('JSON value did not serialize');
    assert.equal(jsonUtf8ByteLength(fixture), utf8ByteLength(serialized));
  }
});

test('calls native JSON.stringify exactly once on normal and deep fallback paths', () => {
  const descriptor = Object.getOwnPropertyDescriptor(JSON, 'stringify');
  if (descriptor === undefined || !('value' in descriptor)) {
    assert.fail('missing JSON.stringify descriptor');
  }
  const originalStringify = descriptor.value;
  let calls = 0;
  Object.defineProperty(JSON, 'stringify', {
    ...descriptor,
    value(value: unknown) {
      calls += 1;
      return Reflect.apply(originalStringify, JSON, [value]);
    },
  });
  try {
    assert.equal(jsonUtf8ByteLength({ text: 'normal' }), 17);
    assert.equal(calls, 1);

    let deep: JsonValue = null;
    for (let depth = 0; depth < 10_000; depth += 1) deep = [deep];
    assert.equal(jsonUtf8ByteLength(deep), 20_004);
    assert.equal(calls, 2);
  } finally {
    Object.defineProperty(JSON, 'stringify', descriptor);
  }
});
