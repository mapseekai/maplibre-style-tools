import type { Page } from '@playwright/test';
import type { StyleTransaction } from 'maplibre-style-tools/core';
import {
  liveFeatureQueryDataSchema,
  liveMapStyleDataSchema,
  liveTransactionDataSchema,
} from 'maplibre-style-tools/mcp';

import {
  expect,
  parseHarnessCallResult,
  spawnPreviewHelpWithOnlyNodeAndPnpmOnPath,
  test,
  type McpHarness,
} from './mcp-harness.js';

const completeDemoTransaction: StyleTransaction = {
  operations: [
    {
      op: 'setLayerFilter',
      layerId: 'places',
      mode: 'and',
      filter: ['==', ['get', 'category'], 'park'],
    },
    {
      op: 'duplicateLayer',
      layerId: 'places',
      newLayerId: 'places-copy',
      overrides: { paint: { 'circle-color': '#ef4444', 'circle-radius': 9 } },
    },
    {
      op: 'addGeoJsonLayer',
      sourceId: 'events',
      layerId: 'events',
      type: 'circle',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [10, 10] },
          properties: { category: 'festival' },
        }],
      },
      paint: { 'circle-color': '#2563eb', 'circle-radius': 7 },
    },
  ],
};

const connectPage = async (
  page: Page,
  connection: McpHarness['connection'],
): Promise<void> => {
  const workerResponse = page.waitForResponse((response) =>
    response.url() === 'http://127.0.0.1:4173/assets/maplibre-gl-worker.mjs');
  await page.goto('/');
  expect((await workerResponse).status()).toBe(200);
  await expect.poll(async () => await page.evaluate(async () => {
    const canvas = document.querySelector('.maplibregl-canvas');
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0 || canvas.height === 0) {
      return false;
    }
    const context = canvas.getContext('webgl2');
    if (context === null || context.isContextLost()) return false;
    const center = document.elementFromPoint(
      Math.floor(canvas.getBoundingClientRect().width / 2),
      Math.floor(canvas.getBoundingClientRect().height / 2),
    );
    if (!(center instanceof Element) || center.closest('#map') === null) return false;
    await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
    const pixel = new Uint8Array(4);
    context.readPixels(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
      context.RGBA,
      context.UNSIGNED_BYTE,
      pixel,
    );
    return pixel[3] !== 0;
  }), { timeout: 10_000 }).toBe(true);
  await page.getByTestId('bridge-url').fill(connection.url);
  await page.getByTestId('bridge-token').fill(connection.token);
  await page.getByTestId('bridge-map-id').fill('demo-map');
  await page.getByTestId('bridge-connect').click();
  await expect(page.getByTestId('bridge-status')).toHaveText('connected');
};

test('MCP mutates a real MapLibre map through the browser bridge', async ({ page, harness }) => {
  await test.info().attach('bridge-url', {
    body: harness.connection.url,
    contentType: 'text/plain',
  });
  await connectPage(page, harness.connection);

  const beforeEnvelope = await harness.call('map_get_style', { mapId: 'demo-map' });
  expect(beforeEnvelope.ok).toBe(true);
  if (!beforeEnvelope.ok) throw new Error(beforeEnvelope.error.code);
  const before = liveMapStyleDataSchema.parse(beforeEnvelope.data);
  expect(before.revision).toBe(0);

  const appliedEnvelope = await harness.call('map_apply_transaction', {
    mapId: 'demo-map',
    expectedRevision: before.revision,
    expectedStyleHash: before.styleHash,
    transaction: completeDemoTransaction,
  });
  expect(appliedEnvelope.ok).toBe(true);
  if (!appliedEnvelope.ok) throw new Error(appliedEnvelope.error.code);
  const applied = liveTransactionDataSchema.parse(appliedEnvelope.data);
  expect(applied.revision).toBe(1);

  const afterEnvelope = await harness.call('map_get_style', { mapId: 'demo-map' });
  expect(afterEnvelope.ok).toBe(true);
  if (!afterEnvelope.ok) throw new Error(afterEnvelope.error.code);
  const after = liveMapStyleDataSchema.parse(afterEnvelope.data);
  expect(after.style.layers.map((layer) => layer.id)).toContain('places-copy');
  expect(after.style.layers.map((layer) => layer.id)).toContain('events');

  let query: ReturnType<typeof liveFeatureQueryDataSchema.parse> | undefined;
  await expect.poll(async () => {
    const queryEnvelope = await harness.call('map_query_source_features', {
      mapId: 'demo-map',
      sourceId: 'events',
      limit: 10,
      properties: ['category'],
    });
    if (!queryEnvelope.ok) throw new Error(queryEnvelope.error.code);
    query = liveFeatureQueryDataSchema.parse(queryEnvelope.data);
    return query.features.length > 0;
  }, { timeout: 10_000 }).toBe(true);
  if (query === undefined) throw new Error('source feature query was not observed');
  expect(query.features.length).toBeGreaterThanOrEqual(1);
  expect(query.features.every((feature) => {
    const properties = feature.properties;
    return typeof properties === 'object' && properties !== null && !Array.isArray(properties)
      && properties.category === 'festival';
  })).toBe(true);
  expect(query.returned).toBeLessThanOrEqual(10);
  expect(query.serializedBytes).toBeLessThanOrEqual(1024 * 1024);

  await page.getByTestId('demo-filter').click();
  let observedRevision = -1;
  let observedHash = '';
  await expect.poll(async () => {
    const envelope = await harness.call('map_get_style', { mapId: 'demo-map' });
    if (!envelope.ok) return false;
    const style = liveMapStyleDataSchema.parse(envelope.data);
    observedRevision = style.revision;
    observedHash = style.styleHash;
    return style.revision === 2 && style.styleHash !== after.styleHash;
  }, { timeout: 10_000 }).toBe(true);
  expect(observedRevision).toBe(2);
  expect(observedHash).not.toBe(after.styleHash);
});

test('a later base mutation cannot redirect a new relative Style resource', async ({ page, harness }) => {
  const probeRequests: string[] = [];
  const capturedBaseRequest = 'http://127.0.0.1:4173/relative-probe.geojson';
  const mutatedBaseRequest = 'http://127.0.0.1:4174/evil/relative-probe.geojson';
  page.on('request', (request) => {
    if (request.url().includes('relative-probe.geojson')) probeRequests.push(request.url());
  });
  await connectPage(page, harness.connection);
  const beforeEnvelope = await harness.call('map_get_style', { mapId: 'demo-map' });
  if (!beforeEnvelope.ok) throw new Error(beforeEnvelope.error.code);
  const before = liveMapStyleDataSchema.parse(beforeEnvelope.data);

  await page.evaluate(() => {
    const base = document.createElement('base');
    base.href = 'http://127.0.0.1:4174/evil/';
    document.head.prepend(base);
  });
  const rejected = await harness.call('map_apply_transaction', {
    mapId: 'demo-map',
    expectedRevision: before.revision,
    expectedStyleHash: before.styleHash,
    transaction: {
      operations: [{
        op: 'addGeoJsonLayer',
        sourceId: 'relative-probe',
        layerId: 'relative-probe',
        data: './relative-probe.geojson',
        type: 'circle',
      }],
    },
  });
  expect(rejected.ok).toBe(false);
  if (rejected.ok) throw new Error('expected relative Style rejection');
  expect(rejected.error.code).toBe('INVALID_INPUT');
  expect(rejected.error.details).toEqual({ reason: 'relative-style-url' });

  const afterEnvelope = await harness.call('map_get_style', { mapId: 'demo-map' });
  if (!afterEnvelope.ok) throw new Error(afterEnvelope.error.code);
  const after = liveMapStyleDataSchema.parse(afterEnvelope.data);
  expect(after.revision).toBe(before.revision);
  expect('relative-probe' in after.style.sources).toBe(false);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); });
  }));
  expect(probeRequests).not.toContain(capturedBaseRequest);
  expect(probeRequests).not.toContain(mutatedBaseRequest);
  expect(probeRequests).toEqual([]);
});

test('a partial harness startup is cleaned before a successful retry', async ({ harnessFactory }) => {
  await expect(harnessFactory.start({ failAfterSpawnForTest: true }))
    .rejects.toThrow(/injected setup failure/u);
  expect(harnessFactory.activeChildCount()).toBe(0);
  const retry = await harnessFactory.start();
  await retry.close();
  expect(harnessFactory.activeChildCount()).toBe(0);
});

test('the committed preview launcher has no rtk runtime dependency', async () => {
  const result = await spawnPreviewHelpWithOnlyNodeAndPnpmOnPath();
  expect(result.exitCode).toBe(0);
  expect(result.pathContainsRtk).toBe(false);
});

test('the harness rejects an SDK compatibility wrapper before envelope access', () => {
  expect(() => parseHarnessCallResult({
    toolResult: { structuredContent: { ok: true, data: {} } },
  })).toThrow();
});

test('stdio startup attaches stderr before Client.connect and never manually starts transport', async ({
  harness,
}) => {
  expect(harness.startupOrder.slice(0, 2)).toEqual(['stderr-listener', 'client.connect']);
  expect(harness.startupOrder).toContain('bridge-line');
  expect(harness.startupOrder).toContain('connect-settlement');
  expect(harness.manualStartCalls).toBe(0);
});

test('HTTP MCP and WebSocket endpoints come only from the combined startup handoff', async ({
  page,
  httpHarness,
}) => {
  expect(httpHarness.handoff.mcpTransport).toBe('http');
  expect(httpHarness.handoff.mcpUrl).toBe(httpHarness.transportEndpoint);
  expect(httpHarness.connection.url).toBe(httpHarness.handoff.wsUrl);
  expect(httpHarness.usedHardCodedPortOrSideChannel).toBe(false);
  await connectPage(page, httpHarness.connection);
  const listed = await httpHarness.call('map_list', {});
  expect(listed.ok).toBe(true);
});
