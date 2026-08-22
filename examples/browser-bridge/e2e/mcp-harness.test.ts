import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMcpHarnessFactory,
  parseHarnessCallResult,
  spawnPreviewHelpWithOnlyNodeAndPnpmOnPath,
} from './mcp-harness.js';

test('a partial harness startup is cleaned before a successful retry', async () => {
  const harnessFactory = createMcpHarnessFactory();
  try {
    await assert.rejects(
      harnessFactory.start({ failAfterSpawnForTest: true }),
      /injected setup failure/u,
    );
    assert.equal(harnessFactory.activeChildCount(), 0);
    const retry = await harnessFactory.start();
    await retry.close();
    assert.equal(harnessFactory.activeChildCount(), 0);
  } finally {
    await harnessFactory.closeAll();
  }
});

test('the harness rejects an SDK compatibility wrapper before envelope access', () => {
  assert.throws(() => parseHarnessCallResult({
    toolResult: { structuredContent: { ok: true, data: {} } },
  }));
});

test('stdio startup attaches stderr before Client.connect and never manually starts transport', async () => {
  const harnessFactory = createMcpHarnessFactory();
  try {
    const harness = await harnessFactory.start();
    try {
      assert.deepEqual(harness.startupOrder.slice(0, 2), ['stderr-listener', 'client.connect']);
      assert.ok(harness.startupOrder.includes('bridge-line'));
      assert.ok(harness.startupOrder.includes('connect-settlement'));
      assert.equal(harness.manualStartCalls, 0);
    } finally {
      await harness.close();
    }
  } finally {
    await harnessFactory.closeAll();
  }
});

test('HTTP endpoints come only from the combined startup handoff', async () => {
  const harnessFactory = createMcpHarnessFactory();
  try {
    const harness = await harnessFactory.startHttp();
    try {
      assert.equal(harness.handoff.mcpTransport, 'http');
      assert.equal(harness.handoff.mcpUrl, harness.transportEndpoint);
      assert.equal(harness.connection.url, harness.handoff.wsUrl);
      assert.equal(harness.usedHardCodedPortOrSideChannel, false);
    } finally {
      await harness.close();
    }
  } finally {
    await harnessFactory.closeAll();
  }
});

test('the committed preview launcher has no rtk runtime dependency', async () => {
  const result = await spawnPreviewHelpWithOnlyNodeAndPnpmOnPath();
  assert.equal(result.exitCode, 0);
  assert.equal(result.pathContainsRtk, false);
});
