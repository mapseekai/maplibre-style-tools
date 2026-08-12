/// <reference types="geojson" preserve="true" />

import type {
  LayerSpecification, SourceSpecification, StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { StyleToolErrorCode } from './errors.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export type GeoJsonPosition = [number, number, ...number[]];
export type GeoJsonBbox2D = [number, number, number, number];
export type GeoJsonBbox3D = [number, number, number, number, number, number];
export type GeoJsonBbox = GeoJsonBbox2D | GeoJsonBbox3D;
export type GeoJsonLineCoordinates = [
  GeoJsonPosition, GeoJsonPosition, ...GeoJsonPosition[],
];
export type GeoJsonLinearRing = [
  GeoJsonPosition,
  GeoJsonPosition,
  GeoJsonPosition,
  GeoJsonPosition,
  ...GeoJsonPosition[],
];
export type GeoJsonPolygonCoordinates = GeoJsonLinearRing[];

export type GeoJsonPoint = JsonObject & {
  type: 'Point';
  coordinates: GeoJsonPosition;
  bbox?: GeoJsonBbox;
};
export type GeoJsonMultiPoint = JsonObject & {
  type: 'MultiPoint';
  coordinates: GeoJsonPosition[];
  bbox?: GeoJsonBbox;
};
export type GeoJsonLineString = JsonObject & {
  type: 'LineString';
  coordinates: GeoJsonLineCoordinates;
  bbox?: GeoJsonBbox;
};
export type GeoJsonMultiLineString = JsonObject & {
  type: 'MultiLineString';
  coordinates: GeoJsonLineCoordinates[];
  bbox?: GeoJsonBbox;
};
export type GeoJsonPolygon = JsonObject & {
  type: 'Polygon';
  coordinates: GeoJsonPolygonCoordinates;
  bbox?: GeoJsonBbox;
};
export type GeoJsonMultiPolygon = JsonObject & {
  type: 'MultiPolygon';
  coordinates: GeoJsonPolygonCoordinates[];
  bbox?: GeoJsonBbox;
};
export type GeoJsonGeometryCollection = JsonObject & {
  type: 'GeometryCollection';
  geometries: GeoJsonGeometry[];
  bbox?: GeoJsonBbox;
};
export type GeoJsonGeometry =
  | GeoJsonPoint
  | GeoJsonMultiPoint
  | GeoJsonLineString
  | GeoJsonMultiLineString
  | GeoJsonPolygon
  | GeoJsonMultiPolygon
  | GeoJsonGeometryCollection;

export type GeoJsonFeatureId = string | number;
export type GeoJsonFeature<
  G extends GeoJsonGeometry | null = GeoJsonGeometry | null,
> = JsonObject & {
  type: 'Feature';
  id?: GeoJsonFeatureId;
  geometry: G;
  properties: JsonObject | null;
  bbox?: GeoJsonBbox;
};
export type GeoJsonFeatureCollection = JsonObject & {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
  bbox?: GeoJsonBbox;
};

export interface GeoJsonLimits {
  maxBytes: number;
  maxFeatures: number;
  maxCoordinatePositions: number;
  maxGeometryDepth: number;
  maxPropertyDepth: number;
}

export type InlineGeoJson = GeoJsonFeature | GeoJsonFeatureCollection | GeoJsonGeometry;
export type InlineGeoJsonValidationResult =
  | {
      ok: true;
      value: InlineGeoJson;
      featureCount: number;
      coordinatePositionCount: number;
    }
  | { ok: false; error: StyleToolError };

export type GeoJsonGeometryType =
  | 'Point'
  | 'MultiPoint'
  | 'LineString'
  | 'MultiLineString'
  | 'Polygon'
  | 'MultiPolygon'
  | 'GeometryCollection';
export type GeoJsonPropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'array'
  | 'object';
export type GeoJsonGeometryCounts = Partial<Record<GeoJsonGeometryType, number>>;

export interface GeoJsonPropertyAnalysis {
  name: string;
  types: GeoJsonPropertyType[];
  numericRange?: { min: number; max: number };
  topValues?: Array<{
    value: string | number | boolean | null;
    count: number;
  }>;
}

export interface GeoJsonAnalysisOptions {
  topValueLimit?: number;
  limits?: Partial<GeoJsonLimits>;
}

export type GeoJsonAnalysisInput = InlineGeoJson | string;
export type GeoJsonAnalysisUnavailable = {
  available: false;
  reason: 'remote-url';
  warnings: StyleWarning[];
};
export type GeoJsonAnalysisAvailable = {
  available: true;
  featureCount: number;
  geometryTypes: GeoJsonGeometryCounts;
  bbox?: [number, number, number, number];
  properties: GeoJsonPropertyAnalysis[];
  warnings: StyleWarning[];
};
export type GeoJsonAnalysis =
  | GeoJsonAnalysisUnavailable
  | GeoJsonAnalysisAvailable;
export type GeoJsonAnalysisResult =
  | { ok: true; analysis: GeoJsonAnalysis }
  | { ok: false; error: StyleToolError };

type IsAny<T> = 0 extends (1 & T) ? true : false;
type JsonKnownValue<T> = IsAny<T> extends true ? JsonValue
  : T extends undefined ? never
    : T extends JsonPrimitive ? T
      : T extends readonly JsonPrimitive[] ? T
        : T extends readonly unknown[] ? JsonValue[]
          : T extends object ? JsonObject
            : JsonValue;
type JsonKnownObject<T extends object> = T extends unknown
  ? JsonObject & { [K in keyof T]: JsonKnownValue<T[K]> }
  : never;

export type StyleLayer = JsonKnownObject<LayerSpecification>;
export type StyleSource = JsonKnownObject<SourceSpecification>;
export type StyleDocument = JsonKnownObject<
  Omit<StyleSpecification, 'sources' | 'layers'>
> & {
  sources: Record<string, StyleSource>;
  layers: StyleLayer[];
};

export type LayerSummary = {
  id: string;
  type: string;
  source?: string;
  sourceLayer?: string;
  minzoom?: number;
  maxzoom?: number;
  visibility?: JsonValue;
};
export type StyleContextOptions = {
  activeSourceId?: string | null;
  selectedLayerId?: string | null;
  layerLimit?: number;
};
export type StyleContext = {
  activeSourceId?: string | null;
  selectedLayerId?: string | null;
  layerCount: number;
  sourceCount: number;
  layerTypes: Record<string, number>;
  layers: LayerSummary[];
};
export type LayerSearchQuery = {
  query?: string;
  type?: string;
  source?: string;
  sourceLayer?: string;
  limit?: number;
};
export type LayerSearchResult = {
  layers: LayerSummary[];
  total: number;
};
export type SourceLayerUsage = {
  sourceId: string;
  sourceLayer: string;
  layers: Array<{ id: string; type: string }>;
};
export type ListSourceLayersOptions = { sourceId?: string };

export type SetLayerPropertiesOperation = {
  op: 'setLayerProperties';
  layerId: string;
  paint?: Record<string, JsonValue | null>;
  layout?: Record<string, JsonValue | null>;
  metadata?: Record<string, JsonValue | null> | null;
  minzoom?: number | null;
  maxzoom?: number | null;
};
export type Placement = {
  beforeId?: string;
  afterId?: string;
};
export type DuplicateLayerOperation = Placement & {
  op: 'duplicateLayer';
  layerId: string;
  newLayerId: string;
  overrides?: JsonObject;
};
export type MoveLayerOperation = Placement & {
  op: 'moveLayer';
  layerId: string;
};
export type ReorderLayersOperation = Placement & {
  op: 'reorderLayers';
  layerIds: string[];
};
export type RemoveLayerOperation = {
  op: 'removeLayer';
  layerId: string;
};
export type AddLayerFromSourceOperation = Placement & {
  op: 'addLayerFromSource';
  layerId: string;
  sourceId: string;
  sourceLayer?: string;
  type: string;
  paint?: JsonObject;
  layout?: JsonObject;
  filter?: JsonValue[];
  minzoom?: number;
  maxzoom?: number;
  metadata?: JsonObject;
};
export type AddGeoJsonLayerOperation = Placement & {
  op: 'addGeoJsonLayer';
  sourceId: string;
  layerId: string;
  data: InlineGeoJson | string;
  sourceOptions?: JsonObject;
  type: 'fill' | 'line' | 'symbol' | 'circle' | 'heatmap' | 'fill-extrusion';
  paint?: JsonObject;
  layout?: JsonObject;
  filter?: JsonValue[];
  minzoom?: number;
  maxzoom?: number;
  metadata?: JsonObject;
};
export type LayerLifecycleOperation =
  | DuplicateLayerOperation
  | MoveLayerOperation
  | ReorderLayersOperation
  | RemoveLayerOperation
  | AddLayerFromSourceOperation
  | AddGeoJsonLayerOperation;
export type SetStyleRootPropertiesOperation = {
  op: 'setStyleRootProperties';
  properties: JsonObject;
};
export type SetLayerFilterOperation =
  | {
      op: 'setLayerFilter';
      layerId: string;
      mode: 'replace' | 'and' | 'or';
      filter: JsonValue[];
    }
  | { op: 'setLayerFilter'; layerId: string; mode: 'clear' };
export type SetGeoJsonSourceFilterOperation =
  | {
      op: 'setGeoJsonSourceFilter';
      sourceId: string;
      mode: 'replace';
      filter: JsonValue[];
    }
  | { op: 'setGeoJsonSourceFilter'; sourceId: string; mode: 'clear' };
export type AddSourceOperation = {
  op: 'addSource';
  sourceId: string;
  source: JsonObject;
};
export type DuplicateSourceOperation = {
  op: 'duplicateSource';
  sourceId: string;
  newSourceId: string;
  overrides?: JsonObject;
};
export type RenameSourceOperation = {
  op: 'renameSource';
  sourceId: string;
  newSourceId: string;
};
export type RemoveSourceOperation = {
  op: 'removeSource';
  sourceId: string;
  cascadeLayers?: boolean;
};
export type PatchSourceOperation = {
  op: 'patchSource';
  sourceId: string;
  patch: JsonObject;
};
export type SetGeoJsonDataOperation = {
  op: 'setGeoJsonData';
  sourceId: string;
  data: InlineGeoJson | string;
};
export type SourceOperation =
  | AddSourceOperation
  | DuplicateSourceOperation
  | RenameSourceOperation
  | RemoveSourceOperation
  | PatchSourceOperation
  | SetGeoJsonDataOperation;
export type AddLayerDefinitionOperation = {
  op: 'addLayerDefinition';
  layer: JsonObject;
  beforeId?: string;
};
export type DeepMergeLayerDefinitionOperation = {
  op: 'deepMergeLayerDefinition';
  layerId: string;
  patch: JsonObject;
};
export type ReplaceLayerDefinitionOperation = {
  op: 'replaceLayerDefinition';
  layerId: string;
  layer: JsonObject;
};
export type DeepMergeSourceDefinitionOperation = {
  op: 'deepMergeSourceDefinition';
  sourceId: string;
  patch: JsonObject;
};
export type ReplaceSourceDefinitionOperation = {
  op: 'replaceSourceDefinition';
  sourceId: string;
  source: JsonObject;
};
export type ReplaceRootPropertyOperation = {
  op: 'replaceRootProperty';
  property: 'metadata' | 'transition' | 'sky' | 'projection' | 'terrain';
  value: JsonObject | null;
};
export type ShallowPatchRootPropertyOperation = {
  op: 'shallowPatchRootProperty';
  property: 'light';
  patch: JsonObject;
};
export type CompatibilityStyleOperation =
  | AddLayerDefinitionOperation
  | DeepMergeLayerDefinitionOperation
  | ReplaceLayerDefinitionOperation
  | DeepMergeSourceDefinitionOperation
  | ReplaceSourceDefinitionOperation
  | ReplaceRootPropertyOperation
  | ShallowPatchRootPropertyOperation;
export type StyleOperation =
  | SetLayerPropertiesOperation
  | LayerLifecycleOperation
  | SetStyleRootPropertiesOperation
  | SetLayerFilterOperation
  | SetGeoJsonSourceFilterOperation
  | SourceOperation
  | CompatibilityStyleOperation;
export type StyleTransaction = {
  operations: StyleOperation[];
  validate?: boolean;
};
export interface CoreExecutionLimits {
  maxStyleBytes: number;
  maxDiffBytes: number;
  maxOperations: number;
}
export type StyleTransactionOptions = Partial<CoreExecutionLimits>;
export type StyleReplacementOptions = Partial<Pick<
  CoreExecutionLimits, 'maxStyleBytes' | 'maxDiffBytes'
>>;
export type StyleDiffTarget =
  | { kind: 'style' }
  | { kind: 'layer'; id: string }
  | { kind: 'source'; id: string };
export type StyleDiffEntry = {
  op: 'add' | 'remove' | 'replace' | 'move';
  path: string;
  from?: string;
  before?: JsonValue;
  after?: JsonValue;
  target: StyleDiffTarget;
};
export type StyleWarning = {
  code: string; message: string; path?: string;
};
export type StyleToolError = {
  code: StyleToolErrorCode; message: string; path?: string;
  details?: JsonObject;
};
export interface OperationContext {
  readonly limits: Readonly<CoreExecutionLimits>;
  changedLayerIds: Set<string>;
  changedSourceIds: Set<string>;
  warnings: StyleWarning[];
}
export type OperationApplyResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: StyleToolError };
type StyleTransactionResultFields = {
  style: StyleDocument; changedLayers: string[]; changedSources: string[];
  diff: StyleDiffEntry[]; warnings: StyleWarning[];
};
export type StyleTransactionResult =
  | (StyleTransactionResultFields & { ok: true })
  | (StyleTransactionResultFields & { ok: false; error: StyleToolError });
