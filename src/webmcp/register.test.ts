import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWebMcpSupported,
  registerMapLibreWebMcpTools,
} from './register.js';
import type {
  RegisterMapLibreWebMcpToolsOptions,
  WebMcpModelContextLike,
  WebMcpToolDefinitionLike,
} from './types.js';

class FakeModelContext implements WebMcpModelContextLike {
  readonly tools = new Map<string, WebMcpToolDefinitionLike>();
  readonly registrations: Array<{ readonly tool: WebMcpToolDefinitionLike; readonly options: { readonly exposedTo?: readonly string[]; readonly signal?: AbortSignal } }> = [];
  readonly failure = new DOMException('registration failed', 'InvalidStateError');

  constructor(private readonly failOn?: number) {}

  async registerTool(
    tool: WebMcpToolDefinitionLike,
    options: { readonly exposedTo?: readonly string[]; readonly signal?: AbortSignal } = {},
  ): Promise<void> {
    if (this.tools.has(tool.name)) {
      throw new DOMException('duplicate', 'InvalidStateError');
    }
    if (this.failOn === this.registrations.length + 1) {
      throw this.failure;
    }
    this.tools.set(tool.name, tool);
    this.registrations.push({ tool, options });
    options.signal?.addEventListener('abort', () => this.tools.delete(tool.name), { once: true });
  }
}

const documentWith = (modelContext?: WebMcpModelContextLike): Document => ({
  ...(modelContext === undefined ? {} : { modelContext }),
  baseURI: 'https://map.example/app/',
  location: { origin: 'https://map.example' },
} as Document);

const registrationOptions = (
  modelContext: WebMcpModelContextLike,
  overrides: Partial<RegisterMapLibreWebMcpToolsOptions> = {},
): RegisterMapLibreWebMcpToolsOptions => ({
  getMap: () => null,
  document: documentWith(modelContext),
  ...overrides,
});

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

class DeferredFirstRegistrationContext implements WebMcpModelContextLike {
  readonly tools = new Map<string, WebMcpToolDefinitionLike>();
  readonly firstStarted = deferred<void>();
  readonly firstFinished = deferred<void>();
  calls = 0;

  async registerTool(
    tool: WebMcpToolDefinitionLike,
    options: { readonly exposedTo?: readonly string[]; readonly signal?: AbortSignal } = {},
  ): Promise<void> {
    this.calls += 1;
    this.tools.set(tool.name, tool);
    options.signal?.addEventListener('abort', () => this.tools.delete(tool.name), { once: true });
    if (this.calls === 1) {
      this.firstStarted.resolve();
      await this.firstFinished.promise;
    }
  }
}

test('reports unsupported WebMCP without reading a global document', async () => {
  assert.equal(isWebMcpSupported(documentWith()), false);
  assert.equal(isWebMcpSupported(), false);

  const registration = await registerMapLibreWebMcpTools({
    getMap: () => null,
    document: documentWith(),
  });

  assert.equal(registration.supported, false);
  assert.deepEqual(registration.toolNames, []);
  registration.close();
});

test('registers two default read-only WebMCP tools', async () => {
  const context = new FakeModelContext();
  const registration = await registerMapLibreWebMcpTools(registrationOptions(context));

  assert.equal(registration.supported, true);
  assert.deepEqual(registration.toolNames, ['inspectStyle', 'queryMapFeatures']);
  assert.deepEqual([...context.tools.keys()], ['inspectStyle', 'queryMapFeatures']);
  registration.close();
});

test('registers five WebMCP tools when mutations are enabled', async () => {
  const context = new FakeModelContext();
  const exposedTo = ['https://client.example'];
  const registration = await registerMapLibreWebMcpTools(registrationOptions(context, {
    allowMutations: true,
    exposedTo,
  }));

  assert.equal(registration.supported, true);
  assert.deepEqual(registration.toolNames, [
    'inspectStyle',
    'queryMapFeatures',
    'applyStyleTransaction',
    'applyStyleDocument',
    'runMapCommand',
  ]);
  assert.deepEqual([...context.tools.keys()], registration.toolNames);
  assert.notEqual(context.registrations[0]?.options.exposedTo, exposedTo);
  assert.deepEqual(context.registrations[0]?.options.exposedTo, exposedTo);
  registration.close();
});

test('close clears all registered WebMCP tools', async () => {
  const context = new FakeModelContext();
  const registration = await registerMapLibreWebMcpTools(registrationOptions(context));

  registration.close();

  assert.deepEqual([...context.tools.keys()], []);
});

test('rejects insecure exposedTo origins before registering tools', async () => {
  const context = new FakeModelContext();

  await assert.rejects(
    registerMapLibreWebMcpTools(registrationOptions(context, {
      exposedTo: ['http://client.example'],
    })),
    TypeError,
  );

  assert.deepEqual([...context.tools.keys()], []);
});

test('accepts origin-only HTTPS and loopback HTTP exposedTo origins', async () => {
  for (const origin of [
    'https://client.example',
    'http://localhost',
    'http://127.42.0.1',
    'http://[::1]',
  ]) {
    const context = new FakeModelContext();
    const registration = await registerMapLibreWebMcpTools(registrationOptions(context, {
      exposedTo: [origin],
    }));

    assert.deepEqual(context.registrations[0]?.options.exposedTo, [origin]);
    registration.close();
  }
});

test('rejects unsafe HTTP and non-origin exposedTo entries', async () => {
  for (const exposedTo of [
    'http://client.example',
    'http://192.168.1.1',
    'https://user@client.example',
    'https://client.example/',
    'https://client.example/path',
    'https://client.example?scope=map',
    'https://client.example#map',
    'data:text/plain,client',
    'client.example',
  ]) {
    const context = new FakeModelContext();

    await assert.rejects(
      registerMapLibreWebMcpTools(registrationOptions(context, {
        exposedTo: [exposedTo],
      })),
      TypeError,
    );
    assert.deepEqual([...context.tools.keys()], []);
  }
});

test('rejects an already-aborted registration signal with its reason', async () => {
  const context = new FakeModelContext();
  const controller = new AbortController();
  const reason = new DOMException('caller cancelled', 'AbortError');
  controller.abort(reason);

  await assert.rejects(
    registerMapLibreWebMcpTools(registrationOptions(context, { signal: controller.signal })),
    (error: unknown) => error === reason,
  );
  assert.deepEqual([...context.tools.keys()], []);
});

test('rolls back a partial WebMCP registration and preserves the DOMException', async () => {
  const context = new FakeModelContext(3);

  await assert.rejects(
    registerMapLibreWebMcpTools(registrationOptions(context, { allowMutations: true })),
    (error: unknown) => error === context.failure,
  );

  assert.deepEqual([...context.tools.keys()], []);
  const firstTool = context.registrations[0]?.tool;
  assert.notEqual(firstTool, undefined);
  await assert.rejects(
    async () => { await firstTool.execute({}, { signal: new AbortController().signal }); },
    { name: 'AbortError' },
  );
});

test('external abort closes the registration and close is idempotent', async () => {
  const context = new FakeModelContext();
  const controller = new AbortController();
  const registration = await registerMapLibreWebMcpTools(registrationOptions(context, {
    signal: controller.signal,
  }));

  controller.abort();
  registration.close();
  registration.close();

  assert.deepEqual([...context.tools.keys()], []);
  const firstTool = context.registrations[0]?.tool;
  assert.notEqual(firstTool, undefined);
  await assert.rejects(
    async () => { await firstTool.execute({}, { signal: new AbortController().signal }); },
    { name: 'AbortError' },
  );
});

test('rejects an external abort received during pending registration', async () => {
  const context = new DeferredFirstRegistrationContext();
  const controller = new AbortController();
  const reason = new DOMException('caller cancelled', 'AbortError');
  const registration = registerMapLibreWebMcpTools(registrationOptions(context, {
    signal: controller.signal,
  }));

  await context.firstStarted.promise;
  controller.abort(reason);
  context.firstFinished.resolve();

  await assert.rejects(registration, (error: unknown) => error === reason);
  assert.equal(context.calls, 1);
  assert.deepEqual([...context.tools.keys()], []);
});
