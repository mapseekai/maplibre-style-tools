import assert from 'node:assert/strict';
import test from 'node:test';

import {
  focusPopupStage,
  initialPopupState,
  normalizeCommentDraft,
  reducePopupState,
  retainPopupStateAfterAddError,
  scopeOptionsFor,
} from './comment-popup.js';
import type { FeatureCandidate } from './feature-picker.js';

const candidate = (overrides: Partial<FeatureCandidate['feature']> = {}): FeatureCandidate => ({
  feature: {
    layerId: 'places-fill',
    sourceId: 'places',
    featureId: 1,
    lngLat: [0, 0],
    properties: { class: 'water', name: 'Central Lake' },
    ...overrides,
  },
  geometry: { type: 'Point', coordinates: [0, 0] },
  label: 'places-fill · Central Lake',
});

const roadCandidate = candidate({ featureId: 2, properties: { class: 'road', name: 'Main Street' } });
const waterCandidate = candidate();

test('accepts the exact comment bounds and rejects empty or oversized drafts', () => {
  assert.deepEqual(normalizeCommentDraft(' x '), { ok: true, value: 'x' });
  assert.equal(normalizeCommentDraft('x'.repeat(1_000)).ok, true);
  assert.equal(normalizeCommentDraft('').ok, false);
  assert.equal(normalizeCommentDraft('x'.repeat(1_001)).ok, false);

  const options = scopeOptionsFor(candidate({ featureId: undefined, properties: {} }));
  assert.deepEqual(options.map(({ scope, enabled }) => [scope, enabled]), [
    ['feature', false], ['property-class', false], ['layer', true],
  ]);
  assert.match(options[0]?.disabledReason ?? '', /稳定的要素 ID/u);
  assert.match(options[1]?.disabledReason ?? '', /标量属性/u);
});

test('requires explicit Next for overlapping candidates', () => {
  let state = initialPopupState([roadCandidate, waterCandidate]);
  assert.equal(state.step, 'candidate');
  state = reducePopupState(state, { type: 'choose', index: 1 });
  assert.equal(state.step, 'candidate');
  state = reducePopupState(state, { type: 'next' });
  assert.equal(state.step, 'draft');
  assert.equal(state.selectedIndex, 1);
});

test('initializes a single candidate directly at the draft', () => {
  const state = initialPopupState([waterCandidate]);
  assert.equal(state.step, 'draft');
  assert.equal(state.selectedIndex, 0);
});

test('focuses the selected candidate after opening and rerendering candidate stage', () => {
  const focused: string[] = [];
  const root = {
    querySelector(selector: string) {
      assert.equal(selector, '[data-popup-focus="candidate"]');
      return { focus: () => { focused.push('selected'); } };
    },
  };

  focusPopupStage(root, 'candidate');
  focusPopupStage(root, 'candidate');

  assert.deepEqual(focused, ['selected', 'selected']);
});

test('retains a failed add draft and restores its textarea focus', () => {
  let state = initialPopupState([roadCandidate, waterCandidate]);
  state = reducePopupState(state, { type: 'choose', index: 1 });
  state = reducePopupState(state, { type: 'next' });
  state = reducePopupState(state, { type: 'comment', value: 'Keep this comment' });
  state = reducePopupState(state, { type: 'scope', scope: 'property-class' });
  state = reducePopupState(state, { type: 'property', property: 'name' });
  state = retainPopupStateAfterAddError(state, 'Unable to add this map comment.');
  const focused: string[] = [];

  focusPopupStage({ querySelector: (selector: string) => {
    assert.equal(selector, '[data-popup-focus="draft"]');
    return { focus: () => { focused.push('textarea'); } };
  } }, state.step);

  assert.equal(state.selectedIndex, 1);
  assert.equal(state.comment, 'Keep this comment');
  assert.equal(state.scope, 'property-class');
  assert.equal(state.property, 'name');
  assert.equal(state.error, 'Unable to add this map comment.');
  assert.deepEqual(focused, ['textarea']);
});
