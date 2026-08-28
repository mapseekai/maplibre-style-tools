import { Popup, type Map as MapLibreMap } from 'maplibre-gl';

import { highlightTargetFor, type CommentHighlightController } from './comment-highlight.js';
import type { PendingMapComment, PendingMapCommentInput, Scalar } from './comment-targets.js';
import { propertyOptionsFor, type FeatureCandidate, type FeatureGeometry } from './feature-picker.js';

export interface ScopeOption {
  readonly scope: PendingMapCommentInput['scope'];
  readonly label: string;
  readonly enabled: boolean;
  readonly disabledReason?: string;
}

export interface CommentPopupHandle {
  close(): void;
  /** True when the draft textarea holds non-whitespace content. */
  hasContent(): boolean;
}

export interface CommentPopupOptions {
  readonly map: MapLibreMap;
  readonly candidates: readonly FeatureCandidate[];
  readonly truncated: boolean;
  readonly lngLat: readonly [number, number];
  readonly highlight: CommentHighlightController;
  readonly signal: AbortSignal;
  /** Present → edit an existing pending comment instead of drafting a new one. */
  readonly edit?: PendingMapComment;
  readonly onAdd: (input: PendingMapCommentInput, geometry: FeatureGeometry) => string | undefined;
  readonly onSave?: (input: PendingMapCommentInput) => string | undefined;
  readonly onDelete?: () => void;
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
  if (normalized.length === 0) return { ok: false, error: '请输入评论内容。' };
  if (normalized.length > 1_000) return { ok: false, error: '评论内容不能超过 1,000 字。' };
  return { ok: true, value: normalized };
};

export const scopeOptionsFor = (candidate: FeatureCandidate): readonly ScopeOption[] => {
  const properties = propertyOptionsFor(candidate.feature);
  return Object.freeze([
    Object.freeze({ scope: 'feature' as const, label: '要素', enabled: candidate.feature.featureId !== undefined,
      ...(candidate.feature.featureId === undefined ? { disabledReason: '需要稳定的要素 ID。' } : {}) }),
    Object.freeze({ scope: 'property-class' as const, label: '属性类', enabled: properties.length > 0,
      ...(properties.length === 0 ? { disabledReason: '需要标量属性。' } : {}) }),
    Object.freeze({ scope: 'layer' as const, label: '图层', enabled: true }),
  ]);
};

const initialScope = (candidate: FeatureCandidate): PendingMapCommentInput['scope'] =>
  scopeOptionsFor(candidate).find((option) => option.enabled)?.scope ?? 'layer';

export const initialPopupState = (candidates: readonly FeatureCandidate[], edit?: PendingMapComment): PopupState => {
  if (candidates.length === 0) throw new RangeError('A comment popup requires at least one candidate.');
  const selected = candidates[0]!;
  const properties = propertyOptionsFor(selected.feature);
  if (edit !== undefined) {
    return Object.freeze({
      step: 'draft', candidates: Object.freeze([...candidates]), selectedIndex: 0,
      comment: edit.comment,
      scope: scopeOptionsFor(selected).some((option) => option.scope === edit.scope && option.enabled) ? edit.scope : initialScope(selected),
      ...(edit.scope === 'property-class'
        ? { property: edit.selector.property }
        : properties[0] === undefined ? {} : { property: properties[0].property }),
    });
  }
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

const buildInput = (state: PopupState, candidate: FeatureCandidate, comment: string): PendingMapCommentInput | undefined => {
  const feature = candidate.feature;
  if (state.scope === 'feature') {
    return feature.featureId === undefined
      ? undefined
      : { comment, scope: 'feature', feature: { ...feature, featureId: feature.featureId } };
  }
  if (state.scope === 'property-class') {
    const property = propertyOptionsFor(feature).find((entry) => entry.property === state.property);
    return property === undefined
      ? undefined
      : { comment, scope: 'property-class', feature, selector: { property: property.property, value: property.value as Scalar } };
  }
  return { comment, scope: 'layer', feature };
};

const append = <T extends HTMLElement>(parent: HTMLElement, child: T): T => { parent.append(child); return child; };
const actionButton = (label: string, className: string): HTMLButtonElement => {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  return element;
};
const fieldLabel = (root: HTMLElement, text: string, control: HTMLElement): void => {
  const label = append(root, document.createElement('label'));
  label.className = 'popup-field';
  const caption = document.createElement('span');
  caption.className = 'popup-field-label';
  caption.textContent = text;
  label.append(caption, control);
};

export const focusPopupStage = (
  root: { querySelector(selector: string): { focus(): void } | null },
  step: PopupState['step'],
): void => {
  root.querySelector(`[data-popup-focus="${step === 'candidate' ? 'candidate' : 'draft'}"]`)?.focus();
};

export const openCommentPopup: OpenCommentPopup = (options) => {
  const edit = options.edit;
  let state = initialPopupState(options.candidates, edit);
  let closed = false;
  let attached = false;
  const root = document.createElement('section');
  root.className = 'comment-popup';
  root.setAttribute('aria-label', edit === undefined ? '添加地图评论' : '编辑地图评论');
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

  const renderCandidateStep = (): void => {
    const heading = append(root, document.createElement('h2'));
    heading.textContent = '选择地图要素';
    const list = append(root, document.createElement('div'));
    list.className = 'candidate-list';
    for (const [index, entry] of state.candidates.entries()) {
      const choice = actionButton(entry.label, 'candidate-choice');
      choice.setAttribute('aria-pressed', String(index === state.selectedIndex));
      if (index === state.selectedIndex) choice.dataset.popupFocus = 'candidate';
      choice.addEventListener('click', () => { state = reducePopupState(state, { type: 'choose', index }); render(); });
      append(list, choice);
    }
    if (options.truncated) {
      const notice = append(root, document.createElement('p'));
      notice.className = 'popup-notice';
      notice.textContent = '仅显示前几个匹配要素。';
    }
    const actions = append(root, document.createElement('div'));
    actions.className = 'popup-actions';
    const next = actionButton('下一步', 'btn-primary btn-compact');
    next.addEventListener('click', () => { state = reducePopupState(state, { type: 'next' }); render(); });
    const cancelButton = actionButton('取消', 'btn-secondary btn-compact');
    cancelButton.addEventListener('click', cancel);
    actions.append(next, cancelButton);
  };

  const renderDraftStep = (): void => {
    const candidate = selected();
    const eyebrow = append(root, document.createElement('p'));
    eyebrow.className = 'popup-eyebrow';
    eyebrow.textContent = edit === undefined ? '添加评论' : '编辑评论';
    const heading = append(root, document.createElement('h2'));
    heading.textContent = candidate.label;

    const textarea = document.createElement('textarea');
    textarea.value = state.comment;
    textarea.maxLength = 1_001;
    textarea.placeholder = '写下这条评论…';
    textarea.setAttribute('aria-label', '评论内容');
    textarea.dataset.popupFocus = 'draft';
    textarea.addEventListener('input', () => { state = reducePopupState(state, { type: 'comment', value: textarea.value }); });
    fieldLabel(root, '评论内容', textarea);

    const scope = document.createElement('select');
    scope.setAttribute('aria-label', '应用范围');
    for (const option of scopeOptionsFor(candidate)) {
      const item = append(scope, document.createElement('option'));
      item.value = option.scope;
      item.textContent = option.disabledReason === undefined ? option.label : `${option.label} — ${option.disabledReason}`;
      item.disabled = !option.enabled;
      item.selected = option.scope === state.scope;
    }
    scope.addEventListener('change', () => { state = reducePopupState(state, { type: 'scope', scope: scope.value as PendingMapCommentInput['scope'] }); render(); });
    fieldLabel(root, '应用范围', scope);

    if (state.scope === 'property-class') {
      const selector = document.createElement('select');
      selector.setAttribute('aria-label', '属性');
      for (const option of propertyOptionsFor(candidate.feature)) {
        const item = append(selector, document.createElement('option'));
        item.value = option.property;
        item.textContent = option.label;
        item.selected = option.property === state.property;
      }
      selector.addEventListener('change', () => { state = reducePopupState(state, { type: 'property', property: selector.value }); });
      fieldLabel(root, '属性', selector);
    }

    if (state.error !== undefined) {
      const error = append(root, document.createElement('p'));
      error.setAttribute('role', 'alert');
      error.textContent = state.error;
    }

    const actions = append(root, document.createElement('div'));
    actions.className = 'popup-actions';
    const submit = actionButton(edit === undefined ? '添加' : '保存', 'btn-primary btn-compact');
    submit.addEventListener('click', () => {
      const normalized = normalizeCommentDraft(state.comment);
      if (!normalized.ok) { state = reducePopupState(state, { type: 'error', error: normalized.error }); render(); return; }
      const input = buildInput(state, candidate, normalized.value);
      if (input === undefined) { state = reducePopupState(state, { type: 'error', error: '请选择一个标量属性。' }); render(); return; }
      const failure = edit === undefined
        ? options.onAdd(input, candidate.geometry)
        : options.onSave?.(input);
      if (failure === undefined) close();
      else { state = retainPopupStateAfterAddError(state, failure); render(); }
    });
    actions.append(submit);
    if (edit !== undefined && options.onDelete !== undefined) {
      const remove = actionButton('删除', 'btn-danger btn-compact');
      remove.addEventListener('click', () => { close(); options.onDelete?.(); });
      actions.append(remove);
    }
    const cancelButton = actionButton('取消', 'btn-secondary btn-compact');
    cancelButton.addEventListener('click', cancel);
    actions.append(cancelButton);
    focusPopupStage(root, 'draft');
  };

  const render = (): void => {
    root.replaceChildren();
    const candidate = selected();
    options.highlight.show('draft', highlightTargetFor(candidate.feature, candidate.geometry));
    if (state.step === 'candidate') renderCandidateStep();
    else renderDraftStep();
    if (attached) popup.setLngLat([...options.lngLat]);
    if (state.step === 'candidate') focusPopupStage(root, 'candidate');
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
  return { close, hasContent: () => state.comment.trim() !== '' };
};
