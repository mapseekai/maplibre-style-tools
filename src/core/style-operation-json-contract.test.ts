import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { JsonObject, StyleOperation } from './types.js';

const setLayerFilterJsonContract = {
  op: 'setLayerFilter',
  layerId: 'roads',
  mode: 'clear',
} satisfies StyleOperation;

const addSourceJsonContract = {
  op: 'addSource',
  sourceId: 'incidents',
  source: {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  },
} satisfies StyleOperation;

const duplicateLayerJsonContract = {
  op: 'duplicateLayer',
  layerId: 'roads',
  newLayerId: 'roads-copy',
  beforeId: 'labels',
} satisfies StyleOperation;

const addLayerFromSourceJsonContract = {
  op: 'addLayerFromSource',
  layerId: 'roads',
  sourceId: 'basemap',
  sourceLayer: 'transportation',
  type: 'line',
  beforeId: 'labels',
} satisfies StyleOperation;

const addGeoJsonLayerJsonContract = {
  op: 'addGeoJsonLayer',
  sourceId: 'incidents',
  layerId: 'incidents-circle',
  data: { type: 'FeatureCollection', features: [] },
  type: 'circle',
  afterId: 'roads',
} satisfies StyleOperation;

const addLayerDefinitionJsonContract = {
  op: 'addLayerDefinition',
  layer: { id: 'background', type: 'background' },
} satisfies StyleOperation;

type AssertTrue<T extends true> = T;
type StyleOperationIsJsonObject = AssertTrue<
  StyleOperation extends JsonObject ? true : false
>;

it('keeps every StyleOperation variant JSON-backed', () => {
  const compiled: StyleOperationIsJsonObject = true;
  assert.equal(compiled, true);
  assert.equal(setLayerFilterJsonContract.op, 'setLayerFilter');
  assert.equal(addSourceJsonContract.op, 'addSource');
  assert.equal(duplicateLayerJsonContract.op, 'duplicateLayer');
  assert.equal(addLayerFromSourceJsonContract.op, 'addLayerFromSource');
});

it('keeps addGeoJsonLayer in the closed JSON-backed union', () => {
  assert.equal(addGeoJsonLayerJsonContract.op, 'addGeoJsonLayer');
  assert.equal(addLayerDefinitionJsonContract.op, 'addLayerDefinition');
});
