import assert from 'node:assert/strict';
import test from 'node:test';

import { createStyleToolError } from '../core/index.js';
import { BridgeMapAuthority } from './bridge-authority.js';

const successRegistry = {
  execute: async (_mapId: string, command: { type: string }) => ({
    type: 'features' as const,
    features: [{ type: 'Feature', properties: { command: command.type }, geometry: null }],
    returned: 1,
    truncated: false,
    serializedBytes: 80,
    warnings: [],
  }),
};

test('bridge authority dispatches source and rendered feature queries', async () => {
  const authority = new BridgeMapAuthority(successRegistry as never, 'map-1');
  const source = await authority.querySourceFeatures({ sourceId: 'roads', propertyAllowlist: ['name'] });
  const rendered = await authority.queryRenderedFeatures({ layerIds: ['roads'] });
  assert.equal(source.ok, true);
  assert.equal(rendered.ok, true);
  if (source.ok) assert.equal(source.features.length, 1);
  if (rendered.ok) assert.equal(rendered.features.length, 1);
});

test('bridge authority projects a bridge feature-query failure', async () => {
  const authority = new BridgeMapAuthority({
    execute: async () => { throw createStyleToolError('CAPABILITY_DENIED', 'Feature queries are disabled.'); },
  } as never, 'map-1');
  const result = await authority.querySourceFeatures({ sourceId: 'roads' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error?.code, 'CAPABILITY_DENIED');
});

const liveStyle = {
  version: 8 as const,
  sources: {},
  layers: [],
};
const liveTransaction = {
  operations: [{ op: 'setStyleRootProperties', properties: { name: 'audited' } }],
};

const transactionRegistry = (transactionResult: Record<string, unknown>) => {
  const commands: Record<string, unknown>[] = [];
  return {
    commands,
    execute: async (_mapId: string, command: Record<string, unknown>) => {
      commands.push(command);
      if (command.type === 'getStyle') {
        return { type: 'style', revision: 4, styleHash: 'a'.repeat(64), style: liveStyle };
      }
      return transactionResult;
    },
  };
};

const fullResult = {
  type: 'transaction', detail: 'full', revision: 5, styleHash: 'b'.repeat(64),
  applied: true, noOp: false, changedLayerIds: [], changedSourceIds: [],
  warnings: [], style: { ...liveStyle, name: 'audited' },
  diff: [{ op: 'replace', path: '/name', value: 'audited' }],
};

test('bridge transaction commits against fresh revision and style hash', async () => {
  const registry = transactionRegistry(fullResult);
  const authority = new BridgeMapAuthority(registry as never, 'map-1');
  const result = await authority.applyTransaction(liveTransaction as never, { diff: true });
  assert.equal(result.ok, true);
  const commit = registry.commands[1];
  assert.equal(commit?.type, 'applyTransaction');
  assert.equal(commit?.expectedRevision, 4);
  assert.equal(commit?.expectedStyleHash, 'a'.repeat(64));
  assert.deepEqual(commit?.transaction, { ...liveTransaction, validate: true });
  if (result.ok) {
    assert.equal(result.styleAuthority, 'current');
    assert.deepEqual(result.diff, fullResult.diff);
  }
});

test('bridge transaction rejects a receipt-only result', async () => {
  const registry = transactionRegistry({
    type: 'transaction', detail: 'receipt', revision: 5, styleHash: 'b'.repeat(64),
    applied: true, noOp: false,
  });
  const authority = new BridgeMapAuthority(registry as never, 'map-1');
  const result = await authority.applyTransaction(liveTransaction as never, { diff: true });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error?.message ?? '', /full transaction result/u);
});

test('bridge transaction rejects a full result that omits the requested diff', async () => {
  const registry = transactionRegistry({
    ...fullResult, diff: undefined, omitted: { diff: true },
  });
  const authority = new BridgeMapAuthority(registry as never, 'map-1');
  const result = await authority.applyTransaction(liveTransaction as never, { diff: true });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error?.message ?? '', /omitted the requested diff/u);
});

test('bridge transaction accepts an omitted diff when none was requested', async () => {
  const registry = transactionRegistry({ ...fullResult, diff: undefined, omitted: { diff: true } });
  const authority = new BridgeMapAuthority(registry as never, 'map-1');
  const result = await authority.applyTransaction(liveTransaction as never, { diff: false });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.diff, []);
});

test('bridge whole-document apply commits an inline Style against a fresh snapshot', async () => {
  const source = { ...liveStyle, name: 'replacement' };
  const registry = transactionRegistry({ ...fullResult, style: source });
  const authority = new BridgeMapAuthority(registry as never, 'map-1');
  const result = await authority.applyDocument(source, { diff: true });
  assert.equal(result.ok, true);
  assert.deepEqual(registry.commands, [
    { type: 'getStyle' },
    {
      type: 'applyStyleDocument', expectedRevision: 4, expectedStyleHash: 'a'.repeat(64),
      source: { kind: 'style', style: source }, diff: true,
    },
  ]);
  if (result.ok) {
    assert.equal(result.styleAuthority, 'current');
    assert.deepEqual(result.style, source);
    assert.deepEqual(result.diff, fullResult.diff);
  }
});

test('bridge whole-document apply commits a Style URL against a fresh snapshot', async () => {
  const registry = transactionRegistry(fullResult);
  const authority = new BridgeMapAuthority(registry as never, 'map-1');
  const result = await authority.applyDocument('https://styles.example/map.json', { diff: false });
  assert.equal(result.ok, true);
  assert.deepEqual(registry.commands, [
    { type: 'getStyle' },
    {
      type: 'applyStyleDocument', expectedRevision: 4, expectedStyleHash: 'a'.repeat(64),
      source: { kind: 'url', url: 'https://styles.example/map.json' }, diff: false,
    },
  ]);
  if (result.ok) assert.deepEqual(result.diff, []);
});

const runtimeRegistry = () => {
  const commands: Record<string, unknown>[] = [];
  return {
    commands,
    execute: async (_mapId: string, command: Record<string, unknown>) => {
      commands.push(command);
      if (command.type === 'listSprites') {
        return {
          type: 'sprites', items: [{ id: 'base', url: 'https://sprites.example/base' }],
          returned: 1, truncated: true, serializedBytes: 52,
        };
      }
      return { type: 'ack', accepted: true };
    },
  };
};

test('bridge runtime forwards a GeoJSON diff command', async () => {
  const registry = runtimeRegistry();
  const commands = new BridgeMapAuthority(registry as never, 'map-1').runtimeCommands();
  const diff = { remove: ['obsolete'], update: [{ id: 7, removeProperties: ['draft'] }] };
  assert.equal((await commands.updateGeoJsonDataRuntime({ sourceId: 'roads', diff })).ok, true);
  assert.deepEqual(registry.commands, [{ type: 'updateGeoJsonData', sourceId: 'roads', diff }]);
});

test('bridge runtime forwards source tile LOD parameters', async () => {
  const registry = runtimeRegistry();
  const commands = new BridgeMapAuthority(registry as never, 'map-1').runtimeCommands();
  assert.equal((await commands.setSourceTileLodParams({
    maxZoomLevelsOnScreen: 4, tileCountMaxMinRatio: 2, sourceId: 'terrain',
  })).ok, true);
  assert.deepEqual(registry.commands, [{
    type: 'setSourceTileLodParams', maxZoomLevelsOnScreen: 4,
    tileCountMaxMinRatio: 2, sourceId: 'terrain',
  }]);
});

test('bridge runtime maps URL images to addImage commands', async () => {
  const registry = runtimeRegistry();
  const commands = new BridgeMapAuthority(registry as never, 'map-1').runtimeCommands();
  assert.equal((await commands.addImageFromUrl({
    imageId: 'marker', url: 'https://images.example/marker.png',
    options: { pixelRatio: 2 }, overwrite: true,
  })).ok, true);
  assert.deepEqual(registry.commands, [{
    type: 'addImage', imageId: 'marker',
    image: { kind: 'url', url: 'https://images.example/marker.png' },
    options: { pixelRatio: 2 }, overwrite: true,
  }]);
});

test('bridge runtime encodes raw image data for addImage commands', async () => {
  const registry = runtimeRegistry();
  const commands = new BridgeMapAuthority(registry as never, 'map-1').runtimeCommands();
  assert.equal((await commands.addImageData({
    imageId: 'pixel', image: { width: 1, height: 1, data: new Uint8Array([1, 2, 3, 4]) },
  })).ok, true);
  assert.deepEqual(registry.commands, [{
    type: 'addImage', imageId: 'pixel',
    image: { kind: 'rgba', width: 1, height: 1, data: 'AQIDBA==' },
  }]);
});

test('bridge runtime maps listSprites bridge data to the SDK list shape', async () => {
  const registry = runtimeRegistry();
  const commands = new BridgeMapAuthority(registry as never, 'map-1').runtimeCommands();
  const result = await commands.listSprites({ limit: 1 });
  assert.deepEqual(registry.commands, [{ type: 'listSprites' }]);
  assert.deepEqual(result, {
    ok: true,
    data: {
      items: [{ id: 'base', url: 'https://sprites.example/base' }],
      returned: 1,
      truncated: true,
    },
  });
});

test('bridge runtime forwards addSprite commands', async () => {
  const registry = runtimeRegistry();
  const commands = new BridgeMapAuthority(registry as never, 'map-1').runtimeCommands();
  assert.equal((await commands.addSprite({
    spriteId: 'terrain', url: 'https://sprites.example/terrain', overwrite: true,
  })).ok, true);
  assert.deepEqual(registry.commands, [{
    type: 'addSprite', spriteId: 'terrain',
    url: 'https://sprites.example/terrain', overwrite: true,
  }]);
});

test('bridge runtime forwards removeSprite commands', async () => {
  const registry = runtimeRegistry();
  const commands = new BridgeMapAuthority(registry as never, 'map-1').runtimeCommands();
  assert.equal((await commands.removeSprite({ spriteId: 'terrain' })).ok, true);
  assert.deepEqual(registry.commands, [{ type: 'removeSprite', spriteId: 'terrain' }]);
});
