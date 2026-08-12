import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_MAX_STYLE_BYTES, jsonUtf8ByteLength } from './utf8.js';
import {
  validateStyleDocument,
  validateStyleDocumentWith,
} from './validation.js';

const makeStyleAtBytes = (bytes: number) => {
  const empty = {
    version: 8, sources: {}, layers: [], metadata: { padding: '' },
  };
  const padding = 'a'.repeat(bytes - jsonUtf8ByteLength(empty));
  return { ...empty, metadata: { padding } };
};

test('validates an empty MapLibre style', () => {
  assert.deepEqual(validateStyleDocument({ version: 8, sources: {}, layers: [] }), {
    ok: true, style: { version: 8, sources: {}, layers: [] }, errors: [], warnings: [],
  });
});

test('normalizes envelope failures as INVALID_INPUT', () => {
  const result = validateStyleDocument({ version: 7, sources: {}, layers: [] });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0]?.code, 'INVALID_INPUT');
  assert.equal(result.errors[0]?.path, '/version');
});

test('normalizes Style Spec failures as STYLE_INVALID without throwing', () => {
  const result = validateStyleDocument({
    version: 8, sources: {},
    layers: [{ id: 'bad', type: 'line', paint: { 'fill-color': '#fff' } }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'STYLE_INVALID'), true);
});

test('accepts exactly 5 MiB and rejects the next UTF-8 byte stably', () => {
  const exact = makeStyleAtBytes(DEFAULT_MAX_STYLE_BYTES);
  assert.equal(jsonUtf8ByteLength(exact), DEFAULT_MAX_STYLE_BYTES);
  assert.equal(validateStyleDocument(exact).ok, true);

  const oversized = makeStyleAtBytes(DEFAULT_MAX_STYLE_BYTES + 1);
  const result = validateStyleDocument(oversized);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors[0], {
    code: 'INVALID_INPUT',
    message: 'Style exceeds the configured UTF-8 JSON size limit.',
    path: '',
    details: {
      reason: 'maxStyleBytes',
      maxBytes: DEFAULT_MAX_STYLE_BYTES,
      actualBytes: DEFAULT_MAX_STYLE_BYTES + 1,
    },
  });
});

test('allows an embedder to override the style byte limit explicitly', () => {
  const style = makeStyleAtBytes(256);
  assert.equal(validateStyleDocument(style, { maxStyleBytes: 255 }).ok, false);
  assert.equal(validateStyleDocument(style, { maxStyleBytes: 256 }).ok, true);
});

test('normalizes a thrown Style Spec validator failure', () => {
  const style = { version: 8, sources: {}, layers: [] };
  const result = validateStyleDocumentWith(style, {}, () => {
    throw new Error('legacy expression rejected');
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0]?.code, 'STYLE_INVALID');
  assert.deepEqual(result.warnings, []);
  assert.match(result.errors[0]?.message ?? '', /legacy expression rejected/);
});
