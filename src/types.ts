import type {
  StyleDocument as CoreStyleDocument,
  StyleLayer as CoreStyleLayer,
  JsonObject,
} from './core/types.js';

export type { JsonObject } from './core/types.js';

export type StyleLayer = Omit<
  CoreStyleLayer,
  'paint' | 'layout' | 'filter' | 'metadata'
> & {
  paint?: JsonObject;
  layout?: JsonObject;
  filter?: unknown;
  metadata?: JsonObject;
};

export type StyleDocument = Omit<CoreStyleDocument, 'sources' | 'layers'> & {
  sources?: CoreStyleDocument['sources'];
  layers: StyleLayer[];
};

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
