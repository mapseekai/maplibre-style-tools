/// <reference types="geojson" preserve="true" />

export type {
  CoreExecutionLimits,
  JsonObject,
  LayerSearchQuery,
  LayerSearchResult,
  LayerSummary,
  StyleContext,
  StyleContextOptions,
  StyleDiffEntry,
  StyleDocument,
  StyleLayer,
  StyleOperation as CoreStyleOperation,
  StyleDiffEntry as CoreStyleDiffEntry,
  StyleReplacementOptions,
  StyleTransaction,
  StyleTransactionOptions,
  StyleTransactionResult as CoreStyleTransactionResult,
  StyleToolError,
  StyleWarning,
} from './core/index.js';
export { applyStyleTransaction, validateStyleDocument } from './core/index.js';
