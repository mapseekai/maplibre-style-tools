import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { RuntimeImageLoader } from '../adapters/maplibre/index.js';
import { createMapLibreStyleTools } from './tools.js';
import type { MapLibreStyleTools } from './contracts.js';

const fullLegacyNames = [
  'listAllLayers', 'listAllSources', 'inspectLayerStyle', 'inspectSource',
  'setLayerPaintProperty', 'setLayerLayoutProperty', 'setLayerPaintPropertySmart',
  'setLayerLayoutPropertySmart', 'batchSetLayerPaintPropertiesSmart',
  'batchSetLayerLayoutPropertiesSmart', 'batchSetLayerPaintProperties',
  'batchSetLayerLayoutProperties', 'clearLayerPaintProperty',
  'clearLayerLayoutProperty', 'setLayerFilter', 'setLayerZoomRange',
  'setLayerVisibility', 'addLayer', 'moveLayer', 'removeLayer',
  'patchLayerDefinition', 'replaceLayerDefinition', 'addSource', 'removeSource',
  'updateGeoJsonSourceData', 'setGeoJsonClusterOptions', 'setSourceTileLodParams',
  'patchSourceDefinition', 'replaceSourceDefinition', 'setStyleJsonOrUrl',
  'inspectRootStyle', 'setStyleName', 'setStyleMetadata', 'setStyleTransition',
  'setStyleCameraDefaults', 'validateStyleJson', 'validateCurrentMapStyle',
  'setMapLight', 'setMapSky', 'setMapProjection', 'setMapTerrain',
  'setMapGlyphs', 'setMapSprite', 'listSprites', 'addSprite', 'removeSprite',
  'setFeatureState', 'removeFeatureState', 'setGlobalStateProperty',
  'listImages', 'addImageFromUrl', 'removeImage', 'getLayerCount',
] as const;
const compactLegacyNames = [
  'getStyleContext', 'searchLayers', 'inspectLayersCompact',
  'applyStyleOperations', 'validateStylePatchJson',
] as const;
const retainedNames = [
  'analyzeGeoJson', 'listSourceLayers', 'duplicateLayer', 'addLayerFromSource',
  'addGeoJsonLayer', 'applyStyleTransaction', 'querySourceFeatures',
  'queryRenderedFeatures',
] as const;

type Category = 'full' | 'compact' | 'retained';
type MigrationRow = { legacyName: string; category: Category; tool: keyof MapLibreStyleTools; input: Record<string, unknown> };
const transaction = (operation: Record<string, unknown>) => ({ transaction: { operations: [operation] } });
const rows = (category: Category, names: readonly string[], tool: MigrationRow['tool'], input: Record<string, unknown>) => names.map((legacyName) => ({ legacyName, category, tool, input }));
const migrationRows: MigrationRow[] = [
  ...rows('full', fullLegacyNames.slice(0, 4), 'inspectStyle', { action: 'listLayers' }),
  ...rows('full', fullLegacyNames.slice(4, 24), 'applyStyleTransaction', transaction({ op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2 } })),
  ...rows('full', fullLegacyNames.slice(24, 25), 'runMapCommand', { action: 'updateGeoJsonData', sourceId: 'points', diff: { remove: [1] } }),
  ...rows('full', fullLegacyNames.slice(25, 26), 'applyStyleTransaction', transaction({ op: 'patchSource', sourceId: 'points', patch: { clusterRadius: 50 } })),
  ...rows('full', fullLegacyNames.slice(26, 27), 'runMapCommand', { action: 'setSourceTileLodParams', maxZoomLevelsOnScreen: 1, tileCountMaxMinRatio: 1 }),
  ...rows('full', fullLegacyNames.slice(27, 28), 'applyStyleTransaction', transaction({ op: 'patchSource', sourceId: 'points', patch: { cluster: false } })),
  ...rows('full', fullLegacyNames.slice(28, 29), 'applyStyleTransaction', transaction({ op: 'replaceSourceDefinition', sourceId: 'points', source: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } })),
  ...rows('full', fullLegacyNames.slice(29, 30), 'applyStyleDocument', { source: { kind: 'style', style: baseStyle() } }),
  ...rows('full', fullLegacyNames.slice(30, 31), 'inspectStyle', { action: 'getRoot' }),
  ...rows('full', fullLegacyNames.slice(31, 36), 'applyStyleTransaction', transaction({ op: 'setStyleRootProperties', properties: { name: 'changed' } })),
  ...rows('full', fullLegacyNames.slice(36, 38), 'inspectStyle', { action: 'validateCurrentMap' }),
  ...rows('full', fullLegacyNames.slice(38, 44), 'applyStyleTransaction', transaction({ op: 'setStyleRootProperties', properties: { glyphs: 'https://example.test/{fontstack}/{range}.pbf' } })),
  ...rows('full', fullLegacyNames.slice(44, 47), 'runMapCommand', { action: 'listSprites' }),
  ...rows('full', fullLegacyNames.slice(47, 50), 'runMapCommand', { action: 'setFeatureState', target: { source: 'base', id: 1 }, state: { selected: true } }),
  ...rows('full', fullLegacyNames.slice(50, 53), 'runMapCommand', { action: 'listImages' }),
  ...rows('full', fullLegacyNames.slice(53), 'inspectStyle', { action: 'getLayerCount' }),
  ...rows('compact', compactLegacyNames.slice(0, 3), 'inspectStyle', { action: 'inspectLayers' }),
  ...rows('compact', compactLegacyNames.slice(3, 4), 'applyStyleTransaction', transaction({ op: 'setLayerFilter', layerId: 'roads', mode: 'clear' })),
  ...rows('compact', compactLegacyNames.slice(4), 'inspectStyle', { action: 'validateTransaction', transaction: { operations: [{ op: 'setLayerFilter', layerId: 'roads', mode: 'clear' }] } }),
  ...rows('retained', retainedNames.slice(0, 2), 'inspectStyle', { action: 'listSourceLayers', sourceId: 'base' }),
  ...rows('retained', retainedNames.slice(2, 6), 'applyStyleTransaction', transaction({ op: 'duplicateLayer', layerId: 'roads', newLayerId: 'roads-copy' })),
  ...rows('retained', retainedNames.slice(6, 7), 'queryMapFeatures', { target: 'source', sourceId: 'base' }),
  ...rows('retained', retainedNames.slice(7), 'queryMapFeatures', { target: 'rendered' }),
];

function baseStyle(): StyleSpecification { return { version: 8, sources: { base: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] }, points: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }, layers: [{ id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads', paint: { 'line-width': 1 } }] }; }
class FakeMap {
  style = baseStyle(); loaded = true; readonly listeners = new Map<string, Set<(event: { type: string; error?: Error }) => void>>();
  getStyle() { return structuredClone(this.style); } isStyleLoaded() { return this.loaded; }
  getSource(id: string) { return id === 'points' ? { type: 'geojson', updateData: async () => undefined } : id in this.style.sources ? { type: 'vector' } : undefined; }
  on(type: string, listener: (event: { type: string; error?: Error }) => void) { (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(listener); return { unsubscribe: () => this.listeners.get(type)?.delete(listener) }; }
  off(type: string, listener: (event: { type: string; error?: Error }) => void) { this.listeners.get(type)?.delete(listener); return this; }
  setStyle(style: StyleSpecification | string) { if (typeof style !== 'string') this.style = structuredClone(style); queueMicrotask(() => this.listeners.get('style.load')?.forEach((listener) => listener({ type: 'style.load' }))); return this; }
  querySourceFeatures() { return [{ type: 'Feature', geometry: null, properties: {} }]; } queryRenderedFeatures() { return [{ type: 'Feature', geometry: null, properties: {} }]; }
  listImages() { return []; } hasImage() { return false; } addImage() {} updateImage() {} removeImage() {} getSprite() { return []; } addSprite() {} removeSprite() {} setSourceTileLodParams() {} setFeatureState() {} removeFeatureState() {} setGlobalStateProperty() {}
  asMap() { return this as unknown as MapLibreMap; }
}
const imageLoader: RuntimeImageLoader = { async load() { return { width: 1, height: 1, data: new Uint8Array(4) }; } };

test('composes only five promise-returning tools and executes the complete migration matrix', async () => {
  const fake = new FakeMap(); const tools = createMapLibreStyleTools({ getMap: () => fake.asMap(), imageLoader });
  assert.deepEqual(Object.keys(tools), ['inspectStyle', 'applyStyleTransaction', 'applyStyleDocument', 'runMapCommand', 'queryMapFeatures']);
  for (const tool of Object.values(tools)) { assert.equal(typeof tool.execute, 'function'); assert.ok(tool.execute({} as never) instanceof Promise); }
  assert.deepEqual(migrationRows.filter((row) => row.category === 'full').map((row) => row.legacyName), fullLegacyNames);
  assert.deepEqual(migrationRows.filter((row) => row.category === 'compact').map((row) => row.legacyName), compactLegacyNames);
  assert.deepEqual(migrationRows.filter((row) => row.category === 'retained').map((row) => row.legacyName), retainedNames);
  for (const row of migrationRows) {
    const rowTools = createMapLibreStyleTools({ getMap: () => new FakeMap().asMap(), imageLoader });
    const result = await (rowTools[row.tool].execute as (input: never) => Promise<{ success: boolean }>)(structuredClone(row.input) as never);
    assert.equal(result.success, true, row.legacyName);
  }
});
