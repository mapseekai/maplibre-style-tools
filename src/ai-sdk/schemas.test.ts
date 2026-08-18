import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { z } from 'zod';
import { jsonUtf8ByteLength } from '../core/index.js';
import {
  applyStyleDocumentInputSchema,
  applyStyleTransactionInputSchema,
  filterTextSchema,
  inspectStyleInputSchema,
  jsonOrRawStringTextSchema,
  legacyOperationsTextSchema,
  queryMapFeaturesInputSchema,
  runMapCommandInputSchema,
  strictJsonTextSchema,
  styleJsonOrUrlTextSchema,
} from './schemas.js';
import {
  normalizeLegacyOperations,
  parseJsonOrRawString,
  parseStrictJson,
} from './compatibility.js';
import type { ParseResult } from './compatibility.js';
import type {
  ApplyStyleDocumentInput,
  ApplyStyleTransactionInput,
  InspectStyleInput,
  QueryMapFeaturesInput,
  RunMapCommandInput,
} from './contracts.js';

type Assert<T extends true> = T;
type Extends<Left, Right> = Left extends Right ? true : false;
type _StrictJsonText = Assert<Extends<z.output<typeof strictJsonTextSchema>, string>>;
type _JsonOrRawText = Assert<Extends<z.output<typeof jsonOrRawStringTextSchema>, string>>;
type _InspectStyleInput = Assert<Extends<z.output<typeof inspectStyleInputSchema>, InspectStyleInput>>;
type _ApplyStyleTransactionInput = Assert<Extends<z.output<typeof applyStyleTransactionInputSchema>, ApplyStyleTransactionInput>>;
type _ApplyStyleDocumentInput = Assert<Extends<z.output<typeof applyStyleDocumentInputSchema>, ApplyStyleDocumentInput>>;
type _RunMapCommandInput = Assert<Extends<z.output<typeof runMapCommandInputSchema>, RunMapCommandInput>>;
type _QueryMapFeaturesInput = Assert<Extends<z.output<typeof queryMapFeaturesInputSchema>, QueryMapFeaturesInput>>;
const strictJsonTextType: _StrictJsonText = true;
const jsonOrRawTextType: _JsonOrRawText = true;
const inspectStyleInputType: _InspectStyleInput = true;
const applyStyleTransactionInputType: _ApplyStyleTransactionInput = true;
const applyStyleDocumentInputType: _ApplyStyleDocumentInput = true;
const runMapCommandInputType: _RunMapCommandInput = true;
const queryMapFeaturesInputType: _QueryMapFeaturesInput = true;
void strictJsonTextType;
void jsonOrRawTextType;
void inspectStyleInputType;
void applyStyleTransactionInputType;
void applyStyleDocumentInputType;
void runMapCommandInputType;
void queryMapFeaturesInputType;

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

test('unified schemas accept every native action variant', () => {
  const style = { version: 8, sources: {}, layers: [] };
  const operation = {
    op: 'setLayerProperties',
    layerId: 'roads',
    paint: { 'line-color': null },
  };
  const feature = {
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [0, 1] },
    properties: {},
  };

  const inspectionInputs = [
    { action: 'listLayers' },
    { action: 'listSources' },
    { action: 'getLayer', layerId: 'roads', fields: ['paint'] },
    { action: 'getSource', sourceId: 'roads' },
    { action: 'getRoot' },
    { action: 'getContext' },
    { action: 'inspectLayers', layerIds: ['roads'], fields: ['layout'] },
    { action: 'getLayerCount' },
    { action: 'validateDocument', style },
    { action: 'validateCurrentMap' },
    { action: 'validateTransaction', transaction: { operations: [operation] } },
    { action: 'analyzeGeoJson', data: feature },
    { action: 'listSourceLayers', sourceId: 'roads' },
  ];
  for (const input of inspectionInputs) {
    assert.equal(inspectStyleInputSchema.safeParse(input).success, true);
  }

  assert.equal(applyStyleTransactionInputSchema.safeParse({
    transaction: { operations: [] },
  }).success, true);
  assert.equal(applyStyleTransactionInputSchema.safeParse({
    transaction: { operations: [operation], validate: true },
    dryRun: false,
    diff: true,
  }).success, true);
  assert.equal(applyStyleDocumentInputSchema.safeParse({
    source: { kind: 'style', style },
  }).success, true);
  assert.equal(applyStyleDocumentInputSchema.safeParse({
    source: { kind: 'url', url: 'https://example.test/style.json' },
  }).success, true);

  const commandInputs = [
    { action: 'updateGeoJsonData', sourceId: 'roads', diff: { add: [feature] } },
    { action: 'setSourceTileLodParams', maxZoomLevelsOnScreen: 2, tileCountMaxMinRatio: 1 },
    { action: 'setFeatureState', target: { source: 'roads', id: 1 }, state: { selected: true } },
    { action: 'removeFeatureState', target: { source: 'roads', id: 'a' } },
    { action: 'setGlobalState', propertyName: 'theme', value: 'dark' },
    { action: 'listImages' },
    { action: 'addImageFromUrl', imageId: 'marker', url: 'https://example.test/marker.png', options: { pixelRatio: 2 } },
    { action: 'removeImage', imageId: 'marker' },
    { action: 'listSprites' },
    { action: 'addSprite', spriteId: 'base', url: 'https://example.test/sprite.json' },
    { action: 'removeSprite', spriteId: 'base' },
  ];
  for (const input of commandInputs) {
    assert.equal(runMapCommandInputSchema.safeParse(input).success, true);
  }

  assert.equal(queryMapFeaturesInputSchema.safeParse({
    target: 'source',
    sourceId: 'roads',
    filter: ['==', ['get', 'kind'], 'road'],
    propertyAllowlist: ['kind'],
  }).success, true);
  assert.equal(queryMapFeaturesInputSchema.safeParse({
    target: 'rendered',
    geometry: { kind: 'bounds', bounds: [[0, 1], [2, 3]] },
    layerIds: ['roads'],
  }).success, true);
});

test('unified schemas reject unknown keys, legacy JSON text, and empty inspection transactions', () => {
  const invalidCases = [
    { schema: inspectStyleInputSchema, input: { action: 'listLayers', unknown: true } },
    { schema: inspectStyleInputSchema, input: { action: 'getLayer', layerId: 'roads', fields: ['paint'], extra: 1 } },
    { schema: inspectStyleInputSchema, input: { action: 'validateTransaction', transaction: { operations: [] } } },
    { schema: applyStyleTransactionInputSchema, input: { transaction: { operationsJson: '[]' } } },
    { schema: applyStyleDocumentInputSchema, input: { source: { kind: 'url', url: './relative.json' } } },
    { schema: runMapCommandInputSchema, input: { action: 'addImageFromUrl', imageId: 'i', url: 'https://x', options: { bogus: true } } },
    { schema: queryMapFeaturesInputSchema, input: { target: 'rendered', geometry: { kind: 'point', point: [0, 1], extra: true } } },
    { schema: queryMapFeaturesInputSchema, input: { target: 'rendered', layerIds: ['roads', 'roads'] } },
    { schema: queryMapFeaturesInputSchema, input: { target: 'source', sourceId: 'roads', propertyAllowlist: ['kind', 'kind'] } },
  ];
  for (const { schema, input } of invalidCases) {
    assert.equal(schema.safeParse(input).success, false);
  }
});

test('ParseResult narrows value to the successful branch', () => {
  const result: ParseResult<string> = { ok: true, value: 'value' };
  if (result.ok) assert.equal(result.value, 'value');
  // @ts-expect-error value is unavailable when parsing failed.
  const failedValue = ({ ok: false, error: {} }).value;
  void failedValue;
});
