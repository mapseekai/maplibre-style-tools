import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { RuntimeImageLoader } from '../adapters/maplibre/index.js';
import type { MapLibreStyleTools } from './tools.js';
import { createMapLibreStyleTools } from './tools.js';

const fullLegacyNames = [
  'listAllLayers', 'listAllSources', 'inspectLayerStyle', 'inspectSource', 'setLayerPaintProperty', 'setLayerLayoutProperty', 'setLayerPaintPropertySmart', 'setLayerLayoutPropertySmart', 'batchSetLayerPaintPropertiesSmart', 'batchSetLayerLayoutPropertiesSmart', 'batchSetLayerPaintProperties', 'batchSetLayerLayoutProperties', 'clearLayerPaintProperty', 'clearLayerLayoutProperty', 'setLayerFilter', 'setLayerZoomRange', 'setLayerVisibility', 'addLayer', 'moveLayer', 'removeLayer', 'patchLayerDefinition', 'replaceLayerDefinition', 'addSource', 'removeSource', 'updateGeoJsonSourceData', 'setGeoJsonClusterOptions', 'setSourceTileLodParams', 'patchSourceDefinition', 'replaceSourceDefinition', 'setStyleJsonOrUrl', 'inspectRootStyle', 'setStyleName', 'setStyleMetadata', 'setStyleTransition', 'setStyleCameraDefaults', 'validateStyleJson', 'validateCurrentMapStyle', 'setMapLight', 'setMapSky', 'setMapProjection', 'setMapTerrain', 'setMapGlyphs', 'setMapSprite', 'listSprites', 'addSprite', 'removeSprite', 'setFeatureState', 'removeFeatureState', 'setGlobalStateProperty', 'listImages', 'addImageFromUrl', 'removeImage', 'getLayerCount',
] as const;
const compactLegacyNames = ['getStyleContext', 'searchLayers', 'inspectLayersCompact', 'applyStyleOperations', 'validateStylePatchJson'] as const;
const retainedNames = ['analyzeGeoJson', 'listSourceLayers', 'duplicateLayer', 'addLayerFromSource', 'addGeoJsonLayer', 'applyStyleTransaction', 'querySourceFeatures', 'queryRenderedFeatures'] as const;

type Category = 'full' | 'compact' | 'retained';
type ToolName = keyof MapLibreStyleTools;
type Success = { success: true; data?: Record<string, unknown> };
type MigrationRow = { legacyName: string; category: Category; tool: ToolName; input: Record<string, unknown>; verify: (result: Success, map: FakeMap) => void };

function baseStyle(): StyleSpecification {
  return { version: 8, name: 'base', sources: { base: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] }, points: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true } }, layers: [{ id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads', paint: { 'line-width': 1 }, layout: { visibility: 'visible' } }, { id: 'labels', type: 'symbol', source: 'base', 'source-layer': 'labels' }] };
}
class FakeMap {
  style = baseStyle(); readonly calls: string[] = []; readonly styleInputs: Array<StyleSpecification | string> = []; readonly commandArguments: Record<string, unknown[]> = Object.create(null); readonly listeners = new Map<string, Set<(event: { type: string; error?: Error }) => void>>();
  getStyle() { return structuredClone(this.style); } isStyleLoaded() { return true; }
  getSource(id: string) { return id === 'points' ? { type: 'geojson', updateData: async (diff: unknown) => { this.calls.push('updateData'); this.commandArguments.updateData = [diff]; } } : id in this.style.sources ? { type: 'vector' } : undefined; }
  on(type: string, listener: (event: { type: string; error?: Error }) => void) { (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(listener); return { unsubscribe: () => this.listeners.get(type)?.delete(listener) }; }
  off(type: string, listener: (event: { type: string; error?: Error }) => void) { this.listeners.get(type)?.delete(listener); return this; }
  setStyle(style: StyleSpecification | string) { this.calls.push('setStyle'); this.styleInputs.push(style); if (typeof style !== 'string') this.style = structuredClone(style); queueMicrotask(() => this.listeners.get('style.load')?.forEach((listener) => listener({ type: 'style.load' }))); return this; }
  setSourceTileLodParams(...args: unknown[]) { this.calls.push('setSourceTileLodParams'); this.commandArguments.setSourceTileLodParams = args; } setFeatureState(...args: unknown[]) { this.calls.push('setFeatureState'); this.commandArguments.setFeatureState = args; } removeFeatureState(...args: unknown[]) { this.calls.push('removeFeatureState'); this.commandArguments.removeFeatureState = args; } setGlobalStateProperty(...args: unknown[]) { this.calls.push('setGlobalState'); this.commandArguments.setGlobalState = args; }
  listImages() { this.calls.push('listImages'); return ['existing']; } hasImage(id: string) { return id === 'existing'; } addImage(...args: unknown[]) { this.calls.push('addImage'); this.commandArguments.addImage = args; } updateImage(...args: unknown[]) { this.calls.push('updateImage'); this.commandArguments.updateImage = args; } removeImage(...args: unknown[]) { this.calls.push('removeImage'); this.commandArguments.removeImage = args; }
  getSprite() { this.calls.push('listSprites'); return [{ id: 'sprite', url: 'https://example.test/sprite' }]; } addSprite(...args: unknown[]) { this.calls.push('addSprite'); this.commandArguments.addSprite = args; } removeSprite(...args: unknown[]) { this.calls.push('removeSprite'); this.commandArguments.removeSprite = args; }
  querySourceFeatures() { this.calls.push('querySourceFeatures'); return [{ type: 'Feature', geometry: null, properties: {} }]; } queryRenderedFeatures() { this.calls.push('queryRenderedFeatures'); return [{ type: 'Feature', geometry: null, properties: {} }]; }
  asMap() { return this as unknown as MapLibreMap; }
}

class AuthorityDriftMap extends FakeMap {
  private reads = 0;

  get styleReads() { return this.reads; }

  override getStyle() {
    this.reads += 1;
    if (this.reads === 2) this.style = { ...this.style, name: 'external-change' };
    return super.getStyle();
  }
}

class UnavailableDuringApplyMap extends FakeMap {
  private reads = 0;

  constructor(private readonly readableReads: number) { super(); }

  get styleReads() { return this.reads; }

  override getStyle() {
    this.reads += 1;
    if (this.reads > this.readableReads) throw new Error('current style unavailable');
    return super.getStyle();
  }
}

class AuthorityFailureMap extends FakeMap {
  private mutations = 0;
  private unreadable = false;
  private reads = 0;

  get styleReads() { return this.reads; }

  override getStyle() {
    this.reads += 1;
    if (this.unreadable) throw new Error('current style unavailable');
    return super.getStyle();
  }

  override setStyle() {
    this.calls.push('setStyle');
    this.mutations += 1;
    queueMicrotask(() => {
      this.listeners.get('error')?.forEach((listener) => listener({
        type: 'error',
        error: new Error(this.mutations === 1 ? 'candidate rejected' : 'rollback rejected'),
      }));
      if (this.mutations === 2) this.unreadable = true;
    });
    return this;
  }
}
const imageLoaderUrls: string[] = [];
const imageLoader: RuntimeImageLoader = { async load(url) { imageLoaderUrls.push(url); return { width: 1, height: 1, data: new Uint8Array(4) }; } };
const projection = (result: Success): Record<string, unknown> => result.data!.projection as Record<string, unknown>;
const jsonRecord = (value: unknown): Record<string, unknown> => {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
};
const jsonItems = (value: unknown): Record<string, unknown>[] => {
  assert.ok(Array.isArray(value));
  return value.map(jsonRecord);
};
const styleLayer = (map: FakeMap, index: number): Record<string, unknown> =>
  jsonRecord(map.style.layers![index]);
const styleLayerField = (map: FakeMap, index: number, field: string): unknown =>
  styleLayer(map, index)[field];
const sourceField = (map: FakeMap, sourceId: string, field: string): unknown =>
  jsonRecord(map.style.sources[sourceId])[field];
const inspection = (legacyName: string, action: Record<string, unknown>, verify: (value: Record<string, unknown>) => void): MigrationRow => ({
  legacyName, category: 'full', tool: 'inspectStyle', input: action,
  verify: (result) => verify(projection(result)),
});
const transaction = (
  legacyName: string, operation: Record<string, unknown>,
  changedLayers: string[], changedSources: string[],
  verify: (map: FakeMap) => void,
): MigrationRow => ({
  legacyName, category: 'full', tool: 'applyStyleTransaction',
  input: { transaction: { operations: [operation] }, diff: true },
  verify: (result, map) => {
    const data = result.data!;
    assert.deepEqual(data.changedLayers, changedLayers, legacyName);
    assert.deepEqual(data.changedSources, changedSources, legacyName);
    assert.equal(data.applied, true, legacyName);
    assert.equal(data.styleAuthority, 'current', legacyName);
    assert.deepEqual(map.calls, ['setStyle'], legacyName);
    verify(map);
  },
});
const command = (
  legacyName: string, input: Record<string, unknown>,
  verify: (result: Success, map: FakeMap) => void,
): MigrationRow => ({ legacyName, category: 'full', tool: 'runMapCommand', input, verify });

const migrationRows: MigrationRow[] = [
  inspection('listAllLayers', { action: 'listLayers' }, (p) => assert.deepEqual(p, { items: [{ id: 'roads', type: 'line', source: 'base', sourceLayer: 'roads', visibility: 'visible' }, { id: 'labels', type: 'symbol', source: 'base', sourceLayer: 'labels' }], returned: 2, total: 2, truncated: false, warnings: [] })),
  inspection('listAllSources', { action: 'listSources' }, (p) => assert.deepEqual(p, { items: [{ id: 'base', source: baseStyle().sources.base }, { id: 'points', source: baseStyle().sources.points }], returned: 2, total: 2, truncated: false, warnings: [] })),
  inspection('inspectLayerStyle', { action: 'getLayer', layerId: 'roads', fields: ['paint', 'layout', 'filter', 'zoom'] }, (p) => assert.deepEqual(p.value, { id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads', minzoom: null, maxzoom: null, paint: { 'line-width': 1 }, layout: { visibility: 'visible' }, filter: null })),
  inspection('inspectSource', { action: 'getSource', sourceId: 'points' }, (p) => assert.deepEqual(p.value, { id: 'points', source: baseStyle().sources.points })),
  transaction('setLayerPaintProperty', { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2 } }, ['roads'], [], (m) => assert.equal(jsonRecord(styleLayerField(m, 0, 'paint'))['line-width'], 2)),
  transaction('setLayerLayoutProperty', { op: 'setLayerProperties', layerId: 'roads', layout: { visibility: 'none' } }, ['roads'], [], (m) => assert.equal(jsonRecord(styleLayerField(m, 0, 'layout')).visibility, 'none')),
  transaction('setLayerPaintPropertySmart', { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#fff' } }, ['roads'], [], (m) => assert.equal(jsonRecord(styleLayerField(m, 0, 'paint'))['line-color'], '#fff')),
  transaction('setLayerLayoutPropertySmart', { op: 'setLayerProperties', layerId: 'roads', layout: { 'line-cap': 'round' } }, ['roads'], [], (m) => assert.equal(jsonRecord(styleLayerField(m, 0, 'layout'))['line-cap'], 'round')),
  transaction('batchSetLayerPaintPropertiesSmart', { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2, 'line-opacity': 0.5 } }, ['roads'], [], (m) => assert.deepEqual(styleLayerField(m, 0, 'paint'), { 'line-width': 2, 'line-opacity': 0.5 })),
  transaction('batchSetLayerLayoutPropertiesSmart', { op: 'setLayerProperties', layerId: 'roads', layout: { visibility: 'none', 'line-cap': 'round' } }, ['roads'], [], (m) => assert.deepEqual(styleLayerField(m, 0, 'layout'), { visibility: 'none', 'line-cap': 'round' })),
  transaction('batchSetLayerPaintProperties', { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#f00' } }, ['roads'], [], (m) => assert.deepEqual(styleLayerField(m, 0, 'paint'), { 'line-width': 1, 'line-color': '#f00' })),
  transaction('batchSetLayerLayoutProperties', { op: 'setLayerProperties', layerId: 'roads', layout: { visibility: 'none' } }, ['roads'], [], (m) => assert.deepEqual(styleLayerField(m, 0, 'layout'), { visibility: 'none' })),
  transaction('clearLayerPaintProperty', { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': null } }, ['roads'], [], (m) => assert.equal(Object.hasOwn(styleLayer(m, 0), 'paint'), false)),
  transaction('clearLayerLayoutProperty', { op: 'setLayerProperties', layerId: 'roads', layout: { visibility: null } }, ['roads'], [], (m) => assert.equal(Object.hasOwn(styleLayer(m, 0), 'layout'), false)),
  transaction('setLayerFilter', { op: 'setLayerFilter', layerId: 'roads', mode: 'replace', filter: ['==', ['get', 'kind'], 'road'] }, ['roads'], [], (m) => assert.deepEqual(styleLayerField(m, 0, 'filter'), ['==', ['get', 'kind'], 'road'])),
  transaction('setLayerZoomRange', { op: 'setLayerProperties', layerId: 'roads', minzoom: 1, maxzoom: 10 }, ['roads'], [], (m) => assert.deepEqual([styleLayerField(m, 0, 'minzoom'), styleLayerField(m, 0, 'maxzoom')], [1, 10])),
  transaction('setLayerVisibility', { op: 'setLayerProperties', layerId: 'roads', layout: { visibility: 'none' } }, ['roads'], [], (m) => assert.equal(jsonRecord(styleLayerField(m, 0, 'layout')).visibility, 'none')),
  transaction('addLayer', { op: 'addLayerDefinition', layer: { id: 'added', type: 'line', source: 'base', 'source-layer': 'roads' } }, ['added'], [], (m) => assert.equal(m.style.layers![2]!.id, 'added')),
  transaction('moveLayer', { op: 'moveLayer', layerId: 'roads', afterId: 'labels' }, ['roads'], [], (m) => assert.deepEqual(m.style.layers!.map((l) => l.id), ['labels', 'roads'])),
  transaction('removeLayer', { op: 'removeLayer', layerId: 'labels' }, ['labels'], [], (m) => assert.deepEqual(m.style.layers!.map((l) => l.id), ['roads'])),
  transaction('patchLayerDefinition', { op: 'deepMergeLayerDefinition', layerId: 'roads', patch: { paint: { 'line-width': 3 } } }, ['roads'], [], (m) => assert.equal(jsonRecord(styleLayerField(m, 0, 'paint'))['line-width'], 3)),
  transaction('replaceLayerDefinition', { op: 'replaceLayerDefinition', layerId: 'roads', layer: { id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads', paint: { 'line-width': 4 } } }, ['roads'], [], (m) => assert.deepEqual(styleLayerField(m, 0, 'paint'), { 'line-width': 4 })),
  transaction('addSource', { op: 'addSource', sourceId: 'added', source: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] } }, [], ['added'], (m) => assert.deepEqual(m.style.sources.added, { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] })),
  transaction('removeSource', { op: 'removeSource', sourceId: 'points' }, [], ['points'], (m) => assert.equal(Object.hasOwn(m.style.sources, 'points'), false)),
  transaction('updateGeoJsonSourceData', { op: 'setGeoJsonData', sourceId: 'points', data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }] } }, [], ['points'], (m) => assert.deepEqual(jsonRecord(jsonRecord(jsonItems(jsonRecord(sourceField(m, 'points', 'data')).features)[0]).geometry).coordinates, [0, 0])),
  transaction('setGeoJsonClusterOptions', { op: 'patchSource', sourceId: 'points', patch: { clusterRadius: 50 } }, [], ['points'], (m) => assert.equal(sourceField(m, 'points', 'clusterRadius'), 50)),
  command('setSourceTileLodParams', { action: 'setSourceTileLodParams', maxZoomLevelsOnScreen: 1, tileCountMaxMinRatio: 1 }, (r, m) => { assert.equal(r.data?.applied, true); assert.deepEqual(m.commandArguments.setSourceTileLodParams, [1, 1, undefined]); }),
  transaction('patchSourceDefinition', { op: 'deepMergeSourceDefinition', sourceId: 'points', patch: { clusterRadius: 25 } }, [], ['points'], (m) => assert.equal(sourceField(m, 'points', 'clusterRadius'), 25)),
  transaction('replaceSourceDefinition', { op: 'replaceSourceDefinition', sourceId: 'points', source: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }, [], ['points'], (m) => assert.deepEqual(m.style.sources.points, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })),
  { legacyName: 'setStyleJsonOrUrl', category: 'full', tool: 'applyStyleDocument', input: { source: { kind: 'style', style: { ...baseStyle(), name: 'document' } } }, verify: (r, m) => { assert.equal(r.data?.applied, true); assert.equal(m.style.name, 'document'); assert.deepEqual(m.calls, ['setStyle']); } },
  inspection('inspectRootStyle', { action: 'getRoot' }, (p) => assert.deepEqual(p.value, { version: 8, name: 'base' })),
  transaction('setStyleName', { op: 'setStyleRootProperties', properties: { name: 'changed' } }, [], [], (m) => assert.equal(m.style.name, 'changed')),
  transaction('setStyleMetadata', { op: 'setStyleRootProperties', properties: { metadata: { revision: 1 } } }, [], [], (m) => assert.deepEqual(m.style.metadata, { revision: 1 })),
  transaction('setStyleTransition', { op: 'setStyleRootProperties', properties: { transition: { duration: 100 } } }, [], [], (m) => assert.deepEqual(m.style.transition, { duration: 100 })),
  transaction('setStyleCameraDefaults', { op: 'setStyleRootProperties', properties: { center: [0, 0], zoom: 2 } }, [], [], (m) => assert.deepEqual([m.style.center, m.style.zoom], [[0, 0], 2])),
  inspection('validateStyleJson', { action: 'validateDocument', style: baseStyle() }, (p) => assert.deepEqual(p.value, { valid: true })),
  inspection('validateCurrentMapStyle', { action: 'validateCurrentMap' }, (p) => assert.deepEqual(p.value, { valid: true })),
  transaction('setMapLight', { op: 'shallowPatchRootProperty', property: 'light', patch: { intensity: 0.5 } }, [], [], (m) => assert.deepEqual(m.style.light, { intensity: 0.5 })),
  transaction('setMapSky', { op: 'replaceRootProperty', property: 'sky', value: {} }, [], [], (m) => assert.deepEqual(m.style.sky, {})),
  transaction('setMapProjection', { op: 'replaceRootProperty', property: 'projection', value: { type: 'globe' } }, [], [], (m) => assert.deepEqual(m.style.projection, { type: 'globe' })),
  transaction('setMapTerrain', { op: 'replaceRootProperty', property: 'terrain', value: { source: 'dem', exaggeration: 2 } }, [], [], (m) => assert.deepEqual(m.style.terrain, { source: 'dem', exaggeration: 2 })),
  transaction('setMapGlyphs', { op: 'setStyleRootProperties', properties: { glyphs: 'https://example.test/{fontstack}/{range}.pbf' } }, [], [], (m) => assert.equal(m.style.glyphs, 'https://example.test/{fontstack}/{range}.pbf')),
  transaction('setMapSprite', { op: 'setStyleRootProperties', properties: { sprite: 'https://example.test/sprite' } }, [], [], (m) => assert.equal(m.style.sprite, 'https://example.test/sprite')),
  command('listSprites', { action: 'listSprites' }, (r) => assert.deepEqual(jsonRecord(r.data?.result).items, [{ id: 'sprite', url: 'https://example.test/sprite' }])),
  command('addSprite', { action: 'addSprite', spriteId: 'new', url: 'https://example.test/new' }, (_r, m) => assert.deepEqual(m.commandArguments.addSprite, ['new', 'https://example.test/new'])),
  command('removeSprite', { action: 'removeSprite', spriteId: 'sprite' }, (_r, m) => assert.deepEqual(m.commandArguments.removeSprite, ['sprite'])),
  command('setFeatureState', { action: 'setFeatureState', target: { source: 'base', id: 1 }, state: { selected: true } }, (_r, m) => assert.deepEqual(m.commandArguments.setFeatureState, [{ source: 'base', id: 1 }, { selected: true }])),
  command('removeFeatureState', { action: 'removeFeatureState', target: { source: 'base', id: 1 }, key: 'selected' }, (_r, m) => assert.deepEqual(m.commandArguments.removeFeatureState, [{ source: 'base', id: 1 }, 'selected'])),
  command('setGlobalStateProperty', { action: 'setGlobalState', propertyName: 'theme', value: 'dark' }, (_r, m) => assert.deepEqual(m.commandArguments.setGlobalState, ['theme', 'dark'])),
  command('listImages', { action: 'listImages' }, (r) => assert.deepEqual(jsonRecord(r.data?.result).items, ['existing'])),
  command('addImageFromUrl', { action: 'addImageFromUrl', imageId: 'new', url: 'https://example.test/new.png' }, (_r, m) => { assert.deepEqual(m.commandArguments.addImage?.slice(0, 1), ['new']); assert.deepEqual(imageLoaderUrls, ['https://example.test/new.png']); }),
  command('removeImage', { action: 'removeImage', imageId: 'existing' }, (_r, m) => assert.deepEqual(m.commandArguments.removeImage, ['existing'])),
  inspection('getLayerCount', { action: 'getLayerCount' }, (p) => assert.deepEqual(p.value, { layerCount: 2 })),
  { legacyName: 'getStyleContext', category: 'compact', tool: 'inspectStyle', input: { action: 'getContext' }, verify: (r) => assert.deepEqual(projection(r).value, { layerCount: 2, sourceCount: 2, layerTypes: { line: 1, symbol: 1 }, layers: [{ id: 'roads', type: 'line', source: 'base', sourceLayer: 'roads', visibility: 'visible' }, { id: 'labels', type: 'symbol', source: 'base', sourceLayer: 'labels' }] }) },
  { legacyName: 'searchLayers', category: 'compact', tool: 'inspectStyle', input: { action: 'listLayers', query: 'road' }, verify: (r) => assert.deepEqual(jsonItems(projection(r).items).map((value) => value.id), ['roads']) },
  { legacyName: 'inspectLayersCompact', category: 'compact', tool: 'inspectStyle', input: { action: 'inspectLayers', layerIds: ['roads'] }, verify: (r) => assert.deepEqual(jsonItems(projection(r).items)[0], { id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads', paint: { 'line-width': 1 }, layout: { visibility: 'visible' } }) },
  { legacyName: 'applyStyleOperations', category: 'compact', tool: 'applyStyleTransaction', input: { transaction: { operations: [{ op: 'setLayerFilter', layerId: 'roads', mode: 'replace', filter: ['==', ['get', 'kind'], 'road'] }] } }, verify: (r, m) => { assert.deepEqual(r.data?.changedLayers, ['roads']); assert.deepEqual(styleLayerField(m, 0, 'filter'), ['==', ['get', 'kind'], 'road']); } },
  { legacyName: 'validateStylePatchJson', category: 'compact', tool: 'inspectStyle', input: { action: 'validateTransaction', transaction: { operations: [{ op: 'setLayerFilter', layerId: 'roads', mode: 'clear' }] } }, verify: (r) => assert.deepEqual(projection(r).value, { valid: true }) },
  { legacyName: 'analyzeGeoJson', category: 'retained', tool: 'inspectStyle', input: { action: 'analyzeGeoJson', data: { type: 'FeatureCollection', features: [] } }, verify: (r) => assert.deepEqual(projection(r).value, { available: true, featureCount: 0, geometryTypes: {}, properties: { items: [], returned: 0, total: 0, truncated: false, warnings: [] } }) },
  { legacyName: 'listSourceLayers', category: 'retained', tool: 'inspectStyle', input: { action: 'listSourceLayers', sourceId: 'base' }, verify: (r) => assert.deepEqual(jsonItems(projection(r).items).map((value) => [value.sourceId, value.sourceLayer, jsonItems(jsonRecord(value.layers).items).map((layer) => layer.id)]), [['base', 'labels', ['labels']], ['base', 'roads', ['roads']]]) },
  { legacyName: 'duplicateLayer', category: 'retained', tool: 'applyStyleTransaction', input: { transaction: { operations: [{ op: 'duplicateLayer', layerId: 'roads', newLayerId: 'roads-copy' }] } }, verify: (r, m) => { assert.deepEqual(r.data?.changedLayers, ['roads-copy']); assert.deepEqual(m.style.layers?.map((layer) => layer.id), ['roads', 'roads-copy', 'labels']); assert.deepEqual(m.style.layers?.[1], { id: 'roads-copy', type: 'line', source: 'base', 'source-layer': 'roads', paint: { 'line-width': 1 }, layout: { visibility: 'visible' } }); } },
  { legacyName: 'addLayerFromSource', category: 'retained', tool: 'applyStyleTransaction', input: { transaction: { operations: [{ op: 'addLayerFromSource', layerId: 'from-source', sourceId: 'base', sourceLayer: 'roads', type: 'line' }] } }, verify: (r, m) => { assert.deepEqual(r.data?.changedLayers, ['from-source']); assert.deepEqual(m.style.layers![2], { id: 'from-source', source: 'base', 'source-layer': 'roads', type: 'line' }); } },
  { legacyName: 'addGeoJsonLayer', category: 'retained', tool: 'applyStyleTransaction', input: { transaction: { operations: [{ op: 'addGeoJsonLayer', sourceId: 'geo', layerId: 'geo-layer', data: { type: 'FeatureCollection', features: [] }, type: 'circle' }] } }, verify: (r, m) => { assert.deepEqual(r.data?.changedLayers, ['geo-layer']); assert.deepEqual(r.data?.changedSources, ['geo']); assert.deepEqual(m.style.sources.geo, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }); assert.deepEqual(m.style.layers?.[2], { id: 'geo-layer', source: 'geo', type: 'circle' }); } },
  { legacyName: 'applyStyleTransaction', category: 'retained', tool: 'applyStyleTransaction', input: { transaction: { operations: [{ op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 5 } }] } }, verify: (r, m) => { assert.deepEqual(r.data?.changedLayers, ['roads']); assert.equal(jsonRecord(styleLayerField(m, 0, 'paint'))['line-width'], 5); } },
  { legacyName: 'querySourceFeatures', category: 'retained', tool: 'queryMapFeatures', input: { target: 'source', sourceId: 'base' }, verify: (r) => assert.deepEqual(r.data, { target: 'source', features: [{ type: 'Feature', geometry: null, properties: {} }], returned: 1, truncated: false, warnings: [] }) },
  { legacyName: 'queryRenderedFeatures', category: 'retained', tool: 'queryMapFeatures', input: { target: 'rendered' }, verify: (r) => assert.deepEqual(r.data, { target: 'rendered', features: [{ type: 'Feature', geometry: null, properties: {} }], returned: 1, truncated: false, warnings: [] }) },
];

test('composes five Promise tools and executes each migration replacement behavior', async () => {
  const tools = createMapLibreStyleTools({ getMap: () => new FakeMap().asMap(), imageLoader });
  imageLoaderUrls.length = 0;
  assert.deepEqual(Object.keys(tools), ['inspectStyle', 'applyStyleTransaction', 'applyStyleDocument', 'runMapCommand', 'queryMapFeatures']);
  for (const tool of Object.values(tools)) {
    assert.equal(typeof tool.execute, 'function');
    assert.ok((tool.execute as (input: never) => Promise<unknown>)({} as never) instanceof Promise);
  }
  assert.deepEqual(migrationRows.filter((row) => row.category === 'full').map((row) => row.legacyName), fullLegacyNames);
  assert.deepEqual(migrationRows.filter((row) => row.category === 'compact').map((row) => row.legacyName), compactLegacyNames);
  assert.deepEqual(migrationRows.filter((row) => row.category === 'retained').map((row) => row.legacyName), retainedNames);
  for (const row of migrationRows) {
    const map = new FakeMap();
    const rowTools = createMapLibreStyleTools({ getMap: () => map.asMap(), imageLoader });
    const result = await (rowTools[row.tool].execute as (input: never) => Promise<Success>)(structuredClone(row.input) as never);
    assert.equal(result.success, true, row.legacyName);
    if (result.success) {
      try { row.verify(result, map); } catch (error) { assert.fail(`${row.legacyName}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
});

test('executes setLayerFilter replace and and or clear with exact resulting filters', async () => {
  const map = new FakeMap();
  const tool = createMapLibreStyleTools({ getMap: () => map.asMap() }).applyStyleTransaction;
  const apply = async (operation: Record<string, unknown>) => {
    const result = await tool.execute({ transaction: { operations: [operation] } } as never);
    assert.equal(result.success, true);
    assert.deepEqual(result.success ? result.data.changedLayers : [], ['roads']);
  };
  await apply({ op: 'setLayerFilter', layerId: 'roads', mode: 'replace', filter: ['==', ['get', 'kind'], 'road'] });
  assert.deepEqual((map.style.layers?.[0] as Record<string, unknown> | undefined)?.filter, ['==', ['get', 'kind'], 'road']);
  await apply({ op: 'setLayerFilter', layerId: 'roads', mode: 'and', filter: ['!=', ['get', 'closed'], true] });
  assert.deepEqual((map.style.layers?.[0] as Record<string, unknown> | undefined)?.filter, ['all', ['==', ['get', 'kind'], 'road'], ['!=', ['get', 'closed'], true]]);
  await apply({ op: 'setLayerFilter', layerId: 'roads', mode: 'or', filter: ['==', ['get', 'kind'], 'highway'] });
  assert.deepEqual((map.style.layers?.[0] as Record<string, unknown> | undefined)?.filter, ['any', ['all', ['==', ['get', 'kind'], 'road'], ['!=', ['get', 'closed'], true]], ['==', ['get', 'kind'], 'highway']]);
  await apply({ op: 'setLayerFilter', layerId: 'roads', mode: 'clear' });
  assert.equal(Object.hasOwn(map.style.layers?.[0] ?? {}, 'filter'), false);
});

test('forwards native runtime command arguments exactly', async () => {
  const map = new FakeMap();
  const command = createMapLibreStyleTools({ getMap: () => map.asMap() }).runMapCommand;
  const diff = { remove: [1] };
  const updated = await command.execute({ action: 'updateGeoJsonData', sourceId: 'points', diff });
  assert.equal(updated.success, true);
  assert.deepEqual(map.commandArguments.updateData, [diff]);
  const lod = await command.execute({ action: 'setSourceTileLodParams', sourceId: 'base', maxZoomLevelsOnScreen: 3, tileCountMaxMinRatio: 2 });
  assert.equal(lod.success, true);
  assert.deepEqual(map.commandArguments.setSourceTileLodParams, [3, 2, 'base']);
});

test('covers split document/update routes and authentic unavailable authority failures', async () => {
  const map = new FakeMap(); const tools = createMapLibreStyleTools({ getMap: () => map.asMap(), imageLoader });
  const update = await tools.runMapCommand.execute({ action: 'updateGeoJsonData', sourceId: 'points', diff: { remove: [1] } }); assert.equal(update.success, true); assert.ok(map.calls.includes('updateData'));
  const styleUrl = 'https://example.test/style.json';
  const url = await tools.applyStyleDocument.execute({ source: { kind: 'url', url: styleUrl } }); assert.equal(url.success, true); assert.deepEqual(map.styleInputs, [styleUrl]);
  const unavailable = createMapLibreStyleTools({ getMap: () => null }).applyStyleTransaction.execute({ transaction: { operations: [{ op: 'setLayerFilter', layerId: 'roads', mode: 'clear' }] } }); const failed = await unavailable; assert.equal(failed.success, false); if (!failed.success) assert.equal(failed.error.code, 'MAP_NOT_READY');
});

test('retains native pre-operation drift authority failures before either live mutation', async () => {
  const transactionMap = new AuthorityDriftMap();
  const transaction = await createMapLibreStyleTools({
    getMap: () => transactionMap.asMap(), imageLoader,
  }).applyStyleTransaction.execute({
    transaction: { operations: [{ op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2 } }] },
  });
  assert.equal(transaction.success, false);
  if (!transaction.success) {
    assert.equal(transaction.error.code, 'REVISION_CONFLICT');
    assert.equal('data' in transaction, false);
  }
  assert.equal(transactionMap.styleReads, 2);
  assert.deepEqual(transactionMap.calls, []);

  const documentMap = new AuthorityDriftMap();
  const document = await createMapLibreStyleTools({
    getMap: () => documentMap.asMap(), imageLoader,
  }).applyStyleDocument.execute({
    source: { kind: 'style', style: { ...baseStyle(), name: 'candidate' } as never },
  });
  assert.equal(document.success, false);
  if (!document.success) {
    assert.equal(document.error.code, 'REVISION_CONFLICT');
    assert.equal('data' in document, false);
  }
  assert.equal(documentMap.styleReads, 3);
  assert.deepEqual(documentMap.calls, []);
});

test('retains native unavailable-before-invoke failures without success payloads', async () => {
  const transactionMap = new UnavailableDuringApplyMap(1);
  const transaction = await createMapLibreStyleTools({
    getMap: () => transactionMap.asMap(), imageLoader,
  }).applyStyleTransaction.execute({
    transaction: { operations: [{ op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2 } }] },
  });
  assert.equal(transaction.success, false);
  if (!transaction.success) {
    assert.equal(transaction.error.code, 'INTERNAL');
    assert.equal('data' in transaction, false);
  }
  assert.equal(transactionMap.styleReads, 2);
  assert.deepEqual(transactionMap.calls, []);

  const documentMap = new UnavailableDuringApplyMap(1);
  const document = await createMapLibreStyleTools({
    getMap: () => documentMap.asMap(), imageLoader,
  }).applyStyleDocument.execute({
    source: { kind: 'style', style: { ...baseStyle(), name: 'candidate' } as never },
  });
  assert.equal(document.success, false);
  if (!document.success) {
    assert.equal(document.error.code, 'INTERNAL');
    assert.equal('data' in document, false);
  }
  assert.equal(documentMap.styleReads, 3);
  assert.deepEqual(documentMap.calls, []);
});

test('retains mutation-started rollback failures as failure-only details for both routes', async () => {
  const transactionMap = new AuthorityFailureMap();
  const transaction = await createMapLibreStyleTools({
    getMap: () => transactionMap.asMap(), imageLoader,
  }).applyStyleTransaction.execute({
    transaction: { operations: [{ op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2 } }] },
  });
  assert.equal(transaction.success, false);
  if (!transaction.success) {
    assert.deepEqual(transaction.error, {
      code: 'INTERNAL',
      message: 'Map style application failed.',
      details: {
        rollback: {
          rolledBack: false,
          error: { code: 'INTERNAL', message: 'Map style application failed.' },
        },
      },
    });
    assert.equal('data' in transaction, false);
  }
  assert.equal(transactionMap.styleReads, 5);
  assert.deepEqual(transactionMap.calls, ['setStyle', 'setStyle']);

  const documentMap = new AuthorityFailureMap();
  const document = await createMapLibreStyleTools({
    getMap: () => documentMap.asMap(), imageLoader,
  }).applyStyleDocument.execute({
    source: { kind: 'style', style: { ...baseStyle(), name: 'candidate' } as never },
  });
  assert.equal(document.success, false);
  if (!document.success) {
    assert.deepEqual(document.error, {
      code: 'INTERNAL',
      message: 'Map style application failed.',
      details: {
        rollback: {
          rolledBack: false,
          error: { code: 'INTERNAL', message: 'Map style application failed.' },
        },
      },
    });
    assert.equal('data' in document, false);
  }
  assert.equal(documentMap.styleReads, 3);
  assert.deepEqual(documentMap.calls, ['setStyle', 'setStyle']);
});
