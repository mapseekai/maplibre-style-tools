import type {
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
