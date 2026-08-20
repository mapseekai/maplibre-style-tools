import assert from 'node:assert/strict';
import test from 'node:test';

import { createStyleToolError } from '../core/errors.js';
import type { StyleValidationResult } from '../core/validation.js';
import { validateStyleDocument } from './core-adapters.js';
import {
  createMcpToolEnvelopeSchema,
  mcpToolEnvelopeSchema,
  parseMcpToolEnvelope,
  parseOfficialCallToolResult,
  parseStyleToolErrorShape,
  styleToolErrorWireSchema,
  toolFailure,
  toolSuccess,
} from './output.js';
import type { McpTextToolResult } from './types.js';

test('toolSuccess keeps content JSON and structuredContent equal', () => {
  const result = toolSuccess('Style exported.', { revision: 3, layers: ['roads'] });
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(result.isError, undefined);
  assert.deepEqual(parseMcpToolEnvelope(result.structuredContent), result.structuredContent);
});

test('toolFailure has stable envelope fields', () => {
  const result = toolFailure(createStyleToolError(
    'NOT_FOUND', 'Session was not found.', undefined, { entity: 'session' },
  ));
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(result.isError, true);
  assert.equal(
    parseStyleToolErrorShape(result.structuredContent.success
      ? undefined
      : result.structuredContent.error).code,
    'NOT_FOUND',
  );
});

test('toolSuccess accepts core interface results and still emits an SDK record', () => {
  const validation: StyleValidationResult = validateStyleDocument({
    version: 8, sources: {}, layers: [],
  });
  const result = toolSuccess('Style is valid.', validation);
  const structured: Record<string, unknown> = result.structuredContent;
  assert.equal(structured.success, true);
  assert.equal(structured.message, 'Style is valid.');
});

test('failure result is assignable through a generic guarded return', async () => {
  const guarded: Promise<McpTextToolResult<number>> = Promise.resolve(
    toolFailure(createStyleToolError('NOT_FOUND', 'missing')),
  );
  assert.equal((await guarded).isError, true);
});

test('official result parser excludes the SDK compatibility wrapper before content access', () => {
  assert.equal(parseOfficialCallToolResult(toolSuccess('Done.', { value: 1 })).content[0]?.type, 'text');
  const compatibility = {
    toolResult: toolSuccess('Done.', { value: 1 }),
    content: [{ type: 'text', text: '{"success":true,"message":"Done.","data":{"value":1}}' }],
    structuredContent: { success: true, message: 'Done.', data: { value: 1 } },
    isError: false,
  };
  assert.throws(() => parseOfficialCallToolResult(compatibility), /compatibility wrapper/u);
  let getterCalls = 0;
  const hostile = { ...compatibility };
  Object.defineProperty(hostile, 'toolResult', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private getter');
    },
  });
  assert.throws(() => parseOfficialCallToolResult(hostile), /compatibility wrapper/u);
  assert.equal(getterCalls, 0);
});

test('wire schemas narrow envelopes without authenticating received errors', () => {
  const failure = { success: false, message: 'missing', error: { code: 'NOT_FOUND', message: 'missing' } };
  assert.deepEqual(styleToolErrorWireSchema.parse(failure.error), failure.error);
  assert.deepEqual(mcpToolEnvelopeSchema.parse(failure), failure);
  assert.equal(createMcpToolEnvelopeSchema(styleToolErrorWireSchema).safeParse({
    success: true,
    message: 'Done.',
    data: failure.error,
  }).success, true);
  assert.equal(styleToolErrorWireSchema.safeParse({
    code: 'NOT_A_CORE_CODE', message: 'missing',
  }).success, false);
});
