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
          { type: 'Feature', id: 1, properties: { class: 'water', name: 'Central Lake', visible: true, rank: 2 }, geometry: { type: 'Polygon', coordinates: [[[-8, -8], [8, -8], [8, 8], [-8, 8], [-8, -8]]] } },
          { type: 'Feature', properties: { class: 'district', name: 'Central District' }, geometry: { type: 'Polygon', coordinates: [[[-12, -12], [12, -12], [12, 12], [-12, 12], [-12, -12]]] } },
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

test('adds and consumes a map comment', async ({ page }) => {
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

  const map = page.getByTestId('map');
  const box = await map.boundingBox();
  if (box === null) throw new Error('map has no visible bounds');
  await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.getByRole('button', { name: 'places-fill · Central Lake' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Comment').fill('Please inspect the lake class.');
  await page.getByLabel('Scope').selectOption('property-class');
  await page.getByLabel('Property').selectOption('class');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const pin = page.getByTestId('pending-comment-pin');
  await expect(pin).toHaveCount(1);
  const selectionId = await pin.getAttribute('data-selection-id');
  expect(selectionId).toMatch(/^map-selection-[0-9a-f-]{36}$/u);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  const result = await page.evaluate((id) => globalThis.__callWebMcpTool('consumeMapSelectionContexts', { selectionIds: [id] }), selectionId);
  expect(result.success).toBe(true);
  expect(result.contexts).toMatchObject([{ comment: 'Please inspect the lake class.', scope: 'property-class' }]);
  await expect(pin).toHaveCount(0);
});

export {};
