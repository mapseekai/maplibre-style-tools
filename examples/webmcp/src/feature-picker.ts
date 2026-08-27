import type { Map as MapLibreMap, MapGeoJSONFeature, MapMouseEvent } from 'maplibre-gl';

import type { FeatureReference } from './comment-targets.js';

type Scalar = string | number | boolean | null;

const MAX_CANDIDATES = 10;
const MAX_PROPERTIES = 20;
const MAX_PROPERTY_NAME_LENGTH = 80;
const MAX_STRING_LENGTH = 240;

const isScalar = (value: unknown): value is Scalar => value === null
  || typeof value === 'string'
  || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value));

const bounded = (value: string, length: number): string => value.slice(0, length);

const projectProperties = (properties: unknown): Readonly<Record<string, Scalar>> => {
  if (properties === null || typeof properties !== 'object') return Object.freeze({});
  const result: Record<string, Scalar> = {};
  for (const [name, value] of Object.entries(properties)) {
    if (Object.keys(result).length === MAX_PROPERTIES) break;
    if (!isScalar(value)) continue;
    const propertyName = bounded(name, MAX_PROPERTY_NAME_LENGTH);
    if (propertyName !== '') result[propertyName] = typeof value === 'string' ? bounded(value, MAX_STRING_LENGTH) : value;
  }
  return Object.freeze(result);
};

const projectFeature = (feature: MapGeoJSONFeature, lngLat: readonly [number, number]): FeatureReference | undefined => {
  const layerId = feature.layer?.id;
  const sourceId = feature.source;
  if (typeof layerId !== 'string' || layerId === '' || typeof sourceId !== 'string' || sourceId === '') return undefined;
  const featureId = typeof feature.id === 'string'
    ? (feature.id === '' ? undefined : bounded(feature.id, MAX_STRING_LENGTH))
    : typeof feature.id === 'number' && Number.isFinite(feature.id) ? feature.id : undefined;
  const sourceLayer = typeof feature.sourceLayer === 'string' && feature.sourceLayer !== ''
    ? bounded(feature.sourceLayer, MAX_PROPERTY_NAME_LENGTH)
    : undefined;
  return Object.freeze({
    layerId: bounded(layerId, MAX_PROPERTY_NAME_LENGTH),
    sourceId: bounded(sourceId, MAX_PROPERTY_NAME_LENGTH),
    ...(sourceLayer === undefined ? {} : { sourceLayer }),
    ...(featureId === undefined ? {} : { featureId }),
    lngLat: Object.freeze([lngLat[0], lngLat[1]]) as readonly [number, number],
    properties: projectProperties(feature.properties),
  });
};

export const pickRenderedFeatures = (
  map: MapLibreMap,
  event: MapMouseEvent,
): readonly FeatureReference[] => {
  const rendered = map.queryRenderedFeatures(event.point, {
    layers: map.getStyle().layers.map((layer) => layer.id),
  });
  const lngLat: readonly [number, number] = [event.lngLat.lng, event.lngLat.lat];
  const candidates: FeatureReference[] = [];
  for (const rawFeature of rendered) {
    if (candidates.length === MAX_CANDIDATES) break;
    const feature = projectFeature(rawFeature, lngLat);
    if (feature !== undefined) candidates.push(feature);
  }
  return Object.freeze(candidates);
};

export const featureLabel = (feature: FeatureReference): string => {
  const name = feature.properties.name;
  return `${feature.layerId} · ${typeof name === 'string' && name !== '' ? name : 'unnamed feature'}`;
};
