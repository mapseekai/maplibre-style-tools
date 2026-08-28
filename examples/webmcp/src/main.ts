import { hashStyle } from 'maplibre-style-tools/maplibre';
import { registerMapLibreWebMcpTools, resolveWebMcpModelContext, type MapLibreWebMcpRegistration } from 'maplibre-style-tools/webmcp';
import type { StyleDocument } from 'maplibre-style-tools/core';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { z } from 'zod';

import { createActivityLog } from './activity-log.js';
import { createMapCommentController, type MapCommentController } from './comment-controller.js';
import { createCommentHighlight } from './comment-highlight.js';
import { createPendingCommentMarkerView, pendingCommentSummary } from './comment-markers.js';
import { createCommentPanel, type CommentPanelView } from './comment-panel.js';
import { PendingMapCommentStore, type PendingMapCommentInput } from './comment-targets.js';
import { parseStyleJson, parseStyleUrl, styleForExport } from './style-loader.js';

const DEMO_STYLE_URL = 'https://demotiles.maplibre.org/style.json';

type StyleLoadSource = {
  on(event: 'style.load', listener: () => void): unknown;
  isStyleLoaded(): boolean | void;
};

export const enableCommentControllerForStyleLoad = (
  map: StyleLoadSource,
  onStyleLoad: () => void,
): void => {
  map.on('style.load', onStyleLoad);
  if (map.isStyleLoaded() === true) onStyleLoad();
};

export function renderWebMcpSupport(host: HTMLElement, registration: MapLibreWebMcpRegistration, toolCount = registration.toolNames.length, supported = registration.supported): void {
  host.textContent = supported ? `站点工具可用（${toolCount}）` : '站点工具不可用 · 本地预览';
}

type ModelContextToolRegistrar = { registerTool(tool: { readonly name: string; readonly title: string; readonly description: string; readonly inputSchema: Readonly<Record<string, unknown>>; readonly annotations: { readonly readOnlyHint: boolean; readonly untrustedContentHint: boolean }; readonly execute: (input: Record<string, unknown>, options: { readonly signal: AbortSignal }) => unknown | Promise<unknown> }, options?: { readonly signal?: AbortSignal }): Promise<void> };
const consumeSelectionIdsSchema = z.strictObject({ selectionIds: z.array(z.string().min(1).max(128)).min(1).max(20).refine((ids) => new Set(ids).size === ids.length, 'selectionIds must be unique').optional() });

export const registerMapSelectionConsumptionTool = async (modelContext: ModelContextToolRegistrar, store: PendingMapCommentStore, signal: AbortSignal): Promise<void> => modelContext.registerTool({
  name: 'consumeMapSelectionContexts', title: 'Consume map selection contexts',
  description: 'Read and remove the immutable map selection contexts referenced by submitted browser comments. Omit selectionIds to consume every submitted comment at once. Call this before applying map changes from those comments.',
  inputSchema: { type: 'object', properties: { selectionIds: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 128 } } }, additionalProperties: false },
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  execute: async (input) => {
    const parsed = consumeSelectionIdsSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: 'Selection context input is invalid.', error: { code: 'INVALID_INPUT', message: 'Selection context input is invalid.' } };
    if (parsed.data.selectionIds === undefined) {
      const contexts = store.consumeSubmitted();
      return { success: true, consumed: contexts.length, contexts };
    }
    try { const contexts = store.consumeMany(parsed.data.selectionIds); return { success: true, consumed: contexts.length, contexts }; }
    catch { return { success: false, message: 'A referenced selection context is unavailable.', error: { code: 'NOT_FOUND', message: 'A referenced selection context is unavailable.' } }; }
  },
}, { signal });

export const createWebMcpExampleLifetimes = (): { readonly page: AbortController; readonly tools: AbortController } => {
  const page = new AbortController(); const tools = new AbortController();
  page.signal.addEventListener('abort', () => tools.abort(), { once: true });
  return { page, tools };
};
export const registerCoreWebMcpToolsSafely = async (register: () => Promise<MapLibreWebMcpRegistration>, support: HTMLElement, toolsLifetime: AbortController): Promise<MapLibreWebMcpRegistration | undefined> => {
  try { return await register(); } catch { toolsLifetime.abort(); support.textContent = '站点工具注册失败'; return undefined; }
};
export const registerMapSelectionConsumptionToolSafely = async (modelContext: ModelContextToolRegistrar, store: PendingMapCommentStore, toolsLifetime: AbortController): Promise<boolean> => {
  try { await registerMapSelectionConsumptionTool(modelContext, store, toolsLifetime.signal); return true; } catch { toolsLifetime.abort(); return false; }
};

const requireElement = <T extends HTMLElement>(testId: string): T => {
  const element = document.querySelector(`[data-testid="${testId}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing WebMCP example element: ${testId}`);
  return element as T;
};
const renderToolGroups = (host: HTMLElement, toolNames: readonly string[]): void => {
  const readOnly = new Set(['inspectStyle', 'queryMapFeatures']);
  host.replaceChildren(...[['Read-only', toolNames.filter((name) => readOnly.has(name))], ['Map mutations', toolNames.filter((name) => !readOnly.has(name))]].flatMap(([label, names]) => (names as string[]).length === 0 ? [] : [Object.assign(document.createElement('h3'), { textContent: label }), Object.assign(document.createElement('p'), { textContent: (names as string[]).join(', ') })]));
};

const startWebMcpExample = async (): Promise<void> => {
  const [{ Map, Marker }, ,] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css'), import('./style.css')]);
  const { page: pageLifetime, tools: toolsLifetime } = createWebMcpExampleLifetimes();
  const activity = createActivityLog(requireElement('activity-log'), { capacity: 20 });
  const status = requireElement('comment-status');
  const error = requireElement('map-load-error');
  const retry = requireElement<HTMLButtonElement>('retry-map');
  const reset = requireElement<HTMLButtonElement>('reset-map');
  const support = requireElement('webmcp-support');
  const registeredTools = requireElement('registered-tools');
  const layerCount = requireElement('map-layer-count');
  const revision = requireElement('map-revision');
  const styleHash = requireElement('map-style-hash');
  requireElement('secure-context').textContent = window.isSecureContext ? '安全上下文' : '非安全上下文';
  const map = new Map({ container: 'map', style: DEMO_STYLE_URL, center: [0, 20], zoom: 1.5, attributionControl: {} });
  map.getCanvas().setAttribute('data-testid', 'map-canvas');
  const highlight = createCommentHighlight(map, pageLifetime.signal);
  const controllerRef: { current?: MapCommentController } = {};
  const markers = createPendingCommentMarkerView({
    map,
    highlight,
    createMarker: (element) => new Marker({ element }),
    onCancel: (selectionId) => { store.remove(selectionId); },
    onEdit: (comment) => controllerRef.current?.editComment(comment.selectionId),
  });
  const panelRef: { current?: CommentPanelView } = {};
  const store = new PendingMapCommentStore({
    capacity: 20,
    idFactory: () => `map-selection-${crypto.randomUUID()}`,
    onRemove: ({ selectionId }) => markers.remove(selectionId),
    onChange: () => panelRef.current?.render(),
  });
  const controller = createMapCommentController({ map, store, markers, highlight, status, signal: pageLifetime.signal });
  controllerRef.current = controller;
  const commentInputFor = (selectionId: string, comment: string): PendingMapCommentInput | undefined => {
    const existing = store.get(selectionId);
    if (existing === undefined) return undefined;
    if (existing.scope === 'feature') return { comment, scope: 'feature', feature: existing.feature };
    if (existing.scope === 'property-class') return { comment, scope: 'property-class', feature: existing.feature, selector: existing.selector };
    return { comment, scope: 'layer', feature: existing.feature };
  };
  const submitAll = (): void => {
    const submitted = store.submitAll();
    if (submitted.length === 0) { status.textContent = '没有待提交的评论。'; return; }
    markers.clear();
    const digest = submitted.map(pendingCommentSummary).join('\n');
    panelRef.current?.showDigest(digest);
    try { void navigator.clipboard?.writeText(digest); } catch { /* clipboard is best-effort */ }
    status.textContent = `已提交 ${submitted.length} 条评论 —— 摘要已选中并复制到剪贴板，可直接交给 ChatGPT 处理。`;
  };
  panelRef.current = createCommentPanel({
    store,
    onLocate: (selectionId) => markers.reveal(selectionId),
    onUpdate: (selectionId, comment) => {
      const input = commentInputFor(selectionId, comment);
      if (input === undefined) return '该评论已不存在。';
      try { markers.update(store.update(selectionId, input)); return undefined; }
      catch (failure) { return failure instanceof Error ? failure.message : String(failure); }
    },
    onRemove: (selectionId) => { store.remove(selectionId); },
    onSubmitAll: submitAll,
    signal: pageLifetime.signal,
  });
  requireElement('app-shell').append(panelRef.current.element);
  let loaded = false;
  let mapRevision = 0;
  let currentHash: string | undefined;
  let observation = 0;
  const updateMapDetails = async (): Promise<void> => {
    if (!map.isStyleLoaded()) return;
    const sequence = ++observation;
    const style = map.getStyle() as StyleDocument;
    const nextHash = await hashStyle(style);
    if (sequence !== observation) return;
    if (currentHash !== undefined && currentHash !== nextHash) mapRevision += 1;
    currentHash = nextHash; revision.textContent = String(mapRevision); styleHash.textContent = nextHash; layerCount.textContent = String(style.layers.length);
  };
  const onStyleLoad = (): void => {
    if (loaded) { controller.cancelDraftForStyleChange(); highlight.restore(); }
    loaded = true; error.hidden = true; controller.setEnabled(true); void updateMapDetails();
  };
  const onStyleData = (): void => { void updateMapDetails(); };
  // styledata can go quiet before isStyleLoaded() flips true after a style swap; idle is the settled signal.
  const onIdle = (): void => { void updateMapDetails(); };
  const onError = (): void => { if (!loaded && !map.isStyleLoaded()) { error.hidden = false; controller.setEnabled(false, '地图加载中。'); } };
  enableCommentControllerForStyleLoad(map, onStyleLoad); map.on('styledata', onStyleData); map.on('idle', onIdle); map.on('error', onError);
  retry.addEventListener('click', () => { error.hidden = true; controller.setEnabled(false, '地图加载中。'); map.setStyle(DEMO_STYLE_URL); }, { signal: pageLifetime.signal });
  reset.addEventListener('click', () => { activity.clear(); controller.clear(); controller.setEnabled(false, '地图加载中。'); map.setStyle(DEMO_STYLE_URL); status.textContent = '已重置为演示样式。'; }, { signal: pageLifetime.signal });
  const loadCustomStyle = (style: StyleDocument | string): void => {
    controller.clear();
    controller.setEnabled(false, '地图加载中。');
    status.textContent = '正在加载自定义样式…';
    if (typeof style === 'string') { map.setStyle(style); return; }
    // StyleDocument is a validated JSON-shaped StyleSpecification; MapLibre wants its own branded type.
    const specification = style as unknown as StyleSpecification;
    map.setStyle(specification);
  };
  requireElement<HTMLButtonElement>('load-style-url').addEventListener('click', () => {
    const parsed = parseStyleUrl(requireElement<HTMLInputElement>('style-url').value);
    if (!parsed.ok) { status.textContent = parsed.error; return; }
    loadCustomStyle(parsed.url);
  }, { signal: pageLifetime.signal });
  requireElement<HTMLButtonElement>('apply-style-json').addEventListener('click', () => {
    const parsed = parseStyleJson(requireElement<HTMLTextAreaElement>('style-json').value);
    if (!parsed.ok) { status.textContent = parsed.error; return; }
    loadCustomStyle(parsed.style);
  }, { signal: pageLifetime.signal });
  requireElement<HTMLButtonElement>('export-style-json').addEventListener('click', () => {
    const style = map.getStyle() as StyleDocument | undefined;
    if (style === undefined) { status.textContent = '样式尚未加载完成，暂无法导出。'; return; }
    const exported = styleForExport(style);
    const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'style.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = `已导出 style.json（${exported.layers.length} 个图层，包含当前全部修改）。`;
  }, { signal: pageLifetime.signal });
  window.addEventListener('pagehide', () => pageLifetime.abort(), { once: true, signal: pageLifetime.signal });
  pageLifetime.signal.addEventListener('abort', () => { controller.destroy(); markers.destroy(); highlight.destroy(); map.off('style.load', onStyleLoad); map.off('styledata', onStyleData); map.off('idle', onIdle); map.off('error', onError); }, { once: true });
  const registration = await registerCoreWebMcpToolsSafely(() => registerMapLibreWebMcpTools({ getMap: (): MapLibreMap => map, allowMutations: true, signal: toolsLifetime.signal, resourcePolicy: { baseUrl: document.baseURI, allowedResourceOrigins: [location.origin, 'https://demotiles.maplibre.org'] }, authorizeInvocation: () => true, onInvocation: (event) => activity.append(event) }), support, toolsLifetime);
  if (registration === undefined) { renderToolGroups(registeredTools, []); return; }
  let supported = registration.supported;
  let toolNames: readonly string[] = registration.toolNames;
  if (registration.supported) {
    const modelContext = resolveWebMcpModelContext();
    const customRegistered = modelContext === undefined
      ? (toolsLifetime.abort(), false)
      : await registerMapSelectionConsumptionToolSafely(modelContext, store, toolsLifetime);
    if (customRegistered) toolNames = [...registration.toolNames, 'consumeMapSelectionContexts'];
    else {
      supported = false; toolNames = [];
      support.textContent = '站点工具选择交接注册失败';
      renderToolGroups(registeredTools, toolNames);
      return;
    }
  }
  renderWebMcpSupport(support, registration, toolNames.length, supported);
  if (!supported) {
    const documentProbe = 'modelContext' in document ? '存在' : '缺失';
    const navigatorProbe = typeof navigator !== 'undefined' && 'modelContext' in navigator ? '存在' : '缺失';
    support.textContent += ` · document.modelContext：${documentProbe} · navigator.modelContext：${navigatorProbe} · ${window.isSecureContext ? '安全' : '非安全'}上下文 · 如刚更新请强制刷新（Ctrl+Shift+R）`;
  }
  renderToolGroups(registeredTools, toolNames);
};
if (typeof document !== 'undefined' && document.querySelector('[data-testid="map"]') !== null) void startWebMcpExample();
