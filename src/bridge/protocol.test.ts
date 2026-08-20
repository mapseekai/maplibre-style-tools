import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256CanonicalJson } from '../adapters/maplibre/style-hash.js';
import { canonicalizeJson } from '../core/index.js';
import {
  BRIDGE_COMMAND_RESULT_TYPES,
  BRIDGE_PROTOCOL_VERSION,
  BridgeAuthFrameSchema,
  BridgeCommandFrameSchema,
  BridgeCommandSchema,
  BridgeCommandVariantSchemas,
  BridgeEventFrameSchema,
  BridgeMapIdSchema,
  BridgeRegisterFrameSchema,
  BridgeResultFrameSchema,
  RegistrationAttemptIdSchema,
  type BridgeCommand,
  type BridgeCommandFrame,
  type BridgeResultFor,
  type BridgeResultFrame,
} from './protocol.js';
import {
  assertCorrelated,
  decodeBridgeFrame,
  encodeBridgeFrame,
} from './codec.js';

const style0 = { version: 8 as const, sources: {}, layers: [] };
const hash0 = '0'.repeat(64);
const hash1 = '1'.repeat(64);
const limits = {
  maxMessageBytes: 5 * 1024 * 1024,
  maxStyleBytes: 5 * 1024 * 1024,
  maxDiffBytes: 1024 * 1024,
  maxOperations: 100,
};

const resultFrame = (result: Record<string, unknown>) => ({
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  kind: 'result',
  correlationId: 'result-1',
  ok: true,
  result,
});

const transactionReceipt = (overrides: Record<string, unknown> = {}) => ({
  type: 'transaction',
  detail: 'receipt',
  revision: 1,
  styleHash: hash1,
  applied: true,
  noOp: false,
  ...overrides,
});

const commandFrame = <C extends BridgeCommand>(command: C): BridgeCommandFrame => ({
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  kind: 'command',
  correlationId: 'same',
  mapId: 'demo-map',
  deadlineAt: 1_800_000_000_000,
  command,
});

test('canonical JSON sorts object keys recursively but preserves arrays', async () => {
  assert.equal(BRIDGE_PROTOCOL_VERSION, 2);
  const left = { z: [{ b: 2, a: 1 }], a: true };
  const right = { a: true, z: [{ a: 1, b: 2 }] };
  assert.equal(canonicalizeJson(left), '{"a":true,"z":[{"a":1,"b":2}]}');
  assert.equal(await sha256CanonicalJson(left), await sha256CanonicalJson(right));
});

test('canonical JSON rejects cycles and non-JSON numeric values', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeJson(cyclic), /JSON|strict/);
  assert.throws(() => canonicalizeJson({ n: Number.NaN }), /JSON|strict/);
});

test('codec rejects oversized and copied version-1 command frames', () => {
  const auth = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'auth' as const,
    correlationId: 'auth-1',
    token: 'x'.repeat(43),
  };
  const encoded = encodeBridgeFrame(auth);
  assert.deepEqual(decodeBridgeFrame(encoded, BridgeAuthFrameSchema), auth);
  assert.throws(() => decodeBridgeFrame(encoded, BridgeAuthFrameSchema, 8), /size limit/);
  assert.throws(
    () => decodeBridgeFrame(
      JSON.stringify({ ...auth, protocolVersion: 1 }),
      BridgeAuthFrameSchema,
    ),
    /protocolVersion|Invalid input/,
  );
});

test('codec measures UTF-8 bytes and accepts ArrayBuffer views without widening schemas', () => {
  const auth = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'auth' as const,
    correlationId: '界',
    token: 'x'.repeat(43),
  };
  const encoded = encodeBridgeFrame(auth);
  const bytes = new TextEncoder().encode(encoded);
  assert.throws(() => encodeBridgeFrame(auth, bytes.byteLength - 1), /size limit/);
  const padded = new Uint8Array(bytes.byteLength + 2);
  padded.set(bytes, 1);
  assert.deepEqual(
    decodeBridgeFrame(padded.subarray(1, -1), BridgeAuthFrameSchema),
    auth,
  );
  const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
  assert.throws(() => decodeBridgeFrame(invalidUtf8, BridgeAuthFrameSchema));
});

test('correlation rejects another request and the wrong success discriminant', () => {
  const request = commandFrame({
    type: 'applyTransaction',
    expectedRevision: 0,
    expectedStyleHash: hash0,
    transaction: {
      operations: [{ op: 'setLayerFilter', layerId: 'roads', mode: 'clear' }],
      validate: true,
    },
  });
  const wrongId = BridgeResultFrameSchema.parse({
    ...resultFrame(transactionReceipt()),
    correlationId: 'other',
  });
  assert.throws(() => assertCorrelated(request, wrongId), /correlation/);
  const forged = BridgeResultFrameSchema.parse({
    ...resultFrame({ type: 'ack', accepted: true }),
    correlationId: 'same',
  });
  assert.throws(() => assertCorrelated(request, forged), /expected transaction/);
});

test('strict protocol round-trips explicit transaction degradation markers', () => {
  const degraded = resultFrame({
    type: 'transaction',
    detail: 'full',
    revision: 1,
    styleHash: hash1,
    applied: true,
    noOp: false,
    changedLayerIds: ['roads'],
    changedSourceIds: [],
    warnings: [],
    omitted: { style: true, diff: true },
  });
  assert.deepEqual(BridgeResultFrameSchema.parse(degraded), degraded);
  assert.equal(BridgeResultFrameSchema.safeParse({
    ...degraded,
    result: { ...degraded.result, omitted: { style: false } },
  }).success, false);
  assert.equal(BridgeResultFrameSchema.safeParse({
    ...degraded,
    result: { ...degraded.result, style: style0, omitted: { style: true } },
  }).success, false);
});

test('transaction success has exactly one semantic applied/no-op branch', () => {
  assert.equal(BridgeResultFrameSchema.safeParse(resultFrame(transactionReceipt())).success, true);
  assert.equal(BridgeResultFrameSchema.safeParse(resultFrame(transactionReceipt({
    revision: 0,
    styleHash: hash0,
    applied: false,
    noOp: true,
  }))).success, true);
  for (const flags of [
    { applied: true, noOp: true },
    { applied: false, noOp: false },
  ]) {
    assert.equal(BridgeResultFrameSchema.safeParse(resultFrame(transactionReceipt(flags))).success, false);
  }
});

test('wire transaction structure admits a negotiated 101st operation', () => {
  const operations = Array.from({ length: 101 }, (_, index) => ({
    op: 'setLayerFilter' as const,
    layerId: `layer-${index}`,
    mode: 'clear' as const,
  }));
  assert.equal(BridgeCommandSchema.safeParse({
    type: 'applyTransaction',
    expectedRevision: 0,
    expectedStyleHash: hash0,
    transaction: { operations },
  }).success, true);
});

test('map IDs reject literal or encoded dot-segment spellings without rejecting ordinary dots', () => {
  for (const invalid of ['.', '..', '%2e', '%2E', '%2e%2e', '%252e']) {
    assert.equal(BridgeMapIdSchema.safeParse(invalid).success, false);
  }
  assert.equal(BridgeMapIdSchema.safeParse('a.b').success, true);
  assert.equal(BridgeRegisterFrameSchema.safeParse({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'register',
    correlationId: 'register-1',
    registrationAttemptId: 'A'.repeat(43),
    mapId: '..',
    capabilities: ['style.read'],
    limits,
    snapshot: { revision: 0, styleHash: hash0, style: style0 },
  }).success, false);
});

test('registration attempt IDs are exact 32-byte base64url tokens', () => {
  const valid = 'A'.repeat(43);
  assert.equal(RegistrationAttemptIdSchema.parse(valid), valid);
  const register = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'register',
    correlationId: 'register-1',
    registrationAttemptId: valid,
    mapId: 'demo-map',
    capabilities: ['style.read'],
    limits,
    snapshot: { revision: 0, styleHash: hash0, style: style0 },
  };
  assert.equal(BridgeRegisterFrameSchema.safeParse(register).success, true);
  for (const invalid of [
    '', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`, `${'A'.repeat(42)}+`,
  ]) {
    assert.equal(RegistrationAttemptIdSchema.safeParse(invalid).success, false);
    assert.equal(BridgeRegisterFrameSchema.safeParse({
      ...register,
      registrationAttemptId: invalid,
    }).success, false);
  }
});

test('all sixteen command variants are strict and map to one fixed result discriminant', () => {
  assert.deepEqual(Object.keys(BridgeCommandVariantSchemas).sort(), [
    'addImage',
    'addSprite',
    'applyStyleDocument',
    'applyTransaction',
    'getStyle',
    'listImages',
    'listSprites',
    'queryRenderedFeatures',
    'querySourceFeatures',
    'removeFeatureState',
    'removeImage',
    'removeSprite',
    'setFeatureState',
    'setGlobalState',
    'setSourceTileLodParams',
    'updateGeoJsonData',
  ]);
  assert.deepEqual(BRIDGE_COMMAND_RESULT_TYPES, {
    getStyle: 'style',
    applyTransaction: 'transaction',
    applyStyleDocument: 'transaction',
    querySourceFeatures: 'features',
    queryRenderedFeatures: 'features',
    setFeatureState: 'state',
    removeFeatureState: 'state',
    setGlobalState: 'state',
    listImages: 'images',
    listSprites: 'sprites',
    addImage: 'ack',
    removeImage: 'ack',
    updateGeoJsonData: 'ack',
    setSourceTileLodParams: 'ack',
    addSprite: 'ack',
    removeSprite: 'ack',
  });
  assert.equal(BridgeCommandVariantSchemas.getStyle.safeParse({ type: 'getStyle' }).success, true);
  assert.equal(BridgeCommandVariantSchemas.getStyle.safeParse({
    type: 'getStyle', extra: true,
  }).success, false);
});

test('command frames require a shared map ID and a safe absolute deadline', () => {
  assert.equal(BridgeCommandFrameSchema.safeParse(commandFrame({ type: 'getStyle' })).success, true);
  for (const deadlineAt of [-1, 1.5, Number.MAX_VALUE]) {
    assert.equal(BridgeCommandFrameSchema.safeParse({
      ...commandFrame({ type: 'getStyle' }), deadlineAt,
    }).success, false);
  }
});

test('fixed query/image result schemas reject impossible collection metadata', () => {
  const feature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: {},
  };
  assert.equal(BridgeResultFrameSchema.safeParse(resultFrame({
    type: 'features',
    features: Array.from({ length: 101 }, () => feature),
    returned: 101,
    truncated: false,
    serializedBytes: 1,
    warnings: [],
  })).success, false);
  assert.equal(BridgeResultFrameSchema.safeParse(resultFrame({
    type: 'features', features: [feature], returned: 0,
    truncated: false, serializedBytes: 1, warnings: [],
  })).success, false);
  assert.equal(BridgeResultFrameSchema.safeParse(resultFrame({
    type: 'images',
    imageIds: Array.from({ length: 501 }, (_, index) => `image-${index}`),
    returned: 501,
    truncated: true,
    serializedBytes: 1,
  })).success, false);
  assert.equal(BridgeResultFrameSchema.safeParse(resultFrame({
    type: 'images', imageIds: ['marker'], returned: 0,
    truncated: false, serializedBytes: 10,
  })).success, false);
});

test('every success, failure, and event variant round-trips through the strict frame union', () => {
  const successes = [
    { type: 'authenticated', connectionId: 'connection-1', limits },
    { type: 'registered', leaseId: 'L'.repeat(43), limits },
    { type: 'style', revision: 0, styleHash: hash0, style: style0 },
    transactionReceipt(),
    {
      type: 'features', features: [], returned: 0,
      truncated: false, serializedBytes: 2, warnings: [],
    },
    { type: 'state', accepted: true },
    { type: 'images', imageIds: [], returned: 0, truncated: false, serializedBytes: 2 },
    { type: 'sprites', items: [], returned: 0, truncated: false, serializedBytes: 2 },
    { type: 'ack', accepted: true },
  ];
  for (const result of successes) {
    assert.equal(BridgeResultFrameSchema.safeParse(resultFrame(result)).success, true);
  }
  for (const code of ['INTERNAL', 'IO_ERROR', 'REVISION_CONFLICT', 'TIMEOUT'] as const) {
    const failure = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      kind: 'result',
      correlationId: 'failure-1',
      ok: false,
      error: {
        code,
        message: 'fixed bridge failure',
        details: { currentSnapshot: { revision: 1, styleHash: hash1, style: style0 } },
      },
    };
    assert.equal(BridgeResultFrameSchema.safeParse(failure).success, true);
    assert.equal(BridgeResultFrameSchema.safeParse({
      ...failure,
      error: {
        ...failure.error,
        details: { currentSnapshot: { revision: 1, styleHash: hash1 } },
      },
    }).success, true);
  }
  for (const event of [
    {
      protocolVersion: BRIDGE_PROTOCOL_VERSION, kind: 'event', event: 'mapSnapshot', mapId: 'demo-map',
      snapshot: { revision: 0, styleHash: hash0, style: style0 },
    },
    {
      protocolVersion: BRIDGE_PROTOCOL_VERSION, kind: 'event', event: 'externalStyleChange', mapId: 'demo-map',
      snapshot: { revision: 1, styleHash: hash1 },
    },
    {
      protocolVersion: BRIDGE_PROTOCOL_VERSION, kind: 'event', event: 'mapStatus', mapId: 'demo-map',
      syncState: 'unknown',
    },
  ]) {
    assert.deepEqual(BridgeEventFrameSchema.parse(event), event);
  }
});

test('mapStatus can only announce unknown; recovery requires a snapshot', () => {
  const event = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'event',
    event: 'mapStatus',
    mapId: 'demo-map',
    syncState: 'unknown',
  };
  assert.equal(BridgeEventFrameSchema.safeParse(event).success, true);
  assert.equal(BridgeEventFrameSchema.safeParse({ ...event, syncState: 'known' }).success, false);
  assert.equal(BridgeEventFrameSchema.safeParse({ ...event, details: {} }).success, false);
});

// Compile-only command/result lookup contract.
function assertResultLookupTypes(
  styleResult: BridgeResultFor<Extract<BridgeCommand, { type: 'getStyle' }>>,
  applyResult: BridgeResultFor<Extract<BridgeCommand, { type: 'applyTransaction' }>>,
  applyDocumentResult: BridgeResultFor<Extract<BridgeCommand, { type: 'applyStyleDocument' }>>,
  spritesResult: BridgeResultFor<Extract<BridgeCommand, { type: 'listSprites' }>>,
  spriteMutationResult: BridgeResultFor<Extract<BridgeCommand, { type: 'addSprite' }>>,
): BridgeResultFrame | undefined {
  void styleResult.style;
  // @ts-expect-error style results do not expose transaction detail
  void styleResult.detail;
  void applyResult.detail;
  // @ts-expect-error transaction results do not expose an unconditional Style
  void applyResult.style;
  void applyDocumentResult.detail;
  void spritesResult.items;
  // @ts-expect-error sprite mutations only expose acknowledgements
  void spriteMutationResult.items;
  return undefined;
}
void assertResultLookupTypes;
