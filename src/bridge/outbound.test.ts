import assert from 'node:assert/strict';
import test from 'node:test';

import type { StyleDocument, StyleToolError } from '../core/index.js';
import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeCapability,
  type BridgeCommand,
  type BridgeEventFrame,
  type BridgeRegisterFrame,
  type BridgeResultFrame,
} from './protocol.js';
import {
  assertCapability,
  requiredCapabilityForCommand,
} from './capabilities.js';
import {
  assertInboundEventAllowed,
  assertInboundResultAllowed,
  prepareOutboundBridgeFrame,
  publicBridgeErrorMessage,
  type PreparedOutboundBridgeFrame,
} from './outbound.js';

const styleHash = '1'.repeat(64);
const style = (marker = ''): StyleDocument => ({
  version: 8,
  sources: {},
  layers: [],
  ...(marker === '' ? {} : { metadata: { marker } }),
}) as StyleDocument;

const applyCommand: BridgeCommand = {
  type: 'applyTransaction',
  expectedRevision: 0,
  expectedStyleHash: '0'.repeat(64),
  transaction: {
    operations: [{ op: 'setLayerFilter', layerId: 'roads', mode: 'clear' }],
    validate: true,
  },
};

const applyDocumentCommand: BridgeCommand = {
  type: 'applyStyleDocument',
  expectedRevision: 0,
  expectedStyleHash: '0'.repeat(64),
  source: { kind: 'style', style: style() },
  diff: true,
};

const commands: Array<[BridgeCommand, BridgeCapability]> = [
  [{ type: 'getStyle' }, 'style.read'],
  [applyCommand, 'style.write'],
  [applyDocumentCommand, 'style.write'],
  [{ type: 'updateGeoJsonData', sourceId: 'roads', diff: { removeAll: true } }, 'style.write'],
  [{ type: 'setSourceTileLodParams', maxZoomLevelsOnScreen: 2, tileCountMaxMinRatio: 1 }, 'runtime.state'],
  [{ type: 'querySourceFeatures', sourceId: 'roads' }, 'features.query'],
  [{ type: 'queryRenderedFeatures' }, 'features.query'],
  [{ type: 'setFeatureState', target: { source: 'roads', id: 1 }, state: {} }, 'runtime.state'],
  [{ type: 'removeFeatureState', target: { source: 'roads', id: 1 } }, 'runtime.state'],
  [{ type: 'setGlobalState', propertyName: 'mode', value: 'dark' }, 'runtime.state'],
  [{ type: 'listImages' }, 'style.read'],
  [{ type: 'addImage', imageId: 'marker', image: { kind: 'rgba', width: 1, height: 1, data: 'AAAAAA==' } }, 'assets.write'],
  [{ type: 'removeImage', imageId: 'marker' }, 'assets.write'],
  [{ type: 'listSprites' }, 'style.read'],
  [{ type: 'addSprite', spriteId: 'marker', url: 'https://example.test/marker.json' }, 'assets.write'],
  [{ type: 'removeSprite', spriteId: 'marker' }, 'assets.write'],
];

const resultFrame = (result: Record<string, unknown>): BridgeResultFrame => ({
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  kind: 'result',
  correlationId: 'result-1',
  ok: true,
  result,
}) as BridgeResultFrame;

const failureFrame = (
  code: StyleToolError['code'],
  details?: Record<string, unknown>,
  message = 'private failure',
): BridgeResultFrame => ({
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  kind: 'result',
  correlationId: 'result-1',
  ok: false,
  error: { code, message, ...(details === undefined ? {} : { details }) },
}) as BridgeResultFrame;

test('each command requires its explicit capability', () => {
  for (const [command, capability] of commands) {
    assert.equal(requiredCapabilityForCommand(command), capability);
    assert.doesNotThrow(() => assertCapability([capability], command));
  }
  assert.throws(
    () => assertCapability(['style.read'], applyCommand),
    (error: StyleToolError) => error.code === 'CAPABILITY_DENIED'
      && error.details?.commandType === 'applyTransaction'
      && error.details.requiredCapability === 'style.write',
  );
});

test('a near-limit registration deterministically falls back to metadata-only', () => {
  const frame: BridgeRegisterFrame = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'register',
    correlationId: 'register-1',
    registrationAttemptId: 'A'.repeat(43),
    mapId: 'demo-map',
    capabilities: ['style.read'],
    limits: {
      maxMessageBytes: 5 * 1024 * 1024,
      maxStyleBytes: 5 * 1024 * 1024,
      maxDiffBytes: 1024 * 1024,
      maxOperations: 100,
    },
    snapshot: { revision: 7, styleHash, style: style('x'.repeat(2_000)) },
  };
  const prepared = prepareOutboundBridgeFrame(frame, ['style.read'], 600);
  assert.ok(new TextEncoder().encode(prepared.encoded).byteLength <= 600);
  assert.deepEqual(prepared.frame.snapshot, { revision: 7, styleHash });
});

test('full transactions degrade through Style and diff omission before a receipt', () => {
  const result = resultFrame({
    type: 'transaction',
    detail: 'full',
    revision: 1,
    styleHash,
    applied: true,
    noOp: false,
    changedLayerIds: ['roads'],
    changedSourceIds: [],
    warnings: [],
    style: style('x'.repeat(2_000)),
    diff: [{
      op: 'replace', path: '/layers/0/paint/line-color', before: '#000',
      after: '#fff', target: { kind: 'layer', id: 'roads' },
    }],
  });
  const withoutStyle = prepareOutboundBridgeFrame(result, ['style.read'], applyCommand, 900);
  assert.equal(withoutStyle.frame.ok && withoutStyle.frame.result.type === 'transaction'
    && withoutStyle.frame.result.detail, 'full');
  assert.deepEqual(withoutStyle.frame.ok && withoutStyle.frame.result.type === 'transaction'
    && withoutStyle.frame.result.detail === 'full' && withoutStyle.frame.result.omitted,
  { style: true });
  const receipt = prepareOutboundBridgeFrame(result, ['style.read'], applyCommand, 250);
  assert.equal(receipt.frame.ok && receipt.frame.result.type === 'transaction'
    && receipt.frame.result.detail, 'receipt');
});

test('every current-authority mutation failure keeps its code and authoritative metadata', () => {
  for (const code of ['INTERNAL', 'IO_ERROR', 'REVISION_CONFLICT', 'TIMEOUT'] as const) {
    const prepared: PreparedOutboundBridgeFrame<BridgeResultFrame> = prepareOutboundBridgeFrame(failureFrame(code, {
      currentSnapshot: { revision: 9, styleHash, style: style('x'.repeat(2_000)) },
    }), ['style.read'], applyCommand, 700);
    assert.equal(prepared.frame.ok, false);
    if (prepared.frame.ok) assert.fail('expected failure');
    assert.equal(prepared.frame.error.code, code);
    assert.deepEqual(prepared.frame.error.details, {
      currentSnapshot: { revision: 9, styleHash },
    });
  }
});

test('whole-style mutation failures project exactly like transactions', () => {
  const failure = failureFrame('INTERNAL', {
    currentSnapshot: { revision: 9, styleHash, style: style('x'.repeat(2_000)) },
    rolledBack: false,
    rollbackError: { code: 'IO_ERROR', message: 'private rollback' },
  });
  const transaction = prepareOutboundBridgeFrame(failure, ['style.read'], applyCommand, 700);
  const document = prepareOutboundBridgeFrame(failure, ['style.read'], applyDocumentCommand, 700);
  assert.deepEqual(document.frame, transaction.frame);
});

test('write-only peers permit receipts and metadata but reject full or Style-bearing frames', () => {
  const receipt = resultFrame({
    type: 'transaction', detail: 'receipt', revision: 1, styleHash,
    applied: true, noOp: false,
  });
  const full = resultFrame({
    type: 'transaction', detail: 'full', revision: 1, styleHash,
    applied: true, noOp: false, changedLayerIds: [], changedSourceIds: [], warnings: [],
    style: style('secret'),
  });
  const event: BridgeEventFrame = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION, kind: 'event', event: 'mapSnapshot', mapId: 'demo-map',
    snapshot: { revision: 1, styleHash, style: style('secret') },
  };
  assert.doesNotThrow(() => assertInboundResultAllowed(['style.write'], applyCommand, receipt));
  assert.throws(() => assertInboundResultAllowed(['style.write'], applyCommand, full), /capability/i);
  assert.throws(() => assertInboundEventAllowed(['style.write'], event), /capability/i);
});

test('write-only error projection replaces primary and rollback strings with fixed public text', () => {
  const secret = 'https://user:credential@example.test/private-style';
  const prepared = prepareOutboundBridgeFrame(failureFrame('INTERNAL', {
    currentSnapshot: { revision: 1, styleHash, style: style(secret) },
    rolledBack: false,
    rollbackError: {
      code: 'IO_ERROR', message: secret, path: `/${secret}`, details: { secret },
    },
  }, `failed for ${secret}`), ['style.write'], applyCommand);
  assert.equal(prepared.encoded.includes(secret), false);
  assert.equal(prepared.frame.ok, false);
  if (prepared.frame.ok) assert.fail('expected failure');
  assert.equal(prepared.frame.error.message, publicBridgeErrorMessage('INTERNAL'));
  assert.equal('path' in prepared.frame.error, false);
  assert.deepEqual(prepared.frame.error.details, {
    currentSnapshot: { revision: 1, styleHash },
    rolledBack: false,
    rollbackError: { code: 'IO_ERROR', message: publicBridgeErrorMessage('IO_ERROR') },
  });
});

test('authoritative error snapshots are restricted to correlated applyTransaction failures', () => {
  assert.throws(() => prepareOutboundBridgeFrame(
    failureFrame('INTERNAL', { currentSnapshot: { revision: 1, styleHash, style: style() } }),
    ['style.read'], { type: 'getStyle' },
  ), /mutation|command|protocol/i);
});

test('getStyle degrades indivisibly and other fixed results never truncate semantically', () => {
  const oversizedStyle = resultFrame({
    type: 'style', revision: 1, styleHash, style: style('x'.repeat(2_000)),
  });
  const prepared = prepareOutboundBridgeFrame(oversizedStyle, ['style.read'], { type: 'getStyle' }, 300);
  assert.equal(prepared.frame.ok, false);
  if (prepared.frame.ok) assert.fail('expected bounded failure');
  assert.equal(prepared.frame.error.code, 'INVALID_INPUT');
  assert.throws(() => prepareOutboundBridgeFrame(resultFrame({
    type: 'images', imageIds: ['x'.repeat(100)], returned: 1,
    truncated: false, serializedBytes: 102,
  }), ['style.read'], { type: 'listImages' }, 80), /size/i);
});
