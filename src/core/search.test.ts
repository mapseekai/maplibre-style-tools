import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  listSourceLayers,
  searchLayers,
} from './search.js';
import {
  listSourceLayers as publicListSourceLayers,
  listSourceLayersOptionsSchema as publicListSourceLayersOptionsSchema,
} from './index.js';
import { listSourceLayersOptionsSchema } from './schemas.js';
import type {
  JsonObject, JsonValue, ListSourceLayersOptions, SourceLayerUsage, StyleDocument,
} from './types.js';

const style: StyleDocument = {
  version: 8,
  sources: { basemap: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] } },
  layers: [
    { id: 'road-primary', type: 'line', source: 'basemap', 'source-layer': 'Transportation' },
    { id: 'road-label', type: 'symbol', source: 'basemap', 'source-layer': 'transportation_name' },
  ],
};

test('searchLayers matches id type source and source-layer case-insensitively', () => {
  const result = searchLayers(style, { query: 'ROAD' });
  const resultObject: JsonObject = result;
  const resultValue: JsonValue = result;
  assert.deepEqual(result.layers.map(({ id }) => id), ['road-primary', 'road-label']);
  assert.deepEqual(searchLayers(style, { sourceLayer: 'transportation' }).layers.map(({ id }) => id),
    ['road-primary', 'road-label']);
  assert.equal(searchLayers(style, { type: 'line', source: 'basemap' }).total, 1);
  const first = result.layers[0];
  assert.ok(first);
  assert.equal(Object.hasOwn(first, 'minzoom'), false);
  void resultValue;
  void resultObject;
});

test('searchLayers reports total before applying limit', () => {
  const result = searchLayers(style, { query: 'road', limit: 1 });
  assert.equal(result.total, 2);
  assert.deepEqual(result.layers.map(({ id }) => id), ['road-primary']);
});

test('listSourceLayers aggregates actual references in style order and deterministic groups', () => {
  const references: StyleDocument = {
    version: 8,
    sources: {
      metadataOnly: {
        type: 'vector',
        vector_layers: [{ id: 'invented' }],
      },
    },
    layers: [
      { id: 'z-first', type: 'line', source: 'z', 'source-layer': 'roads' },
      { id: 'a-later', type: 'symbol', source: 'a', 'source-layer': 'places' },
      { id: 'z-second', type: 'symbol', source: 'z', 'source-layer': 'roads' },
      { id: 'a-first', type: 'fill', source: 'a', 'source-layer': 'areas' },
      { id: 'geojson', type: 'circle', source: 'local' },
      { id: 'empty', type: 'line', source: 'z', 'source-layer': '' },
    ],
  };

  const result = listSourceLayers(references);

  assert.deepEqual(result, [
    {
      sourceId: 'a', sourceLayer: 'areas', layers: [{ id: 'a-first', type: 'fill' }],
    },
    {
      sourceId: 'a', sourceLayer: 'places', layers: [{ id: 'a-later', type: 'symbol' }],
    },
    {
      sourceId: 'z', sourceLayer: 'roads', layers: [
        { id: 'z-first', type: 'line' },
        { id: 'z-second', type: 'symbol' },
      ],
    },
  ] satisfies SourceLayerUsage[]);
});

test('listSourceLayers filters exact source IDs and distinguishes punctuation-colliding IDs', () => {
  const references: StyleDocument = {
    version: 8,
    sources: {},
    layers: [
      { id: 'first', type: 'line', source: 'a|b', 'source-layer': 'c' },
      { id: 'second', type: 'fill', source: 'a', 'source-layer': 'b|c' },
      { id: 'third', type: 'symbol', source: 'a', 'source-layer': 'a' },
    ],
  };

  assert.deepEqual(listSourceLayers(references), [
    { sourceId: 'a', sourceLayer: 'a', layers: [{ id: 'third', type: 'symbol' }] },
    { sourceId: 'a', sourceLayer: 'b|c', layers: [{ id: 'second', type: 'fill' }] },
    { sourceId: 'a|b', sourceLayer: 'c', layers: [{ id: 'first', type: 'line' }] },
  ]);
  assert.deepEqual(listSourceLayers(references, { sourceId: 'a' }), [
    { sourceId: 'a', sourceLayer: 'a', layers: [{ id: 'third', type: 'symbol' }] },
    { sourceId: 'a', sourceLayer: 'b|c', layers: [{ id: 'second', type: 'fill' }] },
  ]);
});

test('listSourceLayers does not read source metadata and returns fresh output values', () => {
  let sourceReads = 0;
  const references = {
    version: 8,
    get sources() {
      sourceReads += 1;
      throw new Error('source metadata must not be read');
    },
    layers: [{ id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads' }],
  } as unknown as StyleDocument;

  const first = listSourceLayers(references);
  first[0]?.layers.push({ id: 'mutated', type: 'line' });
  const second = listSourceLayers(references);

  assert.equal(sourceReads, 0);
  assert.deepEqual(second, [
    { sourceId: 'base', sourceLayer: 'roads', layers: [{ id: 'roads', type: 'line' }] },
  ]);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first[0], second[0]);
  assert.notStrictEqual(first[0]?.layers, second[0]?.layers);
});

test('listSourceLayers options schema is strict, descriptor-safe, and publicly exported', () => {
  assert.strictEqual(publicListSourceLayers, listSourceLayers);
  assert.strictEqual(publicListSourceLayersOptionsSchema, listSourceLayersOptionsSchema);
  assert.deepEqual(listSourceLayersOptionsSchema.parse({}), {});
  assert.deepEqual(listSourceLayersOptionsSchema.parse({ sourceId: 'base' }), { sourceId: 'base' });
  assert.equal(listSourceLayersOptionsSchema.safeParse({ sourceId: '' }).success, false);
  assert.equal(listSourceLayersOptionsSchema.safeParse({ sourceId: 'base', unknown: true }).success, false);
  assert.equal(listSourceLayersOptionsSchema.safeParse(JSON.parse('{"constructor":true}')).success, false);

  let getterCalls = 0;
  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, 'sourceId', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not run');
    },
  });
  assert.equal(listSourceLayersOptionsSchema.safeParse(accessor).success, false);
  assert.equal(getterCalls, 0);
});

test('listSourceLayers parses omitted or hostile options before any discovery', () => {
  let layerReads = 0;
  const hostileStyle = {
    version: 8,
    sources: {},
    get layers() {
      layerReads += 1;
      throw new Error('layers must not be read');
    },
  } as unknown as StyleDocument;
  const hostileOptions: Record<string, unknown> = {};
  let getterCalls = 0;
  Object.defineProperty(hostileOptions, 'sourceId', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not run');
    },
  });

  assert.throws(
    () => listSourceLayers(hostileStyle, hostileOptions as ListSourceLayersOptions),
  );
  assert.equal(getterCalls, 0);
  assert.equal(layerReads, 0);
  assert.throws(() => listSourceLayers(hostileStyle));
  assert.equal(layerReads, 1);
});
