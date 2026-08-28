import type { IControl, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';

import type { CommentHighlightController } from './comment-highlight.js';
import { openCommentPopup, type CommentPopupHandle, type OpenCommentPopup } from './comment-popup.js';
import type { PendingCommentMarkerView } from './comment-markers.js';
import type { PendingMapCommentStore } from './comment-targets.js';
import { featureLabel, pickRenderedFeatures, type FeaturePickResult } from './feature-picker.js';

export type CommentModeState = 'idle' | 'comment-mode' | 'drafting';
export type CommentModeEvent =
  | { readonly type: 'toggle' }
  | { readonly type: 'map-click' }
  | { readonly type: 'edit' }
  | { readonly type: 'add' }
  | { readonly type: 'cancel' }
  | { readonly type: 'escape' }
  | { readonly type: 'style-replacement' }
  | { readonly type: 'reset' }
  | { readonly type: 'abort' };

export const reduceCommentMode = (state: CommentModeState, event: CommentModeEvent): CommentModeState => {
  if (event.type === 'abort' || event.type === 'reset') return 'idle';
  if (event.type === 'style-replacement') return state === 'drafting' ? 'comment-mode' : state;
  if (event.type === 'add' || event.type === 'cancel' || (event.type === 'escape' && state === 'drafting')) return state === 'drafting' ? 'comment-mode' : state;
  if (event.type === 'escape') return state === 'comment-mode' ? 'idle' : state;
  if (event.type === 'map-click') return state === 'comment-mode' ? 'drafting' : state;
  if (event.type === 'edit') return 'drafting';
  if (event.type === 'toggle') return state === 'idle' ? 'comment-mode' : 'idle';
  return state;
};

export interface MapCommentController {
  setEnabled(enabled: boolean, reason?: string): void;
  cancelDraftForStyleChange(): void;
  editComment(selectionId: string): void;
  clear(): void;
  destroy(): void;
}

export interface CommentModeControl {
  readonly element: HTMLElement;
  setEnabled(enabled: boolean, reason?: string): void;
  setActive(active: boolean): void;
  focus(): void;
  destroy(): void;
}

export interface MapCommentControllerOptions {
  readonly map: MapLibreMap;
  readonly store: PendingMapCommentStore;
  readonly markers: PendingCommentMarkerView;
  readonly highlight: CommentHighlightController;
  readonly status: HTMLElement;
  readonly signal: AbortSignal;
  readonly pick?: (event: MapMouseEvent) => FeaturePickResult;
  readonly openPopup?: OpenCommentPopup;
  readonly createControl?: (onToggle: () => void) => CommentModeControl;
}

export type CreateMapCommentController = (options: MapCommentControllerOptions) => MapCommentController;

export const createCommentModeControl = (onToggle: () => void): CommentModeControl => {
  const element = document.createElement('div');
  element.className = 'maplibregl-ctrl maplibregl-ctrl-group';
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'maplibregl-ctrl-icon'; button.setAttribute('aria-label', 'Add map comment');
  button.setAttribute('aria-pressed', 'false'); button.dataset.testid = 'comment-mode-toggle'; button.disabled = true;
  button.addEventListener('click', onToggle);
  element.append(button);
  return {
    element,
    setEnabled(enabled, reason) { button.disabled = !enabled; button.title = enabled ? '' : reason ?? ''; },
    setActive(active) { button.setAttribute('aria-pressed', String(active)); },
    focus() { button.focus(); },
    destroy() { button.removeEventListener('click', onToggle); element.remove(); },
  };
};

export const createMapCommentController: CreateMapCommentController = (options) => {
  let enabled = false;
  let destroyed = false;
  let state: CommentModeState = 'idle';
  let popup: CommentPopupHandle | undefined;
  const pick = options.pick ?? ((event: MapMouseEvent) => pickRenderedFeatures(options.map, event));
  const openPopup = options.openPopup ?? openCommentPopup;
  const setStatus = (message: string): void => { options.status.textContent = message; };
  const render = (): void => { control.setActive(state !== 'idle'); };
  const cancelDraft = (event: Extract<CommentModeEvent, { type: 'cancel' | 'style-replacement' | 'abort' }>): void => {
    popup?.close(); popup = undefined; options.highlight.clear('draft'); state = reduceCommentMode(state, event); render();
  };
  const toggle = (): void => {
    if (!enabled || destroyed) return;
    const leavingCommentMode = state === 'comment-mode';
    if (state === 'drafting') { cancelDraft({ type: 'cancel' }); state = 'idle'; } else state = reduceCommentMode(state, { type: 'toggle' });
    render();
    if (leavingCommentMode) control.focus();
  };
  const control = (options.createControl ?? createCommentModeControl)(toggle);
  const mapControl: IControl = { onAdd: () => control.element, onRemove: () => control.destroy() };
  options.map.addControl(mapControl);
  const onClick = (event: MapMouseEvent): void => {
    if (!enabled || destroyed) return;
    if (state === 'drafting' && popup !== undefined) {
      // A draft with content is protected; an empty draft yields to the new click location.
      if (popup.hasContent()) return;
      popup.close();
      popup = undefined;
      state = reduceCommentMode(state, { type: 'cancel' });
      render();
    }
    if (state !== 'comment-mode' || popup !== undefined) return;
    let result: FeaturePickResult;
    try { result = pick(event); } catch { setStatus('无法选择地图要素。'); return; }
    if (result.candidates.length === 0) { setStatus('该位置没有可评论的地图要素。'); return; }
    state = reduceCommentMode(state, { type: 'map-click' }); render();
    try {
      popup = openPopup({ map: options.map, candidates: result.candidates, truncated: result.truncated, lngLat: [event.lngLat.lng, event.lngLat.lat], highlight: options.highlight, signal: options.signal,
        onCancel: () => { popup = undefined; state = reduceCommentMode(state, { type: 'cancel' }); render(); options.map.getCanvas().focus(); },
        onAdd: (input, geometry) => {
          let added;
          try { added = options.store.add(input); options.markers.add(added, geometry); }
          catch {
            if (added !== undefined) options.store.remove(added.selectionId);
            return options.store.size >= 20 ? '评论数量已达上限，请先提交或删除现有评论。' : '无法添加该评论。';
          }
          popup = undefined; state = reduceCommentMode(state, { type: 'add' }); render(); setStatus('评论已添加。'); return undefined;
        },
      });
    } catch { popup = undefined; options.highlight.clear('draft'); state = reduceCommentMode(state, { type: 'cancel' }); render(); setStatus('无法预览该地图要素。'); }
    if (popup !== undefined) setStatus('');
  };
  const settleEdit = (): void => { popup = undefined; state = reduceCommentMode(state, { type: 'cancel' }); render(); };
  const editComment = (selectionId: string): void => {
    if (!enabled || destroyed) return;
    const existing = options.store.get(selectionId);
    if (existing === undefined || options.store.isSubmitted(selectionId)) return;
    const geometry = options.markers.geometryOf(selectionId);
    if (geometry === undefined) return;
    cancelDraft({ type: 'cancel' });
    state = reduceCommentMode(state, { type: 'edit' });
    render();
    try {
      popup = openPopup({
        map: options.map,
        candidates: [{ feature: existing.feature, geometry, label: featureLabel(existing.feature) }],
        truncated: false,
        lngLat: [existing.feature.lngLat[0], existing.feature.lngLat[1]],
        edit: existing,
        highlight: options.highlight,
        signal: options.signal,
        onAdd: () => '该弹窗处于编辑模式。',
        onSave: (input) => {
          try { options.markers.update(options.store.update(selectionId, input)); }
          catch (failure) { return failure instanceof Error ? failure.message : String(failure); }
          popup = undefined; state = reduceCommentMode(state, { type: 'add' }); render(); setStatus('评论已更新。'); return undefined;
        },
        onDelete: () => { options.store.remove(selectionId); settleEdit(); setStatus('评论已删除。'); },
        onCancel: () => { settleEdit(); options.map.getCanvas().focus(); },
      });
    } catch { popup = undefined; options.highlight.clear('draft'); settleEdit(); setStatus('无法打开该评论。'); }
  };
  options.map.on('click', onClick);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.key !== 'Escape' || !enabled || destroyed) return;
    event.preventDefault();
    if (state === 'drafting') cancelDraft({ type: 'cancel' });
    else {
      const leavingCommentMode = state === 'comment-mode';
      state = reduceCommentMode(state, { type: 'escape' });
      render();
      if (leavingCommentMode) control.focus();
    }
  };
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true; cancelDraft({ type: 'abort' }); options.store.clear(); options.highlight.clearAll(); options.map.off('click', onClick); if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown); options.map.removeControl(mapControl); control.destroy();
  };
  options.signal.addEventListener('abort', destroy, { once: true });
  control.setEnabled(false);
  return {
    setEnabled(next, reason) { if (destroyed) return; enabled = next; if (!enabled) { cancelDraft({ type: 'cancel' }); state = 'idle'; } control.setEnabled(enabled, reason); render(); if (reason !== undefined) setStatus(reason); },
    editComment,
    cancelDraftForStyleChange() { if (!destroyed) cancelDraft({ type: 'style-replacement' }); },
    clear() { if (!destroyed) { cancelDraft({ type: 'abort' }); options.store.clear(); options.highlight.clearAll(); state = 'idle'; render(); } },
    destroy,
  };
};
