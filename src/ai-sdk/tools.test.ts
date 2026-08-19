import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { RuntimeImageLoader } from '../adapters/maplibre/index.js';
import type { MapLibreStyleTools } from './contracts.js';
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
  style = baseStyle(); readonly calls: string[] = []; readonly listeners = new Map<string, Set<(event: { type: string; error?: Error }) => void>>();
  getStyle() { return structuredClone(this.style); } isStyleLoaded() { return true; }
  getSource(id: string) { return id === 'points' ? { type: 'geojson', updateData: async () => { this.calls.push('updateData'); } } : id in this.style.sources ? { type: 'vector' } : undefined; }
  on(type: string, listener: (event: { type: string; error?: Error }) => void) { (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(listener); return { unsubscribe: () => this.listeners.get(type)?.delete(listener) }; }
  off(type: string, listener: (event: { type: string; error?: Error }) => void) { this.listeners.get(type)?.delete(listener); return this; }
  setStyle(style: StyleSpecification | string) { this.calls.push('setStyle'); if (typeof style !== 'string') this.style = structuredClone(style); queueMicrotask(() => this.listeners.get('style.load')?.forEach((listener) => listener({ type: 'style.load' }))); return this; }
  setSourceTileLodParams() { this.calls.push('setSourceTileLodParams'); } setFeatureState() { this.calls.push('setFeatureState'); } removeFeatureState() { this.calls.push('removeFeatureState'); } setGlobalStateProperty() { this.calls.push('setGlobalState'); }
  listImages() { this.calls.push('listImages'); return ['existing']; } hasImage(id: string) { return id === 'existing'; } addImage() { this.calls.push('addImage'); } updateImage() { this.calls.push('updateImage'); } removeImage() { this.calls.push('removeImage'); }
  getSprite() { this.calls.push('listSprites'); return [{ id: 'sprite', url: 'https://example.test/sprite' }]; } addSprite() { this.calls.push('addSprite'); } removeSprite() { this.calls.push('removeSprite'); }
  querySourceFeatures() { this.calls.push('querySourceFeatures'); return [{ type: 'Feature', geometry: null, properties: {} }]; } queryRenderedFeatures() { this.calls.push('queryRenderedFeatures'); return [{ type: 'Feature', geometry: null, properties: {} }]; }
  asMap() { return this as unknown as MapLibreMap; }
}
const imageLoader: RuntimeImageLoader = { async load() { return { width: 1, height: 1, data: new Uint8Array(4) }; } };
const inspection = (legacyName: string, action: Record<string, unknown>, predicate: (data: Record<string, unknown>) => boolean): MigrationRow => ({ legacyName, category: 'full', tool: 'inspectStyle', input: action, verify: (result) => assert.ok(result.data !== undefined && predicate(result.data)) });
const transaction = (legacyName: string, operation: Record<string, unknown>, changed: 'layer' | 'source' | 'root' = 'layer'): MigrationRow => ({ legacyName, category: 'full', tool: 'applyStyleTransaction', input: { transaction: { operations: [operation] }, diff: true }, verify: (result, map) => { assert.equal(map.calls.includes('setStyle'), true, legacyName); const data = result.data!; assert.equal(data.applied, true, legacyName); if (changed === 'layer') assert.ok((data.changedLayers as string[]).length > 0, legacyName); if (changed === 'source') assert.ok((data.changedSources as string[]).length > 0, legacyName); if (changed === 'root') assert.equal(data.styleAuthority, 'current', legacyName); } });
const command = (legacyName: string, input: Record<string, unknown>, call: string): MigrationRow => ({ legacyName, category: 'full', tool: 'runMapCommand', input, verify: (result, map) => { assert.equal(result.data?.action, input.action); assert.ok(map.calls.includes(call)); } });

const migrationRows: MigrationRow[] = [
  inspection('listAllLayers', { action: 'listLayers' }, (data) => data.action === 'listLayers'),
  inspection('listAllSources', { action: 'listSources' }, (data) => data.action === 'listSources'),
  inspection('inspectLayerStyle', { action: 'getLayer', layerId: 'roads', fields: ['paint', 'layout', 'filter', 'zoom'] }, (data) => data.action === 'getLayer'),
  inspection('inspectSource', { action: 'getSource', sourceId: 'points' }, (data) => data.action === 'getSource'),
  transaction('setLayerPaintProperty', { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2 } }),
  transaction('setLayerLayoutProperty', { op: 'setLayerProperties', layerId: 'roads', layout: { visibility: 'none' } }),
  transaction('setLayerPaintPropertySmart', { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#fff' } }),
  transaction('setLayerLayoutPropertySmart', { op: 'setLayerProperties', layerId: 'roads', layout: { 'line-cap': 'round' } }),
  transaction('batchSetLayerPaintPropertiesSmart', { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2, 'line-opacity': 0.5 } }),
  transaction('batchSetLayerLayoutPropertiesSmart', { op: 'setLayerProperties', layerId: 'roads', layout: { visibility: 'none', 'line-cap': 'round' } }),
  transaction('batchSetLayerPaintProperties', { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#f00' } }),
  transaction('batchSetLayerLayoutProperties', { op: 'setLayerProperties', layerId: 'roads', layout: { visibility: 'none' } }),
  transaction('clearLayerPaintProperty', { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': null } }),
  transaction('clearLayerLayoutProperty', { op: 'setLayerProperties', layerId: 'roads', layout: { visibility: null } }),
  transaction('setLayerFilter', { op: 'setLayerFilter', layerId: 'roads', mode: 'replace', filter: ['==', 'kind', 'road'] }),
  transaction('setLayerZoomRange', { op: 'setLayerProperties', layerId: 'roads', minzoom: 1, maxzoom: 10 }),
  transaction('setLayerVisibility', { op: 'setLayerProperties', layerId: 'roads', layout: { visibility: 'none' } }),
  transaction('addLayer', { op: 'addLayerDefinition', layer: { id: 'added', type: 'line', source: 'base', 'source-layer': 'roads' } }),
  transaction('moveLayer', { op: 'moveLayer', layerId: 'roads', afterId: 'labels' }),
  transaction('removeLayer', { op: 'removeLayer', layerId: 'labels' }),
  transaction('patchLayerDefinition', { op: 'deepMergeLayerDefinition', layerId: 'roads', patch: { paint: { 'line-width': 3 } } }),
  transaction('replaceLayerDefinition', { op: 'replaceLayerDefinition', layerId: 'roads', layer: { id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads', paint: { 'line-width': 4 } } }),
  transaction('addSource', { op: 'addSource', sourceId: 'added', source: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] } }, 'source'),
  transaction('removeSource', { op: 'removeSource', sourceId: 'points' }, 'source'),
  { legacyName: 'updateGeoJsonSourceData', category: 'full', tool: 'applyStyleTransaction', input: { transaction: { operations: [{ op: 'setGeoJsonData', sourceId: 'points', data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }] } }] } }, verify: (result, map) => { assert.equal(result.data?.applied, true); assert.ok(map.calls.includes('setStyle')); } },
  transaction('setGeoJsonClusterOptions', { op: 'patchSource', sourceId: 'points', patch: { clusterRadius: 50 } }, 'source'),
  command('setSourceTileLodParams', { action: 'setSourceTileLodParams', maxZoomLevelsOnScreen: 1, tileCountMaxMinRatio: 1 }, 'setSourceTileLodParams'),
  transaction('patchSourceDefinition', { op: 'deepMergeSourceDefinition', sourceId: 'points', patch: { clusterRadius: 25 } }, 'source'),
  transaction('replaceSourceDefinition', { op: 'replaceSourceDefinition', sourceId: 'points', source: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }, 'source'),
  { legacyName: 'setStyleJsonOrUrl', category: 'full', tool: 'applyStyleDocument', input: { source: { kind: 'style', style: { ...baseStyle(), name: 'document' } } }, verify: (result, map) => { assert.equal(result.data?.applied, true); assert.ok(map.calls.includes('setStyle')); } },
  inspection('inspectRootStyle', { action: 'getRoot' }, (data) => data.action === 'getRoot'),
  transaction('setStyleName', { op: 'setStyleRootProperties', properties: { name: 'changed' } }, 'root'),
  transaction('setStyleMetadata', { op: 'setStyleRootProperties', properties: { metadata: { revision: 1 } } }, 'root'),
  transaction('setStyleTransition', { op: 'setStyleRootProperties', properties: { transition: { duration: 100 } } }, 'root'),
  transaction('setStyleCameraDefaults', { op: 'setStyleRootProperties', properties: { center: [0, 0], zoom: 2 } }, 'root'),
  inspection('validateStyleJson', { action: 'validateDocument', style: baseStyle() }, (data) => data.action === 'validateDocument'),
  inspection('validateCurrentMapStyle', { action: 'validateCurrentMap' }, (data) => data.action === 'validateCurrentMap'),
  transaction('setMapLight', { op: 'shallowPatchRootProperty', property: 'light', patch: { intensity: 0.5 } }, 'root'),
  transaction('setMapSky', { op: 'replaceRootProperty', property: 'sky', value: {} }, 'root'),
  transaction('setMapProjection', { op: 'replaceRootProperty', property: 'projection', value: { type: 'globe' } }, 'root'),
  transaction('setMapTerrain', { op: 'replaceRootProperty', property: 'terrain', value: { source: 'dem', exaggeration: 2 } }, 'root'),
  transaction('setMapGlyphs', { op: 'setStyleRootProperties', properties: { glyphs: 'https://example.test/{fontstack}/{range}.pbf' } }, 'root'),
  transaction('setMapSprite', { op: 'setStyleRootProperties', properties: { sprite: 'https://example.test/sprite' } }, 'root'),
  command('listSprites', { action: 'listSprites' }, 'listSprites'), command('addSprite', { action: 'addSprite', spriteId: 'new', url: 'https://example.test/new' }, 'addSprite'), command('removeSprite', { action: 'removeSprite', spriteId: 'sprite' }, 'removeSprite'),
  command('setFeatureState', { action: 'setFeatureState', target: { source: 'base', id: 1 }, state: { selected: true } }, 'setFeatureState'), command('removeFeatureState', { action: 'removeFeatureState', target: { source: 'base', id: 1 }, key: 'selected' }, 'removeFeatureState'), command('setGlobalStateProperty', { action: 'setGlobalState', propertyName: 'theme', value: 'dark' }, 'setGlobalState'),
  command('listImages', { action: 'listImages' }, 'listImages'), command('addImageFromUrl', { action: 'addImageFromUrl', imageId: 'new', url: 'https://example.test/new.png' }, 'addImage'), command('removeImage', { action: 'removeImage', imageId: 'existing' }, 'removeImage'), inspection('getLayerCount', { action: 'getLayerCount' }, (data) => data.action === 'getLayerCount'),
  { legacyName: 'getStyleContext', category: 'compact', tool: 'inspectStyle', input: { action: 'getContext' }, verify: (result) => assert.equal(result.data?.action, 'getContext') },
  { legacyName: 'searchLayers', category: 'compact', tool: 'inspectStyle', input: { action: 'listLayers', query: 'road' }, verify: (result) => assert.equal(result.data?.action, 'listLayers') },
  { legacyName: 'inspectLayersCompact', category: 'compact', tool: 'inspectStyle', input: { action: 'inspectLayers', layerIds: ['roads'] }, verify: (result) => assert.equal(result.data?.action, 'inspectLayers') },
  { legacyName: 'applyStyleOperations', category: 'compact', tool: 'applyStyleTransaction', input: { transaction: { operations: [{ op: 'setLayerFilter', layerId: 'roads', mode: 'replace', filter: ['==', 'kind', 'road'] }] } }, verify: (result, map) => { assert.equal(result.data?.applied, true); assert.ok(map.calls.includes('setStyle')); } },
  { legacyName: 'validateStylePatchJson', category: 'compact', tool: 'inspectStyle', input: { action: 'validateTransaction', transaction: { operations: [{ op: 'setLayerFilter', layerId: 'roads', mode: 'clear' }] } }, verify: (result) => assert.equal(result.data?.action, 'validateTransaction') },
  { legacyName: 'analyzeGeoJson', category: 'retained', tool: 'inspectStyle', input: { action: 'analyzeGeoJson', data: { type: 'FeatureCollection', features: [] } }, verify: (result) => assert.equal(result.data?.action, 'analyzeGeoJson') },
  { legacyName: 'listSourceLayers', category: 'retained', tool: 'inspectStyle', input: { action: 'listSourceLayers', sourceId: 'base' }, verify: (result) => assert.equal(result.data?.action, 'listSourceLayers') },
  { legacyName: 'duplicateLayer', category: 'retained', tool: 'applyStyleTransaction', input: { transaction: { operations: [{ op: 'duplicateLayer', layerId: 'roads', newLayerId: 'roads-copy' }] } }, verify: (result, map) => { assert.equal(result.data?.applied, true); assert.ok(map.calls.includes('setStyle')); } },
  { legacyName: 'addLayerFromSource', category: 'retained', tool: 'applyStyleTransaction', input: { transaction: { operations: [{ op: 'addLayerFromSource', layerId: 'from-source', sourceId: 'base', sourceLayer: 'roads', type: 'line' }] } }, verify: (result, map) => { assert.equal(result.data?.applied, true); assert.ok(map.calls.includes('setStyle')); } },
  { legacyName: 'addGeoJsonLayer', category: 'retained', tool: 'applyStyleTransaction', input: { transaction: { operations: [{ op: 'addGeoJsonLayer', sourceId: 'geo', layerId: 'geo-layer', data: { type: 'FeatureCollection', features: [] }, type: 'circle' }] } }, verify: (result, map) => { assert.equal(result.data?.applied, true); assert.ok(map.calls.includes('setStyle')); } },
  { legacyName: 'applyStyleTransaction', category: 'retained', tool: 'applyStyleTransaction', input: { transaction: { operations: [{ op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 5 } }] } }, verify: (result, map) => { assert.equal(result.data?.applied, true); assert.ok(map.calls.includes('setStyle')); } },
  { legacyName: 'querySourceFeatures', category: 'retained', tool: 'queryMapFeatures', input: { target: 'source', sourceId: 'base' }, verify: (result, map) => { assert.equal(result.data?.target, 'source'); assert.ok(map.calls.includes('querySourceFeatures')); } },
  { legacyName: 'queryRenderedFeatures', category: 'retained', tool: 'queryMapFeatures', input: { target: 'rendered' }, verify: (result, map) => { assert.equal(result.data?.target, 'rendered'); assert.ok(map.calls.includes('queryRenderedFeatures')); } },
];

test('composes five Promise tools and executes each migration replacement behavior', async () => {
  const tools = createMapLibreStyleTools({ getMap: () => new FakeMap().asMap(), imageLoader });
  assert.deepEqual(Object.keys(tools), ['inspectStyle', 'applyStyleTransaction', 'applyStyleDocument', 'runMapCommand', 'queryMapFeatures']);
  for (const tool of Object.values(tools)) { assert.equal(typeof tool.execute, 'function'); assert.ok(tool.execute({} as never) instanceof Promise); }
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

test('covers split document/update routes and authentic unavailable authority failures', async () => {
  const map = new FakeMap(); const tools = createMapLibreStyleTools({ getMap: () => map.asMap(), imageLoader });
  const update = await tools.runMapCommand.execute({ action: 'updateGeoJsonData', sourceId: 'points', diff: { remove: [1] } }); assert.equal(update.success, true); assert.ok(map.calls.includes('updateData'));
  const url = await tools.applyStyleDocument.execute({ source: { kind: 'url', url: 'https://example.test/style.json' } }); assert.equal(url.success, true); assert.ok(map.calls.includes('setStyle'));
  const unavailable = createMapLibreStyleTools({ getMap: () => null }).applyStyleTransaction.execute({ transaction: { operations: [{ op: 'setLayerFilter', layerId: 'roads', mode: 'clear' }] } }); const failed = await unavailable; assert.equal(failed.success, false); if (!failed.success) assert.equal(failed.error.code, 'MAP_NOT_READY');
});
