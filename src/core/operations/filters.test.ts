import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Map } from 'maplibre-gl';
import { createCompactMapLibreStyleTools } from '../../index.js';
import { applyStyleOperations } from '../../engine/style-operations.js';
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
import type {
  StyleDocument as LegacyStyleDocument,
  StyleOperation as LegacyStyleOperation,
} from '../../types.js';

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

test('composeFilter rejects legacy property operands mixed with expression operands', () => {
  const legacy: JsonValue[] = ['==', 'class', 'road'];
  assert.throws(() => composeFilter(legacy, classFilter, 'and'), /legacy.*expression/i);
  assert.throws(() => composeFilter(classFilter, legacy, 'or'), /legacy.*expression/i);
  assert.deepEqual(
    composeFilter(legacy, ['==', 'rank', 1], 'and'),
    ['all', legacy, ['==', 'rank', 1]],
  );
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

test('a later mixed-syntax composition rolls back an earlier valid source change', () => {
  const style = makeStyle();
  const result = applyStyleTransaction(style, { operations: [
    {
      op: 'setGeoJsonSourceFilter', sourceId: 'geo', mode: 'replace', filter: rankFilter,
    },
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
  if (result.ok) assert.fail('expected mixed filter syntax failure');
  assert.equal(result.error.code, 'INVALID_INPUT');
});

test('legacy history replays temporarily invalid transitions and compact applies the final style', async () => {
  const style = makeStyle() as unknown as LegacyStyleDocument;
  style.layers[0]!.paint!['line-width'] = 1;
  const operations: LegacyStyleOperation[] = [
    {
      layerId: 'roads',
      paint: { 'line-color': 42, 'line-width': 2 },
    },
    {
      layerId: 'roads',
      paint: { 'line-color': '#000' },
    },
  ];

  const result = applyStyleOperations(style, operations);
  assert.equal(result.success, true);
  assert.equal(result.style.layers[0]?.paint?.['line-color'], '#000');
  assert.equal(result.style.layers[0]?.paint?.['line-width'], 2);
  assert.deepEqual(result.changedLayers, ['roads']);
  assert.deepEqual(result.diffSummary, [
    {
      path: 'layers.roads.paint.line-color',
      before: '#000',
      after: 42,
    },
    {
      path: 'layers.roads.paint.line-width',
      before: 1,
      after: 2,
    },
    {
      path: 'layers.roads.paint.line-color',
      before: 42,
      after: '#000',
    },
  ]);

  let setStyleCalls = 0;
  let appliedStyle: LegacyStyleDocument | undefined;
  let currentStyle = structuredClone(style);
  const map = {
    getStyle: () => structuredClone(currentStyle),
    setStyle: (nextStyle: LegacyStyleDocument) => {
      setStyleCalls += 1;
      appliedStyle = nextStyle;
      currentStyle = structuredClone(nextStyle);
    },
  } as unknown as Map;
  const compact = createCompactMapLibreStyleTools({ getMap: () => map });
  const execute = (compact.applyStyleOperations as {
    execute?: (input: Record<string, unknown>) => unknown;
  }).execute;
  assert.ok(execute);
  const compactResult = await execute({
    operationsJson: JSON.stringify(operations),
    dryRun: false,
    diff: true,
  }) as { success: boolean };
  assert.equal(compactResult.success, true);
  assert.equal(setStyleCalls, 1);
  assert.equal(appliedStyle?.layers[0]?.paint?.['line-width'], 2);
});

test('legacy batches allow 51 pure filter operations within the core operation limit', () => {
  const operations: LegacyStyleOperation[] = Array.from(
    { length: 51 },
    (_, rank) => ({
      layerId: 'roads',
      filter: ['==', ['get', 'rank'], rank],
    }),
  );
  const result = applyStyleOperations(
    makeStyle() as unknown as LegacyStyleDocument,
    operations,
  );
  assert.equal(result.success, true);
  assert.equal(result.message, 'Applied 51 style operations.');
  assert.deepEqual(result.changedLayers, ['roads']);
  assert.deepEqual(
    result.style.layers[0]?.filter,
    ['==', ['get', 'rank'], 50],
  );
  assert.doesNotMatch(result.message, /too many operations/i);
});

test('legacy batches count 51 combined paint and filter updates as public operations', async () => {
  const style = makeStyle() as unknown as LegacyStyleDocument;
  style.layers[0]!.paint!['line-width'] = 0;
  const operations: LegacyStyleOperation[] = Array.from(
    { length: 51 },
    (_, rank) => ({
      layerId: 'roads',
      paint: { 'line-width': rank + 1 },
      filter: ['==', ['get', 'rank'], rank],
    }),
  );

  const result = applyStyleOperations(style, operations);
  assert.equal(result.success, true);
  assert.equal(result.message, 'Applied 51 style operations.');
  assert.equal(result.style.layers[0]?.paint?.['line-width'], 51);
  assert.deepEqual(result.style.layers[0]?.filter, ['==', ['get', 'rank'], 50]);
  assert.deepEqual(result.changedLayers, ['roads']);
  assert.equal(result.diffSummary.length, 102);
  assert.deepEqual(result.diffSummary.slice(0, 2), [
    {
      path: 'layers.roads.paint.line-width',
      before: 0,
      after: 1,
    },
    {
      path: 'layers.roads.filter',
      before: classFilter,
      after: ['==', ['get', 'rank'], 0],
    },
  ]);
  assert.deepEqual(result.diffSummary.slice(-2), [
    {
      path: 'layers.roads.paint.line-width',
      before: 50,
      after: 51,
    },
    {
      path: 'layers.roads.filter',
      before: ['==', ['get', 'rank'], 49],
      after: ['==', ['get', 'rank'], 50],
    },
  ]);

  let setStyleCalls = 0;
  let appliedStyle: LegacyStyleDocument | undefined;
  let currentStyle = structuredClone(style);
  const map = {
    getStyle: () => structuredClone(currentStyle),
    setStyle: (nextStyle: LegacyStyleDocument) => {
      setStyleCalls += 1;
      appliedStyle = nextStyle;
      currentStyle = structuredClone(nextStyle);
    },
  } as unknown as Map;
  const compact = createCompactMapLibreStyleTools({ getMap: () => map });
  const execute = (compact.applyStyleOperations as {
    execute?: (input: Record<string, unknown>) => unknown;
  }).execute;
  assert.ok(execute);
  const compactResult = await execute({
    operationsJson: JSON.stringify(operations),
    dryRun: false,
    diff: true,
  }) as { success: boolean };
  assert.equal(compactResult.success, true);
  assert.equal(setStyleCalls, 1);
  assert.equal(appliedStyle?.layers[0]?.paint?.['line-width'], 51);
  assert.deepEqual(appliedStyle?.layers[0]?.filter, ['==', ['get', 'rank'], 50]);
});

test('legacy operation limit accepts 100 public operations and rejects the 101st', () => {
  const operations: LegacyStyleOperation[] = Array.from(
    { length: 101 },
    (_, rank) => ({
      layerId: 'roads',
      paint: { 'line-width': rank + 1 },
      filter: ['==', ['get', 'rank'], rank],
    }),
  );

  const accepted = applyStyleOperations(
    makeStyle() as unknown as LegacyStyleDocument,
    operations.slice(0, 100),
  );
  assert.equal(accepted.success, true);
  assert.equal(accepted.message, 'Applied 100 style operations.');
  assert.equal(accepted.style.layers[0]?.paint?.['line-width'], 100);
  assert.deepEqual(accepted.style.layers[0]?.filter, ['==', ['get', 'rank'], 99]);

  const rejectedStyle = makeStyle() as unknown as LegacyStyleDocument;
  const rejected = applyStyleOperations(rejectedStyle, operations);
  assert.equal(rejected.success, false);
  assert.equal(rejected.message, 'Too many operations');
  assert.strictEqual(rejected.style, rejectedStyle);
  assert.deepEqual(rejected.changedLayers, []);
  assert.deepEqual(rejected.diffSummary, []);
});

test('legacy fieldless operations perform lookup no-ops and missing lookups roll back', () => {
  const existingStyle = makeStyle() as unknown as LegacyStyleDocument;
  const existing = applyStyleOperations(existingStyle, [{ layerId: 'roads' }]);
  assert.equal(existing.success, true);
  assert.equal(existing.message, 'Applied 1 style operation.');
  assert.deepEqual(existing.style, existingStyle);
  assert.deepEqual(existing.changedLayers, []);
  assert.deepEqual(existing.diffSummary, []);

  const missingStyle = makeStyle() as unknown as LegacyStyleDocument;
  const missing = applyStyleOperations(missingStyle, [
    { layerId: 'missing' },
    { layerId: 'roads', filter: rankFilter },
  ]);
  assert.equal(missing.success, false);
  assert.equal(missing.message, 'Layer "missing" not found.');
  assert.strictEqual(missing.style, missingStyle);
  assert.deepEqual(missing.changedLayers, []);
  assert.deepEqual(missing.diffSummary, []);
  assert.deepEqual(missingStyle.layers[0]?.filter, classFilter);
});
