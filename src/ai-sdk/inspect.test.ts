import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { StyleDocument } from '../core/index.js';
import type { AiStyleToolResult, InspectionProjection, InspectStyleInput } from './contracts.js';
import { createInspectStyleTool } from './inspect.js';

type EventName = 'style.load' | 'error';
type Listener = (event: { type: EventName; error?: Error }) => void;

class FakeMap {
  readonly listeners = new Map<EventName, Set<Listener>>();
  getStyleCalls = 0;
  constructor(readonly style: StyleSpecification, readonly throws = false) {}
  getStyle(): StyleSpecification {
    this.getStyleCalls += 1;
    if (this.throws) throw new Error('unavailable');
    return this.style;
  }
  setStyle(): this { return this; }
  on(type: EventName, listener: Listener): { unsubscribe(): void } {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener); this.listeners.set(type, listeners);
    return { unsubscribe: () => listeners.delete(listener) };
  }
  off(type: EventName, listener: Listener): this { this.listeners.get(type)?.delete(listener); return this; }
  isStyleLoaded(): boolean { return true; }
  asMap(): MapLibreMap { return this as unknown as MapLibreMap; }
}

const style: StyleDocument = {
  version: 8,
  name: 'Inspectable',
  sources: {
    base: { type: 'vector', tiles: ['https://example.test/base/{z}/{x}/{y}.pbf'] },
    geo: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  },
  layers: [
    { id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads', minzoom: 2, maxzoom: 20, paint: { 'line-color': '#000' }, layout: { visibility: 'visible' }, filter: ['==', 'kind', 'road'] },
    { id: 'places', type: 'symbol', source: 'base', 'source-layer': 'places' },
  ],
};

const featureCollection = {
  type: 'FeatureCollection' as const,
  features: [{ type: 'Feature' as const, properties: { kind: 'road' }, geometry: { type: 'Point' as const, coordinates: [0, 0] as [number, number] } }],
};
const operation = { op: 'setStyleRootProperties' as const, properties: { name: 'Updated' } };

const execute = async (input: InspectStyleInput, map = new FakeMap(style as unknown as StyleSpecification)) => ({
  result: await createInspectStyleTool({
    getMap: () => map.asMap(),
    getContext: () => ({ activeSourceId: 'base', selectedLayerId: 'roads', secret: 'never-returned' } as never),
  }).execute(input),
  map,
});

const value = (result: AiStyleToolResult<InspectionProjection>): Record<string, unknown> => {
  assert.equal(result.success, true);
  if (!result.success || !('value' in result.data.projection) || result.data.projection.value === undefined) throw new Error('Expected atomic inspection value.');
  return result.data.projection.value as Record<string, unknown>;
};

const items = (result: AiStyleToolResult<InspectionProjection>): Record<string, unknown>[] => {
  assert.equal(result.success, true);
  if (!result.success || !('items' in result.data.projection)) throw new Error('Expected inspection items.');
  return result.data.projection.items as Record<string, unknown>[];
};

describe('createInspectStyleTool', () => {
  it('routes every documented read-only action through bounded projections', async () => {
    const cases: InspectStyleInput[] = [
      { action: 'listLayers', query: 'road', limit: 100 },
      { action: 'listSources', limit: 100 },
      { action: 'getLayer', layerId: 'roads', fields: ['paint', 'filter'] },
      { action: 'getSource', sourceId: 'base' },
      { action: 'getRoot' },
      { action: 'getContext', layerLimit: 100 },
      { action: 'inspectLayers', layerIds: ['roads'], fields: ['layout'] },
      { action: 'getLayerCount' },
      { action: 'validateDocument', style },
      { action: 'validateCurrentMap' },
      { action: 'validateTransaction', transaction: { operations: [operation] } },
      { action: 'analyzeGeoJson', data: featureCollection },
      { action: 'listSourceLayers', sourceId: 'base' },
    ];
    for (const input of cases) {
      const { result } = await execute(input);
      assert.equal(result.success, true, input.action);
      if (result.success) {
        assert.equal(result.data.action, input.action);
        assert.ok('truncated' in result.data.projection);
        assert.ok('warnings' in result.data.projection);
        assert.equal('style' in result.data, false);
        assert.equal('style' in result.data.projection, false);
      }
    }
  });

  it('preserves source order and exposes only requested layer fields', async () => {
    const listed = await execute({ action: 'listSources', limit: 100 });
    assert.deepEqual(items(listed.result).map((item) => item.id), ['base', 'geo']);
    const layer = value((await execute({ action: 'getLayer', layerId: 'roads', fields: ['paint', 'filter'] })).result);
    assert.deepEqual(Object.keys(layer).sort(), ['filter', 'id', 'maxzoom', 'minzoom', 'paint', 'source', 'source-layer', 'type']);
    assert.equal('layout' in layer, false);
    const inspected = items((await execute({ action: 'inspectLayers', layerIds: ['places', 'roads'] })).result);
    assert.deepEqual(inspected.map((item) => item.id), ['places', 'roads']);
  });

  it('projects root and context without full styles or application state', async () => {
    const root = value((await execute({ action: 'getRoot' })).result);
    assert.equal('sources' in root, false); assert.equal('layers' in root, false);
    const context = value((await execute({ action: 'getContext', layerLimit: 100 })).result);
    assert.deepEqual(Object.keys(context).sort(), ['activeSourceId', 'layerCount', 'layerTypes', 'layers', 'selectedLayerId', 'sourceCount']);
    assert.equal('secret' in context, false);
    const count = value((await execute({ action: 'getLayerCount' })).result);
    assert.deepEqual(count, { layerCount: 2 });
  });

  it('uses no Map access for GeoJSON analysis and rejects invalid inputs before Map access', async () => {
    const map = new FakeMap(style as unknown as StyleSpecification);
    const analyzed = await createInspectStyleTool({ getMap: () => map.asMap() }).execute({ action: 'analyzeGeoJson', data: featureCollection });
    assert.equal(analyzed.success, true); assert.equal(map.getStyleCalls, 0);
    const invalid = await createInspectStyleTool({ getMap: () => map.asMap() }).execute({ action: 'getRoot', unexpected: true } as never);
    assert.equal(invalid.success, false); if (!invalid.success) assert.equal(invalid.error.code, 'INVALID_INPUT');
    const emptyTransaction = await createInspectStyleTool({ getMap: () => map.asMap() }).execute({
      action: 'validateTransaction', transaction: { operations: [] },
    } as never);
    assert.equal(emptyTransaction.success, false);
    if (!emptyTransaction.success) assert.equal(emptyTransaction.error.code, 'INVALID_INPUT');
    assert.equal(map.getStyleCalls, 0);
  });

  it('retains authenticated failures for missing maps, layers, and invalid current styles', async () => {
    const missingMap = await createInspectStyleTool({ getMap: () => null }).execute({ action: 'getRoot' });
    assert.equal(missingMap.success, false); if (!missingMap.success) assert.equal(missingMap.error.code, 'MAP_NOT_READY');
    const missingLayer = (await execute({ action: 'getLayer', layerId: 'missing' })).result;
    assert.equal(missingLayer.success, false); if (!missingLayer.success) assert.equal(missingLayer.error.code, 'NOT_FOUND');
    const invalidStyle = await createInspectStyleTool({ getMap: () => new FakeMap({ version: 8, sources: {}, layers: [{ id: 'broken', type: 'line' }] } as unknown as StyleSpecification).asMap() }).execute({ action: 'getRoot' });
    assert.equal(invalidStyle.success, false); if (!invalidStyle.success) assert.equal(invalidStyle.error.code, 'STYLE_INVALID');
    const unreadable = await createInspectStyleTool({
      getMap: () => new FakeMap(style as unknown as StyleSpecification, true).asMap(),
    }).execute({ action: 'getRoot' });
    assert.equal(unreadable.success, false);
    if (!unreadable.success) assert.equal(unreadable.error.code, 'MAP_NOT_READY');
  });
});
