import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStyleTransaction } from '../transaction.js';
import {
  DEFAULT_MAX_DIFF_BYTES, DEFAULT_MAX_OPERATIONS, DEFAULT_MAX_STYLE_BYTES,
} from '../utf8.js';
import type {
  JsonObject, JsonValue, OperationContext, StyleDocument, StyleLayer, StyleOperation,
} from '../types.js';
import { applyRootOperation } from './root.js';
import { applyMergePatch, resolveInsertionIndex } from './shared.js';

const INVALID_MERGE_INPUT = {
  name: 'TypeError',
  message: 'JSON Merge Patch inputs must be strict JSON trees',
};

function makeStyle(properties: JsonObject = {}): StyleDocument {
  return {
    version: 8,
    sources: {},
    layers: [],
    ...properties,
  } as StyleDocument;
}

function operationContext(): OperationContext {
  return {
    limits: {
      maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
      maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
      maxOperations: DEFAULT_MAX_OPERATIONS,
    },
    changedLayerIds: new Set(),
    changedSourceIds: new Set(),
    warnings: [],
  };
}

function assertInvalidMergeInput(value: unknown): void {
  assert.throws(
    () => applyMergePatch(value as JsonValue, null),
    INVALID_MERGE_INPUT,
  );
  assert.throws(
    () => applyMergePatch(null, value as JsonValue),
    INVALID_MERGE_INPUT,
  );
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

test('direct merge patch rejects non-JSON primitives and exotic objects stably', () => {
  class CustomValue {
    readonly value = 'x';
  }
  const customPrototype = Object.assign(Object.create({ inherited: true }), { value: true });

  for (const value of [
    undefined,
    () => undefined,
    Symbol('invalid'),
    1n,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    new Date(0),
    new CustomValue(),
    customPrototype,
  ]) {
    assertInvalidMergeInput(value);
  }
});

test('direct merge patch accepts and snapshots dense JSON arrays', () => {
  const target: JsonValue = { retained: true };
  const patch: JsonValue = [1, { nested: ['value'] }];
  const result = applyMergePatch(target, patch);

  assert.deepEqual(result, [1, { nested: ['value'] }]);
  assert.notStrictEqual(result, patch);
  assert.notStrictEqual((result as JsonValue[])[1], patch[1]);
});

test('direct merge patch rejects malformed arrays without executing accessors', () => {
  const hole = [1, 2, 3];
  Reflect.deleteProperty(hole, '1');

  const extra = [1];
  Object.defineProperty(extra, 'extra', { enumerable: true, value: true });

  const dangerous = [1];
  Object.defineProperty(dangerous, 'constructor', { enumerable: true, value: true });

  const symbolKeyed = [1];
  Object.defineProperty(symbolKeyed, Symbol('extra'), { enumerable: true, value: true });

  let getterCalls = 0;
  const accessor = [1];
  Object.defineProperty(accessor, '0', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('must not run'); },
  });

  const before = Object.getOwnPropertyDescriptor(Object.prototype, 'task2ArrayPolluted');
  for (const value of [hole, extra, dangerous, symbolKeyed, accessor]) {
    assertInvalidMergeInput(value);
  }
  assert.equal(getterCalls, 0);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(Object.prototype, 'task2ArrayPolluted'), before,
  );
});

test('direct merge patch rejects cycles and repeated container identities', () => {
  const objectCycle: Record<string, unknown> = {};
  objectCycle.self = objectCycle;

  const arrayCycle: unknown[] = [];
  arrayCycle.push(arrayCycle);

  const crossObject: { array?: unknown[] } = {};
  const crossArray: unknown[] = [crossObject];
  crossObject.array = crossArray;

  const shared = { value: true };
  const alias = { first: shared, second: shared };

  for (const value of [objectCycle, arrayCycle, crossObject, alias]) {
    assertInvalidMergeInput(value);
  }
});

test('direct root operation validates all protected keys before mutating', () => {
  const style = makeStyle({ name: 'Before' });
  const before = structuredClone(style);
  const result = applyRootOperation(style, {
    op: 'setStyleRootProperties',
    properties: { name: 'After', version: null },
  }, operationContext());

  assert.equal(result.ok, false);
  assert.deepEqual(style, before);
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
