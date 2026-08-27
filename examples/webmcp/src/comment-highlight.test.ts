import assert from 'node:assert/strict';
import test from 'node:test';
import type { Map as MapLibreMap } from 'maplibre-gl';

import type { FeatureGeometry } from './feature-picker.js';
import { createCommentHighlight } from './comment-highlight.js';

const pointGeometry = { type: 'Point', coordinates: [1, 2] } as FeatureGeometry;
const lineGeometry = { type: 'LineString', coordinates: [[1, 2], [3, 4]] } as FeatureGeometry;
const polygonGeometry = {
  type: 'Polygon',
  coordinates: [[[1, 2], [3, 4], [5, 6], [1, 2]]],
} as FeatureGeometry;

const SOURCE_ID = 'webmcp-comment-highlight';
const LAYER_IDS = [
  'webmcp-comment-highlight-fill',
  'webmcp-comment-highlight-line',
  'webmcp-comment-highlight-point',
];

type FeatureCollection = {
  readonly type: 'FeatureCollection';
  readonly features: readonly { readonly type: 'Feature'; readonly geometry: FeatureGeometry }[];
};

type GeoJsonSource = { setData(data: FeatureCollection): void };

class FakeHighlightMap {
  readonly addedLayers: { id: string }[] = [];
  #sources = new Map<string, GeoJsonSource>();
  #layers = new Map<string, { id: string }>();
  #listeners = new Map<string, Set<() => void>>();
  currentData: FeatureCollection = { type: 'FeatureCollection', features: [] };

  addSource(id: string, source: { readonly data: FeatureCollection }): void {
    this.currentData = source.data;
    this.#sources.set(id, { setData: (data) => { this.currentData = data; } });
  }

  getSource(id: string): GeoJsonSource | undefined { return this.#sources.get(id); }
  removeSource(id: string): void { this.#sources.delete(id); }

  addLayer(layer: { id: string }): void {
    this.addedLayers.push(layer);
    this.#layers.set(layer.id, layer);
  }

  getLayer(id: string): { id: string } | undefined { return this.#layers.get(id); }
  removeLayer(id: string): void { this.#layers.delete(id); }

  on(type: string, listener: () => void): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  off(type: string, listener: () => void): void { this.#listeners.get(type)?.delete(listener); }
  emit(type: string): void { for (const listener of this.#listeners.get(type) ?? []) listener(); }
  listenerCount(type: string): number { return this.#listeners.get(type)?.size ?? 0; }

  dropStyleOwnedData(): void {
    this.#sources.clear();
    this.#layers.clear();
    this.currentData = { type: 'FeatureCollection', features: [] };
  }

  asMap(): MapLibreMap { return this as unknown as MapLibreMap; }
}

test('renders point, line, and polygon through the reserved source', () => {
  const map = new FakeHighlightMap();
  const controller = createCommentHighlight(map.asMap(), new AbortController().signal);

  for (const geometry of [pointGeometry, lineGeometry, polygonGeometry]) {
    controller.show('draft', geometry);
    assert.deepEqual(map.currentData.features[0]?.geometry, geometry);
  }

  assert.deepEqual(map.addedLayers.map(({ id }) => id), LAYER_IDS);
});

test('does not let a pin clear a draft-owned highlight', () => {
  const map = new FakeHighlightMap();
  const controller = createCommentHighlight(map.asMap(), new AbortController().signal);

  controller.show('draft', polygonGeometry);
  controller.clear('map-selection-a');
  assert.deepEqual(map.currentData.features[0]?.geometry, polygonGeometry);
  controller.clear('draft');
  assert.equal(map.currentData.features.length, 0);
});

test('clearAll removes a highlight regardless of owner', () => {
  const map = new FakeHighlightMap();
  const controller = createCommentHighlight(map.asMap(), new AbortController().signal);

  controller.show('map-selection-a', lineGeometry);
  controller.clearAll();

  assert.equal(map.currentData.features.length, 0);
});

test('restores current geometry after style load and tears down on abort', () => {
  const map = new FakeHighlightMap();
  const lifetime = new AbortController();
  const controller = createCommentHighlight(map.asMap(), lifetime.signal);

  controller.show('map-selection-a', pointGeometry);
  map.dropStyleOwnedData();
  map.emit('style.load');
  assert.deepEqual(map.currentData.features[0]?.geometry, pointGeometry);
  lifetime.abort();
  assert.equal(map.listenerCount('style.load'), 0);
  assert.equal(map.getSource(SOURCE_ID), undefined);
  assert.deepEqual(LAYER_IDS.map((id) => map.getLayer(id)), [undefined, undefined, undefined]);
});

test('destroy is idempotent', () => {
  const map = new FakeHighlightMap();
  const controller = createCommentHighlight(map.asMap(), new AbortController().signal);

  controller.show('draft', pointGeometry);
  controller.destroy();
  controller.destroy();

  assert.equal(map.listenerCount('style.load'), 0);
  assert.equal(map.getSource(SOURCE_ID), undefined);
  assert.deepEqual(LAYER_IDS.map((id) => map.getLayer(id)), [undefined, undefined, undefined]);
});
