import type {
  LayerSpecification, SourceSpecification, StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { StyleToolErrorCode } from './errors.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

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

export type SetLayerPropertiesOperation = {
  op: 'setLayerProperties';
  layerId: string;
  paint?: Record<string, JsonValue | null>;
  layout?: Record<string, JsonValue | null>;
  metadata?: Record<string, JsonValue | null> | null;
  minzoom?: number | null;
  maxzoom?: number | null;
};
export type StyleOperation = SetLayerPropertiesOperation;
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
