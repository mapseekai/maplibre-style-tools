import assert from 'node:assert/strict';
import test from 'node:test';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';

import { hashStyle } from '../adapters/maplibre/index.js';
import {
  DEFAULT_MAX_STYLE_BYTES,
  isStyleToolError,
  validateStyleDocument,
  type StyleDocument,
  type StyleToolError,
} from '../core/index.js';
import type { BridgeCapability, BridgeCommand } from './protocol.js';
import {
  createBrowserMapRuntime,
  type BrowserRuntimeOptions,
} from './browser-runtime.js';

type EventName = 'style.load' | 'error';
type Listener = (event: { type: EventName; error?: Error }) => void;
type RuntimeCall = { method: string; args: unknown[] };

class FakeMap {
  style: StyleSpecification;
  loaded = true;
  setStyleCalls = 0;
  setGlobalStateCalls = 0;
  addImageCalls = 0;
  sourceFeatures: unknown[] = [];
  readonly images = new Map<string, unknown>();
  readonly runtimeCalls: RuntimeCall[] = [];
  readonly sprites = new Map<string, string>();
  readonly styleUrls = new Map<string, StyleSpecification>();
  readonly synchronousCalls = new Map<string, number>();
  beforeSynchronousCommand: (() => void) | undefined;
  private readonly listeners = new Map<EventName, Set<Listener>>();
  private readonly geoJsonSource = {
    type: 'geojson',
    updateData: async (diff: unknown): Promise<void> => {
      this.runtimeCalls.push({ method: 'updateData', args: [diff] });
    },
  };

  constructor(style: StyleSpecification) {
    this.style = structuredClone(style);
  }

  on(type: EventName, listener: Listener): { unsubscribe(): void } {
    let listeners = this.listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
    return { unsubscribe: () => listeners!.delete(listener) };
  }

  off(type: EventName, listener: Listener): this {
    this.listeners.get(type)?.delete(listener);
    return this;
  }

  emit(type: EventName, error?: Error): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type, error });
  }

  getStyle(): StyleSpecification {
    return this.style;
  }

  isStyleLoaded(): boolean {
    return this.loaded;
  }

  setStyle(style: StyleSpecification | string): this {
    this.setStyleCalls += 1;
    if (typeof style === 'string') {
      const resolved = this.styleUrls.get(style);
      assert.notEqual(resolved, undefined, `missing fake Style URL: ${style}`);
      this.style = structuredClone(resolved!);
    } else {
      this.style = structuredClone(style);
    }
    this.loaded = true;
    queueMicrotask(() => this.emit('style.load'));
    return this;
  }

  private recordSynchronousCall(name: string): void {
    this.synchronousCalls.set(name, (this.synchronousCalls.get(name) ?? 0) + 1);
    this.beforeSynchronousCommand?.();
  }

  clearRuntimeCalls(): void {
    this.runtimeCalls.length = 0;
  }

  getSource(sourceId: string): unknown {
    this.runtimeCalls.push({ method: 'getSource', args: [sourceId] });
    return sourceId === 'points' || sourceId === 'terrain' ? this.geoJsonSource : undefined;
  }

  setSourceTileLodParams(
    maxZoomLevelsOnScreen: number,
    tileCountMaxMinRatio: number,
    sourceId?: string,
  ): void {
    this.runtimeCalls.push({
      method: 'setSourceTileLodParams',
      args: [maxZoomLevelsOnScreen, tileCountMaxMinRatio, sourceId],
    });
  }

  getSprite(): Array<{ id: string; url: string }> {
    this.runtimeCalls.push({ method: 'listSprites', args: [] });
    return [...this.sprites.entries()].map(([id, url]) => ({ id, url }));
  }

  addSprite(spriteId: string, url: string): void {
    this.runtimeCalls.push({ method: 'addSprite', args: [spriteId, url] });
    this.sprites.set(spriteId, url);
  }

  removeSprite(spriteId: string): void {
    this.runtimeCalls.push({ method: 'removeSprite', args: [spriteId] });
    this.sprites.delete(spriteId);
  }

  querySourceFeatures(): unknown[] {
    this.recordSynchronousCall('querySourceFeatures');
    return this.sourceFeatures;
  }

  queryRenderedFeatures(): unknown[] {
    this.recordSynchronousCall('queryRenderedFeatures');
    return this.sourceFeatures;
  }

  setFeatureState(): void {}
  removeFeatureState(): void {}

  setGlobalStateProperty(): void {
    this.recordSynchronousCall('setGlobalState');
    this.setGlobalStateCalls += 1;
  }

  listImages(): string[] {
    this.recordSynchronousCall('listImages');
    return [...this.images.keys()];
  }

  hasImage(id: string): boolean {
    return this.images.has(id);
  }

  addImage(id: string, image: unknown): void {
    this.recordSynchronousCall('addImage');
    this.addImageCalls += 1;
    this.images.set(id, image);
  }

  updateImage(id: string, image: unknown): void {
    this.addImageCalls += 1;
    this.images.set(id, image);
  }

  removeImage(id: string): void {
    this.images.delete(id);
  }

  external(style: StyleSpecification): void {
    this.style = structuredClone(style);
  }

  asMap(): MapLibreMap {
    return this as unknown as MapLibreMap;
  }
}

const rawStyle = (color = '#000000'): StyleSpecification => ({
  version: 8,
  sources: {
    base: { type: 'vector', tiles: ['https://tiles.example/{z}/{x}/{y}.pbf'] },
  },
  layers: [{
    id: 'roads',
    type: 'line',
    source: 'base',
    'source-layer': 'roads',
    paint: { 'line-color': color },
  }],
});

const strictStyle = (color = '#000000'): StyleDocument => {
  const validated = validateStyleDocument(rawStyle(color));
  assert.equal(validated.ok, true);
  if (!validated.ok) assert.fail('fixture must be valid');
  return validated.style;
};

const allCapabilities: BridgeCapability[] = [
  'style.read',
  'style.write',
  'features.query',
  'runtime.state',
  'assets.write',
  'network.load',
];

const runtimeOptions = (
  overrides: Partial<BrowserRuntimeOptions> = {},
): BrowserRuntimeOptions => ({
  capabilities: allCapabilities,
  resourcePolicy: {
    baseUrl: 'https://images.example/app/',
    allowedResourceOrigins: ['https://images.example', 'https://tiles.example'],
  },
  ...overrides,
});

const applyCommand = async (
  expectedRevision: number,
  expectedStyleHash: string,
  color: string,
): Promise<BridgeCommand> => ({
  type: 'applyTransaction',
  expectedRevision,
  expectedStyleHash,
  transaction: {
    operations: [{
      op: 'setLayerProperties',
      layerId: 'roads',
      paint: { 'line-color': color },
    }],
    validate: true,
  },
});

const applyStyleCommand = (
  baseline: { revision: number; styleHash: string },
  source: Extract<BridgeCommand, { type: 'applyStyleDocument' }>['source'],
): Extract<BridgeCommand, { type: 'applyStyleDocument' }> => ({
  type: 'applyStyleDocument',
  expectedRevision: baseline.revision,
  expectedStyleHash: baseline.styleHash,
  source,
  diff: true,
});

const hasCode = (code: StyleToolError['code']) => (error: unknown): boolean =>
  isStyleToolError(error) && error.code === code;

const rawFeature = (id: number): Record<string, unknown> => ({
  type: 'Feature',
  id,
  geometry: { type: 'Point', coordinates: [id, id + 1] },
  properties: { name: `road-${id}`, secret: 'omit' },
  source: 'roads',
  sourceLayer: 'transportation',
  layer: { id: 'road-layer', type: 'line' },
});

test('initializes from normalized authority and records external changes once', async () => {
  const map = new FakeMap(rawStyle());
  const external: number[] = [];
  const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions({
    onExternalStyleChange: (snapshot) => external.push(snapshot.revision),
  }));
  assert.deepEqual(runtime.snapshot(), {
    revision: 0,
    styleHash: await hashStyle(strictStyle()),
    style: strictStyle(),
  });
  map.external(rawStyle('#ff0000'));
  assert.equal((await runtime.noteExternalStyle()).revision, 1);
  assert.equal((await runtime.noteExternalStyle()).revision, 1);
  assert.deepEqual(external, [1]);
});

test('rechecks revision and canonical hash only when a queued mutation dequeues', async () => {
  const map = new FakeMap(rawStyle());
  let release: ((image: { width: number; height: number; data: Uint8Array }) => void) | undefined;
  let markLoaderStarted: (() => void) | undefined;
  const loaderStarted = new Promise<void>((resolve) => { markLoaderStarted = resolve; });
  const imageLoader = {
    load: () => new Promise<{ width: number; height: number; data: Uint8Array }>((done) => {
      release = done;
      markLoaderStarted?.();
    }),
  };
  const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions({ imageLoader }));
  const hash0 = runtime.snapshot().styleHash;
  const blocker = runtime.execute({
    type: 'addImage', imageId: 'marker', image: { kind: 'url', url: './marker.png' },
  });
  const mutation = runtime.execute(await applyCommand(0, hash0, '#ff0000'));
  await loaderStarted;
  map.external(rawStyle('#00ff00'));
  release?.({ width: 1, height: 1, data: new Uint8Array(4) });
  await blocker;
  await assert.rejects(mutation, hasCode('REVISION_CONFLICT'));
  assert.equal(map.setStyleCalls, 0);
  assert.equal(runtime.snapshot().revision, 1);
});

test('applies once, advances revision after completion, and preserves no-op revision', async () => {
  const map = new FakeMap(rawStyle());
  const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions());
  const baseline = runtime.snapshot();
  const applied = await runtime.execute(await applyCommand(0, baseline.styleHash, '#ff0000'));
  assert.equal(applied.type, 'transaction');
  if (applied.type !== 'transaction') assert.fail('expected transaction');
  assert.equal(applied.applied, true);
  assert.equal(applied.revision, 1);
  assert.equal(map.setStyleCalls, 1);
  const noOp = await runtime.execute(await applyCommand(1, applied.styleHash, '#ff0000'));
  assert.equal(noOp.type === 'transaction' && noOp.noOp, true);
  assert.equal(noOp.type === 'transaction' && noOp.revision, 1);
  assert.equal(map.setStyleCalls, 1);
});

test('applies a complete inline Style document through the transaction result path', async () => {
  const map = new FakeMap(rawStyle());
  const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions());
  const baseline = runtime.snapshot();

  const result = await runtime.execute(applyStyleCommand(baseline, {
    kind: 'style',
    style: strictStyle('#ff0000'),
  }));

  assert.equal(result.type, 'transaction');
  assert.equal(result.applied, true);
  assert.equal(result.revision, 1);
  assert.deepEqual(result.detail === 'full' ? result.changedLayerIds : [], ['roads']);
  assert.equal(runtime.snapshot().style.layers[0]?.paint?.['line-color'], '#ff0000');
  assert.equal(map.setStyleCalls, 1);
});

test('rechecks inline Style authority after candidate hashing before Map mutation', async (t) => {
  const map = new FakeMap(rawStyle());
  const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions());
  const baseline = runtime.snapshot();
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let digestCalls = 0;
  t.mock.method(globalThis.crypto.subtle, 'digest', (
    algorithm: AlgorithmIdentifier,
    data: BufferSource,
  ) => {
    digestCalls += 1;
    if (digestCalls === 2) map.external(rawStyle('#00ff00'));
    return digest(algorithm, data);
  });

  await assert.rejects(runtime.execute(applyStyleCommand(baseline, {
    kind: 'style',
    style: strictStyle('#ff0000'),
  })), hasCode('REVISION_CONFLICT'));

  assert.equal(map.setStyleCalls, 0);
  assert.equal(runtime.snapshot().revision, 1);
  assert.equal(runtime.snapshot().style.layers[0]?.paint?.['line-color'], '#00ff00');
});

test('binds inline authority when the Map changes during final re-observation hashing', async (t) => {
  const map = new FakeMap(rawStyle());
  const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions());
  const baseline = runtime.snapshot();
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let digestCalls = 0;
  t.mock.method(globalThis.crypto.subtle, 'digest', (
    algorithm: AlgorithmIdentifier,
    data: BufferSource,
  ) => {
    digestCalls += 1;
    if (digestCalls === 3) map.external(rawStyle('#00ff00'));
    return digest(algorithm, data);
  });

  await assert.rejects(runtime.execute(applyStyleCommand(baseline, {
    kind: 'style',
    style: strictStyle('#ff0000'),
  })), hasCode('REVISION_CONFLICT'));

  assert.equal(map.setStyleCalls, 0);
  assert.equal(runtime.snapshot().revision, 1);
  assert.equal(runtime.snapshot().style.layers[0]?.paint?.['line-color'], '#00ff00');
});

test('admits and applies an allowed relative Style document URL', async () => {
  const map = new FakeMap(rawStyle());
  map.styleUrls.set('https://images.example/app/styles/night.json', rawStyle('#112233'));
  const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions());
  const baseline = runtime.snapshot();

  const result = await runtime.execute(applyStyleCommand(baseline, {
    kind: 'url',
    url: './styles/night.json',
  }));

  assert.equal(result.type, 'transaction');
  assert.equal(result.applied, true);
  assert.equal(result.revision, 1);
  assert.equal(runtime.snapshot().style.layers[0]?.paint?.['line-color'], '#112233');
  assert.equal(map.setStyleCalls, 1);
});

test('denies a top-level Style URL without network.load before Map mutation', async () => {
  const map = new FakeMap(rawStyle());
  const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions({
    capabilities: allCapabilities.filter((capability) => capability !== 'network.load'),
  }));
  const baseline = runtime.snapshot();

  await assert.rejects(runtime.execute(applyStyleCommand(baseline, {
    kind: 'url',
    url: './styles/night.json',
  })), hasCode('CAPABILITY_DENIED'));

  assert.equal(map.setStyleCalls, 0);
  assert.deepEqual(runtime.snapshot(), baseline);
  assert.deepEqual(map.getStyle(), rawStyle());
});

test('restores the baseline when a resolved Style URL introduces a prohibited resource', async () => {
  const map = new FakeMap(rawStyle());
  map.styleUrls.set('https://images.example/app/styles/unsafe.json', {
    ...rawStyle('#ff0000'),
    glyphs: 'https://blocked.example/{fontstack}/{range}.pbf',
  });
  const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions());
  const baseline = runtime.snapshot();

  await assert.rejects(runtime.execute(applyStyleCommand(baseline, {
    kind: 'url',
    url: './styles/unsafe.json',
  })), (error: unknown) => {
    if (!hasCode('CAPABILITY_DENIED')(error) || !isStyleToolError(error)) return false;
    assert.equal(error.details?.rolledBack, true);
    assert.deepEqual(error.details?.currentSnapshot, baseline);
    return true;
  });

  assert.equal(map.setStyleCalls, 2);
  assert.deepEqual(runtime.snapshot(), baseline);
  assert.deepEqual(map.getStyle(), rawStyle());
});

test('rejects invalid external authority and blocks commands until explicit recovery', async () => {
  const map = new FakeMap(rawStyle());
  const syncEvents: string[] = [];
  const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions({
    onSyncStateChange: (event) => syncEvents.push(event.reason),
  }));
  map.external({ ...rawStyle(), version: 7 } as unknown as StyleSpecification);
  await assert.rejects(runtime.noteExternalStyle(), hasCode('INVALID_INPUT'));
  await assert.rejects(runtime.execute({ type: 'getStyle' }), hasCode('MAP_NOT_READY'));
  map.external(rawStyle('#00ff00'));
  await runtime.noteExternalStyle();
  assert.equal((await runtime.execute({ type: 'getStyle' })).type, 'style');
  assert.deepEqual(syncEvents, ['invalid-map-style']);
});

test('executes remaining SDK runtime actions with exact adapter arguments', async () => {
  const map = new FakeMap(rawStyle());
  map.sprites.set('base', 'https://sprites.example/base');
  const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions());
  const diff = { removeAll: true };
  const cases: ReadonlyArray<{
    command: BridgeCommand;
    expectedCalls: RuntimeCall[];
    expectedResult: { type: 'ack'; accepted: true } | {
      type: 'sprites';
      items: Array<{ id: string; url: string }>;
      returned: number;
      truncated: boolean;
      serializedBytes: number;
    };
  }> = [
    {
      command: { type: 'updateGeoJsonData', sourceId: 'points', diff },
      expectedCalls: [
        { method: 'getSource', args: ['points'] },
        { method: 'updateData', args: [diff] },
      ],
      expectedResult: { type: 'ack', accepted: true },
    },
    {
      command: {
        type: 'setSourceTileLodParams',
        maxZoomLevelsOnScreen: 4,
        tileCountMaxMinRatio: 2,
      },
      expectedCalls: [{
        method: 'setSourceTileLodParams', args: [4, 2, undefined],
      }],
      expectedResult: { type: 'ack', accepted: true },
    },
    {
      command: {
        type: 'setSourceTileLodParams',
        maxZoomLevelsOnScreen: 4,
        tileCountMaxMinRatio: 2,
        sourceId: 'terrain',
      },
      expectedCalls: [
        { method: 'getSource', args: ['terrain'] },
        { method: 'setSourceTileLodParams', args: [4, 2, 'terrain'] },
      ],
      expectedResult: { type: 'ack', accepted: true },
    },
    {
      command: { type: 'listSprites' },
      expectedCalls: [{ method: 'listSprites', args: [] }],
      expectedResult: {
        type: 'sprites',
        items: [{ id: 'base', url: 'https://sprites.example/base' }],
        returned: 1,
        truncated: false,
        serializedBytes: 52,
      },
    },
    {
      command: {
        type: 'addSprite',
        spriteId: 'added',
        url: 'https://sprites.example/added',
      },
      expectedCalls: [
        { method: 'listSprites', args: [] },
        { method: 'addSprite', args: ['added', 'https://sprites.example/added'] },
      ],
      expectedResult: { type: 'ack', accepted: true },
    },
    {
      command: {
        type: 'addSprite',
        spriteId: 'base',
        url: 'https://sprites.example/replacement',
        overwrite: true,
      },
      expectedCalls: [
        { method: 'listSprites', args: [] },
        { method: 'removeSprite', args: ['base'] },
        { method: 'addSprite', args: ['base', 'https://sprites.example/replacement'] },
      ],
      expectedResult: { type: 'ack', accepted: true },
    },
    {
      command: { type: 'removeSprite', spriteId: 'added' },
      expectedCalls: [
        { method: 'listSprites', args: [] },
        { method: 'removeSprite', args: ['added'] },
      ],
      expectedResult: { type: 'ack', accepted: true },
    },
  ];

  for (const fixture of cases) {
    map.clearRuntimeCalls();
    const result = await runtime.execute(fixture.command);
    assert.deepEqual(result, fixture.expectedResult);
    assert.deepEqual(map.runtimeCalls, fixture.expectedCalls);
  }
});

test('denies every remaining SDK runtime action before adapter Map work', async () => {
  const cases: ReadonlyArray<{
    capability: BridgeCapability;
    command: BridgeCommand;
  }> = [
    {
      capability: 'style.write',
      command: { type: 'updateGeoJsonData', sourceId: 'points', diff: { removeAll: true } },
    },
    {
      capability: 'runtime.state',
      command: {
        type: 'setSourceTileLodParams', maxZoomLevelsOnScreen: 4, tileCountMaxMinRatio: 2,
      },
    },
    { capability: 'style.read', command: { type: 'listSprites' } },
    {
      capability: 'assets.write',
      command: { type: 'addSprite', spriteId: 'added', url: 'https://sprites.example/added' },
    },
    {
      capability: 'assets.write',
      command: { type: 'removeSprite', spriteId: 'base' },
    },
  ];

  for (const fixture of cases) {
    const map = new FakeMap(rawStyle());
    map.sprites.set('base', 'https://sprites.example/base');
    const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions({
      capabilities: allCapabilities.filter((capability) => capability !== fixture.capability),
    }));

    await assert.rejects(runtime.execute(fixture.command), hasCode('CAPABILITY_DENIED'));
    assert.deepEqual(map.runtimeCalls, []);
  }
});

test('bounds sprite lists by count and UTF-8 serialized bytes', async () => {
  const countBoundedMap = new FakeMap(rawStyle());
  for (let index = 0; index < 501; index += 1) {
    countBoundedMap.sprites.set(`sprite-${index}`, `https://sprites.example/${index}`);
  }
  const countBounded = await (await createBrowserMapRuntime(
    countBoundedMap.asMap(), runtimeOptions(),
  )).execute({ type: 'listSprites' });
  assert.equal(countBounded.type, 'sprites');
  if (countBounded.type !== 'sprites') assert.fail('expected sprites');
  assert.equal(countBounded.returned, 500);
  assert.equal(countBounded.items.length, 500);
  assert.equal(countBounded.truncated, true);
  assert.equal(
    countBounded.serializedBytes,
    new TextEncoder().encode(JSON.stringify(countBounded.items)).byteLength,
  );

  const byteBoundedMap = new FakeMap(rawStyle());
  const unicodeSegment = 'é'.repeat(70);
  for (let index = 0; index < 500; index += 1) {
    byteBoundedMap.sprites.set(
      `sprite-${index}`,
      `https://sprites.example/${unicodeSegment}-${index}`,
    );
  }
  const byteBounded = await (await createBrowserMapRuntime(
    byteBoundedMap.asMap(), runtimeOptions(),
  )).execute({ type: 'listSprites' });
  assert.equal(byteBounded.type, 'sprites');
  if (byteBounded.type !== 'sprites') assert.fail('expected sprites');
  const serializedSprites = JSON.stringify(byteBounded.items);
  const measuredBytes = new TextEncoder().encode(serializedSprites).byteLength;
  assert.ok(byteBounded.returned < 500);
  assert.equal(byteBounded.returned, byteBounded.items.length);
  assert.equal(byteBounded.truncated, true);
  assert.ok(serializedSprites.length < 64 * 1024);
  assert.ok(measuredBytes > serializedSprites.length);
  assert.ok(measuredBytes <= 64 * 1024);
  assert.equal(byteBounded.serializedBytes, measuredBytes);
  const omitted = {
    id: `sprite-${byteBounded.returned}`,
    url: `https://sprites.example/${unicodeSegment}-${byteBounded.returned}`,
  };
  assert.ok(new TextEncoder().encode(JSON.stringify([...byteBounded.items, omitted])).byteLength > 64 * 1024);
});

test('image list results preserve count and UTF-8 transport truncation', async () => {
  const countMap = new FakeMap(rawStyle());
  for (let index = 0; index < 501; index += 1) countMap.images.set(`image-${index}`, {});
  const countResult = await (await createBrowserMapRuntime(
    countMap.asMap(), runtimeOptions(),
  )).execute({ type: 'listImages' });
  assert.equal(countResult.type, 'images');
  if (countResult.type !== 'images') assert.fail('expected images');
  const countList = countResult as typeof countResult & { returned: number; truncated: boolean };
  assert.equal(countList.returned, 500);
  assert.equal(countResult.imageIds.length, 500);
  assert.equal(countList.truncated, true);

  const byteMap = new FakeMap(rawStyle());
  const segment = 'é'.repeat(120);
  for (let index = 0; index < 500; index += 1) byteMap.images.set(`${segment}-${index}`, {});
  const byteResult = await (await createBrowserMapRuntime(
    byteMap.asMap(), runtimeOptions(),
  )).execute({ type: 'listImages' });
  assert.equal(byteResult.type, 'images');
  if (byteResult.type !== 'images') assert.fail('expected images');
  const byteList = byteResult as typeof byteResult & { returned: number; truncated: boolean };
  assert.equal(byteList.returned, byteResult.imageIds.length);
  assert.equal(byteList.truncated, true);
  assert.ok(byteList.returned < 500);
  assert.equal(
    byteResult.serializedBytes,
    new TextEncoder().encode(JSON.stringify(byteResult.imageIds)).byteLength,
  );
});

test('validate false reaches Map work with a Style-Spec-invalid prepared candidate', async () => {
  const map = new FakeMap(rawStyle());
  const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions());
  const snapshot = await runtime.execute({ type: 'getStyle' });
  if (snapshot.type !== 'style') assert.fail('expected style snapshot');
  await runtime.execute({
    type: 'applyTransaction',
    expectedRevision: snapshot.revision,
    expectedStyleHash: snapshot.styleHash,
    transaction: {
      validate: false,
      operations: [{ op: 'setStyleRootProperties', properties: { name: 7 } }],
    },
  }).catch(() => undefined);
  assert.ok(map.setStyleCalls > 0);
});

test('bounds feature/state/image paths before Map mutation', async () => {
  const map = new FakeMap(rawStyle());
  map.sourceFeatures = Array.from({ length: 101 }, (_, index) => rawFeature(index));
  const loadedUrls: string[] = [];
  const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions({
    imageLoader: {
      async load(url) {
        loadedUrls.push(url);
        return { width: 1, height: 1, data: new Uint8Array(4) };
      },
    },
  }));
  const features = await runtime.execute({
    type: 'querySourceFeatures', sourceId: 'roads', properties: ['name'], limit: 100,
  });
  assert.equal(features.type === 'features' && features.returned, 100);
  assert.equal(features.type === 'features' && features.truncated, true);
  if (features.type !== 'features') assert.fail('expected features');
  assert.deepEqual(Object.keys(features.features[0]?.properties ?? {}), ['name']);

  await assert.rejects(runtime.execute({
    type: 'setGlobalState', propertyName: 'payload', value: 'x'.repeat(65 * 1024),
  }), hasCode('INVALID_INPUT'));
  assert.equal(map.setGlobalStateCalls, 0);
  await assert.rejects(runtime.execute({
    type: 'addImage', imageId: 'bad',
    image: { kind: 'rgba', width: 2, height: 2, data: btoa('short') },
  }), hasCode('INVALID_INPUT'));
  assert.equal(map.addImageCalls, 0);
  await runtime.execute({
    type: 'addImage', imageId: 'marker', image: { kind: 'url', url: './marker.png' },
  });
  assert.deepEqual(loadedUrls, ['https://images.example/app/marker.png']);
});

test('rejects oversized initial styles and invalid explicit deadlines before work', async () => {
  const oversized = rawStyle();
  Object.assign(oversized, { metadata: { padding: 'x'.repeat(DEFAULT_MAX_STYLE_BYTES) } });
  await assert.rejects(
    createBrowserMapRuntime(new FakeMap(oversized).asMap(), runtimeOptions()),
    hasCode('INVALID_INPUT'),
  );
  const map = new FakeMap(rawStyle());
  const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions());
  const now = Date.now();
  await assert.rejects(
    runtime.execute({ type: 'getStyle' }, { deadlineAt: now - 5_000 }),
    hasCode('TIMEOUT'),
  );
  await assert.rejects(
    runtime.execute({ type: 'getStyle' }, { deadlineAt: now + 15_000 }),
    hasCode('INVALID_INPUT'),
  );
});

test('returns authentic TIMEOUT after synchronous abortable Map work crosses its deadline', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const map = new FakeMap(rawStyle());
  map.sourceFeatures = [rawFeature(1)];
  map.images.set('existing', { width: 1, height: 1, data: new Uint8Array(4) });
  const runtime = await createBrowserMapRuntime(map.asMap(), runtimeOptions());
  const cases: ReadonlyArray<{ name: string; command: BridgeCommand }> = [
    {
      name: 'querySourceFeatures',
      command: { type: 'querySourceFeatures', sourceId: 'roads' },
    },
    {
      name: 'queryRenderedFeatures',
      command: { type: 'queryRenderedFeatures' },
    },
    {
      name: 'setGlobalState',
      command: { type: 'setGlobalState', propertyName: 'theme', value: 'night' },
    },
    { name: 'listImages', command: { type: 'listImages' } },
    {
      name: 'addImage',
      command: {
        type: 'addImage', imageId: 'marker',
        image: { kind: 'rgba', width: 1, height: 1, data: btoa('\0\0\0\0') },
      },
    },
  ];
  const outcomes: string[] = [];

  for (const fixture of cases) {
    const before = map.synchronousCalls.get(fixture.name) ?? 0;
    const deadlineAt = now + 5_000;
    map.beforeSynchronousCommand = () => { now = deadlineAt; };
    try {
      await runtime.execute(fixture.command, { deadlineAt });
      outcomes.push('success');
    } catch (error) {
      outcomes.push(isStyleToolError(error) ? error.code : 'foreign-error');
    }
    assert.equal(map.synchronousCalls.get(fixture.name), before + 1);
    now += 1;
  }

  assert.deepEqual(outcomes, cases.map(() => 'TIMEOUT'));
});
