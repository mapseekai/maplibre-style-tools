import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replayStyleDiff } from '../diff.js';
import { applyStyleTransaction } from '../transaction.js';
import {
  DEFAULT_MAX_DIFF_BYTES, DEFAULT_MAX_OPERATIONS, DEFAULT_MAX_STYLE_BYTES,
} from '../utf8.js';
import {
  applySetGeoJsonSourceFilter,
  applySetLayerFilter,
  composeFilter,
} from './filters.js';
import type {
  CoreExecutionLimits, JsonValue, OperationContext, StyleDocument,
} from '../types.js';

const TEST_LIMITS: Readonly<CoreExecutionLimits> = {
  maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
  maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
  maxOperations: DEFAULT_MAX_OPERATIONS,
};

const makeContext = (): OperationContext => ({
  limits: TEST_LIMITS,
  changedLayerIds: new Set(),
  changedSourceIds: new Set(),
  warnings: [],
});

const makeStyle = (): StyleDocument => ({
  version: 8,
  sources: {
    geo: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
    vector: {
      type: 'vector',
      tiles: ['https://example.com/vector/{z}/{x}/{y}.pbf'],
    },
    raster: {
      type: 'raster',
      tiles: ['https://example.com/raster/{z}/{x}/{y}.png'],
    },
  },
  layers: [
    {
      id: 'roads', type: 'line', source: 'vector', 'source-layer': 'roads',
      filter: ['==', ['get', 'class'], 'road'],
      paint: { 'line-color': '#000' },
    },
    {
      id: 'places', type: 'circle', source: 'geo',
      filter: ['==', ['get', 'kind'], 'city'],
      paint: { 'circle-radius': 4 },
    },
  ],
});

const classFilter: JsonValue[] = ['==', ['get', 'class'], 'road'];
const rankFilter: JsonValue[] = ['==', ['get', 'rank'], 1];

test('composeFilter deterministically replaces, combines, and flattens matching groups', () => {
  const cases: Array<{
    name: string;
    existing: JsonValue[] | undefined;
    incoming: JsonValue[];
    mode: 'replace' | 'and' | 'or';
    expected: JsonValue[];
  }> = [
    {
      name: 'replace', existing: classFilter, incoming: rankFilter,
      mode: 'replace', expected: rankFilter,
    },
    {
      name: 'and without existing', existing: undefined, incoming: rankFilter,
      mode: 'and', expected: rankFilter,
    },
    {
      name: 'or without existing', existing: undefined, incoming: rankFilter,
      mode: 'or', expected: rankFilter,
    },
    {
      name: 'and with existing', existing: classFilter, incoming: rankFilter,
      mode: 'and', expected: ['all', classFilter, rankFilter],
    },
    {
      name: 'or with existing', existing: classFilter, incoming: rankFilter,
      mode: 'or', expected: ['any', classFilter, rankFilter],
    },
    {
      name: 'flatten both matching all groups',
      existing: ['all', classFilter, ['==', ['get', 'surface'], 'paved']],
      incoming: ['all', rankFilter, ['==', ['get', 'lanes'], 2]],
      mode: 'and',
      expected: [
        'all', classFilter, ['==', ['get', 'surface'], 'paved'],
        rankFilter, ['==', ['get', 'lanes'], 2],
      ],
    },
    {
      name: 'flatten both matching any groups',
      existing: ['any', classFilter, ['==', ['get', 'surface'], 'paved']],
      incoming: ['any', rankFilter, ['==', ['get', 'lanes'], 2]],
      mode: 'or',
      expected: [
        'any', classFilter, ['==', ['get', 'surface'], 'paved'],
        rankFilter, ['==', ['get', 'lanes'], 2],
      ],
    },
    {
      name: 'preserve opposite nested group',
      existing: ['any', classFilter, rankFilter],
      incoming: ['all', ['==', ['get', 'surface'], 'paved']],
      mode: 'and',
      expected: [
        'all', ['any', classFilter, rankFilter], ['==', ['get', 'surface'], 'paved'],
      ],
    },
  ];

  for (const { name, existing, incoming, mode, expected } of cases) {
    assert.deepEqual(composeFilter(existing, incoming, mode), expected, name);
  }
});

test('composeFilter rejects legacy filters with actionable guidance', () => {
  const legacy: JsonValue[] = ['==', 'class', 'road'];
  assert.throws(() => composeFilter(classFilter, legacy, 'and'), /not supported.*expression/);
  assert.throws(() => composeFilter(legacy, classFilter, 'or'), /existing legacy.*replace/is);
  assert.throws(() => composeFilter(legacy, legacy, 'and'), /not supported.*expression/);
});

test('composeFilter rejects nested legacy children in every position', () => {
  const legacyChild: JsonValue[] = ['==', 'class', 'primary'];
  const expressionChild: JsonValue[] = ['==', ['get', 'kind'], 'road'];
  assert.throws(
    () => composeFilter(classFilter, ['all', legacyChild, expressionChild], 'and'),
    /not supported.*expression/s,
  );
  assert.throws(
    () => composeFilter(classFilter, ['all', expressionChild, legacyChild], 'and'),
    /not supported.*expression/s,
  );
  assert.throws(
    () => composeFilter(classFilter, ['any', expressionChild, legacyChild], 'or'),
    /not supported.*expression/s,
  );
  assert.throws(
    () => composeFilter(classFilter, ['any', legacyChild, expressionChild], 'or'),
    /not supported.*expression/s,
  );
  assert.throws(
    () => composeFilter(
      classFilter,
      ['all', expressionChild, ['any', expressionChild, legacyChild]],
      'and',
    ),
    /not supported.*expression/s,
  );
});

test('composeFilter composes neutral operands with expressions', () => {
  assert.deepEqual(
    composeFilter(['has', 'name'], classFilter, 'and'),
    ['all', ['has', 'name'], classFilter],
  );
  assert.deepEqual(
    composeFilter(classFilter, ['has', 'name'], 'or'),
    ['any', classFilter, ['has', 'name']],
  );
});

test('filter handlers reject legacy incoming filters without schema validation', () => {
  const style = makeStyle();
  const layerResult = applySetLayerFilter(style, {
    op: 'setLayerFilter', layerId: 'roads', mode: 'replace',
    filter: ['==', 'class', 'road'],
  }, makeContext());
  assert.equal(layerResult.ok, false);
  if (layerResult.ok) assert.fail('expected legacy rejection');
  assert.equal(layerResult.error.code, 'INVALID_INPUT');
  assert.match(layerResult.error.message, /not supported.*expression/s);

  const sourceResult = applySetGeoJsonSourceFilter(style, {
    op: 'setGeoJsonSourceFilter', sourceId: 'geo', mode: 'replace',
    filter: ['==', 'kind', 'park'],
  }, makeContext());
  assert.equal(sourceResult.ok, false);
  if (sourceResult.ok) assert.fail('expected legacy rejection');
  assert.equal(sourceResult.error.code, 'INVALID_INPUT');
});

test('setLayerFilter replace and clear emit exact replayable layer diffs', () => {
  const style = makeStyle();
  const replaced = applyStyleTransaction(style, { operations: [{
    op: 'setLayerFilter', layerId: 'roads', mode: 'replace', filter: rankFilter,
  }] });
  assert.equal(replaced.ok, true);
  assert.deepEqual(replaced.changedLayers, ['roads']);
  assert.deepEqual(replaced.changedSources, []);
  assert.deepEqual(replaced.diff, [{
    op: 'replace', path: '/layers/0/filter',
    before: classFilter, after: rankFilter,
    target: { kind: 'layer', id: 'roads' },
  }]);
  assert.deepEqual(replayStyleDiff(style, replaced.diff), replaced.style);

  const cleared = applyStyleTransaction(replaced.style, { operations: [{
    op: 'setLayerFilter', layerId: 'roads', mode: 'clear',
  }] });
  assert.equal(cleared.ok, true);
  assert.deepEqual(cleared.changedLayers, ['roads']);
  assert.deepEqual(cleared.changedSources, []);
  assert.deepEqual(cleared.diff, [{
    op: 'remove', path: '/layers/0/filter', before: rankFilter,
    target: { kind: 'layer', id: 'roads' },
  }]);
  assert.deepEqual(replayStyleDiff(replaced.style, cleared.diff), cleared.style);
});

test('filter handlers mark exactly one candidate only on structural change', () => {
  const style = makeStyle();
  const layerContext = makeContext();
  assert.deepEqual(applySetLayerFilter(style, {
    op: 'setLayerFilter', layerId: 'roads', mode: 'replace', filter: classFilter,
  }, layerContext), { ok: true, changed: false });
  assert.deepEqual([...layerContext.changedLayerIds], []);
  assert.deepEqual([...layerContext.changedSourceIds], []);

  const sourceContext = makeContext();
  assert.deepEqual(applySetGeoJsonSourceFilter(style, {
    op: 'setGeoJsonSourceFilter', sourceId: 'geo', mode: 'replace', filter: rankFilter,
  }, sourceContext), { ok: true, changed: true });
  assert.deepEqual([...sourceContext.changedLayerIds], []);
  assert.deepEqual([...sourceContext.changedSourceIds], ['geo']);
});

test('setGeoJsonSourceFilter replace and clear emit exact source diffs without touching layers', () => {
  const style = makeStyle();
  const originalLayerFilters = style.layers.map((layer) => structuredClone(layer.filter));
  const replaced = applyStyleTransaction(style, { operations: [{
    op: 'setGeoJsonSourceFilter', sourceId: 'geo', mode: 'replace', filter: rankFilter,
  }] });
  assert.equal(replaced.ok, true);
  assert.deepEqual(replaced.changedLayers, []);
  assert.deepEqual(replaced.changedSources, ['geo']);
  assert.deepEqual(replaced.diff, [{
    op: 'add', path: '/sources/geo/filter', after: rankFilter,
    target: { kind: 'source', id: 'geo' },
  }]);
  assert.deepEqual(
    replaced.style.layers.map((layer) => layer.filter), originalLayerFilters,
  );
  assert.deepEqual(replayStyleDiff(style, replaced.diff), replaced.style);

  const cleared = applyStyleTransaction(replaced.style, { operations: [{
    op: 'setGeoJsonSourceFilter', sourceId: 'geo', mode: 'clear',
  }] });
  assert.equal(cleared.ok, true);
  assert.deepEqual(cleared.changedLayers, []);
  assert.deepEqual(cleared.changedSources, ['geo']);
  assert.deepEqual(cleared.diff, [{
    op: 'remove', path: '/sources/geo/filter', before: rankFilter,
    target: { kind: 'source', id: 'geo' },
  }]);
  assert.deepEqual(
    cleared.style.layers.map((layer) => layer.filter), originalLayerFilters,
  );
  assert.deepEqual(replayStyleDiff(replaced.style, cleared.diff), cleared.style);
});

test('setGeoJsonSourceFilter rejects missing and unsupported sources atomically', () => {
  for (const [sourceId, code] of [
    ['missing', 'NOT_FOUND'],
    ['vector', 'UNSUPPORTED_SOURCE'],
    ['raster', 'UNSUPPORTED_SOURCE'],
  ] as const) {
    const style = makeStyle();
    const result = applyStyleTransaction(style, { operations: [{
      op: 'setGeoJsonSourceFilter', sourceId, mode: 'replace', filter: rankFilter,
    }] });
    assert.equal(result.ok, false, sourceId);
    assert.strictEqual(result.style, style, sourceId);
    assert.deepEqual(result.changedLayers, [], sourceId);
    assert.deepEqual(result.changedSources, [], sourceId);
    assert.deepEqual(result.diff, [], sourceId);
    if (result.ok) assert.fail('expected source filter failure');
    assert.equal(result.error.code, code, sourceId);
  }
});

test('a legacy filter operation rejects the whole transaction without applying earlier operations', () => {
  const style = makeStyle();
  const result = applyStyleTransaction(style, { operations: [
    { op: 'setGeoJsonSourceFilter', sourceId: 'geo', mode: 'replace', filter: rankFilter },
    {
      op: 'setLayerFilter', layerId: 'roads', mode: 'and',
      filter: ['==', 'surface', 'paved'],
    },
  ] });
  assert.equal(result.ok, false);
  assert.strictEqual(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, []);
  if (result.ok) assert.fail('expected legacy filter rejection');
  assert.equal(result.error.code, 'INVALID_INPUT');
  assert.match(result.error.message, /legacy.*expression/is);
});
