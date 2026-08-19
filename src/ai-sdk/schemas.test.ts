import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { z } from 'zod';
import {
  applyStyleDocumentInputSchema,
  applyStyleTransactionInputSchema,
  inspectStyleInputSchema,
  queryMapFeaturesInputSchema,
  runMapCommandInputSchema,
} from './schemas.js';
import type {
  ApplyStyleDocumentInput,
  ApplyStyleTransactionInput,
  InspectStyleInput,
  QueryMapFeaturesInput,
  RunMapCommandInput,
} from './contracts.js';

type Assert<T extends true> = T;
type Extends<Left, Right> = Left extends Right ? true : false;
type _InspectStyleInput = Assert<Extends<z.output<typeof inspectStyleInputSchema>, InspectStyleInput>>;
type _ApplyStyleTransactionInput = Assert<Extends<z.output<typeof applyStyleTransactionInputSchema>, ApplyStyleTransactionInput>>;
type _ApplyStyleDocumentInput = Assert<Extends<z.output<typeof applyStyleDocumentInputSchema>, ApplyStyleDocumentInput>>;
type _RunMapCommandInput = Assert<Extends<z.output<typeof runMapCommandInputSchema>, RunMapCommandInput>>;
type _QueryMapFeaturesInput = Assert<Extends<z.output<typeof queryMapFeaturesInputSchema>, QueryMapFeaturesInput>>;
const inspectStyleInputType: _InspectStyleInput = true;
const applyStyleTransactionInputType: _ApplyStyleTransactionInput = true;
const applyStyleDocumentInputType: _ApplyStyleDocumentInput = true;
const runMapCommandInputType: _RunMapCommandInput = true;
const queryMapFeaturesInputType: _QueryMapFeaturesInput = true;
void inspectStyleInputType;
void applyStyleTransactionInputType;
void applyStyleDocumentInputType;
void runMapCommandInputType;
void queryMapFeaturesInputType;


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


test('unified schemas snapshot hostile root inputs without invoking accessors', () => {
  const validRoots = [
    { schema: inspectStyleInputSchema, input: { action: 'getRoot' } },
    { schema: applyStyleTransactionInputSchema, input: { transaction: { operations: [] } } },
    { schema: applyStyleDocumentInputSchema, input: { source: { kind: 'url', url: 'https://example.test/style.json' } } },
    { schema: runMapCommandInputSchema, input: { action: 'listImages' } },
    { schema: queryMapFeaturesInputSchema, input: { target: 'rendered' } },
  ];
  for (const { schema, input } of validRoots) {
    let getterCalls = 0;
    const hostile = { ...input };
    Object.defineProperty(hostile, 'unknown', {
      enumerable: true,
      get() { getterCalls += 1; return true; },
    });
    assert.equal(schema.safeParse(hostile).success, false);
    const classBacked = Object.setPrototypeOf({ ...input }, Date.prototype);
    assert.equal(schema.safeParse(classBacked).success, false);
    assert.equal(getterCalls, 0);
  }
});

test('unified transaction uses the core nonempty transaction boundary', () => {
  const operation = {
    op: 'setLayerProperties',
    layerId: 'roads',
    paint: { 'line-color': null },
  };
  const parse = applyStyleTransactionInputSchema.safeParse({
    transaction: { operations: Array.from({ length: 101 }, () => operation) },
  });
  assert.equal(parse.success, false);

  const parsed = applyStyleTransactionInputSchema.safeParse({
    transaction: { operations: [operation] },
  });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.transaction.validate, true);
});

test('inspectLayers preserves duplicate order while feature-state IDs remain nonblank', () => {
  assert.equal(inspectStyleInputSchema.safeParse({
    action: 'inspectLayers', layerIds: ['roads', 'roads'],
  }).success, true);
  for (const id of ['', '   ']) {
    assert.equal(runMapCommandInputSchema.safeParse({
      action: 'setFeatureState',
      target: { source: 'roads', id },
      state: {},
    }).success, false);
  }
});
