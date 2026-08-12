import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replayStyleDiff } from '../diff.js';
import {
  duplicateLayerOperationSchema,
  moveLayerOperationSchema,
  removeLayerOperationSchema,
  reorderLayersOperationSchema,
  styleOperationSchema,
} from '../schemas.js';
import { applyStyleTransaction } from '../transaction.js';
import {
  DEFAULT_MAX_DIFF_BYTES, DEFAULT_MAX_OPERATIONS, DEFAULT_MAX_STYLE_BYTES,
} from '../utf8.js';
import type {
  CoreExecutionLimits,
  JsonObject,
  JsonValue,
  LayerLifecycleOperation,
  OperationContext,
  StyleDocument,
} from '../types.js';
import { applyLayerOperation, applySetLayerProperties } from './layers.js';

const DEFAULT_TEST_LIMITS: Readonly<CoreExecutionLimits> = {
  maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
  maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
  maxOperations: DEFAULT_MAX_OPERATIONS,
};

const DEEP_JSON_DEPTH = 20_000;

const original: StyleDocument = {
  version: 8,
  sources: { base: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] } },
  layers: [{ id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads',
    paint: { 'line-color': '#000', 'line-width': 2 }, metadata: { owner: 'maps' } }],
};

function makeContext(): OperationContext {
  return {
    limits: DEFAULT_TEST_LIMITS,
    changedLayerIds: new Set(),
    changedSourceIds: new Set(),
    warnings: [],
  };
}

function makeStyle(ids: readonly string[] = ['a', 'b', 'c', 'd', 'e']): StyleDocument {
  return {
    version: 8,
    sources: {},
    layers: ids.map((id) => ({ id, type: 'background' })),
  };
}

function makeDeepJsonObject(depth: number, leaf: JsonValue): JsonObject {
  const root: JsonObject = {};
  let current = root;
  for (let index = 0; index < depth; index += 1) {
    const next: JsonObject = {};
    current.next = next;
    current = next;
  }
  current.value = leaf;
  return root;
}

function assertDeepJsonObject(
  value: JsonValue | undefined,
  depth: number,
  leaf: JsonValue,
): void {
  let current = value;
  for (let index = 0; index < depth; index += 1) {
    assert.equal(typeof current, 'object');
    assert.notEqual(current, null);
    assert.equal(Array.isArray(current), false);
    current = (current as JsonObject).next;
  }
  assert.equal((current as JsonObject).value, leaf);
}

function assertAtomicFailure(
  style: StyleDocument,
  operation: unknown,
  code: string,
): ReturnType<typeof applyStyleTransaction> {
  const result = applyStyleTransaction(style, { operations: [operation] });
  assert.equal(result.ok, false);
  assert.strictEqual(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, []);
  if (result.ok) assert.fail('expected transaction failure');
  assert.equal(result.error.code, code);
  return result;
}

function assertReplay(
  before: StyleDocument,
  result: ReturnType<typeof applyStyleTransaction>,
): void {
  assert.equal(result.ok, true);
  assert.deepEqual(replayStyleDiff(before, result.diff), result.style);
}

function orderedNonEmptySelections(values: readonly string[]): string[][] {
  const selections: string[][] = [];
  const visit = (remaining: readonly string[], selected: readonly string[]): void => {
    if (selected.length > 0) selections.push([...selected]);
    for (let index = 0; index < remaining.length; index += 1) {
      visit(
        [...remaining.slice(0, index), ...remaining.slice(index + 1)],
        [...selected, remaining[index]!],
      );
    }
  };
  visit(values, []);
  return selections;
}

function assertStableSubsequence(
  actual: readonly string[],
  expectedOrder: readonly string[],
): void {
  let expectedIndex = 0;
  for (const actualId of actual) {
    while (expectedOrder[expectedIndex] !== actualId
      && expectedIndex < expectedOrder.length) expectedIndex += 1;
    assert.equal(expectedOrder[expectedIndex], actualId);
    expectedIndex += 1;
  }
  assert.equal(new Set(actual).size, actual.length);
}

test('setLayerProperties replaces and adds properties with RFC 6901 paths', () => {
  const working = structuredClone(original);
  const context = makeContext();
  const result = applySetLayerProperties(working, {
    op: 'setLayerProperties', layerId: 'roads',
    paint: { 'line-color': '#fff' }, layout: { visibility: 'none' }, minzoom: 4,
  }, context);
  assert.deepEqual(result, { ok: true, changed: true });
  assert.equal(working.layers[0]?.paint?.['line-color'], '#fff');
  assert.equal(working.layers[0]?.layout?.visibility, 'none');
  assert.deepEqual([...context.changedLayerIds], ['roads']);
  assert.deepEqual([...context.changedSourceIds], []);
  assert.strictEqual(context.limits, DEFAULT_TEST_LIMITS);
  assert.equal(original.layers[0]?.paint?.['line-color'], '#000');
});

test('setLayerProperties null removes properties and whole metadata', () => {
  const working = structuredClone(original);
  const context = makeContext();
  applySetLayerProperties(working, {
    op: 'setLayerProperties', layerId: 'roads',
    paint: { 'line-width': null }, metadata: null,
  }, context);
  assert.equal('line-width' in (working.layers[0]?.paint ?? {}), false);
  assert.equal('metadata' in working.layers[0]!, false);
  assert.deepEqual([...context.changedLayerIds], ['roads']);
});

test('setLayerProperties returns NOT_FOUND for an unknown layer', () => {
  const result = applySetLayerProperties(structuredClone(original), {
    op: 'setLayerProperties', layerId: 'missing', paint: { 'line-color': '#fff' },
  }, makeContext());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'NOT_FOUND');
});

test('layer lifecycle schemas are strict descriptor-safe closed variants', () => {
  const valid: readonly [
    LayerLifecycleOperation,
    { safeParse(value: unknown): { success: boolean } },
  ][] = [
    [{ op: 'duplicateLayer', layerId: 'a', newLayerId: 'copy', beforeId: 'b' },
      duplicateLayerOperationSchema],
    [{ op: 'moveLayer', layerId: 'a', afterId: 'b' }, moveLayerOperationSchema],
    [{ op: 'reorderLayers', layerIds: ['d', 'b'], beforeId: 'a' },
      reorderLayersOperationSchema],
    [{ op: 'removeLayer', layerId: 'a' }, removeLayerOperationSchema],
  ];

  for (const [operation, schema] of valid) {
    assert.equal(schema.safeParse(operation).success, true, operation.op);
    assert.equal(styleOperationSchema.safeParse(operation).success, true, operation.op);
    assert.equal(schema.safeParse({ ...operation, unknown: true }).success, false, operation.op);
    assert.equal(
      styleOperationSchema.safeParse({ ...operation, unknown: true }).success,
      false,
      operation.op,
    );
  }

  assert.equal(duplicateLayerOperationSchema.safeParse({
    op: 'duplicateLayer', layerId: 'a', newLayerId: 'copy', overrides: { id: 'stolen' },
  }).success, false);
  assert.equal(moveLayerOperationSchema.safeParse({
    op: 'moveLayer', layerId: 'a', beforeId: 'b', afterId: 'c',
  }).success, false);
  assert.equal(reorderLayersOperationSchema.safeParse({
    op: 'reorderLayers', layerIds: [],
  }).success, false);
  assert.equal(reorderLayersOperationSchema.safeParse({
    op: 'reorderLayers', layerIds: ['a', 'a'],
  }).success, false);
  assert.equal(reorderLayersOperationSchema.safeParse({
    op: 'reorderLayers', layerIds: ['a'], beforeId: 'a',
  }).success, false);
});

test('layer lifecycle schemas remain deterministic with a polluted Object prototype', () => {
  const key = 'layerLifecyclePollutionProbe';
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
  try {
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      enumerable: true,
      value: true,
      writable: false,
    });
    assert.equal(duplicateLayerOperationSchema.safeParse({
      op: 'duplicateLayer', layerId: 'a', newLayerId: 'copy', afterId: 'b',
    }).success, true);
    assert.equal(moveLayerOperationSchema.safeParse({
      op: 'moveLayer', layerId: 'a', beforeId: 'b',
    }).success, true);
    assert.equal(reorderLayersOperationSchema.safeParse({
      op: 'reorderLayers', layerIds: ['d', 'b'], beforeId: 'a',
    }).success, true);
    assert.equal(removeLayerOperationSchema.safeParse({
      op: 'removeLayer', layerId: 'a',
    }).success, true);
  } finally {
    if (originalDescriptor === undefined) {
      Reflect.deleteProperty(Object.prototype, key);
    } else {
      Object.defineProperty(Object.prototype, key, originalDescriptor);
    }
  }
});

test('polluted lifecycle fallbacks preserve clean nonblank ID and issue contracts', () => {
  const fixtures = [
    {
      schema: duplicateLayerOperationSchema,
      operation: { op: 'duplicateLayer', layerId: ' \t', newLayerId: 'copy' },
      issuePath: ['layerId'],
    },
    {
      schema: duplicateLayerOperationSchema,
      operation: { op: 'duplicateLayer', layerId: 'a', newLayerId: '\n' },
      issuePath: ['newLayerId'],
    },
    {
      schema: duplicateLayerOperationSchema,
      operation: {
        op: 'duplicateLayer', layerId: 'a', newLayerId: 'copy', beforeId: ' ',
      },
      issuePath: ['beforeId'],
    },
    {
      schema: duplicateLayerOperationSchema,
      operation: {
        op: 'duplicateLayer', layerId: 'a', newLayerId: 'copy', afterId: '\t',
      },
      issuePath: ['afterId'],
    },
    {
      schema: moveLayerOperationSchema,
      operation: { op: 'moveLayer', layerId: '\n' },
      issuePath: ['layerId'],
    },
    {
      schema: moveLayerOperationSchema,
      operation: { op: 'moveLayer', layerId: 'a', beforeId: ' \n' },
      issuePath: ['beforeId'],
    },
    {
      schema: moveLayerOperationSchema,
      operation: { op: 'moveLayer', layerId: 'a', afterId: '\t' },
      issuePath: ['afterId'],
    },
    {
      schema: reorderLayersOperationSchema,
      operation: { op: 'reorderLayers', layerIds: ['a', ' \t'] },
      issuePath: ['layerIds', 1],
    },
    {
      schema: reorderLayersOperationSchema,
      operation: { op: 'reorderLayers', layerIds: ['b'], beforeId: '\n' },
      issuePath: ['beforeId'],
    },
    {
      schema: reorderLayersOperationSchema,
      operation: { op: 'reorderLayers', layerIds: ['b'], afterId: ' ' },
      issuePath: ['afterId'],
    },
    {
      schema: removeLayerOperationSchema,
      operation: { op: 'removeLayer', layerId: '\t\n' },
      issuePath: ['layerId'],
    },
  ] as const;

  const cleanIssues = fixtures.map(({ schema, operation, issuePath }) => {
    const direct = schema.safeParse(operation);
    const union = styleOperationSchema.safeParse(operation);
    const transaction = applyStyleTransaction(makeStyle(), { operations: [operation] });
    assert.equal(direct.success, false);
    assert.equal(union.success, false);
    assert.equal(transaction.ok, false);
    if (direct.success || union.success || transaction.ok) {
      assert.fail('expected clean whitespace rejection');
    }
    assert.deepEqual(direct.error.issues, [{
      code: 'custom', path: issuePath, message: 'Expected a non-empty string',
    }]);
    assert.deepEqual(union.error.issues, direct.error.issues);
    assert.equal(transaction.error.code, 'INVALID_INPUT');
    assert.equal(transaction.error.path, `/operations/0/${issuePath.join('/')}`);
    return { direct: direct.error.issues, union: union.error.issues };
  });

  const padded = { op: 'removeLayer', layerId: ' padded ' } as const;
  const cleanPadded = removeLayerOperationSchema.safeParse(padded);
  assert.equal(cleanPadded.success, true);
  if (!cleanPadded.success) assert.fail('expected clean padded ID acceptance');
  assert.equal(cleanPadded.data.layerId, ' padded ');

  const pollutionKey = 'layerLifecycleWhitespaceFallbackProbe';
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, pollutionKey);
  let getterCalls = 0;
  try {
    Object.defineProperty(Object.prototype, pollutionKey, {
      configurable: true,
      value: true,
      writable: true,
    });

    for (let index = 0; index < fixtures.length; index += 1) {
      const { schema, operation, issuePath } = fixtures[index]!;
      const direct = schema.safeParse(operation);
      const union = styleOperationSchema.safeParse(operation);
      assert.equal(direct.success, false);
      assert.equal(union.success, false);
      if (direct.success || union.success) assert.fail('expected polluted whitespace rejection');
      assert.deepEqual(direct.error.issues, cleanIssues[index]!.direct);
      assert.deepEqual(union.error.issues, cleanIssues[index]!.union);

      const style = makeStyle();
      const result = assertAtomicFailure(style, operation, 'INVALID_INPUT');
      if (!result.ok) {
        assert.equal(result.error.path, `/operations/0/${issuePath.join('/')}`);
      }
    }

    const pollutedPadded = removeLayerOperationSchema.safeParse(padded);
    assert.equal(pollutedPadded.success, true);
    if (!pollutedPadded.success) assert.fail('expected polluted padded ID acceptance');
    assert.equal(pollutedPadded.data.layerId, ' padded ');

    const accessorOperation: Record<string, unknown> = { op: 'removeLayer' };
    Object.defineProperty(accessorOperation, 'layerId', {
      enumerable: true,
      get() { getterCalls += 1; throw new Error('must not run'); },
    });
    assert.equal(removeLayerOperationSchema.safeParse(accessorOperation).success, false);
    assert.equal(styleOperationSchema.safeParse(accessorOperation).success, false);
    assertAtomicFailure(makeStyle(), accessorOperation, 'INVALID_INPUT');
  } finally {
    if (originalDescriptor === undefined) {
      Reflect.deleteProperty(Object.prototype, pollutionKey);
    } else {
      Object.defineProperty(Object.prototype, pollutionKey, originalDescriptor);
    }
  }
  assert.equal(getterCalls, 0);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(Object.prototype, pollutionKey),
    originalDescriptor,
  );
});

test('duplicateLayer preserves every JSON field, applies Merge Patch, and inserts after source', () => {
  const style = makeStyle(['base', 'roads', 'labels']);
  style.layers[1] = {
    id: 'roads',
    type: 'background',
    metadata: {
      owner: 'maps',
      obsolete: true,
      nested: { values: [1, { retained: 'yes' }] },
    },
    extension: { vendor: { enabled: true } },
  };
  const result = applyStyleTransaction(style, {
    validate: false,
    operations: [{
      op: 'duplicateLayer',
      layerId: 'roads',
      newLayerId: 'roads-copy',
      overrides: {
        metadata: { obsolete: null, reviewed: true },
        extension: { vendor: { added: 'new' } },
      },
    }],
  });
  const expected = {
    id: 'roads-copy',
    type: 'background',
    metadata: {
      owner: 'maps',
      nested: { values: [1, { retained: 'yes' }] },
      reviewed: true,
    },
    extension: { vendor: { enabled: true, added: 'new' } },
  };

  assert.equal(result.ok, true);
  assert.deepEqual(result.style.layers.map(({ id }) => id), ['base', 'roads', 'roads-copy', 'labels']);
  assert.deepEqual(result.style.layers[2], expected);
  assert.deepEqual(result.changedLayers, ['roads-copy']);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, [{
    op: 'add', path: '/layers/2', after: expected,
    target: { kind: 'layer', id: 'roads-copy' },
  }]);
  assert.notStrictEqual(result.style.layers[2], result.style.layers[1]);
  assert.notStrictEqual(result.style.layers[2]?.metadata, result.style.layers[1]?.metadata);
  assert.notStrictEqual(
    (result.style.layers[2]?.metadata as JsonObject).nested,
    (result.style.layers[1]?.metadata as JsonObject).nested,
  );
  assert.equal((style.layers[1]?.metadata as JsonObject).obsolete, true);
  assertReplay(style, result);
});

test('duplicateLayer deep-clones a 20k-deep extension without stack overflow', () => {
  const style = makeStyle(['base', 'roads', 'labels']);
  style.layers[1]!.extension = makeDeepJsonObject(DEEP_JSON_DEPTH, 'original');
  const result = applyStyleTransaction(style, {
    validate: false,
    operations: [{ op: 'duplicateLayer', layerId: 'roads', newLayerId: 'copy' }],
  });

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('expected deep duplicate success');
  assert.deepEqual(result.changedLayers, ['copy']);
  assertDeepJsonObject(result.style.layers[2]?.extension, DEEP_JSON_DEPTH, 'original');
  assertDeepJsonObject(
    (result.diff[0]?.after as JsonObject | undefined)?.extension,
    DEEP_JSON_DEPTH,
    'original',
  );
  assert.notStrictEqual(result.style.layers[2]?.extension, style.layers[1]?.extension);
  const replayed = replayStyleDiff(style, result.diff);
  assert.deepEqual(replayed.layers.map(({ id }) => id), ['base', 'roads', 'copy', 'labels']);
  assertDeepJsonObject(replayed.layers[2]?.extension, DEEP_JSON_DEPTH, 'original');
  assert.notStrictEqual(replayed.layers[2]?.extension, result.style.layers[2]?.extension);
});

test('duplicateLayer supports explicit before and after placement', () => {
  const beforeStyle = makeStyle(['a', 'b', 'c']);
  const before = applyStyleTransaction(beforeStyle, { operations: [{
    op: 'duplicateLayer', layerId: 'a', newLayerId: 'copy', beforeId: 'c',
  }] });
  assert.equal(before.ok, true);
  assert.deepEqual(before.style.layers.map(({ id }) => id), ['a', 'b', 'copy', 'c']);
  assert.deepEqual(before.diff, [{
    op: 'add', path: '/layers/2', after: { id: 'copy', type: 'background' },
    target: { kind: 'layer', id: 'copy' },
  }]);
  assertReplay(beforeStyle, before);

  const afterStyle = makeStyle(['a', 'b', 'c']);
  const after = applyStyleTransaction(afterStyle, { operations: [{
    op: 'duplicateLayer', layerId: 'a', newLayerId: 'copy', afterId: 'c',
  }] });
  assert.equal(after.ok, true);
  assert.deepEqual(after.style.layers.map(({ id }) => id), ['a', 'b', 'c', 'copy']);
  assert.deepEqual(after.diff[0]?.path, '/layers/3');
  assertReplay(afterStyle, after);
});

test('duplicateLayer rejects missing sources, collisions, and missing anchors atomically', () => {
  const missingStyle = makeStyle();
  const missing = assertAtomicFailure(missingStyle, {
    op: 'duplicateLayer', layerId: 'missing', newLayerId: 'copy',
  }, 'NOT_FOUND');
  if (!missing.ok) assert.equal(missing.error.path, '/layerId');

  const collisionStyle = makeStyle();
  const collision = assertAtomicFailure(collisionStyle, {
    op: 'duplicateLayer', layerId: 'a', newLayerId: 'b',
  }, 'CONFLICT');
  if (!collision.ok) assert.equal(collision.error.path, '/newLayerId');

  const anchorStyle = makeStyle();
  const anchor = assertAtomicFailure(anchorStyle, {
    op: 'duplicateLayer', layerId: 'a', newLayerId: 'copy', beforeId: 'missing',
  }, 'NOT_FOUND');
  if (!anchor.ok) assert.equal(anchor.error.path, '/beforeId');
});

test('duplicateLayer rejects authority overrides and hostile JSON with zero getter calls', () => {
  const directStyle = makeStyle();
  const directContext = makeContext();
  const direct = applyLayerOperation(directStyle, {
    op: 'duplicateLayer', layerId: 'a', newLayerId: 'copy', overrides: { id: 'stolen' },
  } as unknown as LayerLifecycleOperation, directContext);
  assert.equal(direct.ok, false);
  if (!direct.ok) assert.equal(direct.error.code, 'INVALID_INPUT');
  assert.deepEqual(directStyle.layers.map(({ id }) => id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual([...directContext.changedLayerIds], []);

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const dangerous = JSON.parse('{"__proto__":{"polluted":true}}') as JsonObject;
  class Exotic {
    readonly value = true;
  }
  let getterCalls = 0;
  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('must not run'); },
  });
  const beforePollution = Object.getOwnPropertyDescriptor(Object.prototype, 'polluted');

  for (const overrides of [cyclic, new Date(0), new Exotic(), dangerous, accessor]) {
    const style = makeStyle();
    assertAtomicFailure(style, {
      op: 'duplicateLayer', layerId: 'a', newLayerId: 'copy', overrides,
    }, 'INVALID_INPUT');
  }
  assert.equal(getterCalls, 0);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(Object.prototype, 'polluted'),
    beforePollution,
  );
});

test('moveLayer removes first, resolves reduced-array placement, and emits one exact move', () => {
  const style = makeStyle(['a', 'b', 'c', 'd']);
  const result = applyStyleTransaction(style, { operations: [{
    op: 'moveLayer', layerId: 'a', afterId: 'c',
  }] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.style.layers.map(({ id }) => id), ['b', 'c', 'a', 'd']);
  assert.deepEqual(result.changedLayers, ['a']);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, [{
    op: 'move', from: '/layers/0', path: '/layers/2',
    target: { kind: 'layer', id: 'a' },
  }]);
  assertReplay(style, result);
});

test('moveLayer reports true no-ops without marking candidates', () => {
  const style = makeStyle(['a', 'b', 'c']);
  const context = makeContext();
  const direct = applyLayerOperation(style, {
    op: 'moveLayer', layerId: 'b', beforeId: 'c',
  }, context);
  assert.deepEqual(direct, { ok: true, changed: false });
  assert.deepEqual([...context.changedLayerIds], []);
  assert.deepEqual(style.layers.map(({ id }) => id), ['a', 'b', 'c']);

  const transactionStyle = makeStyle(['a', 'b', 'c']);
  const result = applyStyleTransaction(transactionStyle, { operations: [{
    op: 'moveLayer', layerId: 'b', afterId: 'a',
  }] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.diff, []);
  assertReplay(transactionStyle, result);
});

test('moveLayer and reorderLayers default to the end when placement is omitted', () => {
  const movedStyle = makeStyle(['a', 'b', 'c']);
  const moved = applyStyleTransaction(movedStyle, { operations: [{
    op: 'moveLayer', layerId: 'b',
  }] });
  assert.equal(moved.ok, true);
  assert.deepEqual(moved.style.layers.map(({ id }) => id), ['a', 'c', 'b']);
  assert.deepEqual(moved.changedLayers, ['b']);
  assertReplay(movedStyle, moved);

  const reorderedStyle = makeStyle(['a', 'b', 'c', 'd', 'e']);
  const reordered = applyStyleTransaction(reorderedStyle, { operations: [{
    op: 'reorderLayers', layerIds: ['b', 'd'],
  }] });
  assert.equal(reordered.ok, true);
  assert.deepEqual(reordered.style.layers.map(({ id }) => id), ['a', 'c', 'e', 'b', 'd']);
  assert.deepEqual(reordered.changedLayers, ['b', 'd']);
  assertReplay(reorderedStyle, reordered);
});

test('moveLayer rejects missing layers, missing anchors, self anchors, and dual placement', () => {
  for (const [operation, expectedCode, expectedPath] of [
    [{ op: 'moveLayer', layerId: 'missing', beforeId: 'a' }, 'NOT_FOUND', '/layerId'],
    [{ op: 'moveLayer', layerId: 'a', beforeId: 'missing' }, 'NOT_FOUND', '/beforeId'],
    [{ op: 'moveLayer', layerId: 'a', afterId: 'a' },
      'INVALID_INPUT', '/operations/0/afterId'],
    [{ op: 'moveLayer', layerId: 'a', beforeId: 'b', afterId: 'c' },
      'INVALID_INPUT', '/operations/0/afterId'],
  ] as const) {
    const style = makeStyle();
    const result = assertAtomicFailure(style, operation, expectedCode);
    if (!result.ok) assert.equal(result.error.path, expectedPath);
  }
});

test('reorderLayers preserves request order for non-contiguous layers and stable moves', () => {
  const style = makeStyle(['a', 'b', 'c', 'd', 'e']);
  const directStyle = structuredClone(style);
  const context = makeContext();
  const direct = applyLayerOperation(directStyle, {
    op: 'reorderLayers', layerIds: ['d', 'b'], beforeId: 'a',
  }, context);
  assert.deepEqual(direct, { ok: true, changed: true });
  assert.deepEqual(directStyle.layers.map(({ id }) => id), ['d', 'b', 'a', 'c', 'e']);
  assert.deepEqual([...context.changedLayerIds], ['d', 'b']);

  const result = applyStyleTransaction(style, { operations: [{
    op: 'reorderLayers', layerIds: ['d', 'b'], beforeId: 'a',
  }] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.style.layers.map(({ id }) => id), ['d', 'b', 'a', 'c', 'e']);
  assert.deepEqual(result.changedLayers, ['d', 'b']);
  assert.deepEqual(result.diff, [
    {
      op: 'move', from: '/layers/3', path: '/layers/0',
      target: { kind: 'layer', id: 'd' },
    },
    {
      op: 'move', from: '/layers/2', path: '/layers/1',
      target: { kind: 'layer', id: 'b' },
    },
  ]);
  assertReplay(style, result);
});

test('reorderLayers plans replayable move targets in request order', () => {
  const style = makeStyle(['a', 'b', 'c']);
  const result = applyStyleTransaction(style, { operations: [{
    op: 'reorderLayers', layerIds: ['b', 'a'], afterId: 'c',
  }] });

  assert.equal(result.ok, true);
  assert.deepEqual(result.style.layers.map(({ id }) => id), ['c', 'b', 'a']);
  assert.deepEqual(result.changedLayers, ['b', 'a']);
  assert.deepEqual(result.diff, [
    {
      op: 'move', from: '/layers/1', path: '/layers/2',
      target: { kind: 'layer', id: 'b' },
    },
    {
      op: 'move', from: '/layers/0', path: '/layers/2',
      target: { kind: 'layer', id: 'a' },
    },
  ]);
  assertReplay(style, result);
});

test('reorderLayers exhaustive small-array diffs use a stable request-order subsequence', () => {
  const initialIds = ['a', 'b', 'c'] as const;
  let checked = 0;
  for (const layerIds of orderedNonEmptySelections(initialIds)) {
    const stationaryIds = initialIds.filter((layerId) => !layerIds.includes(layerId));
    const placements = [
      {},
      ...stationaryIds.flatMap((layerId) => [
        { beforeId: layerId },
        { afterId: layerId },
      ]),
    ];
    for (const placement of placements) {
      const style = makeStyle(initialIds);
      const result = applyStyleTransaction(style, { operations: [{
        op: 'reorderLayers', layerIds, ...placement,
      }] });
      assert.equal(result.ok, true, JSON.stringify({ layerIds, placement }));
      if (!result.ok) assert.fail('expected exhaustive reorder success');
      const moveTargets = result.diff.flatMap((entry) => (
        entry.op === 'move' && entry.target.kind === 'layer'
          ? [entry.target.id]
          : []
      ));
      assertStableSubsequence(moveTargets, layerIds);
      assert.deepEqual(result.changedLayers, moveTargets);
      assertReplay(style, result);
      if (result.style.layers.every((layer, index) => layer.id === initialIds[index])) {
        assert.deepEqual(result.diff, []);
        assert.deepEqual(result.changedLayers, []);
      }
      checked += 1;
    }
  }
  assert.equal(checked, 39);
});

test('reorderLayers no-op marks no candidates', () => {
  const style = makeStyle(['a', 'b', 'c', 'd']);
  const context = makeContext();
  const result = applyLayerOperation(style, {
    op: 'reorderLayers', layerIds: ['b', 'c'], beforeId: 'd',
  }, context);
  assert.deepEqual(result, { ok: true, changed: false });
  assert.deepEqual([...context.changedLayerIds], []);
  assert.deepEqual(style.layers.map(({ id }) => id), ['a', 'b', 'c', 'd']);
});

test('reorderLayers rejects duplicates, missing IDs, anchors in the set, and dual placement', () => {
  for (const [operation, expectedCode, expectedPath] of [
    [{ op: 'reorderLayers', layerIds: ['a', 'a'] },
      'INVALID_INPUT', '/operations/0/layerIds/1'],
    [{ op: 'reorderLayers', layerIds: ['a', 'missing'] },
      'NOT_FOUND', '/layerIds/1'],
    [{ op: 'reorderLayers', layerIds: ['d', 'b'], beforeId: 'missing' },
      'NOT_FOUND', '/beforeId'],
    [{ op: 'reorderLayers', layerIds: ['d', 'b'], beforeId: 'b' },
      'INVALID_INPUT', '/operations/0/beforeId'],
    [{ op: 'reorderLayers', layerIds: ['d', 'b'], beforeId: 'a', afterId: 'c' },
      'INVALID_INPUT', '/operations/0/afterId'],
  ] as const) {
    const style = makeStyle();
    const result = assertAtomicFailure(style, operation, expectedCode);
    if (!result.ok) assert.equal(result.error.path, expectedPath);
  }
});

test('removeLayer uses array paths while unusual IDs remain exact semantic targets', () => {
  const unusualId = 'roads/main~casing';
  const style = makeStyle([unusualId, 'labels']);
  const result = applyStyleTransaction(style, { operations: [{
    op: 'removeLayer', layerId: unusualId,
  }] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.style.layers.map(({ id }) => id), ['labels']);
  assert.deepEqual(result.changedLayers, [unusualId]);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, [{
    op: 'remove', path: '/layers/0',
    before: { id: unusualId, type: 'background' },
    target: { kind: 'layer', id: unusualId },
  }]);
  assertReplay(style, result);
});

test('source object-key paths still escape slash and tilde beside layer lifecycle diffs', () => {
  const sourceId = 'source/main~live';
  const style = makeStyle([]);
  const result = applyStyleTransaction(style, { operations: [{
    op: 'addSource',
    sourceId,
    source: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  }] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.diff, [{
    op: 'add',
    path: '/sources/source~1main~0live',
    after: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    target: { kind: 'source', id: sourceId },
  }]);
  assertReplay(style, result);
});

test('removeLayer returns NOT_FOUND before mutation', () => {
  const style = makeStyle();
  const result = assertAtomicFailure(style, {
    op: 'removeLayer', layerId: 'missing',
  }, 'NOT_FOUND');
  if (!result.ok) assert.equal(result.error.path, '/layerId');
});
