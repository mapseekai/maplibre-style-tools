import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { z } from 'zod';
import { jsonUtf8ByteLength } from '../core/index.js';
import {
  filterTextSchema,
  jsonOrRawStringTextSchema,
  legacyOperationsTextSchema,
  strictJsonTextSchema,
  styleJsonOrUrlTextSchema,
} from './schemas.js';
import {
  normalizeLegacyOperations,
  parseJsonOrRawString,
  parseStrictJson,
} from './compatibility.js';
import type { ParseResult } from './compatibility.js';

type Assert<T extends true> = T;
type Extends<Left, Right> = Left extends Right ? true : false;
type _StrictJsonText = Assert<Extends<z.output<typeof strictJsonTextSchema>, string>>;
type _JsonOrRawText = Assert<Extends<z.output<typeof jsonOrRawStringTextSchema>, string>>;
const strictJsonTextType: _StrictJsonText = true;
const jsonOrRawTextType: _JsonOrRawText = true;
void strictJsonTextType;
void jsonOrRawTextType;

test('strict JSON parsing accepts JSON objects, arrays, and scalars', () => {
  for (const [raw, expected] of [
    ['{"name":"roads"}', { name: 'roads' }],
    ['["==",["get","class"],"primary"]', ['==', ['get', 'class'], 'primary']],
    ['null', null],
    ['42', 42],
    ['"#ff0000"', '#ff0000'],
  ] as const) {
    const result = parseStrictJson(raw, 'valueJson');
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, expected);
  }
});

test('strict JSON parsing reports registered INVALID_INPUT errors without leaking input', () => {
  const raw = '{private-value';
  const result = parseStrictJson(raw, raw);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'INVALID_INPUT');
    assert.doesNotMatch(result.error.message, /private-value/);
  }
});

test('JSON-or-raw parsing preserves legacy scalar and URL values', () => {
  for (const raw of ['#ff0000', 'Open Sans', 'https://example.test/style.json']) {
    const result = parseJsonOrRawString(raw, 'valueJson');
    assert.deepEqual(result, { ok: true, value: raw });
  }
  const encoded = parseJsonOrRawString('{"version":8}', 'styleJsonOrUrl');
  assert.deepEqual(encoded, { ok: true, value: { version: 8 } });
});

test('JSON-or-raw parsing rejects empty and malformed JSON-looking values', () => {
  for (const raw of ['', '   ', '{bad', '[bad']) {
    const result = parseJsonOrRawString(raw, 'valueJson');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'INVALID_INPUT');
  }
});

test('reusable AI text schemas are bounded and select their parser family', () => {
  assert.equal(strictJsonTextSchema.safeParse('{"ok":true}').success, true);
  assert.equal(filterTextSchema.safeParse('["==",["get","kind"],"road"]').success, true);
  assert.equal(strictJsonTextSchema.safeParse('#ff0000').success, false);
  assert.equal(jsonOrRawStringTextSchema.safeParse('#ff0000').success, true);
  assert.equal(styleJsonOrUrlTextSchema.safeParse('https://example.test/style.json').success, true);
  assert.equal(styleJsonOrUrlTextSchema.safeParse('{bad').success, false);
  assert.equal(legacyOperationsTextSchema.safeParse('[{"layerId":"roads","filter":null}]').success, true);
  assert.equal(legacyOperationsTextSchema.safeParse('{"layerId":"roads"}').success, false);

  const overLimit = 'x'.repeat(1024 * 1024);
  assert.equal(jsonUtf8ByteLength(overLimit) > 1024 * 1024, true);
  assert.equal(jsonOrRawStringTextSchema.safeParse(overLimit).success, false);
});

test('legacy compact operations normalize to core transactions', () => {
  const result = normalizeLegacyOperations(JSON.stringify([
    {
      layerId: 'roads',
      paint: { 'line-color': '#ff0000' },
      layout: { 'line-cap': 'round' },
      minzoom: 2,
      maxzoom: 14,
      filter: ['==', ['get', 'class'], 'primary'],
    },
    { layerId: 'labels', filter: null },
  ]));
  assert.deepEqual(result, {
    ok: true,
    value: {
      operations: [
        {
          op: 'setLayerProperties',
          layerId: 'roads',
          paint: { 'line-color': '#ff0000' },
          layout: { 'line-cap': 'round' },
          minzoom: 2,
          maxzoom: 14,
        },
        {
          op: 'setLayerFilter',
          layerId: 'roads',
          mode: 'replace',
          filter: ['==', ['get', 'class'], 'primary'],
        },
        { op: 'setLayerFilter', layerId: 'labels', mode: 'clear' },
      ],
      validate: true,
    },
  });
});

test('legacy compact operation normalization returns INVALID_INPUT for invalid transactions', () => {
  const result = normalizeLegacyOperations('[{"layerId":"roads","filter":"not-an-array"}]');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'INVALID_INPUT');
});

test('ParseResult narrows value to the successful branch', () => {
  const result: ParseResult<string> = { ok: true, value: 'value' };
  if (result.ok) assert.equal(result.value, 'value');
  // @ts-expect-error value is unavailable when parsing failed.
  const failedValue = ({ ok: false, error: {} }).value;
  void failedValue;
});
