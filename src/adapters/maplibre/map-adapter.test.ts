import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import {
  applyPreparedStyleToMap,
  applyStyleDocumentOrUrlToMap,
  applyTransactionToMap,
  prepareTransactionForMap,
  toMapLibreStyleSpecification,
  type PreparedMapStyleTransaction,
} from './map-adapter.js';
import { hashStyle } from './style-hash.js';
import { canonicalizeJson } from '../../core/canonical-json.js';
import {
  createStyleToolError,
  isStyleToolError,
  jsonUtf8ByteLength,
  validateStyleDocument,
} from '../../core/index.js';
import type {
  ApplyTransactionToMapOptions,
  MapStyleApplyResult,
  MapStyleCurrentResult,
  PreparedStyleApplyOptions,
} from './types.js';
import type {
  JsonValue,
  StyleDocument,
  StyleToolError,
  StyleTransactionResult,
} from '../../core/index.js';

type EventName = 'style.load' | 'error';
type Listener = (event: { type: EventName; error?: Error }) => void;
type SetStyleCall = {
  style: StyleSpecification | string;
  options: { diff?: boolean } | undefined;
};

class FakeMap {
  style: StyleSpecification;
  loaded = false;
  readonly calls: Array<{ method: string; value?: unknown }> = [];
  readonly setStyleCalls: SetStyleCall[] = [];
  onSetStyle?: (style: StyleSpecification | string, options: { diff?: boolean } | undefined) => void;
  onGetStyle?: () => StyleSpecification;
  onListenerAdded?: (type: EventName, listener: Listener) => void;
  onListenerRemoved?: (type: EventName, listener: Listener) => void;
  private readonly listeners = new Map<EventName, Set<Listener>>();

  constructor(style: StyleSpecification) {
    this.style = style;
  }

  on(type: EventName, listener: Listener): { unsubscribe(): void } {
    this.calls.push({ method: 'on', value: type });
    let listeners = this.listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
    this.onListenerAdded?.(type, listener);
    return { unsubscribe: () => { listeners!.delete(listener); } };
  }

  off(type: EventName, listener: Listener): this {
    this.calls.push({ method: 'off', value: type });
    this.onListenerRemoved?.(type, listener);
    this.listeners.get(type)?.delete(listener);
    return this;
  }

  getStyle(): StyleSpecification {
    this.calls.push({ method: 'getStyle' });
    return this.onGetStyle?.() ?? this.style;
  }

  isStyleLoaded(): boolean {
    this.calls.push({ method: 'isStyleLoaded' });
    return this.loaded;
  }

  setStyle(
    style: StyleSpecification | string,
    options?: { diff?: boolean },
  ): this {
    this.calls.push({ method: 'setStyle', value: style });
    this.setStyleCalls.push({ style, options });
    this.loaded = false;
    this.onSetStyle?.(style, options);
    return this;
  }

  emit(type: EventName, error?: Error): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ type, error });
    }
  }

  install(style: StyleSpecification): void {
    this.style = style;
    this.loaded = true;
    this.emit('style.load');
  }

  asMap(): MapLibreMap {
    return this as unknown as MapLibreMap;
  }
}

function rawStyle(color = '#000'): StyleSpecification {
  return {
    version: 8,
    sources: {
      base: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] },
    },
    layers: [{
      id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads',
      paint: { 'line-color': color },
    }],
  };
}

function strictStyle(color = '#000'): StyleDocument {
  const result = validateStyleDocument(rawStyle(color));
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('fixture must validate');
  return result.style;
}

const colorTransaction = (color: string) => ({
  operations: [{
    op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': color },
  }],
});

function automaticInstall(fake: FakeMap): void {
  fake.onSetStyle = (input) => {
    if (typeof input === 'string') return;
    fake.install(input);
  };
}


function assertEmptyCommit(result: MapStyleApplyResult): void {
  assert.equal(result.applied, false);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, []);
}

async function waitForCondition(
  predicate: () => boolean,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const expiresAt = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= expiresAt) {
      assert.fail(`Timed out after ${timeoutMs}ms waiting for ${description}.`);
    }
    await new Promise<void>((resolve) => { setImmediate(resolve); });
  }
}

function styleColor(style: StyleDocument): JsonValue | undefined {
  return style.layers[0]?.paint?.['line-color'];
}

function specificationColor(style: StyleSpecification): unknown {
  const layer = style.layers?.[0];
  if (layer === undefined) return undefined;
  const paint = Reflect.get(layer, 'paint');
  return typeof paint === 'object' && paint !== null
    ? Reflect.get(paint, 'line-color')
    : undefined;
}

function isDeeplyFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  const work: object[] = [value];
  const seen = new WeakSet<object>();
  while (work.length > 0) {
    const current = work.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (!Object.isFrozen(current)) return false;
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined && 'value' in descriptor
        && typeof descriptor.value === 'object' && descriptor.value !== null) {
        work.push(descriptor.value);
      }
    }
  }
  return true;
}

test('result union locks authoritative branch narrowing and authentic errors', () => {
  const consumeCurrent = (result: MapStyleCurrentResult): void => { void result; };
  const narrow = (result: MapStyleApplyResult): void => {
    if (result.styleAuthority === 'current') {
      consumeCurrent(result);
      void result.style;
      if (result.ok) {
        // @ts-expect-error success has no error member
        void result.error;
      } else {
        const error: StyleToolError = result.error;
        void error;
      }
    } else if (result.styleAuthority === 'pre-operation') {
      void result.style;
      const error: StyleToolError = result.error;
      // @ts-expect-error saved pre-operation Style is not current authority
      consumeCurrent(result);
      void error;
    } else {
      // @ts-expect-error unavailable has no style member
      void result.style;
      const error: StyleToolError = result.error;
      // @ts-expect-error unavailable is not current authority
      consumeCurrent(result);
      void error;
    }
  };
  void narrow;

  const validSuccess: StyleTransactionResult = {
    ok: true,
    style: strictStyle(), changedLayers: [], changedSources: [], diff: [], warnings: [],
  };
  // @ts-expect-error core failure requires an authentic error field
  const missingError: StyleTransactionResult = {
    ok: false,
    style: strictStyle(), changedLayers: [], changedSources: [], diff: [], warnings: [],
  };
  const invalidSuccess: StyleTransactionResult = {
    ok: true,
    style: strictStyle(), changedLayers: [], changedSources: [], diff: [], warnings: [],
    // @ts-expect-error success branch may not carry an error
    error: createStyleToolError('INTERNAL', 'not allowed'),
  };
  // eslint-disable-next-line no-constant-condition -- compile-only negative assertion.
  if (false) {
    // @ts-expect-error direct success error access is forbidden
    void validSuccess.error;
  }
  void missingError;
  void invalidSuccess;
});

test('reverse conversion is identity-preserving and statically restricted to strict core Styles', () => {
  const strict = strictStyle();
  assert.strictEqual(toMapLibreStyleSpecification(strict), strict);

  // eslint-disable-next-line no-constant-condition -- compile-only negative assertions.
  if (false) {
    const unknownValue: unknown = rawStyle();
    // @ts-expect-error unknown input has not crossed core validation
    toMapLibreStyleSpecification(unknownValue);
    const map = new FakeMap(rawStyle()).asMap();
    const unvalidated = map.getStyle();
    // @ts-expect-error raw MapLibre Style is not a core StyleDocument
    toMapLibreStyleSpecification(unvalidated);
    // @ts-expect-error invalid object is not a StyleDocument
    toMapLibreStyleSpecification({ version: 7 });
  }
});

test('initial unreadable or invalid Map Style is unavailable and does not expose style', async () => {
  const thrown = new FakeMap(rawStyle());
  thrown.onGetStyle = () => { throw new Error('secret runtime state'); };
  const thrownResult = await applyTransactionToMap(thrown.asMap(), colorTransaction('#fff'));
  assert.equal(thrownResult.ok, false);
  assert.equal(thrownResult.styleAuthority, 'unavailable');
  assert.equal(Object.hasOwn(thrownResult, 'style'), false);
  assert.equal(isStyleToolError(thrownResult.error), true);
  assertEmptyCommit(thrownResult);

  const invalid = new FakeMap({
    version: 8,
    sources: { base: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] } },
    layers: [{ id: '', type: 'line', source: 'base' }],
  });
  const invalidResult = await applyTransactionToMap(invalid.asMap(), colorTransaction('#fff'));
  assert.equal(invalidResult.styleAuthority, 'unavailable');
  assert.equal(Object.hasOwn(invalidResult, 'style'), false);
  assertEmptyCommit(invalidResult);
});

test('core failure, no-op, and successful candidate follow the branch table', async () => {
  const failureMap = new FakeMap(rawStyle());
  const failure = await applyTransactionToMap(failureMap.asMap(), { operations: [] });
  assert.equal(failure.ok, false);
  assert.equal(failure.styleAuthority, 'current');
  assert.equal(isStyleToolError(failure.error), true);
  assertEmptyCommit(failure);
  assert.equal(failureMap.setStyleCalls.length, 0);

  const noOpMap = new FakeMap(rawStyle());
  const noOp = await applyTransactionToMap(noOpMap.asMap(), colorTransaction('#000'));
  assert.equal(noOp.ok, true);
  assert.equal(noOp.styleAuthority, 'current');
  assertEmptyCommit(noOp);
  assert.equal(noOpMap.setStyleCalls.length, 0);

  for (const diff of [undefined, true, false] as const) {
    const fake = new FakeMap(rawStyle());
    automaticInstall(fake);
    const result = await applyTransactionToMap(fake.asMap(), colorTransaction('#fff'), { diff });
    assert.equal(result.ok, true);
    assert.equal(result.styleAuthority, 'current');
    assert.equal(result.applied, true);
    assert.deepEqual(result.changedLayers, ['roads']);
    assert.equal(result.diff.length, 1);
    assert.equal(fake.setStyleCalls.length, 1);
    assert.deepEqual(fake.setStyleCalls[0]?.options, { diff: diff ?? true });
    const beforeSet = fake.calls.slice(0, fake.calls.findIndex((call) => call.method === 'setStyle'));
    assert.deepEqual(
      beforeSet.filter((call) => call.method === 'on').slice(-2).map((call) => call.value),
      ['style.load', 'error'],
    );
  }
});

test('asynchronous and synchronous failures preserve the primary error and rollback reporting', async () => {
  for (const synchronous of [true, false]) {
    const fake = new FakeMap(rawStyle());
    let calls = 0;
    fake.onSetStyle = (input) => {
      calls += 1;
      if (calls === 1) {
        if (synchronous) throw new Error('candidate rejected synchronously');
        queueMicrotask(() => fake.emit('error', new Error('candidate rejected asynchronously')));
      } else {
        assert.notEqual(typeof input, 'string');
        fake.install(input as StyleSpecification);
      }
    };
    const result = await applyTransactionToMap(fake.asMap(), colorTransaction('#fff'));
    assert.equal(result.ok, false);
    assert.equal(result.styleAuthority, 'current');
    assert.equal(result.rolledBack, true);
    assert.equal(result.rollbackError, undefined);
    assert.equal(result.applied, false);
    assert.equal(result.error.code, 'INTERNAL');
    assert.equal(fake.setStyleCalls.length, 2);
    assert.deepEqual(result.changedLayers, []);
    assert.deepEqual(result.diff, []);
  }
});

test('failed rollback returns last validated current Style or saved pre-operation snapshot', async () => {
  const lastCurrent = new FakeMap(rawStyle());
  let currentCalls = 0;
  lastCurrent.onSetStyle = () => {
    currentCalls += 1;
    if (currentCalls === 1) {
      lastCurrent.style = rawStyle('#123');
      lastCurrent.emit('error', new Error('apply failed'));
    } else {
      lastCurrent.emit('error', new Error('rollback failed'));
    }
  };
  const currentResult = await applyTransactionToMap(
    lastCurrent.asMap(), colorTransaction('#fff'),
  );
  assert.equal(currentResult.ok, false);
  assert.equal(currentResult.styleAuthority, 'current');
  assert.equal(currentResult.rolledBack, false);
  assert.equal(currentResult.rollbackError?.code, 'INTERNAL');
  assert.equal(currentResult.style.layers[0]?.paint?.['line-color'], '#123');
  assert.equal(currentResult.error.code, 'INTERNAL');

  const unreadable = new FakeMap(rawStyle());
  let unreadableCalls = 0;
  unreadable.onSetStyle = () => {
    unreadableCalls += 1;
    unreadable.emit('error', new Error(unreadableCalls === 1 ? 'apply failed' : 'rollback failed'));
    if (unreadableCalls === 2) {
      unreadable.onGetStyle = () => { throw new Error('current unavailable'); };
    }
  };
  const preOperation = await applyTransactionToMap(
    unreadable.asMap(), colorTransaction('#fff'),
  );
  assert.equal(preOperation.ok, false);
  assert.equal(preOperation.styleAuthority, 'pre-operation');
  assert.equal(preOperation.rolledBack, false);
  assert.equal(preOperation.rollbackError?.code, 'INTERNAL');
  assert.equal(preOperation.style.layers[0]?.paint?.['line-color'], '#000');
});

test('rollback listener setup failures use a stable fresh live authority when budget remains', async () => {
  for (const kind of ['prepared', 'object', 'url'] as const) {
    for (const freshState of ['valid', 'invalid', 'changes', 'throws'] as const) {
      const fake = new FakeMap(rawStyle());
      const prepared = kind === 'prepared'
        ? await prepareTransactionForMap(fake.asMap(), colorTransaction('#fff'))
        : undefined;
      if (prepared !== undefined && 'styleAuthority' in prepared) {
        assert.fail('expected prepared handle');
      }
      let errorListeners = 0;
      let fallbackReads = 0;
      fake.onListenerAdded = (type) => {
        if (type !== 'error') return;
        errorListeners += 1;
        if (errorListeners !== 2) return;
        if (freshState === 'invalid') {
          fake.style = {
            version: 8,
            sources: {},
            layers: [{ id: '', type: 'background' }],
          };
        } else if (freshState === 'changes') {
          fake.onGetStyle = () => {
            fallbackReads += 1;
            return fallbackReads === 1 ? rawStyle('#fff') : rawStyle('#123');
          };
        } else if (freshState === 'throws') {
          fake.onGetStyle = () => { throw new Error('rollback authority unavailable'); };
        }
        throw new Error('rollback error listener setup failed');
      };
      fake.onSetStyle = (input) => {
        if (fake.setStyleCalls.length !== 1) assert.fail('rollback setStyle must not run');
        fake.style = typeof input === 'string' ? rawStyle('#fff') : input;
        fake.emit('error', new Error('candidate failed'));
      };
      const deadline = { expiresAt: Date.now() + 500 };
      const result = kind === 'prepared'
        ? await applyPreparedStyleToMap(fake.asMap(), prepared!, { deadline })
        : await applyStyleDocumentOrUrlToMap(
          fake.asMap(),
          kind === 'object' ? strictStyle('#fff') : 'https://example.test/rollback.json',
          { deadline },
        );
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'INTERNAL');
      assert.equal(result.rollbackError?.code, 'INTERNAL');
      assert.equal(result.rolledBack, false);
      assert.equal(result.styleAuthority, freshState === 'valid' ? 'current' : 'pre-operation');
      assert.equal(result.style.layers[0]?.paint?.['line-color'],
        freshState === 'valid' ? '#fff' : '#000');
      assert.equal(fake.setStyleCalls.length, 1);
      assert.equal(errorListeners, 2);
    }
  }
});

test('prepared handles are opaque, recursively frozen snapshots and forgeries touch no Map state', async () => {
  const fake = new FakeMap(rawStyle());
  const transaction = colorTransaction('#fff');
  const options = { maxStyleBytes: 50_000, maxDiffBytes: 50_000, maxOperations: 10 };
  const prepared = await prepareTransactionForMap(fake.asMap(), transaction, options);
  assert.equal('styleAuthority' in prepared, false);
  if ('styleAuthority' in prepared) assert.fail('expected prepared handle');
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.view), true);
  assert.equal(Object.isFrozen(prepared.view.transactionResult.style), true);
  assert.deepEqual(Object.keys(prepared.view.limitOptions).sort(),
    ['maxDiffBytes', 'maxOperations', 'maxStyleBytes']);
  assert.equal(prepared.view.transactionResult.ok, true);

  transaction.operations[0]!.paint['line-color'] = '#bad';
  options.maxStyleBytes = 1;
  assert.equal(Reflect.set(prepared.view.limitOptions, 'maxStyleBytes', 1), false);
  assert.equal(Reflect.defineProperty(prepared.view, 'baselineHash', { value: 'forged' }), false);

  const forgedValues: unknown[] = [
    { view: prepared.view },
    { ...prepared },
    structuredClone(prepared),
    new Proxy(prepared, {}),
    { view: { ...prepared.view, baselineHash: 'forged' } },
  ];
  for (const forged of forgedValues) {
    const forgedMap = new FakeMap(rawStyle());
    const result = await applyPreparedStyleToMap(
      forgedMap.asMap(), forged as PreparedMapStyleTransaction,
    );
    assert.equal(result.ok, false);
    assert.equal(result.styleAuthority, 'unavailable');
    assert.equal(result.error.code, 'INVALID_INPUT');
    assert.deepEqual(forgedMap.calls, []);
  }

  automaticInstall(fake);
  const authorizedCandidate = prepared.view.transactionResult.style;
  const result = await applyPreparedStyleToMap(fake.asMap(), prepared);
  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.equal(result.style.layers[0]?.paint?.['line-color'], '#fff');
  assert.notStrictEqual(fake.setStyleCalls[0]?.style, authorizedCandidate);
  assert.deepEqual(fake.setStyleCalls[0]?.style, authorizedCandidate);

  // eslint-disable-next-line no-constant-condition -- compile-only negative assertions.
  if (false) {
    // @ts-expect-error handle is deeply readonly
    prepared.view.baselineHash = 'changed';
    // @ts-expect-error nested transaction result is deeply readonly
    prepared.view.transactionResult.style.layers[0]!.id = 'changed';
    const phaseTwoOptions: PreparedStyleApplyOptions = {};
    // @ts-expect-error phase two cannot override execution limits
    phaseTwoOptions.maxStyleBytes = 1;
    // @ts-expect-error phase two cannot restart a timeout
    phaseTwoOptions.timeoutMs = 1;
    const fullOptions: ApplyTransactionToMapOptions = {};
    // @ts-expect-error a full phase-one options variable cannot enter phase two
    applyPreparedStyleToMap(fake.asMap(), prepared, fullOptions);
  }
});

test('prepared apply detects revision conflict before setStyle', async () => {
  const fake = new FakeMap(rawStyle());
  const prepared = await prepareTransactionForMap(fake.asMap(), colorTransaction('#fff'));
  assert.equal('styleAuthority' in prepared, false);
  if ('styleAuthority' in prepared) assert.fail('expected prepared handle');
  fake.style = rawStyle('#123');
  const result = await applyPreparedStyleToMap(fake.asMap(), prepared);
  assert.equal(result.ok, false);
  assert.equal(result.styleAuthority, 'current');
  assert.equal(result.error.code, 'REVISION_CONFLICT');
  assert.equal(result.style.layers[0]?.paint?.['line-color'], '#123');
  assert.equal(fake.setStyleCalls.length, 0);
});

test('completion never exposes a Style snapshot that changed while its hash was pending', async () => {
  for (const emitDuringHash of [false, true]) {
    const fake = new FakeMap(rawStyle());
    const prepared = await prepareTransactionForMap(fake.asMap(), colorTransaction('#fff'));
    assert.equal('styleAuthority' in prepared, false);
    if ('styleAuthority' in prepared) assert.fail('expected prepared handle');

    let releaseHash!: (hash: string) => void;
    const pendingHash = new Promise<string>((resolve) => { releaseHash = resolve; });
    let blocked = false;
    let blockNextCompletion = true;
    let candidateHashes = 0;
    fake.onSetStyle = (input) => {
      assert.notEqual(typeof input, 'string');
      fake.install(input as StyleSpecification);
    };
    const applyPromise = applyPreparedStyleToMap(fake.asMap(), prepared, {
      deadline: { expiresAt: Date.now() + 1_000 },
      hashStyle: async (style) => {
        if (styleColor(style) === '#fff') candidateHashes += 1;
        if (candidateHashes === 2 && blockNextCompletion) {
          blockNextCompletion = false;
          blocked = true;
          return pendingHash;
        }
        return hashStyle(style);
      },
    });
    await waitForCondition(() => blocked, 'the pending style hash');

    let settled = false;
    void applyPromise.then(() => { settled = true; });
    fake.style = rawStyle('#123');
    if (emitDuringHash) fake.emit('style.load');
    releaseHash(await hashStyle(strictStyle('#fff')));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(settled, false, 'a stale hashed snapshot must not become current authority');

    fake.install(rawStyle('#fff'));
    const result = await applyPromise;
    assert.equal(result.ok, true);
    assert.equal(result.styleAuthority, 'current');
    assert.equal(result.style.layers[0]?.paint?.['line-color'], '#fff');
  }
});

test('completion drains every pending generation before accepting the final Style', async () => {
  for (const scenario of ['three-generations', 'five-generations', 'stable-unexpected'] as const) {
    const fake = new FakeMap(rawStyle());
    const prepared = await prepareTransactionForMap(fake.asMap(), colorTransaction('#fff'));
    assert.equal('styleAuthority' in prepared, false);
    if ('styleAuthority' in prepared) assert.fail('expected prepared handle');
    fake.onSetStyle = (input) => {
      assert.notEqual(typeof input, 'string');
      fake.install(input as StyleSpecification);
    };

    const releases: Array<(hash: string) => void> = [];
    let activeHashes = 0;
    let maxActiveHashes = 0;
    const hash = async (style: StyleDocument): Promise<string> => {
      if (fake.setStyleCalls.length === 1) {
        activeHashes += 1;
        maxActiveHashes = Math.max(maxActiveHashes, activeHashes);
        const hashValue = await new Promise<string>((resolve) => {
          releases.push(resolve);
        });
        activeHashes -= 1;
        return hashValue;
      }
      return hashStyle(style);
    };
    let now = 0;
    const expiresAt = 10_000;
    const resultPromise = applyPreparedStyleToMap(fake.asMap(), prepared, {
      deadline: { expiresAt, now: () => now }, hashStyle: hash,
    });
    await waitForCondition(() => releases.length === 1, 'the initial hash release');

    const generations = scenario === 'five-generations'
      ? ['#123', '#234', '#345', '#456']
      : ['#123'];
    for (const [index, color] of generations.entries()) {
      fake.install(rawStyle(color));
      releases.shift()!(await hashStyle(strictStyle(
        index === 0 ? '#fff' : generations[index - 1]!,
      )));
      await waitForCondition(() => releases.length === 1, 'the next hash release');
    }

    if (scenario === 'stable-unexpected') {
      now = expiresAt;
      releases.shift()!(await hashStyle(strictStyle('#123')));
      const result = await resultPromise;
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'TIMEOUT');
      assert.equal(result.styleAuthority, 'pre-operation');
    } else {
      fake.install(rawStyle('#fff'));
      releases.shift()!(await hashStyle(strictStyle(generations.at(-1)!)));
      await waitForCondition(() => releases.length === 1, 'the final hash release');
      releases.shift()!(await hashStyle(strictStyle('#fff')));
      const result = await resultPromise;
      assert.equal(result.ok, true);
      assert.equal(result.styleAuthority, 'current');
      assert.equal(result.style.layers[0]?.paint?.['line-color'], '#fff');
    }
    assert.equal(maxActiveHashes, 1);
    assert.equal(activeHashes, 0);
  }
});

test('URL completion ignores pre-invocation loads and handles sync, no-event no-op, and pending states', async () => {
  const staleRegistration = new FakeMap(rawStyle());
  staleRegistration.onListenerAdded = (type, listener) => {
    if (type === 'style.load') listener({ type });
  };
  staleRegistration.onSetStyle = () => {
    queueMicrotask(() => staleRegistration.install(rawStyle('#fff')));
  };
  const staleResult = await applyStyleDocumentOrUrlToMap(
    staleRegistration.asMap(), 'https://example.test/stale.json',
  );
  assert.equal(staleResult.ok, true);
  assert.equal(staleResult.style.layers[0]?.paint?.['line-color'], '#fff');

  const syncBeforeState = new FakeMap(rawStyle());
  syncBeforeState.onSetStyle = () => {
    syncBeforeState.emit('style.load');
    queueMicrotask(() => {
      syncBeforeState.style = rawStyle('#fff');
      syncBeforeState.loaded = true;
    });
  };
  const syncResult = await applyStyleDocumentOrUrlToMap(
    syncBeforeState.asMap(), 'https://example.test/sync.json',
  );
  assert.equal(syncResult.ok, true);
  assert.equal(syncResult.style.layers[0]?.paint?.['line-color'], '#fff');

  const sameNoEvent = new FakeMap(rawStyle());
  sameNoEvent.loaded = true;
  sameNoEvent.onSetStyle = () => { sameNoEvent.loaded = true; };
  const sameResult = await applyStyleDocumentOrUrlToMap(
    sameNoEvent.asMap(), 'https://example.test/same.json', {
      deadline: { expiresAt: Date.now() + 100 },
    },
  );
  assert.equal(sameResult.ok, true);
  assert.equal(sameResult.applied, true);
  assert.deepEqual(sameResult.diff, []);
  assert.equal(sameNoEvent.setStyleCalls.length, 1);

  const pending = new FakeMap(rawStyle());
  pending.loaded = true;
  const controller = new AbortController();
  pending.onSetStyle = () => { controller.abort(); };
  const pendingResult = await applyStyleDocumentOrUrlToMap(
    pending.asMap(), 'https://example.test/pending.json', {
      deadline: { expiresAt: Date.now() + 10_000, signal: controller.signal },
    },
  );
  assert.equal(pendingResult.ok, false);
  assert.equal(pendingResult.styleAuthority, 'pre-operation');
  assert.equal(pendingResult.rolledBack, false);
  assert.equal(pendingResult.rollbackError?.code, 'TIMEOUT');
  assert.equal(pending.setStyleCalls.length, 1);
});

test('listener setup and promise settlement honor the deadline before mutation and clean up independently', async () => {
  for (const mode of ['abort', 'expire'] as const) {
    const fake = new FakeMap(rawStyle());
    const prepared = await prepareTransactionForMap(fake.asMap(), colorTransaction('#fff'));
    assert.equal('styleAuthority' in prepared, false);
    if ('styleAuthority' in prepared) assert.fail('expected prepared handle');
    const controller = new AbortController();
    let now = 0;
    fake.onListenerAdded = (type) => {
      if (type !== 'style.load') return;
      if (mode === 'abort') controller.abort();
      else now = 10;
    };
    const result = await applyPreparedStyleToMap(fake.asMap(), prepared, {
      deadline: {
        expiresAt: mode === 'abort' ? 10_000 : 10,
        signal: controller.signal,
        now: () => now,
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'TIMEOUT');
    assert.equal(fake.setStyleCalls.length, 0);
  }

  for (const settlement of ['resolve', 'reject'] as const) {
    const fake = new FakeMap(rawStyle());
    const prepared = await prepareTransactionForMap(fake.asMap(), colorTransaction('#fff'));
    assert.equal('styleAuthority' in prepared, false);
    if ('styleAuthority' in prepared) assert.fail('expected prepared handle');
    const deadline = 1_000_000;
    let now = 0;
    fake.onSetStyle = (input) => {
      assert.notEqual(typeof input, 'string');
      fake.install(input as StyleSpecification);
    };
    const result = await applyPreparedStyleToMap(fake.asMap(), prepared, {
      deadline: { expiresAt: deadline, now: () => now },
      hashStyle: async (style) => {
        if (fake.setStyleCalls.length === 1) {
          now = deadline;
          if (settlement === 'reject') throw new Error('late hash rejection');
        }
        return hashStyle(style);
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'TIMEOUT');
    assert.equal(result.styleAuthority, 'pre-operation');
  }

  const cleanup = new FakeMap(rawStyle());
  const cleanupPrepared = await prepareTransactionForMap(
    cleanup.asMap(), colorTransaction('#fff'),
  );
  assert.equal('styleAuthority' in cleanupPrepared, false);
  if ('styleAuthority' in cleanupPrepared) assert.fail('expected prepared handle');
  automaticInstall(cleanup);
  cleanup.onListenerRemoved = (type) => {
    if (type === 'style.load') throw new Error('first off failed');
  };
  const cleanupResult = await applyPreparedStyleToMap(cleanup.asMap(), cleanupPrepared, {
    deadline: { expiresAt: Date.now() + 100 },
  });
  assert.equal(cleanupResult.ok, true);
  assert.deepEqual(
    cleanup.calls.filter((call) => call.method === 'off').map((call) => call.value),
    ['style.load', 'error'],
  );
});

test('pre-invoke guard catches listener reentrancy for prepared, object, and URL mutations', async () => {
  const preparedMap = new FakeMap(rawStyle());
  const prepared = await prepareTransactionForMap(
    preparedMap.asMap(), colorTransaction('#fff'),
  );
  assert.equal('styleAuthority' in prepared, false);
  if ('styleAuthority' in prepared) assert.fail('expected prepared handle');
  preparedMap.onListenerAdded = (type) => {
    if (type === 'error') preparedMap.style = rawStyle('#123');
  };
  const preparedResult = await applyPreparedStyleToMap(preparedMap.asMap(), prepared, {
    deadline: { expiresAt: Date.now() + 100 },
  });

  const objectMap = new FakeMap(rawStyle());
  objectMap.onListenerAdded = (type) => {
    if (type === 'error') objectMap.style = rawStyle('#123');
  };
  const objectResult = await applyStyleDocumentOrUrlToMap(
    objectMap.asMap(), strictStyle('#fff'), { deadline: { expiresAt: Date.now() + 100 } },
  );

  const urlMap = new FakeMap(rawStyle());
  urlMap.onListenerAdded = (type) => {
    if (type === 'error') urlMap.style = rawStyle('#123');
  };
  const urlResult = await applyStyleDocumentOrUrlToMap(
    urlMap.asMap(), 'https://example.test/reentrant.json', {
      deadline: { expiresAt: Date.now() + 100 },
    },
  );

  for (const [fake, result] of [
    [preparedMap, preparedResult], [objectMap, objectResult], [urlMap, urlResult],
  ] as const) {
    assert.equal(result.ok, false);
    assert.equal(result.styleAuthority, 'current');
    assert.equal(result.error.code, 'REVISION_CONFLICT');
    assert.equal(result.style.layers[0]?.paint?.['line-color'], '#123');
    assert.equal(fake.setStyleCalls.length, 0);
    const errorOn = fake.calls.findIndex(
      (call) => call.method === 'on' && call.value === 'error',
    );
    const guardedRead = fake.calls.findIndex(
      (call, index) => index > errorOn && call.method === 'getStyle',
    );
    assert.equal(errorOn >= 0 && guardedRead > errorOn, true);
  }

  const unreadable = new FakeMap(rawStyle());
  const unreadablePrepared = await prepareTransactionForMap(
    unreadable.asMap(), colorTransaction('#fff'),
  );
  assert.equal('styleAuthority' in unreadablePrepared, false);
  if ('styleAuthority' in unreadablePrepared) assert.fail('expected prepared handle');
  unreadable.onListenerAdded = (type) => {
    if (type === 'error') {
      unreadable.onGetStyle = () => { throw new Error('reentrant unreadable state'); };
    }
  };
  const unreadableResult = await applyPreparedStyleToMap(
    unreadable.asMap(), unreadablePrepared, {
      deadline: { expiresAt: Date.now() + 100 },
    },
  );
  assert.equal(unreadableResult.styleAuthority, 'pre-operation');
  assert.equal(unreadable.setStyleCalls.length, 0);
});

test('pre-invoke listener failure never starts candidate mutation or rollback', async () => {
  const fake = new FakeMap(rawStyle());
  const prepared = await prepareTransactionForMap(fake.asMap(), colorTransaction('#fff'));
  assert.equal('styleAuthority' in prepared, false);
  if ('styleAuthority' in prepared) assert.fail('expected prepared handle');
  fake.onListenerAdded = (type) => {
    if (type === 'error') throw new Error('listener setup failed');
  };
  const result = await applyPreparedStyleToMap(fake.asMap(), prepared, {
    deadline: { expiresAt: Date.now() + 100 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.styleAuthority, 'current');
  assert.equal(result.error.code, 'INTERNAL');
  assert.equal(Object.hasOwn(result, 'rolledBack'), false);
  assert.equal(fake.setStyleCalls.length, 0);
});

test('deadline callbacks cannot mutate Map state between a successful guard and invoke', async () => {
  for (const kind of ['prepared', 'object', 'url'] as const) {
    const fake = new FakeMap(rawStyle());
    const prepared = kind === 'prepared'
      ? await prepareTransactionForMap(fake.asMap(), colorTransaction('#fff'))
      : undefined;
    if (prepared !== undefined && 'styleAuthority' in prepared) {
      assert.fail('expected prepared handle');
    }
    let armed = false;
    let guardedWindowCalls = 0;
    fake.onListenerAdded = (type) => {
      if (type === 'error') armed = true;
    };
    fake.onSetStyle = (input) => {
      fake.install(typeof input === 'string' ? rawStyle('#fff') : input);
    };
    const deadline = {
      expiresAt: 100,
      now: (): number => {
        if (armed) {
          guardedWindowCalls += 1;
          if (guardedWindowCalls === 4) fake.style = rawStyle('#123');
        }
        return 0;
      },
    };
    const result = kind === 'prepared'
      ? await applyPreparedStyleToMap(fake.asMap(), prepared!, { deadline })
      : await applyStyleDocumentOrUrlToMap(
        fake.asMap(),
        kind === 'object' ? strictStyle('#fff') : 'https://example.test/window.json',
        { deadline },
      );
    assert.equal(result.ok, false);
    assert.equal(result.styleAuthority, 'current');
    assert.equal(result.error.code, 'REVISION_CONFLICT');
    assert.equal(result.style.layers[0]?.paint?.['line-color'], '#123');
    assert.equal(fake.setStyleCalls.length, 0);
  }
});

test('listener setup failures resolve fresh authority even after the deadline is exhausted', async () => {
  for (const kind of ['prepared', 'object', 'url'] as const) {
    for (const freshState of ['valid', 'invalid', 'throws'] as const) {
      const fake = new FakeMap(rawStyle());
      const prepared = kind === 'prepared'
        ? await prepareTransactionForMap(fake.asMap(), colorTransaction('#fff'))
        : undefined;
      if (prepared !== undefined && 'styleAuthority' in prepared) {
        assert.fail('expected prepared handle');
      }
      let now = 0;
      fake.onListenerAdded = (type) => {
        if (type !== 'error') return;
        now = 100;
        if (freshState === 'valid') fake.style = rawStyle('#123');
        if (freshState === 'invalid') {
          fake.style = {
            version: 8,
            sources: {},
            layers: [{ id: '', type: 'background' }],
          };
        }
        if (freshState === 'throws') {
          fake.onGetStyle = () => { throw new Error('fresh authority unavailable'); };
        }
        throw new Error('error listener setup failed');
      };
      const deadline = { expiresAt: 100, now: () => now };
      const result = kind === 'prepared'
        ? await applyPreparedStyleToMap(fake.asMap(), prepared!, { deadline })
        : await applyStyleDocumentOrUrlToMap(
          fake.asMap(),
          kind === 'object' ? strictStyle('#fff') : 'https://example.test/setup.json',
          { deadline },
        );
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'INTERNAL');
      assert.equal(isStyleToolError(result.error), true);
      assert.equal(result.styleAuthority, freshState === 'valid' ? 'current' : 'pre-operation');
      assert.equal(result.style.layers[0]?.paint?.['line-color'],
        freshState === 'valid' ? '#123' : '#000');
      assert.equal(Object.hasOwn(result, 'rolledBack'), false);
      assert.equal(fake.setStyleCalls.length, 0);
      assert.deepEqual(
        fake.calls.filter((call) => call.method === 'off').map((call) => call.value),
        ['style.load', 'error'],
      );
    }
  }
});

test('whole-style async hashing and preparation failures return freshly guarded authority', async () => {
  for (const kind of ['object', 'url'] as const) {
    const fake = new FakeMap(rawStyle());
    let hashes = 0;
    fake.onSetStyle = (input) => {
      if (typeof input === 'string') fake.install(rawStyle('#fff'));
      else fake.install(input);
    };
    const result = await applyStyleDocumentOrUrlToMap(
      fake.asMap(),
      kind === 'object' ? strictStyle('#fff') : 'https://example.test/concurrent.json',
      {
        hashStyle: async (style) => {
          hashes += 1;
          if ((kind === 'object' && hashes === 2) || kind === 'url') {
            fake.style = rawStyle('#123');
          }
          return hashStyle(style);
        },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.styleAuthority, 'current');
    assert.equal(result.error.code, 'REVISION_CONFLICT');
    assert.equal(result.style.layers[0]?.paint?.['line-color'], '#123');
    assert.equal(fake.setStyleCalls.length, 0);
  }

  const prepareMap = new FakeMap(rawStyle());
  const prepareResult = await prepareTransactionForMap(
    prepareMap.asMap(), colorTransaction('#fff'), {
      hashStyle: async () => {
        prepareMap.style = rawStyle('#123');
        throw new Error('hash failed');
      },
    },
  );
  assert.equal('styleAuthority' in prepareResult, true);
  if (!('styleAuthority' in prepareResult)) assert.fail('expected preparation failure');
  assert.equal(prepareResult.styleAuthority, 'current');
  assert.equal(prepareResult.style.layers[0]?.paint?.['line-color'], '#123');
});

test('injected hashers receive frozen disjoint snapshots and phase-two hashing confirms rollback', async () => {
  const fake = new FakeMap({ ...rawStyle(), metadata: { nested: { flag: true } } });
  const seen: StyleDocument[] = [];
  let setCalls = 0;
  fake.onSetStyle = (input) => {
    setCalls += 1;
    if (setCalls === 1) fake.emit('error', new Error('candidate failed'));
    else {
      assert.notEqual(typeof input, 'string');
      fake.install(input as StyleSpecification);
    }
  };
  const maliciousHash = async (style: StyleDocument): Promise<string> => {
    seen.push(style);
    assert.equal(isDeeplyFrozen(style), true);
    const paint = style.layers[0]?.paint;
    if (paint !== undefined) assert.equal(Reflect.set(paint, 'line-color', '#evil'), false);
    const metadata = style.metadata;
    if (typeof metadata === 'object' && metadata !== null) {
      const nested = Reflect.get(metadata, 'nested');
      if (typeof nested === 'object' && nested !== null) {
        assert.equal(Reflect.set(nested, 'flag', false), false);
      }
    }
    return hashStyle(style);
  };
  const result = await applyTransactionToMap(
    fake.asMap(), colorTransaction('#fff'), { hashStyle: maliciousHash },
  );
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.deepEqual(result.style.metadata, { nested: { flag: true } });
  assert.equal(new Set(seen).size, seen.length);
  assert.equal(specificationColor(
    fake.setStyleCalls[0]?.style as StyleSpecification,
  ), '#fff');
  assert.equal(specificationColor(
    fake.setStyleCalls[1]?.style as StyleSpecification,
  ), '#000');

  const consistencyMap = new FakeMap(rawStyle());
  const prepared = await prepareTransactionForMap(
    consistencyMap.asMap(), colorTransaction('#fff'), {
      hashStyle: async (style) => `A:${canonicalizeJson(style)}`,
    },
  );
  assert.equal('styleAuthority' in prepared, false);
  if ('styleAuthority' in prepared) assert.fail('expected prepared handle');
  let calls = 0;
  consistencyMap.onSetStyle = (input) => {
    calls += 1;
    if (calls === 1) consistencyMap.emit('error', new Error('candidate failed'));
    else {
      assert.notEqual(typeof input, 'string');
      consistencyMap.install(input as StyleSpecification);
    }
  };
  const consistencyResult = await applyPreparedStyleToMap(
    consistencyMap.asMap(), prepared, {
      deadline: { expiresAt: Date.now() + 100 },
      hashStyle: async (style) => `B:${canonicalizeJson(style)}`,
    },
  );
  assert.equal(consistencyResult.ok, false);
  assert.equal(consistencyResult.styleAuthority, 'current');
  assert.equal(consistencyResult.rolledBack, true);
});

test('slow hashes time out or abort on the shared deadline and late settlement is discarded', async () => {
  for (const late of ['resolve', 'reject'] as const) {
    const fake = new FakeMap(rawStyle());
    let settle!: (value: string) => void;
    let reject!: (reason: Error) => void;
    const pending = new Promise<string>((resolve, rejectPromise) => {
      settle = resolve;
      reject = rejectPromise;
    });
    const result = await prepareTransactionForMap(fake.asMap(), colorTransaction('#fff'), {
      deadline: { expiresAt: Date.now() + 20 },
      hashStyle: () => pending,
    });
    assert.equal('styleAuthority' in result, true);
    if (!('styleAuthority' in result)) assert.fail('expected deadline failure');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'TIMEOUT');
    assert.equal(result.styleAuthority, 'current');
    assert.equal(fake.setStyleCalls.length, 0);
    if (late === 'resolve') settle('late');
    else reject(new Error('late rejection'));
    await Promise.resolve();
  }

  const fake = new FakeMap(rawStyle());
  const controller = new AbortController();
  const pending = new Promise<string>(() => {});
  const promise = prepareTransactionForMap(fake.asMap(), colorTransaction('#fff'), {
    deadline: { expiresAt: Date.now() + 10_000, signal: controller.signal },
    hashStyle: () => pending,
  });
  controller.abort();
  const aborted = await promise;
  assert.equal('styleAuthority' in aborted, true);
  if (!('styleAuthority' in aborted)) assert.fail('expected abort failure');
  if (aborted.ok) assert.fail('expected abort failure');
  assert.equal(aborted.error.code, 'TIMEOUT');
  assert.deepEqual(aborted.error.details, { reason: 'aborted' });
});

test('whole-document application finalizes before setStyle, skips no-op, and preserves semantic diff', async () => {
  const noOpMap = new FakeMap(rawStyle());
  const noOp = await applyStyleDocumentOrUrlToMap(noOpMap.asMap(), strictStyle());
  assert.equal(noOp.ok, true);
  assert.equal(noOp.applied, false);
  assert.equal(noOpMap.setStyleCalls.length, 0);

  const invalidMap = new FakeMap(rawStyle());
  const invalid = await applyStyleDocumentOrUrlToMap(
    invalidMap.asMap(), { version: 7, sources: {}, layers: [] } as unknown as StyleDocument,
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.styleAuthority, 'current');
  assert.equal(invalidMap.setStyleCalls.length, 0);

  const fake = new FakeMap(rawStyle());
  automaticInstall(fake);
  const result = await applyStyleDocumentOrUrlToMap(fake.asMap(), strictStyle('#fff'), {
    diff: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.deepEqual(result.changedLayers, ['roads']);
  assert.equal(result.diff[0]?.target.kind, 'layer');
  assert.deepEqual(fake.setStyleCalls[0]?.options, { diff: false });
});

test('whole-document expected baseline rejects stale authority before setStyle', async () => {
  const fake = new FakeMap(rawStyle('#00ff00'));
  const result = await applyStyleDocumentOrUrlToMap(fake.asMap(), strictStyle('#ff0000'), {
    expectedBaselineStyle: strictStyle(),
  });

  assert.equal(result.ok, false);
  if (result.ok) assert.fail('expected revision conflict');
  assert.equal(result.error.code, 'REVISION_CONFLICT');
  assert.equal(result.styleAuthority, 'current');
  assert.deepEqual(result.style, strictStyle('#00ff00'));
  assert.equal(fake.setStyleCalls.length, 0);
});

test('URL input is passed once, requires fresh completion, finalizes resolved Style, and rolls back', async () => {
  const success = new FakeMap(rawStyle());
  success.loaded = true;
  success.onSetStyle = (input) => {
    assert.equal(input, 'https://example.test/style.json');
    queueMicrotask(() => success.install(rawStyle('#fff')));
  };
  const result = await applyStyleDocumentOrUrlToMap(
    success.asMap(), 'https://example.test/style.json', { diff: true },
  );
  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.deepEqual(result.changedLayers, ['roads']);
  assert.deepEqual(success.setStyleCalls.map((call) => call.style),
    ['https://example.test/style.json']);

  const failure = new FakeMap(rawStyle());
  let calls = 0;
  failure.onSetStyle = (input) => {
    calls += 1;
    if (calls === 1) {
      assert.equal(input, 'https://example.test/bad.json');
      failure.emit('error', new Error('URL load failed'));
    } else {
      assert.notEqual(typeof input, 'string');
      failure.install(input as StyleSpecification);
    }
  };
  const failed = await applyStyleDocumentOrUrlToMap(
    failure.asMap(), 'https://example.test/bad.json', { diff: false },
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.rolledBack, true);
  assert.equal(failure.setStyleCalls.length, 2);
  assert.equal(failure.setStyleCalls[0]?.style, 'https://example.test/bad.json');
  assert.deepEqual(failure.setStyleCalls.map((call) => call.options),
    [{ diff: false }, { diff: false }]);

  const blank = new FakeMap(rawStyle());
  const blankResult = await applyStyleDocumentOrUrlToMap(blank.asMap(), '');
  assert.equal(blankResult.ok, false);
  assert.equal(blankResult.styleAuthority, 'current');
  assert.equal(blank.setStyleCalls.length, 0);
});

test('limit values are forwarded unchanged across transaction and whole-Style APIs', async () => {
  for (const options of [
    { maxOperations: 0 },
    { maxOperations: 1.5 },
    { maxStyleBytes: 1 },
    { maxDiffBytes: 1 },
  ] as ApplyTransactionToMapOptions[]) {
    const fake = new FakeMap(rawStyle());
    const result = await applyTransactionToMap(fake.asMap(), colorTransaction('#fff'), options);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'INVALID_INPUT');
    assert.equal(fake.setStyleCalls.length, 0);
  }

  const invalidUrlLimit = new FakeMap(rawStyle());
  const urlResult = await applyStyleDocumentOrUrlToMap(
    invalidUrlLimit.asMap(), 'https://example.test/style.json', { maxDiffBytes: 0 },
  );
  assert.equal(urlResult.ok, false);
  assert.equal(invalidUrlLimit.setStyleCalls.length, 0);
});

test('raised >5 MiB Task 7/10 inline limits survive direct and split APIs', async () => {
  const baselineRaw: StyleSpecification = {
    version: 8,
    sources: { geo: { type: 'geojson', data: 'before' } },
    layers: [],
  };
  const hugeData = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', geometry: null,
      properties: { payload: 'x'.repeat(5 * 1024 * 1024) },
    }],
  };
  const transaction = {
    operations: [{ op: 'setGeoJsonData', sourceId: 'geo', data: hugeData }],
  };
  const expectedStyleBytes = 5_243_054;
  const expectedDiffBytes = 5_243_094;

  for (const { options, maxBytes } of [{
    options: undefined,
    maxBytes: 5_242_880,
  }, {
    options: { maxStyleBytes: 5_242_983, maxDiffBytes: expectedDiffBytes },
    maxBytes: 5_242_983,
  }]) {
    const fake = new FakeMap(baselineRaw);
    const result = await applyTransactionToMap(fake.asMap(), transaction, options);
    assert.equal(result.ok, false);
    assert.equal(result.styleAuthority, 'current');
    assert.equal(result.error.code, 'INVALID_INPUT');
    assert.equal(result.error.path, '/data');
    assert.deepEqual(result.error.details, {
      reason: 'maxBytes', maxBytes, actualBytes: 5_242_984,
    });
    assertEmptyCommit(result);
    assert.equal(fake.setStyleCalls.length, 0);
  }

  const raised = {
    maxStyleBytes: expectedStyleBytes,
    maxDiffBytes: expectedDiffBytes,
    maxOperations: 1,
  };
  const direct = new FakeMap(baselineRaw);
  automaticInstall(direct);
  const directResult = await applyTransactionToMap(direct.asMap(), transaction, raised);
  assert.equal(directResult.ok, true);
  assert.equal(directResult.applied, true);
  assert.deepEqual(directResult.changedSources, ['geo']);
  assert.equal(jsonUtf8ByteLength(directResult.style as JsonValue), expectedStyleBytes);
  assert.equal(jsonUtf8ByteLength(directResult.diff as JsonValue), expectedDiffBytes);

  const addBaselineRaw: StyleSpecification = { version: 8, sources: {}, layers: [] };
  const addTransaction = {
    operations: [{
      op: 'addGeoJsonLayer',
      sourceId: 'huge',
      layerId: 'huge-layer',
      data: hugeData,
      type: 'circle',
    }],
  };
  const addExpectedStyleBytes = 5_243_106;
  const addExpectedDiffBytes = 5_243_231;
  for (const { options, maxBytes } of [{
    options: undefined,
    maxBytes: 5_242_880,
  }, {
    options: { maxStyleBytes: 5_242_983, maxDiffBytes: addExpectedDiffBytes },
    maxBytes: 5_242_983,
  }]) {
    const fake = new FakeMap(addBaselineRaw);
    const result = await applyTransactionToMap(fake.asMap(), addTransaction, options);
    assert.equal(result.ok, false);
    assert.equal(result.styleAuthority, 'current');
    assert.equal(result.error.code, 'INVALID_INPUT');
    assert.equal(result.error.path, '/data');
    assert.deepEqual(result.error.details, {
      reason: 'maxBytes', maxBytes, actualBytes: 5_242_984,
    });
    assertEmptyCommit(result);
    assert.equal(fake.setStyleCalls.length, 0);
  }

  const addDirect = new FakeMap(addBaselineRaw);
  automaticInstall(addDirect);
  const addDirectResult = await applyTransactionToMap(
    addDirect.asMap(), addTransaction, {
      maxStyleBytes: addExpectedStyleBytes,
      maxDiffBytes: addExpectedDiffBytes,
      maxOperations: 1,
    },
  );
  assert.equal(addDirectResult.ok, true);
  assert.equal(addDirectResult.applied, true);
  assert.deepEqual(addDirectResult.changedLayers, ['huge-layer']);
  assert.deepEqual(addDirectResult.changedSources, ['huge']);
  assert.deepEqual(addDirectResult.diff.map((entry) => entry.path), [
    '/layers/0', '/sources/huge',
  ]);
  assert.equal(jsonUtf8ByteLength(addDirectResult.style as JsonValue), addExpectedStyleBytes);
  assert.equal(jsonUtf8ByteLength(addDirectResult.diff as JsonValue), addExpectedDiffBytes);

  const split = new FakeMap(baselineRaw);
  const mutableRaised = { ...raised };
  const prepared = await prepareTransactionForMap(split.asMap(), transaction, mutableRaised);
  assert.equal('styleAuthority' in prepared, false);
  if ('styleAuthority' in prepared) assert.fail('expected prepared handle');
  assert.equal(Object.isFrozen(prepared.view.limitOptions), true);
  mutableRaised.maxStyleBytes = 1;
  mutableRaised.maxDiffBytes = 1;
  automaticInstall(split);
  const splitResult = await applyPreparedStyleToMap(split.asMap(), prepared);
  assert.equal(splitResult.ok, true);
  assert.equal(splitResult.applied, true);
  assert.equal(split.setStyleCalls.length, 1);
});

test('source inspection locks sole checked conversion and forbids unsafe adapter casts/counting', async () => {
  const source = await readFile(fileURLToPath(new URL(
    '../../../../src/adapters/maplibre/map-adapter.ts', import.meta.url,
  )), 'utf8');
  assert.equal(source.match(/as StyleSpecification/g)?.length, 1);
  assert.match(source, /return style as StyleSpecification;/);
  assert.doesNotMatch(source, /as StyleDocument|as unknown|as never/);
  assert.doesNotMatch(source, /jsonUtf8ByteLength|validateInlineGeoJson|diffStyleDocuments/);
  assert.equal(source.match(/applyStyleTransaction\(/g)?.length, 1);
  const barrel = await readFile(fileURLToPath(new URL(
    '../../../../src/adapters/maplibre/index.ts', import.meta.url,
  )), 'utf8');
  assert.doesNotMatch(barrel, /toMapLibreStyleSpecification/);
});

test('hashStyle is canonical and deterministic', async () => {
  assert.equal(await hashStyle(strictStyle()), await hashStyle(strictStyle()));
  assert.equal(canonicalizeJson(strictStyle()), canonicalizeJson(rawStyle()));
});
