import type {
  GeoJsonAnalysisInput,
  GeoJsonAnalysisOptions,
  GeoJsonFeature,
  JsonObject,
  JsonValue,
  StyleDiffEntry,
  StyleDocument,
  StyleOperation,
  StyleToolError,
  StyleWarning,
} from '../core/index.js';
import type { ImageOptionsInput, RuntimeGeoJsonSourceDiff } from '../adapters/maplibre/types.js';

export type Limit100 = number;
export type ByteLimit = number;
export type InspectionField = 'paint' | 'layout' | 'filter' | 'zoom';
export type NonEmptyStyleTransaction = { operations: [StyleOperation, ...StyleOperation[]]; validate?: boolean };
export type EmptyStyleTransaction = { operations: []; validate?: boolean };

export type InspectStyleInput =
  | { action: 'listLayers'; query?: string; type?: string; source?: string; sourceLayer?: string; limit?: Limit100 }
  | { action: 'listSources'; limit?: Limit100 }
  | { action: 'getLayer'; layerId: string; fields?: InspectionField[] }
  | { action: 'getSource'; sourceId: string }
  | { action: 'getRoot' }
  | { action: 'getContext'; layerLimit?: Limit100 }
  | { action: 'inspectLayers'; layerIds?: string[]; fields?: InspectionField[]; limit?: Limit100 }
  | { action: 'getLayerCount' }
  | { action: 'validateDocument'; style: StyleDocument }
  | { action: 'validateCurrentMap' }
  | { action: 'validateTransaction'; transaction: NonEmptyStyleTransaction }
  | { action: 'analyzeGeoJson'; data: GeoJsonAnalysisInput; options?: GeoJsonAnalysisOptions }
  | { action: 'listSourceLayers'; sourceId?: string };

export type ApplyStyleTransactionInput = {
  transaction: NonEmptyStyleTransaction | EmptyStyleTransaction;
  dryRun?: boolean;
  diff?: boolean;
};

export type ApplyStyleDocumentInput =
  | { source: { kind: 'style'; style: StyleDocument }; diff?: boolean }
  | { source: { kind: 'url'; url: string }; diff?: boolean };

export type RunMapCommandInput =
  | { action: 'updateGeoJsonData'; sourceId: string; diff: RuntimeGeoJsonSourceDiff }
  | { action: 'setSourceTileLodParams'; maxZoomLevelsOnScreen: number; tileCountMaxMinRatio: number; sourceId?: string }
  | { action: 'setFeatureState'; target: { source: string; sourceLayer?: string; id: string | number }; state: JsonObject }
  | { action: 'removeFeatureState'; target: { source: string; sourceLayer?: string; id: string | number }; key?: string }
  | { action: 'setGlobalState'; propertyName: string; value: JsonValue }
  | { action: 'listImages'; limit?: Limit100 }
  | { action: 'addImageFromUrl'; imageId: string; url: string; options?: ImageOptionsInput; overwrite?: boolean }
  | { action: 'removeImage'; imageId: string }
  | { action: 'listSprites'; limit?: Limit100 }
  | { action: 'addSprite'; spriteId: string; url: string; overwrite?: boolean }
  | { action: 'removeSprite'; spriteId: string };

export type QueryMapFeaturesInput =
  | { target: 'source'; sourceId: string; sourceLayer?: string; filter?: JsonValue[]; propertyAllowlist?: string[]; limit?: Limit100; maxSerializedBytes?: ByteLimit }
  | { target: 'rendered'; geometry?: { kind: 'viewport' } | { kind: 'point'; point: [number, number] } | { kind: 'bounds'; bounds: [[number, number], [number, number]] }; layerIds?: string[]; filter?: JsonValue[]; propertyAllowlist?: string[]; limit?: Limit100; maxSerializedBytes?: ByteLimit };

export type MapToolContext = { activeSourceId?: string | null; selectedLayerId?: string | null };

export type CapabilityResult<TData> =
  | { success: true; message: string; data: TData }
  | { success: false; message: string; error: StyleToolError };

export type BoundedCollection<T> = { items: T[]; returned: number; total?: number; truncated: boolean; warnings: StyleWarning[] };
export type BoundedValue<T> = { value?: T; returned: 0 | 1; total: 1; truncated: boolean; warnings: StyleWarning[] };
export type InspectionProjection = { action: InspectStyleInput['action']; projection: BoundedCollection<JsonValue> | BoundedValue<JsonValue> };
export type StyleMutationReceipt = { applied: boolean; noOp: boolean; changedLayers: string[]; changedSources: string[]; diff?: StyleDiffEntry[]; warnings: StyleWarning[]; truncated: boolean; styleAuthority: 'current' | 'not-checked' };
export type MapCommandReceipt = { action: RunMapCommandInput['action']; kind: 'acknowledgement' | 'list'; applied: boolean; result?: JsonValue | BoundedCollection<JsonValue>; warnings: StyleWarning[]; truncated: boolean };
export type FeatureQueryProjection = { target: QueryMapFeaturesInput['target']; features: GeoJsonFeature[]; returned: number; total?: number; truncated: boolean; warnings: StyleWarning[] };


