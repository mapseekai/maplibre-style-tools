import type { IControl, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';

import type { CommentHighlightController } from './comment-highlight.js';
import { openCommentPopup, type CommentPopupHandle, type OpenCommentPopup } from './comment-popup.js';
import type { PendingCommentMarkerView } from './comment-markers.js';
import type { PendingMapCommentStore } from './comment-targets.js';
import { pickRenderedFeatures, type FeaturePickResult } from './feature-picker.js';

export type CommentModeState = 'idle' | 'comment-mode' | 'drafting';
export type CommentModeEvent =
  | { readonly type: 'toggle' }
  | { readonly type: 'map-click' }
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
  if (event.type === 'toggle') return state === 'idle' ? 'comment-mode' : 'idle';
  return state;
};

export interface MapCommentController {
  setEnabled(enabled: boolean, reason?: string): void;
  cancelDraftForStyleChange(): void;
  clear(): void;
  destroy(): void;
}

export interface CommentModeControl {
  readonly element: HTMLElement;
  setEnabled(enabled: boolean, reason?: string): void;
  setActive(active: boolean): void;
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
    if (state === 'drafting') { cancelDraft({ type: 'cancel' }); state = 'idle'; } else state = reduceCommentMode(state, { type: 'toggle' });
    render();
  };
  const control = (options.createControl ?? createCommentModeControl)(toggle);
  const mapControl: IControl = { onAdd: () => control.element, onRemove: () => control.destroy() };
  options.map.addControl(mapControl);
  const onClick = (event: MapMouseEvent): void => {
    if (!enabled || destroyed || state !== 'comment-mode' || popup !== undefined) return;
    let result: FeaturePickResult;
    try { result = pick(event); } catch { setStatus('Unable to choose a map feature.'); return; }
    if (result.candidates.length === 0) { setStatus('No commentable map feature was found there.'); return; }
    state = reduceCommentMode(state, { type: 'map-click' }); render();
    try {
      popup = openPopup({ map: options.map, candidates: result.candidates, truncated: result.truncated, lngLat: [event.lngLat.lng, event.lngLat.lat], highlight: options.highlight, signal: options.signal,
        onCancel: () => { popup = undefined; state = reduceCommentMode(state, { type: 'cancel' }); render(); },
        onAdd: (input, geometry) => {
          let added;
          try { added = options.store.add(input); options.markers.add(added, geometry); }
          catch {
            if (added !== undefined) options.store.remove(added.selectionId);
            return options.store.size >= 20 ? 'Submit or cancel an existing comment before adding another.' : 'Unable to add this map comment.';
          }
          popup = undefined; state = reduceCommentMode(state, { type: 'add' }); render(); setStatus('Map comment added.'); return undefined;
        },
      });
    } catch { popup = undefined; options.highlight.clear('draft'); state = reduceCommentMode(state, { type: 'cancel' }); render(); setStatus('Unable to preview that map feature.'); }
  };
  options.map.on('click', onClick);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !enabled || destroyed) return;
    event.preventDefault();
    if (state === 'drafting') cancelDraft({ type: 'cancel' });
    else { state = reduceCommentMode(state, { type: 'escape' }); render(); }
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
    cancelDraftForStyleChange() { if (!destroyed) cancelDraft({ type: 'style-replacement' }); },
    clear() { if (!destroyed) { cancelDraft({ type: 'abort' }); options.store.clear(); options.highlight.clearAll(); state = 'idle'; render(); } },
    destroy,
  };
};
