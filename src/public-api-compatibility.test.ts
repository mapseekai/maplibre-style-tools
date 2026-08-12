import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Map } from 'maplibre-gl';
import {
  createCompactMapLibreStyleTools,
  createMapLibreStyleTools,
} from './index.js';
import { COMPACT_LEGACY_TOOL_NAMES } from './ai-sdk/tool-contracts.js';
import type { StyleDocument } from './types.js';

type ToolResult = {
  success: boolean;
  message: string;
};

const style: StyleDocument = {
  version: 8,
  sources: {
    base: {
      type: 'vector',
      tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
    },
  },
  layers: [{
    id: 'roads',
    type: 'line',
    source: 'base',
    'source-layer': 'roads',
    paint: { 'line-color': '#000' },
  }],
};

const executeTool = async (
  toolValue: unknown,
  input: Record<string, unknown>
): Promise<ToolResult> => {
  const execute = (toolValue as {
    execute?: (value: Record<string, unknown>) => unknown;
  }).execute;
  assert.ok(execute);
  const result = await execute(input);
  assert.equal(typeof result, 'object');
  assert.notEqual(result, null);
  return result as ToolResult;
};

test('keeps the existing full and compact tool-name surfaces', () => {
  const full = createMapLibreStyleTools({ getMap: () => null });
  assert.equal(Object.keys(full).length, 53);
  for (const name of [
    'setLayerPaintProperty', 'setLayerLayoutProperty',
    'setLayerPaintPropertySmart', 'setLayerLayoutPropertySmart',
    'batchSetLayerPaintPropertiesSmart', 'batchSetLayerLayoutPropertiesSmart',
    'batchSetLayerPaintProperties', 'batchSetLayerLayoutProperties',
    'clearLayerPaintProperty', 'clearLayerLayoutProperty', 'setLayerFilter',
    'setLayerZoomRange', 'setLayerVisibility', 'validateStyleJson',
    'validateCurrentMapStyle',
  ]) assert.equal(name in full, true, name);

  const compact = createCompactMapLibreStyleTools({ getMap: () => null });
  const names = Object.keys(compact);
  assert.deepEqual(names.slice(0, COMPACT_LEGACY_TOOL_NAMES.length), [
    ...COMPACT_LEGACY_TOOL_NAMES,
  ]);
  const approvedStructuredNames = [
    'analyzeGeoJson', 'listSourceLayers', 'duplicateLayer',
    'addLayerFromSource', 'addGeoJsonLayer', 'applyStyleTransaction',
  ];
  for (const name of approvedStructuredNames) assert.equal(name in compact, true, name);
  assert.deepEqual(names, [...COMPACT_LEGACY_TOOL_NAMES, ...approvedStructuredNames]);
});

test('ordinary delegated tools preserve the exact missing-layer result', async () => {
  let setStyleCalls = 0;
  const map = {
    getStyle: () => structuredClone(style),
    getLayer: () => undefined,
    setStyle: () => { setStyleCalls += 1; },
  } as unknown as Map;
  const full = createMapLibreStyleTools({ getMap: () => map });
  const cases = [
    ['setLayerPaintProperty', {
      layerId: 'missing', property: 'line-color', valueJson: '"#fff"',
    }],
    ['setLayerLayoutProperty', {
      layerId: 'missing', property: 'line-cap', valueJson: '"round"',
    }],
    ['batchSetLayerPaintProperties', {
      layerId: 'missing', propertiesJson: '{"line-color":"#fff"}',
    }],
    ['batchSetLayerLayoutProperties', {
      layerId: 'missing', propertiesJson: '{"line-cap":"round"}',
    }],
    ['clearLayerPaintProperty', {
      layerId: 'missing', property: 'line-color',
    }],
    ['clearLayerLayoutProperty', {
      layerId: 'missing', property: 'line-cap',
    }],
    ['setLayerFilter', {
      layerId: 'missing', filterJson: 'null',
    }],
    ['setLayerVisibility', {
      layerId: 'missing', visibility: 'none',
    }],
  ] as const;

  for (const [name, input] of cases) {
    const result = await executeTool(full[name], input);
    assert.equal(result.success, false, name);
    assert.equal(
      result.message,
      'Layer "missing" not found in current style.',
      name
    );
  }
  assert.equal(setStyleCalls, 0);
});

test('smart delegated tools preserve the exact missing-layer result', async () => {
  let setStyleCalls = 0;
  const map = {
    getStyle: () => structuredClone(style),
    getLayer: () => undefined,
    setStyle: () => { setStyleCalls += 1; },
  } as unknown as Map;
  const full = createMapLibreStyleTools({ getMap: () => map });
  const cases = [
    ['setLayerPaintPropertySmart', {
      layerId: 'missing', property: 'line-color', valueJson: '"#fff"',
    }],
    ['setLayerLayoutPropertySmart', {
      layerId: 'missing', property: 'line-cap', valueJson: '"round"',
    }],
    ['batchSetLayerPaintPropertiesSmart', {
      layerId: 'missing', propertiesJson: '{"line-color":"#fff"}',
    }],
    ['batchSetLayerLayoutPropertiesSmart', {
      layerId: 'missing', propertiesJson: '{"line-cap":"round"}',
    }],
  ] as const;

  for (const [name, input] of cases) {
    const result = await executeTool(full[name], input);
    assert.equal(result.success, false, name);
    assert.equal(
      result.message,
      'Layer "missing" not found in current style.',
      name
    );
  }
  assert.equal(setStyleCalls, 0);
});

test('smart batch tools check a missing layer before propertiesJson', async () => {
  let setStyleCalls = 0;
  const map = {
    getStyle: () => structuredClone(style),
    getLayer: () => undefined,
    setStyle: () => { setStyleCalls += 1; },
  } as unknown as Map;
  const full = createMapLibreStyleTools({ getMap: () => map });

  for (const name of [
    'batchSetLayerPaintPropertiesSmart',
    'batchSetLayerLayoutPropertiesSmart',
  ] as const) {
    for (const propertiesJson of ['{', '{}']) {
      const result = await executeTool(full[name], {
        layerId: 'missing',
        propertiesJson,
      });
      assert.equal(result.success, false, `${name}:${propertiesJson}`);
      assert.equal(
        result.message,
        'Layer "missing" not found in current style.',
        `${name}:${propertiesJson}`
      );
    }
  }
  assert.equal(setStyleCalls, 0);
});

test('full filter tool skips setStyle for equal and absent-clear no-ops', async () => {
  let setStyleCalls = 0;
  let currentStyle = structuredClone(style);
  currentStyle.layers[0]!.filter = ['==', ['get', 'class'], 'primary'];
  const map = {
    getStyle: () => structuredClone(currentStyle),
    getLayer: (layerId: string) => currentStyle.layers.find(
      (layer) => layer.id === layerId
    ),
    setStyle: () => { setStyleCalls += 1; },
  } as unknown as Map;
  const full = createMapLibreStyleTools({ getMap: () => map });

  const equal = await executeTool(full.setLayerFilter, {
    layerId: 'roads',
    filterJson: '["==",["get","class"],"primary"]',
  });
  assert.equal(equal.success, true);
  assert.equal(setStyleCalls, 0);

  currentStyle = structuredClone(style);
  const absentClear = await executeTool(full.setLayerFilter, {
    layerId: 'roads',
    filterJson: 'null',
  });
  assert.equal(absentClear.success, true);
  assert.equal(setStyleCalls, 0);
});

test('compact apply tool skips setStyle for filter no-ops', async () => {
  let setStyleCalls = 0;
  let currentStyle = structuredClone(style);
  currentStyle.layers[0]!.filter = ['==', ['get', 'class'], 'primary'];
  const map = {
    getStyle: () => structuredClone(currentStyle),
    setStyle: () => { setStyleCalls += 1; },
  } as unknown as Map;
  const compact = createCompactMapLibreStyleTools({ getMap: () => map });

  const equal = await executeTool(compact.applyStyleOperations, {
    operationsJson: JSON.stringify([{
      layerId: 'roads',
      filter: ['==', ['get', 'class'], 'primary'],
    }]),
    dryRun: false,
    diff: true,
  });
  assert.equal(equal.success, true);
  assert.equal(setStyleCalls, 0);

  currentStyle = structuredClone(style);
  const absentClear = await executeTool(compact.applyStyleOperations, {
    operationsJson: JSON.stringify([{ layerId: 'roads', filter: null }]),
    dryRun: false,
    diff: true,
  });
  assert.equal(absentClear.success, true);
  assert.equal(setStyleCalls, 0);
});
