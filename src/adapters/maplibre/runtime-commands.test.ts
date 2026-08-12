import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  GeoJSONSource,
  GeoJSONSourceDiff,
  Map as MapLibreMap,
} from 'maplibre-gl';
import {
  createStyleToolError,
  jsonValueSchema,
} from '../../core/index.js';
import { createMapRuntimeCommands } from './runtime-commands.js';
import {
  DEFAULT_RUNTIME_LIST_LIMIT,
  MAX_RUNTIME_LIST_LIMIT,
  addImageDataInputSchema,
  addImageFromUrlInputSchema,
  addSpriteInputSchema,
  featureStateInputSchema,
  globalStateInputSchema,
  imageOptionsInputSchema,
  removeFeatureStateInputSchema,
  removeImageInputSchema,
  removeSpriteInputSchema,
  runtimeListInputSchema,
  sourceTileLodParamsInputSchema,
} from './schemas.js';
import type {
  RuntimeCommandResult,
  RuntimeImageLoader,
} from './types.js';

type AssertTrue<Value extends true> = Value;
type UpdateParametersAreOneDiff = AssertTrue<
  Parameters<GeoJSONSource['updateData']> extends [diff: GeoJSONSourceDiff] ? true : false
>;
type UpdateReturnsPromise = AssertTrue<
  ReturnType<GeoJSONSource['updateData']> extends Promise<void> ? true : false
>;
const compileAssertions: [UpdateParametersAreOneDiff, UpdateReturnsPromise] = [true, true];

function compileOnlyUpdateDataContract(source: GeoJSONSource): void {
  // @ts-expect-error MapLibre 6.3 updateData accepts exactly one argument
  void source.updateData({}, true);
}
void compileOnlyUpdateDataContract;

type MapCall = { method: string; args: unknown[] };

class FakeMap {
  readonly calls: MapCall[] = [];
  readonly errors = new globalThis.Map<string, unknown>();
  readonly images = new Set<string>();
  source: unknown;
  imageListResult: unknown;
  spriteListResult: unknown = [];
  loadedImage: Promise<{ data: unknown }> = Promise.resolve({
    data: { width: 1, height: 1, data: new Uint8Array(4) },
  });

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
    if (this.errors.has(method)) throw this.errors.get(method);
  }

  clearCalls(): void {
    this.calls.length = 0;
  }

  getSource(sourceId: string): unknown {
    this.record('getSource', [sourceId]);
    return this.source;
  }

  setSourceTileLodParams(
    maxZoomLevelsOnScreen: number,
    tileCountMaxMinRatio: number,
    sourceId?: string,
  ): void {
    this.record('setSourceTileLodParams', [
      maxZoomLevelsOnScreen, tileCountMaxMinRatio, sourceId,
    ]);
  }

  setFeatureState(target: unknown, state: unknown): void {
    this.record('setFeatureState', [target, state]);
  }

  removeFeatureState(target: unknown, key?: string): void {
    this.record('removeFeatureState', [target, key]);
  }

  setGlobalStateProperty(propertyName: string, value: unknown): void {
    this.record('setGlobalStateProperty', [propertyName, value]);
  }

  listImages(): unknown {
    this.record('listImages', []);
    return this.imageListResult ?? [...this.images];
  }

  hasImage(imageId: string): boolean {
    this.record('hasImage', [imageId]);
    return this.images.has(imageId);
  }

  addImage(imageId: string, image: unknown, options?: unknown): void {
    this.record('addImage', [imageId, image, options]);
    this.images.add(imageId);
  }

  updateImage(imageId: string, image: unknown): void {
    this.record('updateImage', [imageId, image]);
  }

  removeImage(imageId: string): void {
    this.record('removeImage', [imageId]);
    this.images.delete(imageId);
  }

  loadImage(url: string): Promise<{ data: unknown }> {
    this.record('loadImage', [url]);
    return this.loadedImage;
  }

  getSprite(): unknown {
    this.record('getSprite', []);
    return this.spriteListResult;
  }

  addSprite(spriteId: string, url: string): void {
    this.record('addSprite', [spriteId, url]);
    if (Array.isArray(this.spriteListResult)) {
      this.spriteListResult.push({ id: spriteId, url });
    }
  }

  removeSprite(spriteId: string): void {
    this.record('removeSprite', [spriteId]);
    if (Array.isArray(this.spriteListResult)) {
      this.spriteListResult = this.spriteListResult.filter((value: unknown) => (
        typeof value !== 'object' || value === null
        || Object.getOwnPropertyDescriptor(value, 'id')?.value !== spriteId
      ));
    }
  }

  asMap(): MapLibreMap {
    return this as unknown as MapLibreMap;
  }
}

function assertSuccessDataIsJson(result: RuntimeCommandResult): void {
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(jsonValueSchema.safeParse(result.data).success, true);
}

function assertFailureCode(result: RuntimeCommandResult, code: string): void {
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, code);
  assert.equal(Object.hasOwn(result, 'data'), false);
}

test('all exported runtime input schemas accept valid closed values', () => {
  const pixels = new Uint8Array([0, 1, 2, 3]);
  const clamped = new Uint8ClampedArray([0, 1, 2, 3]);
  const valid: ReadonlyArray<[string, { safeParse(value: unknown): { success: boolean } }, unknown]> = [
    ['lod', sourceTileLodParamsInputSchema, {
      maxZoomLevelsOnScreen: 2, tileCountMaxMinRatio: 3, sourceId: 'roads',
    }],
    ['state', featureStateInputSchema, {
      target: { source: 'roads', sourceLayer: 'transport', id: 0 },
      state: { selected: true, nested: [1, null] },
    }],
    ['remove state', removeFeatureStateInputSchema, {
      target: { source: 'roads', id: 'road-1' }, key: 'selected',
    }],
    ['global state', globalStateInputSchema, { propertyName: 'theme', value: null }],
    ['image options', imageOptionsInputSchema, {
      pixelRatio: 2, sdf: false, content: [0, 0, 1, 1],
      stretchX: [], stretchY: [[0, 1]],
    }],
    ['raw image', addImageDataInputSchema, {
      imageId: 'marker', image: { width: 1, height: 1, data: pixels }, overwrite: true,
    }],
    ['clamped image', addImageDataInputSchema, {
      imageId: 'marker', image: { width: 1, height: 1, data: clamped },
    }],
    ['URL image', addImageFromUrlInputSchema, {
      imageId: 'marker', url: 'custom://icons/marker', options: { sdf: true },
    }],
    ['sprite', addSpriteInputSchema, {
      spriteId: 'base', url: 'mapbox://sprites/base', overwrite: true,
    }],
    ['list', runtimeListInputSchema, { limit: MAX_RUNTIME_LIST_LIMIT }],
    ['remove image', removeImageInputSchema, { imageId: 'marker' }],
    ['remove sprite', removeSpriteInputSchema, { spriteId: 'base' }],
  ];
  for (const [label, schema, value] of valid) {
    assert.equal(schema.safeParse(value).success, true, label);
  }
  assert.deepEqual(compileAssertions, [true, true]);
});

test('all runtime schemas reject unknown keys and invalid values', () => {
  class ByteSubclass extends Uint8Array {}
  const invalid: ReadonlyArray<[{ safeParse(value: unknown): { success: boolean } }, unknown]> = [
    [sourceTileLodParamsInputSchema, {
      maxZoomLevelsOnScreen: 1, tileCountMaxMinRatio: 1, extra: true,
    }],
    [sourceTileLodParamsInputSchema, { maxZoomLevelsOnScreen: 0, tileCountMaxMinRatio: 1 }],
    [featureStateInputSchema, {
      target: { source: 'roads', id: Number.NaN }, state: {},
    }],
    [featureStateInputSchema, {
      target: { source: 'roads', id: 1, extra: true }, state: {},
    }],
    [featureStateInputSchema, { target: { source: 'roads', id: 1 }, state: [] }],
    [removeFeatureStateInputSchema, { target: { source: 'roads', id: 1 }, key: '' }],
    [globalStateInputSchema, { propertyName: '', value: true }],
    [globalStateInputSchema, { propertyName: 'theme', value: undefined }],
    [imageOptionsInputSchema, { pixelRatio: 0 }],
    [imageOptionsInputSchema, { content: [0, 0, 1, Number.POSITIVE_INFINITY] }],
    [imageOptionsInputSchema, { sdf: false, extra: true }],
    [addImageDataInputSchema, {
      imageId: 'bad', image: { width: 1, height: 1, data: new Uint8Array(3) },
    }],
    [addImageDataInputSchema, {
      imageId: 'bad', image: { width: 1.5, height: 1, data: new Uint8Array(4) },
    }],
    [addImageDataInputSchema, {
      imageId: 'bad', image: { width: 1, height: 1, data: new Uint16Array(4) },
    }],
    [addImageDataInputSchema, {
      imageId: 'bad', image: { width: 1, height: 1, data: new ByteSubclass(4) },
    }],
    [addImageDataInputSchema, {
      imageId: 'bad', image: { width: 1, height: 1, data: new Uint8Array(4), extra: true },
    }],
    [addImageFromUrlInputSchema, { imageId: 'bad', url: '', extra: true }],
    [addSpriteInputSchema, { spriteId: '', url: 'sprite://base' }],
    [runtimeListInputSchema, { limit: 0 }],
    [runtimeListInputSchema, { limit: MAX_RUNTIME_LIST_LIMIT + 1 }],
    [runtimeListInputSchema, { limit: 1.5 }],
    [runtimeListInputSchema, { extra: true }],
    [removeImageInputSchema, { imageId: '', extra: true }],
    [removeSpriteInputSchema, { spriteId: '', extra: true }],
  ];
  for (const [schema, value] of invalid) assert.equal(schema.safeParse(value).success, false);
});

test('descriptor validation rejects hostile surrounding image/state values without getters', () => {
  let getterCalls = 0;
  const hostileState: Record<string, unknown> = {};
  Object.defineProperty(hostileState, 'selected', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('must not run'); },
  });
  const hostileImage: Record<string, unknown> = {};
  Object.defineProperty(hostileImage, 'width', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('must not run'); },
  });
  Object.defineProperties(hostileImage, {
    height: { enumerable: true, value: 1 },
    data: { enumerable: true, value: new Uint8Array(4) },
  });
  assert.equal(featureStateInputSchema.safeParse({
    target: { source: 'roads', id: 1 }, state: hostileState,
  }).success, false);
  assert.equal(addImageDataInputSchema.safeParse({
    imageId: 'marker', image: hostileImage,
  }).success, false);
  assert.equal(getterCalls, 0);
});

test('invalid command inputs fail before source, loader, or Map access', async () => {
  const map = new FakeMap();
  let loadCalls = 0;
  const imageLoader: RuntimeImageLoader = {
    async load() {
      loadCalls += 1;
      return { width: 1, height: 1, data: new Uint8Array(4) };
    },
  };
  const commands = createMapRuntimeCommands(map.asMap(), { imageLoader });
  const results: RuntimeCommandResult[] = [
    await commands.updateGeoJsonDataRuntime({ sourceId: '', diff: { removeAll: true } }),
    commands.setSourceTileLodParams({ maxZoomLevelsOnScreen: 0, tileCountMaxMinRatio: 1 }),
    commands.setFeatureState({ target: { source: '', id: 1 }, state: {} }),
    commands.removeFeatureState({ target: { source: 'roads', id: 1 }, key: '' }),
    commands.setGlobalState({ propertyName: '', value: true }),
    commands.listImages({ limit: MAX_RUNTIME_LIST_LIMIT + 1 }),
    commands.addImageData({
      imageId: 'marker', image: { width: 1, height: 1, data: new Uint8Array(3) },
    }),
    await commands.addImageFromUrl({ imageId: '', url: 'custom://marker' }),
    commands.removeImage({ imageId: '' }),
    commands.listSprites({ limit: 0 }),
    commands.addSprite({ spriteId: '', url: 'sprite://base' }),
    commands.removeSprite({ spriteId: '' }),
  ];
  for (const result of results) assertFailureCode(result, 'INVALID_INPUT');
  assert.deepEqual(map.calls, []);
  assert.equal(loadCalls, 0);
});

test('validates, snapshots, and awaits the one-argument GeoJSON updateData call', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const calls: GeoJSONSourceDiff[][] = [];
  const source = {
    type: 'geojson',
    updateData(...args: [diff: GeoJSONSourceDiff]): Promise<void> {
      calls.push(args);
      return pending;
    },
  };
  const map = {
    getSource(sourceId: string) {
      assert.equal(sourceId, 'places');
      return source;
    },
  } as unknown as MapLibreMap;
  const commands = createMapRuntimeCommands(map);
  const input = {
    sourceId: 'places',
    diff: { remove: ['old'] },
  };

  let settled = false;
  const resultPromise = commands.updateGeoJsonDataRuntime(input).then((result) => {
    settled = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(calls, [[{ remove: ['old'] }]]);
  assert.notStrictEqual(calls[0]?.[0], input.diff);

  release();
  const result = await resultPromise;
  assert.deepEqual(result, { ok: true, data: null });
  assertSuccessDataIsJson(result);
});

test('GeoJSON update reports missing, unsupported, and rejected sources structurally', async () => {
  const map = new FakeMap();
  const commands = createMapRuntimeCommands(map.asMap());
  assertFailureCode(
    await commands.updateGeoJsonDataRuntime({ sourceId: 'missing', diff: { removeAll: true } }),
    'NOT_FOUND',
  );
  map.source = { type: 'vector' };
  assertFailureCode(
    await commands.updateGeoJsonDataRuntime({ sourceId: 'roads', diff: { removeAll: true } }),
    'UNSUPPORTED_SOURCE',
  );
  map.source = {
    type: 'geojson',
    updateData: async () => { throw new Error('worker rejected'); },
  };
  assertFailureCode(
    await commands.updateGeoJsonDataRuntime({ sourceId: 'roads', diff: { removeAll: true } }),
    'INTERNAL',
  );
});

test('LOD, feature state, removal, and global state forward exact sanitized arguments', () => {
  const map = new FakeMap();
  map.source = { type: 'vector' };
  const commands = createMapRuntimeCommands(map.asMap());
  const lod = commands.setSourceTileLodParams({
    maxZoomLevelsOnScreen: 2, tileCountMaxMinRatio: 3, sourceId: 'roads',
  });
  assertSuccessDataIsJson(lod);
  assert.deepEqual(map.calls, [
    { method: 'getSource', args: ['roads'] },
    { method: 'setSourceTileLodParams', args: [2, 3, 'roads'] },
  ]);

  map.clearCalls();
  commands.setSourceTileLodParams({ maxZoomLevelsOnScreen: 4, tileCountMaxMinRatio: 5 });
  assert.deepEqual(map.calls, [
    { method: 'setSourceTileLodParams', args: [4, 5, undefined] },
  ]);

  map.clearCalls();
  const target = { source: 'roads', sourceLayer: 'transport', id: 7 };
  const state = { selected: true, nested: { rank: 1 } };
  assertSuccessDataIsJson(commands.setFeatureState({ target, state }));
  assertSuccessDataIsJson(commands.removeFeatureState({ target, key: 'selected' }));
  assertSuccessDataIsJson(commands.setGlobalState({ propertyName: 'theme', value: { dark: true } }));
  assert.deepEqual(map.calls, [
    { method: 'setFeatureState', args: [target, state] },
    { method: 'removeFeatureState', args: [target, 'selected'] },
    { method: 'setGlobalStateProperty', args: ['theme', { dark: true }] },
  ]);
  assert.notStrictEqual(map.calls[0]?.args[0], target);
  assert.notStrictEqual(map.calls[0]?.args[1], state);
});

test('an explicit missing LOD source is NOT_FOUND and omission never performs lookup', () => {
  const map = new FakeMap();
  const commands = createMapRuntimeCommands(map.asMap());
  const missing = commands.setSourceTileLodParams({
    maxZoomLevelsOnScreen: 2, tileCountMaxMinRatio: 3, sourceId: 'missing',
  });
  assertFailureCode(missing, 'NOT_FOUND');
  assert.deepEqual(map.calls, [{ method: 'getSource', args: ['missing'] }]);
});

test('raw image data handles add, collision, overwrite, and remove without returning bytes', () => {
  const map = new FakeMap();
  const commands = createMapRuntimeCommands(map.asMap());
  const pixels = new Uint8ClampedArray([1, 2, 3, 4]);
  const added = commands.addImageData({
    imageId: 'marker', image: { width: 1, height: 1, data: pixels },
    options: { pixelRatio: 2, sdf: true },
  });
  assert.deepEqual(added, { ok: true, data: null });
  assertSuccessDataIsJson(added);
  assert.deepEqual(map.calls.map((call) => call.method), ['hasImage', 'addImage']);
  assert.strictEqual(map.calls[1]?.args[1] instanceof Object, true);
  assert.strictEqual(
    (map.calls[1]?.args[1] as { data: Uint8ClampedArray }).data,
    pixels,
  );

  map.clearCalls();
  assertFailureCode(commands.addImageData({
    imageId: 'marker', image: { width: 1, height: 1, data: pixels },
  }), 'CONFLICT');
  assert.deepEqual(map.calls.map((call) => call.method), ['hasImage']);

  map.clearCalls();
  assertSuccessDataIsJson(commands.addImageData({
    imageId: 'marker', image: { width: 1, height: 1, data: pixels }, overwrite: true,
  }));
  assert.deepEqual(map.calls.map((call) => call.method), ['hasImage', 'updateImage']);

  map.clearCalls();
  assertSuccessDataIsJson(commands.removeImage({ imageId: 'marker' }));
  assert.deepEqual(map.calls.map((call) => call.method), ['hasImage', 'removeImage']);
  map.clearCalls();
  assertFailureCode(commands.removeImage({ imageId: 'marker' }), 'NOT_FOUND');
});

test('URL image loading preserves custom protocols, signal, collision, and add/update behavior', async () => {
  const map = new FakeMap();
  const loaderCalls: Array<{ url: string; signal: AbortSignal }> = [];
  const imageLoader: RuntimeImageLoader = {
    async load(url, { signal }) {
      loaderCalls.push({ url, signal });
      return { width: 1, height: 1, data: new Uint8Array(4) };
    },
  };
  const commands = createMapRuntimeCommands(map.asMap(), { imageLoader });
  const controller = new AbortController();
  const added = await commands.addImageFromUrl({
    imageId: 'remote', url: 'pmtiles://icons/remote', options: { sdf: true },
  }, { signal: controller.signal });
  assertSuccessDataIsJson(added);
  assert.deepEqual(loaderCalls, [{ url: 'pmtiles://icons/remote', signal: controller.signal }]);
  assert.deepEqual(map.calls.map((call) => call.method), ['hasImage', 'hasImage', 'addImage']);

  map.clearCalls();
  const collision = await commands.addImageFromUrl({
    imageId: 'remote', url: 'custom://other',
  });
  assertFailureCode(collision, 'CONFLICT');
  assert.equal(loaderCalls.length, 1);
  assert.deepEqual(map.calls.map((call) => call.method), ['hasImage']);

  map.clearCalls();
  const overwritten = await commands.addImageFromUrl({
    imageId: 'remote', url: 'custom://replacement', overwrite: true,
  });
  assertSuccessDataIsJson(overwritten);
  assert.deepEqual(map.calls.map((call) => call.method), ['hasImage', 'hasImage', 'updateImage']);
});

test('the default URL loader delegates to map.loadImage and aborts pending work', async () => {
  const successMap = new FakeMap();
  const successCommands = createMapRuntimeCommands(successMap.asMap());
  const success = await successCommands.addImageFromUrl({
    imageId: 'loaded', url: 'custom://loaded',
  });
  assertSuccessDataIsJson(success);
  assert.deepEqual(successMap.calls.map((call) => call.method), [
    'hasImage', 'loadImage', 'hasImage', 'addImage',
  ]);

  const pendingMap = new FakeMap();
  pendingMap.loadedImage = new Promise(() => undefined);
  const pendingCommands = createMapRuntimeCommands(pendingMap.asMap());
  const controller = new AbortController();
  const pending = pendingCommands.addImageFromUrl({
    imageId: 'pending', url: 'custom://pending',
  }, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  const aborted = await pending;
  assertFailureCode(aborted, 'TIMEOUT');
  assert.deepEqual(pendingMap.calls.map((call) => call.method), ['hasImage', 'loadImage']);
});

test('injected loader aborts and malformed decoded bytes fail before image mutation', async () => {
  const map = new FakeMap();
  let seenSignal: AbortSignal | undefined;
  const abortingLoader: RuntimeImageLoader = {
    load(_url, { signal }) {
      seenSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  };
  const controller = new AbortController();
  const commands = createMapRuntimeCommands(map.asMap(), { imageLoader: abortingLoader });
  const pending = commands.addImageFromUrl({ imageId: 'abort', url: 'custom://abort' }, {
    signal: controller.signal,
  });
  await Promise.resolve();
  controller.abort();
  assertFailureCode(await pending, 'TIMEOUT');
  assert.strictEqual(seenSignal, controller.signal);
  assert.deepEqual(map.calls.map((call) => call.method), ['hasImage']);

  map.clearCalls();
  const malformedLoader: RuntimeImageLoader = {
    async load() { return { width: 1, height: 1, data: new Uint8Array(3) }; },
  };
  const malformed = await createMapRuntimeCommands(map.asMap(), {
    imageLoader: malformedLoader,
  }).addImageFromUrl({ imageId: 'bad', url: 'custom://bad' });
  assertFailureCode(malformed, 'INVALID_INPUT');
  assert.deepEqual(map.calls.map((call) => call.method), ['hasImage']);
});

test('image lists apply configured limits before reading output and remain JSON-only', () => {
  const map = new FakeMap();
  const capped = new Array<string>(MAX_RUNTIME_LIST_LIMIT + 1);
  capped[0] = 'first';
  let beyondLimitReads = 0;
  Object.defineProperty(capped, '1', {
    configurable: true,
    enumerable: true,
    get() { beyondLimitReads += 1; throw new Error('must not read'); },
  });
  map.imageListResult = capped;
  const result = createMapRuntimeCommands(map.asMap()).listImages({ limit: 1 });
  assert.deepEqual(result, {
    ok: true,
    data: { items: ['first'], returned: 1, truncated: true },
  });
  assert.equal(beyondLimitReads, 0);
  assertSuccessDataIsJson(result);
  assert.equal(DEFAULT_RUNTIME_LIST_LIMIT, 300);
  assert.equal(MAX_RUNTIME_LIST_LIMIT, 500);
});

test('sprite list/add/overwrite/remove preserve IDs and URLs with bounded JSON output', () => {
  const map = new FakeMap();
  const capped = new Array<unknown>(MAX_RUNTIME_LIST_LIMIT + 1);
  capped[0] = { id: 'base', url: 'sprite://base' };
  let beyondLimitReads = 0;
  Object.defineProperty(capped, '1', {
    configurable: true,
    enumerable: true,
    get() { beyondLimitReads += 1; throw new Error('must not read'); },
  });
  map.spriteListResult = capped;
  const commands = createMapRuntimeCommands(map.asMap());
  const listed = commands.listSprites({ limit: 1 });
  assert.deepEqual(listed, {
    ok: true,
    data: {
      items: [{ id: 'base', url: 'sprite://base' }], returned: 1, truncated: true,
    },
  });
  assert.equal(beyondLimitReads, 0);
  assertSuccessDataIsJson(listed);

  map.spriteListResult = [];
  map.clearCalls();
  assertSuccessDataIsJson(commands.addSprite({ spriteId: 'new', url: 'sprite://new' }));
  assert.deepEqual(map.calls.map((call) => call.method), ['getSprite', 'addSprite']);
  map.clearCalls();
  assertFailureCode(commands.addSprite({ spriteId: 'new', url: 'sprite://other' }), 'CONFLICT');
  assert.deepEqual(map.calls.map((call) => call.method), ['getSprite']);
  map.clearCalls();
  assertSuccessDataIsJson(commands.addSprite({
    spriteId: 'new', url: 'sprite://replacement', overwrite: true,
  }));
  assert.deepEqual(map.calls.map((call) => call.method), [
    'getSprite', 'removeSprite', 'addSprite',
  ]);
  map.clearCalls();
  assertSuccessDataIsJson(commands.removeSprite({ spriteId: 'new' }));
  assert.deepEqual(map.calls.map((call) => call.method), ['getSprite', 'removeSprite']);
  map.clearCalls();
  assertFailureCode(commands.removeSprite({ spriteId: 'missing' }), 'NOT_FOUND');
});

test('Map exceptions and authentic StyleToolErrors become structured failures', async () => {
  const map = new FakeMap();
  const commands = createMapRuntimeCommands(map.asMap());
  map.errors.set('setFeatureState', new Error('style unavailable'));
  assertFailureCode(commands.setFeatureState({
    target: { source: 'roads', id: 1 }, state: { selected: true },
  }), 'INTERNAL');

  map.errors.delete('setFeatureState');
  const authentic = createStyleToolError('MAP_NOT_READY', 'not ready');
  map.errors.set('listImages', authentic);
  const result = commands.listImages();
  assert.equal(result.ok, false);
  if (!result.ok) assert.strictEqual(result.error, authentic);

  map.errors.delete('listImages');
  map.errors.set('getSprite', new Error('sprite unavailable'));
  assertFailureCode(commands.listSprites(), 'INTERNAL');
  assertFailureCode(commands.addSprite({ spriteId: 'base', url: 'sprite://base' }), 'INTERNAL');

  const rejectedLoader: RuntimeImageLoader = {
    async load() { throw new Error('decode failed'); },
  };
  const imageMap = new FakeMap();
  assertFailureCode(await createMapRuntimeCommands(imageMap.asMap(), {
    imageLoader: rejectedLoader,
  }).addImageFromUrl({ imageId: 'bad', url: 'custom://bad' }), 'INTERNAL');
});
