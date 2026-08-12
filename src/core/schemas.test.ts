import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import {
  createStyleTransactionSchema,
  jsonValueSchema,
  setLayerPropertiesOperationSchema,
  styleDocumentSchema,
  styleOperationSchema,
  styleTransactionSchema,
} from './schemas.js';
import type {
  JsonValue, SetLayerPropertiesOperation, StyleOperation, StyleTransaction,
} from './types.js';

type Extends<Actual, Expected> = [Actual] extends [Expected] ? true : false;
type Assert<T extends true> = T;
type _JsonValueOutput = Assert<Extends<z.output<typeof jsonValueSchema>, JsonValue>>;
type _SetLayerOutput = Assert<Extends<
  z.output<typeof setLayerPropertiesOperationSchema>, SetLayerPropertiesOperation
>>;
type _OperationOutput = Assert<Extends<z.output<typeof styleOperationSchema>, StyleOperation>>;
type _TransactionOutput = Assert<Extends<
  z.output<typeof styleTransactionSchema>, StyleTransaction
>>;
const compileAssertions: [
  _JsonValueOutput, _SetLayerOutput, _OperationOutput, _TransactionOutput,
] = [true, true, true, true];

const operation = (index = 0) => ({
  op: 'setLayerProperties' as const,
  layerId: `roads-${index}`,
  paint: { 'line-width': index },
});

test('parses a strict transaction and defaults validate to true', () => {
  const parsed = styleTransactionSchema.parse({ operations: [{
    op: 'setLayerProperties', layerId: 'roads',
    paint: { 'line-color': '#fff', 'line-width': null },
  }] });
  assert.equal(parsed.validate, true);
  assert.deepEqual(compileAssertions, [true, true, true, true]);
});

test('rejects operations that omit the discriminator', () => {
  assert.equal(styleTransactionSchema.safeParse({
    operations: [{ layerId: 'roads', paint: {} }],
  }).success, false);
});

test('rejects empty transactions, unknown fields, and nested non-JSON values', () => {
  assert.equal(styleTransactionSchema.safeParse({ operations: [] }).success, false);
  assert.equal(styleTransactionSchema.safeParse({
    operations: [{ op: 'setLayerProperties', layerId: 'roads', surprise: true }],
  }).success, false);
  assert.equal(styleOperationSchema.safeParse({
    ...operation(), surprise: true,
  }).success, false);
  assert.equal(styleTransactionSchema.safeParse({
    operations: [operation()], surprise: true,
  }).success, false);
  assert.equal(styleTransactionSchema.safeParse({ operations: [{
    op: 'setLayerProperties', layerId: 'roads', paint: { value: undefined },
  }] }).success, false);
});

test('reports one deterministic issue when operations exceed the configured limit', () => {
  assert.equal(styleTransactionSchema.safeParse({
    operations: Array.from({ length: 100 }, (_, index) => operation(index)),
  }).success, true);

  const tooLarge = styleTransactionSchema.safeParse({
    operations: Array.from({ length: 101 }, (_, index) => operation(index)),
  });
  assert.equal(tooLarge.success, false);
  if (!tooLarge.success) {
    assert.deepEqual(tooLarge.error.issues, [{
      code: 'custom',
      message: 'Too many operations',
      path: ['operations'],
      params: {
        reason: 'maxOperations', maxOperations: 100, actualOperations: 101,
      },
    }]);
  }

  assert.equal(createStyleTransactionSchema(101).safeParse({
    operations: Array.from({ length: 101 }, (_, index) => operation(index)),
  }).success, true);
});

test('reports the maxOperations issue even when an over-limit operation is invalid', () => {
  const operations: unknown[] = Array.from(
    { length: 101 }, (_, index) => operation(index),
  );
  operations[0] = { layerId: 'missing-discriminator' };

  const result = styleTransactionSchema.safeParse({ operations });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues.find((issue) => (
      issue.path.length === 1 && issue.path[0] === 'operations'
    )), {
      code: 'custom',
      message: 'Too many operations',
      path: ['operations'],
      params: {
        reason: 'maxOperations', maxOperations: 100, actualOperations: 101,
      },
    });
  }
});

test('rejects invalid configured operation limits synchronously', () => {
  for (const limit of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createStyleTransactionSchema(limit));
  }
});

test('enforces operation fields, nullable values, zoom range, and zoom ordering', () => {
  assert.equal(setLayerPropertiesOperationSchema.safeParse({
    op: 'setLayerProperties', layerId: 'roads', metadata: null,
    paint: { 'line-color': null }, layout: { visibility: null },
    minzoom: 0, maxzoom: 24,
  }).success, true);
  assert.equal(setLayerPropertiesOperationSchema.safeParse({
    op: 'setLayerProperties', layerId: '',
  }).success, false);
  assert.equal(setLayerPropertiesOperationSchema.safeParse({
    op: 'setLayerProperties', layerId: 'roads', minzoom: -1,
  }).success, false);
  assert.equal(setLayerPropertiesOperationSchema.safeParse({
    op: 'setLayerProperties', layerId: 'roads', maxzoom: 25,
  }).success, false);
  assert.equal(setLayerPropertiesOperationSchema.safeParse({
    op: 'setLayerProperties', layerId: 'roads', minzoom: 12, maxzoom: 8,
  }).success, false);
});

test('accepts style extension fields but requires its strict JSON-safe envelope', () => {
  const parsed = styleDocumentSchema.safeParse({
    version: 8,
    sources: { base: { type: 'vector', customSourceExtension: { enabled: true } } },
    layers: [{
      id: 'roads', type: 'line', customLayerExtension: ['valid'],
    }],
    customStyleExtension: { enabled: true },
  });
  assert.equal(parsed.success, true);
  assert.equal(styleDocumentSchema.safeParse({
    version: 7, sources: {}, layers: [],
  }).success, false);
  assert.equal(styleDocumentSchema.safeParse({
    version: 8, sources: [], layers: [],
  }).success, false);
  assert.equal(styleDocumentSchema.safeParse({
    version: 8, sources: {}, layers: [{ id: '', type: 'line' }],
  }).success, false);
  assert.equal(styleDocumentSchema.safeParse({
    version: 8, sources: {}, layers: [{ id: 'roads', type: '' }],
  }).success, false);
  assert.equal(styleDocumentSchema.safeParse({
    version: 8, sources: {}, layers: [], metadata: new Date(),
  }).success, false);
});

test('rejects every non-JSON primitive and exotic prototype', () => {
  for (const value of [
    undefined, () => undefined, Symbol('value'), 1n,
    Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    new Date(), new Map(), Object.create(null),
  ]) {
    assert.equal(jsonValueSchema.safeParse(value).success, false);
  }
  class CustomValue {
    value = true;
  }
  assert.equal(jsonValueSchema.safeParse(new CustomValue()).success, false);
});

test('rejects cycles, aliases, dangerous keys, and hidden or symbol properties', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(jsonValueSchema.safeParse(cyclic).success, false);

  const shared = { color: '#000' };
  assert.equal(jsonValueSchema.safeParse({ first: shared, second: shared }).success, false);

  for (const key of ['__proto__', 'prototype', 'constructor']) {
    const dangerous = JSON.parse(`{"${key}":true}`) as unknown;
    assert.equal(jsonValueSchema.safeParse(dangerous).success, false);
  }

  const hidden = { visible: true };
  Object.defineProperty(hidden, 'hidden', { value: true, enumerable: false });
  assert.equal(jsonValueSchema.safeParse(hidden).success, false);

  const symbolKeyed: Record<PropertyKey, unknown> = { visible: true };
  symbolKeyed[Symbol('hidden')] = true;
  assert.equal(jsonValueSchema.safeParse(symbolKeyed).success, false);
});

test('rejects array holes, non-canonical indexes, and extra array keys', () => {
  const hole = [1, 2, 3];
  assert.equal(Reflect.deleteProperty(hole, '1'), true);
  assert.equal(jsonValueSchema.safeParse(hole).success, false);

  const extra = [1, 2];
  Object.defineProperty(extra, 'extra', { value: true, enumerable: true });
  assert.equal(jsonValueSchema.safeParse(extra).success, false);

  const hidden = [1, 2];
  Object.defineProperty(hidden, 'hidden', { value: true, enumerable: false });
  assert.equal(jsonValueSchema.safeParse(hidden).success, false);
});

test('rejects accessors without invoking getters at any nesting depth', () => {
  let getterCalls = 0;
  const accessor: Record<PropertyKey, unknown> = {};
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('must not run'); },
  });
  assert.equal(jsonValueSchema.safeParse(accessor).success, false);

  const nestedPaint: Record<PropertyKey, unknown> = {};
  Object.defineProperty(nestedPaint, 'line-color', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('must not run'); },
  });
  assert.equal(setLayerPropertiesOperationSchema.safeParse({
    op: 'setLayerProperties', layerId: 'roads', paint: nestedPaint,
  }).success, false);
  assert.equal(styleOperationSchema.safeParse({
    op: 'setLayerProperties', layerId: 'roads', paint: nestedPaint,
  }).success, false);
  assert.equal(styleTransactionSchema.safeParse({ operations: [{
    op: 'setLayerProperties', layerId: 'roads', paint: nestedPaint,
  }] }).success, false);
  assert.equal(getterCalls, 0);
});

test('turns every hostile reflection trap into a safe parse failure', () => {
  const trapNames = ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'] as const;
  for (const trapName of trapNames) {
    const target = { version: 8, sources: {}, layers: [] };
    const hostile = new Proxy(target, {
      [trapName]() { throw new Error('hostile reflection'); },
    });
    assert.doesNotThrow(() => styleDocumentSchema.safeParse(hostile));
    assert.equal(styleDocumentSchema.safeParse(hostile).success, false);
  }

  const revoked = Proxy.revocable({ version: 8, sources: {}, layers: [] }, {});
  revoked.revoke();
  assert.doesNotThrow(() => styleDocumentSchema.safeParse(revoked.proxy));
  assert.equal(styleDocumentSchema.safeParse(revoked.proxy).success, false);
});

test('sanitizes transparent proxies before Zod or cloning can invoke get traps', () => {
  let getCalls = 0;
  const original = { version: 8, sources: {}, layers: [] };
  const proxied = new Proxy(original, {
    get() { getCalls += 1; throw new Error('must not run'); },
  });
  const parsed = styleDocumentSchema.safeParse(proxied);
  assert.equal(parsed.success, true);
  assert.equal(getCalls, 0);
  if (parsed.success) {
    assert.notStrictEqual(parsed.data, original);
    assert.doesNotThrow(() => structuredClone(parsed.data));
    assert.equal(Object.getPrototypeOf(parsed.data), Object.prototype);
  }
});

test('defines snapshot values without invoking inherited prototype setters', () => {
  const objectKey = 'schemaSnapshotObjectSetterProbe';
  const arrayKey = '777';
  const objectInput = { [objectKey]: 1 };
  const arrayInput = Array.from({ length: 778 }, (_, index) => index);
  const originalObjectDescriptor = Object.getOwnPropertyDescriptor(
    Object.prototype, objectKey,
  );
  const originalArrayDescriptor = Object.getOwnPropertyDescriptor(
    Array.prototype, arrayKey,
  );
  let setterCalls = 0;

  try {
    Object.defineProperty(Object.prototype, objectKey, {
      configurable: true,
      set(value: unknown) { setterCalls += 1; void value; },
    });
    Object.defineProperty(Array.prototype, arrayKey, {
      configurable: true,
      set(value: unknown) { setterCalls += 1; void value; },
    });

    const objectResult = jsonValueSchema.safeParse(objectInput);
    const arrayResult = jsonValueSchema.safeParse(arrayInput);
    assert.equal(setterCalls, 0);
    assert.equal(objectResult.success, true);
    assert.equal(arrayResult.success, true);
    if (
      !objectResult.success
      || typeof objectResult.data !== 'object'
      || objectResult.data === null
      || Array.isArray(objectResult.data)
    ) {
      assert.fail('expected an object snapshot');
    }
    assert.equal(Object.hasOwn(objectResult.data, objectKey), true);
    assert.equal(objectResult.data[objectKey], 1);
    if (!arrayResult.success || !Array.isArray(arrayResult.data)) {
      assert.fail('expected an array snapshot');
    }
    assert.equal(Object.hasOwn(arrayResult.data, arrayKey), true);
    assert.equal(arrayResult.data[777], 777);
  } finally {
    if (originalObjectDescriptor === undefined) {
      Reflect.deleteProperty(Object.prototype, objectKey);
    } else {
      Object.defineProperty(Object.prototype, objectKey, originalObjectDescriptor);
    }
    if (originalArrayDescriptor === undefined) {
      Reflect.deleteProperty(Array.prototype, arrayKey);
    } else {
      Object.defineProperty(Array.prototype, arrayKey, originalArrayDescriptor);
    }
  }
});

test('styleDocumentSchema preserves extension fields without invoking inherited setters', () => {
  const key = 'customStyleExtension';
  const input = {
    version: 8, sources: {}, layers: [], [key]: { enabled: true },
  };
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
  let setterCalls = 0;
  let result: ReturnType<typeof styleDocumentSchema.safeParse> | undefined;

  try {
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      set() { setterCalls += 1; throw new Error('must not run'); },
    });
    assert.doesNotThrow(() => {
      result = styleDocumentSchema.safeParse(input);
    });
    assert.equal(setterCalls, 0);
    if (result === undefined || !result.success) {
      assert.fail('expected the style document to parse');
    }
    assert.equal(Object.hasOwn(result.data, key), true);
    assert.deepEqual(result.data[key], { enabled: true });
  } finally {
    if (originalDescriptor === undefined) {
      Reflect.deleteProperty(Object.prototype, key);
    } else {
      Object.defineProperty(Object.prototype, key, originalDescriptor);
    }
  }

  assert.deepEqual(
    Object.getOwnPropertyDescriptor(Object.prototype, key), originalDescriptor,
  );
});

test('operation schemas preserve paint without invoking inherited setters', () => {
  const key = 'paint';
  const input = {
    op: 'setLayerProperties' as const,
    layerId: 'roads',
    paint: { 'line-color': '#fff' },
  };
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
  let setterCalls = 0;
  let directResult: ReturnType<
    typeof setLayerPropertiesOperationSchema.safeParse
  > | undefined;
  let unionResult: ReturnType<typeof styleOperationSchema.safeParse> | undefined;

  try {
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      set() { setterCalls += 1; throw new Error('must not run'); },
    });
    assert.doesNotThrow(() => {
      directResult = setLayerPropertiesOperationSchema.safeParse(input);
      unionResult = styleOperationSchema.safeParse(input);
    });
    assert.equal(setterCalls, 0);
    if (directResult === undefined || !directResult.success) {
      assert.fail('expected the direct operation schema to parse');
    }
    if (unionResult === undefined || !unionResult.success) {
      assert.fail('expected the operation union schema to parse');
    }
    assert.equal(Object.hasOwn(directResult.data, key), true);
    assert.equal(Object.hasOwn(unionResult.data, key), true);
    assert.deepEqual(directResult.data.paint, { 'line-color': '#fff' });
    assert.deepEqual(unionResult.data.paint, { 'line-color': '#fff' });
  } finally {
    if (originalDescriptor === undefined) {
      Reflect.deleteProperty(Object.prototype, key);
    } else {
      Object.defineProperty(Object.prototype, key, originalDescriptor);
    }
  }

  assert.deepEqual(
    Object.getOwnPropertyDescriptor(Object.prototype, key), originalDescriptor,
  );
});

test('transaction schemas preserve array indexes without invoking inherited setters', () => {
  const index = 777;
  const key = String(index);
  const operations = Array.from({ length: index + 1 }, (_, operationIndex) => (
    operation(operationIndex)
  ));
  const input = { operations };
  const configuredSchema = createStyleTransactionSchema(index + 1);
  const objectKey = 'operations';
  const originalObjectDescriptor = Object.getOwnPropertyDescriptor(
    Object.prototype, objectKey,
  );
  const originalArrayDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, key);
  let setterCalls = 0;
  let defaultResult: ReturnType<typeof styleTransactionSchema.safeParse> | undefined;
  let result: ReturnType<typeof configuredSchema.safeParse> | undefined;

  try {
    Object.defineProperty(Object.prototype, objectKey, {
      configurable: true,
      set() { setterCalls += 1; throw new Error('must not run'); },
    });
    Object.defineProperty(Array.prototype, key, {
      configurable: true,
      set() { setterCalls += 1; throw new Error('must not run'); },
    });
    assert.doesNotThrow(() => {
      defaultResult = styleTransactionSchema.safeParse({ operations: [operation()] });
      result = configuredSchema.safeParse(input);
    });
    assert.equal(setterCalls, 0);
    if (defaultResult === undefined || !defaultResult.success) {
      assert.fail('expected the default transaction schema to parse');
    }
    if (result === undefined || !result.success) {
      assert.fail('expected the configured transaction schema to parse');
    }
    assert.equal(Object.hasOwn(defaultResult.data, objectKey), true);
    assert.equal(Object.hasOwn(result.data.operations, key), true);
    assert.deepEqual(result.data.operations[index], operation(index));
  } finally {
    if (originalObjectDescriptor === undefined) {
      Reflect.deleteProperty(Object.prototype, objectKey);
    } else {
      Object.defineProperty(Object.prototype, objectKey, originalObjectDescriptor);
    }
    if (originalArrayDescriptor === undefined) {
      Reflect.deleteProperty(Array.prototype, key);
    } else {
      Object.defineProperty(Array.prototype, key, originalArrayDescriptor);
    }
  }

  assert.deepEqual(
    Object.getOwnPropertyDescriptor(Object.prototype, objectKey), originalObjectDescriptor,
  );
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(Array.prototype, key), originalArrayDescriptor,
  );
});
