import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initialPopupState,
  normalizeCommentDraft,
  reducePopupState,
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

test('normalizes exact bounds and exposes disabled scope reasons', () => {
  assert.deepEqual(normalizeCommentDraft(' x '), { ok: true, value: 'x' });
  assert.equal(normalizeCommentDraft('x'.repeat(1_000)).ok, true);
  assert.equal(normalizeCommentDraft('x'.repeat(1_001)).ok, false);

  const options = scopeOptionsFor(candidate({ featureId: undefined, properties: {} }));
  assert.deepEqual(options.map(({ scope, enabled }) => [scope, enabled]), [
    ['feature', false], ['property-class', false], ['layer', true],
  ]);
  assert.match(options[0]?.disabledReason ?? '', /stable feature ID/u);
  assert.match(options[1]?.disabledReason ?? '', /scalar property/u);
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
