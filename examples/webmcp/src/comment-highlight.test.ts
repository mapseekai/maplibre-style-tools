import assert from 'node:assert/strict';
import test from 'node:test';
import type { Map as MapLibreMap } from 'maplibre-gl';

import type { Scalar } from './comment-targets.js';
import { createCommentHighlight, highlightTargetFor, type HighlightTarget } from './comment-highlight.js';

const STATE_KEY = 'webmcp-comment-highlight';

const target = (overrides: Partial<HighlightTarget> = {}): HighlightTarget => ({
  sourceId: 'maplibre',
  sourceLayer: 'water',
  featureId: 42,
  properties: { class: 'lake' },
  kind: 'Polygon',
  ...overrides,
});

type FeatureStateTarget = { readonly source: string; readonly sourceLayer?: string; readonly id: string | number };

type LayerDefinition = {
  readonly id: string;
  readonly source?: string;
  readonly type?: string;
  readonly filter?: unknown;
  readonly paint?: Readonly<Record<string, unknown>>;
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
  readonly states = new Map<string, Record<string, unknown>>();
  readonly sources = new Set<string>();
  #layers = new Map<string, LayerDefinition>();
  #listeners = new Map<string, Set<() => void>>();

  constructor(sourceIds: readonly string[] = ['maplibre']) {
    for (const id of sourceIds) this.sources.add(id);
  }

  static #stateKey(target: FeatureStateTarget, key: string): string {
    return JSON.stringify([target.source, target.sourceLayer ?? null, target.id, key]);
  }

  getSource(id: string): object | undefined { return this.sources.has(id) ? {} : undefined; }

  setFeatureState(stateTarget: FeatureStateTarget, state: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(state)) {
      this.states.set(FakeHighlightMap.#stateKey(stateTarget, key), { [key]: value });
    }
  }

  removeFeatureState(stateTarget: FeatureStateTarget, key?: string): void {
    this.states.delete(FakeHighlightMap.#stateKey(stateTarget, key ?? STATE_KEY));
  }

  stateOf(stateTarget: FeatureStateTarget): Record<string, unknown> | undefined {
    return this.states.get(FakeHighlightMap.#stateKey(stateTarget, STATE_KEY));
  }

  addLayer(layer: LayerDefinition): void {
    this.addedLayers.push(layer);
    this.#layers.set(layer.id, layer);
  }

  getLayer(id: string): LayerDefinition | undefined { return this.#layers.get(id); }
  removeLayer(id: string): void { this.#layers.delete(id); }

  getStyle(): { readonly layers: readonly { readonly id: string }[] } | undefined {
    return { layers: [...this.#layers.keys()].map((id) => ({ id })) };
  }

  on(type: string, listener: () => void): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  off(type: string, listener: () => void): void { this.#listeners.get(type)?.delete(listener); }
  emit(type: string): void { for (const listener of this.#listeners.get(type) ?? []) listener(); }
  listenerCount(type: string): number { return this.#listeners.get(type)?.size ?? 0; }

  dropStyleOwnedData(): void {
    this.#layers.clear();
    this.states.clear();
  }

  asMap(): MapLibreMap { return this as unknown as MapLibreMap; }
}

test('highlightTargetFor maps multi geometries and keeps the feature identity', () => {
  const feature = {
    layerId: 'water',
    sourceId: 'maplibre',
    sourceLayer: 'water',
    featureId: 7,
    lngLat: [0, 0] as const,
    properties: { class: 'lake' as const },
  };
  assert.deepEqual(highlightTargetFor(feature, { type: 'MultiPolygon', coordinates: [] } as never), {
    sourceId: 'maplibre', sourceLayer: 'water', featureId: 7, properties: { class: 'lake' }, kind: 'Polygon',
  });
  assert.equal(highlightTargetFor(feature, { type: 'MultiLineString', coordinates: [] } as never).kind, 'LineString');
  assert.equal(highlightTargetFor(feature, { type: 'Point', coordinates: [0, 0] } as never).kind, 'Point');
  const withoutIds = highlightTargetFor(
    { layerId: 'water', sourceId: 'maplibre', lngLat: [0, 0], properties: {} },
    { type: 'Polygon', coordinates: [] } as never,
  );
  assert.deepEqual(withoutIds, { sourceId: 'maplibre', properties: {}, kind: 'Polygon' });
});

test('highlights the complete feature through feature state on the vector source', () => {
  const map = new FakeHighlightMap();
  const controller = createCommentHighlight(map.asMap(), new AbortController().signal);

  controller.show('draft', target());

  assert.deepEqual(map.stateOf({ source: 'maplibre', sourceLayer: 'water', id: 42 }), { [STATE_KEY]: true });
  assert.deepEqual(map.addedLayers.map(({ id }) => id), ['webmcp-comment-highlight:maplibre:water:Polygon']);
  const layer = map.addedLayers[0]!;
  assert.equal(layer.source, 'maplibre');
  assert.equal(layer.type, 'fill');
  assert.deepEqual(layer.filter, ['==', ['geometry-type'], 'Polygon']);
  assert.deepEqual(layer.paint, {
    'fill-color': '#f59e0b',
    'fill-opacity': ['case', ['boolean', ['feature-state', STATE_KEY], false], 0.38, 0],
    'fill-outline-color': '#b45309',
  });
});

test('does not let a pin clear a draft-owned highlight', () => {
  const map = new FakeHighlightMap();
  const controller = createCommentHighlight(map.asMap(), new AbortController().signal);

  controller.show('draft', target());
  controller.clear('map-selection-a');
  assert.deepEqual(map.stateOf({ source: 'maplibre', sourceLayer: 'water', id: 42 }), { [STATE_KEY]: true });
  controller.clear('draft');
  assert.equal(map.stateOf({ source: 'maplibre', sourceLayer: 'water', id: 42 }), undefined);
});

test('keeps the state while another owner highlights the same feature', () => {
  const map = new FakeHighlightMap();
  const controller = createCommentHighlight(map.asMap(), new AbortController().signal);

  controller.show('draft', target());
  controller.show('map-selection-a', target());
  controller.clear('draft');
  assert.deepEqual(map.stateOf({ source: 'maplibre', sourceLayer: 'water', id: 42 }), { [STATE_KEY]: true });
  controller.clear('map-selection-a');
  assert.equal(map.stateOf({ source: 'maplibre', sourceLayer: 'water', id: 42 }), undefined);
});

test('clearAll removes highlights regardless of owner', () => {
  const map = new FakeHighlightMap();
  const controller = createCommentHighlight(map.asMap(), new AbortController().signal);

  controller.show('map-selection-a', target());
  controller.show('map-selection-b', target({ featureId: 43, kind: 'LineString', sourceLayer: 'roads' }));
  controller.clearAll();

  assert.equal(map.stateOf({ source: 'maplibre', sourceLayer: 'water', id: 42 }), undefined);
  assert.equal(map.stateOf({ source: 'maplibre', sourceLayer: 'roads', id: 43 }), undefined);
});

test('falls back to a property-matched vector layer when the feature has no id', () => {
  const map = new FakeHighlightMap();
  const controller = createCommentHighlight(map.asMap(), new AbortController().signal);

  controller.show('draft', target({ featureId: undefined, properties: { class: 'lake', rank: 3 as Scalar } }));

  assert.deepEqual(map.addedLayers.map(({ id }) => id), ['webmcp-comment-highlight:match:draft']);
  assert.deepEqual(map.addedLayers[0]?.filter, [
    'all',
    ['==', ['geometry-type'], 'Polygon'],
    ['==', ['get', 'class'], 'lake'],
    ['==', ['get', 'rank'], 3],
  ]);
  controller.clear('draft');
  assert.equal(map.getLayer('webmcp-comment-highlight:match:draft'), undefined);
});

test('restores layers and feature states after a style load', () => {
  const map = new FakeHighlightMap();
  const lifetime = new AbortController();
  const controller = createCommentHighlight(map.asMap(), lifetime.signal);

  controller.show('map-selection-a', target());
  map.dropStyleOwnedData();
  map.emit('style.load');

  assert.deepEqual(map.stateOf({ source: 'maplibre', sourceLayer: 'water', id: 42 }), { [STATE_KEY]: true });
  assert.notEqual(map.getLayer('webmcp-comment-highlight:maplibre:water:Polygon'), undefined);
  lifetime.abort();
  assert.equal(map.listenerCount('style.load'), 0);
  assert.equal(map.getLayer('webmcp-comment-highlight:maplibre:water:Polygon'), undefined);
});

test('destroy removes the abort callback and is idempotent', () => {
  const map = new FakeHighlightMap();
  const lifetime = new FakeAbortSignal();
  const controller = createCommentHighlight(map.asMap(), lifetime.asSignal());

  controller.show('draft', target());
  controller.destroy();
  controller.destroy();

  assert.equal(lifetime.listenerCount(), 0);
  assert.equal(map.listenerCount('style.load'), 0);
  assert.equal(map.getLayer('webmcp-comment-highlight:maplibre:water:Polygon'), undefined);
  assert.equal(map.stateOf({ source: 'maplibre', sourceLayer: 'water', id: 42 }), undefined);
});

test('an already-aborted lifetime leaves no abort callback or map listener', () => {
  const map = new FakeHighlightMap();
  const lifetime = new FakeAbortSignal();
  lifetime.abort();

  createCommentHighlight(map.asMap(), lifetime.asSignal());

  assert.equal(lifetime.listenerCount(), 0);
  assert.equal(map.listenerCount('style.load'), 0);
});
