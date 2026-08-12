import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import {
  DEFAULT_GEOJSON_LIMITS,
  geoJsonLimitsSchema,
  inlineGeoJsonSchema,
  validateInlineGeoJson,
} from './geojson.js';
import { jsonUtf8ByteLength } from './utf8.js';
import type {
  GeoJsonBbox,
  GeoJsonFeature,
  GeoJsonGeometry,
  GeoJsonLimits,
  GeoJsonLineCoordinates,
  GeoJsonLinearRing,
  GeoJsonPolygonCoordinates,
  GeoJsonPosition,
  InlineGeoJson,
  InlineGeoJsonValidationResult,
  JsonObject,
} from './types.js';
import {
  validateInlineGeoJson as publicValidateInlineGeoJson,
} from './index.js';

type Extends<Actual, Expected> = [Actual] extends [Expected] ? true : false;
type Assert<T extends true> = T;
type _PositionIsJson = Assert<Extends<GeoJsonPosition, number[]>>;
type _BboxIsClosed = Assert<Extends<GeoJsonBbox, [number, number, number, number]
  | [number, number, number, number, number, number]>>;
type _LineIsClosed = Assert<Extends<
  GeoJsonLineCoordinates,
  [GeoJsonPosition, GeoJsonPosition, ...GeoJsonPosition[]]
>>;
type _RingIsClosed = Assert<Extends<
  GeoJsonLinearRing,
  [GeoJsonPosition, GeoJsonPosition, GeoJsonPosition, GeoJsonPosition,
    ...GeoJsonPosition[]]
>>;
type _PolygonIsRings = Assert<Extends<GeoJsonPolygonCoordinates, GeoJsonLinearRing[]>>;
type _GeometryIsJson = Assert<Extends<GeoJsonGeometry, JsonObject>>;
type _FeatureIsJson = Assert<Extends<GeoJsonFeature, JsonObject>>;
type _InlineIsJson = Assert<Extends<InlineGeoJson, JsonObject>>;
type _LimitsSchemaOutput = Assert<Extends<
  z.output<typeof geoJsonLimitsSchema>, Partial<GeoJsonLimits>
>>;
type _InlineSchemaOutput = Assert<Extends<
  z.output<typeof inlineGeoJsonSchema>, InlineGeoJson
>>;
const compileAssertions: [
  _PositionIsJson, _BboxIsClosed, _LineIsClosed, _RingIsClosed,
  _PolygonIsRings, _GeometryIsJson, _FeatureIsJson, _InlineIsJson,
  _LimitsSchemaOutput, _InlineSchemaOutput,
] = [true, true, true, true, true, true, true, true, true, true];

const position = (x: number, y: number, ...rest: number[]): GeoJsonPosition => (
  [x, y, ...rest]
);
const ring = (): GeoJsonLinearRing => [
  position(0, 0), position(2, 0), position(1, 1), position(0, 0),
];

function nestedGeometryCollection(depth: number): JsonObject {
  let geometry: JsonObject = { type: 'Point', coordinates: [0, 0] };
  for (let currentDepth = 1; currentDepth < depth; currentDepth += 1) {
    geometry = { type: 'GeometryCollection', geometries: [geometry] };
  }
  return geometry;
}

const geometries: readonly GeoJsonGeometry[] = [
  { type: 'Point', coordinates: position(1, 2, 3) },
  { type: 'MultiPoint', coordinates: [position(1, 2), position(3, 4)] },
  { type: 'LineString', coordinates: [position(0, 0), position(1, 1)] },
  { type: 'MultiLineString', coordinates: [[position(0, 0), position(1, 1)]] },
  { type: 'Polygon', coordinates: [ring()] },
  { type: 'MultiPolygon', coordinates: [[ring()]] },
  {
    type: 'GeometryCollection',
    geometries: [
      { type: 'Point', coordinates: position(1, 2) },
      { type: 'LineString', coordinates: [position(0, 0), position(1, 1)] },
    ],
  },
];

function assertFailure(
  result: InlineGeoJsonValidationResult,
  path: string,
  reason?: string,
): void {
  assert.equal(result.ok, false);
  if (result.ok) assert.fail('expected GeoJSON validation failure');
  assert.equal(result.error.code, 'INVALID_INPUT');
  assert.equal(result.error.path, path);
  if (reason !== undefined) assert.equal(result.error.details?.reason, reason);
  assert.equal(Object.hasOwn(result, 'value'), false);
  assert.equal(Object.hasOwn(result, 'featureCount'), false);
  assert.equal(Object.hasOwn(result, 'coordinatePositionCount'), false);
}

function assertSchemaPath(value: unknown, expectedPath: readonly PropertyKey[]): void {
  const parsed = inlineGeoJsonSchema.safeParse(value);
  assert.equal(parsed.success, false);
  if (parsed.success) assert.fail('expected structural schema failure');
  assert.deepEqual(parsed.error.issues[0]?.path, expectedPath);
}

test('accepts every RFC geometry envelope and counts terminal positions', () => {
  const expectedCounts = [1, 2, 2, 2, 4, 4, 3];
  geometries.forEach((geometry, index) => {
    const parsed = inlineGeoJsonSchema.safeParse(geometry);
    assert.equal(parsed.success, true, geometry.type);
    const result = validateInlineGeoJson(geometry);
    assert.equal(result.ok, true, geometry.type);
    if (result.ok) {
      assert.equal(result.featureCount, 0);
      assert.equal(result.coordinatePositionCount, expectedCounts[index]);
    }
  });
  assert.deepEqual(compileAssertions, [
    true, true, true, true, true, true, true, true, true, true,
  ]);
  assert.strictEqual(publicValidateInlineGeoJson, validateInlineGeoJson);
});

test('accepts Feature, FeatureCollection, null geometry, and JSON-safe foreign members', () => {
  const nullFeature: GeoJsonFeature<null> = {
    type: 'Feature', id: 'empty', geometry: null, properties: null,
    bbox: [0, 0, 1, 1], foreign: { accepted: [true, 'yes'] },
  };
  const feature: GeoJsonFeature = {
    type: 'Feature', id: 7, geometry: geometries[0]!,
    properties: { order: 1 }, bbox: [0, 0, 0, 1, 1, 3],
  };
  const collection = {
    type: 'FeatureCollection' as const,
    features: [nullFeature, feature],
    foreign: 'kept',
  };
  const parsed = inlineGeoJsonSchema.safeParse(collection);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.notStrictEqual(parsed.data, collection);
    assert.deepEqual(parsed.data, collection);
  }
  const result = validateInlineGeoJson(collection);
  assert.deepEqual(result, {
    ok: true,
    value: collection,
    featureCount: 2,
    coordinatePositionCount: 1,
  });
});

test('rejects malformed known members at their exact JSON Pointer paths', () => {
  const cases: readonly [unknown, readonly PropertyKey[], string][] = [
    [{ coordinates: [1, 2] }, ['type'], '/type'],
    [{ type: 'Unknown', coordinates: [1, 2] }, ['type'], '/type'],
    [{ type: 'FeatureCollection' }, ['features'], '/features'],
    [{ type: 'FeatureCollection', features: {} }, ['features'], '/features'],
    [{ type: 'Feature', properties: {} }, ['geometry'], '/geometry'],
    [{ type: 'Feature', geometry: null }, ['properties'], '/properties'],
    [{ type: 'Feature', geometry: null, properties: [] }, ['properties'], '/properties'],
    [{ type: 'Feature', geometry: null, properties: {}, id: true }, ['id'], '/id'],
    [{ type: 'Feature', geometry: null, properties: {}, id: Number.NaN }, ['id'], '/id'],
    [{ type: 'GeometryCollection' }, ['geometries'], '/geometries'],
    [{ type: 'GeometryCollection', geometries: {} }, ['geometries'], '/geometries'],
    [{ type: 'Point' }, ['coordinates'], '/coordinates'],
    [{ type: 'Point', coordinates: {} }, ['coordinates'], '/coordinates'],
  ];
  for (const [value, schemaPath, pointer] of cases) {
    assertSchemaPath(value, schemaPath);
    assertFailure(validateInlineGeoJson(value), pointer);
  }
});

test('enforces exact coordinate nesting, finite components, line length, and closed rings', () => {
  const cases: readonly [unknown, readonly PropertyKey[], string][] = [
    [{ type: 'Point', coordinates: [1] }, ['coordinates'], '/coordinates'],
    [{ type: 'Point', coordinates: [[1, 2]] }, ['coordinates'], '/coordinates'],
    [{ type: 'Point', coordinates: [1, 2, '3'] }, ['coordinates', 2], '/coordinates/2'],
    [{ type: 'Point', coordinates: [1, 2, Number.NaN] },
      ['coordinates', 2], '/coordinates/2'],
    [{ type: 'Point', coordinates: [1, 2, Number.POSITIVE_INFINITY] },
      ['coordinates', 2], '/coordinates/2'],
    [{ type: 'MultiPoint', coordinates: [1, 2] }, ['coordinates', 0], '/coordinates/0'],
    [{ type: 'LineString', coordinates: [[0, 0]] }, ['coordinates'], '/coordinates'],
    [{ type: 'MultiLineString', coordinates: [[[0, 0]]] }, ['coordinates', 0], '/coordinates/0'],
    [{ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] },
      ['coordinates', 0], '/coordinates/0'],
    [{ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0, 1]]] },
      ['coordinates', 0], '/coordinates/0'],
    [{ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [0, 0]]]] },
      ['coordinates', 0, 0], '/coordinates/0/0'],
  ];
  for (const [value, schemaPath, pointer] of cases) {
    assertSchemaPath(value, schemaPath);
    assertFailure(validateInlineGeoJson(value), pointer);
  }

  const clockwise = {
    type: 'Polygon' as const,
    coordinates: [[position(0, 0), position(0, 1), position(1, 0), position(0, 0)]],
  };
  const result = validateInlineGeoJson(clockwise);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, clockwise);
});

test('accepts only exact finite four- or six-component bbox tuples', () => {
  for (const bbox of [[0, 0, 1, 1], [0, 0, 0, 1, 1, 1]]) {
    assert.equal(validateInlineGeoJson({
      type: 'Point', coordinates: [0, 0], bbox,
    }).ok, true);
  }
  for (const bbox of [[], [0], [0, 0], [0, 0, 1], [0, 0, 1, 1, 2],
    [0, 0, 1, 1, 2, 2, 3]]) {
    assertSchemaPath({ type: 'Point', coordinates: [0, 0], bbox }, ['bbox']);
    assertFailure(validateInlineGeoJson({ type: 'Point', coordinates: [0, 0], bbox }), '/bbox');
  }
  for (const [component, schemaPath, pointer] of [
    [[0], ['bbox', 0], '/bbox/0'],
    ['zero', ['bbox', 0], '/bbox/0'],
    [Number.NaN, ['bbox', 0], '/bbox/0'],
    [Number.POSITIVE_INFINITY, ['bbox', 0], '/bbox/0'],
  ] as const) {
    const bbox = [component, 0, 1, 1];
    assertSchemaPath({ type: 'Point', coordinates: [0, 0], bbox }, schemaPath);
    assertFailure(validateInlineGeoJson({ type: 'Point', coordinates: [0, 0], bbox }), pointer);
  }
});

test('whole-tree sanitization rejects hostile values independently in known and foreign members', () => {
  const accessor: Record<string, unknown> = {};
  let accessorCalls = 0;
  Object.defineProperty(accessor, 'bad', {
    enumerable: true,
    get() { accessorCalls += 1; throw new Error('must not run'); },
  });
  const hidden = { visible: true };
  Object.defineProperty(hidden, 'hidden', { enumerable: false, value: true });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const aliased = { value: true };
  const revoked = Proxy.revocable({ value: true }, {});
  revoked.revoke();

  const fixtures: readonly unknown[] = [
    { type: 'Feature', geometry: null, properties: accessor },
    { type: 'Point', coordinates: [0, 0], bbox: new Date() },
    { type: 'Feature', geometry: null, properties: {}, id: undefined },
    { type: 'Feature', geometry: null, properties: {}, id: Number.POSITIVE_INFINITY },
    { type: 'Point', coordinates: [0, 0], foreign: { toJSON() { return true; } } },
    { type: 'Point', coordinates: [0, 0], foreign: hidden },
    { type: 'Point', coordinates: [0, 0], foreign: cyclic },
    { type: 'Point', coordinates: [0, 0], first: aliased, second: aliased },
    { type: 'Point', coordinates: [0, 0], foreign: revoked.proxy },
  ];
  for (const fixture of fixtures) {
    assert.doesNotThrow(() => inlineGeoJsonSchema.safeParse(fixture));
    assert.equal(inlineGeoJsonSchema.safeParse(fixture).success, false);
    const result = validateInlineGeoJson(fixture);
    assert.equal(result.ok, false);
    if (result.ok) assert.fail('expected hostile value to be rejected');
    assert.equal(result.error.code, 'INVALID_INPUT');
  }
  assert.equal(accessorCalls, 0);
});

test('transparent descriptor-safe proxies become fresh plain snapshots with zero get calls', () => {
  let getCalls = 0;
  const transparent = <Value extends object>(value: Value): Value => new Proxy(value, {
    get() { getCalls += 1; throw new Error('must not run'); },
  });
  const original = {
    type: 'Feature' as const,
    geometry: transparent({
      type: 'Point' as const, coordinates: transparent([1, 2]),
    }),
    properties: transparent({ nested: transparent({ value: 'kept' }) }),
    foreign: transparent({ safe: true }),
  };
  const proxied = transparent(original);
  const parsed = inlineGeoJsonSchema.safeParse(proxied);
  assert.equal(parsed.success, true);
  assert.equal(getCalls, 0);
  if (parsed.success) {
    assert.notStrictEqual(parsed.data, original);
    assert.equal(Object.getPrototypeOf(parsed.data), Object.prototype);
    assert.notStrictEqual(parsed.data.geometry, original.geometry);
  }
  const validated = validateInlineGeoJson(proxied);
  assert.equal(validated.ok, true);
  assert.equal(getCalls, 0);
  if (validated.ok) assert.notStrictEqual(validated.value, original);
});

test('deep structural path bookkeeping grows linearly without materializing every prefix', () => {
  const descriptorCalls = (depth: number): number => {
    const descriptor = Reflect.getOwnPropertyDescriptor(
      Object, 'getOwnPropertyDescriptor',
    );
    if (descriptor === undefined) assert.fail('missing reflection descriptor');
    let calls = 0;
    Object.defineProperty(Object, 'getOwnPropertyDescriptor', {
      ...descriptor,
      value(target: object, key: PropertyKey) {
        calls += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    try {
      assert.equal(inlineGeoJsonSchema.safeParse(
        nestedGeometryCollection(depth),
      ).success, true);
    } finally {
      Object.defineProperty(Object, 'getOwnPropertyDescriptor', descriptor);
    }
    return calls;
  };

  const depth64Calls = descriptorCalls(64);
  const depth128Calls = descriptorCalls(128);
  assert.equal(
    depth128Calls < depth64Calls * 3,
    true,
    `depth64=${depth64Calls}, depth128=${depth128Calls}`,
  );
});

test('rejects a 4000-level geometry at the configured depth with the exact bounded path', {
  timeout: 5_000,
}, () => {
  const result = validateInlineGeoJson(
    nestedGeometryCollection(4_000),
    { maxGeometryDepth: 16 },
  );
  assertFailure(result, '/geometries/0'.repeat(16), 'maxGeometryDepth');
  if (!result.ok) {
    assert.deepEqual(result.error.details, {
      reason: 'maxGeometryDepth',
      maxGeometryDepth: 16,
      actualGeometryDepth: 17,
    });
  }
});

test('structural schema remains independent from the default aggregate feature budget', () => {
  const features = Array.from(
    { length: DEFAULT_GEOJSON_LIMITS.maxFeatures + 1 },
    () => ({ type: 'Feature', geometry: null, properties: null }),
  );
  assert.equal(inlineGeoJsonSchema.safeParse({
    type: 'FeatureCollection', features,
  }).success, true);
});

test('parses strict descriptor-safe positive-integer limit overrides before GeoJSON', () => {
  const valid = {
    maxBytes: 1,
    maxFeatures: 2,
    maxCoordinatePositions: 3,
    maxGeometryDepth: 4,
    maxPropertyDepth: 5,
  };
  assert.deepEqual(geoJsonLimitsSchema.parse(valid), valid);
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(geoJsonLimitsSchema.safeParse({ maxFeatures: value }).success, false);
  }
  assert.equal(geoJsonLimitsSchema.safeParse({ unknown: 1 }).success, false);

  let limitGetterCalls = 0;
  const accessorLimits: Record<string, unknown> = {};
  Object.defineProperty(accessorLimits, 'maxFeatures', {
    enumerable: true,
    get() { limitGetterCalls += 1; throw new Error('must not run'); },
  });
  let documentGetCalls = 0;
  const document = new Proxy({ type: 'Point', coordinates: [0, 0] }, {
    get() { documentGetCalls += 1; throw new Error('document must not be traversed'); },
    ownKeys() { throw new Error('document must not be traversed'); },
  });
  assertFailure(validateInlineGeoJson(document, accessorLimits), '/maxFeatures');
  assert.equal(limitGetterCalls, 0);
  assert.equal(documentGetCalls, 0);
});

test('enforces exact lowered feature, coordinate, geometry, and property limits', () => {
  const collection = {
    type: 'FeatureCollection' as const,
    features: [
      { type: 'Feature' as const, geometry: null, properties: null },
      { type: 'Feature' as const, geometry: null, properties: {} },
    ],
  };
  assert.equal(validateInlineGeoJson(collection, { maxFeatures: 2 }).ok, true);
  assertFailure(validateInlineGeoJson(collection, { maxFeatures: 1 }), '/features/1', 'maxFeatures');

  const multiPoint = { type: 'MultiPoint' as const, coordinates: [[0, 0], [1, 1]] };
  assert.equal(validateInlineGeoJson(multiPoint, { maxCoordinatePositions: 2 }).ok, true);
  assertFailure(
    validateInlineGeoJson(multiPoint, { maxCoordinatePositions: 1 }),
    '/coordinates/1',
    'maxCoordinatePositions',
  );

  const nestedGeometry = {
    type: 'GeometryCollection' as const,
    geometries: [{
      type: 'GeometryCollection' as const,
      geometries: [{ type: 'Point' as const, coordinates: [0, 0] }],
    }],
  };
  assert.equal(validateInlineGeoJson(nestedGeometry, { maxGeometryDepth: 3 }).ok, true);
  assertFailure(
    validateInlineGeoJson(nestedGeometry, { maxGeometryDepth: 2 }),
    '/geometries/0/geometries/0',
    'maxGeometryDepth',
  );

  const nestedProperties = {
    type: 'Feature' as const,
    geometry: null,
    properties: { array: [{ object: { value: true } }] },
  };
  assert.equal(validateInlineGeoJson(nestedProperties, { maxPropertyDepth: 3 }).ok, true);
  assertFailure(
    validateInlineGeoJson(nestedProperties, { maxPropertyDepth: 2 }),
    '/properties/array/0/object',
    'maxPropertyDepth',
  );
});

test('enforces a single foundation UTF-8 JSON byte boundary for escaped Unicode data', () => {
  const value = {
    type: 'Feature' as const,
    geometry: null,
    properties: { text: 'ASCII é 😀 " \\ \n \u0000 \uD800' },
  };
  const actualBytes = jsonUtf8ByteLength(value);
  assert.equal(validateInlineGeoJson(value, { maxBytes: actualBytes }).ok, true);
  const result = validateInlineGeoJson(value, { maxBytes: actualBytes - 1 });
  assertFailure(result, '', 'maxBytes');
  if (!result.ok) {
    assert.deepEqual(result.error.details, {
      reason: 'maxBytes', maxBytes: actualBytes - 1, actualBytes,
    });
  }
  assert.equal(DEFAULT_GEOJSON_LIMITS.maxBytes >= actualBytes, true);
});
