import assert from 'node:assert/strict';
import test from 'node:test';

import { projectInvocationEvent } from './activity-log.js';
import { CommentTargetStore, type FeatureReference } from './comment-targets.js';
import {
  addCommentTargetSafely,
  registerMapSelectionConsumptionTool,
  renderWebMcpSupport,
} from './main.js';

const selectionFeature = {
  layerId: 'places-fill',
  sourceId: 'places',
  featureId: 1,
  lngLat: [0, 0] as const,
  properties: { class: 'park' },
} satisfies FeatureReference;

type RegisteredTool = {
  readonly name: string;
  readonly annotations?: Record<string, boolean>;
  readonly inputSchema?: { readonly required?: readonly string[] };
  readonly execute: (input: Record<string, unknown>, options: { readonly signal: AbortSignal }) => unknown | Promise<unknown>;
};

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

test('reports a bounded safe message when target creation fails', () => {
  let message = '';
  const target = addCommentTargetSafely(
    () => { throw new Error('internal marker failure'); },
    (nextMessage: string) => { message = nextMessage; },
  );

  assert.equal(target, undefined);
  assert.equal(message, 'Unable to create this comment target. Choose another target and try again.');
});

test('registers and executes the one-shot selection consumption tool', async () => {
  let nextId = 0;
  let removed = 0;
  const store = new CommentTargetStore({
    capacity: 20,
    idFactory: () => `map-selection-${++nextId}`,
    onRemove: () => { removed += 1; },
  });
  const feature = store.add({ scope: 'feature', feature: selectionFeature });
  const layer = store.add({ scope: 'layer', feature: selectionFeature });
  let tool: RegisteredTool | undefined;
  const modelContext = {
    registerTool: async (nextTool: RegisteredTool) => { tool = nextTool; },
  };

  await registerMapSelectionConsumptionTool(modelContext, store, new AbortController().signal);

  assert.ok(tool !== undefined);
  assert.equal(tool.name, 'consumeMapSelectionContexts');
  assert.deepEqual(tool.annotations, {
    readOnlyHint: false,
    untrustedContentHint: true,
  });
  assert.deepEqual(tool.inputSchema?.required, ['selectionIds']);
  const result = await tool.execute({ selectionIds: [feature.selectionId, layer.selectionId] }, {
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, {
    success: true,
    consumed: 2,
    contexts: [feature, layer],
  });
  assert.equal(store.size, 0);
  assert.equal(removed, 2);
});
