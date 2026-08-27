import { expect, test, type Page } from '@playwright/test';

type FakeTool = {
  readonly name: string;
  readonly execute: (
    input: Record<string, unknown>,
    options: { readonly signal: AbortSignal },
  ) => unknown | Promise<unknown>;
};

type WebMcpCallResult = Readonly<Record<string, unknown>> & {
  readonly success?: boolean;
  readonly consumed?: number;
  readonly contexts?: readonly Readonly<Record<string, unknown>>[];
};

declare global {
  // These globals exist only in Playwright pages after installFakeWebMcp runs.
  var __webmcpTools: Map<string, FakeTool>;
  var __callWebMcpTool: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<WebMcpCallResult>;
}

const installFakeWebMcp = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    type BrowserFakeTool = {
      name: string;
      execute(
        input: Record<string, unknown>,
        options: { signal: AbortSignal },
      ): unknown | Promise<unknown>;
    };
    const tools = new Map<string, BrowserFakeTool>();
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        async registerTool(
          tool: BrowserFakeTool,
          options: { signal?: AbortSignal } = {},
        ) {
          if (tools.has(tool.name)) throw new DOMException('duplicate', 'InvalidStateError');
          tools.set(tool.name, tool);
          options.signal?.addEventListener('abort', () => tools.delete(tool.name), { once: true });
        },
      },
    });
    Object.assign(globalThis, {
      __webmcpTools: tools,
      __callWebMcpTool: async (name: string, input: Record<string, unknown>) => {
        const tool = tools.get(name);
        if (tool === undefined) throw new Error(`Unknown WebMCP tool: ${name}`);
        return tool.execute(input, { signal: new AbortController().signal });
      },
    });
  });
};

const openSupportedExample = async (page: Page): Promise<void> => {
  await installFakeWebMcp(page);
  await page.goto('/');
  await expect(page.getByTestId('webmcp-support')).toHaveText(/available/u);
};

const selectCentralLake = async (page: Page): Promise<void> => {
  const map = page.getByTestId('map');
  const box = await map.boundingBox();
  if (box === null) throw new Error('map has no visible bounds');
  await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.getByRole('button', { name: 'places-fill · Central Lake' }).first().click();
  await expect(page.getByTestId('comment-target-status')).toContainText('Central Lake');
};

const addTarget = async (
  page: Page,
  scope: 'feature' | 'property-class' | 'layer',
): Promise<string> => {
  await page.getByLabel('Comment target scope').selectOption(scope);
  if (scope === 'property-class') {
    await page.getByLabel('Property value selector').selectOption('class');
  }
  await page.getByRole('button', { name: 'Add comment target' }).click();
  const cards = page.getByTestId('comment-target-card');
  const card = cards.nth(await cards.count() - 1);
  const selectionId = await card.getAttribute('data-selection-id');
  if (selectionId === null) throw new Error('comment target has no selection ID');
  return selectionId;
};

test('registers six tools and executes a read tool', async ({ page }) => {
  await openSupportedExample(page);
  await expect(page.getByTestId('registered-tools')).toContainText('consumeMapSelectionContexts');
  await expect.poll(() => page.evaluate(() => globalThis.__webmcpTools.size)).toBe(6);

  const result = await page.evaluate(() =>
    globalThis.__callWebMcpTool('inspectStyle', { action: 'getLayerCount' }));

  expect(result.success).toBe(true);
});

test('creates and consumes feature, class, and layer targets', async ({ page }) => {
  await openSupportedExample(page);
  await selectCentralLake(page);

  const removedId = await addTarget(page, 'feature');
  const removedCard = page.getByTestId('comment-target-card')
    .filter({ has: page.getByText(removedId, { exact: true }) });
  await expect(removedCard).toContainText('Scope: Single feature');
  await removedCard.getByRole('button', { name: `Remove unsubmitted target ${removedId}` }).click();
  await expect(removedCard).toHaveCount(0);

  const featureId = await addTarget(page, 'feature');
  const featureResult = await page.evaluate((id) =>
    globalThis.__callWebMcpTool('consumeMapSelectionContexts', { selectionIds: [id] }), featureId);
  expect(featureResult.success).toBe(true);
  expect(featureResult.consumed).toBe(1);
  expect(featureResult.contexts?.[0]?.scope).toBe('feature');
  await expect(page.getByTestId('comment-target-card')).toHaveCount(0);
  await expect(page.getByLabel(`Comment target ${featureId}`)).toHaveCount(0);

  const classId = await addTarget(page, 'property-class');
  const classCard = page.locator(`[data-selection-id="${classId}"]`);
  await expect(classCard).toContainText('Scope: Matching property value in this layer');
  await expect(classCard).toContainText('Selector: class=water');

  const layerId = await addTarget(page, 'layer');
  const layerCard = page.locator(`[data-selection-id="${layerId}"]`);
  await expect(layerCard).toContainText('Scope: All features in this layer');
  await expect(layerCard).toContainText('Selector: all features in layer');

  const batchResult = await page.evaluate(([first, second]) =>
    globalThis.__callWebMcpTool('consumeMapSelectionContexts', {
      selectionIds: [first, second],
    }), [classId, layerId] as const);
  expect(batchResult.success).toBe(true);
  expect(batchResult.consumed).toBe(2);
  expect(batchResult.contexts?.map((context) => context.scope)).toEqual([
    'property-class',
    'layer',
  ]);
  await expect(page.getByTestId('comment-target-card')).toHaveCount(0);
  await expect(page.locator('.comment-target-marker')).toHaveCount(0);
});

test('reset removes pending targets and restores the map', async ({ page }) => {
  await openSupportedExample(page);
  await selectCentralLake(page);
  await addTarget(page, 'property-class');
  await expect(page.getByTestId('comment-target-card')).toHaveCount(1);
  await expect(page.locator('.comment-target-marker')).toHaveCount(1);

  await page.getByTestId('reset-map').click();

  await expect(page.getByTestId('comment-target-card')).toHaveCount(0);
  await expect(page.locator('.comment-target-marker')).toHaveCount(0);
  await expect(page.getByTestId('map-layer-count')).toHaveText('3');
});

test('unsupported WebMCP keeps the real picker and reset UI usable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('webmcp-support')).toHaveText('Site tools unavailable');
  await expect(page.getByTestId('reset-map')).toBeEnabled();

  await selectCentralLake(page);
  await addTarget(page, 'layer');
  await expect(page.getByTestId('comment-target-card')).toHaveCount(1);
  await page.getByTestId('reset-map').click();

  await expect(page.getByTestId('comment-target-card')).toHaveCount(0);
  await expect(page.getByTestId('reset-map')).toBeEnabled();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
});

export {};
