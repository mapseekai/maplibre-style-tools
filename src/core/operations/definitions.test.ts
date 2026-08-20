import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
} from '../utf8.js';
import { replayStyleDiff } from '../diff.js';
import { styleOperationSchema } from '../schemas.js';
import { applyStyleTransaction } from '../transaction.js';
import type {
  DefinitionStyleOperation,
  JsonObject,
  OperationContext,
  StyleDocument,
} from '../types.js';
import {
  applyDefinitionStyleOperation,
} from './definitions.js';

function baseStyle(): StyleDocument {
  return {
    version: 8,
    sources: {
      base: {
        type: 'vector',
        tiles: ['https://example.test/{z}/{x}/{y}.pbf'],
      },
      dem: {
        type: 'raster-dem',
        tiles: ['https://example.test/dem/{z}/{x}/{y}.png'],
        tileSize: 256,
      },
      points: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterProperties: { total: ['+', ['get', 'value']] },
      },
    },
    layers: [
      {
        id: 'roads',
        type: 'line',
        source: 'base',
        'source-layer': 'roads',
        paint: { 'line-color': '#000' },
        metadata: {
          owner: 'transport',
          nested: { left: 1, right: 2 },
          retainedNull: 'old',
        },
      },
      { id: 'labels', type: 'symbol', source: 'base', 'source-layer': 'labels' },
    ],
    metadata: { owner: 'old', omitted: true },
    transition: { duration: 300, delay: 50 },
    sky: { 'sky-color': '#88ccff' },
    projection: { type: 'mercator' },
    terrain: { source: 'dem', exaggeration: 1 },
    light: {
      anchor: 'map',
      intensity: 0.4,
      'color-transition': { duration: 300, delay: 50 },
    },
  } as StyleDocument;
}

function context(): OperationContext {
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

const validOperations: DefinitionStyleOperation[] = [
  {
    op: 'addLayerDefinition',
    layer: { id: 'background', type: 'background' },
    beforeId: 'roads',
  },
  {
    op: 'deepMergeLayerDefinition',
    layerId: 'roads',
    patch: { metadata: { reviewed: true } },
  },
  {
    op: 'replaceLayerDefinition',
    layerId: 'roads',
    layer: {
      id: 'roads-next', type: 'line', source: 'base', 'source-layer': 'roads',
    },
  },
  {
    op: 'deepMergeSourceDefinition',
    sourceId: 'points',
    patch: { clusterRadius: 64 },
  },
  {
    op: 'replaceSourceDefinition',
    sourceId: 'points',
    source: {
      type: 'geojson', data: { type: 'FeatureCollection', features: [] },
    },
  },
  {
    op: 'replaceRootProperty',
    property: 'metadata',
    value: { owner: 'new' },
  },
  {
    op: 'shallowPatchRootProperty',
    property: 'light',
    patch: { intensity: 0.8 },
  },
];

const applyDefinitionEdit = (
  style: StyleDocument,
  operation: DefinitionStyleOperation,
) => applyStyleTransaction(style, { operations: [operation] });

test('all seven definition variants remain strict descriptor-safe StyleOperations', () => {
  for (const operation of validOperations) {
    const parsed = styleOperationSchema.safeParse(operation);
    assert.equal(parsed.success, true, operation.op);
    assert.deepEqual(parsed.success ? parsed.data : undefined, operation, operation.op);
    assert.equal(
      styleOperationSchema.safeParse({ ...operation, unknown: true }).success,
      false,
      operation.op,
    );
  }

  let getterCalls = 0;
  const accessor = {
    op: 'deepMergeLayerDefinition', layerId: 'roads', patch: {},
  } as Record<string, unknown>;
  Object.defineProperty(accessor.patch as object, 'paint', {
    enumerable: true,
    get() { getterCalls += 1; return {}; },
  });
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const dangerous = JSON.parse(
    '{"op":"deepMergeSourceDefinition","sourceId":"points","patch":{"__proto__":{"polluted":true}}}',
  ) as unknown;
  for (const invalid of [accessor, {
    op: 'deepMergeLayerDefinition', layerId: 'roads', patch: cycle,
  }, dangerous]) {
    assert.equal(styleOperationSchema.safeParse(invalid).success, false);
  }
  assert.equal(getterCalls, 0);
});

test('adds a raw layer definition through the transaction and reports an exact layer target', () => {
  const original = baseStyle();
  const result = applyDefinitionEdit(original, {
    op: 'addLayerDefinition',
    layer: { id: 'background', type: 'background' },
    beforeId: 'roads',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.style.layers.map((layer) => layer.id), [
    'background', 'roads', 'labels',
  ]);
  assert.deepEqual(result.changedLayers, ['background']);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, [{
    op: 'add',
    path: '/layers/0',
    after: { id: 'background', type: 'background' },
    target: { kind: 'layer', id: 'background' },
  }]);
  assert.deepEqual(replayStyleDiff(original, result.diff), result.style);
  assert.notStrictEqual(result.style, original);
});

test('definition layer deep merge recurses while retaining null values', () => {
  const original = baseStyle();
  const result = applyDefinitionEdit(original, {
    op: 'deepMergeLayerDefinition',
    layerId: 'roads',
    patch: {
      metadata: {
        nested: { right: 9 },
        retainedNull: null,
      },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.style.layers[0]?.metadata, {
    owner: 'transport',
    nested: { left: 1, right: 9 },
    retainedNull: null,
  });
  assert.deepEqual(result.changedLayers, ['roads']);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff.map(({ op, path, target }) => ({ op, path, target })), [
    {
      op: 'replace', path: '/layers/0/metadata/nested/right',
      target: { kind: 'layer', id: 'roads' },
    },
    {
      op: 'replace', path: '/layers/0/metadata/retainedNull',
      target: { kind: 'layer', id: 'roads' },
    },
  ]);
  assert.deepEqual(replayStyleDiff(original, result.diff), result.style);
});

test('layer replacement and deep merge support atomic ID renames with remove/add targets', () => {
  for (const operation of [
    {
      op: 'deepMergeLayerDefinition', layerId: 'roads', patch: { id: 'roads-next' },
    },
    {
      op: 'replaceLayerDefinition', layerId: 'roads',
      layer: {
        id: 'roads-next', type: 'line', source: 'base', 'source-layer': 'roads',
        paint: { 'line-color': '#fff' },
      },
    },
  ] satisfies DefinitionStyleOperation[]) {
    const original = baseStyle();
    const result = applyDefinitionEdit(original, operation);
    assert.equal(result.ok, true, operation.op);
    assert.deepEqual(result.changedLayers, ['roads', 'roads-next'], operation.op);
    assert.deepEqual(result.changedSources, [], operation.op);
    assert.deepEqual(result.diff.map(({ op, path, target }) => ({ op, path, target })), [
      {
        op: 'remove', path: '/layers/0', target: { kind: 'layer', id: 'roads' },
      },
      {
        op: 'add', path: '/layers/0', target: { kind: 'layer', id: 'roads-next' },
      },
    ], operation.op);
    assert.deepEqual(replayStyleDiff(original, result.diff), result.style, operation.op);
  }
});

test('layer ID collisions and invalid completed layers roll back atomically', () => {
  for (const operation of [
    {
      op: 'deepMergeLayerDefinition', layerId: 'roads', patch: { id: 'labels' },
    },
    {
      op: 'replaceLayerDefinition', layerId: 'roads',
      layer: { id: 'labels', type: 'line', source: 'base', 'source-layer': 'roads' },
    },
  ] satisfies DefinitionStyleOperation[]) {
    const original = baseStyle();
    const result = applyDefinitionEdit(original, operation);
    assert.equal(result.ok, false, operation.op);
    if (!result.ok) assert.equal(result.error.code, 'CONFLICT', operation.op);
    assert.deepEqual(result.style, original, operation.op);
    assert.deepEqual(result.changedLayers, [], operation.op);
    assert.deepEqual(result.diff, [], operation.op);
  }

  const original = baseStyle();
  const invalid = applyDefinitionEdit(original, {
    op: 'addLayerDefinition', layer: { id: 'invalid-without-type' },
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, 'INVALID_INPUT');
  assert.deepEqual(invalid.style, original);
  assert.deepEqual(invalid.diff, []);
});

test('definition source merge retains null while replacement removes omitted keys', () => {
  const merged = applyStyleTransaction(baseStyle(), {
    validate: false,
    operations: [{
      op: 'deepMergeSourceDefinition',
      sourceId: 'points',
      patch: {
        cluster: null,
        clusterProperties: { count: ['+', ['get', 'count']] },
      },
    }],
  });
  assert.equal(merged.ok, true);
  assert.deepEqual(merged.style.sources.points, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: null,
    clusterProperties: {
      total: ['+', ['get', 'value']],
      count: ['+', ['get', 'count']],
    },
  });
  assert.deepEqual(merged.changedLayers, []);
  assert.deepEqual(merged.changedSources, ['points']);
  assert.equal(merged.diff.every((entry) => (
    entry.target.kind === 'source' && entry.target.id === 'points'
  )), true);

  const replacement = applyDefinitionEdit(baseStyle(), {
    op: 'replaceSourceDefinition',
    sourceId: 'points',
    source: {
      type: 'geojson', data: { type: 'FeatureCollection', features: [] },
    },
  });
  assert.equal(replacement.ok, true);
  assert.deepEqual(replacement.style.sources.points, {
    type: 'geojson', data: { type: 'FeatureCollection', features: [] },
  });
  assert.deepEqual(replacement.changedSources, ['points']);
  assert.deepEqual(replayStyleDiff(baseStyle(), replacement.diff), replacement.style);
});

test('whole root definition replacement drops omitted keys and null clears every supported field', () => {
  const replaced = applyDefinitionEdit(baseStyle(), {
    op: 'replaceRootProperty',
    property: 'metadata',
    value: { owner: 'new' },
  });
  assert.equal(replaced.ok, true);
  assert.deepEqual(replaced.style.metadata, { owner: 'new' });
  assert.deepEqual(replaced.changedLayers, []);
  assert.deepEqual(replaced.changedSources, []);
  assert.deepEqual(replaced.diff.map(({ op, path, target }) => ({ op, path, target })), [
    { op: 'remove', path: '/metadata/omitted', target: { kind: 'style' } },
    { op: 'replace', path: '/metadata/owner', target: { kind: 'style' } },
  ]);

  for (const property of [
    'metadata', 'transition', 'sky', 'projection', 'terrain',
  ] as const) {
    const result = applyDefinitionEdit(baseStyle(), {
      op: 'replaceRootProperty', property, value: null,
    });
    assert.equal(result.ok, true, property);
    assert.equal(Object.hasOwn(result.style, property), false, property);
    assert.deepEqual(result.changedLayers, [], property);
    assert.deepEqual(result.changedSources, [], property);
    assert.deepEqual(result.diff.map(({ op, path, target }) => ({ op, path, target })), [{
      op: 'remove', path: `/${property}`, target: { kind: 'style' },
    }], property);
  }
});

test('light patch is shallow per top-level key, deletes supplied nulls, and preserves an empty light object', () => {
  const original = baseStyle();
  const nested = applyDefinitionEdit(original, {
    op: 'shallowPatchRootProperty',
    property: 'light',
    patch: { 'color-transition': { duration: 120 } },
  });
  assert.equal(nested.ok, true);
  assert.deepEqual(nested.style.light, {
    anchor: 'map',
    intensity: 0.4,
    'color-transition': { duration: 120 },
  });
  assert.deepEqual(nested.diff.map(({ op, path, target }) => ({ op, path, target })), [
    {
      op: 'remove', path: '/light/color-transition/delay',
      target: { kind: 'style' },
    },
    {
      op: 'replace', path: '/light/color-transition/duration',
      target: { kind: 'style' },
    },
  ]);

  const cleared = applyDefinitionEdit({
    ...baseStyle(), light: { anchor: 'map' },
  } as StyleDocument, {
    op: 'shallowPatchRootProperty',
    property: 'light',
    patch: { anchor: null },
  });
  assert.equal(cleared.ok, true);
  assert.equal(Object.hasOwn(cleared.style, 'light'), true);
  assert.deepEqual(cleared.style.light, {});
  assert.deepEqual(cleared.diff.map(({ op, path, target }) => ({ op, path, target })), [{
    op: 'remove', path: '/light/anchor', target: { kind: 'style' },
  }]);

  const clearTransitionOnly = applyDefinitionEdit(baseStyle(), {
    op: 'shallowPatchRootProperty',
    property: 'light',
    patch: { 'color-transition': null },
  });
  assert.equal(clearTransitionOnly.ok, true);
  assert.deepEqual(clearTransitionOnly.style.light, {
    anchor: 'map', intensity: 0.4,
  });
});

test('definition inputs cannot write protected Style authority fields', () => {
  for (const operation of [
    { op: 'replaceRootProperty', property: 'version', value: {} },
    { op: 'replaceRootProperty', property: 'sources', value: {} },
    { op: 'replaceRootProperty', property: 'layers', value: {} },
    { op: 'shallowPatchRootProperty', property: 'metadata', patch: {} },
  ]) {
    assert.equal(styleOperationSchema.safeParse(operation).success, false);
  }
});

test('direct definition handler reports only apply state', () => {
  const working = baseStyle();
  const operation: DefinitionStyleOperation = {
    op: 'replaceRootProperty', property: 'metadata', value: { direct: true },
  };
  const applyContext = context();
  const applied = applyDefinitionStyleOperation(working, operation, applyContext);
  assert.deepEqual(applied, { ok: true, changed: true });
  assert.deepEqual(working.metadata, { direct: true });
  assert.deepEqual([...applyContext.changedLayerIds], []);
  assert.deepEqual([...applyContext.changedSourceIds], []);
});

test('a later definition failure rolls the entire batch back', () => {
  const original = baseStyle();
  const result = applyStyleTransaction(original, {
    operations: [
      {
        op: 'deepMergeLayerDefinition', layerId: 'roads',
        patch: { paint: { 'line-color': '#fff' } },
      },
      {
        op: 'replaceLayerDefinition', layerId: 'missing',
        layer: { id: 'missing', type: 'background' },
      },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'NOT_FOUND');
  assert.deepEqual(result.style, original);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, []);
});

test('definition operations remain closed JSON objects at compile time', () => {
  const operation: DefinitionStyleOperation = {
    op: 'replaceSourceDefinition',
    sourceId: 'points',
    source: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  };
  const json: JsonObject = operation;
  assert.equal(json.op, 'replaceSourceDefinition');
  // @ts-expect-error Definition operations are closed and reject extension fields.
  const extra: DefinitionStyleOperation = { ...operation, unexpected: true };
  void extra;
});
