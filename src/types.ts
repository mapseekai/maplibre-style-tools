export type JsonObject = Record<string, unknown>;

export interface StyleLayer {
  id: string;
  type: string;
  source?: string;
  'source-layer'?: string;
  paint?: JsonObject;
  layout?: JsonObject;
  filter?: unknown;
  minzoom?: number;
  maxzoom?: number;
  metadata?: unknown;
  [key: string]: unknown;
}

export interface StyleDocument {
  version: number;
  sources?: Record<string, unknown>;
  layers: StyleLayer[];
  [key: string]: unknown;
}

export type {
  LayerSearchQuery,
  LayerSearchResult,
  LayerSummary,
  StyleContext,
  StyleContextOptions,
} from './core/types.js';

export interface StyleOperation {
  layerId: string;
  paint?: JsonObject;
  layout?: JsonObject;
  filter?: unknown;
  minzoom?: number;
  maxzoom?: number;
}

export interface StyleDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

export interface StyleOperationResult {
  success: boolean;
  message: string;
  style: StyleDocument;
  changedLayers: string[];
  diffSummary: StyleDiffEntry[];
}
