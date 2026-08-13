import assert from 'node:assert/strict';
import test from 'node:test';

import * as mcp from './main.js';

test('MCP public module is importable without starting a server', () => {
  assert.equal(typeof mcp, 'object');
  assert.equal(process.stdout.listenerCount('data'), 0);
});
