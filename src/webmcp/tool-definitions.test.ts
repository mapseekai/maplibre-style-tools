import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilityModelJsonSchema } from '../capabilities/model-schema.js';
import { createMapLibreWebMcpToolDefinitions } from './tool-definitions.js';

const execute = async () => ({ success: true, message: 'ok', data: null } as const);

test('defaults to the two read-only capability tools', () => {
  const tools = createMapLibreWebMcpToolDefinitions({ allowMutations: false, execute });
  assert.deepEqual(tools.map((tool) => tool.name), [
    'inspectStyle',
    'queryMapFeatures',
  ]);
  assert.equal(tools[0]?.annotations.readOnlyHint, true);
  assert.equal(tools[1]?.annotations.readOnlyHint, true);
  assert.equal(tools.every((tool) => tool.annotations.untrustedContentHint), true);
});

test('projects all five tools without schema drift', () => {
  const tools = createMapLibreWebMcpToolDefinitions({ allowMutations: true, execute });
  assert.deepEqual(tools.map((tool) => tool.name), [
    'inspectStyle',
    'queryMapFeatures',
    'applyStyleTransaction',
    'applyStyleDocument',
    'runMapCommand',
  ]);
  for (const tool of tools) {
    assert.deepEqual(tool.inputSchema, capabilityModelJsonSchema(tool.name));
    assert.equal(tool.annotations.untrustedContentHint, true);
  }
  assert.equal(tools.slice(2).every((tool) => !tool.annotations.readOnlyHint), true);
});
