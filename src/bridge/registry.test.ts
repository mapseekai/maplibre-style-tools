import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStyleToolError,
  isStyleToolError,
  jsonUtf8ByteLength,
  type JsonObject,
  type StyleDocument,
  type StyleToolError,
} from '../core/index.js';
import { hashStyle } from '../adapters/maplibre/style-hash.js';
import { publicBridgeErrorMessage } from './outbound.js';
import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeCapability,
  type BridgeCommand,
  type BridgeCommandFrame,
  type BridgeEventFrame,
  type BridgeLimitSet,
  type BridgeRegisterFrame,
  type BridgeResultFrame,
  type MapSnapshot,
} from './protocol.js';
import {
  createRegistrationLiveness,
  LiveMapRegistry,
  type BridgePeer,
} from './registry.js';

const limits: BridgeLimitSet = {
  maxMessageBytes: 5 * 1024 * 1024,
  maxStyleBytes: 5 * 1024 * 1024,
  maxDiffBytes: 1024 * 1024,
  maxOperations: 100,
};
const style0 = { version: 8 as const, sources: {}, layers: [] } as StyleDocument;
const style1 = {
  version: 8 as const,
  sources: {},
  layers: [],
  metadata: { revision: 1 },
} as StyleDocument;
const hash0 = await hashStyle(style0);
const hash1 = await hashStyle(style1);

class FakePeer implements BridgePeer {
  readonly sent: BridgeCommandFrame[] = [];
  closeCode?: number;
  closeReason?: string;
  closeCalls = 0;
  sendError?: Error;

  constructor(readonly id: string) {}

  send(frame: BridgeCommandFrame): Promise<void> {
    this.sent.push(frame);
    return this.sendError === undefined ? Promise.resolve() : Promise.reject(this.sendError);
  }

  close(code: number, reason: string): void {
    this.closeCalls += 1;
    this.closeCode = code;
    this.closeReason = reason;
  }
}

const live = () => {
  const controller = new AbortController();
  let current = true;
  return {
    token: createRegistrationLiveness(controller.signal, () => current),
    terminate() {
      current = false;
      controller.abort();
    },
  };
};

let attemptCounter = 0;
const attemptId = (): string => {
  attemptCounter += 1;
  const prefix = attemptCounter.toString(36);
  return `${prefix}${'A'.repeat(43 - prefix.length)}`;
};

const registration = (
  mapId: string,
  snapshot: MapSnapshot = { revision: 0, styleHash: hash0, style: style0 },
  capabilities: readonly BridgeCapability[] = ['style.read', 'style.write'],
  replaceLeaseId?: string,
  overrides: Partial<BridgeRegisterFrame> = {},
): BridgeRegisterFrame => ({
  protocolVersion: 1,
  kind: 'register',
  correlationId: `register-${mapId}`,
  registrationAttemptId: attemptId(),
  mapId,
  ...(replaceLeaseId === undefined ? {} : { replaceLeaseId }),
  capabilities: [...capabilities],
  limits,
  snapshot,
  ...overrides,
});

const register = (
  registry: LiveMapRegistry,
  peer: FakePeer,
  frame: BridgeRegisterFrame,
) => registry.register(peer, frame, live().token);

const getStyle: BridgeCommand = { type: 'getStyle' };
const listImages: BridgeCommand = { type: 'listImages' };
const apply = (revision = 0, styleHash = hash0): BridgeCommand => ({
  type: 'applyTransaction',
  expectedRevision: revision,
  expectedStyleHash: styleHash,
  transaction: {
    operations: [{ op: 'setLayerFilter', layerId: 'roads', mode: 'clear' }],
    validate: true,
  },
});

const success = (
  request: BridgeCommandFrame,
  result: Record<string, unknown>,
): BridgeResultFrame => ({
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  kind: 'result',
  correlationId: request.correlationId,
  ok: true,
  result,
}) as BridgeResultFrame;

const failure = (
  request: BridgeCommandFrame,
  code: StyleToolError['code'],
  details?: JsonObject,
): BridgeResultFrame => ({
  protocolVersion: 1,
  kind: 'result',
  correlationId: request.correlationId,
  ok: false,
  error: {
    code,
    message: publicBridgeErrorMessage(code),
    ...(details === undefined ? {} : { details }),
  },
});

const event = (
  eventType: 'mapSnapshot' | 'externalStyleChange',
  snapshot: MapSnapshot,
): BridgeEventFrame => ({
  protocolVersion: 1,
  kind: 'event',
  event: eventType,
  mapId: 'demo-map',
  snapshot,
});

const hasCode = (code: StyleToolError['code']) => (error: unknown): boolean =>
  isStyleToolError(error) && error.code === code;

const setup = async (
  capabilities: readonly BridgeCapability[] = ['style.read', 'style.write'],
  snapshot: MapSnapshot = { revision: 0, styleHash: hash0, style: style0 },
  options: ConstructorParameters<typeof LiveMapRegistry>[0] = {},
) => {
  const registry = new LiveMapRegistry(options);
  const peer = new FakePeer('peer-1');
  const projectedSnapshot = capabilities.includes('style.read')
    ? snapshot
    : { revision: snapshot.revision, styleHash: snapshot.styleHash };
  await register(registry, peer, registration(
    'demo-map',
    projectedSnapshot,
    capabilities,
    undefined,
    options.limitCeilings === undefined ? {} : { limits: options.limitCeilings },
  ));
  return { registry, peer };
};

test('rejects duplicates, validates snapshots and limits, and atomically replaces by lease', async () => {
  const registry = new LiveMapRegistry();
  const firstPeer = new FakePeer('first');
  const first = await register(registry, firstPeer, registration('demo-map'));
  assert.match(first.leaseId, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal('leaseId' in registry.list()[0]!, false);
  assert.equal('peerId' in registry.list()[0]!, false);

  await assert.rejects(register(registry, new FakePeer('duplicate'), registration('demo-map')), hasCode('CONFLICT'));
  await assert.rejects(register(
    registry,
    new FakePeer('forged'),
    registration('other', { revision: 0, styleHash: hash1, style: style0 }),
  ), hasCode('INVALID_INPUT'));
  await assert.rejects(register(
    registry,
    new FakePeer('limit'),
    registration('limit', undefined, undefined, undefined, {
      limits: { ...limits, maxOperations: limits.maxOperations + 1 },
    }),
  ), hasCode('INVALID_INPUT'));

  const replacementPeer = new FakePeer('replacement');
  const replacement = await register(
    registry,
    replacementPeer,
    registration('demo-map', { revision: 1, styleHash: hash1, style: style1 }, undefined, first.leaseId),
  );
  assert.notEqual(replacement.leaseId, first.leaseId);
  assert.equal(firstPeer.closeCode, 4001);
  assert.equal(registry.get('demo-map')?.peerId, replacementPeer.id);
  assert.equal(registry.get('demo-map')?.metadata.revision, 1);
});

test('liveness prevents a deferred registration from installing a ghost', async () => {
  let resolveHash: ((value: string) => void) | undefined;
  const registry = new LiveMapRegistry({
    hashStyle: () => new Promise<string>((resolve) => { resolveHash = resolve; }),
  });
  const candidate = new FakePeer('candidate');
  const liveness = live();
  const pending = registry.register(candidate, registration('demo-map'), liveness.token);
  await new Promise<void>((resolve) => setImmediate(resolve));
  liveness.terminate();
  resolveHash?.(hash0);
  await assert.rejects(pending, hasCode('BRIDGE_DISCONNECTED'));
  assert.equal(registry.get('demo-map'), undefined);
});

test('same registration attempt replays one lease into an unknown generation until confirmation', async () => {
  const registry = new LiveMapRegistry();
  const oldPeer = new FakePeer('old');
  const old = await register(registry, oldPeer, registration('demo-map'));
  const frame = registration(
    'demo-map',
    { revision: 1, styleHash: hash1, style: style1 },
    undefined,
    old.leaseId,
  );
  const firstGeneration = new FakePeer('first-generation');
  const committed = await register(registry, firstGeneration, frame);
  await registry.acceptEvent(firstGeneration.id, event('externalStyleChange', {
    revision: 2, styleHash: hash1, style: style1,
  }));
  const active = registry.execute('demo-map', getStyle);
  const replay = new FakePeer('replay');
  const replayed = await register(registry, replay, frame);
  assert.equal(replayed.leaseId, committed.leaseId);
  await assert.rejects(active, hasCode('BRIDGE_DISCONNECTED'));
  assert.equal(firstGeneration.closeCalls, 1);
  assert.equal(registry.get('demo-map')?.metadata.syncState, 'unknown');
  assert.equal(registry.get('demo-map')?.metadata.revision, 2);
  await assert.rejects(registry.execute('demo-map', getStyle), hasCode('MAP_NOT_READY'));
  await registry.acceptEvent(replay.id, event('mapSnapshot', {
    revision: 2, styleHash: hash1, style: style1,
  }));
  assert.equal(registry.get('demo-map')?.metadata.syncState, 'known');
});

test('serializes commands, updates mirror on success, and authenticates wire failures', async () => {
  const { registry, peer } = await setup();
  const first = registry.execute('demo-map', getStyle);
  const second = registry.execute('demo-map', listImages);
  assert.equal(peer.sent.length, 1);
  await registry.acceptResult(peer.id, success(peer.sent[0]!, {
    type: 'style', revision: 1, styleHash: hash1, style: style1,
  }));
  assert.deepEqual(await first, {
    type: 'style', revision: 1, styleHash: hash1, style: style1,
  });
  assert.equal(peer.sent.length, 2);
  await registry.acceptResult(peer.id, failure(peer.sent[1]!, 'MAP_NOT_READY', {
    syncState: 'unknown',
  }));
  await assert.rejects(second, (error: unknown) =>
    hasCode('MAP_NOT_READY')(error) && isStyleToolError(error));
  assert.equal(registry.get('demo-map')?.metadata.styleHash, hash1);
});

test('enforces capability, operation, frame, and write preconditions before sending', async () => {
  const writeOnly = await setup(['style.write']);
  await assert.rejects(writeOnly.registry.execute('demo-map', getStyle), hasCode('CAPABILITY_DENIED'));
  await assert.rejects(writeOnly.registry.execute('demo-map', {
    type: 'querySourceFeatures', sourceId: 'roads',
  }), hasCode('CAPABILITY_DENIED'));
  await assert.rejects(writeOnly.registry.execute('demo-map', apply(1, hash1)), hasCode('REVISION_CONFLICT'));
  assert.equal(writeOnly.peer.sent.length, 0);

  const bounded = await setup(['style.write'], { revision: 0, styleHash: hash0 }, {
    limitCeilings: { ...limits, maxOperations: 2 },
  });
  await assert.rejects(bounded.registry.execute('demo-map', {
    ...apply(),
    transaction: {
      operations: [
        { op: 'setLayerFilter', layerId: 'a', mode: 'clear' },
        { op: 'setLayerFilter', layerId: 'b', mode: 'clear' },
        { op: 'setLayerFilter', layerId: 'c', mode: 'clear' },
      ],
      validate: true,
    },
  }), hasCode('INVALID_INPUT'));
  assert.equal(bounded.peer.sent.length, 0);
});

test('recomputes feature and image byte claims and policy-closes malicious peers', async () => {
  const queryFixture = await setup(['features.query']);
  const query: BridgeCommand = {
    type: 'querySourceFeatures', sourceId: 'roads', limit: 1, properties: ['name'],
  };
  const pendingQuery = queryFixture.registry.execute('demo-map', query);
  const features = [{
    type: 'Feature', geometry: null, properties: { name: 'road', secret: true },
  }];
  await assert.rejects(queryFixture.registry.acceptResult(
    queryFixture.peer.id,
    success(queryFixture.peer.sent[0]!, {
      type: 'features', features, returned: 1,
      serializedBytes: jsonUtf8ByteLength(features), truncated: false, warnings: [],
    }),
  ), /protocol|properties/i);
  assert.equal(queryFixture.peer.closeCode, 1008);
  queryFixture.registry.disconnect(queryFixture.peer.id);
  await assert.rejects(pendingQuery, hasCode('BRIDGE_DISCONNECTED'));

  const imageFixture = await setup(['style.read']);
  const pendingImages = imageFixture.registry.execute('demo-map', listImages);
  await assert.rejects(imageFixture.registry.acceptResult(
    imageFixture.peer.id,
    success(imageFixture.peer.sent[0]!, {
      type: 'images', imageIds: ['marker'], serializedBytes: 1,
    }),
  ), /protocol|bytes/i);
  assert.equal(imageFixture.peer.closeCode, 1008);
  imageFixture.registry.disconnect(imageFixture.peer.id);
  await assert.rejects(pendingImages, hasCode('BRIDGE_DISCONNECTED'));
});

test('validates transaction revision semantics and merges authoritative failure before pumping', async () => {
  const { registry, peer } = await setup();
  const first = registry.execute('demo-map', apply());
  const second = registry.execute('demo-map', apply(1, hash1));
  await registry.acceptResult(peer.id, failure(peer.sent[0]!, 'INTERNAL', {
    currentSnapshot: { revision: 1, styleHash: hash1, style: style1 },
    rolledBack: false,
  }));
  await assert.rejects(first, hasCode('INTERNAL'));
  assert.equal(registry.get('demo-map')?.metadata.revision, 1);
  assert.equal(peer.sent.length, 2);
  registry.disconnect(peer.id);
  await assert.rejects(second, hasCode('BRIDGE_DISCONNECTED'));

  const forged = await setup(['style.write'], { revision: 0, styleHash: hash0 });
  const pending = forged.registry.execute('demo-map', apply());
  await assert.rejects(forged.registry.acceptResult(forged.peer.id, success(forged.peer.sent[0]!, {
    type: 'transaction', detail: 'receipt', revision: 2, styleHash: hash1,
    applied: true, noOp: false,
  })), /revision|protocol/i);
  assert.equal(forged.peer.closeCode, 1008);
  forged.registry.disconnect(forged.peer.id);
  await assert.rejects(pending, hasCode('BRIDGE_DISCONNECTED'));
});

test('events merge monotonically and mapStatus blocks new work until a current snapshot', async () => {
  const { registry, peer } = await setup();
  await registry.acceptEvent(peer.id, event('externalStyleChange', {
    revision: 2, styleHash: hash1, style: style1,
  }));
  await registry.acceptEvent(peer.id, event('externalStyleChange', {
    revision: 1, styleHash: hash0, style: style0,
  }));
  assert.equal(registry.get('demo-map')?.metadata.revision, 2);
  await assert.rejects(registry.acceptEvent(peer.id, event('externalStyleChange', {
    revision: 2, styleHash: hash0, style: style0,
  })), /revision|hash|protocol/i);
  assert.equal(peer.closeCode, 1008);

  const unknown = await setup();
  await unknown.registry.acceptEvent(unknown.peer.id, {
    protocolVersion: 1, kind: 'event', event: 'mapStatus',
    mapId: 'demo-map', syncState: 'unknown',
  });
  assert.equal(unknown.registry.get('demo-map')?.metadata.syncState, 'unknown');
  await assert.rejects(unknown.registry.execute('demo-map', getStyle), hasCode('MAP_NOT_READY'));
  await unknown.registry.acceptEvent(unknown.peer.id, event('mapSnapshot', {
    revision: 1, styleHash: hash1, style: style1,
  }));
  assert.equal(unknown.registry.get('demo-map')?.metadata.syncState, 'known');
});

test('a finalizer failure neither caches the result nor disconnects the peer', async () => {
  const { registry, peer } = await setup(['style.read'], {
    revision: 0, styleHash: hash0,
  });
  const sentinel = createStyleToolError('INVALID_INPUT', 'responseTooLarge');
  const pending = registry.execute('demo-map', getStyle, undefined, () => { throw sentinel; });
  await registry.acceptResult(peer.id, success(peer.sent[0]!, {
    type: 'style', revision: 0, styleHash: hash0, style: style0,
  }));
  await assert.rejects(pending, (error) => error === sentinel);
  assert.equal(peer.closeCode, undefined);
  assert.throws(() => registry.projectCachedStyle('demo-map', (value) => value), hasCode('MAP_NOT_READY'));
});

test('disconnect and send rejection settle active and queued work exactly once', async () => {
  const fixture = await setup();
  const active = fixture.registry.execute('demo-map', getStyle);
  const queued = fixture.registry.execute('demo-map', listImages);
  fixture.registry.disconnect(fixture.peer.id);
  await assert.rejects(active, hasCode('BRIDGE_DISCONNECTED'));
  await assert.rejects(queued, hasCode('BRIDGE_DISCONNECTED'));

  const sendFixture = await setup();
  sendFixture.peer.sendError = new Error('private transport failure');
  const failed = sendFixture.registry.execute('demo-map', getStyle);
  await assert.rejects(failed, hasCode('BRIDGE_DISCONNECTED'));
  assert.equal(sendFixture.registry.get('demo-map'), undefined);
});

test('caller timeout keeps correlation ownership until transport grace', async () => {
  const fixture = await setup(undefined, undefined, {
    operationTimeoutMs: 15,
    transportGraceMs: 10,
  });
  const active = fixture.registry.execute('demo-map', getStyle);
  const queued = fixture.registry.execute('demo-map', listImages);
  await assert.rejects(active, hasCode('TIMEOUT'));
  await assert.rejects(queued, hasCode('TIMEOUT'));
  assert.equal(fixture.peer.sent.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fixture.peer.closeCode, 4002);
  assert.equal(fixture.registry.get('demo-map')?.metadata.syncState, 'unknown');
});

test('a late authoritative timeout repairs the mirror and cancels transport grace', async () => {
  const fixture = await setup(undefined, undefined, {
    operationTimeoutMs: 15,
    transportGraceMs: 50,
  });
  const pending = fixture.registry.execute('demo-map', apply());
  await assert.rejects(pending, hasCode('TIMEOUT'));
  await fixture.registry.acceptResult(
    fixture.peer.id,
    failure(fixture.peer.sent[0]!, 'TIMEOUT', {
      currentSnapshot: { revision: 1, styleHash: hash1, style: style1 },
    }),
  );
  assert.equal(fixture.registry.get('demo-map')?.metadata.revision, 1);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(fixture.peer.closeCode, undefined);
});

test('stale and pre-status results settle once without rolling back or restoring the mirror', async () => {
  const stale = await setup();
  const stalePending = stale.registry.execute('demo-map', getStyle);
  await stale.registry.acceptEvent(stale.peer.id, event('externalStyleChange', {
    revision: 2, styleHash: hash1, style: style1,
  }));
  await stale.registry.acceptResult(stale.peer.id, success(stale.peer.sent[0]!, {
    type: 'style', revision: 1, styleHash: hash1, style: style1,
  }));
  await stalePending;
  assert.equal(stale.registry.get('demo-map')?.metadata.revision, 2);

  const unknown = await setup();
  const oldEpochPending = unknown.registry.execute('demo-map', getStyle);
  await unknown.registry.acceptEvent(unknown.peer.id, {
    protocolVersion: 1, kind: 'event', event: 'mapStatus',
    mapId: 'demo-map', syncState: 'unknown',
  });
  await unknown.registry.acceptResult(unknown.peer.id, success(unknown.peer.sent[0]!, {
    type: 'style', revision: 0, styleHash: hash0, style: style0,
  }));
  await oldEpochPending;
  assert.equal(unknown.registry.get('demo-map')?.metadata.syncState, 'unknown');
  assert.equal(unknown.registry.get('demo-map')?.snapshot.style, undefined);
});

test('a metadata receipt clears a Style tagged to the previous hash', async () => {
  const fixture = await setup();
  assert.equal(fixture.registry.get('demo-map')?.snapshot.style?.version, 8);
  const pending = fixture.registry.execute('demo-map', apply());
  await fixture.registry.acceptResult(fixture.peer.id, success(fixture.peer.sent[0]!, {
    type: 'transaction', detail: 'receipt', revision: 1, styleHash: hash1,
    applied: true, noOp: false,
  }));
  await pending;
  assert.equal(fixture.registry.get('demo-map')?.snapshot.style, undefined);
});

test('wrong result discriminants and write-only full results close without settling from the frame', async () => {
  const wrong = await setup();
  const wrongPending = wrong.registry.execute('demo-map', apply());
  await assert.rejects(wrong.registry.acceptResult(
    wrong.peer.id,
    success(wrong.peer.sent[0]!, { type: 'ack', accepted: true }),
  ), /protocol/iu);
  assert.equal(wrong.peer.closeCode, 1008);
  wrong.registry.disconnect(wrong.peer.id);
  await assert.rejects(wrongPending, hasCode('BRIDGE_DISCONNECTED'));

  const writeOnly = await setup(['style.write'], { revision: 0, styleHash: hash0 });
  const writePending = writeOnly.registry.execute('demo-map', apply());
  await assert.rejects(writeOnly.registry.acceptResult(
    writeOnly.peer.id,
    success(writeOnly.peer.sent[0]!, {
      type: 'transaction', detail: 'full', revision: 1, styleHash: hash1,
      applied: true, noOp: false, changedLayerIds: [], changedSourceIds: [],
      warnings: [], style: style1,
    }),
  ), /protocol/iu);
  assert.equal(writeOnly.peer.closeCode, 1008);
  writeOnly.registry.disconnect(writeOnly.peer.id);
  await assert.rejects(writePending, hasCode('BRIDGE_DISCONNECTED'));
});

test('retained registration attempts have a bounded fixed expiry window', async () => {
  let now = 0;
  const registry = new LiveMapRegistry({
    now: () => now,
    maxRetainedRegistrationAttempts: 1,
    registrationAttemptRetentionMs: 60,
  });
  await register(registry, new FakePeer('a'), registration('map-a'));
  await assert.rejects(
    register(registry, new FakePeer('b'), registration('map-b')),
    hasCode('CONFLICT'),
  );
  now = 60;
  registry.sweepExpiredRegistrationAttempts();
  await register(registry, new FakePeer('b-after-expiry'), registration('map-b'));
  assert.equal(registry.get('map-b')?.metadata.mapId, 'map-b');
});
