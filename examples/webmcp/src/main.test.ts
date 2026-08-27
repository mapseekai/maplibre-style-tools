import assert from 'node:assert/strict';
import test from 'node:test';

import { projectInvocationEvent } from './activity-log.js';
import { renderWebMcpSupport } from './main.js';

test('projects only the safe fields from an invocation event', () => {
  const event = {
    phase: 'failed' as const,
    toolName: 'applyStyleTransaction' as const,
    action: 'setLayerProperties',
    durationMs: 42,
    message: 'Layer is unavailable.',
    code: 'NOT_FOUND',
  };

  assert.deepEqual(projectInvocationEvent(event), {
    toolName: 'applyStyleTransaction',
    action: 'setLayerProperties',
    phase: 'failed',
    durationMs: 42,
    message: 'Layer is unavailable.',
    code: 'NOT_FOUND',
  });
});

test('renders unsupported WebMCP without disabling a sibling reset button', () => {
  const host = { textContent: null } as unknown as HTMLElement;
  const resetButton = { disabled: false } as HTMLButtonElement;

  renderWebMcpSupport(host, {
    supported: false,
    toolNames: [],
    close() {},
  });

  assert.equal(host.textContent, 'Site tools unavailable');
  assert.equal(resetButton.disabled, false);
});
