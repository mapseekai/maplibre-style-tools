import { expect, test, type Page } from '@playwright/test';

const DEMO_STYLE_URL = 'https://demotiles.maplibre.org/style.json';
const TEST_STYLE = {
  version: 8,
  sources: {
    places: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', id: 1, properties: { class: 'water', name: 'Central Lake', visible: true, rank: 2 }, geometry: { type: 'Polygon', coordinates: [[[-8, 36], [8, 36], [8, 52], [-8, 52], [-8, 36]]] } },
          { type: 'Feature', properties: { class: 'district', name: 'Central District' }, geometry: { type: 'Polygon', coordinates: [[[-12, 32], [12, 32], [12, 56], [-12, 56], [-12, 32]]] } },
        ],
      },
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#dfe8e1' } },
    { id: 'places-fill', type: 'fill', source: 'places', paint: { 'fill-color': '#3b82a0', 'fill-opacity': 0.7 } },
    { id: 'places-outline', type: 'line', source: 'places', paint: { 'line-color': '#17324d', 'line-width': 2 } },
  ],
} as const;

type FakeTool = { readonly execute: (input: Record<string, unknown>, options: { readonly signal: AbortSignal }) => unknown | Promise<unknown> };
type MapCommentContext = { readonly comment: string; readonly scope: string; readonly feature: { readonly layerId: string } };
type WebMcpToolResult = Readonly<Record<string, unknown>> & {
  readonly success?: boolean;
  readonly contexts?: readonly MapCommentContext[];
  readonly data?: {
    readonly changedLayers?: readonly string[];
    readonly projection?: { readonly value?: { readonly id?: string; readonly paint?: Readonly<Record<string, unknown>> } };
  };
};

declare global {
  var __webmcpTools: Map<string, FakeTool>;
  var __callWebMcpTool: (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

const installFakeWebMcp = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const tools = new Map<string, FakeTool>();
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      async registerTool(tool: FakeTool, options: { signal?: AbortSignal } = {}) {
        tools.set((tool as FakeTool & { name: string }).name, tool);
        options.signal?.addEventListener('abort', () => tools.delete((tool as FakeTool & { name: string }).name), { once: true });
      },
    } });
    Object.assign(globalThis, {
      __webmcpTools: tools,
      __callWebMcpTool: async (name: string, input: Record<string, unknown>) => {
        const tool = tools.get(name);
        if (tool === undefined) throw new Error(`Unknown WebMCP tool: ${name}`);
        return tool.execute(input, { signal: new AbortController().signal }) as Promise<Record<string, unknown>>;
      },
    });
  });
};

const selectUpperCentralLake = async (page: Page): Promise<void> => {
  const map = page.getByTestId('map');
  const box = await map.boundingBox();
  if (box === null) throw new Error('map has no visible bounds');
  const candidate = page.getByRole('button', { name: 'places-fill · Central Lake' });
  await expect.poll(async () => {
    await map.click({ position: { x: box.width / 2, y: box.height / 2 - 80 } });
    return candidate.isVisible();
  }).toBe(true);
  await candidate.click();
};

test('adds a map comment and applies a WebMCP update from its consumed context', async ({ page }) => {
  await installFakeWebMcp(page);
  let releaseStyle!: () => void;
  const styleHeld = new Promise<void>((resolve) => { releaseStyle = resolve; });
  await page.route(DEMO_STYLE_URL, async (route) => {
    await styleHeld;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(TEST_STYLE) });
  });
  await page.goto('/');
  const toggle = page.getByTestId('comment-mode-toggle');
  await expect(toggle).toBeDisabled();
  releaseStyle();
  await expect(toggle).toBeEnabled();
  await expect.poll(() => page.evaluate(() => globalThis.__webmcpTools.size)).toBe(6);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await selectUpperCentralLake(page);
  await page.getByRole('button', { name: '下一步' }).click();
  const popupLayout = await page.locator('.maplibregl-popup').evaluate((popup) => {
    const content = popup.querySelector('.maplibregl-popup-content');
    const form = popup.querySelector('.comment-popup');
    if (content === null || form === null) return false;
    const popupBox = popup.getBoundingClientRect();
    const contentBox = content.getBoundingClientRect();
    const formBox = form.getBoundingClientRect();
    return {
      popupFitsViewport: popupBox.top >= 0 && popupBox.bottom <= window.innerHeight,
      formFitsContent: formBox.left >= contentBox.left && formBox.right <= contentBox.right,
      popup: { top: popupBox.top, bottom: popupBox.bottom },
      viewportHeight: window.innerHeight,
    };
  });
  expect(popupLayout, `Unexpected popup layout: ${JSON.stringify(popupLayout)}`).toMatchObject({
    popupFitsViewport: true,
    formFitsContent: true,
  });
  await page.getByRole('textbox', { name: '评论内容', exact: true }).fill('Please inspect the lake class.');
  await page.getByRole('combobox', { name: '应用范围', exact: true }).selectOption('property-class');
  await page.getByRole('combobox', { name: '属性', exact: true }).selectOption('class');
  await page.getByRole('button', { name: '添加', exact: true }).click();

  const pin = page.getByTestId('pending-comment-pin');
  await expect(pin).toHaveCount(1);
  const selectionId = await pin.getAttribute('data-selection-id');
  expect(selectionId).toMatch(/^map-selection-[0-9a-f-]{36}$/u);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  const result = await page.evaluate((id) => globalThis.__callWebMcpTool('consumeMapSelectionContexts', { selectionIds: [id] }), selectionId) as WebMcpToolResult;
  expect(result.success).toBe(true);
  expect(result.contexts).toMatchObject([{ comment: 'Please inspect the lake class.', scope: 'property-class' }]);
  await expect(pin).toHaveCount(0);

  const context = result.contexts?.[0];
  if (context === undefined) throw new Error('Consumed comment context is missing.');
  const mutation = await page.evaluate((layerId) => globalThis.__callWebMcpTool('applyStyleTransaction', {
    transaction: { operations: [{ op: 'setLayerProperties', layerId, paint: { 'fill-color': '#f97316' } }] },
    diff: true,
  }), context.feature.layerId) as WebMcpToolResult;
  expect(mutation.success).toBe(true);
  expect(mutation.data?.changedLayers).toEqual([context.feature.layerId]);

  const inspected = await page.evaluate((layerId) => globalThis.__callWebMcpTool('inspectStyle', {
    action: 'getLayer', layerId, fields: ['paint'],
  }), context.feature.layerId) as WebMcpToolResult;
  expect(inspected.success).toBe(true);
  expect(inspected.data?.projection?.value).toMatchObject({
    id: context.feature.layerId,
    paint: { 'fill-color': '#f97316' },
  });
});

export {};
