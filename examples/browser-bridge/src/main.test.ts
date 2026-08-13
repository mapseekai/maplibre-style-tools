import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConnectMapLibreBridgeOptions } from 'maplibre-style-tools/bridge';

import { renderExampleConnectionForm } from './connection-form.js';
import {
  DEMO_STYLE,
  addGeoJsonDemoTransaction,
  duplicateDemoTransaction,
  filterDemoTransaction,
} from './demo-style.js';

class FakeElement {
  readonly tagName: string;
  value = '';
  type = '';
  required = false;
  autocomplete = '';
  className = '';
  textContent: string | null = null;
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(tagName: string) { this.tagName = tagName.toUpperCase(); }
  append(...children: unknown[]): void { void children; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  click(): void { for (const listener of this.listeners.get('click') ?? []) listener(); }
}

const fakeDocument = (): Pick<Document, 'createElement'> => ({
  createElement: ((tagName: string) => new FakeElement(tagName)) as Document['createElement'],
});

test('example Style is self-contained and its demo operations are structured', () => {
  assert.equal(DEMO_STYLE.version, 8);
  assert.equal(DEMO_STYLE.glyphs, undefined);
  assert.equal(DEMO_STYLE.sprite, undefined);
  assert.equal(DEMO_STYLE.sources.places?.type, 'geojson');
  assert.equal(typeof DEMO_STYLE.sources.places?.data, 'object');
  assert.equal(filterDemoTransaction.operations[0]?.op, 'setLayerFilter');
  assert.equal(duplicateDemoTransaction.operations[0]?.op, 'duplicateLayer');
  assert.equal(addGeoJsonDemoTransaction.operations[0]?.op, 'addGeoJsonLayer');
  assert.equal(JSON.stringify(DEMO_STYLE).includes('http'), false);
});

test('connection form exposes the stable E2E selector/default/submit contract', () => {
  const calls: ConnectMapLibreBridgeOptions[] = [];
  const ui = renderExampleConnectionForm(fakeDocument(), (options) => { calls.push(options); });
  assert.equal(ui.getByTestId('bridge-map-id').value, 'demo-map');
  assert.equal(ui.getByTestId('bridge-url').tagName, 'INPUT');
  assert.equal(ui.getByTestId('bridge-token').getAttribute('type'), 'password');
  assert.equal(ui.getByTestId('bridge-token').type, 'password');
  ui.getByTestId('bridge-url').value = 'ws://127.0.0.1:7788';
  ui.getByTestId('bridge-token').value = 't'.repeat(32);
  ui.getByTestId('bridge-connect').click();
  assert.deepEqual(calls[0], {
    mapId: 'demo-map',
    url: 'ws://127.0.0.1:7788',
    token: 't'.repeat(32),
    capabilities: ['style.read', 'style.write', 'features.query', 'runtime.state'],
    allowedResourceOrigins: [],
  });
  assert.equal(ui.getByTestId('bridge-token').value, '');
});
