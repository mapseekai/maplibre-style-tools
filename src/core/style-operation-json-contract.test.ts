import assert from 'node:assert/strict';
import { it } from 'node:test';
import { styleOperationSchema } from './index.js';
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

it('keeps representative StyleOperation variants JSON-backed', () => {
  const compiled: StyleOperationIsJsonObject = true;
  void compiled;

  const parsedOperations = [
    styleOperationSchema.parse(setLayerFilterJsonContract),
    styleOperationSchema.parse(addSourceJsonContract),
    styleOperationSchema.parse(duplicateLayerJsonContract),
    styleOperationSchema.parse(addLayerFromSourceJsonContract),
    styleOperationSchema.parse(addGeoJsonLayerJsonContract),
    styleOperationSchema.parse(addLayerDefinitionJsonContract),
  ];

  assert.deepEqual(JSON.parse(JSON.stringify(parsedOperations)), [
    { op: 'setLayerFilter', layerId: 'roads', mode: 'clear' },
    {
      op: 'addSource',
      sourceId: 'incidents',
      source: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      },
    },
    {
      op: 'duplicateLayer',
      layerId: 'roads',
      newLayerId: 'roads-copy',
      beforeId: 'labels',
    },
    {
      op: 'addLayerFromSource',
      layerId: 'roads',
      sourceId: 'basemap',
      sourceLayer: 'transportation',
      type: 'line',
      beforeId: 'labels',
    },
    {
      op: 'addGeoJsonLayer',
      sourceId: 'incidents',
      layerId: 'incidents-circle',
      data: { type: 'FeatureCollection', features: [] },
      type: 'circle',
      afterId: 'roads',
    },
    {
      op: 'addLayerDefinition',
      layer: { id: 'background', type: 'background' },
    },
  ]);
});
