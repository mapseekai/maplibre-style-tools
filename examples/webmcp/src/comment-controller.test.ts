import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCommentModeControl,
  createMapCommentController,
  type CommentModeControl,
} from './comment-controller.js';
import { PendingMapCommentStore } from './comment-targets.js';
import type { CommentHighlightController } from './comment-highlight.js';

class TestElement extends EventTarget {
  className = '';
  type = '';
  disabled = false;
  title = '';
  readonly dataset: Record<string, string> = {};
  readonly children: TestElement[] = [];
  append(...children: TestElement[]): void { this.children.push(...children); }
  setAttribute(name: string, value: string): void { if (name === 'class') this.className = value; }
  remove(): void {}
}
import type { PendingCommentMarkerView } from './comment-markers.js';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { reduceCommentMode } from './comment-controller.js';

test('keeps comment mode after add or draft cancel and uses two-stage Escape', () => {
  assert.equal(reduceCommentMode('drafting', { type: 'add' }), 'comment-mode');
  assert.equal(reduceCommentMode('drafting', { type: 'escape' }), 'comment-mode');
  assert.equal(reduceCommentMode('comment-mode', { type: 'escape' }), 'idle');
});

test('renders a standard MapLibre control group with an interactive toggle', () => {
  const originalDocument = globalThis.document;
  const elements: TestElement[] = [];
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => { const element = new TestElement(); elements.push(element); return element; } },
  });
  try {
    let toggles = 0;
    const control = createCommentModeControl(() => { toggles += 1; });
    const button = elements[1]!;
    assert.equal(control.element.className, 'maplibregl-ctrl maplibregl-ctrl-group');
    assert.equal(button.className, 'maplibregl-ctrl-icon');
    assert.equal(button.disabled, true);
    control.setEnabled(true);
    button.dispatchEvent(new Event('click'));
    assert.equal(toggles, 1);
  } finally {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  }
});

test('resets comment mode for style replacement and abort', () => {
  assert.equal(reduceCommentMode('drafting', { type: 'style-replacement' }), 'comment-mode');
  assert.equal(reduceCommentMode('comment-mode', { type: 'reset' }), 'idle');
  assert.equal(reduceCommentMode('drafting', { type: 'abort' }), 'idle');
});

test('returns focus to the injected mode control when Escape leaves comment mode', () => {
  const originalDocument = globalThis.document;
  const documentEvents = new EventTarget();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentEvents });
  try {
    const calls: string[] = [];
    let toggle!: () => void;
    const control: CommentModeControl = {
      element: {} as HTMLElement,
      setEnabled() {},
      setActive() {},
      focus() { calls.push('control.focus'); },
      destroy() {},
    };
    const map = {
      addControl() {},
      removeControl() {},
      on() {},
      off() {},
    } as unknown as MapLibreMap;
    const controller = createMapCommentController({
      map,
      store: new PendingMapCommentStore({ capacity: 1, idFactory: () => 'selection-id' }),
      markers: { add() {}, remove() {}, clear() {}, destroy() {} },
      highlight: { show() {}, clear() {}, clearAll() {}, restore() {}, destroy() {} },
      status: { textContent: '' } as HTMLElement,
      signal: new AbortController().signal,
      createControl(onToggle) { toggle = onToggle; return control; },
    });

    controller.setEnabled(true);
    toggle();
    const escape = new Event('keydown');
    Object.defineProperty(escape, 'key', { value: 'Escape' });
    documentEvents.dispatchEvent(escape);

    assert.deepEqual(calls, ['control.focus']);
  } finally {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  }
});

test('cleans injected map dependencies and is idempotent on destroy', () => {
  const calls: string[] = [];
  let enabled = true;
  const control: CommentModeControl = {
    element: {} as HTMLElement,
    setEnabled(value) { enabled = value; },
    setActive() {},
    focus() {},
    destroy() { calls.push('control.destroy'); },
  };
  const map = {
    addControl() { calls.push('map.addControl'); },
    removeControl() { calls.push('map.removeControl'); },
    on() { calls.push('map.on'); },
    off() { calls.push('map.off'); },
  } as unknown as MapLibreMap;
  const markers: PendingCommentMarkerView = {
    add() {}, remove() { calls.push('markers.remove'); }, clear() { calls.push('markers.clear'); }, destroy() {},
  };
  const highlight: CommentHighlightController = {
    show() {}, clear() { calls.push('highlight.clear'); }, clearAll() { calls.push('highlight.clearAll'); }, restore() {}, destroy() {},
  };
  const store = new PendingMapCommentStore({
    capacity: 1, idFactory: () => 'selection-id', onRemove: (comment) => { calls.push('store.remove'); markers.remove(comment.selectionId); },
  });
  store.add({ comment: 'Keep me tidy', scope: 'layer', feature: {
    layerId: 'places', sourceId: 'source', lngLat: [0, 0], properties: {},
  } });
  const lifetime = new AbortController();
  const controller = createMapCommentController({
    map, store, markers, highlight, status: { textContent: '' } as HTMLElement, signal: lifetime.signal,
    createControl: () => control,
  });
  assert.equal(enabled, false);
  controller.clear();
  assert.equal(store.size, 0);
  assert.deepEqual(calls, [
    'map.addControl', 'map.on', 'highlight.clear', 'store.remove', 'markers.remove', 'highlight.clearAll',
  ]);

  calls.length = 0;
  controller.destroy();
  controller.destroy();
  assert.deepEqual(calls, [
    'highlight.clear', 'highlight.clearAll', 'map.off', 'map.removeControl', 'control.destroy',
  ]);
});

test('clears a live draft through the store removal path before clearing highlights', () => {
  const calls: string[] = [];
  let click!: (event: MapMouseEvent) => void;
  let toggle!: () => void;
  const control: CommentModeControl = {
    element: {} as HTMLElement,
    setEnabled() {},
    setActive() {},
    focus() {},
    destroy() {},
  };
  const map = {
    addControl() {},
    removeControl() {},
    on(_event: 'click', listener: (event: MapMouseEvent) => void) { click = listener; },
    off() {},
  } as unknown as MapLibreMap;
  const markers: PendingCommentMarkerView = {
    add() {}, remove() { calls.push('markers.remove'); }, clear() {}, destroy() {},
  };
  const highlight: CommentHighlightController = {
    show() {}, clear(scope) { calls.push(`highlight.clear:${scope}`); }, clearAll() { calls.push('highlight.clearAll'); }, restore() {}, destroy() {},
  };
  const store = new PendingMapCommentStore({
    capacity: 1,
    idFactory: () => 'selection-id',
    onRemove(comment) { calls.push('store.remove'); markers.remove(comment.selectionId); },
  });
  const controller = createMapCommentController({
    map,
    store,
    markers,
    highlight,
    status: { textContent: '' } as HTMLElement,
    signal: new AbortController().signal,
    pick: () => ({
      candidates: [{
        feature: { layerId: 'places', sourceId: 'source', lngLat: [0, 0], properties: {} },
        geometry: { type: 'Point', coordinates: [0, 0] },
        label: 'places',
      }],
      truncated: false,
    }),
    openPopup(options) {
      options.onAdd({
        comment: 'Keep my cleanup ordered.',
        scope: 'layer',
        feature: { layerId: 'places', sourceId: 'source', lngLat: [0, 0], properties: {} },
      }, { type: 'Point', coordinates: [0, 0] });
      return { close() { calls.push('popup.close'); } };
    },
    createControl(onToggle) { toggle = onToggle; return control; },
  });

  controller.setEnabled(true);
  toggle();
  click({ lngLat: { lng: 0, lat: 0 } } as MapMouseEvent);
  calls.length = 0;
  controller.clear();

  assert.deepEqual(calls, [
    'popup.close',
    'highlight.clear:draft',
    'store.remove',
    'markers.remove',
    'highlight.clearAll',
  ]);
});

test('keeps pending comments when popup preview creation fails', () => {
  const calls: string[] = [];
  let click!: (event: MapMouseEvent) => void;
  let toggle!: () => void;
  const store = new PendingMapCommentStore({
    capacity: 2,
    idFactory: () => 'selection-id',
    onRemove() { calls.push('store.remove'); },
  });
  const pending = store.add({
    comment: 'Existing pending comment',
    scope: 'layer',
    feature: { layerId: 'places', sourceId: 'source', lngLat: [0, 0], properties: {} },
  });
  createMapCommentController({
    map: {
      addControl() {},
      removeControl() {},
      on(_event: 'click', listener: (event: MapMouseEvent) => void) { click = listener; },
      off() {},
    } as unknown as MapLibreMap,
    store,
    markers: { add() {}, remove() {}, clear() {}, destroy() {} },
    highlight: { show() {}, clear(scope) { calls.push(`highlight.clear:${scope}`); }, clearAll() {}, restore() {}, destroy() {} },
    status: { textContent: '' } as HTMLElement,
    signal: new AbortController().signal,
    pick: () => ({
      candidates: [{
        feature: { layerId: 'places', sourceId: 'source', lngLat: [0, 0], properties: {} },
        geometry: { type: 'Point', coordinates: [0, 0] },
        label: 'places',
      }],
      truncated: false,
    }),
    openPopup() { throw new Error('preview failed'); },
    createControl(onToggle) {
      toggle = onToggle;
      return { element: {} as HTMLElement, setEnabled() {}, setActive() {}, focus() {}, destroy() {} };
    },
  }).setEnabled(true);

  toggle();
  click({ lngLat: { lng: 0, lat: 0 } } as MapMouseEvent);

  assert.equal(store.get(pending.selectionId), pending);
  assert.deepEqual(calls, ['highlight.clear:draft']);
});
