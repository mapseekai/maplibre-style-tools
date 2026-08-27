import type { Map as MapLibreMap, MapGeoJSONFeature, MapMouseEvent } from 'maplibre-gl';

import {
  isBoundedIdentity,
  type FeatureReference,
  type Scalar,
} from './comment-targets.js';

export type FeatureGeometry = MapGeoJSONFeature['geometry'];

export interface FeatureCandidate {
  readonly feature: FeatureReference;
  readonly geometry: FeatureGeometry;
  readonly label: string;
}

export interface FeaturePickResult {
  readonly candidates: readonly FeatureCandidate[];
  readonly truncated: boolean;
}

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
    if (name.length === 0 || name.length > MAX_PROPERTY_NAME_LENGTH) continue;
    result[name] = typeof value === 'string' ? bounded(value, MAX_STRING_LENGTH) : value;
  }
  return Object.freeze(result);
};

const projectFeature = (
  rawFeature: MapGeoJSONFeature,
  lngLat: readonly [number, number],
): FeatureCandidate | undefined => {
  const layerId = rawFeature.layer?.id;
  const sourceId = rawFeature.source;
  if (!isBoundedIdentity(layerId, MAX_PROPERTY_NAME_LENGTH) || !isBoundedIdentity(sourceId, MAX_PROPERTY_NAME_LENGTH)) return undefined;
  if (rawFeature.sourceLayer !== undefined && !isBoundedIdentity(rawFeature.sourceLayer, MAX_PROPERTY_NAME_LENGTH)) return undefined;
  const featureId = isBoundedIdentity(rawFeature.id, MAX_STRING_LENGTH)
    ? rawFeature.id
    : typeof rawFeature.id === 'number' && Number.isFinite(rawFeature.id) ? rawFeature.id : undefined;
  const sourceLayer = rawFeature.sourceLayer === undefined
    ? undefined
    : rawFeature.sourceLayer;
  const feature = Object.freeze({
    layerId,
    sourceId,
    ...(sourceLayer === undefined ? {} : { sourceLayer }),
    ...(featureId === undefined ? {} : { featureId }),
    lngLat: Object.freeze([lngLat[0], lngLat[1]]) as readonly [number, number],
    properties: projectProperties(rawFeature.properties),
  });
  return Object.freeze({
    feature,
    geometry: rawFeature.geometry,
    label: featureLabel(feature),
  });
};

const candidateKey = (candidate: FeatureCandidate): string => {
  const { feature, geometry } = candidate;
  const identity = [feature.layerId, feature.sourceId, feature.sourceLayer ?? null];
  return feature.featureId !== undefined
    ? JSON.stringify([...identity, 'id', feature.featureId])
    : JSON.stringify([
      ...identity,
      'geometry', geometry,
      'properties', Object.entries(feature.properties).sort(([left], [right]) => left.localeCompare(right)),
    ]);
};

export const pickRenderedFeatures = (
  map: MapLibreMap,
  event: MapMouseEvent,
): FeaturePickResult => {
  const rendered = map.queryRenderedFeatures(event.point);
  const lngLat: readonly [number, number] = [event.lngLat.lng, event.lngLat.lat];
  const candidates: FeatureCandidate[] = [];
  const candidateKeys = new Set<string>();
  for (const rawFeature of rendered) {
    const candidate = projectFeature(rawFeature, lngLat);
    if (candidate === undefined) continue;
    const key = candidateKey(candidate);
    if (candidateKeys.has(key)) continue;
    if (candidates.length === MAX_CANDIDATES) {
      return Object.freeze({
        candidates: Object.freeze(candidates),
        truncated: true,
      });
    }
    candidateKeys.add(key);
    candidates.push(candidate);
  }
  return Object.freeze({
    candidates: Object.freeze(candidates),
    truncated: false,
  });
};
export const propertyOptionsFor = (
  feature: FeatureReference,
): readonly { readonly property: string; readonly value: Scalar; readonly label: string }[] => Object.freeze(
  Object.entries(feature.properties)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([property, value]) => Object.freeze({ property, value, label: `${property} = ${String(value)}` })),
);
export const featureLabel = (feature: FeatureReference): string => {
  const name = feature.properties.name;
  return `${feature.layerId} · ${typeof name === 'string' && name !== '' ? name : 'unnamed feature'}`;
};
