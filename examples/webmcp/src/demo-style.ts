import type { StyleDocument } from 'maplibre-style-tools/core';
import type { StyleSpecification } from 'maplibre-gl';

const features = [
  { id: 1, class: 'park', name: 'West Park', ring: [[-30, -10], [-10, -10], [-10, 10], [-30, 10], [-30, -10]] },
  { id: 2, class: 'water', name: 'Central Lake', ring: [[-8, -10], [8, -10], [8, 10], [-8, 10], [-8, -10]] },
  { id: 3, class: 'district', name: 'East District', ring: [[10, -10], [30, -10], [30, 10], [10, 10], [10, -10]] },
] as const;

export const DEMO_STYLE: StyleDocument & StyleSpecification = {
  version: 8,
  sources: {
    places: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: features.map(({ id, class: placeClass, name, ring }) => ({
          type: 'Feature' as const,
          id,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [ring.map(([longitude, latitude]) => [longitude, latitude])],
          },
          properties: { class: placeClass, name },
        })),
      },
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#e8f1f4' } },
    {
      id: 'places-fill',
      type: 'fill',
      source: 'places',
      paint: {
        'fill-color': [
          'match', ['get', 'class'],
          'park', '#4c956c',
          'water', '#2374ab',
          'district', '#e09f3e',
          '#85929e',
        ],
        'fill-opacity': 0.78,
      },
    },
    {
      id: 'places-outline',
      type: 'line',
      source: 'places',
      paint: { 'line-color': '#17324d', 'line-width': 2 },
    },
  ],
};

export const createDemoStyle = (): StyleDocument & StyleSpecification => structuredClone(DEMO_STYLE);
