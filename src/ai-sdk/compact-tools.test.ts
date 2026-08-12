import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { createCompactMapLibreStyleTools } from './compact-tools.js';
import {
  compactAddGeoJsonLayerInputSchema,
  compactAddLayerFromSourceInputSchema,
  compactAnalyzeGeoJsonInputSchema,
  compactApplyStyleTransactionInputSchema,
  compactDuplicateLayerInputSchema,
  compactListSourceLayersInputSchema,
} from './schemas.js';
import { COMPACT_LEGACY_TOOL_NAMES } from './tool-contracts.js';

const STRUCTURED_TOOL_NAMES = [
  'analyzeGeoJson',
  'listSourceLayers',
  'duplicateLayer',
  'addLayerFromSource',
  'addGeoJsonLayer',
  'applyStyleTransaction',
] as const;

type EventName = 'style.load' | 'error';
type Listener = (event: { type: EventName; error?: Error }) => void;

class FakeMap {
  style: StyleSpecification;
  loaded = true;
  getStyleCalls = 0;
  readonly setStyleCalls: Array<{
    style: StyleSpecification | string;
    options: { diff?: boolean } | undefined;
  }> = [];
  onSetStyle?: (
    style: StyleSpecification | string,
    options: { diff?: boolean } | undefined,
  ) => void;
  onGetStyle?: () => StyleSpecification;
  private readonly listeners = new Map<EventName, Set<Listener>>();

  constructor(style: StyleSpecification = baseStyle()) {
    this.style = style;
  }

  getStyle(): StyleSpecification {
    this.getStyleCalls += 1;
    return this.onGetStyle?.() ?? this.style;
  }

  isStyleLoaded(): boolean {
    return this.loaded;
  }

  on(type: EventName, listener: Listener): { unsubscribe(): void } {
    let listeners = this.listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
    return { unsubscribe: () => { listeners!.delete(listener); } };
  }

  off(type: EventName, listener: Listener): this {
    this.listeners.get(type)?.delete(listener);
    return this;
  }

  setStyle(style: StyleSpecification | string, options?: { diff?: boolean }): this {
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

  automaticallyInstall(): void {
    this.onSetStyle = (style) => {
      assert.notEqual(typeof style, 'string');
      queueMicrotask(() => { this.install(style as StyleSpecification); });
    };
  }

  asMap(): MapLibreMap {
    return this as unknown as MapLibreMap;
  }
}

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      base: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] },
    },
    layers: [{
      id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads',
      paint: { 'line-color': '#000' },
    }],
  };
}

async function executeTool(
  toolValue: unknown,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const execute = (toolValue as {
    execute?: (value: Record<string, unknown>, options?: unknown) => unknown;
  }).execute;
  assert.ok(execute);
  const result = await execute(input, {});
  assert.equal(typeof result, 'object');
  assert.notEqual(result, null);
  return result as Record<string, unknown>;
}

function inputSchema(toolValue: unknown): { safeParse(value: unknown): { success: boolean } } {
  const schema = (toolValue as { inputSchema?: unknown }).inputSchema;
  assert.equal(typeof schema, 'object');
  assert.notEqual(schema, null);
  return schema as { safeParse(value: unknown): { success: boolean } };
}

test('keeps the five legacy names as the stable prefix and adds only approved tools', () => {
  const tools = createCompactMapLibreStyleTools({ getMap: () => null });
  assert.deepEqual(Object.keys(tools), [
    ...COMPACT_LEGACY_TOOL_NAMES,
    ...STRUCTURED_TOOL_NAMES,
  ]);
});

test('exports strict named schemas and rejects unknown or over-limit input before Map access', () => {
  const fake = new FakeMap();
  const tools = createCompactMapLibreStyleTools({ getMap: () => fake.asMap() });
  const validInputs = {
    analyzeGeoJson: { data: { type: 'Point', coordinates: [1, 2] } },
    listSourceLayers: { sourceId: 'base' },
    duplicateLayer: { layerId: 'roads', newLayerId: 'roads-copy' },
    addLayerFromSource: {
      layerId: 'water', sourceId: 'base', sourceLayer: 'water', type: 'fill',
    },
    addGeoJsonLayer: {
      sourceId: 'points-source', layerId: 'points', type: 'circle',
      data: { type: 'Point', coordinates: [1, 2] },
    },
    applyStyleTransaction: {
      transaction: {
        operations: [{
          op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#fff' },
        }],
      },
    },
  } as const;
  const schemas = {
    analyzeGeoJson: compactAnalyzeGeoJsonInputSchema,
    listSourceLayers: compactListSourceLayersInputSchema,
    duplicateLayer: compactDuplicateLayerInputSchema,
    addLayerFromSource: compactAddLayerFromSourceInputSchema,
    addGeoJsonLayer: compactAddGeoJsonLayerInputSchema,
    applyStyleTransaction: compactApplyStyleTransactionInputSchema,
  } as const;

  for (const name of STRUCTURED_TOOL_NAMES) {
    assert.strictEqual(inputSchema(tools[name]), schemas[name], name);
    assert.equal(schemas[name].safeParse(validInputs[name]).success, true, name);
    assert.equal(schemas[name].safeParse({ ...validInputs[name], unknown: true }).success, false, name);
  }

  const tooManyOperations = Array.from({ length: 101 }, () => ({
    op: 'removeLayer' as const, layerId: 'roads',
  }));
  assert.equal(compactApplyStyleTransactionInputSchema.safeParse({
    transaction: { operations: tooManyOperations },
  }).success, false);
  assert.equal(fake.getStyleCalls, 0);
  assert.equal(fake.setStyleCalls.length, 0);
});

test('legacy operations normalize once, preserve empty compatibility, and report invalid JSON authentically', async () => {
  const fake = new FakeMap();
  const applicationStyle = { editorRevision: 7 };
  const tools = createCompactMapLibreStyleTools({
    getMap: () => fake.asMap(),
    getState: () => applicationStyle,
  });

  const empty = await executeTool(tools.applyStyleOperations, {
    operationsJson: '[]', dryRun: false, diff: true,
  });
  assert.deepEqual(empty, {
    success: true,
    message: 'Applied 0 style operations.',
    data: { dryRun: false, changedLayers: [], diffSummary: [] },
    style: applicationStyle,
  });
  assert.equal(fake.setStyleCalls.length, 0);

  const invalid = await executeTool(tools.applyStyleOperations, {
    operationsJson: '{', dryRun: false, diff: true,
  });
  assert.equal(invalid.success, false);
  assert.equal((invalid.error as { code?: unknown }).code, 'INVALID_INPUT');
  assert.strictEqual(invalid.style, applicationStyle);

  const dry = await executeTool(tools.applyStyleOperations, {
    operationsJson: JSON.stringify([{
      layerId: 'roads', paint: { 'line-color': '#fff' },
    }]),
    dryRun: true,
    diff: false,
  });
  assert.equal(dry.success, true);
  assert.deepEqual((dry.data as { changedLayers: string[] }).changedLayers, ['roads']);
  assert.equal((dry.data as { diffSummary: unknown[] }).diffSummary.length > 0, true);
  assert.equal(fake.setStyleCalls.length, 0);
});

test('legacy live apply awaits diff false and keeps semantic output identical to diff true', async () => {
  const execute = async (diff: boolean) => {
    const fake = new FakeMap();
    fake.automaticallyInstall();
    const tools = createCompactMapLibreStyleTools({ getMap: () => fake.asMap() });
    const result = await executeTool(tools.applyStyleOperations, {
      operationsJson: JSON.stringify([{
        layerId: 'roads', paint: { 'line-color': '#fff' },
      }]),
      dryRun: false,
      diff,
    });
    return { fake, result };
  };

  const disabled = await execute(false);
  const enabled = await execute(true);
  assert.equal(disabled.fake.setStyleCalls.length, 1);
  assert.deepEqual(disabled.fake.setStyleCalls[0]?.options, { diff: false });
  assert.deepEqual(enabled.fake.setStyleCalls[0]?.options, { diff: true });
  assert.deepEqual(
    (disabled.result.data as { diffSummary: unknown[] }).diffSummary,
    (enabled.result.data as { diffSummary: unknown[] }).diffSummary,
  );
  assert.equal((disabled.result.data as { styleAuthority: string }).styleAuthority, 'current');
  assert.equal('style' in (disabled.result.data as object), true);
});

test('serializes current, baseline-only, and unavailable Map authority without confusing outer state', async () => {
  const outerStyle = { application: 'state' };

  const current = new FakeMap();
  current.automaticallyInstall();
  const currentResult = await executeTool(createCompactMapLibreStyleTools({
    getMap: () => current.asMap(), getState: () => outerStyle,
  }).duplicateLayer, { layerId: 'roads', newLayerId: 'roads-copy', dryRun: false, diff: true });
  assert.strictEqual(currentResult.style, outerStyle);
  assert.equal((currentResult.data as { styleAuthority: string }).styleAuthority, 'current');
  assert.equal('style' in (currentResult.data as object), true);

  const stale = new FakeMap();
  let mutations = 0;
  stale.onSetStyle = () => {
    mutations += 1;
    queueMicrotask(() => {
      stale.emit('error', new Error(mutations === 1 ? 'apply failed' : 'rollback failed'));
      if (mutations === 2) stale.onGetStyle = () => { throw new Error('unavailable'); };
    });
  };
  const staleResult = await executeTool(createCompactMapLibreStyleTools({
    getMap: () => stale.asMap(), getState: () => outerStyle,
  }).duplicateLayer, { layerId: 'roads', newLayerId: 'roads-copy', dryRun: false, diff: true });
  assert.strictEqual(staleResult.style, outerStyle);
  assert.equal((staleResult.data as { styleAuthority: string }).styleAuthority, 'pre-operation');
  assert.equal((staleResult.data as { baselineOnly: boolean }).baselineOnly, true);
  assert.equal('style' in (staleResult.data as object), true);

  const unavailable = new FakeMap();
  unavailable.onGetStyle = () => { throw new Error('unavailable'); };
  const unavailableResult = await executeTool(createCompactMapLibreStyleTools({
    getMap: () => unavailable.asMap(), getState: () => outerStyle,
  }).duplicateLayer, { layerId: 'roads', newLayerId: 'roads-copy', dryRun: false, diff: true });
  assert.strictEqual(unavailableResult.style, outerStyle);
  assert.equal((unavailableResult.data as { styleAuthority: string }).styleAuthority, 'unavailable');
  assert.equal('style' in (unavailableResult.data as object), false);
});

test('executes every structured tool with object inputs and compact transaction envelopes', async () => {
  const analysisTools = createCompactMapLibreStyleTools({ getMap: () => null });
  const analysis = await executeTool(analysisTools.analyzeGeoJson, {
    data: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] },
        properties: { kind: 'cafe' },
      }],
    },
    options: { topValueLimit: 3 },
  });
  assert.equal(analysis.success, true);
  assert.equal((analysis.data as { available: boolean }).available, true);

  const discovery = new FakeMap();
  const sourceLayers = await executeTool(createCompactMapLibreStyleTools({
    getMap: () => discovery.asMap(),
  }).listSourceLayers, { sourceId: 'base' });
  assert.equal(sourceLayers.success, true);
  assert.deepEqual((sourceLayers.data as { sourceLayers: unknown[] }).sourceLayers, [{
    sourceId: 'base', sourceLayer: 'roads', layers: [{ id: 'roads', type: 'line' }],
  }]);

  const cases = [
    ['duplicateLayer', { layerId: 'roads', newLayerId: 'roads-copy' }, ['roads-copy'], []],
    ['addLayerFromSource', {
      layerId: 'water', sourceId: 'base', sourceLayer: 'water', type: 'fill',
    }, ['water'], []],
    ['addGeoJsonLayer', {
      sourceId: 'points-source', layerId: 'points', type: 'circle',
      data: { type: 'Point', coordinates: [1, 2] },
    }, ['points'], ['points-source']],
    ['applyStyleTransaction', {
      transaction: {
        operations: [{
          op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#fff' },
        }],
      },
    }, ['roads'], []],
  ] as const;

  for (const [name, input, changedLayers, changedSources] of cases) {
    const fake = new FakeMap();
    fake.automaticallyInstall();
    const tools = createCompactMapLibreStyleTools({ getMap: () => fake.asMap() });
    const result = await executeTool(tools[name], { ...input, dryRun: false, diff: true });
    assert.equal(result.success, true, name);
    assert.deepEqual((result.data as { changedLayers: string[] }).changedLayers, changedLayers, name);
    assert.deepEqual((result.data as { changedSources: string[] }).changedSources, changedSources, name);
    assert.equal((result.data as { diff: unknown[] }).diff.length > 0, true, name);
    assert.equal((result.data as { styleAuthority: string }).styleAuthority, 'current', name);
    assert.equal(fake.setStyleCalls.length, 1, name);
  }
});
