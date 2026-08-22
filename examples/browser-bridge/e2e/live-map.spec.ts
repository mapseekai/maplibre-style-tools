import type { Page } from '@playwright/test';
import type { StyleTransaction } from 'maplibre-style-tools/core';
import { z } from 'zod';

import {
  expect,
  test,
  type McpHarness,
} from './mcp-harness.js';

const layerProjectionSchema = z.object({ id: z.string() });
const inspectListLayersDataSchema = z.object({
  action: z.literal('listLayers'),
  projection: z.object({
    items: z.array(layerProjectionSchema),
    returned: z.number(),
    total: z.number().optional(),
    truncated: z.boolean(),
  }),
});
const inspectGetLayerDataSchema = z.object({
  action: z.literal('getLayer'),
  projection: z.object({
    value: z.object({ id: z.string(), filter: z.unknown() }),
    returned: z.number(),
  }),
});
const inspectGetLayerCountDataSchema = z.object({
  action: z.literal('getLayerCount'),
  projection: z.object({
    value: z.object({ layerCount: z.number() }),
    returned: z.number(),
  }),
});
const applyTransactionDataSchema = z.object({
  applied: z.boolean(),
});
const featureQueryDataSchema = z.object({
  features: z.array(z.object({ properties: z.unknown() })),
  returned: z.number(),
  truncated: z.boolean(),
});

const completeDemoTransaction: StyleTransaction = {
  operations: [
    {
      op: 'setLayerFilter',
      layerId: 'countries-fill',
      mode: 'and',
      filter: ['==', ['get', 'name'], 'United States of America'],
    },
    {
      op: 'duplicateLayer',
      layerId: 'countries-fill',
      newLayerId: 'places-copy',
      overrides: { paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.5 } },
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

const mapTarget = { kind: 'map', mapId: 'demo-map' } as const;

type CallableHarness = Pick<McpHarness, 'call'>;

const callInspect = (harness: CallableHarness, input: Record<string, unknown>) =>
  harness.call('inspectStyle', { target: mapTarget, input });

const connectPage = async (
  page: Page,
  connection: McpHarness['connection'],
): Promise<void> => {
  const workerResponse = page.waitForResponse((response) =>
    response.url() === 'http://127.0.0.1:4173/assets/maplibre-gl-worker.mjs');
  await page.goto('/');
  expect((await workerResponse).status()).toBe(200);
  const canvas = page.getByTestId('map-canvas');
  await expect.poll(async () => await canvas.evaluate(async (element) => {
    if (!(element instanceof HTMLCanvasElement) || element.width === 0 || element.height === 0) {
      return false;
    }
    const context = element.getContext('webgl2');
    if (context === null || context.isContextLost()) return false;
    const center = document.elementFromPoint(
      Math.floor(element.getBoundingClientRect().width / 2),
      Math.floor(element.getBoundingClientRect().height / 2),
    );
    if (!(center instanceof Element) || center.closest('#map') === null) return false;
    await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
    const pixel = new Uint8Array(4);
    context.readPixels(
      Math.floor(element.width / 2),
      Math.floor(element.height / 2),
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

  const beforeEnvelope = await callInspect(harness, { action: 'listLayers' });
  expect(beforeEnvelope.success).toBe(true);
  if (!beforeEnvelope.success) throw new Error(beforeEnvelope.error.code);
  const beforeIds = inspectListLayersDataSchema.parse(beforeEnvelope.data)
    .projection.items.map((layer) => layer.id);
  expect(beforeIds).not.toContain('places-copy');
  expect(beforeIds).not.toContain('events');

  const appliedEnvelope = await harness.call('applyStyleTransaction', {
    target: mapTarget,
    input: { transaction: { operations: completeDemoTransaction.operations }, diff: true },
  });
  expect(appliedEnvelope.success).toBe(true);
  if (!appliedEnvelope.success) throw new Error(appliedEnvelope.error.code);
  expect(applyTransactionDataSchema.parse(appliedEnvelope.data).applied).toBe(true);

  await expect.poll(async () => {
    const envelope = await callInspect(harness, { action: 'listLayers' });
    if (!envelope.success) throw new Error(envelope.error.code);
    const ids = inspectListLayersDataSchema.parse(envelope.data)
      .projection.items.map((layer) => layer.id);
    return ids.includes('places-copy') && ids.includes('events');
  }, { timeout: 10_000 }).toBe(true);

  let query: z.infer<typeof featureQueryDataSchema> | undefined;
  await expect.poll(async () => {
    const queryEnvelope = await harness.call('queryMapFeatures', {
      target: mapTarget,
      input: { target: 'source', sourceId: 'events', limit: 10, propertyAllowlist: ['category'] },
    });
    if (!queryEnvelope.success) throw new Error(queryEnvelope.error.code);
    query = featureQueryDataSchema.parse(queryEnvelope.data);
    return query.features.length > 0;
  }, { timeout: 10_000 }).toBe(true);
  if (query === undefined) throw new Error('source feature query was not observed');
  expect(query.features.length).toBeGreaterThanOrEqual(1);
  expect(query.features.every((feature) => {
    const properties = feature.properties;
    if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
      return false;
    }
    return 'category' in properties && properties.category === 'festival';
  })).toBe(true);
  expect(query.returned).toBeLessThanOrEqual(10);
  expect(query.truncated).toBe(false);

  await page.getByTestId('demo-filter').click();
  const expectedFilterClause = ['==', ['get', 'name'], 'United States of America'];
  await expect.poll(async () => {
    const envelope = await callInspect(harness, { action: 'getLayer', layerId: 'countries-fill' });
    if (!envelope.success) return false;
    const layer = inspectGetLayerDataSchema.parse(envelope.data).projection.value;
    return JSON.stringify(layer.filter).includes(JSON.stringify(expectedFilterClause));
  }, { timeout: 10_000 }).toBe(true);
});

test('a later base mutation cannot redirect a new relative Style resource', async ({ page, harness }) => {
  const probeRequests: string[] = [];
  const capturedBaseRequest = 'http://127.0.0.1:4173/relative-probe.geojson';
  const mutatedBaseRequest = 'http://127.0.0.1:4174/evil/relative-probe.geojson';
  page.on('request', (request) => {
    if (request.url().includes('relative-probe.geojson')) probeRequests.push(request.url());
  });
  await connectPage(page, harness.connection);

  await page.evaluate(() => {
    const base = document.createElement('base');
    base.href = 'http://127.0.0.1:4174/evil/';
    document.head.prepend(base);
  });
  const rejected = await harness.call('applyStyleTransaction', {
    target: mapTarget,
    input: {
      transaction: {
        operations: [{
          op: 'addGeoJsonLayer',
          sourceId: 'relative-probe',
          layerId: 'relative-probe',
          data: './relative-probe.geojson',
          type: 'circle',
        }],
      },
    },
  });
  expect(rejected.success).toBe(false);
  if (rejected.success) throw new Error('expected relative Style rejection');
  expect(rejected.error.code).toBe('INVALID_INPUT');
  expect(rejected.error.details).toEqual({ reason: 'relative-style-url' });

  const missing = await callInspect(harness, { action: 'getLayer', layerId: 'relative-probe' });
  expect(missing.success).toBe(false);
  if (missing.success) throw new Error('rejected layer must not exist');
  expect(missing.error.code).toBe('NOT_FOUND');
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); });
  }));
  expect(probeRequests).not.toContain(capturedBaseRequest);
  expect(probeRequests).not.toContain(mutatedBaseRequest);
  expect(probeRequests).toEqual([]);
});

test('HTTP MCP connects a real MapLibre map through the browser bridge', async ({
  page,
  httpHarness,
}) => {
  await connectPage(page, httpHarness.connection);
  const listed = await callInspect(httpHarness, { action: 'getLayerCount' });
  expect(listed.success).toBe(true);
  if (!listed.success) throw new Error(listed.error.code);
  const layerCount = inspectGetLayerCountDataSchema.parse(listed.data).projection.value.layerCount;
  expect(layerCount).toBeGreaterThan(0);
});
