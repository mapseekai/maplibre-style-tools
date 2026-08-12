import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStyleToolError } from '../errors.js';
import { replayStyleDiff } from '../diff.js';
import {
  addSourceOperationSchema,
  duplicateSourceOperationSchema,
  patchSourceOperationSchema,
  removeSourceOperationSchema,
  renameSourceOperationSchema,
  setGeoJsonDataOperationSchema,
  styleOperationSchema,
} from '../schemas.js';
import { applyStyleTransaction } from '../transaction.js';
import {
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
  jsonUtf8ByteLength,
} from '../utf8.js';
import type {
  CoreExecutionLimits,
  JsonObject,
  JsonValue,
  OperationContext,
  SourceOperation,
  StyleDiffEntry,
  StyleDocument,
  StyleSource,
} from '../types.js';
import { applySourceOperation } from './sources.js';

const TEST_LIMITS: Readonly<CoreExecutionLimits> = Object.freeze({
  maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
  maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
  maxOperations: DEFAULT_MAX_OPERATIONS,
});

const DEEP_JSON_DEPTH = 20_000;

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

function assertDeepJsonObject(value: JsonValue | undefined, depth: number, leaf: JsonValue): void {
  let current = value;
  for (let index = 0; index < depth; index += 1) {
    assert.equal(typeof current, 'object');
    assert.notEqual(current, null);
    assert.equal(Array.isArray(current), false);
    const object = current as JsonObject;
    assert.deepEqual(Object.keys(object), ['next']);
    current = object.next;
  }
  assert.equal(typeof current, 'object');
  assert.notEqual(current, null);
  assert.equal(Array.isArray(current), false);
  assert.deepEqual(Object.keys(current as JsonObject), ['value']);
  assert.equal((current as JsonObject).value, leaf);
}

function makeContext(limits: Readonly<CoreExecutionLimits> = TEST_LIMITS): OperationContext {
  return {
    limits,
    changedLayerIds: new Set(),
    changedSourceIds: new Set(),
    warnings: [],
  };
}

function makeStyle(): StyleDocument {
  return {
    version: 8,
    sources: {
      geo: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterRadius: 50,
      },
      vector: {
        type: 'vector',
        tiles: ['https://example.test/vector/{z}/{x}/{y}.pbf'],
        minzoom: 0,
        maxzoom: 14,
        promoteId: { roads: 'road_id', labels: 'label_id' },
      },
      raster: {
        type: 'raster',
        tiles: ['https://example.test/raster/{z}/{x}/{y}.png'],
        tileSize: 256,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
      {
        id: 'roads', type: 'line', source: 'vector', 'source-layer': 'roads',
        paint: { 'line-color': '#000' },
      },
      {
        id: 'places', type: 'circle', source: 'geo',
        paint: { 'circle-radius': 4 },
      },
    ],
  };
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

test('source schemas are strict descriptor-sanitized closed variants', () => {
  const valid: readonly [SourceOperation, { safeParse(value: unknown): { success: boolean } }][] = [
    [{ op: 'addSource', sourceId: 'added', source: { type: 'geojson', data: 'url' } },
      addSourceOperationSchema],
    [{ op: 'duplicateSource', sourceId: 'geo', newSourceId: 'copy' },
      duplicateSourceOperationSchema],
    [{ op: 'renameSource', sourceId: 'geo', newSourceId: 'renamed' },
      renameSourceOperationSchema],
    [{ op: 'removeSource', sourceId: 'geo', cascadeLayers: true },
      removeSourceOperationSchema],
    [{ op: 'patchSource', sourceId: 'geo', patch: { cluster: false } },
      patchSourceOperationSchema],
    [{ op: 'setGeoJsonData', sourceId: 'geo', data: 'https://example.test/data.geojson' },
      setGeoJsonDataOperationSchema],
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
});

test('addSource adds an escaped object-key ID without synthesizing an id member', () => {
  const style = makeStyle();
  const sourceId = 'incidents/~live';
  const source: StyleSource = {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  };
  const result = applyStyleTransaction(style, {
    operations: [{ op: 'addSource', sourceId, source }],
  });

  assert.equal(result.ok, true);
  assert.notStrictEqual(result.style, style);
  assert.deepEqual(result.style.sources[sourceId], source);
  assert.equal(Object.hasOwn(result.style.sources[sourceId]!, 'id'), false);
  assert.equal(Object.hasOwn(style.sources, sourceId), false);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, [sourceId]);
  assert.deepEqual(result.diff, [{
    op: 'add',
    path: '/sources/incidents~1~0live',
    after: source,
    target: { kind: 'source', id: sourceId },
  }]);
  assertReplay(style, result);
});

test('addSource marks only its exact candidate and rejects collisions before mutation', () => {
  const working = makeStyle();
  const context = makeContext();
  assert.deepEqual(applySourceOperation(working, {
    op: 'addSource', sourceId: 'new',
    source: { type: 'geojson', data: 'https://example.test/data.geojson' },
  }, context), { ok: true, changed: true });
  assert.deepEqual([...context.changedLayerIds], []);
  assert.deepEqual([...context.changedSourceIds], ['new']);
  assert.equal(Object.hasOwn(working.sources.new!, 'id'), false);

  const style = makeStyle();
  const failure = assertAtomicFailure(style, {
    op: 'addSource', sourceId: 'geo', source: { type: 'geojson', data: 'url' },
  }, 'CONFLICT');
  if (!failure.ok) {
    assert.equal(failure.error.path, '/sourceId');
    assert.deepEqual(failure.error.details, { sourceId: 'geo' });
  }
});

test('addSource rolls back a canonical-invalid source type', () => {
  const style = makeStyle();
  const failure = assertAtomicFailure(style, {
    op: 'addSource', sourceId: 'invalid', source: { type: 'invalid-source-type' },
  }, 'STYLE_INVALID');
  if (!failure.ok) assert.equal(isStyleToolError(failure.error), true);
});

test('duplicateSource preserves JSON fields, applies RFC 7396 overrides, and isolates deeply', () => {
  const style = makeStyle();
  const extension = {
    vendor: {
      retained: true,
      removed: 'old',
      nested: { keep: [1, { value: 'original' }] },
    },
  };
  style.sources.vector!.extension = extension;
  const result = applyStyleTransaction(style, {
    validate: false,
    operations: [{
      op: 'duplicateSource',
      sourceId: 'vector',
      newSourceId: 'vector-copy',
      overrides: {
        minzoom: 2,
        extension: { vendor: { removed: null, added: 'new' } },
      },
    }],
  });
  const expected = {
    type: 'vector',
    tiles: ['https://example.test/vector/{z}/{x}/{y}.pbf'],
    minzoom: 2,
    maxzoom: 14,
    promoteId: { roads: 'road_id', labels: 'label_id' },
    extension: {
      vendor: {
        retained: true,
        nested: { keep: [1, { value: 'original' }] },
        added: 'new',
      },
    },
  };

  assert.equal(result.ok, true);
  assert.deepEqual(result.style.sources['vector-copy'], expected);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, ['vector-copy']);
  assert.deepEqual(result.diff, [{
    op: 'add', path: '/sources/vector-copy', after: expected,
    target: { kind: 'source', id: 'vector-copy' },
  }]);
  const originalNested = (style.sources.vector!.extension as JsonObject).vendor as JsonObject;
  const copiedNested = (result.style.sources['vector-copy']!.extension as JsonObject)
    .vendor as JsonObject;
  assert.notStrictEqual(result.style.sources['vector-copy'], result.style.sources.vector);
  assert.notStrictEqual(copiedNested, originalNested);
  assert.notStrictEqual(copiedNested.nested, originalNested.nested);
  assert.deepEqual(style.sources.vector!.extension, extension);
  assertReplay(style, result);
});

test('duplicateSource rejects missing inputs and occupied destinations atomically', () => {
  const missingStyle = makeStyle();
  const missing = assertAtomicFailure(missingStyle, {
    op: 'duplicateSource', sourceId: 'missing', newSourceId: 'copy',
  }, 'NOT_FOUND');
  if (!missing.ok) assert.equal(missing.error.path, '/sourceId');

  const collisionStyle = makeStyle();
  const collision = assertAtomicFailure(collisionStyle, {
    op: 'duplicateSource', sourceId: 'geo', newSourceId: 'vector',
  }, 'CONFLICT');
  if (!collision.ok) assert.equal(collision.error.path, '/newSourceId');
});

test('patchSource applies own-key-safe Merge Patch and reports structural no-ops', () => {
  const style = makeStyle();
  const changed = applyStyleTransaction(style, { operations: [{
    op: 'patchSource', sourceId: 'geo',
    patch: { cluster: null, clusterRadius: 80, clusterProperties: { total: ['+', 1] } },
  }] });
  assert.equal(changed.ok, true);
  assert.deepEqual(changed.changedLayers, []);
  assert.deepEqual(changed.changedSources, ['geo']);
  assert.deepEqual(changed.diff, [
    {
      op: 'remove', path: '/sources/geo/cluster', before: true,
      target: { kind: 'source', id: 'geo' },
    },
    {
      op: 'replace', path: '/sources/geo/clusterRadius', before: 50, after: 80,
      target: { kind: 'source', id: 'geo' },
    },
    {
      op: 'add', path: '/sources/geo/clusterProperties', after: { total: ['+', 1] },
      target: { kind: 'source', id: 'geo' },
    },
  ]);
  assertReplay(style, changed);

  const noOp = applyStyleTransaction(style, { operations: [{
    op: 'patchSource', sourceId: 'geo', patch: { cluster: true, missing: null },
  }] });
  assert.equal(noOp.ok, true);
  assert.deepEqual(noOp.style, style);
  assert.notStrictEqual(noOp.style, style);
  assert.deepEqual(noOp.changedSources, []);
  assert.deepEqual(noOp.diff, []);
});

test('patchSource applies and diffs a 20k-deep extension without overflowing the stack', () => {
  const style = makeStyle();
  const extension = makeDeepJsonObject(DEEP_JSON_DEPTH, 'patched');
  const result = applyStyleTransaction(style, {
    validate: false,
    operations: [{
      op: 'patchSource', sourceId: 'geo', patch: { extension },
    }],
  });

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('expected deep patch transaction success');
  assert.equal(jsonUtf8ByteLength(result.style) < DEFAULT_MAX_STYLE_BYTES, true);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, ['geo']);
  assert.deepEqual(result.diff.map(({ op, path, target }) => ({ op, path, target })), [{
    op: 'add', path: '/sources/geo/extension', target: { kind: 'source', id: 'geo' },
  }]);
  assertDeepJsonObject(result.style.sources.geo!.extension, DEEP_JSON_DEPTH, 'patched');
  assertDeepJsonObject(result.diff[0]?.after, DEEP_JSON_DEPTH, 'patched');

  const replayed = replayStyleDiff(style, result.diff);
  assertDeepJsonObject(replayed.sources.geo!.extension, DEEP_JSON_DEPTH, 'patched');
});

test('addSource emits a fully replayable diff for a 20k-deep extension', () => {
  const style = makeStyle();
  const sourceId = 'deep-added';
  const extension = makeDeepJsonObject(DEEP_JSON_DEPTH, 'added');
  const result = applyStyleTransaction(style, {
    validate: false,
    operations: [{
      op: 'addSource',
      sourceId,
      source: {
        type: 'vector',
        tiles: ['https://example.test/deep/{z}/{x}/{y}.pbf'],
        extension,
      },
    }],
  });

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('expected deep add transaction success');
  assert.equal(jsonUtf8ByteLength(result.style) < DEFAULT_MAX_STYLE_BYTES, true);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, [sourceId]);
  assert.deepEqual(result.diff.map(({ op, path, target }) => ({ op, path, target })), [{
    op: 'add', path: '/sources/deep-added', target: { kind: 'source', id: sourceId },
  }]);

  const replayed = replayStyleDiff(style, result.diff);
  assertDeepJsonObject(replayed.sources[sourceId]!.extension, DEEP_JSON_DEPTH, 'added');
  assert.notStrictEqual(
    replayed.sources[sourceId]!.extension,
    result.style.sources[sourceId]!.extension,
  );
});

test('patchSource rejects missing sources and canonical-invalid results with rollback', () => {
  const missingStyle = makeStyle();
  assertAtomicFailure(missingStyle, {
    op: 'patchSource', sourceId: 'missing', patch: { minzoom: 1 },
  }, 'NOT_FOUND');

  for (const patch of [{ type: 'invalid-source-type' }, { type: null }]) {
    const style = makeStyle();
    const failure = assertAtomicFailure(style, {
      op: 'patchSource', sourceId: 'vector', patch,
    }, 'STYLE_INVALID');
    if (!failure.ok) assert.equal(isStyleToolError(failure.error), true);
  }
});

test('all source object fields reject cycles, exotic values, and dangerous keys atomically', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const dangerous = JSON.parse('{"__proto__":{"polluted":true}}') as JsonObject;
  class Exotic {
    readonly value = true;
  }
  const fixtures: readonly unknown[] = [cyclic, new Date(0), new Exotic(), dangerous];
  const before = Object.getOwnPropertyDescriptor(Object.prototype, 'polluted');

  for (const value of fixtures) {
    for (const operation of [
      { op: 'addSource', sourceId: 'added', source: value },
      { op: 'duplicateSource', sourceId: 'geo', newSourceId: 'copy', overrides: value },
      { op: 'patchSource', sourceId: 'geo', patch: value },
    ]) {
      const style = makeStyle();
      assertAtomicFailure(style, operation, 'INVALID_INPUT');
    }
  }
  assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, 'polluted'), before);
});

test('source operation sanitization executes zero getters, including nested GeoJSON', () => {
  let getterCalls = 0;
  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, 'type', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('must not run'); },
  });
  const dataAccessor: Record<string, unknown> = {
    type: 'Feature', geometry: null,
  };
  Object.defineProperty(dataAccessor, 'properties', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('must not run'); },
  });

  for (const operation of [
    { op: 'addSource', sourceId: 'added', source: accessor },
    { op: 'duplicateSource', sourceId: 'geo', newSourceId: 'copy', overrides: accessor },
    { op: 'patchSource', sourceId: 'geo', patch: accessor },
    { op: 'setGeoJsonData', sourceId: 'geo', data: dataAccessor },
  ]) {
    const style = makeStyle();
    assertAtomicFailure(style, operation, 'INVALID_INPUT');
  }
  assert.equal(getterCalls, 0);
});

test('renameSource atomically moves the key and rewrites only exact layer.source values', () => {
  const oldId = 'old/~source';
  const newId = 'new/~source';
  const style: StyleDocument = {
    version: 8,
    sources: {
      [oldId]: {
        type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'],
      },
      [`${oldId}-extra`]: {
        type: 'vector', tiles: ['https://example.test/extra/{z}/{x}/{y}.pbf'],
      },
    },
    layers: [
      { id: 'roads', type: 'line', source: oldId, 'source-layer': oldId },
      { id: 'unrelated', type: 'line', source: `${oldId}-extra`, 'source-layer': oldId },
      { id: 'labels', type: 'symbol', source: oldId, 'source-layer': 'labels' },
    ],
  };
  const oldSource = structuredClone(style.sources[oldId]);
  const result = applyStyleTransaction(style, { operations: [{
    op: 'renameSource', sourceId: oldId, newSourceId: newId,
  }] });

  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result.style.sources, oldId), false);
  assert.deepEqual(result.style.sources[newId], oldSource);
  assert.equal(Object.hasOwn(result.style.sources[newId]!, 'id'), false);
  assert.equal(result.style.layers[0]!.source, newId);
  assert.equal(result.style.layers[0]!['source-layer'], oldId);
  assert.equal(result.style.layers[1]!.source, `${oldId}-extra`);
  assert.equal(result.style.layers[1]!['source-layer'], oldId);
  assert.equal(result.style.layers[2]!.source, newId);
  assert.equal(result.style.layers[2]!['source-layer'], 'labels');
  assert.deepEqual(result.changedLayers, ['roads', 'labels']);
  assert.deepEqual(result.changedSources, [oldId, newId]);
  assert.deepEqual(result.diff, [
    {
      op: 'replace', path: '/layers/0/source', before: oldId, after: newId,
      target: { kind: 'layer', id: 'roads' },
    },
    {
      op: 'replace', path: '/layers/2/source', before: oldId, after: newId,
      target: { kind: 'layer', id: 'labels' },
    },
    {
      op: 'remove', path: '/sources/old~1~0source', before: oldSource,
      target: { kind: 'source', id: oldId },
    },
    {
      op: 'add', path: '/sources/new~1~0source', after: oldSource,
      target: { kind: 'source', id: newId },
    },
  ]);
  assertReplay(style, result);
});

test('renameSource rejects missing inputs and destination collisions atomically', () => {
  const missingStyle = makeStyle();
  const missing = assertAtomicFailure(missingStyle, {
    op: 'renameSource', sourceId: 'missing', newSourceId: 'renamed',
  }, 'NOT_FOUND');
  if (!missing.ok) assert.equal(missing.error.path, '/sourceId');

  const collisionStyle = makeStyle();
  const collision = assertAtomicFailure(collisionStyle, {
    op: 'renameSource', sourceId: 'geo', newSourceId: 'vector',
  }, 'CONFLICT');
  if (!collision.ok) assert.equal(collision.error.path, '/newSourceId');
});

test('removeSource reports JSON-safe dependency details without exposing partial edits', () => {
  const style = makeStyle();
  const failure = assertAtomicFailure(style, {
    op: 'removeSource', sourceId: 'vector',
  }, 'DEPENDENCY_CONFLICT');
  if (failure.ok) assert.fail('expected dependency conflict');
  assert.equal(failure.error.path, '/sourceId');
  assert.deepEqual(failure.error.details, {
    sourceId: 'vector', dependentLayerIds: ['roads'],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(failure.error.details)), failure.error.details);
  assert.equal(isStyleToolError(failure.error), true);
});

test('removeSource cascades dependent layers from high indexes and reports exact IDs', () => {
  const style: StyleDocument = {
    version: 8,
    sources: {
      vector: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] },
      other: { type: 'vector', tiles: ['https://example.test/other/{z}/{x}/{y}.pbf'] },
    },
    layers: [
      { id: 'roads', type: 'line', source: 'vector', 'source-layer': 'roads' },
      { id: 'other', type: 'line', source: 'other', 'source-layer': 'other' },
      { id: 'labels', type: 'symbol', source: 'vector', 'source-layer': 'labels' },
    ],
  };
  const result = applyStyleTransaction(style, { operations: [{
    op: 'removeSource', sourceId: 'vector', cascadeLayers: true,
  }] });

  assert.equal(result.ok, true);
  assert.deepEqual(result.style.layers.map((layer) => layer.id), ['other']);
  assert.equal(Object.hasOwn(result.style.sources, 'vector'), false);
  assert.deepEqual(result.changedLayers, ['labels', 'roads']);
  assert.deepEqual(result.changedSources, ['vector']);
  assert.deepEqual(result.diff, [
    {
      op: 'remove', path: '/layers/2', before: style.layers[2],
      target: { kind: 'layer', id: 'labels' },
    },
    {
      op: 'remove', path: '/layers/0', before: style.layers[0],
      target: { kind: 'layer', id: 'roads' },
    },
    {
      op: 'remove', path: '/sources/vector', before: style.sources.vector,
      target: { kind: 'source', id: 'vector' },
    },
  ]);
  assertReplay(style, result);
});

test('removeSource deletes an unused source and rejects a missing source', () => {
  const style = makeStyle();
  const removed = applyStyleTransaction(style, { operations: [{
    op: 'removeSource', sourceId: 'raster',
  }] });
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.changedLayers, []);
  assert.deepEqual(removed.changedSources, ['raster']);
  assert.deepEqual(removed.diff, [{
    op: 'remove', path: '/sources/raster', before: style.sources.raster,
    target: { kind: 'source', id: 'raster' },
  }]);
  assertReplay(style, removed);

  const missingStyle = makeStyle();
  assertAtomicFailure(missingStyle, {
    op: 'removeSource', sourceId: 'missing', cascadeLayers: true,
  }, 'NOT_FOUND');
});

test('setGeoJsonData accepts a sanitized inline snapshot and emits an escaped source target', () => {
  let getCalls = 0;
  const transparent = <Value extends object>(value: Value): Value => new Proxy(value, {
    get() { getCalls += 1; throw new Error('must not run'); },
  });
  const sourceId = 'geo/~live';
  const style: StyleDocument = {
    version: 8,
    sources: {
      [sourceId]: { type: 'geojson', data: 'https://example.test/before.geojson' },
    },
    layers: [{ id: 'points', type: 'circle', source: sourceId }],
  };
  const originalData = {
    type: 'FeatureCollection' as const,
    features: transparent([transparent({
      type: 'Feature' as const,
      geometry: transparent({ type: 'Point' as const, coordinates: transparent([1, 2]) }),
      properties: transparent({ name: 'safe' }),
    })]),
  };
  const data = transparent(originalData);
  const expected = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] },
      properties: { name: 'safe' },
    }],
  };
  const result = applyStyleTransaction(style, { operations: [{
    op: 'setGeoJsonData', sourceId, data,
  }] });

  assert.equal(result.ok, true);
  assert.equal(getCalls, 0);
  assert.deepEqual(result.style.sources[sourceId]!.data, expected);
  assert.notStrictEqual(result.style.sources[sourceId]!.data, originalData);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, [sourceId]);
  assert.deepEqual(result.diff, [{
    op: 'replace', path: '/sources/geo~1~0live/data',
    before: 'https://example.test/before.geojson', after: expected,
    target: { kind: 'source', id: sourceId },
  }]);
  assertReplay(style, result);
});

test('setGeoJsonData accepts a non-empty URL without fetching and reports equal data as a no-op', () => {
  const style = makeStyle();
  let fetchCalls = 0;
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => { fetchCalls += 1; throw new Error('must not fetch'); },
    writable: true,
  });
  try {
    const url = 'https://example.test/data.geojson';
    const first = applyStyleTransaction(style, { operations: [{
      op: 'setGeoJsonData', sourceId: 'geo', data: url,
    }] });
    assert.equal(first.ok, true);
    assert.equal(first.style.sources.geo!.data, url);
    assert.deepEqual(first.changedSources, ['geo']);
    assert.equal(fetchCalls, 0);

    const noOp = applyStyleTransaction(first.style, { operations: [{
      op: 'setGeoJsonData', sourceId: 'geo', data: url,
    }] });
    assert.equal(noOp.ok, true);
    assert.deepEqual(noOp.changedLayers, []);
    assert.deepEqual(noOp.changedSources, []);
    assert.deepEqual(noOp.diff, []);
    assert.equal(fetchCalls, 0);
  } finally {
    if (previousFetch === undefined) Reflect.deleteProperty(globalThis, 'fetch');
    else Object.defineProperty(globalThis, 'fetch', previousFetch);
  }
});

test('setGeoJsonData rejects missing, non-GeoJSON, and structurally invalid data atomically', () => {
  for (const [sourceId, code] of [
    ['missing', 'NOT_FOUND'],
    ['vector', 'UNSUPPORTED_SOURCE'],
    ['raster', 'UNSUPPORTED_SOURCE'],
  ] as const) {
    const style = makeStyle();
    const failure = assertAtomicFailure(style, {
      op: 'setGeoJsonData', sourceId,
      data: { type: 'FeatureCollection', features: [] },
    }, code);
    if (!failure.ok) assert.equal(failure.error.path, '/sourceId');
  }

  const invalidStyle = makeStyle();
  const invalid = assertAtomicFailure(invalidStyle, {
    op: 'setGeoJsonData', sourceId: 'geo', data: { type: 'Point', coordinates: [0] },
  }, 'INVALID_INPUT');
  if (!invalid.ok) assert.equal(invalid.error.path, '/operations/0/data');

  for (const data of ['', '   ']) {
    const style = makeStyle();
    const empty = assertAtomicFailure(style, {
      op: 'setGeoJsonData', sourceId: 'geo', data,
    }, 'INVALID_INPUT');
    if (!empty.ok) assert.equal(empty.error.path, '/operations/0/data');
  }
});

test('setGeoJsonData recreates registered nested limit errors under /data', () => {
  let geometry: JsonObject = { type: 'Point', coordinates: [0, 0] };
  for (let depth = 1; depth <= 16; depth += 1) {
    geometry = { type: 'GeometryCollection', geometries: [geometry] };
  }
  const style = makeStyle();
  const failure = assertAtomicFailure(style, {
    op: 'setGeoJsonData', sourceId: 'geo', data: geometry,
  }, 'INVALID_INPUT');
  if (failure.ok) assert.fail('expected depth failure');
  assert.equal(failure.error.path, `/data${'/geometries/0'.repeat(16)}`);
  assert.deepEqual(failure.error.details, {
    reason: 'maxGeometryDepth', maxGeometryDepth: 16, actualGeometryDepth: 17,
  });
  assert.equal(isStyleToolError(failure.error), true);
});

test('setGeoJsonData uses resolved core maxStyleBytes for lowered, default, and raised limits', () => {
  const data = {
    type: 'FeatureCollection' as const,
    features: [{
      type: 'Feature' as const,
      geometry: null,
      properties: { payload: 'x'.repeat(DEFAULT_MAX_STYLE_BYTES) },
    }],
  };
  const dataBytes = jsonUtf8ByteLength(data);
  assert.equal(dataBytes > DEFAULT_MAX_STYLE_BYTES, true);

  const style: StyleDocument = {
    version: 8,
    sources: { geo: { type: 'geojson', data: 'before' } },
    layers: [],
  };
  assert.equal(jsonUtf8ByteLength(style) < DEFAULT_MAX_STYLE_BYTES, true);
  const expectedStyle = structuredClone(style);
  expectedStyle.sources.geo!.data = data;
  const expectedDiff: StyleDiffEntry[] = [{
    op: 'replace', path: '/sources/geo/data', before: 'before', after: data,
    target: { kind: 'source', id: 'geo' },
  }];
  const expectedStyleBytes = jsonUtf8ByteLength(expectedStyle);
  const expectedDiffBytes = jsonUtf8ByteLength(expectedDiff as JsonValue);

  const omitted = applyStyleTransaction(style, { operations: [{
    op: 'setGeoJsonData', sourceId: 'geo', data,
  }] });
  assert.equal(omitted.ok, false);
  assert.strictEqual(omitted.style, style);
  assert.deepEqual(omitted.changedLayers, []);
  assert.deepEqual(omitted.changedSources, []);
  assert.deepEqual(omitted.diff, []);
  if (omitted.ok) assert.fail('expected default maxBytes failure');
  assert.equal(omitted.error.path, '/data');
  assert.deepEqual(omitted.error.details, {
    reason: 'maxBytes', maxBytes: DEFAULT_MAX_STYLE_BYTES, actualBytes: dataBytes,
  });

  const lowered = applyStyleTransaction(style, { operations: [{
    op: 'setGeoJsonData', sourceId: 'geo', data,
  }] }, {
    maxStyleBytes: dataBytes - 1,
    maxDiffBytes: expectedDiffBytes,
  });
  assert.equal(lowered.ok, false);
  assert.strictEqual(lowered.style, style);
  assert.deepEqual(lowered.changedLayers, []);
  assert.deepEqual(lowered.changedSources, []);
  assert.deepEqual(lowered.diff, []);
  if (lowered.ok) assert.fail('expected lowered maxBytes failure');
  assert.equal(lowered.error.path, '/data');
  assert.deepEqual(lowered.error.details, {
    reason: 'maxBytes', maxBytes: dataBytes - 1, actualBytes: dataBytes,
  });

  const raised = applyStyleTransaction(style, { operations: [{
    op: 'setGeoJsonData', sourceId: 'geo', data,
  }] }, {
    maxStyleBytes: expectedStyleBytes,
    maxDiffBytes: expectedDiffBytes,
  });
  assert.equal(raised.ok, true);
  assert.deepEqual(raised.style, expectedStyle);
  assert.notStrictEqual(raised.style.sources.geo!.data, data);
  assert.deepEqual(raised.changedLayers, []);
  assert.deepEqual(raised.changedSources, ['geo']);
  assert.deepEqual(raised.diff, expectedDiff);
  assertReplay(style, raised);
});

test('setGeoJsonData URL bypasses inline validation but remains under final Style limits', () => {
  const style: StyleDocument = {
    version: 8,
    sources: { geo: { type: 'geojson', data: 'x' } },
    layers: [],
  };
  const data = `https://example.test/${'x'.repeat(512)}.geojson`;
  const expected = structuredClone(style);
  expected.sources.geo!.data = data;
  const baselineBytes = jsonUtf8ByteLength(style);
  const completedBytes = jsonUtf8ByteLength(expected);
  assert.equal(completedBytes > baselineBytes, true);

  const result = applyStyleTransaction(style, { operations: [{
    op: 'setGeoJsonData', sourceId: 'geo', data,
  }] }, {
    maxStyleBytes: completedBytes - 1,
    maxDiffBytes: 4096,
  });
  assert.equal(result.ok, false);
  assert.strictEqual(result.style, style);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, []);
  if (result.ok) assert.fail('expected final Style limit failure');
  assert.equal(result.error.path, '');
  assert.equal(result.error.details?.reason, 'maxStyleBytes');
  assert.equal(result.error.details?.maxBytes, completedBytes - 1);
});

test('a later source failure rolls back all earlier source and layer mutations', () => {
  const style = makeStyle();
  const result = applyStyleTransaction(style, { operations: [
    {
      op: 'renameSource', sourceId: 'vector', newSourceId: 'renamed',
    },
    {
      op: 'addSource', sourceId: 'geo', source: { type: 'geojson', data: 'url' },
    },
  ] });
  assert.equal(result.ok, false);
  assert.strictEqual(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, []);
  assert.equal(style.layers[1]!.source, 'vector');
  assert.equal(Object.hasOwn(style.sources, 'renamed'), false);
});
