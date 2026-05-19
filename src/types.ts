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
  metadata?: JsonObject;
  [key: string]: unknown;
}

export interface StyleDocument {
  version: number;
  sources?: Record<string, unknown>;
  layers: StyleLayer[];
  [key: string]: unknown;
}

export interface LayerSummary {
  id: string;
  type: string;
  source?: string;
  sourceLayer?: string;
  minzoom?: number;
  maxzoom?: number;
  visibility?: unknown;
}

export interface StyleContextOptions {
  activeSourceId?: string | null;
  selectedLayerId?: string | null;
  layerLimit?: number;
}

export interface StyleContext {
  activeSourceId?: string | null;
  selectedLayerId?: string | null;
  layerCount: number;
  sourceCount: number;
  layerTypes: Record<string, number>;
  layers: LayerSummary[];
}

export interface LayerSearchQuery {
  query?: string;
  type?: string;
  source?: string;
  sourceLayer?: string;
  limit?: number;
}

export interface LayerSearchResult {
  layers: LayerSummary[];
  total: number;
}

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
