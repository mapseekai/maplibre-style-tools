import type {
  GeoJsonFeature,
  GeoJsonGeometry,
  JsonObject,
  JsonValue,
  StyleDocument,
  StyleReplacementOptions,
  StyleToolError,
  StyleTransactionOptions,
  StyleTransactionResult,
  StyleWarning,
} from '../../core/types.js';

export interface FeatureQueryLimits {
  maxFeatures: number;
  maxSerializedBytes: number;
}

export type ScreenPoint = [number, number];
export type ScreenBounds = [ScreenPoint, ScreenPoint];

export interface FeatureProjectionInput {
  propertyAllowlist?: string[];
  limit?: number;
  maxSerializedBytes?: number;
}

export interface SourceFeatureQueryInput extends FeatureProjectionInput {
  sourceId: string;
  sourceLayer?: string;
  filter?: JsonValue[];
}

export type RenderedFeatureQueryGeometry =
  | { kind: 'viewport' }
  | { kind: 'point'; point: ScreenPoint }
  | { kind: 'bounds'; bounds: ScreenBounds };

export type RenderedFeatureQueryInput = FeatureProjectionInput & {
  geometry?: RenderedFeatureQueryGeometry;
  layerIds?: string[];
  filter?: JsonValue[];
};

export interface BoundedFeatureQueryResult {
  ok: boolean;
  features: JsonObject[];
  returned: number;
  truncated: boolean;
  serializedBytes: number;
  warnings: StyleWarning[];
  error?: StyleToolError;
}

export interface MapOperationDeadline {
  expiresAt: number;
  signal?: AbortSignal;
  now?: () => number;
}

export interface ApplyTransactionToMapOptions extends StyleTransactionOptions {
  diff?: boolean;
  timeoutMs?: number;
  deadline?: MapOperationDeadline;
  hashStyle?: (style: StyleDocument) => Promise<string>;
}

export interface WholeStyleApplyOptions extends StyleReplacementOptions {
  diff?: boolean;
  timeoutMs?: number;
  deadline?: MapOperationDeadline;
  hashStyle?: (style: StyleDocument) => Promise<string>;
  expectedBaselineStyle?: StyleDocument;
}

export type PreparedStyleApplyOptions = Pick<
  ApplyTransactionToMapOptions,
  'diff' | 'deadline' | 'hashStyle'
> & {
  maxStyleBytes?: never;
  maxDiffBytes?: never;
  maxOperations?: never;
  timeoutMs?: never;
};

export type MapStyleCurrentResult = StyleTransactionResult & {
  styleAuthority: 'current';
  applied: boolean;
  rolledBack?: boolean;
  rollbackError?: StyleToolError;
};

export type MapStylePreOperationResult = Extract<StyleTransactionResult, { ok: false }> & {
  styleAuthority: 'pre-operation';
  applied: false;
  rolledBack?: false;
  rollbackError?: StyleToolError;
};

export type MapStyleUnavailableResult = {
  ok: false;
  styleAuthority: 'unavailable';
  applied: false;
  changedLayers: [];
  changedSources: [];
  diff: [];
  warnings: StyleWarning[];
  error: StyleToolError;
  rolledBack?: false;
  rollbackError?: StyleToolError;
};

export type MapStyleApplyResult =
  | MapStyleCurrentResult
  | MapStylePreOperationResult
  | MapStyleUnavailableResult;

export type DeepReadonlyPrepared<T> =
  T extends readonly (infer U)[]
    ? readonly DeepReadonlyPrepared<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonlyPrepared<T[K]> }
      : T;

export type PreparedMapStyleTransactionView = DeepReadonlyPrepared<{
  baselineHash: string;
  transactionResult: Extract<StyleTransactionResult, { ok: true }>;
  limitOptions: StyleTransactionOptions;
}>;

export type WholeStyleInput = StyleDocument | string;

export type RuntimeCommandResult<T extends JsonValue = JsonValue> =
  | { ok: true; data: T }
  | { ok: false; error: StyleToolError };

export type RuntimeListData<T extends JsonValue> = JsonObject & {
  items: T[];
  returned: number;
  truncated: boolean;
};

export interface FeatureTargetInput {
  source: string;
  sourceLayer?: string;
  id: string | number;
}

export interface FeatureStateInput {
  target: FeatureTargetInput;
  state: JsonObject;
}

export interface RemoveFeatureStateInput {
  target: FeatureTargetInput;
  key?: string;
}

export interface GlobalStateInput {
  propertyName: string;
  value: JsonValue;
}

export interface ImageOptionsInput {
  pixelRatio?: number;
  sdf?: boolean;
  content?: [number, number, number, number];
  stretchX?: Array<[number, number]>;
  stretchY?: Array<[number, number]>;
}

export interface ImageDataLike {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface AddImageDataInput {
  imageId: string;
  image: ImageDataLike;
  options?: ImageOptionsInput;
  overwrite?: boolean;
}

export interface AddImageFromUrlInput {
  imageId: string;
  url: string;
  options?: ImageOptionsInput;
  overwrite?: boolean;
}

export interface AddSpriteInput {
  spriteId: string;
  url: string;
  overwrite?: boolean;
}

export interface RuntimeListInput {
  limit?: number;
}

export interface RemoveImageInput {
  imageId: string;
}

export interface RemoveSpriteInput {
  spriteId: string;
}

export interface RuntimeCommandExecution {
  signal?: AbortSignal;
}

export type RuntimeGeoJsonFeatureId = string | number;
export type RuntimeGeoJsonAddFeature = GeoJsonFeature<GeoJsonGeometry>;
export type RuntimeGeoJsonPropertyPatch = {
  key: string;
  value: JsonValue;
};
export type RuntimeGeoJsonFeaturePatch = {
  id: RuntimeGeoJsonFeatureId;
  newGeometry?: GeoJsonGeometry;
  removeAllProperties?: boolean;
  removeProperties?: string[];
  addOrUpdateProperties?: RuntimeGeoJsonPropertyPatch[];
};
export type RuntimeGeoJsonSourceDiff = {
  removeAll?: boolean;
  remove?: RuntimeGeoJsonFeatureId[];
  add?: RuntimeGeoJsonAddFeature[];
  update?: RuntimeGeoJsonFeaturePatch[];
};
export type RuntimeGeoJsonSourceDiffValidationResult =
  | { ok: true; value: RuntimeGeoJsonSourceDiff }
  | { ok: false; error: StyleToolError };

export type RuntimeGeoJsonDiffUpdate = {
  sourceId: string;
  diff: RuntimeGeoJsonSourceDiff;
};

export interface SourceTileLodParamsInput {
  maxZoomLevelsOnScreen: number;
  tileCountMaxMinRatio: number;
  sourceId?: string;
}

export interface RuntimeImageLoader {
  load(url: string, options: { signal: AbortSignal }): Promise<ImageDataLike>;
}

export interface MapRuntimeCommands {
  updateGeoJsonDataRuntime(input: RuntimeGeoJsonDiffUpdate): Promise<RuntimeCommandResult>;
  setSourceTileLodParams(input: SourceTileLodParamsInput): RuntimeCommandResult;
  setFeatureState(input: FeatureStateInput): RuntimeCommandResult;
  removeFeatureState(input: RemoveFeatureStateInput): RuntimeCommandResult;
  setGlobalState(input: GlobalStateInput): RuntimeCommandResult;
  listImages(input?: RuntimeListInput): RuntimeCommandResult<RuntimeListData<string>>;
  addImageData(input: AddImageDataInput): RuntimeCommandResult;
  addImageFromUrl(
    input: AddImageFromUrlInput,
    execution?: RuntimeCommandExecution,
  ): Promise<RuntimeCommandResult>;
  removeImage(input: RemoveImageInput): RuntimeCommandResult;
  listSprites(input?: RuntimeListInput): RuntimeCommandResult<RuntimeListData<JsonObject>>;
  addSprite(input: AddSpriteInput): RuntimeCommandResult;
  removeSprite(input: RemoveSpriteInput): RuntimeCommandResult;
}
