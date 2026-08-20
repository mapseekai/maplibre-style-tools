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
