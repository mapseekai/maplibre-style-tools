import assert from 'node:assert/strict';
import test from 'node:test';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type {
  BrowserMapRuntime,
  BrowserRuntimeOptions,
} from '../bridge/browser-runtime.js';
import { createStyleToolError, type StyleDocument } from '../core/index.js';
import { createWebMcpExecutionBoundary } from './execution.js';
import type {
  MapLibreWebMcpToolName,
  WebMcpAuthorizationRequest,
  WebMcpInvocationEvent,
} from './types.js';

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const executionStyle: StyleDocument = { version: 8, sources: {}, layers: [] };

const runtime = (): BrowserMapRuntime => ({
  snapshot: () => ({
    revision: 0,
    styleHash: 'a'.repeat(64),
    style: executionStyle,
  }),
  noteExternalStyle: async () => ({
    revision: 0,
    styleHash: 'a'.repeat(64),
    style: executionStyle,
  }),
  execute: async () => { throw new Error('dispatch is injected in this test'); },
});

const testOptions = (getMap: () => MapLibreMap | null) => ({
  getMap,
  getContext: () => ({}),
  allowMutations: true,
  resourcePolicy: {
    baseUrl: 'https://example.test/',
    allowedResourceOrigins: ['https://example.test'],
  },
});

test('serializes invocations in call order', async () => {
  const map = {} as MapLibreMap;
  const first = deferred<void>();
  const started = deferred<void>();
  const calls: string[] = [];
  const boundary = createWebMcpExecutionBoundary(testOptions(() => map), {
    createRuntime: async () => runtime(),
    now: () => 1_000,
    dispatchCapability: async (name) => {
      calls.push(`start:${name}`);
      if (name === 'inspectStyle') started.resolve();
      if (name === 'inspectStyle') await first.promise;
      calls.push(`end:${name}`);
      return { success: true, message: 'ok', data: null } as const;
    },
  });

  const a = boundary.execute(
    'inspectStyle',
    { action: 'getRoot' },
    new AbortController().signal,
  );
  const b = boundary.execute(
    'queryMapFeatures',
    { target: 'rendered' },
    new AbortController().signal,
  );

  await started.promise;
  assert.deepEqual(calls, ['start:inspectStyle']);
  first.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(calls, [
    'start:inspectStyle',
    'end:inspectStyle',
    'start:queryMapFeatures',
    'end:queryMapFeatures',
  ]);
});

test('does not start queued work after cancellation', async () => {
  const map = {} as MapLibreMap;
  const first = deferred<void>();
  const calls: string[] = [];
  const boundary = createWebMcpExecutionBoundary(testOptions(() => map), {
    createRuntime: async () => runtime(),
    now: () => 1_000,
    dispatchCapability: async (name) => {
      calls.push(name);
      if (name === 'inspectStyle') await first.promise;
      return { success: true, message: 'ok', data: null } as const;
    },
  });

  const active = boundary.execute(
    'inspectStyle',
    { action: 'getRoot' },
    new AbortController().signal,
  );
  const controller = new AbortController();
  const queued = boundary.execute(
    'queryMapFeatures',
    { target: 'rendered' },
    controller.signal,
  );
  controller.abort();
  first.resolve();

  await active;
  await assert.rejects(queued, { name: 'AbortError' });
  assert.deepEqual(calls, ['inspectStyle']);
});

test('creates a new runtime only for a different map identity', async () => {
  const firstMap = {} as MapLibreMap;
  const secondMap = {} as MapLibreMap;
  let currentMap = firstMap;
  const createdFor: MapLibreMap[] = [];
  const boundary = createWebMcpExecutionBoundary(testOptions(() => currentMap), {
    createRuntime: async (map) => {
      createdFor.push(map);
      return runtime();
    },
    now: () => 1_000,
    dispatchCapability: async () => (
      { success: true, message: 'ok', data: null } as const
    ),
  });

  await boundary.execute(
    'inspectStyle',
    { action: 'getRoot' },
    new AbortController().signal,
  );
  await boundary.execute(
    'inspectStyle',
    { action: 'getRoot' },
    new AbortController().signal,
  );
  currentMap = secondMap;
  await boundary.execute(
    'inspectStyle',
    { action: 'getRoot' },
    new AbortController().signal,
  );

  assert.deepEqual(createdFor, [firstMap, secondMap]);
});

test('normalizes policy and maps mutation access to browser capabilities once', async () => {
  const map = {} as MapLibreMap;
  const runtimeOptions: BrowserRuntimeOptions[] = [];
  const boundary = createWebMcpExecutionBoundary({
    getMap: () => map,
    document: {
      baseURI: 'https://page.example/app/',
      location: { origin: 'https://page.example' },
    } as Document,
    allowMutations: true,
    resourcePolicy: {
      allowedUrlPrefixes: ['https://assets.example/styles/'],
    },
  }, {
    createRuntime: async (_map, options) => {
      runtimeOptions.push(options);
      return runtime();
    },
    now: () => 1_000,
    dispatchCapability: async () => (
      { success: true, message: 'ok', data: null } as const
    ),
  });

  await boundary.execute(
    'inspectStyle',
    { action: 'getRoot' },
    new AbortController().signal,
  );
  await boundary.execute(
    'inspectStyle',
    { action: 'getRoot' },
    new AbortController().signal,
  );

  assert.equal(runtimeOptions.length, 1);
  assert.deepEqual(runtimeOptions[0]?.capabilities, [
    'style.read',
    'features.query',
    'style.write',
    'runtime.state',
    'assets.write',
    'network.load',
  ]);
  assert.deepEqual(runtimeOptions[0]?.resourcePolicy, {
    baseUrl: 'https://page.example/app/',
    allowedResourceOrigins: ['https://page.example'],
    allowedUrlPrefixes: ['https://assets.example/styles/'],
    allowDataUrls: false,
    maxDataUrlBytes: 1_048_576,
    allowedProtocols: [],
  });
});

test('uses only read capabilities when mutations are disabled', async () => {
  const map = {} as MapLibreMap;
  let capabilities: BrowserRuntimeOptions['capabilities'] | undefined;
  const boundary = createWebMcpExecutionBoundary({
    ...testOptions(() => map),
    allowMutations: false,
  }, {
    createRuntime: async (_map, options) => {
      capabilities = options.capabilities;
      return runtime();
    },
    now: () => 1_000,
    dispatchCapability: async () => (
      { success: true, message: 'ok', data: null } as const
    ),
  });

  await boundary.execute(
    'inspectStyle', { action: 'getRoot' }, new AbortController().signal,
  );

  assert.deepEqual(capabilities, ['style.read', 'features.query']);
});

test('authorizes each invocation with its read-only classification', async () => {
  const map = {} as MapLibreMap;
  const requests: WebMcpAuthorizationRequest[] = [];
  const inspectInput = { action: 'getRoot' };
  const mutationInput = { transaction: { operations: [] } };
  const boundary = createWebMcpExecutionBoundary({
    ...testOptions(() => map),
    authorizeInvocation: async (request) => {
      requests.push(request);
      return true;
    },
  }, {
    createRuntime: async () => runtime(),
    now: () => 1_000,
    dispatchCapability: async () => (
      { success: true, message: 'ok', data: null } as const
    ),
  });

  await boundary.execute(
    'inspectStyle', inspectInput, new AbortController().signal,
  );
  await boundary.execute(
    'applyStyleTransaction', mutationInput, new AbortController().signal,
  );

  assert.deepEqual(requests, [
    { toolName: 'inspectStyle', input: inspectInput, readOnly: true },
    {
      toolName: 'applyStyleTransaction',
      input: mutationInput,
      readOnly: false,
    },
  ]);
});

for (const authorization of [
  { label: 'returns false', hook: async () => false },
  { label: 'throws', hook: async () => { throw new Error('private policy detail'); } },
] as const) {
  test(`returns a safe denial when authorization ${authorization.label}`, async () => {
    const map = {} as MapLibreMap;
    let dispatched = false;
    const events: WebMcpInvocationEvent[] = [];
    const times = [1_000, 1_025];
    const boundary = createWebMcpExecutionBoundary({
      ...testOptions(() => map),
      authorizeInvocation: authorization.hook,
      onInvocation: (event) => events.push(event),
    }, {
      createRuntime: async () => runtime(),
      now: () => times.shift() ?? 1_025,
      dispatchCapability: async () => {
        dispatched = true;
        return { success: true, message: 'not reached', data: null } as const;
      },
    });

    const result = await boundary.execute(
      'inspectStyle', { action: 'getRoot' }, new AbortController().signal,
    );

    assert.deepEqual(result, {
      success: false,
      message: 'WebMCP invocation was not authorized.',
      error: {
        code: 'CAPABILITY_DENIED',
        message: 'WebMCP invocation was not authorized.',
      },
    });
    assert.equal(dispatched, false);
    assert.deepEqual(events, [
      {
        phase: 'started',
        toolName: 'inspectStyle',
        action: 'getRoot',
        startedAt: 1_000,
      },
      {
        phase: 'failed',
        toolName: 'inspectStyle',
        action: 'getRoot',
        durationMs: 25,
        message: 'WebMCP invocation was not authorized.',
        code: 'CAPABILITY_DENIED',
      },
    ]);
  });
}

test('emits safe succeeded and failed invocation events', async () => {
  const map = {} as MapLibreMap;
  const events: WebMcpInvocationEvent[] = [];
  const times = [2_000, 2_005, 3_000, 3_009];
  let succeeds = true;
  const boundary = createWebMcpExecutionBoundary({
    ...testOptions(() => map),
    onInvocation: (event) => events.push(event),
  }, {
    createRuntime: async () => runtime(),
    now: () => times.shift() ?? 3_009,
    dispatchCapability: async () => succeeds
      ? { success: true, message: 'inspection complete', data: null }
      : {
        success: false,
        message: 'input rejected',
        error: createStyleToolError('INVALID_INPUT', 'input rejected'),
      },
  });

  await boundary.execute('inspectStyle', {
    action: 'getRoot',
    style: { metadata: { private: 'must not appear in events' } },
  }, new AbortController().signal);
  succeeds = false;
  await boundary.execute(
    'queryMapFeatures',
    { target: 'rendered' },
    new AbortController().signal,
  );

  assert.deepEqual(events, [
    {
      phase: 'started',
      toolName: 'inspectStyle',
      action: 'getRoot',
      startedAt: 2_000,
    },
    {
      phase: 'succeeded',
      toolName: 'inspectStyle',
      action: 'getRoot',
      durationMs: 5,
      message: 'inspection complete',
    },
    {
      phase: 'started',
      toolName: 'queryMapFeatures',
      startedAt: 3_000,
    },
    {
      phase: 'failed',
      toolName: 'queryMapFeatures',
      durationMs: 9,
      message: 'input rejected',
      code: 'INVALID_INPUT',
    },
  ]);
});

test('rejects unexpected throws with a safe invocation event', async () => {
  const map = {} as MapLibreMap;
  const events: WebMcpInvocationEvent[] = [];
  const times = [4_000, 4_007];
  const boundary = createWebMcpExecutionBoundary({
    ...testOptions(() => map),
    onInvocation: (event) => events.push(event),
  }, {
    createRuntime: async () => runtime(),
    now: () => times.shift() ?? 4_007,
    dispatchCapability: async () => {
      throw new Error('secret internal failure');
    },
  });

  await assert.rejects(boundary.execute(
    'inspectStyle', { action: 'getRoot' }, new AbortController().signal,
  ), /secret internal failure/u);
  assert.deepEqual(events, [
    {
      phase: 'started',
      toolName: 'inspectStyle',
      action: 'getRoot',
      startedAt: 4_000,
    },
    {
      phase: 'errored',
      toolName: 'inspectStyle',
      action: 'getRoot',
      durationMs: 7,
      message: 'WebMCP invocation failed.',
    },
  ]);
});

test('propagates active cancellation and emits an aborted event', async () => {
  const map = {} as MapLibreMap;
  const controller = new AbortController();
  const dispatchStarted = deferred<void>();
  const events: WebMcpInvocationEvent[] = [];
  const times = [5_000, 5_011];
  const boundary = createWebMcpExecutionBoundary({
    ...testOptions(() => map),
    onInvocation: (event) => events.push(event),
  }, {
    createRuntime: async () => runtime(),
    now: () => times.shift() ?? 5_011,
    dispatchCapability: async (_name, _authority, _input, signal) => {
      assert.equal(signal, controller.signal);
      dispatchStarted.resolve();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return { success: true, message: 'not reached', data: null } as const;
    },
  });

  const invocation = boundary.execute(
    'inspectStyle', { action: 'getRoot' }, controller.signal,
  );
  await dispatchStarted.promise;
  controller.abort();

  await assert.rejects(invocation, { name: 'AbortError' });
  assert.deepEqual(events, [
    {
      phase: 'started',
      toolName: 'inspectStyle',
      action: 'getRoot',
      startedAt: 5_000,
    },
    {
      phase: 'aborted',
      toolName: 'inspectStyle',
      action: 'getRoot',
      durationMs: 11,
    },
  ]);
});

test('isolates invocation observers from tool execution', async () => {
  const map = {} as MapLibreMap;
  let dispatches = 0;
  let observations = 0;
  const boundary = createWebMcpExecutionBoundary({
    ...testOptions(() => map),
    onInvocation: () => {
      observations += 1;
      throw new Error('observer failed');
    },
  }, {
    createRuntime: async () => runtime(),
    now: () => 6_000,
    dispatchCapability: async () => {
      dispatches += 1;
      return { success: true, message: 'ok', data: null } as const;
    },
  });

  const result = await boundary.execute(
    'inspectStyle', { action: 'getRoot' }, new AbortController().signal,
  );

  assert.equal(result.success, true);
  assert.equal(dispatches, 1);
  assert.equal(observations, 2);
});

test('reconciles external style before registry dispatch', async () => {
  const map = {} as MapLibreMap;
  const calls: string[] = [];
  const registryRuntime: BrowserMapRuntime = {
    ...runtime(),
    noteExternalStyle: async () => {
      calls.push('noteExternalStyle');
      return {
        revision: 0,
        styleHash: 'a'.repeat(64),
        style: executionStyle,
      };
    },
  };
  const boundary = createWebMcpExecutionBoundary(testOptions(() => map), {
    createRuntime: async () => registryRuntime,
    now: () => 7_000,
  });

  const result = await boundary.execute(
    'inspectStyle', { action: 'getRoot' }, new AbortController().signal,
  );

  assert.equal(result.success, true);
  assert.deepEqual(calls, ['noteExternalStyle']);
});

test('reconciles external style before every capability dispatch', async () => {
  const map = {} as MapLibreMap;
  const calls: string[] = [];
  const reconcilingRuntime: BrowserMapRuntime = {
    ...runtime(),
    noteExternalStyle: async () => {
      calls.push('note');
      return {
        revision: 0,
        styleHash: 'a'.repeat(64),
        style: executionStyle,
      };
    },
  };
  const boundary = createWebMcpExecutionBoundary(testOptions(() => map), {
    createRuntime: async () => reconcilingRuntime,
    now: () => 8_000,
    dispatchCapability: async () => {
      calls.push('dispatch');
      return { success: true, message: 'ok', data: null } as const;
    },
  });

  await boundary.execute(
    'inspectStyle', { action: 'getRoot' }, new AbortController().signal,
  );
  await boundary.execute(
    'inspectStyle', { action: 'getRoot' }, new AbortController().signal,
  );

  assert.deepEqual(calls, ['note', 'dispatch', 'note', 'dispatch']);
});

test('close prevents queued invocations from starting', async () => {
  const map = {} as MapLibreMap;
  const first = deferred<void>();
  const started = deferred<void>();
  const calls: MapLibreWebMcpToolName[] = [];
  const boundary = createWebMcpExecutionBoundary(testOptions(() => map), {
    createRuntime: async () => runtime(),
    now: () => 9_000,
    dispatchCapability: async (name) => {
      calls.push(name);
      if (name === 'inspectStyle') {
        started.resolve();
        await first.promise;
      }
      return { success: true, message: 'ok', data: null } as const;
    },
  });
  const active = boundary.execute(
    'inspectStyle', { action: 'getRoot' }, new AbortController().signal,
  );
  await started.promise;
  const queued = boundary.execute(
    'queryMapFeatures', { target: 'rendered' }, new AbortController().signal,
  );

  boundary.close();
  first.resolve();

  await active;
  await assert.rejects(queued, { name: 'AbortError' });
  assert.deepEqual(calls, ['inspectStyle']);
});

test('projects unavailable and throwing map accessors as MAP_NOT_READY', async () => {
  for (const getMap of [
    () => null,
    () => { throw new Error('private host failure'); },
  ]) {
    const boundary = createWebMcpExecutionBoundary(testOptions(getMap), {
      createRuntime: async () => runtime(),
      now: () => 10_000,
      dispatchCapability: async () => (
        { success: true, message: 'not reached', data: null } as const
      ),
    });

    const result = await boundary.execute(
      'inspectStyle', { action: 'getRoot' }, new AbortController().signal,
    );

    assert.deepEqual(result, {
      success: false,
      message: 'Map is not ready.',
      error: { code: 'MAP_NOT_READY', message: 'Map is not ready.' },
    });
  }
});

test('aborts before map access when cancellation occurs during authorization', async () => {
  const map = {} as MapLibreMap;
  const authorizationStarted = deferred<void>();
  const releaseAuthorization = deferred<void>();
  const controller = new AbortController();
  const events: WebMcpInvocationEvent[] = [];
  let mapAccesses = 0;
  let runtimeCreations = 0;
  let dispatches = 0;
  const boundary = createWebMcpExecutionBoundary({
    ...testOptions(() => {
      mapAccesses += 1;
      return map;
    }),
    authorizeInvocation: async () => {
      authorizationStarted.resolve();
      await releaseAuthorization.promise;
      return true;
    },
    onInvocation: (event) => events.push(event),
  }, {
    createRuntime: async () => {
      runtimeCreations += 1;
      return runtime();
    },
    now: () => 11_000,
    dispatchCapability: async () => {
      dispatches += 1;
      return { success: true, message: 'not reached', data: null } as const;
    },
  });

  const invocation = boundary.execute(
    'runMapCommand', { action: 'removeImage', imageId: 'marker' }, controller.signal,
  );
  await authorizationStarted.promise;
  controller.abort();
  releaseAuthorization.resolve();

  await assert.rejects(invocation, { name: 'AbortError' });
  assert.equal(mapAccesses, 0);
  assert.equal(runtimeCreations, 0);
  assert.equal(dispatches, 0);
  assert.equal(events.at(-1)?.phase, 'aborted');
});

test('cancellation wins when authorization rejects after abort', async () => {
  const map = {} as MapLibreMap;
  const authorizationStarted = deferred<void>();
  const releaseAuthorization = deferred<void>();
  const controller = new AbortController();
  let mapAccesses = 0;
  const boundary = createWebMcpExecutionBoundary({
    ...testOptions(() => {
      mapAccesses += 1;
      return map;
    }),
    authorizeInvocation: async () => {
      authorizationStarted.resolve();
      await releaseAuthorization.promise;
      throw new Error('private authorization failure');
    },
  }, {
    createRuntime: async () => runtime(),
    now: () => 11_500,
    dispatchCapability: async () => (
      { success: true, message: 'not reached', data: null } as const
    ),
  });

  const invocation = boundary.execute(
    'inspectStyle', { action: 'getRoot' }, controller.signal,
  );
  await authorizationStarted.promise;
  controller.abort();
  releaseAuthorization.resolve();

  await assert.rejects(invocation, { name: 'AbortError' });
  assert.equal(mapAccesses, 0);
});

test('aborts before reconciliation when cancellation occurs during runtime creation', async () => {
  const map = {} as MapLibreMap;
  const creationStarted = deferred<void>();
  const releaseCreation = deferred<void>();
  const controller = new AbortController();
  let reconciliations = 0;
  let dispatches = 0;
  const createdRuntime: BrowserMapRuntime = {
    ...runtime(),
    noteExternalStyle: async () => {
      reconciliations += 1;
      return {
        revision: 0,
        styleHash: 'a'.repeat(64),
        style: executionStyle,
      };
    },
  };
  const boundary = createWebMcpExecutionBoundary(testOptions(() => map), {
    createRuntime: async () => {
      creationStarted.resolve();
      await releaseCreation.promise;
      return createdRuntime;
    },
    now: () => 12_000,
    dispatchCapability: async () => {
      dispatches += 1;
      return { success: true, message: 'not reached', data: null } as const;
    },
  });

  const invocation = boundary.execute(
    'runMapCommand', { action: 'removeImage', imageId: 'marker' }, controller.signal,
  );
  await creationStarted.promise;
  controller.abort();
  releaseCreation.resolve();

  await assert.rejects(invocation, { name: 'AbortError' });
  assert.equal(reconciliations, 0);
  assert.equal(dispatches, 0);
});

test('aborts before dispatch when cancellation occurs during external style reconciliation', async () => {
  const map = {} as MapLibreMap;
  const reconciliationStarted = deferred<void>();
  const releaseReconciliation = deferred<void>();
  const controller = new AbortController();
  let dispatches = 0;
  const reconcilingRuntime: BrowserMapRuntime = {
    ...runtime(),
    noteExternalStyle: async () => {
      reconciliationStarted.resolve();
      await releaseReconciliation.promise;
      return {
        revision: 0,
        styleHash: 'a'.repeat(64),
        style: executionStyle,
      };
    },
  };
  const boundary = createWebMcpExecutionBoundary(testOptions(() => map), {
    createRuntime: async () => reconcilingRuntime,
    now: () => 13_000,
    dispatchCapability: async () => {
      dispatches += 1;
      return { success: true, message: 'not reached', data: null } as const;
    },
  });

  const invocation = boundary.execute(
    'runMapCommand', { action: 'removeImage', imageId: 'marker' }, controller.signal,
  );
  await reconciliationStarted.promise;
  controller.abort();
  releaseReconciliation.resolve();

  await assert.rejects(invocation, { name: 'AbortError' });
  assert.equal(dispatches, 0);
});

test('projects only recognized tool-specific actions into invocation events', async () => {
  const map = {} as MapLibreMap;
  const events: WebMcpInvocationEvent[] = [];
  let getterRead = false;
  const accessorInput = Object.defineProperty({}, 'action', {
    enumerable: true,
    get: () => {
      getterRead = true;
      return 'getRoot';
    },
  });
  const boundary = createWebMcpExecutionBoundary({
    ...testOptions(() => map),
    onInvocation: (event) => events.push(event),
  }, {
    createRuntime: async () => runtime(),
    now: () => 14_000,
    dispatchCapability: async () => (
      { success: true, message: 'ok', data: null } as const
    ),
  });

  await boundary.execute(
    'inspectStyle', { action: 'getRoot' }, new AbortController().signal,
  );
  await boundary.execute(
    'inspectStyle', { action: 'private-sensitive-text' }, new AbortController().signal,
  );
  await boundary.execute(
    'inspectStyle', { action: 'secret'.repeat(20_000) }, new AbortController().signal,
  );
  await boundary.execute(
    'queryMapFeatures', { action: 'getRoot' }, new AbortController().signal,
  );
  await boundary.execute(
    'inspectStyle', accessorInput, new AbortController().signal,
  );
  await boundary.execute(
    'runMapCommand', { action: 'removeImage' }, new AbortController().signal,
  );

  assert.equal(getterRead, false);
  assert.deepEqual(events
    .filter((event) => event.phase === 'started')
    .map((event) => event.action), [
    'getRoot',
    undefined,
    undefined,
    undefined,
    undefined,
    'removeImage',
  ]);
});

test('retries runtime creation after a transient same-map failure', async () => {
  const map = {} as MapLibreMap;
  let creationAttempts = 0;
  let dispatches = 0;
  const boundary = createWebMcpExecutionBoundary(testOptions(() => map), {
    createRuntime: async () => {
      creationAttempts += 1;
      if (creationAttempts === 1) throw new Error('transient runtime failure');
      return runtime();
    },
    now: () => 15_000,
    dispatchCapability: async () => {
      dispatches += 1;
      return { success: true, message: 'ok', data: null } as const;
    },
  });

  await assert.rejects(boundary.execute(
    'inspectStyle', { action: 'getRoot' }, new AbortController().signal,
  ), /transient runtime failure/u);
  const result = await boundary.execute(
    'inspectStyle', { action: 'getRoot' }, new AbortController().signal,
  );

  assert.equal(result.success, true);
  assert.equal(creationAttempts, 2);
  assert.equal(dispatches, 1);
});
