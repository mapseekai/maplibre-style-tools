import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { AiStyleToolResult, ApplyStyleDocumentInput, ApplyStyleTransactionInput, StyleMutationReceipt } from './contracts.js';
import { createApplyStyleDocumentTool, createApplyStyleTransactionTool } from './mutate.js';

type EventName = 'style.load' | 'error';
type Listener = (event: { type: EventName; error?: Error }) => void;

class FakeMap {
  loaded = false;
  getStyleCalls = 0;
  setStyleCalls: Array<{ style: StyleSpecification | string; options: { diff?: boolean } | undefined }> = [];
  style: StyleSpecification;
  onSetStyle?: (style: StyleSpecification | string) => void;
  private readonly listeners = new Map<EventName, Set<Listener>>();

  constructor(style: StyleSpecification, readonly throwOnGet = false) { this.style = style; }
  getStyle(): StyleSpecification {
    this.getStyleCalls += 1;
    if (this.throwOnGet) throw new Error('unavailable');
    return this.style;
  }

  isStyleLoaded(): boolean { return this.loaded; }
  on(type: EventName, listener: Listener): { unsubscribe(): void } {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener); this.listeners.set(type, listeners);
    return { unsubscribe: () => listeners.delete(listener) };
  }
  off(type: EventName, listener: Listener): this { this.listeners.get(type)?.delete(listener); return this; }
  emit(type: EventName, error?: Error): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ type, error });
  }
  setStyle(style: StyleSpecification | string, options?: { diff?: boolean }): this {
    this.setStyleCalls.push({ style, options });
    this.loaded = false;
    if (this.onSetStyle !== undefined) {
      this.onSetStyle(style);
      return this;
    }
    if (typeof style !== 'string') this.style = style;
    this.loaded = true;
    for (const listener of this.listeners.get('style.load') ?? []) listener({ type: 'style.load' });
    return this;
  }
  asMap(): MapLibreMap { return this as unknown as MapLibreMap; }
}

const style = (): StyleSpecification => ({
  version: 8,
  sources: {
    base: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] },
    geo: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  },
  layers: [{ id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads', paint: { 'line-color': '#000' } }],
});

const transaction = (color = '#f00'): ApplyStyleTransactionInput => ({
  transaction: { operations: [{ op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': color } }] },
});

const receipt = (result: AiStyleToolResult<StyleMutationReceipt>): StyleMutationReceipt => {
  assert.equal(result.success, true);
  if (!result.success) throw new Error('Expected mutation success.');
  return result.data;
};

describe('unified mutation tools', () => {
  it('returns the empty transaction wrapper no-op before Map or context access', async () => {
    let getMapCalls = 0;
    let getContextCalls = 0;
    const empty = await createApplyStyleTransactionTool({
      getMap: () => { getMapCalls += 1; return null; },
      getContext: () => { getContextCalls += 1; return {}; },
    }).execute({ transaction: { operations: [] } });
    assert.deepEqual(empty, {
      success: true,
      message: 'Style transaction completed without changes.',
      data: { applied: false, noOp: true, changedLayers: [], changedSources: [], diff: [], warnings: [], truncated: false, styleAuthority: 'not-checked' },
    });
    assert.equal(getMapCalls, 0); assert.equal(getContextCalls, 0);
  });

  it('runs dry transactions against the validated current style without applying it', async () => {
    const map = new FakeMap(style());
    const result = await createApplyStyleTransactionTool({ getMap: () => map.asMap() }).execute({ ...transaction(), dryRun: true });
    const data = receipt(result);
    assert.equal(data.applied, false); assert.equal(data.noOp, false); assert.equal(data.styleAuthority, 'not-checked');
    assert.deepEqual(data.changedLayers, ['roads']); assert.equal(map.setStyleCalls.length, 0);
    assert.equal('style' in data, false);
  });

  it('applies nonempty transactions with requested diff behavior and ordered receipt IDs', async () => {
    const map = new FakeMap(style());
    const result = await createApplyStyleTransactionTool({ getMap: () => map.asMap() }).execute({ ...transaction(), diff: false });
    const data = receipt(result);
    assert.equal(data.applied, true); assert.equal(data.noOp, false); assert.equal(data.styleAuthority, 'current');
    assert.deepEqual(data.changedLayers, ['roads']); assert.equal('diff' in data, false);
    assert.equal(map.setStyleCalls[0]?.options?.diff, false); assert.equal('style' in data, false);
  });

  it('keeps successful nonempty no-change transactions distinct from the wrapper no-op', async () => {
    const map = new FakeMap(style());
    const result = await createApplyStyleTransactionTool({ getMap: () => map.asMap() }).execute({
      transaction: { operations: [{ op: 'setStyleRootProperties', properties: {} }] },
    });
    const data = receipt(result);
    assert.equal(data.noOp, false); assert.equal(data.applied, false); assert.deepEqual(data.diff, []);
  });

  it('accepts native GeoJSON and scalar URLs for setGeoJsonData unchanged', async () => {
    const geoJson = { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, properties: { n: 1 }, geometry: { type: 'Point' as const, coordinates: [0, 0] as [number, number] } }] };
    for (const data of [geoJson, 'https://example.test/data.geojson']) {
      const map = new FakeMap(style());
      const result = await createApplyStyleTransactionTool({ getMap: () => map.asMap() }).execute({
        transaction: { operations: [{ op: 'setGeoJsonData', sourceId: 'geo', data }] },
      });
      assert.equal(receipt(result).applied, true);
    }
  });

  it('returns strict validation and map authority failures without success leakage', async () => {
    const invalid = await createApplyStyleTransactionTool({ getMap: () => null }).execute({ transaction: { operations: [{ op: 'removeLayer', layerId: '' }] } } as never);
    assert.equal(invalid.success, false); if (!invalid.success) assert.equal(invalid.error.code, 'INVALID_INPUT');
    const unavailable = await createApplyStyleTransactionTool({ getMap: () => null }).execute(transaction());
    assert.equal(unavailable.success, false); if (!unavailable.success) assert.equal(unavailable.error.code, 'MAP_NOT_READY');
  });

  it('applies native documents and absolute URLs, rejects relative URLs before Map access, and omits styles', async () => {
    const document: ApplyStyleDocumentInput = { source: { kind: 'style', style: style() as never } };
    const map = new FakeMap(style());
    const documentResult = await createApplyStyleDocumentTool({ getMap: () => map.asMap() }).execute(document);
    assert.equal(documentResult.success, true); if (documentResult.success) assert.equal('style' in documentResult.data, false);
    const urlMap = new FakeMap(style());
    const urlResult = await createApplyStyleDocumentTool({ getMap: () => urlMap.asMap() }).execute({ source: { kind: 'url', url: 'https://example.test/style.json' }, diff: false });
    assert.equal(urlResult.success, true); assert.equal(urlMap.setStyleCalls[0]?.style, 'https://example.test/style.json');
    let calls = 0;
    const relative = await createApplyStyleDocumentTool({ getMap: () => { calls += 1; return map.asMap(); } }).execute({ source: { kind: 'url', url: '/style.json' } } as never);
    assert.equal(relative.success, false); if (!relative.success) assert.equal(relative.error.code, 'INVALID_INPUT');
    assert.equal(calls, 0);
    const invalid = await createApplyStyleDocumentTool({
      getMap: () => new FakeMap(style()).asMap(),
    }).execute({
      source: { kind: 'style', style: { version: 8, sources: {}, layers: [{ id: 'broken', type: 'line' }] } },
    } as never);
    assert.equal(invalid.success, false);
    if (!invalid.success) assert.equal(invalid.error.code, 'STYLE_INVALID');
  });
  it('keeps rollback failure information in failure details and never in successful receipts', async () => {
    const map = new FakeMap(style());
    map.onSetStyle = () => map.emit('error', new Error('install failed'));
    const result = await createApplyStyleTransactionTool({ getMap: () => map.asMap() }).execute(transaction());
    assert.equal(result.success, false);
    if (!result.success) assert.equal('rollback' in (result.error.details ?? {}), true);
  });
});
