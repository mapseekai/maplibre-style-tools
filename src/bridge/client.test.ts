import assert from 'node:assert/strict';
import test from 'node:test';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';

import { hashStyle } from '../adapters/maplibre/index.js';
import { validateStyleDocument, type StyleDocument } from '../core/index.js';
import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeAuthFrame,
  type BridgeCommandFrame,
  type BridgeFrame,
  type BridgeRegisterFrame,
  type BridgeResultFrame,
} from './protocol.js';
import {
  connectMapLibreBridge,
  type ConnectMapLibreBridgeOptions,
  type WebSocketLike,
} from './client.js';

type SocketEvent = 'open' | 'message' | 'close' | 'error';
type SocketListener = (event: unknown) => void;

class FakeSocket implements WebSocketLike {
  readonly url: string;
  readyState = 0;
  binaryType: BinaryType = 'blob';
  readonly sent: string[] = [];
  closeCode: number | undefined;
  private readonly listeners = new Map<SocketEvent, Set<SocketListener>>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: SocketEvent, listener: SocketListener): void {
    let listeners = this.listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: SocketEvent, listener: SocketListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('socket is not open');
    this.sent.push(data);
  }

  close(code = 1000): void {
    if (this.readyState >= 2) return;
    this.closeCode = code;
    this.readyState = 3;
    this.emit('close', { code });
  }

  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }

  receive(frame: BridgeFrame): void {
    this.emit('message', { data: JSON.stringify(frame) });
  }

  receiveNative(frame: BridgeFrame): void {
    this.emit('message', new MessageEvent('message', { data: JSON.stringify(frame) }));
  }

  closeFromServer(code: number): void {
    this.readyState = 3;
    this.emit('close', { code });
  }

  private emit(type: SocketEvent, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

class FakeSockets {
  readonly sockets: FakeSocket[] = [];
  readonly create = (url: string): WebSocketLike => {
    const socket = new FakeSocket(url);
    this.sockets.push(socket);
    return socket;
  };

  latest(): FakeSocket {
    const socket = this.sockets.at(-1);
    if (socket === undefined) assert.fail('expected a socket');
    return socket;
  }
}

type MapEvent = 'style.load' | 'styledata' | 'error';
type MapListener = (event: { type: MapEvent }) => void;

class FakeMap {
  style: StyleSpecification;
  loaded = true;
  setStyleCalls = 0;
  readonly listeners = new Map<MapEvent, Set<MapListener>>();

  constructor(style: StyleSpecification) {
    this.style = structuredClone(style);
  }

  on(type: MapEvent, listener: MapListener): { unsubscribe(): void } {
    let listeners = this.listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
    return { unsubscribe: () => listeners!.delete(listener) };
  }

  off(type: MapEvent, listener: MapListener): this {
    this.listeners.get(type)?.delete(listener);
    return this;
  }

  emit(type: MapEvent): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type });
  }

  getStyle(): StyleSpecification { return this.style; }
  isStyleLoaded(): boolean { return this.loaded; }

  setStyle(style: StyleSpecification | string): this {
    assert.notEqual(typeof style, 'string');
    this.setStyleCalls += 1;
    this.style = structuredClone(style as StyleSpecification);
    this.loaded = true;
    queueMicrotask(() => this.emit('style.load'));
    return this;
  }

  querySourceFeatures(): unknown[] { return []; }
  queryRenderedFeatures(): unknown[] { return []; }
  listImages(): string[] { return []; }
  setFeatureState(): void {}
  removeFeatureState(): void {}
  setGlobalStateProperty(): void {}
  hasImage(): boolean { return false; }
  addImage(): void {}
  updateImage(): void {}
  removeImage(): void {}

  external(style: StyleSpecification): void {
    this.style = structuredClone(style);
    this.emit('style.load');
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }

  asMap(): MapLibreMap { return this as unknown as MapLibreMap; }
}

const rawStyle = (color = '#000000'): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': color } }],
});

const strictStyle = (color = '#000000'): StyleDocument => {
  const validated = validateStyleDocument(rawStyle(color));
  assert.equal(validated.ok, true);
  if (!validated.ok) assert.fail('fixture invalid');
  return validated.style;
};

const token = 't'.repeat(32);
const defaultLimits = {
  maxMessageBytes: 5 * 1024 * 1024,
  maxStyleBytes: 5 * 1024 * 1024,
  maxDiffBytes: 1024 * 1024,
  maxOperations: 100,
};

const options = (
  sockets: FakeSockets,
  overrides: Partial<ConnectMapLibreBridgeOptions> = {},
): ConnectMapLibreBridgeOptions => ({
  mapId: 'demo-map',
  url: 'ws://127.0.0.1:7777',
  token,
  capabilities: ['style.read', 'style.write'],
  resourceBaseUrl: 'https://app.example/maps/',
  allowedResourceOrigins: ['https://app.example'],
  websocketFactory: sockets.create,
  ...overrides,
});

const parsed = <T extends BridgeFrame>(text: string): T => JSON.parse(text) as T;

const waitForSent = async <T extends BridgeFrame>(
  socket: FakeSocket,
  index: number,
): Promise<T> => {
  while (socket.sent.length <= index) await new Promise<void>((resolve) => setImmediate(resolve));
  return parsed<T>(socket.sent[index] as string);
};

const authenticate = async (socket: FakeSocket): Promise<BridgeRegisterFrame> => {
  socket.open();
  const auth = await waitForSent<BridgeAuthFrame>(socket, 0);
  socket.receive({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'result',
    correlationId: auth.correlationId,
    ok: true,
    result: { type: 'authenticated', connectionId: 'connection-1', limits: defaultLimits },
  });
  return waitForSent<BridgeRegisterFrame>(socket, 1);
};

const acknowledge = (socket: FakeSocket, registration: BridgeRegisterFrame): void => {
  socket.receive({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'result',
    correlationId: registration.correlationId,
    ok: true,
    result: { type: 'registered', leaseId: 'L'.repeat(43), limits: registration.limits },
  });
};

test('authenticates first without URL secrets and registers the current snapshot', async () => {
  const sockets = new FakeSockets();
  const map = new FakeMap(rawStyle());
  const connection = connectMapLibreBridge(map.asMap(), options(sockets));
  const socket = sockets.latest();
  assert.equal(socket.url, 'ws://127.0.0.1:7777');
  assert.equal(new URL(socket.url).search, '');
  const registration = await authenticate(socket);
  const auth = parsed<BridgeAuthFrame>(socket.sent[0] as string);
  assert.equal(auth.kind, 'auth');
  assert.equal(auth.token, token);
  assert.equal(registration.kind, 'register');
  assert.equal(registration.mapId, 'demo-map');
  assert.equal(registration.snapshot.styleHash, await hashStyle(strictStyle()));
  assert.throws(() => connection.snapshot(), (error: unknown) =>
    (error as { code?: string }).code === 'MAP_NOT_READY');
  acknowledge(socket, registration);
  await connection.whenReady();
  assert.equal(connection.status, 'connected');
});

test('reads data through the native MessageEvent prototype accessor', async () => {
  const sockets = new FakeSockets();
  const connection = connectMapLibreBridge(
    new FakeMap(rawStyle()).asMap(),
    options(sockets),
  );
  const socket = sockets.latest();
  socket.open();
  const auth = await waitForSent<BridgeAuthFrame>(socket, 0);
  socket.receiveNative({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'result',
    correlationId: auth.correlationId,
    ok: true,
    result: { type: 'authenticated', connectionId: 'connection-1', limits: defaultLimits },
  });
  const registration = await waitForSent<BridgeRegisterFrame>(socket, 1);
  socket.receiveNative({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'result',
    correlationId: registration.correlationId,
    ok: true,
    result: { type: 'registered', leaseId: 'L'.repeat(43), limits: registration.limits },
  });
  await connection.whenReady();
  assert.equal(connection.status, 'connected');
});

test('validates resource policy before opening a socket', () => {
  const sockets = new FakeSockets();
  assert.throws(() => connectMapLibreBridge(
    new FakeMap(rawStyle()).asMap(),
    options(sockets, { resourceBaseUrl: undefined }),
  ), /resourceBaseUrl/iu);
  assert.throws(() => connectMapLibreBridge(
    new FakeMap(rawStyle()).asMap(),
    options(sockets, { allowedResourceOrigins: ['https://app.example/path'] }),
  ), /policy|origin/iu);
  assert.equal(sockets.sockets.length, 0);
});

test('routes ordered commands to correlated results', async () => {
  const sockets = new FakeSockets();
  const map = new FakeMap(rawStyle());
  const connection = connectMapLibreBridge(map.asMap(), options(sockets));
  const socket = sockets.latest();
  const registration = await authenticate(socket);
  acknowledge(socket, registration);
  await connection.whenReady();
  const baseline = connection.snapshot();
  const command: BridgeCommandFrame = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: 'command',
    correlationId: 'apply-1',
    mapId: 'demo-map',
    deadlineAt: Date.now() + 10_000,
    command: {
      type: 'applyTransaction',
      expectedRevision: 0,
      expectedStyleHash: baseline.styleHash,
      transaction: {
        operations: [{
          op: 'replaceRootProperty', property: 'metadata', value: { edited: true },
        }],
        validate: true,
      },
    },
  };
  socket.receive(command);
  const result = await waitForSent<BridgeResultFrame>(socket, 2);
  assert.equal(result.correlationId, 'apply-1');
  assert.equal(result.ok && result.result.type, 'transaction');
  assert.equal(result.ok && result.result.type === 'transaction' && result.result.revision, 1);
  assert.equal(map.setStyleCalls, 1);
});

test('coalesces external Style events into one authoritative event', async () => {
  const sockets = new FakeSockets();
  const map = new FakeMap(rawStyle());
  const connection = connectMapLibreBridge(map.asMap(), options(sockets));
  const socket = sockets.latest();
  const registration = await authenticate(socket);
  acknowledge(socket, registration);
  await connection.whenReady();
  map.external(rawStyle('#ff0000'));
  map.emit('styledata');
  const event = await waitForSent(socket, 2);
  assert.equal(event.kind, 'event');
  if (event.kind !== 'event' || event.event === 'mapStatus') assert.fail('expected snapshot event');
  assert.equal(event.event, 'externalStyleChange');
  assert.equal(event.snapshot.revision, 1);
});

test('replays an ack-pending registration byte-for-byte after transient close', async () => {
  const sockets = new FakeSockets();
  const connection = connectMapLibreBridge(
    new FakeMap(rawStyle()).asMap(),
    options(sockets, { reconnect: { initialDelayMs: 1, maxDelayMs: 1 } }),
  );
  const first = sockets.latest();
  await authenticate(first);
  const registrationText = first.sent[1] as string;
  first.closeFromServer(1006);
  while (sockets.sockets.length < 2) await new Promise((resolve) => setTimeout(resolve, 2));
  const second = sockets.latest();
  second.open();
  const auth = await waitForSent<BridgeAuthFrame>(second, 0);
  second.receive({
    protocolVersion: BRIDGE_PROTOCOL_VERSION, kind: 'result', correlationId: auth.correlationId, ok: true,
    result: { type: 'authenticated', connectionId: 'connection-2', limits: defaultLimits },
  });
  await waitForSent(second, 1);
  assert.equal(second.sent[1], registrationText);
  const registration = parsed<BridgeRegisterFrame>(registrationText);
  acknowledge(second, registration);
  const confirmation = await waitForSent(second, 2);
  assert.equal(confirmation.kind, 'event');
  await connection.whenReady();
});

test('terminal close removes Map listeners and never reconnects', async () => {
  const sockets = new FakeSockets();
  const map = new FakeMap(rawStyle());
  const connection = connectMapLibreBridge(
    map.asMap(), options(sockets, { reconnect: { initialDelayMs: 1 } }),
  );
  const socket = sockets.latest();
  const registration = await authenticate(socket);
  acknowledge(socket, registration);
  await connection.whenReady();
  assert.equal(map.listenerCount(), 3);
  socket.closeFromServer(1008);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(connection.status, 'terminal');
  assert.equal(map.listenerCount(), 0);
  assert.equal(sockets.sockets.length, 1);
});
