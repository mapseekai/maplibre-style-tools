import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { jsonUtf8ByteLength, jsonValueSchema } from '../../core/index.js';
import {
  DEFAULT_FEATURE_QUERY_LIMITS,
  queryRenderedFeaturesBounded,
  querySourceFeaturesBounded,
} from './feature-query.js';

type QueryCall = { method: 'source' | 'rendered'; args: unknown[] };

class FakeMap {
  readonly calls: QueryCall[] = [];
  sourceFeatures: unknown[] = [];
  renderedFeatures: unknown[] = [];
  sourceError: unknown;
  renderedError: unknown;

  querySourceFeatures(sourceId: string, options?: unknown): unknown[] {
    this.calls.push({ method: 'source', args: [sourceId, options] });
    if (this.sourceError !== undefined) throw this.sourceError;
    return this.sourceFeatures;
  }

  queryRenderedFeatures(geometry?: unknown, options?: unknown): unknown[] {
    this.calls.push({ method: 'rendered', args: [geometry, options] });
    if (this.renderedError !== undefined) throw this.renderedError;
    return this.renderedFeatures;
  }

  asMap(): MapLibreMap {
    return this as unknown as MapLibreMap;
  }
}

function rawFeature(id: number, name = `road-${id}`): Record<string, unknown> {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [id, id + 1] },
    properties: { name, category: 'road', retained: true },
    source: 'roads',
    sourceLayer: 'transportation',
    layer: { id: 'road-layer', type: 'line', runtime: { cyclic: null } },
  };
}

function projectedFeature(id: number, name = `road-${id}`): Record<string, unknown> {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [id, id + 1] },
    properties: { name, category: 'road', retained: true },
    source: 'roads',
    sourceLayer: 'transportation',
    layer: { id: 'road-layer', type: 'line' },
  };
}

test('source and rendered queries forward only documented MapLibre arguments', () => {
  const map = new FakeMap();
  querySourceFeaturesBounded(map.asMap(), {
    sourceId: 'roads', sourceLayer: 'transportation', filter: ['==', 'class', 'primary'],
    propertyAllowlist: ['name'], limit: 1, maxSerializedBytes: 100,
  });
  queryRenderedFeaturesBounded(map.asMap(), {
    layerIds: ['road-layer'], filter: ['==', 'class', 'primary'],
  });
  queryRenderedFeaturesBounded(map.asMap(), {
    geometry: { kind: 'point', point: [10, 20] },
  });
  queryRenderedFeaturesBounded(map.asMap(), {
    geometry: { kind: 'bounds', bounds: [[1, 2], [3, 4]] },
  });

  assert.deepEqual(map.calls, [
    { method: 'source', args: ['roads', {
      sourceLayer: 'transportation', filter: ['==', 'class', 'primary'],
    }] },
    { method: 'rendered', args: [undefined, {
      layers: ['road-layer'], filter: ['==', 'class', 'primary'],
    }] },
    { method: 'rendered', args: [[10, 20], {}] },
    { method: 'rendered', args: [[[1, 2], [3, 4]], {}] },
  ]);
});

test('invalid configured limits and invalid requests fail before map access', () => {
  const map = new FakeMap();
  const hostile = new Proxy({}, {
    get() { throw new Error('input must not be read'); },
    ownKeys() { throw new Error('input must not be enumerated'); },
  });
  const invalidLimits = querySourceFeaturesBounded(
    map.asMap(), hostile as never, { maxFeatures: 0, maxSerializedBytes: 1 },
  );
  const aboveMaximum = queryRenderedFeaturesBounded(map.asMap(), {
    limit: 3,
  }, { maxFeatures: 2, maxSerializedBytes: 10 });

  assert.equal(invalidLimits.ok, false);
  assert.equal(invalidLimits.error?.code, 'INVALID_INPUT');
  assert.equal(aboveMaximum.ok, false);
  assert.equal(aboveMaximum.error?.code, 'INVALID_INPUT');
  assert.deepEqual(map.calls, []);
});

test('MapLibre exceptions become structured feature-query errors', () => {
  const map = new FakeMap();
  map.sourceError = new Error('map unavailable');
  const result = querySourceFeaturesBounded(map.asMap(), { sourceId: 'roads' });

  assert.deepEqual(result.features, []);
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'INTERNAL');
  assert.equal(result.returned, 0);
  assert.equal(result.serializedBytes, 2);
});

test('defaults and lower requested limits bound returned feature count without deduplication', () => {
  const map = new FakeMap();
  map.sourceFeatures = Array.from({ length: 101 }, (_, index) => rawFeature(index));
  const defaultResult = querySourceFeaturesBounded(map.asMap(), { sourceId: 'roads' });
  const lowerResult = querySourceFeaturesBounded(map.asMap(), {
    sourceId: 'roads', limit: 1,
  });

  assert.deepEqual(DEFAULT_FEATURE_QUERY_LIMITS, {
    maxFeatures: 100, maxSerializedBytes: 1024 * 1024,
  });
  assert.equal(defaultResult.ok, true);
  assert.equal(defaultResult.returned, 100);
  assert.equal(defaultResult.truncated, true);
  assert.equal(lowerResult.returned, 1);
  assert.equal(lowerResult.truncated, true);
  assert.equal(defaultResult.features[0]?.id, 0);
  assert.equal(defaultResult.features[1]?.id, 1);
});

test('projects a fresh JSON DTO with an allowlist and never reads runtime metadata', () => {
  const map = new FakeMap();
  const feature = rawFeature(7, 'main street');
  const runtime = { self: null as unknown };
  runtime.self = runtime;
  let getterReads = 0;
  Object.defineProperty(feature, 'runtimeMetadata', {
    enumerable: true,
    get() { getterReads += 1; return runtime; },
  });
  Object.defineProperty(feature.layer as object, 'dangerousAccessor', {
    enumerable: true,
    get() { getterReads += 1; return runtime; },
  });
  map.sourceFeatures = [feature];

  const result = querySourceFeaturesBounded(map.asMap(), {
    sourceId: 'roads', propertyAllowlist: ['name'],
  });
  const expected = {
    ...projectedFeature(7, 'main street'),
    properties: { name: 'main street' },
  };

  assert.equal(result.ok, true);
  assert.deepEqual(result.features, [expected]);
  assert.notEqual(result.features[0], feature);
  assert.notEqual(result.features[0]?.properties, feature.properties);
  assert.equal(getterReads, 0);
  assert.equal(jsonValueSchema.safeParse(result.features[0]).success, true);
  assert.deepEqual(feature.properties, { name: 'main street', category: 'road', retained: true });
});

test('rejects an exact-shape feature impostor without invoking its accessors', () => {
  const map = new FakeMap();
  let impostorCalls = 0;
  const MapLibreGeoJSONFeature = class GeoJSONFeature {
    readonly type = 'Feature';
    readonly id = 'event-1';
    readonly properties = Object.assign(Object.create(null) as Record<string, unknown>, {
      category: 'festival',
    });
    readonly _vectorTileFeature = { trusted: true };
    readonly _x = 0;
    readonly _y = 0;
    readonly _z = 0;
    readonly tile = { z: 0, x: 0, y: 0 };
    _geometry: unknown;

    constructor(
      feature?: unknown, z?: unknown, x?: unknown, y?: unknown, id?: unknown,
    ) { void [feature, z, x, y, id]; }

    projectPoint(point: unknown, x0: unknown, y0: unknown, size: unknown): never {
      void [point, x0, y0, size];
      throw new Error('fixture method is not invoked directly');
    }
    projectLine(line: unknown, x0: unknown, y0: unknown, size: unknown): never {
      void [line, x0, y0, size];
      throw new Error('fixture method is not invoked directly');
    }
    get geometry(): unknown {
      impostorCalls += 1;
      this._geometry ??= { type: 'Point', coordinates: [10, 10] };
      return this._geometry;
    }
    set geometry(value: unknown) { this._geometry = value; }
    toJSON(): unknown {
      impostorCalls += 1;
      return {
        type: this.type,
        id: this.id,
        geometry: this.geometry,
        properties: this.properties,
      };
    }
  };
  const feature = new MapLibreGeoJSONFeature();
  map.sourceFeatures = [feature];

  const result = querySourceFeaturesBounded(map.asMap(), {
    sourceId: 'events', propertyAllowlist: ['category'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'INTERNAL');
  assert.deepEqual(result.features, []);
  assert.equal(result.returned, 0);
  assert.equal(impostorCalls, 0);

  let foreignGeometryReads = 0;
  class ForeignFeature {
    readonly type = 'Feature';
    readonly properties = { category: 'foreign' };
    get geometry(): unknown {
      foreignGeometryReads += 1;
      return { type: 'Point', coordinates: [99, 99] };
    }
  }
  map.sourceFeatures = [new ForeignFeature()];
  querySourceFeaturesBounded(map.asMap(), { sourceId: 'events' });
  assert.equal(foreignGeometryReads, 0);
});

test('an unprojectable MapLibre feature produces a structured failure without partial results', () => {
  const map = new FakeMap();
  const invalid = rawFeature(1);
  invalid.properties = { valid: true, invalid: () => 'not JSON' };
  map.sourceFeatures = [rawFeature(0), invalid];

  const result = querySourceFeaturesBounded(map.asMap(), { sourceId: 'roads' });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'INTERNAL');
  assert.deepEqual(result.features, []);
  assert.equal(result.returned, 0);
  assert.equal(result.serializedBytes, 2);
});

test('reflection failures and unreadable approved fields fail closed without partial results', () => {
  const rejectedResults = (feature: unknown): void => {
    const map = new FakeMap();
    map.sourceFeatures = [rawFeature(0), feature];
    const result = querySourceFeaturesBounded(map.asMap(), { sourceId: 'roads' });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, 'INTERNAL');
    assert.deepEqual(result.features, []);
    assert.equal(result.returned, 0);
    assert.equal(result.serializedBytes, 2);
  };

  const revoked = Proxy.revocable(rawFeature(1), {});
  revoked.revoke();
  rejectedResults(revoked.proxy);

  rejectedResults(new Proxy(rawFeature(2), {
    getOwnPropertyDescriptor() { throw new Error('reflection failure'); },
  }));

  const hiddenType = rawFeature(3);
  Object.defineProperty(hiddenType, 'type', {
    configurable: true, enumerable: false, value: 'Feature', writable: true,
  });
  rejectedResults(hiddenType);

  const accessorType = rawFeature(4);
  let getterReads = 0;
  Object.defineProperty(accessorType, 'type', {
    configurable: true,
    enumerable: true,
    get() { getterReads += 1; return 'Feature'; },
  });
  rejectedResults(accessorType);
  assert.equal(getterReads, 0);
});

test('properties are descriptor-sanitized before allowlisting and never expose hidden or dangerous keys', () => {
  const hiddenProperty = rawFeature(1);
  Object.defineProperty(hiddenProperty.properties as object, 'secret', {
    configurable: true, enumerable: false, value: 'not public', writable: true,
  });
  const dangerousProperty = rawFeature(2);
  Object.defineProperty(dangerousProperty.properties as object, '__proto__', {
    configurable: true, enumerable: true, value: 'poison', writable: true,
  });

  for (const feature of [hiddenProperty, dangerousProperty]) {
    const map = new FakeMap();
    map.sourceFeatures = [feature];
    const result = querySourceFeaturesBounded(map.asMap(), {
      sourceId: 'roads', propertyAllowlist: ['name', 'secret', '__proto__'],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, 'INTERNAL');
    assert.deepEqual(result.features, []);
  }
});

test('accounts for empty arrays, feature bytes, and comma bytes at exact boundaries', () => {
  const map = new FakeMap();
  const first = rawFeature(1);
  const second = rawFeature(2);
  map.sourceFeatures = [first, second];
  const firstBytes = jsonUtf8ByteLength(projectedFeature(1) as never);
  const secondBytes = jsonUtf8ByteLength(projectedFeature(2) as never);

  const empty = querySourceFeaturesBounded(map.asMap(), { sourceId: 'roads' }, {
    maxFeatures: 2, maxSerializedBytes: 2,
  });
  const exactFirst = querySourceFeaturesBounded(map.asMap(), { sourceId: 'roads' }, {
    maxFeatures: 2, maxSerializedBytes: 2 + firstBytes,
  });
  const exactBoth = querySourceFeaturesBounded(map.asMap(), { sourceId: 'roads' }, {
    maxFeatures: 2, maxSerializedBytes: 2 + firstBytes + 1 + secondBytes,
  });
  const noCommaRoom = querySourceFeaturesBounded(map.asMap(), { sourceId: 'roads' }, {
    maxFeatures: 2, maxSerializedBytes: 2 + firstBytes + secondBytes,
  });

  assert.deepEqual(empty.features, []);
  assert.equal(empty.serializedBytes, 2);
  assert.equal(empty.truncated, true);
  assert.equal(exactFirst.serializedBytes, 2 + firstBytes);
  assert.equal(exactFirst.returned, 1);
  assert.equal(exactBoth.serializedBytes, 2 + firstBytes + 1 + secondBytes);
  assert.equal(exactBoth.returned, 2);
  assert.equal(noCommaRoom.returned, 1);
  assert.equal(noCommaRoom.truncated, true);
});

test('uses foundation UTF-8 bytes exactly once per candidate for emoji, lone surrogates, and controls', () => {
  const map = new FakeMap();
  const first = rawFeature(1);
  first.properties = { emoji: '😀', lone: '\ud800', control: '\u0001' };
  const second = rawFeature(2);
  second.properties = { emoji: '😀', lone: '\ud800', control: '\u0001' };
  const expectedFirst = {
    ...projectedFeature(1),
    properties: { emoji: '😀', lone: '\ud800', control: '\u0001' },
  };
  const expectedSecond = {
    ...projectedFeature(2),
    properties: { emoji: '😀', lone: '\ud800', control: '\u0001' },
  };
  const firstBytes = jsonUtf8ByteLength(expectedFirst as never);
  const secondBytes = jsonUtf8ByteLength(expectedSecond as never);

  map.sourceFeatures = [first, second];
  const exact = querySourceFeaturesBounded(map.asMap(), { sourceId: 'roads' }, {
    maxFeatures: 2,
    maxSerializedBytes: 2 + firstBytes + 1 + secondBytes,
  });
  const oneByteShort = querySourceFeaturesBounded(map.asMap(), { sourceId: 'roads' }, {
    maxFeatures: 2,
    maxSerializedBytes: 2 + firstBytes + secondBytes,
  });

  assert.equal(exact.returned, 2);
  assert.equal(exact.serializedBytes, 2 + firstBytes + 1 + secondBytes);
  assert.equal(oneByteShort.returned, 1);
  assert.equal(oneByteShort.serializedBytes, 2 + firstBytes);
  assert.equal(oneByteShort.truncated, true);

  const countBound = querySourceFeaturesBounded(map.asMap(), { sourceId: 'roads' }, {
    maxFeatures: 1,
    maxSerializedBytes: 2 + firstBytes,
  });
  assert.equal(countBound.returned, 1);
});

test('has one candidate byte-count callsite and stops before the next count-limited candidate', async () => {
  const source = await readFile(
    new URL('../../../../src/adapters/maplibre/feature-query.ts', import.meta.url),
    'utf8',
  );
  assert.equal((source.match(/jsonUtf8ByteLength\(projected\)/g) ?? []).length, 1);

  const map = new FakeMap();
  map.sourceFeatures = [rawFeature(1), rawFeature(2)];
  const result = querySourceFeaturesBounded(map.asMap(), { sourceId: 'roads', limit: 1 });
  assert.equal(result.returned, 1);
  assert.equal(result.truncated, true);
});

test('truncates at the 1 MiB default and excludes a first oversized feature', () => {
  const map = new FakeMap();
  map.sourceFeatures = [rawFeature(1, 'x'.repeat(600_000)), rawFeature(2, 'y'.repeat(600_000))];
  const defaultBudget = querySourceFeaturesBounded(map.asMap(), { sourceId: 'roads' });
  map.sourceFeatures = [rawFeature(3, 'z'.repeat(1_100_000))];
  const oversizedFirst = querySourceFeaturesBounded(map.asMap(), { sourceId: 'roads' });

  assert.equal(defaultBudget.returned, 1);
  assert.equal(defaultBudget.truncated, true);
  assert.equal(defaultBudget.serializedBytes < DEFAULT_FEATURE_QUERY_LIMITS.maxSerializedBytes, true);
  assert.deepEqual(oversizedFirst.features, []);
  assert.equal(oversizedFirst.serializedBytes, 2);
  assert.equal(oversizedFirst.truncated, true);
});
