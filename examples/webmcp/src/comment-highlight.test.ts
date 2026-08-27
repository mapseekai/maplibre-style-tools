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

type LayerDefinition = {
  readonly id: string;
  readonly source?: string;
  readonly type?: string;
  readonly filter?: unknown;
};

class FakeAbortSignal {
  aborted = false;
  #listeners = new Set<() => void>();

  addEventListener(type: string, listener: () => void): void {
    if (type === 'abort') this.#listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'abort') this.#listeners.delete(listener);
  }

  abort(): void {
    this.aborted = true;
    for (const listener of this.#listeners) listener();
  }

  listenerCount(): number { return this.#listeners.size; }
  asSignal(): AbortSignal { return this as unknown as AbortSignal; }
}

class FakeHighlightMap {
  readonly addedLayers: LayerDefinition[] = [];
  #sources = new Map<string, GeoJsonSource>();
  #layers = new Map<string, LayerDefinition>();
  #listeners = new Map<string, Set<() => void>>();
  currentData: FeatureCollection = { type: 'FeatureCollection', features: [] };
  dataUpdateCount = 0;

  addSource(id: string, source: { readonly data: FeatureCollection }): void {
    this.currentData = source.data;
    this.dataUpdateCount += 1;
    this.#sources.set(id, {
      setData: (data) => {
        this.currentData = data;
        this.dataUpdateCount += 1;
      },
    });
  }

  getSource(id: string): GeoJsonSource | undefined { return this.#sources.get(id); }
  removeSource(id: string): void { this.#sources.delete(id); }

  addLayer(layer: LayerDefinition): void {
    this.addedLayers.push(layer);
    this.#layers.set(layer.id, layer);
  }

  getLayer(id: string): LayerDefinition | undefined { return this.#layers.get(id); }
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

  assert.equal(map.dataUpdateCount, 3);
  assert.deepEqual(map.addedLayers.map(({ id }) => id), LAYER_IDS);
  assert.deepEqual(map.addedLayers.map(({ source, type, filter }) => ({ source, type, filter })), [
    { source: SOURCE_ID, type: 'fill', filter: ['==', '$type', 'Polygon'] },
    { source: SOURCE_ID, type: 'line', filter: ['==', '$type', 'LineString'] },
    { source: SOURCE_ID, type: 'circle', filter: ['==', '$type', 'Point'] },
  ]);
});

test('does not let a pin clear a draft-owned highlight', () => {
  const map = new FakeHighlightMap();
  const controller = createCommentHighlight(map.asMap(), new AbortController().signal);

  controller.show('draft', polygonGeometry);
  controller.clear('map-selection-a');
  assert.deepEqual(map.currentData.features[0]?.geometry, polygonGeometry);
  controller.clear('draft');
  assert.equal(map.currentData.features.length, 0);
  assert.equal(map.dataUpdateCount, 2);
});

test('clearAll removes a highlight regardless of owner', () => {
  const map = new FakeHighlightMap();
  const controller = createCommentHighlight(map.asMap(), new AbortController().signal);

  controller.show('map-selection-a', lineGeometry);
  controller.clearAll();

  assert.equal(map.currentData.features.length, 0);
  assert.equal(map.dataUpdateCount, 2);
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
  assert.equal(map.dataUpdateCount, 2);
});

test('destroy removes the abort callback and is idempotent', () => {
  const map = new FakeHighlightMap();
  const lifetime = new FakeAbortSignal();
  const controller = createCommentHighlight(map.asMap(), lifetime.asSignal());

  controller.show('draft', pointGeometry);
  controller.destroy();
  controller.destroy();

  assert.equal(lifetime.listenerCount(), 0);
  assert.equal(map.listenerCount('style.load'), 0);
  assert.equal(map.getSource(SOURCE_ID), undefined);
  assert.deepEqual(LAYER_IDS.map((id) => map.getLayer(id)), [undefined, undefined, undefined]);
});

test('an already-aborted lifetime leaves no abort callback or map listener', () => {
  const map = new FakeHighlightMap();
  const lifetime = new FakeAbortSignal();
  lifetime.abort();

  createCommentHighlight(map.asMap(), lifetime.asSignal());

  assert.equal(lifetime.listenerCount(), 0);
  assert.equal(map.listenerCount('style.load'), 0);
});
