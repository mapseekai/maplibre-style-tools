import type {
  StyleDocument,
  StyleReplacementOptions,
  StyleToolError,
  StyleTransactionOptions,
  StyleTransactionResult,
  StyleWarning,
} from '../../core/types.js';

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
>;

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
