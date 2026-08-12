import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createCompactMapLibreStyleTools,
  createMapLibreStyleTools,
} from '../index.js';
import {
  COMPACT_LEGACY_TOOL_NAMES,
  FULL_LEGACY_TOOL_NAMES,
} from './tool-contracts.js';
import { createStyleToolError } from '../core/index.js';
import { toAiToolResult } from './result.js';
import type { AiStyleToolResult, CommonResultInput } from './result.js';

const noMap = () => null;

describe('legacy AI tool contracts', () => {
  it('preserves all 53 full tool names', () => {
    const tools = createMapLibreStyleTools({ getMap: noMap });
    assert.deepEqual(Object.keys(tools).filter((name) => FULL_LEGACY_TOOL_NAMES.includes(name as never)), [...FULL_LEGACY_TOOL_NAMES]);
    assert.equal(FULL_LEGACY_TOOL_NAMES.length, 53);
  });

  it('preserves all 5 compact tool names', () => {
    const tools = createCompactMapLibreStyleTools({ getMap: noMap });
    assert.deepEqual(Object.keys(tools).filter((name) => COMPACT_LEGACY_TOOL_NAMES.includes(name as never)), [...COMPACT_LEGACY_TOOL_NAMES]);
    assert.equal(COMPACT_LEGACY_TOOL_NAMES.length, 5);
  });
});

describe('unified AI result envelope', () => {
  it('preserves success/message/style and leaves frozen values unmodified', () => {
    const data = Object.freeze({ changedLayers: ['roads'] });
    const style = Object.freeze({ version: 8, layers: [] });
    const input: CommonResultInput<typeof data, typeof style> = Object.freeze({
      success: true,
      message: 'Updated roads.',
      data,
      style,
    });

    const result = toAiToolResult(input);
    assert.deepEqual(result, {
      success: true,
      message: 'Updated roads.',
      data,
      style,
    });
    assert.equal(result.data, data);
    assert.equal(result.style, style);
    assert.equal('error' in result, false);
  });

  it('emits an authentic error only for failures', () => {
    const error = createStyleToolError('INVALID_INPUT', 'Input is invalid.');
    const result = toAiToolResult({ success: false, message: 'Unable to update.', error });
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error, error);
    assert.equal('data' in result, false);
    assert.equal('style' in result, false);
  });

  it('uses the discriminant for compile-time result narrowing', () => {
    const success: AiStyleToolResult<{ id: string }> = {
      success: true,
      message: 'ok',
      data: { id: 'roads' },
    };
    assert.equal(success.success, true);
    // @ts-expect-error successful results cannot include errors.
    const invalid: AiStyleToolResult = { success: true, message: 'no', error: createStyleToolError('INTERNAL', 'no') };
    void invalid;
    // @ts-expect-error error is unavailable on the successful branch.
    const successError = success.error;
    void successError;

    const failure: AiStyleToolResult = {
      success: false,
      message: 'bad',
      error: createStyleToolError('INVALID_INPUT', 'bad'),
    };
    if (!failure.success) assert.equal(failure.error.code, 'INVALID_INPUT');
    // @ts-expect-error failures require an error.
    const missingError: AiStyleToolResult = { success: false, message: 'bad' };
    void missingError;
  });
});
