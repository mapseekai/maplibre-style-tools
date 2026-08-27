import assert from 'node:assert/strict';
import test from 'node:test';

import { createMapCommentController, type CommentModeControl } from './comment-controller.js';
import { PendingMapCommentStore } from './comment-targets.js';
import type { CommentHighlightController } from './comment-highlight.js';
import type { PendingCommentMarkerView } from './comment-markers.js';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { reduceCommentMode } from './comment-controller.js';

test('keeps comment mode after add or draft cancel and uses two-stage Escape', () => {
  assert.equal(reduceCommentMode('drafting', { type: 'add' }), 'comment-mode');
  assert.equal(reduceCommentMode('drafting', { type: 'escape' }), 'comment-mode');
  assert.equal(reduceCommentMode('comment-mode', { type: 'escape' }), 'idle');
});

test('resets comment mode for style replacement and abort', () => {
  assert.equal(reduceCommentMode('drafting', { type: 'style-replacement' }), 'comment-mode');
  assert.equal(reduceCommentMode('comment-mode', { type: 'reset' }), 'idle');
  assert.equal(reduceCommentMode('drafting', { type: 'abort' }), 'idle');
});

test('starts disabled and cleans injected map dependencies on abort', () => {
  const calls: string[] = [];
  let enabled = true;
  const control: CommentModeControl = {
    element: {} as HTMLElement,
    setEnabled(value) { enabled = value; },
    setActive() {},
    destroy() { calls.push('control.destroy'); },
  };
  const map = {
    addControl() { calls.push('map.addControl'); },
    removeControl() { calls.push('map.removeControl'); },
    on() { calls.push('map.on'); },
    off() { calls.push('map.off'); },
  } as unknown as MapLibreMap;
  const markers: PendingCommentMarkerView = {
    add() {}, remove() {}, clear() { calls.push('markers.clear'); }, destroy() {},
  };
  const highlight: CommentHighlightController = {
    show() {}, clear() {}, clearAll() { calls.push('highlight.clearAll'); }, restore() {}, destroy() {},
  };
  const store = new PendingMapCommentStore({
    capacity: 1, idFactory: () => 'selection-id', onRemove: () => { calls.push('store.remove'); },
  });
  store.add({ comment: 'Keep me tidy', scope: 'layer', feature: {
    layerId: 'places', sourceId: 'source', lngLat: [0, 0], properties: {},
  } });
  const lifetime = new AbortController();
  createMapCommentController({
    map, store, markers, highlight, status: { textContent: '' } as HTMLElement, signal: lifetime.signal,
    createControl: () => control,
  });
  assert.equal(enabled, false);
  lifetime.abort();
  assert.equal(store.size, 0);
  assert.deepEqual(calls, [
    'map.addControl', 'map.on', 'store.remove', 'highlight.clearAll', 'map.off', 'map.removeControl', 'control.destroy',
  ]);
});
