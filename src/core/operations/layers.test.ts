import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replayStyleDiff } from '../diff.js';
import {
  addLayerFromSourceOperationSchema,
  createStyleTransactionSchema,
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
  AddLayerFromSourceOperation,
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

function makeSourceStyle(): StyleDocument {
  const coordinates: [number, number][] = [[0, 1], [1, 1], [1, 0], [0, 0]];
  return {
    version: 8,
    sources: {
      vector: {
        type: 'vector',
        tiles: ['https://example.test/vector/{z}/{x}/{y}.pbf'],
      },
      geo: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      },
      raster: {
        type: 'raster',
        tiles: ['https://example.test/raster/{z}/{x}/{y}.png'],
        tileSize: 256,
      },
      dem: {
        type: 'raster-dem',
        tiles: ['https://example.test/dem/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
      },
      image: {
        type: 'image',
        url: 'https://example.test/image.png',
        coordinates,
      },
      video: {
        type: 'video',
        urls: ['https://example.test/video.mp4'],
        coordinates: structuredClone(coordinates),
      },
    },
    layers: [{ id: 'background', type: 'background' }],
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

test('addLayerFromSource parses and creates a vector layer with an exact replayable diff', () => {
  const style = makeSourceStyle();
  const operation = {
    op: 'addLayerFromSource',
    layerId: 'roads/main~casing',
    sourceId: 'vector',
    sourceLayer: 'transportation',
    type: 'line',
  };

  assert.equal(styleOperationSchema.safeParse(operation).success, true);
  const result = applyStyleTransaction(style, { operations: [operation] });
  assert.equal(result.ok, true);
  const expected = {
    id: 'roads/main~casing',
    source: 'vector',
    'source-layer': 'transportation',
    type: 'line',
  };
  assert.deepEqual(result.style.layers, [
    { id: 'background', type: 'background' },
    expected,
  ]);
  assert.deepEqual(result.changedLayers, ['roads/main~casing']);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, [{
    op: 'add', path: '/layers/1', after: expected,
    target: { kind: 'layer', id: 'roads/main~casing' },
  }]);
  assertReplay(style, result);
});

test('addLayerFromSource accepts canonical vector, GeoJSON, raster, and DEM combinations', () => {
  const fixtures = [
    {
      operation: {
        op: 'addLayerFromSource', layerId: 'roads', sourceId: 'vector',
        sourceLayer: 'transportation', type: 'line',
      },
      expected: {
        id: 'roads', source: 'vector', 'source-layer': 'transportation', type: 'line',
      },
    },
    {
      operation: {
        op: 'addLayerFromSource', layerId: 'points', sourceId: 'geo', type: 'circle',
      },
      expected: { id: 'points', source: 'geo', type: 'circle' },
    },
    {
      operation: {
        op: 'addLayerFromSource', layerId: 'imagery', sourceId: 'raster', type: 'raster',
      },
      expected: { id: 'imagery', source: 'raster', type: 'raster' },
    },
    {
      operation: {
        op: 'addLayerFromSource', layerId: 'terrain', sourceId: 'dem', type: 'hillshade',
      },
      expected: { id: 'terrain', source: 'dem', type: 'hillshade' },
    },
  ] as const;

  for (const { operation, expected } of fixtures) {
    const style = makeSourceStyle();
    const result = applyStyleTransaction(style, { operations: [operation] });
    assert.equal(result.ok, true, operation.layerId);
    assert.deepEqual(result.style.layers.at(-1), expected);
    assert.deepEqual(result.changedLayers, [operation.layerId]);
    assert.deepEqual(result.changedSources, []);
    assertReplay(style, result);
  }
});

test('addLayerFromSource enforces actionable source-layer preconditions', () => {
  for (const sourceLayer of [undefined, '', ' \t'] as const) {
    const style = makeSourceStyle();
    const operation = {
      op: 'addLayerFromSource', layerId: 'roads', sourceId: 'vector',
      type: 'line', ...(sourceLayer === undefined ? {} : { sourceLayer }),
    };
    const result = assertAtomicFailure(style, operation, 'INVALID_INPUT');
    if (!result.ok) {
      assert.match(result.error.path ?? '', /sourceLayer$/);
    }
  }

  for (const sourceId of ['geo', 'raster', 'dem', 'image', 'video'] as const) {
    const style = makeSourceStyle();
    const result = assertAtomicFailure(style, {
      op: 'addLayerFromSource', layerId: `${sourceId}-layer`, sourceId,
      sourceLayer: 'forbidden', type: sourceId === 'dem' ? 'hillshade' : 'raster',
    }, 'INVALID_INPUT');
    if (!result.ok) {
      assert.equal(result.error.path, '/sourceLayer');
      assert.deepEqual(result.error.details, {
        sourceId,
        sourceType: sourceId === 'geo' ? 'geojson'
          : sourceId === 'dem' ? 'raster-dem'
            : sourceId,
      });
    }
  }
});

test('addLayerFromSource rejects missing sources and layer ID collisions before mutation', () => {
  const missingStyle = makeSourceStyle();
  const missing = assertAtomicFailure(missingStyle, {
    op: 'addLayerFromSource', layerId: 'new', sourceId: 'missing', type: 'line',
  }, 'NOT_FOUND');
  if (!missing.ok) {
    assert.equal(missing.error.path, '/sourceId');
    assert.deepEqual(missing.error.details, { sourceId: 'missing' });
  }

  const collisionStyle = makeSourceStyle();
  const collision = assertAtomicFailure(collisionStyle, {
    op: 'addLayerFromSource', layerId: 'background', sourceId: 'geo', type: 'circle',
  }, 'CONFLICT');
  if (!collision.ok) {
    assert.equal(collision.error.path, '/layerId');
    assert.deepEqual(collision.error.details, { layerId: 'background' });
  }
});

test('addLayerFromSource preserves exact sanitized field snapshots and default placement', () => {
  const style = makeSourceStyle();
  const paint: JsonObject = { 'line-color': '#123456', 'line-width': 3 };
  const layout: JsonObject = { 'line-cap': 'round', visibility: 'none' };
  const filter: JsonValue[] = ['==', 'class', 'primary'];
  const metadata: JsonObject = { owner: 'maps', nested: { reviewed: true } };
  const result = applyStyleTransaction(style, { operations: [{
    op: 'addLayerFromSource',
    layerId: 'primary-roads',
    sourceId: 'vector',
    sourceLayer: 'transportation',
    type: 'line',
    paint,
    layout,
    filter,
    minzoom: 3,
    maxzoom: 17,
    metadata,
  }] });
  const expected = {
    id: 'primary-roads',
    source: 'vector',
    'source-layer': 'transportation',
    type: 'line',
    paint,
    layout,
    filter,
    minzoom: 3,
    maxzoom: 17,
    metadata,
  };

  assert.equal(result.ok, true);
  assert.deepEqual(result.style.layers.at(-1), expected);
  assert.notStrictEqual(result.style.layers.at(-1)?.paint, paint);
  assert.notStrictEqual(result.style.layers.at(-1)?.layout, layout);
  assert.notStrictEqual(result.style.layers.at(-1)?.filter, filter);
  assert.notStrictEqual(result.style.layers.at(-1)?.metadata, metadata);
  assert.deepEqual(result.diff, [{
    op: 'add', path: '/layers/1', after: expected,
    target: { kind: 'layer', id: 'primary-roads' },
  }]);
  paint['line-color'] = '#ffffff';
  layout.visibility = 'visible';
  filter[1] = 'mutated';
  metadata.owner = 'mutated';
  assert.equal(result.style.layers.at(-1)?.paint?.['line-color'], '#123456');
  assert.equal(result.style.layers.at(-1)?.layout?.visibility, 'none');
  assert.equal((result.style.layers.at(-1)?.filter as JsonValue[] | undefined)?.[1], 'class');
  assert.equal((result.style.layers.at(-1)?.metadata as JsonObject | undefined)?.owner, 'maps');
  assertReplay(style, result);
});

test('addLayerFromSource supports before and after placement and rejects invalid placement', () => {
  const beforeStyle = makeSourceStyle();
  beforeStyle.layers.push({ id: 'labels', type: 'background' });
  const before = applyStyleTransaction(beforeStyle, { operations: [{
    op: 'addLayerFromSource', layerId: 'roads', sourceId: 'vector',
    sourceLayer: 'transportation', type: 'line', beforeId: 'labels',
  }] });
  assert.equal(before.ok, true);
  assert.deepEqual(before.style.layers.map(({ id }) => id), ['background', 'roads', 'labels']);
  assert.equal(before.diff[0]?.path, '/layers/1');
  assertReplay(beforeStyle, before);

  const afterStyle = makeSourceStyle();
  const after = applyStyleTransaction(afterStyle, { operations: [{
    op: 'addLayerFromSource', layerId: 'roads', sourceId: 'vector',
    sourceLayer: 'transportation', type: 'line', afterId: 'background',
  }] });
  assert.equal(after.ok, true);
  assert.deepEqual(after.style.layers.map(({ id }) => id), ['background', 'roads']);
  assertReplay(afterStyle, after);

  for (const [operation, expectedPath] of [
    [{
      op: 'addLayerFromSource', layerId: 'roads', sourceId: 'vector',
      sourceLayer: 'transportation', type: 'line', beforeId: 'missing',
    }, '/beforeId'],
    [{
      op: 'addLayerFromSource', layerId: 'roads', sourceId: 'vector',
      sourceLayer: 'transportation', type: 'line',
      beforeId: 'background', afterId: 'background',
    }, '/operations/0/afterId'],
  ] as const) {
    const style = makeSourceStyle();
    const result = assertAtomicFailure(style, operation, expectedPath.includes('operations')
      ? 'INVALID_INPUT'
      : 'NOT_FOUND');
    if (!result.ok) assert.equal(result.error.path, expectedPath);
  }
});

test('addLayerFromSource defers full source and paint compatibility to canonical validation', () => {
  for (const operation of [
    {
      op: 'addLayerFromSource', layerId: 'wrong-source', sourceId: 'raster', type: 'line',
    },
    {
      op: 'addLayerFromSource', layerId: 'wrong-paint', sourceId: 'vector',
      sourceLayer: 'transportation', type: 'line', paint: { 'fill-color': '#fff' },
    },
  ]) {
    const style = makeSourceStyle();
    const result = assertAtomicFailure(style, operation, 'STYLE_INVALID');
    assert.strictEqual(result.style, style);
  }
});

test('addLayerFromSource schema is strict, descriptor-safe, and authority-key closed', () => {
  const valid: AddLayerFromSourceOperation = {
    op: 'addLayerFromSource', layerId: 'roads', sourceId: 'vector',
    sourceLayer: 'transportation', type: 'line', beforeId: 'labels',
  };
  assert.equal(addLayerFromSourceOperationSchema.safeParse(valid).success, true);
  assert.equal(styleOperationSchema.safeParse(valid).success, true);
  for (const extra of [
    { unknown: true },
    { id: 'stolen' },
    { source: 'stolen' },
    { extension: { id: 'stolen', source: 'stolen' } },
  ]) {
    const operation = { ...valid, ...extra };
    assert.equal(addLayerFromSourceOperationSchema.safeParse(operation).success, false);
    assert.equal(styleOperationSchema.safeParse(operation).success, false);
    assertAtomicFailure(makeSourceStyle(), operation, 'INVALID_INPUT');
  }

  const cyclic: Record<string, unknown> = { ...valid, paint: {} };
  (cyclic.paint as Record<string, unknown>).self = cyclic.paint;
  const dangerous = {
    ...valid,
    paint: JSON.parse('{"__proto__":{"polluted":true}}') as JsonObject,
  };
  class Exotic { readonly value = true; }
  let getterCalls = 0;
  const accessor: Record<string, unknown> = { ...valid };
  Object.defineProperty(accessor, 'paint', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('must not run'); },
  });
  for (const operation of [cyclic, dangerous, { ...valid, paint: new Exotic() }, accessor]) {
    assert.equal(addLayerFromSourceOperationSchema.safeParse(operation).success, false);
    assert.equal(styleOperationSchema.safeParse(operation).success, false);
    assertAtomicFailure(makeSourceStyle(), operation, 'INVALID_INPUT');
  }
  assert.equal(getterCalls, 0);
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});

test('addLayerFromSource polluted fallback matches clean nonblank lifecycle contracts', () => {
  const fixtures = [
    { field: 'layerId', value: ' \t' },
    { field: 'sourceId', value: '\n' },
    { field: 'sourceLayer', value: ' ' },
    { field: 'type', value: '\t' },
    { field: 'beforeId', value: '\n' },
    { field: 'afterId', value: ' ' },
  ] as const;
  const base = {
    op: 'addLayerFromSource', layerId: 'roads', sourceId: 'vector',
    sourceLayer: 'transportation', type: 'line',
  } as const;
  const cleanIssues = fixtures.map(({ field, value }) => {
    const result = addLayerFromSourceOperationSchema.safeParse({ ...base, [field]: value });
    assert.equal(result.success, false);
    if (result.success) assert.fail('expected clean whitespace rejection');
    assert.deepEqual(result.error.issues, [{
      code: 'custom', path: [field], message: 'Expected a non-empty string',
    }]);
    return result.error.issues;
  });

  const key = 'addLayerFromSourceFallbackProbe';
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
  try {
    Object.defineProperty(Object.prototype, key, {
      configurable: true, value: true, writable: true,
    });
    assert.equal(addLayerFromSourceOperationSchema.safeParse(base).success, true);
    assert.equal(styleOperationSchema.safeParse(base).success, true);
    for (let index = 0; index < fixtures.length; index += 1) {
      const { field, value } = fixtures[index]!;
      const operation = { ...base, [field]: value };
      const direct = addLayerFromSourceOperationSchema.safeParse(operation);
      const union = styleOperationSchema.safeParse(operation);
      assert.equal(direct.success, false);
      assert.equal(union.success, false);
      if (direct.success || union.success) assert.fail('expected polluted whitespace rejection');
      assert.deepEqual(direct.error.issues, cleanIssues[index]);
      assert.deepEqual(union.error.issues, cleanIssues[index]);
      const transaction = assertAtomicFailure(makeSourceStyle(), operation, 'INVALID_INPUT');
      if (!transaction.ok) {
        assert.equal(transaction.error.path, `/operations/0/${field}`);
      }
    }
  } finally {
    if (originalDescriptor === undefined) Reflect.deleteProperty(Object.prototype, key);
    else Object.defineProperty(Object.prototype, key, originalDescriptor);
  }
});

test('addLayerFromSource polluted fallback preserves every native first issue', () => {
  const base = {
    op: 'addLayerFromSource', layerId: 'roads', sourceId: 'vector',
    sourceLayer: 'transportation', type: 'line',
  } as const;
  const fixtures: Array<{
    name: string;
    operation: Record<string, unknown>;
    issue: Record<string, unknown> & { path: Array<string | number> };
  }> = [
    {
      name: 'missing layerId',
      operation: {
        op: 'addLayerFromSource', sourceId: 'vector',
        sourceLayer: 'transportation', type: 'line',
      },
      issue: {
        expected: 'string', code: 'invalid_type', path: ['layerId'],
        message: 'Invalid input: expected string, received undefined',
      },
    },
    {
      name: 'non-string layerId',
      operation: { ...base, layerId: 1 },
      issue: {
        expected: 'string', code: 'invalid_type', path: ['layerId'],
        message: 'Invalid input: expected string, received number',
      },
    },
    {
      name: 'missing sourceId',
      operation: {
        op: 'addLayerFromSource', layerId: 'roads',
        sourceLayer: 'transportation', type: 'line',
      },
      issue: {
        expected: 'string', code: 'invalid_type', path: ['sourceId'],
        message: 'Invalid input: expected string, received undefined',
      },
    },
    {
      name: 'non-string sourceId',
      operation: { ...base, sourceId: 1 },
      issue: {
        expected: 'string', code: 'invalid_type', path: ['sourceId'],
        message: 'Invalid input: expected string, received number',
      },
    },
    {
      name: 'missing type',
      operation: {
        op: 'addLayerFromSource', layerId: 'roads', sourceId: 'vector',
        sourceLayer: 'transportation',
      },
      issue: {
        expected: 'string', code: 'invalid_type', path: ['type'],
        message: 'Invalid input: expected string, received undefined',
      },
    },
    {
      name: 'non-string type',
      operation: { ...base, type: 1 },
      issue: {
        expected: 'string', code: 'invalid_type', path: ['type'],
        message: 'Invalid input: expected string, received number',
      },
    },
    {
      name: 'non-string sourceLayer',
      operation: { ...base, sourceLayer: 1 },
      issue: {
        expected: 'string', code: 'invalid_type', path: ['sourceLayer'],
        message: 'Invalid input: expected string, received number',
      },
    },
    {
      name: 'blank sourceLayer',
      operation: { ...base, sourceLayer: ' ' },
      issue: {
        code: 'custom', path: ['sourceLayer'], message: 'Expected a non-empty string',
      },
    },
    {
      name: 'non-object paint',
      operation: { ...base, paint: [] },
      issue: {
        expected: 'record', code: 'invalid_type', path: ['paint'],
        message: 'Invalid input: expected record, received array',
      },
    },
    {
      name: 'non-object layout',
      operation: { ...base, layout: [] },
      issue: {
        expected: 'record', code: 'invalid_type', path: ['layout'],
        message: 'Invalid input: expected record, received array',
      },
    },
    {
      name: 'non-object metadata',
      operation: { ...base, metadata: [] },
      issue: {
        expected: 'record', code: 'invalid_type', path: ['metadata'],
        message: 'Invalid input: expected record, received array',
      },
    },
    {
      name: 'non-array filter',
      operation: { ...base, filter: {} },
      issue: {
        expected: 'array', code: 'invalid_type', path: ['filter'],
        message: 'Invalid input: expected array, received object',
      },
    },
    {
      name: 'non-number minzoom',
      operation: { ...base, minzoom: '1' },
      issue: {
        expected: 'number', code: 'invalid_type', path: ['minzoom'],
        message: 'Invalid input: expected number, received string',
      },
    },
    {
      name: 'non-number maxzoom',
      operation: { ...base, maxzoom: '2' },
      issue: {
        expected: 'number', code: 'invalid_type', path: ['maxzoom'],
        message: 'Invalid input: expected number, received string',
      },
    },
    {
      name: 'reversed zoom',
      operation: { ...base, minzoom: 3, maxzoom: 2 },
      issue: {
        code: 'custom', path: ['maxzoom'],
        message: 'minzoom must be less than or equal to maxzoom',
      },
    },
    {
      name: 'dual placement',
      operation: { ...base, beforeId: 'a', afterId: 'b' },
      issue: {
        code: 'custom', path: ['afterId'],
        message: 'Placement cannot specify both beforeId and afterId',
      },
    },
    {
      name: 'unknown key',
      operation: { ...base, unknown: true },
      issue: {
        code: 'unrecognized_keys', keys: ['unknown'], path: [],
        message: 'Unrecognized key: "unknown"',
      },
    },
  ];
  const transactionSchema = createStyleTransactionSchema(5);
  const padded = {
    op: 'addLayerFromSource', layerId: ' roads ', sourceId: ' vector ',
    sourceLayer: ' transportation ', type: ' line ', beforeId: ' labels ',
  } as const;
  let getterCalls = 0;
  const accessorOperation: Record<string, unknown> = { ...base };
  Object.defineProperty(accessorOperation, 'paint', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('must not run'); },
  });

  const issues = (result: {
    success: boolean;
    error?: { issues: unknown[] };
  }): unknown[] => {
    assert.equal(result.success, false);
    if (result.success || result.error === undefined) assert.fail('expected schema failure');
    return result.error.issues;
  };
  const assertMatrix = (): void => {
    for (const { name, operation, issue } of fixtures) {
      assert.deepEqual(
        issues(addLayerFromSourceOperationSchema.safeParse(operation)),
        [issue],
        `direct: ${name}`,
      );
      assert.deepEqual(
        issues(styleOperationSchema.safeParse(operation)),
        [issue],
        `union: ${name}`,
      );
      assert.deepEqual(
        issues(transactionSchema.safeParse({ operations: [operation] })),
        [{ ...issue, path: ['operations', 0, ...issue.path] }],
        `transaction: ${name}`,
      );
    }

    const directPadded = addLayerFromSourceOperationSchema.safeParse(padded);
    const unionPadded = styleOperationSchema.safeParse(padded);
    const transactionPadded = transactionSchema.safeParse({ operations: [padded] });
    assert.equal(directPadded.success, true);
    assert.equal(unionPadded.success, true);
    assert.equal(transactionPadded.success, true);
    if (!directPadded.success || !unionPadded.success || !transactionPadded.success) {
      assert.fail('expected padded operations to remain valid');
    }
    if (unionPadded.data.op !== 'addLayerFromSource'
      || transactionPadded.data.operations[0]?.op !== 'addLayerFromSource') {
      assert.fail('expected addLayerFromSource outputs');
    }
    assert.equal(directPadded.data.layerId, ' roads ');
    assert.equal(unionPadded.data.layerId, ' roads ');
    assert.equal(transactionPadded.data.operations[0]?.layerId, ' roads ');

    assert.equal(addLayerFromSourceOperationSchema.safeParse(accessorOperation).success, false);
    assert.equal(styleOperationSchema.safeParse(accessorOperation).success, false);
    assert.equal(transactionSchema.safeParse({ operations: [accessorOperation] }).success, false);
  };

  assertMatrix();
  assert.equal(getterCalls, 0);

  const pollutionKey = 'addLayerFromSourceDiagnosticFallbackProbe';
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, pollutionKey);
  try {
    Object.defineProperty(Object.prototype, pollutionKey, {
      configurable: true,
      enumerable: false,
      value: 'unrelated',
      writable: true,
    });
    assertMatrix();
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

test('addLayerFromSource polluted fallback preserves native literal op issues', () => {
  const issue = {
    code: 'invalid_value', values: ['addLayerFromSource'], path: ['op'],
    message: 'Invalid input: expected "addLayerFromSource"',
  };
  const operations: Record<string, unknown>[] = [
    { layerId: 'roads', sourceId: 'vector', type: 'line' },
    { op: 'addSource', layerId: 'roads', sourceId: 'vector', type: 'line' },
    { op: null, layerId: 'roads', sourceId: 'vector', type: 'line' },
  ];
  const firstIssue = (operation: Record<string, unknown>): unknown => {
    const result = addLayerFromSourceOperationSchema.safeParse(operation);
    assert.equal(result.success, false);
    if (result.success) assert.fail('expected invalid operation discriminator');
    return result.error.issues[0];
  };

  for (const operation of operations) assert.deepEqual(firstIssue(operation), issue);

  const pollutionKey = 'addLayerFromSourceLiteralIssueProbe';
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, pollutionKey);
  try {
    Object.defineProperty(Object.prototype, pollutionKey, {
      configurable: true, value: true, writable: true,
    });
    for (const operation of operations) assert.deepEqual(firstIssue(operation), issue);
  } finally {
    if (originalDescriptor === undefined) Reflect.deleteProperty(Object.prototype, pollutionKey);
    else Object.defineProperty(Object.prototype, pollutionKey, originalDescriptor);
  }
});

test('configured transaction fallback reports the first invalid operation in order', () => {
  const laterInvalidLayer = {
    op: 'addLayerFromSource', layerId: 'roads', sourceId: 'vector',
    sourceLayer: ' ', type: 'line',
  } as const;
  const fixtures: Array<{
    name: string;
    first: Record<string, unknown>;
    issue: Record<string, unknown>;
  }> = [
    {
      name: 'source ID type',
      first: { op: 'addSource', sourceId: 1, source: { type: 'geojson' } },
      issue: {
        expected: 'string', code: 'invalid_type', path: ['operations', 0, 'sourceId'],
        message: 'Invalid input: expected string, received number',
      },
    },
    {
      name: 'source object type',
      first: { op: 'addSource', sourceId: 'geo', source: [] },
      issue: {
        expected: 'record', code: 'invalid_type', path: ['operations', 0, 'source'],
        message: 'Invalid input: expected record, received array',
      },
    },
    {
      name: 'lifecycle required ID',
      first: { op: 'removeLayer' },
      issue: {
        expected: 'string', code: 'invalid_type', path: ['operations', 0, 'layerId'],
        message: 'Invalid input: expected string, received undefined',
      },
    },
    {
      name: 'source filter ID type',
      first: { op: 'setGeoJsonSourceFilter', sourceId: 1, mode: 'clear' },
      issue: {
        expected: 'string', code: 'invalid_type', path: ['operations', 0, 'sourceId'],
        message: 'Invalid input: expected string, received number',
      },
    },
    {
      name: 'layer filter discriminator',
      first: { op: 'setLayerFilter', layerId: 'roads', mode: 'invalid' },
      issue: {
        code: 'invalid_union', errors: [], note: 'No matching discriminator',
        discriminator: 'mode', options: ['replace', 'and', 'or', 'clear'],
        path: ['operations', 0, 'mode'],
        message: "Invalid discriminator value. Expected 'replace' | 'and' | 'or' | 'clear'",
      },
    },
  ];
  const schema = createStyleTransactionSchema(5);
  const firstIssue = (first: Record<string, unknown>): unknown => {
    const result = schema.safeParse({ operations: [first, laterInvalidLayer] });
    assert.equal(result.success, false);
    if (result.success) assert.fail('expected invalid transaction');
    return result.error.issues[0];
  };

  for (const { name, first, issue } of fixtures) {
    assert.deepEqual(firstIssue(first), issue, `clean: ${name}`);
  }

  const pollutionKey = 'transactionFallbackOrderProbe';
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, pollutionKey);
  try {
    Object.defineProperty(Object.prototype, pollutionKey, {
      configurable: true, value: true, writable: true,
    });
    for (const { name, first, issue } of fixtures) {
      assert.deepEqual(firstIssue(first), issue, `polluted: ${name}`);
    }
  } finally {
    if (originalDescriptor === undefined) Reflect.deleteProperty(Object.prototype, pollutionKey);
    else Object.defineProperty(Object.prototype, pollutionKey, originalDescriptor);
  }
});

test('duplicateLayer fallback preserves native field issue order', () => {
  const fixtures: Array<{
    name: string;
    operation: Record<string, unknown>;
    issue: Record<string, unknown> & { path: Array<string | number> };
  }> = [
    {
      name: 'layerId before every later field',
      operation: {
        op: 'duplicateLayer', layerId: 1, newLayerId: 2,
        overrides: [], beforeId: 3, afterId: 4,
      },
      issue: {
        expected: 'string', code: 'invalid_type', path: ['layerId'],
        message: 'Invalid input: expected string, received number',
      },
    },
    {
      name: 'newLayerId before overrides and placement',
      operation: {
        op: 'duplicateLayer', layerId: 'l', newLayerId: 2,
        overrides: [], beforeId: 3, afterId: 4,
      },
      issue: {
        expected: 'string', code: 'invalid_type', path: ['newLayerId'],
        message: 'Invalid input: expected string, received number',
      },
    },
    {
      name: 'overrides before placement',
      operation: {
        op: 'duplicateLayer', layerId: 'l', newLayerId: 'n',
        overrides: [], beforeId: 1,
      },
      issue: {
        expected: 'record', code: 'invalid_type', path: ['overrides'],
        message: 'Invalid input: expected record, received array',
      },
    },
    {
      name: 'beforeId before afterId',
      operation: {
        op: 'duplicateLayer', layerId: 'l', newLayerId: 'n',
        beforeId: 1, afterId: 2,
      },
      issue: {
        expected: 'string', code: 'invalid_type', path: ['beforeId'],
        message: 'Invalid input: expected string, received number',
      },
    },
    {
      name: 'afterId last',
      operation: {
        op: 'duplicateLayer', layerId: 'l', newLayerId: 'n', afterId: 2,
      },
      issue: {
        expected: 'string', code: 'invalid_type', path: ['afterId'],
        message: 'Invalid input: expected string, received number',
      },
    },
  ];
  const transactionSchema = createStyleTransactionSchema(2);
  const firstIssue = (result: {
    success: boolean;
    error?: { issues: unknown[] };
  }): unknown => {
    assert.equal(result.success, false);
    if (result.success || result.error === undefined) assert.fail('expected schema failure');
    return result.error.issues[0];
  };
  const assertMatrix = (): void => {
    for (const { name, operation, issue } of fixtures) {
      assert.deepEqual(
        firstIssue(duplicateLayerOperationSchema.safeParse(operation)),
        issue,
        `direct: ${name}`,
      );
      assert.deepEqual(
        firstIssue(transactionSchema.safeParse({ operations: [operation] })),
        { ...issue, path: ['operations', 0, ...issue.path] },
        `transaction: ${name}`,
      );
    }
  };

  assertMatrix();
  const pollutionKey = 'duplicateLayerIssueOrderProbe';
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, pollutionKey);
  try {
    Object.defineProperty(Object.prototype, pollutionKey, {
      configurable: true, value: true, writable: true,
    });
    assertMatrix();
  } finally {
    if (originalDescriptor === undefined) Reflect.deleteProperty(Object.prototype, pollutionKey);
    else Object.defineProperty(Object.prototype, pollutionKey, originalDescriptor);
  }
});

test('addLayerFromSource handles 20k-deep JSON fields without stack overflow', () => {
  const style = makeSourceStyle();
  const deep = makeDeepJsonObject(DEEP_JSON_DEPTH, 'leaf');
  const result = applyStyleTransaction(style, {
    validate: false,
    operations: [{
      op: 'addLayerFromSource', layerId: 'deep', sourceId: 'vector',
      sourceLayer: 'transportation', type: 'line', paint: { extension: deep },
    }],
  });

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('expected deep layer creation success');
  assertDeepJsonObject(result.style.layers.at(-1)?.paint?.extension, DEEP_JSON_DEPTH, 'leaf');
  assertDeepJsonObject(
    ((result.diff[0]?.after as JsonObject | undefined)?.paint as JsonObject | undefined)?.extension,
    DEEP_JSON_DEPTH,
    'leaf',
  );
  const replayed = replayStyleDiff(style, result.diff);
  assert.deepEqual(replayed.layers.map(({ id }) => id), ['background', 'deep']);
  assertDeepJsonObject(replayed.layers.at(-1)?.paint?.extension, DEEP_JSON_DEPTH, 'leaf');
});

test('addLayerFromSource reads no source metadata beyond the source object type', () => {
  let metadataReads = 0;
  let sourceTypeReads = 0;
  const source = new Proxy({ type: 'vector' }, {
    get(target, property, receiver) {
      if (property === 'type') {
        sourceTypeReads += 1;
        if (sourceTypeReads > 1) throw new Error('source type must be read exactly once');
      } else {
        metadataReads += 1;
        throw new Error(`unexpected source metadata read: ${String(property)}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const style = {
    version: 8,
    sources: { vector: source },
    layers: [],
  } as unknown as StyleDocument;
  const context = makeContext();
  const operation = {
    op: 'addLayerFromSource', layerId: 'authoritative', sourceId: 'vector',
    sourceLayer: 'transportation', type: 'line',
    id: 'stolen', source: 'stolen', extension: { id: 'also-stolen' },
  } as unknown as AddLayerFromSourceOperation;
  const result = applyLayerOperation(style, operation, context);

  assert.deepEqual(result, { ok: true, changed: true });
  assert.equal(sourceTypeReads, 1);
  assert.equal(metadataReads, 0);
  assert.deepEqual(style.layers, [{
    id: 'authoritative', source: 'vector',
    'source-layer': 'transportation', type: 'line',
  }]);
  assert.deepEqual([...context.changedLayerIds], ['authoritative']);
  assert.deepEqual([...context.changedSourceIds], []);
});
