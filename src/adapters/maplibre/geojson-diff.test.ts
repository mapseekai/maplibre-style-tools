import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { GeoJSONSourceDiff } from 'maplibre-gl';
import {
  DEFAULT_GEOJSON_LIMITS,
  DEFAULT_MAX_DIFF_BYTES,
  jsonUtf8ByteLength,
} from '../../core/index.js';
import type {
  GeoJsonPosition,
  JsonObject,
  JsonValue,
} from '../../core/index.js';
import {
  runtimeGeoJsonDiffUpdateSchema,
  runtimeGeoJsonSourceDiffSchema,
  sanitizeRuntimeGeoJsonSourceDiff,
} from './geojson-diff.js';
import type {
  RuntimeGeoJsonDiffUpdate,
  RuntimeGeoJsonFeaturePatch,
  RuntimeGeoJsonPropertyPatch,
  RuntimeGeoJsonSourceDiff,
} from './types.js';

type AssertTrue<Value extends true> = Value;
type DiffIsJson = AssertTrue<RuntimeGeoJsonSourceDiff extends JsonObject ? true : false>;
type PatchIsJson = AssertTrue<RuntimeGeoJsonFeaturePatch extends JsonObject ? true : false>;
type PropertyIsJson = AssertTrue<RuntimeGeoJsonPropertyPatch extends JsonObject ? true : false>;
const compileAssertions: [DiffIsJson, PatchIsJson, PropertyIsJson] = [true, true, true];

// @ts-expect-error incremental diff envelopes are closed
const extraDiff: RuntimeGeoJsonSourceDiff = { removeAll: true, extra: true };
// @ts-expect-error feature patch objects are closed
const extraPatch: RuntimeGeoJsonFeaturePatch = { id: 1, removeAllProperties: true, extra: true };
// @ts-expect-error property patch objects are closed
const extraProperty: RuntimeGeoJsonPropertyPatch = { key: 'name', value: 'road', extra: true };
const extraEnvelope: RuntimeGeoJsonDiffUpdate = {
  sourceId: 'roads', diff: { removeAll: true },
  // @ts-expect-error command envelopes are closed
  extra: true,
};
void extraDiff;
void extraPatch;
void extraProperty;
void extraEnvelope;

function assertFailure(
  value: unknown,
  expectedPath?: string,
  expectedReason?: string,
): void {
  const result = sanitizeRuntimeGeoJsonSourceDiff(value);
  assert.equal(result.ok, false);
  if (result.ok) assert.fail('expected the GeoJSON diff to fail');
  assert.equal(result.error.code, 'INVALID_INPUT');
  if (expectedPath !== undefined) assert.equal(result.error.path, expectedPath);
  if (expectedReason !== undefined) {
    assert.equal(result.error.details?.reason, expectedReason);
  }
  assert.equal(Object.hasOwn(result, 'value'), false);
}

function assertStrictSchemaPath(value: unknown, expectedPath: readonly PropertyKey[]): void {
  const parsed = runtimeGeoJsonSourceDiffSchema.safeParse(value);
  assert.equal(parsed.success, false);
  if (parsed.success) assert.fail('expected a strict schema failure');
  assert.deepEqual(parsed.error.issues[0]?.path, expectedPath);
}

function pointFeature(id: string | number, x = 0, y = 0) {
  return {
    type: 'Feature' as const,
    id,
    geometry: { type: 'Point' as const, coordinates: [x, y] as GeoJsonPosition },
    properties: { name: `feature-${id}` },
  };
}

function nestedObject(depth: number): JsonValue {
  let value: JsonValue = 'leaf';
  for (let index = 0; index < depth; index += 1) value = { child: value };
  return value;
}

test('sanitizes every diff, Feature, geometry, and property member into plain snapshots', () => {
  const input = {
    remove: ['shared'],
    add: [{
      type: 'Feature' as const,
      id: 'shared',
      bbox: [0, 0, 5, 6],
      geometry: {
        type: 'Point' as const,
        coordinates: [1, 2, 3],
        bbox: [1, 2, 1, 2],
        geometryForeign: { retained: ['yes'] },
      },
      properties: { name: 'old', nested: { value: true } },
      featureForeign: { retained: true },
    }],
    update: [{
      id: 'shared',
      newGeometry: {
        type: 'GeometryCollection' as const,
        geometries: [{ type: 'Point' as const, coordinates: [3, 4] }],
        replacementForeign: { retained: true },
      },
      removeProperties: ['obsolete'],
      addOrUpdateProperties: [{ key: 'name', value: { current: ['new', 1] } }],
    }],
  };

  const result = sanitizeRuntimeGeoJsonSourceDiff(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const compatible: GeoJSONSourceDiff = result.value;
  assert.deepEqual(compatible, input);
  assert.notStrictEqual(result.value, input);
  assert.notStrictEqual(result.value.add, input.add);
  assert.notStrictEqual(result.value.add?.[0], input.add[0]);
  assert.notStrictEqual(result.value.add?.[0]?.geometry, input.add[0]?.geometry);
  assert.notStrictEqual(result.value.add?.[0]?.properties, input.add[0]?.properties);
  assert.notStrictEqual(result.value.update?.[0], input.update[0]);
  assert.notStrictEqual(
    result.value.update?.[0]?.addOrUpdateProperties?.[0]?.value,
    input.update[0]?.addOrUpdateProperties[0]?.value,
  );
  assert.deepEqual(compileAssertions, [true, true, true]);
});

test('accepts all effective actions and preserves documented cross-list ID reuse', () => {
  const cases: RuntimeGeoJsonSourceDiff[] = [
    { removeAll: true },
    { remove: ['', 0, 1] },
    { add: [pointFeature('new')] },
    { update: [{ id: 1, newGeometry: { type: 'Point', coordinates: [1, 2] } }] },
    { update: [{ id: 1, removeAllProperties: true }] },
    { update: [{ id: 1, removeProperties: ['old'] }] },
    { update: [{ id: 1, addOrUpdateProperties: [{ key: 'new', value: null }] }] },
    {
      remove: ['shared'],
      add: [pointFeature('shared')],
      update: [{ id: 'shared', addOrUpdateProperties: [{ key: 'phase', value: 'updated' }] }],
    },
  ];
  for (const value of cases) assert.equal(runtimeGeoJsonSourceDiffSchema.safeParse(value).success, true);
});

test('rejects ineffective, empty, duplicate, and non-finite grammar values', () => {
  const cases: readonly unknown[] = [
    {},
    { removeAll: false },
    { remove: [] },
    { remove: [1, 1] },
    { remove: [Number.NaN] },
    { remove: [Number.POSITIVE_INFINITY] },
    { add: [] },
    { add: [{ type: 'Feature', geometry: null, properties: {} }] },
    { update: [] },
    { update: [{ id: 1 }] },
    { update: [{ id: 1, removeAllProperties: false }] },
    { update: [{ id: 1, newGeometry: null }] },
    { update: [{ id: Number.NaN, removeAllProperties: true }] },
    { update: [
      { id: 1, removeAllProperties: true },
      { id: 1, newGeometry: { type: 'Point', coordinates: [0, 0] } },
    ] },
    { update: [{ id: 1, removeProperties: [] }] },
    { update: [{ id: 1, removeProperties: ['name', 'name'] }] },
    { update: [{ id: 1, addOrUpdateProperties: [] }] },
    { update: [{ id: 1, addOrUpdateProperties: [{ key: '', value: true }] }] },
    { update: [{ id: 1, addOrUpdateProperties: [
      { key: 'name', value: true }, { key: 'name', value: false },
    ] }] },
    { update: [{ id: 1, addOrUpdateProperties: [{ key: 'constructor', value: true }] }] },
    { update: [{ id: 1, addOrUpdateProperties: [{ key: 'name', value: undefined }] }] },
  ];
  for (const value of cases) assertFailure(value);
});

test('strict errors identify the diff, update item, property item, and command envelope', () => {
  assertStrictSchemaPath({ removeAll: true, extra: true }, []);
  assertStrictSchemaPath(
    { update: [{ id: 1, removeAllProperties: true, extra: true }] },
    ['update', 0],
  );
  assertStrictSchemaPath(
    { update: [{ id: 1, addOrUpdateProperties: [{ key: 'name', value: true, extra: true }] }] },
    ['update', 0, 'addOrUpdateProperties', 0],
  );
  const envelope = runtimeGeoJsonDiffUpdateSchema.safeParse({
    sourceId: 'roads', diff: { removeAll: true }, extra: true,
  });
  assert.equal(envelope.success, false);
  if (!envelope.success) assert.deepEqual(envelope.error.issues[0]?.path, []);
});

test('translates synthetic GeoJSON validation paths back to the original diff', () => {
  assertFailure({
    add: [{
      type: 'Feature', geometry: { type: 'Point', coordinates: [0, Number.NaN] }, properties: {},
    }],
  }, '/add/0/geometry/coordinates/1');
  assertFailure({
    add: [{
      type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {}, bbox: [0, 0, 1],
    }],
  }, '/add/0/bbox');
  assertFailure({
    update: [{ id: 1, newGeometry: { type: 'LineString', coordinates: [[0, 0]] } }],
  }, '/update/0/newGeometry/coordinates');
  assertFailure({
    update: [{ id: 1, addOrUpdateProperties: [{ key: 'nested', value: nestedObject(33) }] }],
  }, `/update/0/addOrUpdateProperties/0/value${'/child'.repeat(32)}`, 'maxPropertyDepth');
});

test('numeric and escaped property keys retain string identity during path translation', () => {
  for (const [index, key] of ['0', '01', 'a/b~c'].entries()) {
    assertFailure({
      update: [{
        id: 1,
        addOrUpdateProperties: ['0', '01', 'a/b~c'].map((propertyKey) => ({
          key: propertyKey,
          value: propertyKey === key ? nestedObject(33) : null,
        })),
      }],
    }, `/update/0/addOrUpdateProperties/${index}/value${'/child'.repeat(32)}`,
    'maxPropertyDepth');
  }
});

test('the whole descriptor pass rejects hostile graphs without invoking getters or returning partial data', () => {
  let getterCalls = 0;
  const accessor: Record<string, unknown> = { removeAll: true };
  Object.defineProperty(accessor, 'hiddenAction', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('must not run'); },
  });
  const hidden = { removeAll: true };
  Object.defineProperty(hidden, 'secret', { enumerable: false, value: true });
  const dangerous = { removeAll: true };
  Object.defineProperty(dangerous, '__proto__', {
    configurable: true, enumerable: true, value: true, writable: true,
  });
  const cyclic: Record<string, unknown> = { removeAll: true };
  cyclic.self = cyclic;
  const alias = { nested: true };
  const aliased = {
    update: [{ id: 1, addOrUpdateProperties: [
      { key: 'first', value: alias }, { key: 'second', value: alias },
    ] }],
  };
  const withSymbol = { removeAll: true };
  Object.defineProperty(withSymbol, Symbol('secret'), { enumerable: true, value: true });
  const revoked = Proxy.revocable({ removeAll: true }, {});
  revoked.revoke();

  for (const value of [
    accessor,
    hidden,
    dangerous,
    cyclic,
    aliased,
    withSymbol,
    { update: [{ id: 1, addOrUpdateProperties: [{ key: 'bad', value: () => true }] }] },
    { update: [{ id: 1, addOrUpdateProperties: [{ key: 'bad', value: new Date() }] }] },
    revoked.proxy,
  ]) {
    assert.doesNotThrow(() => sanitizeRuntimeGeoJsonSourceDiff(value));
    assertFailure(value);
  }
  assert.equal(getterCalls, 0);
});

test('descriptor-safe proxies are read through descriptors and copied without get traps', () => {
  let getCalls = 0;
  const transparent = <Value extends object>(value: Value): Value => new Proxy(value, {
    get() { getCalls += 1; throw new Error('must not run'); },
  });
  const input = transparent({
    add: transparent([transparent({
      type: 'Feature' as const,
      geometry: transparent({
        type: 'Point' as const,
        coordinates: transparent([1, 2] as GeoJsonPosition),
      }),
      properties: transparent({ nested: transparent({ value: true }) }),
    })]),
  });
  const result = sanitizeRuntimeGeoJsonSourceDiff(input);
  assert.equal(result.ok, true);
  assert.equal(getCalls, 0);
  if (result.ok) {
    assert.notStrictEqual(result.value, input);
    assert.equal(Object.getPrototypeOf(result.value), Object.prototype);
  }
});

test('enforces exact and one-over complete-diff UTF-8 byte boundaries', () => {
  const createDiff = (padding: string): RuntimeGeoJsonSourceDiff => ({
    update: [{
      id: 'padded',
      addOrUpdateProperties: [{ key: 'padding', value: padding }],
    }],
  });
  const UTF8_PREFIX = '😀\ud800\u0001';
  const baseBytes = jsonUtf8ByteLength(createDiff(UTF8_PREFIX));
  const exact = createDiff(
    `${UTF8_PREFIX}${'x'.repeat(DEFAULT_MAX_DIFF_BYTES - baseBytes)}`,
  );
  const over = createDiff(
    `${UTF8_PREFIX}${'x'.repeat(DEFAULT_MAX_DIFF_BYTES - baseBytes + 1)}`,
  );
  assert.equal(jsonUtf8ByteLength(exact), DEFAULT_MAX_DIFF_BYTES);
  assert.equal(jsonUtf8ByteLength(over), DEFAULT_MAX_DIFF_BYTES + 1);
  assert.equal(sanitizeRuntimeGeoJsonSourceDiff(exact).ok, true);
  assertFailure(over, '', 'maxBytes');
});

test('enforces aggregate changed-feature count across remove, add, and update', () => {
  const exactlyAtLimit: RuntimeGeoJsonSourceDiff = {
    remove: Array.from({ length: DEFAULT_GEOJSON_LIMITS.maxFeatures }, (_, index) => index),
  };
  assert.equal(sanitizeRuntimeGeoJsonSourceDiff(exactlyAtLimit).ok, true);

  const overLimit: RuntimeGeoJsonSourceDiff = {
    remove: Array.from(
      { length: DEFAULT_GEOJSON_LIMITS.maxFeatures - 1 },
      (_, index) => index,
    ),
    add: [pointFeature('shared')],
    update: [{ id: 'shared', removeAllProperties: true }],
  };
  assertFailure(overLimit, '', 'maxFeatures');
});

test('enforces aggregate add-plus-update coordinate positions', { timeout: 120_000 }, () => {
  const additions = Array.from(
    { length: 500_000 },
    (): GeoJsonPosition => [0, 0],
  );
  const replacements = Array.from(
    { length: 500_001 },
    (): GeoJsonPosition => [1, 1],
  );
  assertFailure({
    add: [{
      type: 'Feature', id: 'shared', properties: {},
      geometry: { type: 'MultiPoint', coordinates: additions },
    }],
    update: [{
      id: 'shared', newGeometry: { type: 'MultiPoint', coordinates: replacements },
    }],
  }, '/update/0/newGeometry', 'maxCoordinatePositions');
});

test('uses the complete sanitized diff for one explicit wire-size count', async () => {
  const source = await readFile(
    new URL('../../../../src/adapters/maplibre/geojson-diff.ts', import.meta.url),
    'utf8',
  );
  assert.equal((source.match(/jsonUtf8ByteLength\(plainDiff\)/g) ?? []).length, 1);
});
