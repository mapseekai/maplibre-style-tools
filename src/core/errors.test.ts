import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createStyleToolError, isStyleToolError, STYLE_TOOL_ERROR_CODES,
} from './errors.js';

test('creates a serializable stable error', () => {
  assert.deepEqual(STYLE_TOOL_ERROR_CODES, [
    'INVALID_INPUT',
    'STYLE_INVALID',
    'NOT_FOUND',
    'CONFLICT',
    'DEPENDENCY_CONFLICT',
    'UNSUPPORTED_SOURCE',
    'REVISION_CONFLICT',
    'MAP_NOT_READY',
    'BRIDGE_DISCONNECTED',
    'CAPABILITY_DENIED',
    'IO_ERROR',
    'TIMEOUT',
    'INTERNAL',
  ]);
  const error = createStyleToolError('NOT_FOUND', 'missing', '/layers/0');
  assert.deepEqual(error, {
    code: 'NOT_FOUND', message: 'missing', path: '/layers/0',
  });
  assert.equal(isStyleToolError(error), true);
  assert.equal(isStyleToolError({ code: 'NOT_FOUND', message: 'forged' }), false);
});

test('checks error provenance without invoking hostile values', () => {
  let getCalls = 0;
  const hostile = new Proxy({}, {
    get() { getCalls += 1; throw new Error('must not run'); },
  });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.doesNotThrow(() => isStyleToolError(hostile));
  assert.doesNotThrow(() => isStyleToolError(revoked.proxy));
  assert.equal(isStyleToolError(hostile), false);
  assert.equal(isStyleToolError(revoked.proxy), false);
  assert.equal(getCalls, 0);
});
