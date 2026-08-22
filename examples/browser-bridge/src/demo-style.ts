import type {
  StyleDocument,
  StyleTransaction,
} from 'maplibre-style-tools/core';
import type { StyleSpecification } from 'maplibre-gl';

export const DEMO_STYLE: StyleDocument & StyleSpecification = {
  version: 8,
  sources: {
    places: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'park',
            geometry: { type: 'Point', coordinates: [-30, 15] },
            properties: { category: 'park', name: 'Park' },
          },
          {
            type: 'Feature',
            id: 'city',
            geometry: { type: 'Point', coordinates: [25, -10] },
            properties: { category: 'city', name: 'City' },
          },
        ],
      },
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#f4f1ea' },
    },
    {
      id: 'places',
      type: 'circle',
      source: 'places',
      paint: {
        'circle-color': '#168aad',
        'circle-radius': 7,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    },
  ],
};

export const filterDemoTransaction: StyleTransaction = {
  operations: [{
    op: 'setLayerFilter',
    layerId: 'countries-fill',
    mode: 'and',
    filter: ['==', ['get', 'name'], 'United States of America'],
  }],
};

export const duplicateDemoTransaction: StyleTransaction = {
  operations: [{
    op: 'duplicateLayer',
    layerId: 'countries-fill',
    newLayerId: 'countries-fill-highlight',
    overrides: {
      paint: {
        'fill-color': '#f97316',
        'fill-opacity': 0.55,
      },
    },
  }],
};

export const addGeoJsonDemoTransaction: StyleTransaction = {
  operations: [{
    op: 'addGeoJsonLayer',
    sourceId: 'local-events',
    layerId: 'local-events',
    type: 'circle',
    data: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [5, 20] },
        properties: { category: 'festival' },
      }],
    },
    paint: { 'circle-color': '#7c3aed', 'circle-radius': 8 },
  }],
};
