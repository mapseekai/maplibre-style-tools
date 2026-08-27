import assert from 'node:assert/strict';
import test from 'node:test';

import { registerMapLibreWebMcpTools } from 'maplibre-style-tools/webmcp';

import { projectInvocationEvent } from './activity-log.js';
import { PendingMapCommentStore, type FeatureReference } from './comment-targets.js';
import {
  addCommentTargetSafely,
  createWebMcpExampleLifetimes,
  registerCoreWebMcpToolsSafely,
  registerMapSelectionConsumptionTool,
  registerMapSelectionConsumptionToolSafely,
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
  const store = new PendingMapCommentStore({
    capacity: 20,
    idFactory: () => `map-selection-${++nextId}`,
    onRemove: () => { removed += 1; },
  });
  const feature = store.add({ comment: 'Feature comment', scope: 'feature', feature: selectionFeature });
  const layer = store.add({ comment: 'Layer comment', scope: 'layer', feature: selectionFeature });
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

test('keeps reset and picker active when custom registration removes core tools', async () => {
  const lifetimes = createWebMcpExampleLifetimes();
  let coreToolsRemoved = false;
  lifetimes.tools.signal.addEventListener('abort', () => { coreToolsRemoved = true; }, { once: true });
  let resetCalls = 0;
  const reset = new EventTarget();
  reset.addEventListener('click', () => { resetCalls += 1; }, { signal: lifetimes.page.signal });
  let pickerCalls = 0;
  const picker = new EventTarget();
  picker.addEventListener('click', () => { pickerCalls += 1; }, { signal: lifetimes.page.signal });
  const store = new PendingMapCommentStore({ capacity: 20, idFactory: () => 'map-selection-1' });
  const modelContext = {
    registerTool: async () => { throw new Error('custom registration failed'); },
  };

  const registered = await registerMapSelectionConsumptionToolSafely(modelContext, store, lifetimes.tools);

  assert.equal(registered, false);
  assert.equal(coreToolsRemoved, true);
  assert.equal(lifetimes.page.signal.aborted, false);
  reset.dispatchEvent(new Event('click'));
  picker.dispatchEvent(new Event('click'));
  assert.equal(resetCalls, 1);
  assert.equal(pickerCalls, 1);
  lifetimes.page.abort();
  assert.equal(lifetimes.tools.signal.aborted, true);
});

test('keeps page UI handlers active when core tool registration fails', async () => {
  const lifetimes = createWebMcpExampleLifetimes();
  const calls = { map: 0, picker: 0, reset: 0 };
  const map = new EventTarget();
  const picker = new EventTarget();
  const reset = new EventTarget();
  map.addEventListener('click', () => { calls.map += 1; }, { signal: lifetimes.page.signal });
  picker.addEventListener('click', () => { calls.picker += 1; }, { signal: lifetimes.page.signal });
  reset.addEventListener('click', () => { calls.reset += 1; }, { signal: lifetimes.page.signal });
  const support = { textContent: 'Checking WebMCP support…' } as unknown as HTMLElement;
  let registrationAttempts = 0;
  const documentValue = {
    baseURI: 'https://map.example/app/',
    location: { origin: 'https://map.example' },
    modelContext: {
      registerTool: async () => {
        registrationAttempts += 1;
        throw new Error('private registration failure');
      },
    },
  } as unknown as Document;

  const registration = await registerCoreWebMcpToolsSafely(
    () => registerMapLibreWebMcpTools({
      getMap: () => null,
      document: documentValue,
      signal: lifetimes.tools.signal,
    }),
    support,
    lifetimes.tools,
  );

  assert.equal(registration, undefined);
  assert.equal(registrationAttempts, 1);
  assert.equal(support.textContent, 'Site tools failed to register');
  assert.equal(support.textContent.includes('private'), false);
  assert.equal(lifetimes.tools.signal.aborted, true);
  assert.equal(lifetimes.page.signal.aborted, false);
  map.dispatchEvent(new Event('click'));
  picker.dispatchEvent(new Event('click'));
  reset.dispatchEvent(new Event('click'));
  assert.deepEqual(calls, { map: 1, picker: 1, reset: 1 });
});
