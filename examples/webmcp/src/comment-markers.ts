import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';

import type { CommentHighlightController } from './comment-highlight.js';
import type { PendingMapComment } from './comment-targets.js';
import type { FeatureGeometry } from './feature-picker.js';

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

type Entry = { readonly marker: MapLibreMarker; readonly element: HTMLButtonElement; readonly geometry: FeatureGeometry; readonly abort: AbortController };

const summaryFor = (comment: PendingMapComment): string => {
  const selector = comment.scope === 'property-class' ? `; selector ${comment.selector.property} = ${String(comment.selector.value)}` : '';
  const sourceLayer = comment.feature.sourceLayer === undefined ? '' : `/${comment.feature.sourceLayer}`;
  return `Pending map comment ${comment.selectionId}: ${comment.comment}; ${comment.feature.layerId}; ${comment.feature.sourceId}${sourceLayer}; ${comment.scope}${selector}; location ${comment.feature.lngLat[0]}, ${comment.feature.lngLat[1]}.`;
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
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'pending-comment-pin';
      element.dataset.testid = 'pending-comment-pin';
      element.dataset.selectionId = comment.selectionId;
      element.textContent = String(++ordinal);
      element.setAttribute('aria-label', summaryFor(comment));
      const abort = new AbortController();
      const show = (): void => { options.highlight.show(comment.selectionId, geometry); };
      const clear = (): void => { options.highlight.clear(comment.selectionId); };
      element.addEventListener('mouseenter', show, { signal: abort.signal });
      element.addEventListener('focus', show, { signal: abort.signal });
      element.addEventListener('mouseleave', clear, { signal: abort.signal });
      element.addEventListener('blur', clear, { signal: abort.signal });
      element.addEventListener('click', () => { options.onCancel(comment.selectionId); }, { signal: abort.signal });
      const marker = options.createMarker(element).setLngLat([...comment.feature.lngLat]).addTo(options.map);
      entries.set(comment.selectionId, { marker, element, geometry, abort });
    },
    remove,
    clear() { for (const selectionId of [...entries.keys()]) remove(selectionId); },
    destroy() { if (!destroyed) { destroyed = true; for (const selectionId of [...entries.keys()]) remove(selectionId); } },
  };
};
