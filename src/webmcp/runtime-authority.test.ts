import assert from 'node:assert/strict';
import test from 'node:test';

import type { BrowserMapRuntime, BrowserMapState } from '../bridge/browser-runtime.js';
import type { BridgeCommand, BridgeResultFor } from '../bridge/protocol.js';
import { createStyleToolError, type StyleDocument, type StyleTransaction } from '../core/index.js';
import { WebMcpMapAuthority } from './runtime-authority.js';

const baseStyle: StyleDocument = { version: 8, sources: {}, layers: [] };
const transaction: StyleTransaction = {
  operations: [{ op: 'setStyleRootProperties', properties: { name: 'Updated' } }],
};

type RecordedRuntime = BrowserMapRuntime & { readonly commands: BridgeCommand[] };

const fakeRuntime = (
  initial: Partial<BrowserMapState> & { style: StyleDocument },
): RecordedRuntime => {
  let state: BrowserMapState = {
    revision: initial.revision ?? 0,
    styleHash: initial.styleHash ?? 'a'.repeat(64),
    style: structuredClone(initial.style),
  };
  const commands: BridgeCommand[] = [];
  return {
    commands,
    snapshot: () => structuredClone(state),
    noteExternalStyle: async () => structuredClone(state),
    execute: async <C extends BridgeCommand>(command: C): Promise<BridgeResultFor<C>> => {
      commands.push(structuredClone(command));
      if (command.type !== 'applyTransaction' && command.type !== 'applyStyleDocument') {
        throw new Error(`Unexpected command in mutation fixture: ${command.type}`);
      }
      state = { ...state, revision: state.revision + 1 };
      return {
        type: 'transaction',
        detail: 'full',
        revision: state.revision,
        styleHash: state.styleHash,
        applied: true,
        noOp: false,
        changedLayerIds: [],
        changedSourceIds: [],
        warnings: [],
        style: structuredClone(state.style),
        diff: [],
      } as unknown as BridgeResultFor<C>;
    },
  };
};

test('reads the reconciled runtime snapshot', () => {
  const authority = new WebMcpMapAuthority(fakeRuntime({ style: baseStyle }), () => ({
    selectedLayerId: 'water',
  }));
  assert.deepEqual(authority.readStyle(), { ok: true, style: baseStyle, warnings: [] });
  assert.deepEqual(authority.context(), { selectedLayerId: 'water' });
});

test('adds fresh revision guards to transactions', async () => {
  const runtime = fakeRuntime({ revision: 7, styleHash: 'a'.repeat(64), style: baseStyle });
  const authority = new WebMcpMapAuthority(runtime);
  const result = await authority.applyTransaction(transaction, { diff: true });
  assert.equal(result.ok, true);
  assert.deepEqual(runtime.commands[0], {
    type: 'applyTransaction',
    expectedRevision: 7,
    expectedStyleHash: 'a'.repeat(64),
    transaction: { ...transaction, validate: true },
  });
});

const commandRuntime = (
  resultFor: (command: BridgeCommand) => unknown,
): RecordedRuntime => {
  const commands: BridgeCommand[] = [];
  return {
    commands,
    snapshot: () => ({ revision: 0, styleHash: 'a'.repeat(64), style: structuredClone(baseStyle) }),
    noteExternalStyle: async () => ({ revision: 0, styleHash: 'a'.repeat(64), style: structuredClone(baseStyle) }),
    execute: async <C extends BridgeCommand>(command: C): Promise<BridgeResultFor<C>> => {
      commands.push(structuredClone(command));
      return resultFor(command) as BridgeResultFor<C>;
    },
  };
};

test('maps every runtime command to its browser command', async () => {
  const runtime = commandRuntime((command) => {
    if (command.type === 'listImages') {
      return { type: 'images', imageIds: ['one', 'two', 'three'], returned: 3, truncated: false, serializedBytes: 20 };
    }
    if (command.type === 'listSprites') {
      return { type: 'sprites', items: [{ id: 'default', url: 'https://assets.example/sprite' }], returned: 1, truncated: false, serializedBytes: 50 };
    }
    return command.type === 'setFeatureState' || command.type === 'removeFeatureState' || command.type === 'setGlobalState'
      ? { type: 'state', accepted: true }
      : { type: 'ack', accepted: true };
  });
  const commands = new WebMcpMapAuthority(runtime).runtimeCommands();

  await commands.updateGeoJsonDataRuntime({ sourceId: 'points', diff: { removeAll: true } });
  await commands.setSourceTileLodParams({ maxZoomLevelsOnScreen: 2, tileCountMaxMinRatio: 1, sourceId: 'terrain' });
  await commands.setFeatureState({ target: { source: 'points', id: 1 }, state: { selected: true } });
  await commands.removeFeatureState({ target: { source: 'points', id: 1 }, key: 'selected' });
  await commands.setGlobalState({ propertyName: 'theme', value: 'dark' });
  const images = await commands.listImages({ limit: 2 });
  await commands.addImageFromUrl({ imageId: 'pin', url: 'https://assets.example/pin.png' });
  await commands.removeImage({ imageId: 'pin' });
  const sprites = await commands.listSprites({ limit: 1 });
  await commands.addSprite({ spriteId: 'default', url: 'https://assets.example/sprite' });
  await commands.removeSprite({ spriteId: 'default' });

  assert.deepEqual(runtime.commands.map(({ type }) => type), [
    'updateGeoJsonData', 'setSourceTileLodParams', 'setFeatureState', 'removeFeatureState',
    'setGlobalState', 'listImages', 'addImage', 'removeImage', 'listSprites', 'addSprite', 'removeSprite',
  ]);
  assert.deepEqual(runtime.commands[0], { type: 'updateGeoJsonData', sourceId: 'points', diff: { removeAll: true } });
  assert.deepEqual(runtime.commands[6], {
    type: 'addImage', imageId: 'pin', image: { kind: 'url', url: 'https://assets.example/pin.png' },
  });
  assert.deepEqual(images, { ok: true, data: { items: ['one', 'two'], returned: 2, truncated: true } });
  assert.deepEqual(sprites, {
    ok: true,
    data: { items: [{ id: 'default', url: 'https://assets.example/sprite' }], returned: 1, truncated: false },
  });
});

test('encodes browser image data without Node buffers', async () => {
  const runtime = commandRuntime(() => ({ type: 'ack', accepted: true }));
  const commands = new WebMcpMapAuthority(runtime).runtimeCommands();
  const result = await commands.addImageData({
    imageId: 'pixels', image: { width: 1, height: 1, data: new Uint8Array([255, 0, 1, 255]) },
  });
  assert.deepEqual(result, { ok: true, data: null });
  assert.deepEqual(runtime.commands[0], {
    type: 'addImage', imageId: 'pixels', image: { kind: 'rgba', width: 1, height: 1, data: '/wAB/w==' },
  });
});

test('projects source feature query with browser fields and bounds', async () => {
  const runtime = commandRuntime(() => ({
    type: 'features',
    features: [{ type: 'Feature', properties: { name: 'River' }, geometry: null }],
    returned: 1,
    truncated: true,
    serializedBytes: 80,
    warnings: [{ code: 'feature-limit', message: 'Result was truncated.' }],
  }));
  const result = await new WebMcpMapAuthority(runtime).querySourceFeatures({
    sourceId: 'water', sourceLayer: 'water', propertyAllowlist: ['name'], limit: 3,
  });
  assert.deepEqual(runtime.commands[0], {
    type: 'querySourceFeatures', sourceId: 'water', sourceLayer: 'water', properties: ['name'], limit: 3,
  });
  assert.deepEqual(result, {
    ok: true,
    features: [{ type: 'Feature', properties: { name: 'River' }, geometry: null }],
    returned: 1,
    truncated: true,
    serializedBytes: 80,
    warnings: [{ code: 'feature-limit', message: 'Result was truncated.' }],
  });
});

test('projects rendered feature query failures authentically', async () => {
  const runtime = commandRuntime(() => { throw createStyleToolError('CAPABILITY_DENIED', 'Feature queries are disabled.'); });
  const result = await new WebMcpMapAuthority(runtime).queryRenderedFeatures({
    geometry: { kind: 'point', point: [10, 20] }, propertyAllowlist: ['name'], limit: 1,
  });
  assert.deepEqual(runtime.commands[0], {
    type: 'queryRenderedFeatures', geometry: { kind: 'point', point: [10, 20] }, properties: ['name'], limit: 1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'CAPABILITY_DENIED');
});

test('makes an authenticated mutation failure unavailable when it omits the current Style', async () => {
  const runtime = commandRuntime(() => {
    throw createStyleToolError('TIMEOUT', 'Browser map command timed out.', undefined, {
      currentSnapshot: { revision: 1, styleHash: 'a'.repeat(64) },
      rolledBack: false,
      rollbackError: { code: 'IO_ERROR', message: 'Rollback failed.' },
    });
  });
  const result = await new WebMcpMapAuthority(runtime).applyTransaction(transaction, { diff: false });
  assert.equal(result.ok, false);
  assert.equal(result.styleAuthority, 'unavailable');
  assert.equal(result.rolledBack, false);
  assert.equal(result.rollbackError?.code, 'IO_ERROR');
});
