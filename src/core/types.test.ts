import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  LayerSpecification, SourceSpecification, StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import {
  DEFAULT_MAX_DIFF_BYTES, DEFAULT_MAX_OPERATIONS, DEFAULT_MAX_STYLE_BYTES,
  jsonUtf8ByteLength,
} from './utf8.js';
import type {
  CoreExecutionLimits, JsonObject, JsonValue, OperationContext, StyleDiffEntry,
  StyleDocument, StyleLayer, StyleOperation, StyleSource, StyleToolError,
  StyleTransaction, StyleTransactionResult,
} from './types.js';

type Extends<Actual, Expected> = [Actual] extends [Expected] ? true : false;
type Equal<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends
  (<T>() => T extends Right ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type _StyleIsJsonValue = Assert<Extends<StyleDocument, JsonValue>>;
type _LayerIsJsonObject = Assert<Extends<StyleLayer, JsonObject>>;
type _SourceIsJsonObject = Assert<Extends<StyleSource, JsonObject>>;
type _OperationIsJsonObject = Assert<Extends<StyleOperation, JsonObject>>;
type _TransactionIsJsonObject = Assert<Extends<StyleTransaction, JsonObject>>;
type _DiffIsJsonObject = Assert<Extends<StyleDiffEntry, JsonObject>>;
type _ErrorIsJsonObject = Assert<Extends<StyleToolError, JsonObject>>;
type _ResultIsJsonObject = Assert<Extends<StyleTransactionResult, JsonObject>>;
type _VersionMatchesMapLibre = Assert<Equal<
  StyleDocument['version'], StyleSpecification['version']
>>;
type _CenterMatchesMapLibre = Assert<Equal<
  StyleDocument['center'], StyleSpecification['center']
>>;
type _LayerTypeMatchesMapLibre = Assert<Equal<
  StyleLayer['type'], LayerSpecification['type']
>>;
type _SourceTypeMatchesMapLibre = Assert<Equal<
  StyleSource['type'], SourceSpecification['type']
>>;
const compileAssertions: [
  _StyleIsJsonValue, _LayerIsJsonObject, _SourceIsJsonObject,
  _OperationIsJsonObject, _TransactionIsJsonObject, _DiffIsJsonObject,
  _ErrorIsJsonObject, _ResultIsJsonObject,
  _VersionMatchesMapLibre, _CenterMatchesMapLibre,
  _LayerTypeMatchesMapLibre, _SourceTypeMatchesMapLibre,
] = [true, true, true, true, true, true, true, true, true, true, true, true];

test('strict core operations carry an op discriminator', () => {
  const operation: StyleOperation = {
    op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#fff' },
  };
  // @ts-expect-error -- strict operation types do not expose extension fields.
  const invalid: StyleOperation = { ...operation, surprise: true };
  const transaction: StyleTransaction = { operations: [operation], validate: true };
  assert.equal(transaction.operations[0]?.op, 'setLayerProperties');
  void invalid;
});

test('OperationContext requires one readonly resolved limit object', () => {
  const limits: CoreExecutionLimits = {
    maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
    maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
    maxOperations: DEFAULT_MAX_OPERATIONS,
  };
  const context: OperationContext = {
    limits, changedLayerIds: new Set(), changedSourceIds: new Set(), warnings: [],
  };
  const exactLimits: Readonly<CoreExecutionLimits> = context.limits;
  assert.strictEqual(exactLimits, limits);
  // eslint-disable-next-line no-constant-condition -- compile-only negative assertions.
  if (false) {
    // @ts-expect-error -- every handler context requires all three resolved limits.
    const missingLimits: OperationContext = {
      changedLayerIds: new Set(), changedSourceIds: new Set(), warnings: [],
    };
    // @ts-expect-error -- handlers may read but never replace coordinator limits.
    context.limits = limits;
    // @ts-expect-error -- resolved limit fields are readonly inside handlers.
    context.limits.maxStyleBytes = 1;
    void missingLimits;
  }
});

test('StyleTransactionResult narrows failure to one required stable error', () => {
  const requireStableFailure = (result: StyleTransactionResult): StyleToolError | undefined => {
    if (!result.ok) {
      const error: StyleToolError = result.error;
      return error;
    }
    return undefined;
  };
  const success: StyleTransactionResult = {
    ok: true,
    style: { version: 8, sources: {}, layers: [] },
    changedLayers: [], changedSources: [], diff: [], warnings: [],
  };
  assert.equal(requireStableFailure(success), undefined);
  assert.equal(Object.hasOwn(success, 'error'), false);
  // eslint-disable-next-line no-constant-condition -- compile-only negative assertions.
  if (false) {
    if (success.ok) {
      // @ts-expect-error -- the success branch does not declare an error member.
      void success.error;
    }
    // @ts-expect-error -- a failed result cannot omit its stable error.
    const invalidFailure: StyleTransactionResult = {
      ok: false,
      style: { version: 8, sources: {}, layers: [] },
      changedLayers: [], changedSources: [], diff: [], warnings: [],
    };
    void invalidFailure;
  }
});

test('StyleDocument keeps MapLibre access while remaining a JSON value', () => {
  const style: StyleDocument = {
    version: 8,
    metadata: { owner: 'maps' },
    state: { selected: { default: { id: 1 } } },
    sources: {
      base: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] },
    },
    layers: [{
      id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads',
      paint: { 'line-color': '#000' },
    }],
  };
  const json: JsonValue = style;
  const layerId: string | undefined = style.layers[0]?.id;
  const sourceType: string | undefined = style.sources.base?.type;
  const paint: JsonObject | undefined = style.layers[0]?.paint;
  const replacement = structuredClone(style);
  replacement.layers[0]!.paint!['line-color'] = '#fff';
  assert.equal(layerId, 'roads');
  assert.equal(sourceType, 'vector');
  assert.equal(paint?.['line-color'], '#000');
  assert.equal(replacement.layers[0]?.paint?.['line-color'], '#fff');
  assert.equal(jsonUtf8ByteLength(json) > 0, true);
  assert.deepEqual(compileAssertions, [
    true, true, true, true, true, true, true, true, true, true, true, true,
  ]);
});
