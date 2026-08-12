import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { z } from 'zod';
import {
  createStyleToolError,
  isStyleToolError,
  validateStyleDocument,
} from '../core/index.js';
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

type LegacyDescriptionContract = {
  name: typeof FULL_LEGACY_TOOL_NAMES[number];
  description: string;
  fields: Record<string, string | null>;
};

const legacyDescriptionContracts: LegacyDescriptionContract[] = [
  {
    name: 'listAllLayers',
    description: 'List all loaded layers from the current MapLibre style.',
    fields: { limit: null },
  },
  {
    name: 'listAllSources',
    description: 'List all loaded sources from the current MapLibre style.',
    fields: { limit: null },
  },
  {
    name: 'inspectLayerStyle',
    description: 'Inspect a layer by id and return its paint/layout/filter definitions.',
    fields: { layerId: 'Layer id from listAllLayers output' },
  },
  {
    name: 'inspectSource',
    description: 'Inspect a source by id and return its full source definition.',
    fields: { sourceId: 'Source id from listAllSources output' },
  },
  {
    name: 'setLayerPaintProperty',
    description: 'Set a paint property for any existing layer. valueJson can be JSON literal (number/array/object) or plain string.',
    fields: {
      layerId: null,
      property: 'For example fill-color, line-width, text-color',
      valueJson: 'JSON literal or string. Example: "#ff0000", 1.2, ["interpolate", ...]',
    },
  },
  {
    name: 'setLayerLayoutProperty',
    description: 'Set a layout property for any existing layer. valueJson can be JSON literal or plain string.',
    fields: {
      layerId: null,
      property: 'For example visibility, text-size, line-cap',
      valueJson: 'JSON literal or string. Example: "visible", 14',
    },
  },
  {
    name: 'setLayerPaintPropertySmart',
    description: 'Set a paint property with layer-type guard. Example: line layer accepts line-* but rejects fill-*.',
    fields: { layerId: null, property: null, valueJson: null },
  },
  {
    name: 'setLayerLayoutPropertySmart',
    description: 'Set a layout property with layer-type guard. visibility is always allowed.',
    fields: { layerId: null, property: null, valueJson: null },
  },
  {
    name: 'batchSetLayerPaintPropertiesSmart',
    description: 'Batch set paint properties with layer-type guard. Rejects the whole request if any property is invalid.',
    fields: { layerId: null, propertiesJson: null },
  },
  {
    name: 'batchSetLayerLayoutPropertiesSmart',
    description: 'Batch set layout properties with layer-type guard. visibility is always allowed.',
    fields: { layerId: null, propertiesJson: null },
  },
  {
    name: 'batchSetLayerPaintProperties',
    description: 'Set multiple paint properties in one call. propertiesJson must be an object of paint-property -> value.',
    fields: {
      layerId: null,
      propertiesJson: 'JSON object, e.g. {"fill-color":"#fff","fill-opacity":0.6}',
    },
  },
  {
    name: 'batchSetLayerLayoutProperties',
    description: 'Set multiple layout properties in one call. propertiesJson must be an object of layout-property -> value.',
    fields: {
      layerId: null,
      propertiesJson: 'JSON object, e.g. {"text-size":14,"text-font":["Noto Sans Regular"]}',
    },
  },
  {
    name: 'clearLayerPaintProperty',
    description: 'Clear a paint property by setting it to null.',
    fields: { layerId: null, property: null },
  },
  {
    name: 'clearLayerLayoutProperty',
    description: 'Clear a layout property by setting it to null. Some layout properties may reject null.',
    fields: { layerId: null, property: null },
  },
  {
    name: 'setLayerFilter',
    description: 'Set the filter expression for a layer. Use JSON array expression, or null to clear filter.',
    fields: {
      layerId: null,
      filterJson: 'JSON filter expression or null. Example: ["==", ["get", "class"], "primary"]',
    },
  },
  {
    name: 'setLayerZoomRange',
    description: 'Set minzoom and maxzoom for a layer.',
    fields: { layerId: null, minzoom: null, maxzoom: null },
  },
  {
    name: 'setLayerVisibility',
    description: 'Set layer visibility to visible or none.',
    fields: { layerId: null, visibility: null },
  },
  {
    name: 'addLayer',
    description: 'Add a new style layer. layerJson must be a full layer object (id/type/source/...); optional beforeId controls z-order.',
    fields: { layerJson: 'Full JSON layer object', beforeId: null },
  },
  {
    name: 'moveLayer',
    description: 'Move an existing layer before another layer. Omit beforeId to move to top.',
    fields: { layerId: null, beforeId: null },
  },
  {
    name: 'removeLayer',
    description: 'Remove an existing layer by id.',
    fields: { layerId: null },
  },
  {
    name: 'patchLayerDefinition',
    description: 'Patch an existing layer definition (deep merge). Supports paint/layout/filter/metadata/minzoom/maxzoom/etc.',
    fields: { layerId: null, patchJson: 'JSON object patch', diff: null },
  },
  {
    name: 'replaceLayerDefinition',
    description: 'Replace an existing layer definition with layerJson, then apply via setStyle.',
    fields: { layerId: null, layerJson: 'Full JSON layer object', diff: null },
  },
  {
    name: 'addSource',
    description: 'Add a new source by id. sourceJson must be a valid source definition object.',
    fields: { sourceId: null, sourceJson: 'Full JSON source object' },
  },
  {
    name: 'removeSource',
    description: 'Remove a source by id. Source must not be referenced by any remaining layer.',
    fields: { sourceId: null },
  },
  {
    name: 'updateGeoJsonSourceData',
    description: 'Update data of a GeoJSON source via setData/updateData. dataJson can be URL string or inline GeoJSON object.',
    fields: { sourceId: null, dataJson: null, method: null },
  },
  {
    name: 'setGeoJsonClusterOptions',
    description: 'Set clustering options on an existing GeoJSON source via setClusterOptions.',
    fields: { sourceId: null, optionsJson: 'JSON object for GeoJSON cluster options' },
  },
  {
    name: 'setSourceTileLodParams',
    description: 'Adjust source tile LOD behavior for pitched views. If sourceId is omitted, applies to all sources.',
    fields: { maxZoomLevelsOnScreen: null, tileCountMaxMinRatio: null, sourceId: null },
  },
  {
    name: 'patchSourceDefinition',
    description: 'Patch an existing source definition by deep-merging patchJson into style.sources[sourceId], then apply via setStyle.',
    fields: { sourceId: null, patchJson: 'JSON object patch', diff: null },
  },
  {
    name: 'replaceSourceDefinition',
    description: 'Replace an existing source definition with sourceJson, then apply via setStyle.',
    fields: { sourceId: null, sourceJson: 'Full JSON source object', diff: null },
  },
  {
    name: 'setStyleJsonOrUrl',
    description: 'Set a full map style via URL string or full style JSON object. diff=true applies style diff when possible.',
    fields: {
      styleJsonOrUrl: 'Either style URL, or full style JSON object string',
      diff: null,
    },
  },
  {
    name: 'inspectRootStyle',
    description: 'Inspect root-level style fields such as name, metadata, transition, camera defaults, sprite, glyphs, projection, terrain, light and sky.',
    fields: {},
  },
  {
    name: 'setStyleName',
    description: 'Set root style name via style diff update.',
    fields: { name: null, diff: null },
  },
  {
    name: 'setStyleMetadata',
    description: 'Set root style metadata object, or null to clear metadata.',
    fields: { metadataJson: 'JSON object or null', diff: null },
  },
  {
    name: 'setStyleTransition',
    description: 'Set root transition object, or null to clear transition defaults.',
    fields: { transitionJson: 'JSON object or null', diff: null },
  },
  {
    name: 'setStyleCameraDefaults',
    description: 'Set root camera defaults (center/zoom/bearing/pitch/roll/centerAltitude) in the style JSON.',
    fields: {
      centerJson: 'JSON array [lng, lat]', zoom: null, bearing: null, pitch: null,
      roll: null, centerAltitude: null, diff: null,
    },
  },
  {
    name: 'validateStyleJson',
    description: 'Validate a full style JSON object against MapLibre style spec without applying it to the map.',
    fields: { styleJson: 'Full style JSON object string' },
  },
  {
    name: 'validateCurrentMapStyle',
    description: 'Validate the currently loaded map style against MapLibre style spec.',
    fields: {},
  },
  {
    name: 'setMapLight',
    description: 'Set root light specification using a full JSON object.',
    fields: { lightJson: 'JSON object for light spec' },
  },
  {
    name: 'setMapSky',
    description: 'Set root sky specification using JSON object. Use null to clear sky where supported.',
    fields: { skyJson: 'JSON object for sky spec, or null' },
  },
  {
    name: 'setMapProjection',
    description: 'Set root projection specification.',
    fields: { projectionJson: 'JSON projection object' },
  },
  {
    name: 'setMapTerrain',
    description: 'Set root terrain specification using JSON object. Use null to disable terrain.',
    fields: { terrainJson: 'JSON object for terrain spec, or null' },
  },
  {
    name: 'setMapGlyphs',
    description: 'Set root glyphs URL. Use null to unset glyphs.',
    fields: { glyphsUrlJson: 'JSON string URL or null' },
  },
  {
    name: 'setMapSprite',
    description: 'Set root sprite URL. Use null to unset sprite.',
    fields: { spriteUrlJson: 'JSON string URL or null' },
  },
  {
    name: 'listSprites',
    description: 'List all sprite definitions currently set in style root.',
    fields: {},
  },
  {
    name: 'addSprite',
    description: 'Add a sprite definition to the style root. Use overwrite=true to replace an existing sprite id.',
    fields: { spriteId: null, url: null, overwrite: null },
  },
  {
    name: 'removeSprite',
    description: 'Remove a sprite definition by sprite id.',
    fields: { spriteId: null },
  },
  {
    name: 'setFeatureState',
    description: 'Set feature-state for a specific feature identifier target. targetJson must include source/sourceLayer/id as needed.',
    fields: {
      targetJson: 'Feature identifier JSON object',
      stateJson: 'State JSON object to merge',
    },
  },
  {
    name: 'removeFeatureState',
    description: 'Remove feature-state by feature target; optionally provide a key to remove only one state key.',
    fields: { targetJson: 'Feature identifier JSON object', key: null },
  },
  {
    name: 'setGlobalStateProperty',
    description: 'Set root global state property for use in global-state expressions.',
    fields: { propertyName: null, valueJson: 'JSON value for global state' },
  },
  {
    name: 'listImages',
    description: 'List all currently available style image IDs.',
    fields: { limit: null },
  },
  {
    name: 'addImageFromUrl',
    description: 'Load an image from URL and add it to style sprite images by imageId. If overwrite=true and image exists, update it.',
    fields: { imageId: null, url: null, overwrite: null },
  },
  {
    name: 'removeImage',
    description: 'Remove a style image by id.',
    fields: { imageId: null },
  },
  {
    name: 'getLayerCount',
    description: 'Return number of layers currently loaded in map style.',
    fields: {},
  },
];

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

test('preserves the exact frozen legacy descriptions and schema field guidance for all 53 tools', () => {
  assert.deepEqual(
    legacyDescriptionContracts.map((contract) => contract.name),
    [...FULL_LEGACY_TOOL_NAMES],
  );
  assert.equal(legacyDescriptionContracts.length, 53);
  const tools = createMapLibreStyleTools({
    getMap: () => new FakeMap().asMap(),
    imageLoader,
  });

  for (const contract of legacyDescriptionContracts) {
    const registered = tools[contract.name] as unknown as {
      description?: string;
      inputSchema: z.ZodType;
    };
    assert.equal(registered.description, contract.description, contract.name);
    const jsonSchema = z.toJSONSchema(registered.inputSchema) as {
      properties?: Record<string, { description?: string }>;
    };
    const fieldDescriptions = Object.fromEntries(
      Object.entries(jsonSchema.properties ?? {}).map(([name, schema]) => [
        name,
        schema.description ?? null,
      ]),
    );
    assert.deepEqual(fieldDescriptions, contract.fields, contract.name);
  }
});

test('preserves exact friendly failures for ordinary smart and batch paint/layout tools', async () => {
  const cases = [
    {
      name: 'setLayerPaintProperty',
      input: { layerId: 'roads', property: 'line-color', valueJson: '42' },
      message: 'Failed to set paint property roads.line-color: Invalid paint properties for line layer "roads": line-color',
    },
    {
      name: 'setLayerLayoutProperty',
      input: { layerId: 'roads', property: 'line-cap', valueJson: '42' },
      message: 'Failed to set layout property roads.line-cap: Invalid layout properties for line layer "roads": line-cap',
    },
    {
      name: 'setLayerPaintPropertySmart',
      input: { layerId: 'roads', property: 'line-color', valueJson: '42' },
      message: 'Failed to set paint property roads.line-color: Invalid paint properties for line layer "roads": line-color',
    },
    {
      name: 'setLayerLayoutPropertySmart',
      input: { layerId: 'roads', property: 'line-cap', valueJson: '42' },
      message: 'Failed to set layout property roads.line-cap: Invalid layout properties for line layer "roads": line-cap',
    },
    {
      name: 'batchSetLayerPaintPropertiesSmart',
      input: { layerId: 'roads', propertiesJson: '{"line-color":42}' },
      message: 'Failed to batch set paint properties for roads: Invalid paint properties for line layer "roads": line-color',
    },
    {
      name: 'batchSetLayerLayoutPropertiesSmart',
      input: { layerId: 'roads', propertiesJson: '{"line-cap":42}' },
      message: 'Failed to batch set layout properties for roads: Invalid layout properties for line layer "roads": line-cap',
    },
    {
      name: 'batchSetLayerPaintProperties',
      input: { layerId: 'roads', propertiesJson: '{"line-color":42}' },
      message: 'Failed to batch set paint properties for roads: Invalid paint properties for line layer "roads": line-color',
    },
    {
      name: 'batchSetLayerLayoutProperties',
      input: { layerId: 'roads', propertiesJson: '{"line-cap":42}' },
      message: 'Failed to batch set layout properties for roads: Invalid layout properties for line layer "roads": line-cap',
    },
  ] as const;

  for (const row of cases) {
    const fake = new FakeMap();
    const tools = createMapLibreStyleTools({ getMap: () => fake.asMap(), imageLoader });
    const result = await executeTool(tools[row.name], row.input);
    assert.equal(result.success, false, row.name);
    assert.equal(result.message, row.message, row.name);
    assert.equal(isStyleToolError(result.error), true, row.name);
    assert.equal((result.error as { code?: unknown }).code, 'STYLE_INVALID', row.name);
  }
});

test('preserves exact source root and full-style apply exception wrappers', async () => {
  const cases = [
    {
      name: 'addSource',
      input: {
        sourceId: 'added',
        sourceJson: '{"type":"geojson","data":{"type":"FeatureCollection","features":[]}}',
      },
      message: 'Failed to add source "added": Map style application failed.',
    },
    {
      name: 'setStyleName',
      input: { name: 'rejected' },
      message: 'Failed to set style name: Map style application failed.',
    },
    {
      name: 'setStyleJsonOrUrl',
      input: { styleJsonOrUrl: wholeStyle },
      message: 'Failed to set style: Map style application failed.',
    },
  ] as const;

  for (const row of cases) {
    const fake = new FakeMap();
    fake.failCandidate = true;
    const tools = createMapLibreStyleTools({ getMap: () => fake.asMap(), imageLoader });
    const result = await executeTool(tools[row.name], row.input);
    assert.equal(result.success, false, row.name);
    assert.equal(result.message, row.message, row.name);
    assert.equal(isStyleToolError(result.error), true, row.name);
    assert.equal(fake.setStyleCalls.length, 2, row.name);
  }
});

test('preserves the exact legacy list-sprites exception message', async () => {
  const fake = new FakeMap();
  fake.getSprite = () => { throw new Error('boom'); };
  const tools = createMapLibreStyleTools({ getMap: () => fake.asMap(), imageLoader });

  const result = await executeTool(tools.listSprites, {});

  assert.equal(result.success, false);
  assert.equal(result.message, 'Failed to list sprites: boom');
  assert.deepEqual(result.error, {
    code: 'INTERNAL',
    message: 'Failed to list sprites: boom',
  });
  assert.equal(isStyleToolError(result.error), true);
});

test('preserves the exact structured list-images exception contract', async () => {
  const fake = new FakeMap();
  const cause = createStyleToolError(
    'IO_ERROR',
    'boom',
    '/images',
    { source: 'map' },
  );
  fake.listImages = () => { throw cause; };
  const tools = createMapLibreStyleTools({ getMap: () => fake.asMap(), imageLoader });

  const result = await executeTool(tools.listImages, {});

  assert.equal(result.success, false);
  assert.equal(result.message, 'Failed to list images: boom');
  assert.deepEqual(result.error, {
    code: 'IO_ERROR',
    message: 'Failed to list images: boom',
    path: '/images',
    details: { source: 'map' },
  });
  assert.notStrictEqual(result.error, cause);
  assert.equal(isStyleToolError(result.error), true);
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
