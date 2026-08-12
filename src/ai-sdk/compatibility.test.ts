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
