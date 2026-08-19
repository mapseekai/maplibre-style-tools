import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  featureQueryLimitsSchema,
  renderedFeatureQueryInputSchema,
  sourceFeatureQueryInputSchema,
} from './schemas.js';

test('feature query limit schema accepts only strict positive safe integers', () => {
  assert.deepEqual(featureQueryLimitsSchema.parse({
    maxFeatures: 2,
    maxSerializedBytes: 3,
  }), { maxFeatures: 2, maxSerializedBytes: 3 });

  for (const value of [
    { maxFeatures: 0, maxSerializedBytes: 1 },
    { maxFeatures: 1.5, maxSerializedBytes: 1 },
    { maxFeatures: Number.MAX_SAFE_INTEGER + 1, maxSerializedBytes: 1 },
    { maxFeatures: 1, maxSerializedBytes: 0 },
    { maxFeatures: 1, maxSerializedBytes: 1, extra: true },
  ]) {
    assert.equal(featureQueryLimitsSchema.safeParse(value).success, false);
  }
});

test('source feature query input rejects unsafe and projection-invalid values', () => {
  assert.deepEqual(sourceFeatureQueryInputSchema.parse({ sourceId: 'roads' }), {
    sourceId: 'roads',
  });

  for (const value of [
    { sourceId: '' },
    { sourceId: 'roads', sourceLayer: '' },
    { sourceId: 'roads', filter: ['==', 'kind', () => 'road'] },
    { sourceId: 'roads', filter: ['==', 'kind', 'road'] },
    { sourceId: 'roads', propertyAllowlist: ['name', 'name'] },
    { sourceId: 'roads', propertyAllowlist: [''] },
    { sourceId: 'roads', limit: 0 },
    { sourceId: 'roads', maxSerializedBytes: Number.MAX_SAFE_INTEGER + 1 },
    { sourceId: 'roads', extra: true },
  ]) {
    assert.equal(sourceFeatureQueryInputSchema.safeParse(value).success, false);
  }
});

test('rendered feature query input is strict and defaults to the viewport', () => {
  assert.deepEqual(renderedFeatureQueryInputSchema.parse({}), {
    geometry: { kind: 'viewport' },
  });
  assert.deepEqual(renderedFeatureQueryInputSchema.parse({
    geometry: { kind: 'point', point: [5, -3] },
    layerIds: ['roads'],
    filter: ['==', ['get', 'kind'], 'road'],
  }), {
    geometry: { kind: 'point', point: [5, -3] },
    layerIds: ['roads'],
    filter: ['==', ['get', 'kind'], 'road'],
  });

  for (const value of [
    { geometry: { kind: 'viewport', point: [0, 0] } },
    { geometry: { kind: 'point', point: [Infinity, 0] } },
    { geometry: { kind: 'point', point: [0] } },
    { geometry: { kind: 'bounds', bounds: [[0, 0], [1, NaN]] } },
    { geometry: { kind: 'bounds', bounds: [[0, 0], [1, 1]], extra: true } },
    { geometry: { kind: 'circle', point: [0, 0] } },
    { layerIds: ['roads', 'roads'] },
    { layerIds: [''] },
    { filter: ['==', 'kind', undefined] },
    { filter: ['==', 'kind', 'road'] },
    { unknown: true },
  ]) {
    assert.equal(renderedFeatureQueryInputSchema.safeParse(value).success, false);
  }
});
