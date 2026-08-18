import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createStyleToolError } from '../core/index.js';
import type { StyleToolError } from '../core/index.js';
import {
  COMPACT_OUTPUT_TRUNCATED,
  MAX_AI_OUTPUT_BYTES,
  boundFeatureQueryProjection,
  boundInspectionProjection,
  boundMapCommandReceipt,
  boundStyleMutationReceipt,
  jsonUtf8ByteLength,
  toFailure,
} from './boundary.js';
import type {
  AiStyleToolResult,
  ApplyStyleDocumentInput,
  ApplyStyleTransactionInput,
  FeatureQueryProjection,
  InspectStyleInput,
  InspectionProjection,
  MapCommandReceipt,
  MapLibreStyleTools,
  QueryMapFeaturesInput,
  RunMapCommandInput,
  StyleMutationReceipt,
} from './contracts.js';

const assertResultNarrowing = (result: AiStyleToolResult<InspectionProjection>): void => {
  if (result.success) {
    const data: InspectionProjection = result.data;
    // @ts-expect-error successful AI results have no error.
    void result.error;
    void data;
  } else {
    const error: StyleToolError = result.error;
    // @ts-expect-error failed AI results have no data.
    void result.data;
    void error;
  }
};

const assertToolSignatures = (tools: MapLibreStyleTools): void => {
  const inspect: (input: InspectStyleInput) => Promise<AiStyleToolResult<InspectionProjection>> = tools.inspectStyle.execute;
  const transaction: (input: ApplyStyleTransactionInput) => Promise<AiStyleToolResult<StyleMutationReceipt>> = tools.applyStyleTransaction.execute;
  const document: (input: ApplyStyleDocumentInput) => Promise<AiStyleToolResult<StyleMutationReceipt>> = tools.applyStyleDocument.execute;
  const command: (input: RunMapCommandInput) => Promise<AiStyleToolResult<MapCommandReceipt>> = tools.runMapCommand.execute;
  const query: (input: QueryMapFeaturesInput) => Promise<AiStyleToolResult<FeatureQueryProjection>> = tools.queryMapFeatures.execute;
  void [inspect, transaction, document, command, query];
};
void [assertResultNarrowing, assertToolSignatures];

const assertInvalidListReceipt = (): void => {
  // @ts-expect-error list commands require an item collection result.
  void boundMapCommandReceipt({ message: 'no', action: 'listImages', kind: 'list', applied: true, result: 'not-a-list', warnings: [] });
};
void assertInvalidListReceipt;

const sourceWarnings = Array.from({ length: 21 }, (_, index) => ({
  code: `WARNING_${index}`,
  message: `Warning ${index}.`,
}));

const oversizedFeatures = Array.from({ length: 101 }, (_, index) => ({
  type: 'Feature' as const,
  properties: { index, payload: 'x'.repeat(20_000) },
  geometry: { type: 'Point' as const, coordinates: [index, index] as [number, number] },
}));

describe('bounded AI result boundary', () => {
  it('bounds the complete feature envelope in source order', () => {
    const bounded = boundFeatureQueryProjection({
      message: 'Feature query completed.',
      target: 'source',
      features: oversizedFeatures,
      total: 101,
      warnings: sourceWarnings,
    });
    assert.ok(jsonUtf8ByteLength(bounded) <= MAX_AI_OUTPUT_BYTES);
    assert.equal(bounded.success, true);
    if (bounded.success) {
      assert.equal(bounded.data.truncated, true);
      assert.deepEqual(bounded.data.warnings.at(-1), COMPACT_OUTPUT_TRUNCATED);
      assert.equal(bounded.data.features.length, 52);
      assert.equal(bounded.data.features.at(-1)?.properties?.index, 51);
      assert.equal(bounded.data.warnings.length, 21);
    }
  });

  it('stops at the 101st small feature', () => {
    const features = Array.from({ length: 101 }, (_, id) => ({
      type: 'Feature' as const, properties: { id }, geometry: { type: 'Point' as const, coordinates: [id, id] as [number, number] },
    }));
    const bounded = boundFeatureQueryProjection({ message: 'ok', target: 'source', features, warnings: [] });
    assert.equal(bounded.success, true);
    if (bounded.success) {
      assert.equal(bounded.data.returned, 100);
      assert.equal(bounded.data.features.at(-1)?.properties?.id, 99);
      assert.equal(bounded.data.truncated, true);
    }
  });

  it('omits an oversized first list item atomically', () => {
    const bounded = boundMapCommandReceipt({
      message: 'ok', action: 'listImages', kind: 'list', applied: true,
      result: { items: ['x'.repeat(MAX_AI_OUTPUT_BYTES), 'later'] }, warnings: [],
    });
    assert.equal(bounded.success, true);
    if (bounded.success && bounded.data.result && typeof bounded.data.result === 'object' && 'items' in bounded.data.result) {
      assert.deepEqual(bounded.data.result.items, []);
      assert.equal(bounded.data.result.truncated, true);
    }
  });
  it('keeps both list and receipt truncation markers within a near-cap envelope', () => {
    const bounded = boundMapCommandReceipt({
      message: 'ok', action: 'listImages', kind: 'list', applied: true,
      result: { items: ['x'.repeat(MAX_AI_OUTPUT_BYTES - 800), 'later'] }, warnings: [],
    });
    assert.ok(jsonUtf8ByteLength(bounded) <= MAX_AI_OUTPUT_BYTES);
    assert.equal(bounded.success, true);
  });


  it('caps messages and omits oversized atomic values', () => {
    const bounded = boundInspectionProjection({
      message: 'm'.repeat(4_097),
      action: 'getRoot',
      projection: { value: { payload: 'x'.repeat(MAX_AI_OUTPUT_BYTES) } },
      warnings: [],
    });
    assert.equal(bounded.success, true);
    if (bounded.success) {
      assert.equal(Buffer.byteLength(bounded.message, 'utf8'), 4_096);
      assert.equal(bounded.data.projection.returned, 0);
      assert.equal(bounded.data.projection.truncated, true);
      assert.deepEqual(bounded.data.projection.warnings, [COMPACT_OUTPUT_TRUNCATED]);
    }
  });

  it('stops nested inspection collections at the first omitted item', () => {
    const bounded = boundInspectionProjection({
      message: 'Inspection completed.',
      action: 'listLayers',
      projection: { items: [{ id: 1 }, { payload: 'x'.repeat(MAX_AI_OUTPUT_BYTES) }, { id: 3 }], total: 3 },
      warnings: [],
    });
    assert.equal(bounded.success, true);
    if (bounded.success && 'items' in bounded.data.projection) {
      assert.deepEqual(bounded.data.projection.items, [{ id: 1 }]);
      assert.equal(bounded.data.projection.returned, 1);
      assert.equal(bounded.data.projection.truncated, true);
    }
  });

  it('allocates mutation receipt fields in required order', () => {
    const bounded = boundStyleMutationReceipt({
      message: 'Mutation completed.',
      applied: true,
      noOp: false,
      changedLayers: ['l'.repeat(400_000), 'later-layer'],
      changedSources: ['s'.repeat(400_000), 'later-source'],
      diff: [{ op: 'add', path: '/x', target: { kind: 'style' }, after: 'd'.repeat(400_000) }],
      warnings: [],
      styleAuthority: 'current',
    });
    assert.equal(bounded.success, true);
    if (bounded.success) {
      assert.deepEqual(bounded.data.changedLayers, ['l'.repeat(400_000), 'later-layer']);
      assert.deepEqual(bounded.data.changedSources, ['s'.repeat(400_000), 'later-source']);
      assert.deepEqual(bounded.data.diff, undefined);
      assert.equal(bounded.data.truncated, true);
    }
  });

  it('allocates command lists before marking their truncation', () => {
    const bounded = boundMapCommandReceipt({
      message: 'Command completed.',
      action: 'listImages',
      kind: 'list',
      applied: true,
      result: { items: ['first', 'x'.repeat(MAX_AI_OUTPUT_BYTES), 'later'] },
      warnings: [],
    });
    assert.equal(bounded.success, true);
    if (bounded.success && bounded.data.result && typeof bounded.data.result === 'object' && 'items' in bounded.data.result) {
      assert.deepEqual(bounded.data.result.items, ['first']);
      assert.equal(bounded.data.result.truncated, true);
    }
  });

  it('lowers but never raises the feature byte cap', () => {
    const high = boundFeatureQueryProjection({ message: 'ok', target: 'source', features: oversizedFeatures, warnings: [], maxSerializedBytes: MAX_AI_OUTPUT_BYTES * 2 });
    const low = boundFeatureQueryProjection({ message: 'ok', target: 'source', features: oversizedFeatures, warnings: [], maxSerializedBytes: 10_000 });
    assert.ok(jsonUtf8ByteLength(high) <= MAX_AI_OUTPUT_BYTES);
    if (low.success && high.success) assert.ok(low.data.features.length < high.data.features.length);
  });

  it('bounds oversized authenticated error details', () => {
    const failure = toFailure(createStyleToolError('INTERNAL', 'error', undefined, { payload: 'x'.repeat(MAX_AI_OUTPUT_BYTES) }));
    assert.equal(failure.success, false);
    assert.ok(jsonUtf8ByteLength(failure) <= MAX_AI_OUTPUT_BYTES);
    if (!failure.success) assert.deepEqual(failure.error.details, { outputTruncated: true });
  });
});
