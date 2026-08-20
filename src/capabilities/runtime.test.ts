import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type {
  CapabilityResult,
  FeatureQueryProjection,
  MapCommandReceipt,
  QueryMapFeaturesInput,
  RunMapCommandInput,
} from './contracts.js';
import { executeQueryMapFeatures, executeRunMapCommand } from './runtime.js';
import { MapStyleAuthority } from './map-authority.js';
import type { RuntimeImageLoader } from '../adapters/maplibre/index.js';

const authorityFor = (options: {
  getMap: () => MapLibreMap | null;
  imageLoader?: RuntimeImageLoader;
}) => () => {
  const map = options.getMap();
  return map === null ? null : new MapStyleAuthority(map, {
    ...(options.imageLoader === undefined ? {} : { imageLoader: options.imageLoader }),
  });
};
const createRunMapCommandTool = (options: {
  getMap: () => MapLibreMap | null;
  imageLoader?: RuntimeImageLoader;
}) => ({
  execute: (input: unknown, execution?: { abortSignal?: AbortSignal }) =>
    executeRunMapCommand(authorityFor(options), input, execution),
});
const createQueryMapFeaturesTool = (options: { getMap: () => MapLibreMap | null }) => ({
  execute: (input: unknown) => executeQueryMapFeatures(authorityFor(options), input),
});

class FakeMap {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  readonly images = new Set<string>();
  readonly sprites: Array<{ id: string; url: string }> = [];
  source: unknown = { type: 'geojson', updateData: async () => {} };
  sourceFeatures: unknown[] = [];
  renderedFeatures: unknown[] = [];
  failMethod?: string;

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
    if (this.failMethod === method) throw new Error(`${method} failed`);
  }

  getSource(sourceId: string): unknown { this.record('getSource', [sourceId]); return this.source; }
  setSourceTileLodParams(...args: unknown[]): void { this.record('setSourceTileLodParams', args); }
  setFeatureState(...args: unknown[]): void { this.record('setFeatureState', args); }
  removeFeatureState(...args: unknown[]): void { this.record('removeFeatureState', args); }
  setGlobalStateProperty(...args: unknown[]): void { this.record('setGlobalStateProperty', args); }
  listImages(): string[] { this.record('listImages', []); return [...this.images]; }
  hasImage(imageId: string): boolean { this.record('hasImage', [imageId]); return this.images.has(imageId); }
  addImage(...args: unknown[]): void { this.record('addImage', args); this.images.add(args[0] as string); }
  updateImage(...args: unknown[]): void { this.record('updateImage', args); }
  removeImage(imageId: string): void { this.record('removeImage', [imageId]); this.images.delete(imageId); }
  getSprite(): Array<{ id: string; url: string }> { this.record('getSprite', []); return this.sprites; }
  addSprite(spriteId: string, url: string): void { this.record('addSprite', [spriteId, url]); this.sprites.push({ id: spriteId, url }); }
  removeSprite(spriteId: string): void { this.record('removeSprite', [spriteId]); const index = this.sprites.findIndex((sprite) => sprite.id === spriteId); if (index >= 0) this.sprites.splice(index, 1); }
  querySourceFeatures(...args: unknown[]): unknown[] { this.record('querySourceFeatures', args); return this.sourceFeatures; }
  queryRenderedFeatures(...args: unknown[]): unknown[] { this.record('queryRenderedFeatures', args); return this.renderedFeatures; }
  asMap(): MapLibreMap { return this as unknown as MapLibreMap; }
}

const runtimeCases: ReadonlyArray<[RunMapCommandInput, string]> = [
  [{ action: 'updateGeoJsonData', sourceId: 'points', diff: { remove: [1] } }, 'getSource'],
  [{ action: 'setSourceTileLodParams', maxZoomLevelsOnScreen: 1, tileCountMaxMinRatio: 1 }, 'setSourceTileLodParams'],
  [{ action: 'setFeatureState', target: { source: 'base', id: 1 }, state: { selected: true } }, 'setFeatureState'],
  [{ action: 'removeFeatureState', target: { source: 'base', id: 1 }, key: 'selected' }, 'removeFeatureState'],
  [{ action: 'setGlobalState', propertyName: 'theme', value: 'night' }, 'setGlobalStateProperty'],
  [{ action: 'listImages', limit: 100 }, 'listImages'],
  [{ action: 'addImageFromUrl', imageId: 'pin', url: 'https://example.test/pin.png' }, 'addImage'],
  [{ action: 'removeImage', imageId: 'pin' }, 'removeImage'],
  [{ action: 'listSprites', limit: 100 }, 'getSprite'],
  [{ action: 'addSprite', spriteId: 'sprite', url: 'https://example.test/sprite.json' }, 'addSprite'],
  [{ action: 'removeSprite', spriteId: 'sprite' }, 'removeSprite'],
];

const imageLoader = { load: async () => ({ width: 1, height: 1, data: new Uint8Array(4) }) };
const commandResult = (result: CapabilityResult<MapCommandReceipt>): MapCommandReceipt => {
  assert.equal(result.success, true, result.success ? '' : `${result.error.code}: ${result.error.message}`);
  if (!result.success) throw new Error('unreachable');
  return result.data;
};
const queryResult = (result: CapabilityResult<FeatureQueryProjection>): FeatureQueryProjection => {
  assert.equal(result.success, true, result.success ? '' : `${result.error.code}: ${result.error.message}`);
  if (!result.success) throw new Error('unreachable');
  return result.data;
};

function seedForSuccess(map: FakeMap, input: RunMapCommandInput): void {
  if (input.action === 'removeImage') map.images.add(input.imageId);
  if (input.action === 'removeSprite') map.sprites.push({ id: input.spriteId, url: 'https://example.test/sprite.json' });
}

describe('runtime AI tools', () => {
  it('routes every runtime action and keeps runtime errors authentic', async () => {
    for (const [input, method] of runtimeCases) {
      const map = new FakeMap();
      seedForSuccess(map, input);
      const tool = createRunMapCommandTool({ getMap: () => map.asMap(), imageLoader });
      const success = commandResult(await tool.execute(input));
      assert.equal(success.action, input.action);
      assert.equal(success.kind, input.action === 'listImages' || input.action === 'listSprites' ? 'list' : 'acknowledgement');
      assert.equal(map.calls.some((call) => call.method === method), true, input.action);

      const failureMap = new FakeMap();
      seedForSuccess(failureMap, input);
      failureMap.failMethod = method;
      const failure = await createRunMapCommandTool({ getMap: () => failureMap.asMap(), imageLoader }).execute(input);
      assert.equal(failure.success, false, input.action);
      if (!failure.success) {
        assert.equal(typeof failure.error.code, 'string');
        assert.equal(Object.hasOwn(failure, 'data'), false);
      }
    }
  });

  it('preserves adapter list truncation in both receipt boundaries', async () => {
    const map = new FakeMap();
    map.images.add('first');
    map.images.add('second');
    const receipt = commandResult(await createRunMapCommandTool({
      getMap: () => map.asMap(),
      imageLoader,
    }).execute({ action: 'listImages', limit: 1 }));
    assert.equal(receipt.truncated, true);
    assert.deepEqual(receipt.warnings, [{ code: 'COMPACT_OUTPUT_TRUNCATED', message: 'Output was truncated to stay within response limits.' }]);
    const list = receipt.result as { truncated: boolean; warnings: unknown[] };
    assert.equal(list.truncated, true);
    assert.deepEqual(list.warnings, [{ code: 'COMPACT_OUTPUT_TRUNCATED', message: 'Output was truncated to stay within response limits.' }]);
  });

  it('validates source query before reading map or context', async () => {
    let maps = 0;
    let contexts = 0;
    const result = await createQueryMapFeaturesTool({
      getMap: () => { maps += 1; return new FakeMap().asMap(); },
      getContext: () => { contexts += 1; return { activeSourceId: 'leak' }; },
    } as never).execute({ target: 'source' } as unknown as QueryMapFeaturesInput);
    assert.equal(result.success, false);
    assert.equal(maps, 0);
    assert.equal(contexts, 0);
  });

  it('routes source and rendered queries in order with bounded projections', async () => {
    const map = new FakeMap();
    const feature = { type: 'Feature', id: 1, geometry: { type: 'Point', coordinates: [0, 0] }, properties: { keep: true, secret: 'never-returned' } };
    map.sourceFeatures = Array.from({ length: 101 }, () => feature);
    const source = queryResult(await createQueryMapFeaturesTool({ getMap: () => map.asMap() }).execute({
      target: 'source', sourceId: 'base', filter: ['==', ['get', 'kind'], 'park'], propertyAllowlist: ['keep'], limit: 100,
    }));
    assert.equal(source.returned, 100);
    assert.equal(source.truncated, true);
    assert.deepEqual(source.features[0]?.properties, { keep: true });
    assert.deepEqual(map.calls[0], { method: 'querySourceFeatures', args: ['base', { filter: ['==', ['get', 'kind'], 'park'] }] });

    const geometries: NonNullable<Extract<QueryMapFeaturesInput, { target: 'rendered' }>['geometry']>[] = [
      { kind: 'viewport' },
      { kind: 'point', point: [1, 2] },
      { kind: 'bounds', bounds: [[1, 2], [3, 4]] },
    ];
    for (const geometry of geometries) {
      map.calls.length = 0;
      map.renderedFeatures = [feature];
      const rendered = queryResult(await createQueryMapFeaturesTool({ getMap: () => map.asMap() }).execute({ target: 'rendered', geometry }));
      assert.equal(rendered.returned, 1);
      assert.equal(map.calls[0]?.method, 'queryRenderedFeatures');
    }
  });

  it('rejects query geometry, filters, and allowlists before map access', async () => {
    let maps = 0;
    const tool = createQueryMapFeaturesTool({ getMap: () => { maps += 1; return new FakeMap().asMap(); } });
    for (const input of [
      { target: 'rendered', geometry: { kind: 'point', point: [1, Number.NaN] } },
      { target: 'rendered', filter: '[]' },
      { target: 'rendered', propertyAllowlist: ['allowed', 'allowed'] },
    ]) {
      const result = await tool.execute(input as unknown as QueryMapFeaturesInput);
      assert.equal(result.success, false);
    }
    assert.equal(maps, 0);
  });

  it('honors byte caps without leaking an oversized feature', async () => {
    const map = new FakeMap();
    map.renderedFeatures = [{
      type: 'Feature',
      geometry: null,
      properties: { huge: 'x'.repeat(300) },
    }];
    const maxSerializedBytes = 512;
    const response = await createQueryMapFeaturesTool({ getMap: () => map.asMap() }).execute({
      target: 'rendered', maxSerializedBytes,
    });
    const result = queryResult(response);
    assert.equal(result.returned, 0);
    assert.equal(result.truncated, true);
    assert.equal(result.features.length, 0);
    assert.ok(Buffer.byteLength(JSON.stringify(response), 'utf8') <= maxSerializedBytes);
  });

  it('returns a bounded invalid-input failure for a valid sub-envelope byte cap', async () => {
    const map = new FakeMap();
    const response = await createQueryMapFeaturesTool({ getMap: () => map.asMap() }).execute({
      target: 'rendered',
      maxSerializedBytes: 1,
    });
    assert.equal(response.success, false);
    if (!response.success) {
      assert.equal(response.error.code, 'INVALID_INPUT');
      assert.equal(response.error.path, '/maxSerializedBytes');
    }
  });
  it('forwards SDK abort signals only to URL image commands', async () => {
    const map = new FakeMap();
    const controller = new AbortController();
    controller.abort();
    let loaderCalled = false;
    const tool = createRunMapCommandTool({
      getMap: () => map.asMap(),
      imageLoader: {
        load: async () => {
          loaderCalled = true;
          return { width: 1, height: 1, data: new Uint8Array(4) };
        },
      },
    });
    const execute = tool.execute as unknown as (
      input: RunMapCommandInput,
      options: { abortSignal: AbortSignal },
    ) => Promise<CapabilityResult<MapCommandReceipt>>;
    const result = await execute(
      { action: 'addImageFromUrl', imageId: 'pin', url: 'https://example.test/pin.png' },
      { abortSignal: controller.signal },
    );
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, 'TIMEOUT');
    assert.equal(loaderCalled, false);
    assert.equal(map.calls.some((call) => call.method === 'addImage'), false);
  });
});

