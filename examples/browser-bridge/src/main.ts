import { Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import {
  connectMapLibreBridge,
  type ConnectMapLibreBridgeOptions,
  type MapLibreBridgeConnection,
} from 'maplibre-style-tools/bridge';
import type { StyleTransaction } from 'maplibre-style-tools/core';
import { applyTransactionToMap } from 'maplibre-style-tools/maplibre';

import { renderExampleConnectionForm } from './connection-form.js';
import {
  addGeoJsonDemoTransaction,
  duplicateDemoTransaction,
  filterDemoTransaction,
} from './demo-style.js';

const requireElement = <ElementType extends HTMLElement>(testId: string): ElementType => {
  const element = document.querySelector(`[data-testid="${testId}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing example element: ${testId}`);
  return element as ElementType;
};

const map = new Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [0, 0],
  zoom: 1,
  attributionControl: false,
});
map.getCanvas().setAttribute('data-testid', 'map-canvas');

const status = requireElement('bridge-status');
const mapId = requireElement('map-id');
const revision = requireElement('revision');
const styleHash = requireElement('style-hash');
const lastOperation = requireElement('last-operation');
let activeConnection: MapLibreBridgeConnection | undefined;

const projectConnection = (connection: MapLibreBridgeConnection): void => {
  status.textContent = connection.status;
  const snapshot = connection.snapshot();
  revision.textContent = String(snapshot.revision);
  styleHash.textContent = snapshot.styleHash;
};

const connect = (options: ConnectMapLibreBridgeOptions): MapLibreBridgeConnection => {
  activeConnection?.close();
  mapId.textContent = options.mapId;
  status.textContent = 'authenticating';
  const connection = connectMapLibreBridge(map, options);
  activeConnection = connection;
  connection.subscribe(() => { projectConnection(connection); });
  void connection.whenReady().then(
    () => { projectConnection(connection); },
    () => { status.textContent = 'terminal'; },
  );
  return connection;
};

const form = renderExampleConnectionForm(document, connect);
const formHost = document.querySelector('#bridge-form');
if (!(formHost instanceof HTMLElement)) throw new Error('Missing bridge form host');
formHost.append(form.element);

const wireDemo = (
  testId: string,
  transaction: StyleTransaction,
  successText: string,
): void => {
  const button = requireElement<HTMLButtonElement>(testId);
  button.addEventListener('click', () => {
    button.disabled = true;
    void applyTransactionToMap(map, transaction, { timeoutMs: 10_000 }).then((result) => {
      if (result.ok) {
        lastOperation.textContent = successText;
        return;
      }
      button.disabled = false;
      lastOperation.textContent = `failed: ${result.error.code}`;
    });
  });
};

wireDemo('demo-filter', filterDemoTransaction, 'filter composed');
wireDemo('demo-duplicate', duplicateDemoTransaction, 'layer duplicated');
wireDemo('demo-add-geojson', addGeoJsonDemoTransaction, 'GeoJSON layer added');
