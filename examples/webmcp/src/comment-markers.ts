import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';

import type { CommentHighlightController } from './comment-highlight.js';
import type { PendingMapComment } from './comment-targets.js';
import { featureLabel, type FeatureGeometry } from './feature-picker.js';

export interface PendingCommentMarkerView {
  add(comment: PendingMapComment, geometry: FeatureGeometry): void;
  remove(selectionId: string): void;
  clear(): void;
  destroy(): void;
}

export interface PendingCommentMarkerViewOptions {
  readonly map: MapLibreMap;
  readonly highlight: CommentHighlightController;
  readonly createMarker: (element: HTMLElement) => MapLibreMarker;
  readonly onCancel: (selectionId: string) => void;
}

type Entry = { readonly marker: MapLibreMarker; readonly element: HTMLElement; readonly geometry: FeatureGeometry; readonly abort: AbortController };

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
  const selector = comment.scope === 'property-class' ? `; selector ${comment.selector.property} = ${String(comment.selector.value)}` : '';
  const featureId = comment.scope === 'feature' ? `; feature ID ${String(comment.feature.featureId)}` : '';
  const sourceLayer = comment.feature.sourceLayer === undefined ? '' : `/${comment.feature.sourceLayer}`;
  return `Pending map comment ${comment.selectionId}: ${comment.comment}; ${featureLabel(comment.feature)}; ${comment.feature.layerId}; ${comment.feature.sourceId}${sourceLayer}; ${comment.scope}${featureId}${selector}; location ${comment.feature.lngLat[0]}, ${comment.feature.lngLat[1]}.`;
};

export const createPendingCommentMarkerView = (options: PendingCommentMarkerViewOptions): PendingCommentMarkerView => {
  const entries = new Map<string, Entry>();
  let ordinal = 0;
  let destroyed = false;
  const remove = (selectionId: string): void => {
    const entry = entries.get(selectionId);
    if (entry === undefined) return;
    entries.delete(selectionId);
    entry.abort.abort();
    entry.marker.remove();
    entry.element.remove();
    options.highlight.clear(selectionId);
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
      pin.textContent = String(++ordinal);
      pin.setAttribute('aria-label', pendingCommentSummary(comment));
      pin.setAttribute('aria-expanded', 'false');
      const summary = document.createElement('article');
      summary.className = 'pending-comment-summary';
      summary.hidden = true;
      summary.textContent = pendingCommentSummary(comment);
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel pending comment';
      cancel.setAttribute('aria-label', `Cancel pending comment ${comment.selectionId}`);
      summary.append(cancel);
      element.append(pin, summary);
      const abort = new AbortController();
      let state = initialPendingCommentMarkerState();
      const renderInteraction = (): void => {
        summary.hidden = !state.expanded;
        pin.setAttribute('aria-expanded', String(state.expanded));
        if (state.expanded) options.highlight.show(comment.selectionId, geometry);
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
        transition({ type: 'activate' });
      }, { signal: abort.signal });
      cancel.addEventListener('click', (event) => { event.stopPropagation(); options.onCancel(comment.selectionId); }, { signal: abort.signal });
      const marker = options.createMarker(element).setLngLat([...comment.feature.lngLat]).addTo(options.map);
      entries.set(comment.selectionId, { marker, element, geometry, abort });
    },
    remove,
    clear() { for (const selectionId of [...entries.keys()]) remove(selectionId); },
    destroy() { if (!destroyed) { destroyed = true; for (const selectionId of [...entries.keys()]) remove(selectionId); } },
  };
};
