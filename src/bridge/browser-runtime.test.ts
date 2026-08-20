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

class FakeMap {
  style: StyleSpecification;
  loaded = true;
  setStyleCalls = 0;
  setGlobalStateCalls = 0;
  addImageCalls = 0;
  sourceFeatures: unknown[] = [];
  readonly images = new Map<string, unknown>();
  readonly styleUrls = new Map<string, StyleSpecification>();
  readonly synchronousCalls = new Map<string, number>();
  beforeSynchronousCommand: (() => void) | undefined;
  private readonly listeners = new Map<EventName, Set<Listener>>();

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
