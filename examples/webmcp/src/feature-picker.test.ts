import assert from 'node:assert/strict';
import test from 'node:test';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';

import { pickRenderedFeatures, propertyOptionsFor } from './feature-picker.js';

const event = {
  point: { x: 20, y: 30 },
  lngLat: { lng: 12.5, lat: -8.25 },
} as MapMouseEvent;

const rawFeature = ({
  id,
  layerId = 'road',
  source = 'base',
  sourceLayer,
  properties = { name: 'Main Street' },
  geometry = { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
}: {
  id?: string | number;
  layerId?: string;
  source?: string;
  sourceLayer?: string;
  properties?: Record<string, unknown>;
  geometry?: Record<string, unknown>;
} = {}) => ({
  ...(id === undefined ? {} : { id }),
  layer: { id: layerId },
  source,
  ...(sourceLayer === undefined ? {} : { sourceLayer }),
  properties,
  geometry,
}) as never;

const fakeMap = (rendered: readonly unknown[]): MapLibreMap => ({
  queryRenderedFeatures: () => rendered,
}) as unknown as MapLibreMap;

test('queries every rendered feature without a layer allowlist', () => {
  const calls: unknown[][] = [];
  const map = {
    queryRenderedFeatures(...args: unknown[]) {
      calls.push(args);
      return [rawFeature({ id: 7, layerId: 'road', source: 'base' })];
    },
  } as unknown as MapLibreMap;

  const result = pickRenderedFeatures(map, event);

  assert.deepEqual(calls, [[event.point]]);
  assert.equal(result.candidates[0]?.feature.layerId, 'road');
  assert.equal(result.candidates[0]?.geometry.type, 'LineString');
});

test('deduplicates before retaining the topmost ten', () => {
  const rendered = [
    rawFeature({ id: 1, layerId: 'top', source: 'base' }),
    rawFeature({ id: 1, layerId: 'top', source: 'base' }),
    ...Array.from({ length: 11 }, (_, index) => rawFeature({ id: index + 2, layerId: `layer-${index}`, source: 'base' })),
  ];

  const result = pickRenderedFeatures(fakeMap(rendered), event);

  assert.equal(result.candidates.length, 10);
  assert.equal(result.candidates[0]?.feature.layerId, 'top');
  assert.equal(result.truncated, true);
});

test('deduplicates stable IDs but preserves the same source feature in distinct style layers', () => {
  const result = pickRenderedFeatures(fakeMap([
    rawFeature({ id: 'same', layerId: 'top', source: 'base' }),
    rawFeature({ id: 'same', layerId: 'top', source: 'base', properties: { name: 'changed' } }),
    rawFeature({ id: 'same', layerId: 'bottom', source: 'base' }),
  ]), event);

  assert.deepEqual(result.candidates.map(({ feature }) => feature.layerId), ['top', 'bottom']);
  assert.equal(result.truncated, false);
});

test('deduplicates no-ID candidates only with matching identity, geometry, and scalar properties', () => {
  const result = pickRenderedFeatures(fakeMap([
    rawFeature({ sourceLayer: 'roads', properties: { b: 2, a: 'one', nested: { skip: true } } }),
    rawFeature({ sourceLayer: 'roads', properties: { a: 'one', b: 2 } }),
    rawFeature({ sourceLayer: 'roads', properties: { a: 'different', b: 2 } }),
    rawFeature({ sourceLayer: 'roads', properties: { a: 'one', b: 2 }, geometry: { type: 'LineString', coordinates: [[0, 0], [2, 2]] } }),
    rawFeature({ sourceLayer: 'other', properties: { a: 'one', b: 2 } }),
  ]), event);

  assert.equal(result.candidates.length, 4);
  assert.deepEqual(result.candidates.map(({ feature, geometry }) => [
    feature.sourceLayer,
    feature.properties.a,
    JSON.stringify(geometry),
  ]), [
    ['roads', 'one', '{"type":"LineString","coordinates":[[0,0],[1,1]]}'],
    ['roads', 'different', '{"type":"LineString","coordinates":[[0,0],[1,1]]}'],
    ['roads', 'one', '{"type":"LineString","coordinates":[[0,0],[2,2]]}'],
    ['other', 'one', '{"type":"LineString","coordinates":[[0,0],[1,1]]}'],
  ]);
});

test('excludes invalid identities and enforces property projection bounds', () => {
  const result = pickRenderedFeatures(fakeMap([
    rawFeature({ layerId: '' }),
    rawFeature({ source: '' }),
    rawFeature({ sourceLayer: '' }),
    rawFeature({ properties: Object.fromEntries([
      ...Array.from({ length: 20 }, (_, index) => [`p${index}`, index]),
      ['x'.repeat(81), 'skip'],
      ['long', 'y'.repeat(241)],
      ['nested', { unsafe: true }],
    ]) }),
  ]), event);

  assert.equal(result.candidates.length, 1);
  assert.equal(Object.keys(result.candidates[0]!.feature.properties).length, 20);
  assert.equal(result.candidates[0]!.feature.properties.long, undefined);
});

test('truncates scalar property names and string values at the required bounds', () => {
  const result = pickRenderedFeatures(fakeMap([
    rawFeature({ properties: {
      ['n'.repeat(80)]: 'v'.repeat(240),
      ['n'.repeat(81)]: 'skip',
      tooLong: 'v'.repeat(241),
      infinite: Infinity,
    } }),
  ]), event);

  const properties = result.candidates[0]!.feature.properties;
  assert.deepEqual(Object.keys(properties), ['n'.repeat(80), 'tooLong']);
  assert.equal(properties['n'.repeat(80)], 'v'.repeat(240));
  assert.equal(properties.tooLong, 'v'.repeat(240));
});

test('sorts scalar property choices and preserves scalar types', () => {
  assert.deepEqual(propertyOptionsFor({
    layerId: 'road', sourceId: 'base', lngLat: [0, 0],
    properties: { z: null, a: false, n: 2, s: 'two' },
  }).map(({ property, value }) => [property, value]), [
    ['a', false], ['n', 2], ['s', 'two'], ['z', null],
  ]);
});
