import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';

import { highlightTargetFor, type CommentHighlightController } from './comment-highlight.js';
import type { PendingMapComment } from './comment-targets.js';
import { featureLabel, type FeatureGeometry } from './feature-picker.js';

export interface PendingCommentMarkerView {
  add(comment: PendingMapComment, geometry: FeatureGeometry): void;
  update(comment: PendingMapComment): void;
  reveal(selectionId: string): void;
  geometryOf(selectionId: string): FeatureGeometry | undefined;
  remove(selectionId: string): void;
  clear(): void;
  destroy(): void;
}

export interface PendingCommentMarkerViewOptions {
  readonly map: MapLibreMap;
  readonly highlight: CommentHighlightController;
  readonly createMarker: (element: HTMLElement) => MapLibreMarker;
  readonly onCancel: (selectionId: string) => void;
  /** Pin click opens the shared popup in edit mode when provided. */
  readonly onEdit?: (comment: PendingMapComment) => void;
}

type Entry = {
  readonly marker: MapLibreMarker;
  readonly element: HTMLElement;
  readonly geometry: FeatureGeometry;
  readonly abort: AbortController;
  comment: PendingMapComment;
  expand(): void;
};

export type PendingCommentMarkerState = Readonly<{
  readonly persistentOpen: boolean;
  readonly interactionOpen: boolean;
  readonly expanded: boolean;
}>;

export type PendingCommentMarkerEvent = { readonly type: 'enter' | 'leave' | 'activate' };

export const initialPendingCommentMarkerState = (): PendingCommentMarkerState => Object.freeze({
  persistentOpen: false,
  interactionOpen: false,
  expanded: false,
});

export const reducePendingCommentMarkerState = (
  state: PendingCommentMarkerState,
  event: PendingCommentMarkerEvent,
): PendingCommentMarkerState => {
  if (event.type === 'enter') return Object.freeze({ ...state, interactionOpen: true, expanded: true });
  if (event.type === 'leave') return Object.freeze({
    ...state, interactionOpen: false, expanded: state.persistentOpen,
  });
  const persistentOpen = !state.persistentOpen;
  return Object.freeze({ persistentOpen, interactionOpen: false, expanded: persistentOpen });
};

export const pendingCommentSummary = (comment: PendingMapComment): string => {
  const selector = comment.scope === 'property-class' ? `；选择器 ${comment.selector.property} = ${String(comment.selector.value)}` : '';
  const featureId = comment.scope === 'feature' ? `；要素 ID ${String(comment.feature.featureId)}` : '';
  const sourceLayer = comment.feature.sourceLayer === undefined ? '' : `/${comment.feature.sourceLayer}`;
  const scopeText = comment.scope === 'feature' ? '要素' : comment.scope === 'property-class' ? '属性类' : '图层';
  return `待处理评论 ${comment.selectionId}：${comment.comment}；${featureLabel(comment.feature)}；图层 ${comment.feature.layerId}；数据源 ${comment.feature.sourceId}${sourceLayer}；范围 ${scopeText}${featureId}${selector}；位置 ${comment.feature.lngLat[0]}, ${comment.feature.lngLat[1]}。`;
};

export const createPendingCommentMarkerView = (options: PendingCommentMarkerViewOptions): PendingCommentMarkerView => {
  const entries = new Map<string, Entry>();
  let destroyed = false;
  /** Pins are always numbered 1..N in insertion order. */
  const renumber = (): void => {
    let index = 0;
    for (const entry of entries.values()) {
      index += 1;
      const pin = entry.element.querySelector('.pending-comment-pin');
      if (pin !== null) pin.textContent = String(index);
    }
  };
  const remove = (selectionId: string): void => {
    const entry = entries.get(selectionId);
    if (entry === undefined) return;
    entries.delete(selectionId);
    entry.abort.abort();
    entry.marker.remove();
    entry.element.remove();
    options.highlight.clear(selectionId);
    renumber();
  };
  return {
    add(comment, geometry) {
      if (destroyed) throw new Error('Pending comment markers have been destroyed.');
      if (entries.has(comment.selectionId)) throw new Error(`Pending comment marker already exists: ${comment.selectionId}`);
      const element = document.createElement('div');
      element.className = 'pending-comment-marker';
      element.dataset.selectionId = comment.selectionId;
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'pending-comment-pin';
      pin.dataset.testid = 'pending-comment-pin';
      pin.dataset.selectionId = comment.selectionId;
      pin.setAttribute('aria-label', pendingCommentSummary(comment));
      pin.setAttribute('aria-expanded', 'false');
      const summary = document.createElement('article');
      summary.className = 'pending-comment-summary';
      summary.hidden = true;
      const text = document.createElement('p');
      text.className = 'pending-comment-text';
      text.textContent = pendingCommentSummary(comment);
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn-danger btn-compact';
      cancel.textContent = '删除';
      cancel.setAttribute('aria-label', `删除评论 ${comment.selectionId}`);
      summary.append(text, cancel);
      element.append(pin, summary);
      const abort = new AbortController();
      let state = initialPendingCommentMarkerState();
      const renderInteraction = (): void => {
        summary.hidden = !state.expanded;
        pin.setAttribute('aria-expanded', String(state.expanded));
        if (state.expanded) options.highlight.show(comment.selectionId, highlightTargetFor(comment.feature, geometry));
        else options.highlight.clear(comment.selectionId);
      };
      const transition = (event: PendingCommentMarkerEvent): void => {
        state = reducePendingCommentMarkerState(state, event);
        renderInteraction();
      };
      element.addEventListener('mouseenter', () => { transition({ type: 'enter' }); }, { signal: abort.signal });
      element.addEventListener('focusin', () => { transition({ type: 'enter' }); }, { signal: abort.signal });
      element.addEventListener('mouseleave', () => { transition({ type: 'leave' }); }, { signal: abort.signal });
      element.addEventListener('focusout', (event) => {
        if (!element.contains(event.relatedTarget as Node | null)) transition({ type: 'leave' });
      }, { signal: abort.signal });
      pin.addEventListener('click', (event) => {
        event.stopPropagation();
        if (options.onEdit === undefined) { transition({ type: 'activate' }); return; }
        state = initialPendingCommentMarkerState();
        renderInteraction();
        options.onEdit(comment);
      }, { signal: abort.signal });
      cancel.addEventListener('click', (event) => { event.stopPropagation(); options.onCancel(comment.selectionId); }, { signal: abort.signal });
      const marker = options.createMarker(element).setLngLat([...comment.feature.lngLat]).addTo(options.map);
      entries.set(comment.selectionId, {
        marker, element, geometry, abort, comment,
        expand: () => {
          state = Object.freeze({ persistentOpen: true, interactionOpen: false, expanded: true });
          renderInteraction();
        },
      });
      renumber();
    },
    geometryOf(selectionId) {
      return entries.get(selectionId)?.geometry;
    },
    update(next) {
      const entry = entries.get(next.selectionId);
      if (entry === undefined) return;
      entry.comment = next;
      const summaryText = pendingCommentSummary(next);
      entry.element.querySelector('.pending-comment-pin')?.setAttribute('aria-label', summaryText);
      const textNode = entry.element.querySelector('.pending-comment-text');
      if (textNode !== null) textNode.textContent = summaryText;
    },
    reveal(selectionId) {
      const entry = entries.get(selectionId);
      if (entry === undefined) return;
      options.map.easeTo({ center: [...entry.comment.feature.lngLat] });
      entry.expand();
      const pin = entry.element.querySelector('.pending-comment-pin');
      if (pin instanceof HTMLElement) pin.focus();
    },
    remove,
    clear() { for (const selectionId of [...entries.keys()]) remove(selectionId); },
    destroy() { if (!destroyed) { destroyed = true; for (const selectionId of [...entries.keys()]) remove(selectionId); } },
  };
};
