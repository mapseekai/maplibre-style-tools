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

function withThrowingArrayZeroSetter<Result>(run: () => Result) {
  const key = '0';
  const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, key);
  let setterCalls = 0;
  let result: Result | undefined;
  let thrown: unknown;
  try {
    Object.defineProperty(Array.prototype, key, {
      configurable: true,
      set() { setterCalls += 1; throw new Error('must not run'); },
    });
    try {
      result = run();
    } catch (error) {
      thrown = error;
    }
  } finally {
    if (originalDescriptor === undefined) {
      Reflect.deleteProperty(Array.prototype, key);
    } else {
      Object.defineProperty(Array.prototype, key, originalDescriptor);
    }
  }
  return { result, setterCalls, thrown };
}

type PrototypeDescriptorKind = 'accessor' | 'readonly';
type PrototypeDescriptorPlacement = 'direct' | 'inherited';

function installArrayPrototypeDescriptor(
  placement: PrototypeDescriptorPlacement,
  kind: PrototypeDescriptorKind,
) {
  const key = '777';
  const originalPrototype = Object.getPrototypeOf(Array.prototype);
  const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, key);
  const insertedPrototype = Object.create(originalPrototype) as object;
  let descriptorCalls = 0;
  const descriptor: PropertyDescriptor = kind === 'readonly'
    ? { configurable: true, value: 'blocked', writable: false }
    : {
        configurable: true,
        get() { descriptorCalls += 1; throw new Error('must not run'); },
        set() { descriptorCalls += 1; throw new Error('must not run'); },
      };
  Object.defineProperty(
    placement === 'direct' ? Array.prototype : insertedPrototype, key, descriptor,
  );
  if (placement === 'inherited') {
    Object.setPrototypeOf(Array.prototype, insertedPrototype);
  }
  return {
    calls: () => descriptorCalls,
    restore: () => {
      if (placement === 'inherited') {
        Object.setPrototypeOf(Array.prototype, originalPrototype);
      } else if (originalDescriptor === undefined) {
        Reflect.deleteProperty(Array.prototype, key);
      } else {
        Object.defineProperty(Array.prototype, key, originalDescriptor);
      }
    },
  };
}

async function withArrayPrototypeDescriptor<Result>(
  placement: PrototypeDescriptorPlacement,
  kind: PrototypeDescriptorKind,
  run: () => Result | Promise<Result>,
) {
  const pollution = installArrayPrototypeDescriptor(placement, kind);
  let result: Result | undefined;
  let thrown: unknown;
  try {
    try {
      result = await run();
    } catch (error) {
      thrown = error;
    }
  } finally {
    pollution.restore();
  }
  return { descriptorCalls: pollution.calls(), result, thrown };
}

function assertSafeFailure<Result>(outcome: {
  result: z.ZodSafeParseResult<Result> | undefined;
  setterCalls: number;
  thrown: unknown;
}): z.ZodError {
  assert.equal(outcome.thrown, undefined);
  assert.equal(outcome.setterCalls, 0);
  assert.equal(outcome.result?.success, false);
  if (outcome.result === undefined || outcome.result.success) {
    assert.fail('expected an authentic Zod failure');
  }
  assert.equal(outcome.result.error instanceof z.ZodError, true);
  return outcome.result.error;
}

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

test('transaction defaults validate without invoking an inherited getter-only accessor', () => {
  const key = 'validate';
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
  let getterCalls = 0;
  let result: ReturnType<typeof styleTransactionSchema.safeParse> | undefined;
  let thrown: unknown;
  try {
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      get() { getterCalls += 1; throw new Error('must not run'); },
    });
    try {
      result = styleTransactionSchema.safeParse({ operations: [operation()] });
    } catch (error) {
      thrown = error;
    }
  } finally {
    if (originalDescriptor === undefined) {
      Reflect.deleteProperty(Object.prototype, key);
    } else {
      Object.defineProperty(Object.prototype, key, originalDescriptor);
    }
  }
  assert.equal(thrown, undefined);
  assert.equal(getterCalls, 0);
  if (result === undefined || !result.success) assert.fail('expected a valid transaction');
  assert.equal(Object.hasOwn(result.data, key), true);
  assert.equal(result.data.validate, true);
});

test('jsonValueSchema fails safely when Array prototype index zero is a throwing setter', () => {
  const error = assertSafeFailure(withThrowingArrayZeroSetter(() => (
    jsonValueSchema.safeParse(undefined)
  )));
  assert.deepEqual(error.issues, [{
    code: 'custom', message: 'Input must be a strict JSON tree', path: [],
  }]);
});

test('styleDocumentSchema fails safely when Array prototype index zero is a throwing setter', () => {
  const input = { version: 7, sources: {}, layers: [] };
  const error = assertSafeFailure(withThrowingArrayZeroSetter(() => (
    styleDocumentSchema.safeParse(input)
  )));
  assert.deepEqual(error.issues, [{
    code: 'invalid_value', values: [8], path: ['version'],
    message: 'Invalid input: expected 8',
  }]);
});

test('styleOperationSchema fails safely when Array prototype index zero is a throwing setter', () => {
  const input = { layerId: 'roads' };
  const error = assertSafeFailure(withThrowingArrayZeroSetter(() => (
    styleOperationSchema.safeParse(input)
  )));
  assert.deepEqual(error.issues, [{
    code: 'invalid_union', errors: [], note: 'No matching discriminator',
    discriminator: 'op', options: ['setLayerProperties'], path: ['op'],
    message: "Invalid discriminator value. Expected 'setLayerProperties'",
  }]);
});

test('configured transaction schema fails safely when Array index zero is a throwing setter', () => {
  const input = { operations: [] };
  const schema = createStyleTransactionSchema(1);
  const error = assertSafeFailure(
    withThrowingArrayZeroSetter(() => schema.safeParse(input)),
  );
  assert.deepEqual(error.issues, [{
    origin: 'array', code: 'too_small', minimum: 1, inclusive: true,
    path: ['operations'], message: 'Too small: expected array to have >=1 items',
  }]);
});

test('polluted prototype preserves the deterministic maxOperations issue', () => {
  const schema = createStyleTransactionSchema(1);
  const input = { operations: [operation(), { layerId: 'invalid' }] };
  const error = assertSafeFailure(
    withThrowingArrayZeroSetter(() => schema.safeParse(input)),
  );
  assert.deepEqual(error.issues, [{
    code: 'custom', message: 'Too many operations', path: ['operations'],
    params: {
      reason: 'maxOperations', maxOperations: 1, actualOperations: 2,
    },
  }]);
});

test('sync parser methods detect numeric descriptors across the Array chain', async () => {
  const valid = { operations: Array.from({ length: 778 }, (_, index) => operation(index)) };
  const schema = createStyleTransactionSchema(778);
  for (const placement of ['direct', 'inherited'] as const) {
    for (const kind of ['accessor', 'readonly'] as const) {
      for (const method of ['safeParse', 'parse'] as const) {
        const outcome = await withArrayPrototypeDescriptor(
          placement, kind, () => schema[method](valid),
        );
        assert.equal(outcome.thrown, undefined, `${placement}/${kind}/${method}`);
        assert.equal(outcome.descriptorCalls, 0);
      }
      const invalid = await withArrayPrototypeDescriptor(
        placement, kind, () => schema.safeParse({ operations: [] }),
      );
      assert.equal(invalid.thrown, undefined);
      assert.equal(invalid.descriptorCalls, 0);
      assertSafeFailure({ ...invalid, setterCalls: invalid.descriptorCalls });
    }
  }
});

test('async parser methods detect Array chain descriptors for valid and invalid input', async () => {
  const valid = { operations: Array.from({ length: 778 }, (_, index) => operation(index)) };
  const schema = createStyleTransactionSchema(778);
  assert.strictEqual(schema.spa, schema.safeParseAsync);
  for (const placement of ['direct', 'inherited'] as const) {
    for (const kind of ['accessor', 'readonly'] as const) {
      for (const method of ['safeParseAsync', 'spa'] as const) {
        const parsed = await withArrayPrototypeDescriptor(
          placement, kind, () => schema[method](valid),
        );
        assert.equal(parsed.thrown, undefined, `${placement}/${kind}/${method}`);
        assert.equal(parsed.descriptorCalls, 0);
        assert.equal(parsed.result?.success, true);
        const invalid = await withArrayPrototypeDescriptor(
          placement, kind, () => schema[method]({ operations: [] }),
        );
        assert.equal(invalid.thrown, undefined);
        assert.equal(invalid.descriptorCalls, 0);
        assertSafeFailure({ ...invalid, setterCalls: invalid.descriptorCalls });
      }
      const parsed = await withArrayPrototypeDescriptor(
        placement, kind, () => schema.parseAsync(valid),
      );
      assert.equal(parsed.thrown, undefined);
      assert.equal(parsed.descriptorCalls, 0);
      assert.equal(parsed.result?.validate, true);
      const rejected = await withArrayPrototypeDescriptor(
        placement, kind, () => schema.parseAsync({ operations: [] }),
      );
      assert.equal(rejected.descriptorCalls, 0);
      assert.equal(rejected.thrown instanceof z.ZodError, true);
    }
  }
});

test('ignores inherited schema fields supplied by Object.prototype data properties', () => {
  const extensionKey = 'schemaPrototypeExtensionProbe';
  const keys = ['op', 'layerId', 'validate', extensionKey] as const;
  const originalDescriptors = keys.map((key) => (
    Object.getOwnPropertyDescriptor(Object.prototype, key)
  ));
  try {
    Object.defineProperties(Object.prototype, {
      op: { configurable: true, value: 'setLayerProperties', writable: true },
      layerId: { configurable: true, value: 'inherited', writable: true },
      validate: { configurable: true, value: false, writable: true },
      [extensionKey]: { configurable: true, value: 'blocked', writable: false },
    });

    const operationResult = styleOperationSchema.safeParse({});
    assert.equal(operationResult.success, false);

    const transactionResult = styleTransactionSchema.safeParse({
      operations: [operation()],
    });
    assert.equal(transactionResult.success, true);
    if (!transactionResult.success) assert.fail('expected a valid transaction');
    assert.equal(Object.hasOwn(transactionResult.data, 'validate'), true);
    assert.equal(transactionResult.data.validate, true);

    const styleResult = styleDocumentSchema.safeParse({
      version: 8, sources: {}, layers: [], [extensionKey]: { enabled: true },
    });
    assert.equal(styleResult.success, true);
    if (!styleResult.success) assert.fail('expected extension style to parse');
    assert.deepEqual(styleResult.data[extensionKey], { enabled: true });
  } finally {
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const descriptor = originalDescriptors[index];
      if (descriptor === undefined) {
        Reflect.deleteProperty(Object.prototype, key);
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
  for (let index = 0; index < keys.length; index += 1) {
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(Object.prototype, keys[index]),
      originalDescriptors[index],
    );
  }
});

test('Object prototype accessors cannot execute or supply schema fields', () => {
  const extensionKey = 'schemaPrototypeAccessorProbe';
  const keys = ['validate', 'op', 'layerId', extensionKey] as const;
  const originals = keys.map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key));
  let calls = 0;
  try {
    for (const key of keys) {
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        get() { calls += 1; throw new Error('must not run'); },
        set() { calls += 1; throw new Error('must not run'); },
      });
    }
    assert.equal(styleOperationSchema.safeParse({ layerId: 'roads' }).success, false);
    assert.equal(setLayerPropertiesOperationSchema.safeParse({
      op: 'setLayerProperties',
    }).success, false);
    const transaction = styleTransactionSchema.safeParse({ operations: [operation()] });
    assert.equal(transaction.success, true);
    if (!transaction.success) assert.fail('expected transaction to parse');
    assert.equal(transaction.data.validate, true);
    assert.equal(styleDocumentSchema.safeParse({
      version: 8, sources: {}, layers: [], [extensionKey]: true,
    }).success, true);
  } finally {
    keys.forEach((key, index) => {
      const descriptor = originals[index];
      if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, key);
      else Object.defineProperty(Object.prototype, key, descriptor);
    });
  }
  assert.equal(calls, 0);
});

test('replaced Object.prototype.hasOwnProperty selects the safe fallback', () => {
  const key = 'hasOwnProperty';
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
  if (originalDescriptor === undefined || !('value' in originalDescriptor)) {
    assert.fail('expected the built-in hasOwnProperty data descriptor');
  }
  let calls = 0;
  let result: ReturnType<typeof styleDocumentSchema.safeParse> | undefined;
  let thrown: unknown;
  try {
    Object.defineProperty(Object.prototype, key, {
      ...originalDescriptor,
      value() { calls += 1; throw new Error('must not run'); },
    });
    try {
      result = styleDocumentSchema.safeParse({
        version: 8,
        sources: { base: { type: 'vector' } },
        layers: [],
      });
    } catch (error) {
      thrown = error;
    }
  } finally {
    Object.defineProperty(Object.prototype, key, originalDescriptor);
  }
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(Object.prototype, key), originalDescriptor,
  );
  assert.equal(thrown, undefined);
  assert.equal(calls, 0);
  assert.equal(result?.success, true);
});

test('replaced Object.prototype.propertyIsEnumerable cannot run for paint', () => {
  const key = 'propertyIsEnumerable';
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
  if (originalDescriptor === undefined || !('value' in originalDescriptor)) {
    assert.fail('expected the built-in propertyIsEnumerable data descriptor');
  }
  const input = {
    op: 'setLayerProperties' as const,
    layerId: 'roads',
    paint: { 'line-color': '#fff' },
  };
  let calls = 0;
  let directResult: ReturnType<
    typeof setLayerPropertiesOperationSchema.safeParse
  > | undefined;
  let directThrown: unknown;
  let unionResult: ReturnType<typeof styleOperationSchema.safeParse> | undefined;
  let unionThrown: unknown;
  let transactionResult: ReturnType<typeof styleTransactionSchema.safeParse> | undefined;
  let transactionThrown: unknown;
  try {
    Object.defineProperty(Object.prototype, key, {
      ...originalDescriptor,
      value() { calls += 1; throw new Error('must not run'); },
    });
    try {
      directResult = setLayerPropertiesOperationSchema.safeParse(input);
    } catch (error) {
      directThrown = error;
    }
    try {
      unionResult = styleOperationSchema.safeParse(input);
    } catch (error) {
      unionThrown = error;
    }
    try {
      transactionResult = styleTransactionSchema.safeParse({ operations: [input] });
    } catch (error) {
      transactionThrown = error;
    }
  } finally {
    Object.defineProperty(Object.prototype, key, originalDescriptor);
  }
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(Object.prototype, key), originalDescriptor,
  );
  assert.equal(calls, 0);
  assert.equal(directThrown, undefined);
  assert.equal(unionThrown, undefined);
  assert.equal(transactionThrown, undefined);
  assert.equal(directResult?.success, true);
  assert.equal(unionResult?.success, true);
  assert.equal(transactionResult?.success, true);
});

test('replaced Object.prototype.constructor cannot expose a prototype trap', () => {
  const key = 'constructor';
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
  if (originalDescriptor === undefined || !('value' in originalDescriptor)) {
    assert.fail('expected the built-in constructor data descriptor');
  }
  let prototypeGets = 0;
  const replacement = new Proxy(function ReplacementObject() {}, {
    get(target, property, receiver) {
      if (property === 'prototype') {
        prototypeGets += 1;
        throw new Error('must not run');
      }
      return Reflect.get(target, property, receiver);
    },
  });
  let result: ReturnType<typeof styleDocumentSchema.safeParse> | undefined;
  let thrown: unknown;
  try {
    Object.defineProperty(Object.prototype, key, {
      ...originalDescriptor,
      value: replacement,
    });
    try {
      result = styleDocumentSchema.safeParse({
        version: 8,
        sources: { base: { type: 'vector' } },
        layers: [{ id: 'roads', type: 'line', paint: { 'line-color': '#fff' } }],
      });
    } catch (error) {
      thrown = error;
    }
  } finally {
    Object.defineProperty(Object.prototype, key, originalDescriptor);
  }
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(Object.prototype, key), originalDescriptor,
  );
  assert.equal(thrown, undefined);
  assert.equal(prototypeGets, 0);
  assert.equal(result?.success, true);
});

test('prototype reflection failures and cycles select the stable fallback', () => {
  const original = Object.getPrototypeOf(Array.prototype);
  const parents: object[] = [
    new Proxy(Object.create(original) as object, {
      ownKeys() { throw new Error('reflection must not escape'); },
    }),
  ];
  const cycle: object = new Proxy(Object.create(null) as object, {
    getPrototypeOf() { return cycle; },
  });
  parents.push(cycle);
  for (const parent of parents) {
    let result: ReturnType<typeof styleDocumentSchema.safeParse> | undefined;
    let thrown: unknown;
    try {
      Object.setPrototypeOf(Array.prototype, parent);
      try {
        result = styleDocumentSchema.safeParse(
          { version: 7, sources: {}, layers: [] },
          { error: () => 'clean parser unexpectedly ran' },
        );
      } catch (error) {
        thrown = error;
      }
    } finally {
      Object.setPrototypeOf(Array.prototype, original);
    }
    assert.equal(thrown, undefined);
    if (result === undefined || result.success) assert.fail('expected stable failure');
    assert.equal(result.error instanceof z.ZodError, true);
    assert.equal(result.error.issues[0]?.message, 'Invalid input: expected 8');
  }
});

test('polluted fallback preserves every exported boundary contract', () => {
  const fixtures: [z.ZodType, unknown, unknown][] = [
    [jsonValueSchema, { ok: [1] }, undefined],
    [styleDocumentSchema, { version: 8, sources: {}, layers: [] }, { version: 7 }],
    [setLayerPropertiesOperationSchema, operation(), { layerId: 'roads' }],
    [styleOperationSchema, operation(), { layerId: 'roads' }],
    [styleTransactionSchema, { operations: [operation()] }, { operations: [] }],
    [createStyleTransactionSchema(1), { operations: [operation()] }, { operations: [] }],
  ];
  for (const [schema, valid, invalid] of fixtures) {
    const outcome = withThrowingArrayZeroSetter(() => ({
      valid: schema.safeParse(valid), invalid: schema.safeParse(invalid),
    }));
    assert.equal(outcome.thrown, undefined);
    assert.equal(outcome.setterCalls, 0);
    assert.equal(outcome.result?.valid.success, true);
    const failure = outcome.result?.invalid;
    assert.equal(failure?.success, false);
    if (failure === undefined || failure.success) assert.fail('expected safe failure');
    assert.equal(failure.error instanceof z.ZodError, true);
  }
});

test('clean composition retains native Zod behavior', async () => {
  const composed = z.object({
    json: jsonValueSchema,
    style: styleDocumentSchema,
    operation: styleOperationSchema,
    transaction: styleTransactionSchema,
  });
  assert.equal((await composed.safeParseAsync({
    json: { ok: true },
    style: { version: 8, sources: {}, layers: [] },
    operation: operation(),
    transaction: { operations: [operation()] },
  })).success, true);
});

test('preserves parse context across every exported instance parser method', async () => {
  const input = { version: 7, sources: {}, layers: [] };
  assert.equal(typeof Object.prototype.toString, 'function');
  let callbackCalls = 0;
  const params: z.core.ParseContext<z.core.$ZodIssue> = {
    error: (issue) => {
      callbackCalls += 1;
      return `context:${issue.code}`;
    },
    jitless: true,
    reportInput: true,
  };
  const assertContextError = (error: z.ZodError) => {
    assert.equal(error.issues[0]?.message, 'context:invalid_value');
    assert.equal(Object.getOwnPropertyDescriptor(error.issues[0], 'input')?.value, 7);
  };

  const safeResult = styleDocumentSchema.safeParse(input, params);
  if (safeResult.success) assert.fail('expected safeParse to fail');
  assertContextError(safeResult.error);

  assert.throws(() => styleDocumentSchema.parse(input, params), (error) => {
    if (!(error instanceof z.ZodError)) return false;
    assertContextError(error);
    return true;
  });

  for (const method of ['safeParseAsync', 'spa'] as const) {
    const result = await styleDocumentSchema[method](input, params);
    if (result.success) assert.fail(`expected ${method} to fail`);
    assertContextError(result.error);
  }

  await assert.rejects(styleDocumentSchema.parseAsync(input, params), (error) => {
    if (!(error instanceof z.ZodError)) return false;
    assertContextError(error);
    return true;
  });
  assert.equal(callbackCalls, 5);
});

test('preserves the authoritative Zod issue contracts in clean environments', () => {
  const missingDiscriminator = styleOperationSchema.safeParse({
    layerId: 'roads', surprise: true,
  });
  const rootExtra = styleTransactionSchema.safeParse({
    operations: [operation()], surprise: true,
  });
  const version = styleDocumentSchema.safeParse({
    version: 7, sources: {}, layers: [],
  });
  const fieldType = styleOperationSchema.safeParse({
    op: 'setLayerProperties', layerId: 4,
  });
  const nonempty = styleTransactionSchema.safeParse({ operations: [] });
  const zoomRange = styleOperationSchema.safeParse({
    op: 'setLayerProperties', layerId: 'roads', minzoom: -1,
  });
  const zoomOrder = styleOperationSchema.safeParse({
    op: 'setLayerProperties', layerId: 'roads', minzoom: 12, maxzoom: 8,
  });
  const failures = [
    missingDiscriminator, rootExtra, version, fieldType,
    nonempty, zoomRange, zoomOrder,
  ];
  assert.equal(failures.every((result) => !result.success), true);
  const issueSets = failures.map((result) => {
    if (result.success) assert.fail('expected every contract fixture to fail');
    return result.error.issues;
  });
  assert.deepEqual(issueSets, [
    [{
      code: 'invalid_union', errors: [], note: 'No matching discriminator',
      discriminator: 'op', options: ['setLayerProperties'], path: ['op'],
      message: "Invalid discriminator value. Expected 'setLayerProperties'",
    }],
    [{
      code: 'unrecognized_keys', keys: ['surprise'], path: [],
      message: 'Unrecognized key: "surprise"',
    }],
    [{
      code: 'invalid_value', values: [8], path: ['version'],
      message: 'Invalid input: expected 8',
    }],
    [{
      expected: 'string', code: 'invalid_type', path: ['layerId'],
      message: 'Invalid input: expected string, received number',
    }],
    [{
      origin: 'array', code: 'too_small', minimum: 1, inclusive: true,
      path: ['operations'], message: 'Too small: expected array to have >=1 items',
    }],
    [{
      origin: 'number', code: 'too_small', minimum: 0, inclusive: true,
      path: ['minzoom'], message: 'Too small: expected number to be >=0',
    }],
    [{
      code: 'custom', path: ['maxzoom'],
      message: 'minzoom must be less than or equal to maxzoom',
    }],
  ]);
});

test('rejects legacy filter syntax on every operation filter field', () => {
  const legacy = ['==', 'kind', 'road'];
  const expression = ['==', ['get', 'kind'], 'road'];

  const legacyOperations: unknown[] = [
    { op: 'setLayerFilter', layerId: 'roads', mode: 'replace', filter: legacy },
    { op: 'setLayerFilter', layerId: 'roads', mode: 'and', filter: legacy },
    { op: 'setGeoJsonSourceFilter', sourceId: 'geo', mode: 'replace', filter: legacy },
    { op: 'addLayerFromSource', layerId: 'roads', sourceId: 'vector', type: 'line', filter: legacy },
    {
      op: 'addGeoJsonLayer', sourceId: 'geo', layerId: 'roads',
      data: { type: 'FeatureCollection', features: [] }, type: 'line', filter: legacy,
    },
    { op: 'addLayerDefinition', layer: { id: 'roads', type: 'line', source: 'vector', filter: legacy } },
    { op: 'deepMergeLayerDefinition', layerId: 'roads', patch: { filter: legacy } },
    { op: 'replaceLayerDefinition', layerId: 'roads', layer: { id: 'roads', type: 'line', filter: legacy } },
    {
      op: 'setLayerFilter', layerId: 'roads', mode: 'replace',
      filter: ['all', expression, ['==', 'class', 'primary']],
    },
    {
      op: 'setLayerFilter', layerId: 'roads', mode: 'replace',
      filter: ['all', ['==', 'class', 'primary'], expression],
    },
  ];
  for (const operation of legacyOperations) {
    const result = styleTransactionSchema.safeParse({ operations: [operation] });
    assert.equal(result.success, false, JSON.stringify(operation));
    if (!result.success) {
      assert.ok(
        result.error.issues.some((issue) => /legacy property filter/i.test(issue.message)),
        `expected legacy-filter issue for ${JSON.stringify(operation)}`,
      );
    }
  }

  const accepted: unknown[] = [
    { op: 'setLayerFilter', layerId: 'roads', mode: 'replace', filter: expression },
    { op: 'setLayerFilter', layerId: 'roads', mode: 'and', filter: ['has', 'name'] },
    { op: 'setGeoJsonSourceFilter', sourceId: 'geo', mode: 'replace', filter: expression },
    { op: 'addLayerDefinition', layer: { id: 'roads', type: 'line', filter: expression } },
    { op: 'deepMergeLayerDefinition', layerId: 'roads', patch: { filter: ['has', 'name'] } },
    {
      op: 'setLayerFilter', layerId: 'roads', mode: 'replace',
      filter: ['all', expression, ['has', 'name']],
    },
  ];
  for (const operation of accepted) {
    assert.equal(
      styleTransactionSchema.safeParse({ operations: [operation] }).success,
      true, JSON.stringify(operation),
    );
  }

  for (const legacyOnly of [['has', '$id'], ['in', 'kind', 'a', 'b'], ['none', ['==', 'kind', 'a']]]) {
    assert.equal(styleTransactionSchema.safeParse({ operations: [
      { op: 'setLayerFilter', layerId: 'roads', mode: 'replace', filter: legacyOnly },
    ] }).success, false, JSON.stringify(legacyOnly));
  }

  // Whole style documents keep accepting legacy filters (MapLibre spec parity).
  assert.equal(styleDocumentSchema.safeParse({
    version: 8,
    sources: { base: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] } },
    layers: [{ id: 'roads', type: 'line', source: 'base', filter: legacy }],
  }).success, true);
});
