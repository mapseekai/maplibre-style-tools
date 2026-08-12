import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { validateStyleDocument } from '../core/index.js';
import type { RuntimeImageLoader } from '../adapters/maplibre/index.js';
import { createMapLibreStyleTools } from './full-tools.js';
import * as namedSchemas from './schemas.js';
import { FULL_LEGACY_TOOL_NAMES } from './tool-contracts.js';

const STRUCTURED_TOOL_NAMES = [
  'analyzeGeoJson', 'listSourceLayers', 'duplicateLayer',
  'addLayerFromSource', 'addGeoJsonLayer', 'applyStyleTransaction',
] as const;
const QUERY_TOOL_NAMES = ['querySourceFeatures', 'queryRenderedFeatures'] as const;

type EventName = 'style.load' | 'error';
type Listener = (event: { type: EventName; error?: Error }) => void;

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'base',
    sources: {
      base: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] },
      points: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
      },
      dem: {
        type: 'raster-dem',
        tiles: ['https://example.test/dem/{z}/{x}/{y}.png'],
        tileSize: 256,
      },
    },
    layers: [
      {
        id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads',
        paint: { 'line-color': '#000', 'line-width': 1 },
        layout: { visibility: 'visible', 'line-cap': 'butt' },
      },
      {
        id: 'labels', type: 'symbol', source: 'base', 'source-layer': 'labels',
        layout: { visibility: 'visible' },
      },
    ],
    metadata: { old: true },
    transition: { duration: 300, delay: 0 },
    light: { anchor: 'map', intensity: 0.4 },
  };
}

class FakeMap {
  style: StyleSpecification;
  loaded = true;
  failCandidate = false;
  readonly setStyleCalls: Array<{
    style: StyleSpecification | string;
    options: { diff?: boolean } | undefined;
  }> = [];
  readonly runtimeCalls: string[] = [];
  readonly sprites = [{ id: 'base-sprite', url: 'https://example.test/sprite' }];
  readonly images = new Set(['existing-image']);
  readonly geoJsonSource = {
    type: 'geojson',
    updateData: async () => { this.runtimeCalls.push('updateData'); },
  };
  private readonly listeners = new Map<EventName, Set<Listener>>();

  constructor(style: StyleSpecification = baseStyle()) {
    this.style = structuredClone(style);
  }

  getStyle(): StyleSpecification { return structuredClone(this.style); }
  getLayer(layerId: string): unknown {
    return this.style.layers?.find((layer) => layer.id === layerId);
  }
  getSource(sourceId: string): unknown {
    if (!(sourceId in (this.style.sources ?? {}))) return undefined;
    return sourceId === 'points' ? this.geoJsonSource : { type: 'vector' };
  }
  isStyleLoaded(): boolean { return this.loaded; }
  on(type: EventName, listener: Listener): { unsubscribe(): void } {
    let listeners = this.listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
    return { unsubscribe: () => { listeners!.delete(listener); } };
  }
  off(type: EventName, listener: Listener): this {
    this.listeners.get(type)?.delete(listener);
    return this;
  }
  emit(type: EventName, error?: Error): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ type, error });
    }
  }
  setStyle(style: StyleSpecification | string, options?: { diff?: boolean }): this {
    this.setStyleCalls.push({ style, options });
    this.loaded = false;
    if (this.failCandidate && this.setStyleCalls.length === 1) {
      queueMicrotask(() => { this.emit('error', new Error('candidate rejected')); });
      return this;
    }
    if (typeof style !== 'string') this.style = structuredClone(style);
    this.loaded = true;
    queueMicrotask(() => { this.emit('style.load'); });
    return this;
  }

  setSourceTileLodParams(): void { this.runtimeCalls.push('setSourceTileLodParams'); }
  setFeatureState(): void { this.runtimeCalls.push('setFeatureState'); }
  removeFeatureState(): void { this.runtimeCalls.push('removeFeatureState'); }
  setGlobalStateProperty(): void { this.runtimeCalls.push('setGlobalState'); }
  listImages(): string[] { this.runtimeCalls.push('listImages'); return [...this.images]; }
  hasImage(id: string): boolean { return this.images.has(id); }
  addImage(id: string): void { this.runtimeCalls.push('addImage'); this.images.add(id); }
  updateImage(id: string): void { this.runtimeCalls.push('updateImage'); this.images.add(id); }
  removeImage(id: string): void { this.runtimeCalls.push('removeImage'); this.images.delete(id); }
  getSprite(): Array<{ id: string; url: string }> {
    this.runtimeCalls.push('listSprites');
    return structuredClone(this.sprites);
  }
  addSprite(id: string, url: string): void {
    this.runtimeCalls.push('addSprite');
    this.sprites.push({ id, url });
  }
  removeSprite(id: string): void {
    this.runtimeCalls.push('removeSprite');
    const index = this.sprites.findIndex((sprite) => sprite.id === id);
    if (index >= 0) this.sprites.splice(index, 1);
  }
  querySourceFeatures(): unknown[] {
    this.runtimeCalls.push('querySourceFeatures');
    return [{ type: 'Feature', id: 1, geometry: null, properties: { name: 'one' } }];
  }
  queryRenderedFeatures(): unknown[] {
    this.runtimeCalls.push('queryRenderedFeatures');
    return [{
      type: 'Feature', id: 2, geometry: null, properties: { name: 'two' },
      layer: { id: 'roads', type: 'line' },
    }];
  }
  asMap(): MapLibreMap { return this as unknown as MapLibreMap; }
}

class AuthorityFailureMap extends FakeMap {
  private mutationCount = 0;
  private unreadable = false;

  override getStyle(): StyleSpecification {
    if (this.unreadable) throw new Error('current style unavailable');
    return super.getStyle();
  }

  override setStyle(
    style: StyleSpecification | string,
    options?: { diff?: boolean },
  ): this {
    this.setStyleCalls.push({ style, options });
    this.loaded = false;
    this.mutationCount += 1;
    queueMicrotask(() => {
      this.emit('error', new Error(
        this.mutationCount === 1 ? 'candidate rejected' : 'rollback rejected',
      ));
      if (this.mutationCount === 2) this.unreadable = true;
    });
    return this;
  }
}

class UnavailableDuringApplyMap extends FakeMap {
  private reads = 0;

  constructor(private readonly readableReads: number) {
    super();
  }

  override getStyle(): StyleSpecification {
    this.reads += 1;
    if (this.reads > this.readableReads) throw new Error('current style unavailable');
    return super.getStyle();
  }
}

const imageLoader: RuntimeImageLoader = {
  async load() {
    return { width: 1, height: 1, data: new Uint8Array(4) };
  },
};

async function executeTool(
  toolValue: unknown,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const execute = (toolValue as {
    execute?: (value: Record<string, unknown>, options?: unknown) => unknown;
  }).execute;
  assert.ok(execute);
  const result = await execute(input, {});
  assert.equal(typeof result, 'object');
  assert.notEqual(result, null);
  return result as Record<string, unknown>;
}

type Route = 'discovery' | 'document' | 'runtime' | 'validation' | 'mixed';
type RoutingRow = {
  name: typeof FULL_LEGACY_TOOL_NAMES[number];
  input: Record<string, unknown>;
  route: Route;
  invoke?: (
    tools: Record<string, unknown>, fake: FakeMap,
  ) => Promise<Record<string, unknown>[]>;
};

const wholeStyle = JSON.stringify({ ...baseStyle(), name: 'replacement' });
const routingRows: RoutingRow[] = [
  { name: 'listAllLayers', input: {}, route: 'discovery' },
  { name: 'listAllSources', input: {}, route: 'discovery' },
  { name: 'inspectLayerStyle', input: { layerId: 'roads' }, route: 'discovery' },
  { name: 'inspectSource', input: { sourceId: 'points' }, route: 'discovery' },
  { name: 'setLayerPaintProperty', input: { layerId: 'roads', property: 'line-color', valueJson: '"#fff"' }, route: 'document' },
  { name: 'setLayerLayoutProperty', input: { layerId: 'roads', property: 'line-cap', valueJson: '"round"' }, route: 'document' },
  { name: 'setLayerPaintPropertySmart', input: { layerId: 'roads', property: 'line-width', valueJson: '2' }, route: 'document' },
  { name: 'setLayerLayoutPropertySmart', input: { layerId: 'roads', property: 'line-cap', valueJson: '"round"' }, route: 'document' },
  { name: 'batchSetLayerPaintPropertiesSmart', input: { layerId: 'roads', propertiesJson: '{"line-color":"#fff"}' }, route: 'document' },
  { name: 'batchSetLayerLayoutPropertiesSmart', input: { layerId: 'roads', propertiesJson: '{"line-cap":"round"}' }, route: 'document' },
  { name: 'batchSetLayerPaintProperties', input: { layerId: 'roads', propertiesJson: '{"line-width":2}' }, route: 'document' },
  { name: 'batchSetLayerLayoutProperties', input: { layerId: 'roads', propertiesJson: '{"line-cap":"round"}' }, route: 'document' },
  { name: 'clearLayerPaintProperty', input: { layerId: 'roads', property: 'line-color' }, route: 'document' },
  { name: 'clearLayerLayoutProperty', input: { layerId: 'roads', property: 'line-cap' }, route: 'document' },
  { name: 'setLayerFilter', input: { layerId: 'roads', filterJson: '["==",["get","class"],"primary"]' }, route: 'document' },
  { name: 'setLayerZoomRange', input: { layerId: 'roads', minzoom: 1, maxzoom: 20 }, route: 'document' },
  { name: 'setLayerVisibility', input: { layerId: 'roads', visibility: 'none' }, route: 'document' },
  { name: 'addLayer', input: { layerJson: '{"id":"background","type":"background"}', beforeId: 'roads' }, route: 'document' },
  { name: 'moveLayer', input: { layerId: 'labels', beforeId: 'roads' }, route: 'document' },
  { name: 'removeLayer', input: { layerId: 'labels' }, route: 'document' },
  { name: 'patchLayerDefinition', input: { layerId: 'roads', patchJson: '{"metadata":{"patched":true}}' }, route: 'document' },
  { name: 'replaceLayerDefinition', input: { layerId: 'roads', layerJson: '{"id":"roads","type":"line","source":"base","source-layer":"roads","paint":{"line-color":"#fff"}}' }, route: 'document' },
  { name: 'addSource', input: { sourceId: 'added', sourceJson: '{"type":"geojson","data":{"type":"FeatureCollection","features":[]}}' }, route: 'document' },
  { name: 'removeSource', input: { sourceId: 'points' }, route: 'document' },
  {
    name: 'updateGeoJsonSourceData', input: {}, route: 'mixed',
    invoke: async (tools) => [
      await executeTool(tools.updateGeoJsonSourceData, {
        sourceId: 'points', method: 'setData',
        dataJson: '{"type":"FeatureCollection","features":[{"type":"Feature","id":1,"geometry":{"type":"Point","coordinates":[1,2]},"properties":{}}]}',
      }),
      await executeTool(tools.updateGeoJsonSourceData, {
        sourceId: 'points', method: 'updateData', dataJson: '{"remove":[1]}',
      }),
    ],
  },
  { name: 'setGeoJsonClusterOptions', input: { sourceId: 'points', optionsJson: '{"clusterRadius":80}' }, route: 'document' },
  { name: 'setSourceTileLodParams', input: { maxZoomLevelsOnScreen: 4, tileCountMaxMinRatio: 2 }, route: 'runtime' },
  { name: 'patchSourceDefinition', input: { sourceId: 'points', patchJson: '{"clusterRadius":80}' }, route: 'document' },
  { name: 'replaceSourceDefinition', input: { sourceId: 'points', sourceJson: '{"type":"geojson","data":{"type":"FeatureCollection","features":[]}}' }, route: 'document' },
  { name: 'setStyleJsonOrUrl', input: { styleJsonOrUrl: wholeStyle }, route: 'document' },
  { name: 'inspectRootStyle', input: {}, route: 'discovery' },
  { name: 'setStyleName', input: { name: 'renamed' }, route: 'document' },
  { name: 'setStyleMetadata', input: { metadataJson: '{"owner":"test"}' }, route: 'document' },
  { name: 'setStyleTransition', input: { transitionJson: '{"duration":120}' }, route: 'document' },
  { name: 'setStyleCameraDefaults', input: { zoom: 4 }, route: 'document' },
  { name: 'validateStyleJson', input: { styleJson: JSON.stringify(baseStyle()) }, route: 'validation' },
  { name: 'validateCurrentMapStyle', input: {}, route: 'validation' },
  { name: 'setMapLight', input: { lightJson: '{"intensity":0.6}' }, route: 'document' },
  { name: 'setMapSky', input: { skyJson: '{}' }, route: 'document' },
  { name: 'setMapProjection', input: { projectionJson: '{"type":"globe"}' }, route: 'document' },
  { name: 'setMapTerrain', input: { terrainJson: '{"source":"dem","exaggeration":2}' }, route: 'document' },
  { name: 'setMapGlyphs', input: { glyphsUrlJson: '"https://example.test/{fontstack}/{range}.pbf"' }, route: 'document' },
  { name: 'setMapSprite', input: { spriteUrlJson: '"https://example.test/sprite"' }, route: 'document' },
  { name: 'listSprites', input: {}, route: 'runtime' },
  { name: 'addSprite', input: { spriteId: 'added-sprite', url: 'https://example.test/added' }, route: 'runtime' },
  { name: 'removeSprite', input: { spriteId: 'base-sprite' }, route: 'runtime' },
  { name: 'setFeatureState', input: { targetJson: '{"source":"points","id":1}', stateJson: '{"selected":true}' }, route: 'runtime' },
  { name: 'removeFeatureState', input: { targetJson: '{"source":"points","id":1}' }, route: 'runtime' },
  { name: 'setGlobalStateProperty', input: { propertyName: 'theme', valueJson: '"night"' }, route: 'runtime' },
  { name: 'listImages', input: {}, route: 'runtime' },
  { name: 'addImageFromUrl', input: { imageId: 'added-image', url: 'https://example.test/image.png' }, route: 'runtime' },
  { name: 'removeImage', input: { imageId: 'existing-image' }, route: 'runtime' },
  { name: 'getLayerCount', input: {}, route: 'discovery' },
];

test('invokes the exact frozen 53-row routing matrix at its designated boundary', async () => {
  assert.deepEqual(routingRows.map((row) => row.name), [...FULL_LEGACY_TOOL_NAMES]);
  assert.equal(routingRows.length, 53);

  for (const row of routingRows) {
    const fake = new FakeMap();
    const tools = createMapLibreStyleTools({
      getMap: () => fake.asMap(), imageLoader,
      getState: () => ({ editor: 'outer-state' }),
    });
    const results = row.invoke === undefined
      ? [await executeTool(tools[row.name], row.input)]
      : await row.invoke(tools as Record<string, unknown>, fake);
    for (const result of results) {
      assert.equal(result.success, true, row.name + ': ' + String(result.message));
      assert.equal(typeof result.message, 'string', row.name);
      assert.deepEqual(result.style, { editor: 'outer-state' }, row.name);
    }
    if (row.route === 'document') {
      assert.equal(fake.setStyleCalls.length, 1, row.name);
    } else if (row.route === 'mixed') {
      assert.equal(fake.setStyleCalls.length, 1, row.name);
      assert.equal(fake.runtimeCalls.includes('updateData'), true, row.name);
    } else {
      assert.equal(fake.setStyleCalls.length, 0, row.name);
    }
    if (row.route === 'runtime') {
      assert.equal(fake.runtimeCalls.length > 0, true, row.name);
    }
  }
});

test('every document-applying legacy handler preserves pre-operation and unavailable authority', async () => {
  const documentRows = routingRows.filter((row) => row.route === 'document');
  const setDataRow: RoutingRow = {
    name: 'updateGeoJsonSourceData',
    input: {
      sourceId: 'points', method: 'setData',
      dataJson: '{"type":"FeatureCollection","features":[{"type":"Feature","id":1,"geometry":{"type":"Point","coordinates":[1,2]},"properties":{}}]}',
    },
    route: 'document',
  };
  const rows = [...documentRows, setDataRow];
  const outer = { application: 'outer-state' };

  for (const row of rows) {
    const stale = new AuthorityFailureMap();
    const staleResult = await executeTool(createMapLibreStyleTools({
      getMap: () => stale.asMap(), getState: () => outer, imageLoader,
    })[row.name], row.input);
    assert.equal(staleResult.success, false, row.name + ':pre-operation');
    assert.strictEqual(staleResult.style, outer, row.name + ':outer');
    const staleData = staleResult.data as Record<string, unknown>;
    assert.equal(staleData.styleAuthority, 'pre-operation', row.name);
    assert.equal(staleData.baselineOnly, true, row.name);
    assert.equal(Object.hasOwn(staleData, 'style'), true, row.name);

    const unavailable = new UnavailableDuringApplyMap(
      row.name === 'setStyleJsonOrUrl' ? 0 : 1,
    );
    const unavailableResult = await executeTool(createMapLibreStyleTools({
      getMap: () => unavailable.asMap(), getState: () => outer, imageLoader,
    })[row.name], row.input);
    assert.equal(unavailableResult.success, false, row.name + ':unavailable');
    assert.strictEqual(unavailableResult.style, outer, row.name + ':outer');
    const unavailableData = unavailableResult.data as Record<string, unknown>;
    assert.equal(unavailableData.styleAuthority, 'unavailable', row.name);
    assert.equal(Object.hasOwn(unavailableData, 'style'), false, row.name);
  }
});

test('registers every approved name once and binds all 53 designated strict named schemas', async () => {
  const fake = new FakeMap();
  const tools = createMapLibreStyleTools({ getMap: () => fake.asMap(), imageLoader });
  assert.deepEqual(Object.keys(tools), [
    ...FULL_LEGACY_TOOL_NAMES,
    ...STRUCTURED_TOOL_NAMES,
    ...QUERY_TOOL_NAMES,
  ]);
  assert.equal(new Set(Object.keys(tools)).size, Object.keys(tools).length);

  const diffTools = new Set([
    'patchLayerDefinition', 'replaceLayerDefinition',
    'patchSourceDefinition', 'replaceSourceDefinition',
    'setStyleJsonOrUrl', 'setStyleName', 'setStyleMetadata',
    'setStyleTransition', 'setStyleCameraDefaults',
  ]);
  for (const row of routingRows) {
    const schemaName = 'full' + row.name[0]!.toUpperCase() + row.name.slice(1)
      + 'InputSchema';
    const expectedSchema = (namedSchemas as Record<string, unknown>)[schemaName];
    const actualSchema = (tools[row.name] as { inputSchema?: unknown }).inputSchema;
    assert.ok(expectedSchema, schemaName);
    assert.strictEqual(actualSchema, expectedSchema, row.name);
    const schema = expectedSchema as {
      safeParse(value: unknown): { success: boolean; data?: Record<string, unknown> };
    };
    const baseInput = row.name === 'updateGeoJsonSourceData'
      ? { sourceId: 'points', dataJson: '{"remove":[1]}', method: 'updateData' }
      : row.input;
    assert.equal(schema.safeParse(baseInput).success, true, row.name);
    assert.equal(schema.safeParse({ ...baseInput, unknown: true }).success, false, row.name);
    const withDiff = schema.safeParse({ ...baseInput, diff: false });
    assert.equal(withDiff.success, diffTools.has(row.name), row.name + ':diff');
  }

  let getterCalls = 0;
  const hostile: Record<string, unknown> = {};
  Object.defineProperty(hostile, 'layerId', {
    enumerable: true,
    get() { getterCalls += 1; return 'roads'; },
  });
  const before = fake.setStyleCalls.length;
  const rejected = await executeTool(tools.removeLayer, hostile);
  assert.equal(rejected.success, false);
  assert.equal(getterCalls, 0);
  assert.equal(fake.setStyleCalls.length, before);
});

const diffCases = [
  ['patchLayerDefinition', { layerId: 'roads', patchJson: '{"metadata":{"x":1}}' }],
  ['replaceLayerDefinition', { layerId: 'roads', layerJson: '{"id":"roads","type":"line","source":"base","source-layer":"roads","paint":{"line-color":"#fff"}}' }],
  ['patchSourceDefinition', { sourceId: 'points', patchJson: '{"clusterRadius":90}' }],
  ['replaceSourceDefinition', { sourceId: 'points', sourceJson: '{"type":"geojson","data":{"type":"FeatureCollection","features":[]},"clusterRadius":90}' }],
  ['setStyleJsonOrUrl', { styleJsonOrUrl: wholeStyle }],
  ['setStyleName', { name: 'diff-name' }],
  ['setStyleMetadata', { metadataJson: '{"diff":true}' }],
  ['setStyleTransition', { transitionJson: '{"duration":120}' }],
  ['setStyleCameraDefaults', { zoom: 5 }],
] as const;

test('for all nine legacy diff tools omission is true and false preserves awaited semantics and rollback', async () => {
  for (const [name, input] of diffCases) {
    const successData: Record<string, unknown>[] = [];
    for (const mode of ['omitted', true, false] as const) {
      const fake = new FakeMap();
      const tools = createMapLibreStyleTools({ getMap: () => fake.asMap(), imageLoader });
      const result = await executeTool(tools[name], {
        ...input,
        ...(mode === 'omitted' ? {} : { diff: mode }),
      });
      assert.equal(result.success, true, name + ':' + String(mode));
      assert.equal(fake.setStyleCalls.length, 1, name + ':' + String(mode));
      assert.equal(fake.setStyleCalls[0]!.options?.diff, mode === false ? false : true);
      assert.equal(String(result.message).includes('diff=' + (mode === false ? 'false' : 'true')), true, name);
      successData.push(result.data as Record<string, unknown>);
    }
    assert.deepEqual(successData[0], successData[1], name + ':omitted/true');
    assert.deepEqual(successData[1], successData[2], name + ':true/false');

    for (const diff of [true, false]) {
      const fake = new FakeMap();
      fake.failCandidate = true;
      const tools = createMapLibreStyleTools({ getMap: () => fake.asMap(), imageLoader });
      const result = await executeTool(tools[name], { ...input, diff });
      assert.equal(result.success, false, name + ':rollback:' + diff);
      assert.equal(fake.setStyleCalls.length, 2, name + ':rollback:' + diff);
      assert.deepEqual(
        fake.setStyleCalls.map((call) => call.options?.diff),
        [diff, diff],
        name + ':rollback flag reuse',
      );
      const data = result.data as Record<string, unknown>;
      assert.equal(data.styleAuthority, 'current', name);
      assert.equal(data.rolledBack, true, name);
    }
  }
});

test('keeps outer getState distinct from authoritative data.style and serializes unavailable safely', async () => {
  const fake = new FakeMap();
  const tools = createMapLibreStyleTools({
    getMap: () => fake.asMap(),
    getState: () => ({ viewModel: 'not-the-map-style' }),
  });
  const current = await executeTool(tools.setStyleName, { name: 'authority' });
  assert.deepEqual(current.style, { viewModel: 'not-the-map-style' });
  const data = current.data as Record<string, unknown>;
  assert.equal(data.styleAuthority, 'current');
  assert.notDeepEqual(data.style, current.style);

  const unavailableMap = { getStyle: () => undefined } as unknown as MapLibreMap;
  const unavailableTools = createMapLibreStyleTools({
    getMap: () => unavailableMap,
    getState: () => ({ viewModel: 'still-outer' }),
  });
  const unavailable = await executeTool(unavailableTools.setStyleName, { name: 'x' });
  assert.equal(unavailable.success, false);
  assert.deepEqual(unavailable.style, { viewModel: 'still-outer' });
  assert.equal(unavailable.data, undefined);
});

test('full structured tools match compact registration and both feature queries stay bounded', async () => {
  const fake = new FakeMap();
  const tools = createMapLibreStyleTools({ getMap: () => fake.asMap(), imageLoader });
  for (const name of STRUCTURED_TOOL_NAMES) assert.ok(tools[name], name);

  const source = await executeTool(tools.querySourceFeatures, {
    sourceId: 'points', limit: 1, maxSerializedBytes: 1024,
  });
  assert.equal(source.success, true);
  assert.equal((source.data as { returned: number }).returned, 1);
  const rendered = await executeTool(tools.queryRenderedFeatures, {
    geometry: { kind: 'viewport' }, limit: 1, maxSerializedBytes: 1024,
  });
  assert.equal(rendered.success, true);
  assert.equal((rendered.data as { returned: number }).returned, 1);
  assert.deepEqual(fake.runtimeCalls.slice(-2), [
    'querySourceFeatures', 'queryRenderedFeatures',
  ]);
});

test('routing fixtures themselves are valid MapLibre Style documents', () => {
  assert.equal(validateStyleDocument(baseStyle()).ok, true);
  assert.equal(validateStyleDocument(JSON.parse(wholeStyle)).ok, true);
});
