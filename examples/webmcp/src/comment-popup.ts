import { Popup, type Map as MapLibreMap } from 'maplibre-gl';

import type { CommentHighlightController } from './comment-highlight.js';
import type { PendingMapCommentInput, Scalar } from './comment-targets.js';
import { propertyOptionsFor, type FeatureCandidate, type FeatureGeometry } from './feature-picker.js';

export interface ScopeOption {
  readonly scope: PendingMapCommentInput['scope'];
  readonly label: string;
  readonly enabled: boolean;
  readonly disabledReason?: string;
}

export interface CommentPopupHandle { close(): void; }

export interface CommentPopupOptions {
  readonly map: MapLibreMap;
  readonly candidates: readonly FeatureCandidate[];
  readonly truncated: boolean;
  readonly lngLat: readonly [number, number];
  readonly highlight: CommentHighlightController;
  readonly signal: AbortSignal;
  readonly onAdd: (input: PendingMapCommentInput, geometry: FeatureGeometry) => string | undefined;
  readonly onCancel: () => void;
}

export type OpenCommentPopup = (options: CommentPopupOptions) => CommentPopupHandle;

export type PopupState = Readonly<{
  step: 'candidate' | 'draft';
  candidates: readonly FeatureCandidate[];
  selectedIndex: number;
  comment: string;
  scope: PendingMapCommentInput['scope'];
  property?: string;
  error?: string;
}>;

export type PopupEvent =
  | { readonly type: 'choose'; readonly index: number }
  | { readonly type: 'next' }
  | { readonly type: 'comment'; readonly value: string }
  | { readonly type: 'scope'; readonly scope: PendingMapCommentInput['scope'] }
  | { readonly type: 'property'; readonly property: string }
  | { readonly type: 'error'; readonly error?: string };

export const normalizeCommentDraft = (value: string): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: string } => {
  const normalized = value.trim();
  if (normalized.length === 0) return { ok: false, error: 'Enter a comment.' };
  if (normalized.length > 1_000) return { ok: false, error: 'Comment must not exceed 1,000 characters.' };
  return { ok: true, value: normalized };
};

export const scopeOptionsFor = (candidate: FeatureCandidate): readonly ScopeOption[] => {
  const properties = propertyOptionsFor(candidate.feature);
  return Object.freeze([
    Object.freeze({ scope: 'feature' as const, label: 'Feature', enabled: candidate.feature.featureId !== undefined,
      ...(candidate.feature.featureId === undefined ? { disabledReason: 'A stable feature ID is required.' } : {}) }),
    Object.freeze({ scope: 'property-class' as const, label: 'Property class', enabled: properties.length > 0,
      ...(properties.length === 0 ? { disabledReason: 'A scalar property is required.' } : {}) }),
    Object.freeze({ scope: 'layer' as const, label: 'Layer', enabled: true }),
  ]);
};

const initialScope = (candidate: FeatureCandidate): PendingMapCommentInput['scope'] =>
  scopeOptionsFor(candidate).find((option) => option.enabled)?.scope ?? 'layer';

export const initialPopupState = (candidates: readonly FeatureCandidate[]): PopupState => {
  if (candidates.length === 0) throw new RangeError('A comment popup requires at least one candidate.');
  const selected = candidates[0]!;
  const properties = propertyOptionsFor(selected.feature);
  return Object.freeze({
    step: candidates.length === 1 ? 'draft' : 'candidate', candidates: Object.freeze([...candidates]), selectedIndex: 0,
    comment: '', scope: initialScope(selected), ...(properties[0] === undefined ? {} : { property: properties[0].property }),
  });
};

export const reducePopupState = (state: PopupState, event: PopupEvent): PopupState => {
  if (event.type === 'choose') {
    if (state.step !== 'candidate' || event.index < 0 || event.index >= state.candidates.length) return state;
    const candidate = state.candidates[event.index]!;
    const property = propertyOptionsFor(candidate.feature)[0]?.property;
    return Object.freeze({ ...state, selectedIndex: event.index, scope: initialScope(candidate), ...(property === undefined ? { property: undefined } : { property }), error: undefined });
  }
  if (event.type === 'next') return state.step === 'candidate' ? Object.freeze({ ...state, step: 'draft', error: undefined }) : state;
  if (event.type === 'comment') return Object.freeze({ ...state, comment: event.value, error: undefined });
  if (event.type === 'scope') return scopeOptionsFor(state.candidates[state.selectedIndex]!).some((option) => option.scope === event.scope && option.enabled)
    ? Object.freeze({ ...state, scope: event.scope, error: undefined }) : state;
  if (event.type === 'property') return Object.freeze({ ...state, property: event.property, error: undefined });
  return event.error === undefined ? Object.freeze({ ...state, error: undefined }) : Object.freeze({ ...state, error: event.error });
};

export const retainPopupStateAfterAddError = (state: PopupState, error: string): PopupState =>
  reducePopupState(state, { type: 'error', error });

const append = <T extends HTMLElement>(parent: HTMLElement, child: T): T => { parent.append(child); return child; };
const button = (label: string): HTMLButtonElement => { const element = document.createElement('button'); element.type = 'button'; element.textContent = label; return element; };

export const focusPopupStage = (
  root: { querySelector(selector: string): { focus(): void } | null },
  step: PopupState['step'],
): void => {
  root.querySelector(`[data-popup-focus="${step === 'candidate' ? 'candidate' : 'draft'}"]`)?.focus();
};

export const openCommentPopup: OpenCommentPopup = (options) => {
  let state = initialPopupState(options.candidates);
  let closed = false;
  let attached = false;
  const root = document.createElement('section');
  root.className = 'comment-popup';
  root.setAttribute('aria-label', 'Add map comment');
  const popup = new Popup({ closeButton: false, closeOnClick: false, maxWidth: 'none' })
    .setLngLat([...options.lngLat])
    .setDOMContent(root);

  const onAbort = (): void => { close(); };
  const cleanup = (): void => { options.signal.removeEventListener('abort', onAbort); };
  const cancel = (): void => {
    if (closed) return;
    closed = true;
    cleanup();
    popup.remove();
    options.highlight.clear('draft');
    options.onCancel();
  };
  const close = (): void => { if (!closed) { closed = true; cleanup(); popup.remove(); options.highlight.clear('draft'); } };
  const selected = (): FeatureCandidate => state.candidates[state.selectedIndex]!;
  const render = (): void => {
    root.replaceChildren();
    const candidate = selected();
    options.highlight.show('draft', candidate.geometry);
    if (state.step === 'candidate') {
      const heading = append(root, document.createElement('h2')); heading.textContent = 'Choose a map feature';
      for (const [index, entry] of state.candidates.entries()) {
        const choice = button(entry.label); choice.setAttribute('aria-pressed', String(index === state.selectedIndex));
        if (index === state.selectedIndex) choice.dataset.popupFocus = 'candidate';
        choice.addEventListener('click', () => { state = reducePopupState(state, { type: 'choose', index }); render(); }); append(root, choice);
      }
      if (options.truncated) { const notice = append(root, document.createElement('p')); notice.textContent = 'Only the top matching features are shown.'; }
      const next = button('Next'); next.addEventListener('click', () => { state = reducePopupState(state, { type: 'next' }); render(); }); append(root, next);
    } else {
      const heading = append(root, document.createElement('h2')); heading.textContent = candidate.label;
      const textarea = append(root, document.createElement('textarea')); textarea.value = state.comment; textarea.maxLength = 1_001; textarea.setAttribute('aria-label', 'Comment'); textarea.dataset.popupFocus = 'draft';
      textarea.addEventListener('input', () => { state = reducePopupState(state, { type: 'comment', value: textarea.value }); });
      const scope = append(root, document.createElement('select')); scope.setAttribute('aria-label', 'Scope');
      for (const option of scopeOptionsFor(candidate)) { const item = append(scope, document.createElement('option')); item.value = option.scope; item.textContent = option.disabledReason === undefined ? option.label : `${option.label} — ${option.disabledReason}`; item.disabled = !option.enabled; item.selected = option.scope === state.scope; }
      scope.addEventListener('change', () => { state = reducePopupState(state, { type: 'scope', scope: scope.value as PendingMapCommentInput['scope'] }); render(); });
      const properties = propertyOptionsFor(candidate.feature);
      if (state.scope === 'property-class') { const selector = append(root, document.createElement('select')); selector.setAttribute('aria-label', 'Property'); for (const option of properties) { const item = append(selector, document.createElement('option')); item.value = option.property; item.textContent = option.label; item.selected = option.property === state.property; } selector.addEventListener('change', () => { state = reducePopupState(state, { type: 'property', property: selector.value }); }); }
      if (state.error !== undefined) { const error = append(root, document.createElement('p')); error.setAttribute('role', 'alert'); error.textContent = state.error; }
      const add = button('Add'); add.addEventListener('click', () => {
        const normalized = normalizeCommentDraft(state.comment); if (!normalized.ok) { state = reducePopupState(state, { type: 'error', error: normalized.error }); render(); return; }
        const feature = candidate.feature;
        const input: PendingMapCommentInput | undefined = state.scope === 'feature' && feature.featureId !== undefined
          ? { comment: normalized.value, scope: 'feature', feature: { ...feature, featureId: feature.featureId } }
          : state.scope === 'property-class'
            ? (() => { const property = properties.find((entry) => entry.property === state.property); return property === undefined ? undefined : { comment: normalized.value, scope: 'property-class' as const, feature, selector: { property: property.property, value: property.value as Scalar } }; })()
            : { comment: normalized.value, scope: 'layer', feature };
        if (input === undefined) { state = reducePopupState(state, { type: 'error', error: 'Choose a scalar property.' }); render(); return; }
        const error = options.onAdd(input, candidate.geometry); if (error === undefined) close(); else { state = retainPopupStateAfterAddError(state, error); render(); }
      }); append(root, add);
      focusPopupStage(root, 'draft');
    }
    append(root, (() => { const element = button('Cancel'); element.addEventListener('click', cancel); return element; })());
    if (state.step === 'candidate') focusPopupStage(root, 'candidate');
    if (attached) popup.setLngLat([...options.lngLat]);
  };
  root.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } });
  options.signal.addEventListener('abort', onAbort, { once: true });
  if (options.signal.aborted) close();
  else {
    try {
      render();
      popup.addTo(options.map);
      attached = true;
      popup.setLngLat([...options.lngLat]);
      focusPopupStage(root, state.step);
    }
    catch (error) { close(); throw error; }
  }
  return { close };
};
