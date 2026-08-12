import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { createCompactMapLibreStyleTools } from './compact-tools.js';
import {
  compactAddGeoJsonLayerInputSchema,
  compactAddLayerFromSourceInputSchema,
  compactAnalyzeGeoJsonInputSchema,
  compactApplyStyleOperationsInputSchema,
  compactApplyStyleTransactionInputSchema,
  compactDuplicateLayerInputSchema,
  compactGetStyleContextInputSchema,
  compactInspectLayersCompactInputSchema,
  compactListSourceLayersInputSchema,
  compactSearchLayersInputSchema,
  compactValidateStylePatchJsonInputSchema,
} from './schemas.js';
import { COMPACT_LEGACY_TOOL_NAMES } from './tool-contracts.js';
import { applyStyleOperations as applyLegacyStyleOperations } from '../engine/style-operations.js';
import { jsonUtf8ByteLength } from '../core/index.js';
import type { StyleDocument as LegacyStyleDocument, StyleOperation } from '../types.js';

const STRUCTURED_TOOL_NAMES = [
  'analyzeGeoJson',
  'listSourceLayers',
  'duplicateLayer',
  'addLayerFromSource',
  'addGeoJsonLayer',
  'applyStyleTransaction',
] as const;

const ALL_TOOL_NAMES = [
  ...COMPACT_LEGACY_TOOL_NAMES,
  ...STRUCTURED_TOOL_NAMES,
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

function inputSchema(toolValue: unknown): {
  safeParse(value: unknown): { success: boolean; data?: unknown };
} {
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

test('exports all eleven strict named schemas with defaults and descriptor-safe outer inputs', () => {
  const fake = new FakeMap();
  const tools = createCompactMapLibreStyleTools({ getMap: () => fake.asMap() });
  const validInputs = {
    getStyleContext: {},
    searchLayers: {},
    inspectLayersCompact: { layerIdsJson: '[]' },
    applyStyleOperations: { operationsJson: '[]' },
    validateStylePatchJson: { patchJson: '{}' },
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
    getStyleContext: compactGetStyleContextInputSchema,
    searchLayers: compactSearchLayersInputSchema,
    inspectLayersCompact: compactInspectLayersCompactInputSchema,
    applyStyleOperations: compactApplyStyleOperationsInputSchema,
    validateStylePatchJson: compactValidateStylePatchJsonInputSchema,
    analyzeGeoJson: compactAnalyzeGeoJsonInputSchema,
    listSourceLayers: compactListSourceLayersInputSchema,
    duplicateLayer: compactDuplicateLayerInputSchema,
    addLayerFromSource: compactAddLayerFromSourceInputSchema,
    addGeoJsonLayer: compactAddGeoJsonLayerInputSchema,
    applyStyleTransaction: compactApplyStyleTransactionInputSchema,
  } as const;

  for (const name of ALL_TOOL_NAMES) {
    assert.strictEqual(inputSchema(tools[name]), schemas[name], name);
    assert.equal(schemas[name].safeParse(validInputs[name]).success, true, name);
    assert.equal(schemas[name].safeParse({ ...validInputs[name], unknown: true }).success, false, name);
  }

  assert.deepEqual(compactGetStyleContextInputSchema.parse({}), { layerLimit: 120 });
  assert.deepEqual(compactSearchLayersInputSchema.parse({}), { limit: 80 });
  assert.deepEqual(compactInspectLayersCompactInputSchema.parse({ layerIdsJson: '[]' }), {
    layerIdsJson: '[]', fields: ['paint', 'layout'],
  });
  assert.deepEqual(compactApplyStyleOperationsInputSchema.parse({ operationsJson: '[]' }), {
    operationsJson: '[]', dryRun: false, diff: true,
  });
  assert.deepEqual(compactDuplicateLayerInputSchema.parse({
    layerId: 'roads', newLayerId: 'roads-copy',
  }), {
    layerId: 'roads', newLayerId: 'roads-copy', dryRun: false, diff: true,
  });

  for (const name of ALL_TOOL_NAMES) {
    const schema = schemas[name];
    const valid = validInputs[name];
    let getterCalls = 0;
    const accessor = { ...valid } as Record<string, unknown>;
    Object.defineProperty(accessor, 'unknown', {
      enumerable: true,
      get() { getterCalls += 1; return true; },
    });
    const hidden = { ...valid } as Record<string, unknown>;
    Object.defineProperty(hidden, 'hidden', { enumerable: false, value: true });
    const shared = {};
    const alias = { ...valid, first: shared, second: shared };
    const cycle = { ...valid } as Record<string, unknown>;
    cycle.cycle = cycle;
    const dangerous = Object.assign(JSON.parse('{"__proto__":true}'), valid);
    const { proxy, revoke } = Proxy.revocable({ ...valid }, {});
    revoke();
    for (const invalid of [accessor, hidden, alias, cycle, dangerous, new Date(), proxy]) {
      assert.equal(schema.safeParse(invalid).success, false, name);
    }
    assert.equal(getterCalls, 0, name);
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

test('legacy presentation matches sequential engine history after one authoritative application', async () => {
  const cases: StyleOperation[][] = [
    [
      { layerId: 'roads', paint: { 'line-color': '#fff' } },
      { layerId: 'roads', paint: { 'line-color': '#000' } },
    ],
    [
      { layerId: 'roads', paint: { 'line-color': '#fff' } },
      { layerId: 'roads', paint: { 'line-color': 42 } },
      { layerId: 'roads', paint: { 'line-color': '#00f' } },
    ],
    [{
      layerId: 'roads',
      paint: { 'line-width': 2, 'line-color': '#fff' },
      layout: { visibility: 'visible' },
      filter: ['==', ['get', 'class'], 'primary'],
    }],
    Array.from({ length: 51 }, (_, index) => ({
      layerId: 'roads',
      paint: { 'line-width': index + 1 },
      filter: ['==', ['get', 'rank'], index],
    })),
  ];

  for (const operations of cases) {
    const expected = applyLegacyStyleOperations(
      baseStyle() as unknown as LegacyStyleDocument,
      operations,
    );
    assert.equal(expected.success, true);
    const fake = new FakeMap();
    const result = await executeTool(createCompactMapLibreStyleTools({
      getMap: () => fake.asMap(),
    }).applyStyleOperations, {
      operationsJson: JSON.stringify(operations), dryRun: true, diff: true,
    });
    assert.equal(result.success, true);
    assert.deepEqual((result.data as { changedLayers: string[] }).changedLayers, expected.changedLayers);
    assert.deepEqual((result.data as { diffSummary: unknown[] }).diffSummary, expected.diffSummary);
    assert.equal(fake.setStyleCalls.length, 0);
  }
  assert.equal(cases[3]?.length, 51);
  assert.equal(applyLegacyStyleOperations(
    baseStyle() as unknown as LegacyStyleDocument,
    cases[3]!,
  ).diffSummary.length, 102);

  const liveOperations = cases[1]!;
  const live = new FakeMap();
  live.automaticallyInstall();
  const liveResult = await executeTool(createCompactMapLibreStyleTools({
    getMap: () => live.asMap(),
  }).applyStyleOperations, {
    operationsJson: JSON.stringify(liveOperations), dryRun: false, diff: true,
  });
  assert.equal(liveResult.success, true);
  assert.deepEqual(
    (liveResult.data as { diffSummary: unknown[] }).diffSummary,
    applyLegacyStyleOperations(
      baseStyle() as unknown as LegacyStyleDocument,
      liveOperations,
    ).diffSummary,
  );
  assert.equal(live.setStyleCalls.length, 1);

  const combined = new FakeMap();
  (combined.style.layers[0]!.paint as Record<string, unknown>)['line-width'] = 0;
  combined.automaticallyInstall();
  const combinedResult = await executeTool(createCompactMapLibreStyleTools({
    getMap: () => combined.asMap(),
  }).applyStyleOperations, {
    operationsJson: JSON.stringify(cases[3]), dryRun: false, diff: true,
  });
  assert.equal(combinedResult.success, true);
  assert.equal((combinedResult.data as { diffSummary: unknown[] }).diffSummary.length, 102);
  assert.equal(combined.setStyleCalls.length, 1);
});

test('legacy failures preserve friendly engine messages and empty presentation data', async () => {
  for (const operations of [
    [{ layerId: 'missing', paint: { 'line-color': '#fff' } }],
    [{ layerId: 'roads', paint: { 'line-color': 42 } }],
  ] satisfies StyleOperation[][]) {
    const expected = applyLegacyStyleOperations(
      baseStyle() as unknown as LegacyStyleDocument,
      operations,
    );
    const result = await executeTool(createCompactMapLibreStyleTools({
      getMap: () => new FakeMap().asMap(),
    }).applyStyleOperations, {
      operationsJson: JSON.stringify(operations), dryRun: true, diff: true,
    });
    assert.equal(result.success, false);
    assert.equal(result.message, expected.message);
    assert.equal(
      (result.error as { code?: unknown }).code,
      operations[0]?.layerId === 'missing' ? 'NOT_FOUND' : 'STYLE_INVALID',
    );
    assert.deepEqual(result.data, { changedLayers: [], diffSummary: [] });
  }
});

test('legacy lifecycle shim verifies fresh synchronous state and rejects no-op or async installs', async () => {
  const operationsJson = JSON.stringify([{
    layerId: 'roads', paint: { 'line-color': '#fff' },
  }]);

  for (const mode of ['noop', 'async'] as const) {
    let style = baseStyle();
    let getStyleCalls = 0;
    const map = {
      getStyle: () => { getStyleCalls += 1; return style; },
      setStyle: (candidate: StyleSpecification) => {
        if (mode === 'async') setTimeout(() => { style = candidate; }, 0);
        return map;
      },
    } as unknown as MapLibreMap;
    const result = await executeTool(createCompactMapLibreStyleTools({
      getMap: () => map,
    }).applyStyleOperations, { operationsJson, dryRun: false, diff: true });
    assert.equal(result.success, false, mode);
    assert.notEqual(
      ((result.data as { style?: StyleSpecification }).style?.layers[0]?.paint as
        Record<string, unknown> | undefined)?.['line-color'],
      '#fff',
      mode,
    );
    assert.equal(getStyleCalls >= 3, true, mode);
  }

  let style = baseStyle();
  const syncMap = {
    getStyle: () => style,
    setStyle: (candidate: StyleSpecification) => { style = candidate; return syncMap; },
  } as unknown as MapLibreMap;
  const result = await executeTool(createCompactMapLibreStyleTools({
    getMap: () => syncMap,
  }).applyStyleOperations, { operationsJson, dryRun: false, diff: true });
  assert.equal(result.success, true);
  assert.equal(
    (style.layers[0]?.paint as Record<string, unknown> | undefined)?.['line-color'],
    '#fff',
  );
});

test('structured query outputs remain bounded and report truncation', async () => {
  const maxBytes = 1024 * 1024;
  const properties = Object.fromEntries(
    Array.from({ length: 5_000 }, (_, index) => [`property-${index}`, index]),
  );
  const analysis = await executeTool(createCompactMapLibreStyleTools({
    getMap: () => null,
  }).analyzeGeoJson, {
    data: {
      type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties,
    },
  });
  assert.equal(analysis.success, true);
  const analysisData = analysis.data as {
    properties: unknown[]; returned: number; truncated: boolean; warnings: unknown[];
  };
  assert.equal(analysisData.returned, analysisData.properties.length);
  assert.equal(analysisData.returned < 5_000, true);
  assert.equal(analysisData.truncated, true);
  assert.equal(analysisData.warnings.length > 0, true);
  assert.equal(jsonUtf8ByteLength(analysisData as never) <= maxBytes, true);

  const style = baseStyle();
  style.sources = {};
  style.layers = [];
  for (let index = 0; index < 5_000; index += 1) {
    const sourceId = `source-${index}`;
    style.sources[sourceId] = { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] };
    style.layers.push({
      id: `layer-${index}`, type: 'line', source: sourceId, 'source-layer': `group-${index}`,
    });
  }
  const sourceLayers = await executeTool(createCompactMapLibreStyleTools({
    getMap: () => new FakeMap(style).asMap(),
  }).listSourceLayers, {});
  assert.equal(sourceLayers.success, true);
  const sourceData = sourceLayers.data as {
    sourceLayers: unknown[]; returned: number; truncated: boolean; warnings: unknown[];
  };
  assert.equal(sourceData.returned, sourceData.sourceLayers.length);
  assert.equal(sourceData.returned < 5_000, true);
  assert.equal(sourceData.truncated, true);
  assert.equal(sourceData.warnings.length > 0, true);
  assert.equal(jsonUtf8ByteLength(sourceData as never) <= maxBytes, true);
});

test('analysis byte cap includes exact and excludes one-over UTF-8 envelope boundaries', async () => {
  const maxBytes = 1024 * 1024;
  const projected = (value: string) => ({
    available: true,
    featureCount: 1,
    geometryTypes: { Point: 1 },
    bbox: [1, 2, 1, 2],
    properties: [{
      name: 'huge', types: ['string'], topValues: [{ value, count: 1 }],
    }],
    returned: 1,
    truncated: false,
    warnings: [],
  });
  const emptyBytes = jsonUtf8ByteLength(projected('') as never);
  const exactValue = 'a'.repeat(maxBytes - emptyBytes);
  assert.equal(jsonUtf8ByteLength(projected(exactValue) as never), maxBytes);

  const execute = async (value: string) => executeTool(createCompactMapLibreStyleTools({
    getMap: () => null,
  }).analyzeGeoJson, {
    data: {
      type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] },
      properties: { huge: value },
    },
  });
  const exact = await execute(exactValue);
  const exactData = exact.data as {
    properties: unknown[]; returned: number; truncated: boolean; warnings: unknown[];
  };
  assert.equal(exact.success, true);
  assert.equal(exactData.returned, 1);
  assert.equal(exactData.truncated, false);
  assert.equal(jsonUtf8ByteLength(exactData as never), maxBytes);

  const over = await execute(`${exactValue}a`);
  const overData = over.data as typeof exactData;
  assert.equal(over.success, true);
  assert.equal(overData.returned, 0);
  assert.equal(overData.truncated, true);
  assert.equal(jsonUtf8ByteLength(overData as never) <= maxBytes, true);
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
