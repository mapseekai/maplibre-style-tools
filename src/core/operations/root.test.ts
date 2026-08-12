import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStyleTransaction } from '../transaction.js';
import type {
  JsonObject, JsonValue, StyleDocument, StyleLayer, StyleOperation,
} from '../types.js';
import { applyMergePatch, resolveInsertionIndex } from './shared.js';

function makeStyle(properties: JsonObject = {}): StyleDocument {
  return {
    version: 8,
    sources: {},
    layers: [],
    ...properties,
  } as StyleDocument;
}

test('merge-patches allowed root fields and removes null fields', () => {
  const style = makeStyle({
    name: 'Before',
    metadata: { owner: 'team', obsolete: true },
    glyphs: 'https://example.com/{fontstack}/{range}.pbf',
  });
  const operation: StyleOperation = {
    op: 'setStyleRootProperties',
    properties: {
      name: 'After',
      metadata: { obsolete: null, reviewed: true },
      glyphs: null,
    },
  };
  const result = applyStyleTransaction(style, { operations: [operation] });

  assert.equal(result.ok, true);
  assert.equal(result.style.name, 'After');
  assert.deepEqual(result.style.metadata, { owner: 'team', reviewed: true });
  assert.equal('glyphs' in result.style, false);
  assert.equal(style.name, 'Before');
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, [
    {
      op: 'remove', path: '/glyphs',
      before: 'https://example.com/{fontstack}/{range}.pbf',
      target: { kind: 'style' },
    },
    {
      op: 'remove', path: '/metadata/obsolete', before: true,
      target: { kind: 'style' },
    },
    {
      op: 'add', path: '/metadata/reviewed', after: true,
      target: { kind: 'style' },
    },
    {
      op: 'replace', path: '/name', before: 'Before', after: 'After',
      target: { kind: 'style' },
    },
  ]);
});

for (const forbidden of ['version', 'sources', 'layers'] as const) {
  test(`rejects protected root key ${forbidden}`, () => {
    const style = makeStyle();
    const result = applyStyleTransaction(style, {
      operations: [{ op: 'setStyleRootProperties', properties: { [forbidden]: null } }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, 'INVALID_INPUT');
    assert.strictEqual(result.style, style);
    assert.deepEqual(result.changedLayers, []);
    assert.deepEqual(result.changedSources, []);
    assert.deepEqual(result.diff, []);
  });
}

test('reports a structural root no-op with no diff or changed IDs', () => {
  const style = makeStyle({ metadata: { owner: 'team' } });
  const result = applyStyleTransaction(style, {
    operations: [{
      op: 'setStyleRootProperties',
      properties: { metadata: { owner: 'team', missing: null } },
    }],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.style, style);
  assert.notStrictEqual(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, []);
});

test('rejects dangerous merge keys without changing Object.prototype', () => {
  const style = makeStyle();
  const properties = JSON.parse(
    '{"metadata":{"__proto__":{"task2Polluted":true}}}',
  ) as JsonObject;
  const before = Object.getOwnPropertyDescriptor(Object.prototype, 'task2Polluted');
  const result = applyStyleTransaction(style, {
    operations: [{ op: 'setStyleRootProperties', properties }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'INVALID_INPUT');
  assert.strictEqual(result.style, style);
  assert.deepEqual(result.diff, []);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(Object.prototype, 'task2Polluted'), before,
  );

  const directPatch = JSON.parse(
    '{"__proto__":{"task2Polluted":true}}',
  ) as JsonValue;
  assert.throws(() => applyMergePatch({}, directPatch));
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(Object.prototype, 'task2Polluted'), before,
  );
});

test('rejects cyclic, Date, class, and custom-prototype root property values', () => {
  class CustomValue {
    readonly value = 'not-json';
  }
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const customPrototype = Object.assign(Object.create({ inherited: true }), { value: true });

  for (const properties of [
    { metadata: cyclic },
    { metadata: { createdAt: new Date(0) } },
    { metadata: { custom: new CustomValue() } },
    { metadata: customPrototype },
  ]) {
    const style = makeStyle();
    const result = applyStyleTransaction(style, {
      operations: [{ op: 'setStyleRootProperties', properties }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, 'INVALID_INPUT');
    assert.strictEqual(result.style, style);
    assert.deepEqual(result.changedLayers, []);
    assert.deepEqual(result.changedSources, []);
    assert.deepEqual(result.diff, []);
  }
});

test('applies RFC 7396 recursive object merge and value replacement', () => {
  assert.deepEqual(applyMergePatch({
    owner: 'team', nested: { keep: true, remove: true }, value: 'before',
  }, {
    nested: { remove: null, add: 1 }, value: ['after'],
  }), {
    owner: 'team', nested: { keep: true, add: 1 }, value: ['after'],
  });
  assert.equal(applyMergePatch({ value: true }, null), null);
});

test('resolves before and after placement anchors', () => {
  const layers = [
    { id: 'background', type: 'background' },
    { id: 'roads', type: 'line' },
    { id: 'labels', type: 'symbol' },
  ] as StyleLayer[];

  assert.equal(resolveInsertionIndex(layers, {}, 3), 3);
  assert.equal(resolveInsertionIndex(layers, { beforeId: 'roads' }, 3), 1);
  assert.equal(resolveInsertionIndex(layers, { afterId: 'roads' }, 3), 2);
});

test('rejects conflicting placement and missing anchors', () => {
  const layers = [{ id: 'roads', type: 'line' }] as StyleLayer[];
  assert.throws(() => resolveInsertionIndex(
    layers, { beforeId: 'roads', afterId: 'roads' }, 1,
  ));
  assert.throws(() => resolveInsertionIndex(layers, { beforeId: 'missing' }, 1));
  assert.throws(() => resolveInsertionIndex(layers, { afterId: 'missing' }, 1));
});
