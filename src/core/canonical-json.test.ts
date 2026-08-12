import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalizeJson } from './canonical-json.js';
import { sha256CanonicalJson } from '../adapters/maplibre/style-hash.js';

const INVALID_JSON_MESSAGE = 'Value must be a strict JSON tree.';

test('canonical JSON sorts object keys by UTF-16 code units and preserves array order', async () => {
  const left = {
    '\ud800': 1,
    z: { beta: true, alpha: null },
    '\ud7ff': 2,
    array: [{ second: 2, first: 1 }, 'tail'],
  };
  const right = {
    array: [{ first: 1, second: 2 }, 'tail'],
    '\ud7ff': 2,
    z: { alpha: null, beta: true },
    '\ud800': 1,
  };

  const canonical = canonicalizeJson(left);
  assert.equal(
    canonical,
    '{"array":[{"first":1,"second":2},"tail"],"z":{"alpha":null,"beta":true},"퟿":2,"\\ud800":1}',
  );
  assert.equal(canonicalizeJson(right), canonical);
  assert.notEqual(canonicalizeJson([1, 2]), canonicalizeJson([2, 1]));
  assert.equal(await sha256CanonicalJson({ b: 2, a: 1 }),
    '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
});

test('canonical JSON consumes only the descriptor-sanitized foundation snapshot', () => {
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'secret';
    },
  });

  let toJsonCalls = 0;
  const withToJson = {
    safe: true,
    toJSON() {
      toJsonCalls += 1;
      return { changed: true };
    },
  };
  const hidden = { visible: true };
  Object.defineProperty(hidden, 'hidden', { enumerable: false, value: 'secret' });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const shared = { value: 1 };
  const aliased = { first: shared, second: shared };

  for (const invalid of [accessor, withToJson, hidden, cyclic, aliased]) {
    assert.throws(
      () => canonicalizeJson(invalid),
      (error: unknown) => error instanceof TypeError && error.message === INVALID_JSON_MESSAGE,
    );
  }
  assert.equal(getterCalls, 0);
  assert.equal(toJsonCalls, 0);
});

test('canonical JSON accepts a transparent get-trap proxy without invoking property gets', () => {
  let getCalls = 0;
  const proxy = new Proxy({ nested: { b: 2, a: 1 } }, {
    get(target, key, receiver) {
      getCalls += 1;
      return Reflect.get(target, key, receiver);
    },
  });

  assert.equal(canonicalizeJson(proxy), '{"nested":{"a":1,"b":2}}');
  assert.equal(getCalls, 0);
});

test('hostile proxies and invalid primitive values fail with one stable safe error', () => {
  const hostile = new Proxy({}, {
    ownKeys() {
      throw new Error('do not leak this input-dependent detail');
    },
  });

  for (const invalid of [hostile, undefined, 1n, Symbol('secret'), () => 'secret', Number.NaN]) {
    assert.throws(
      () => canonicalizeJson(invalid),
      (error: unknown) => error instanceof TypeError
        && error.message === INVALID_JSON_MESSAGE
        && !error.message.includes('secret'),
    );
  }
});
