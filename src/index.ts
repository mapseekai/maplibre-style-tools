/// <reference types="node" preserve="true" />
/// <reference types="geojson" preserve="true" />

export {
  createMapLibreStyleTools,
} from './ai-sdk/full-tools.js';
export type {
  CreateMapLibreStyleToolsOptions,
  MapAccessor,
  StyleAccessor,
  ToolCallResult,
} from './ai-sdk/full-tools.js';
export { createCompactMapLibreStyleTools } from './ai-sdk/compact-tools.js';
export { FULL_LEGACY_TOOL_NAMES } from './ai-sdk/tool-contracts.js';
export type {
  LayerSearchQuery,
  LayerSearchResult,
  LayerSummary,
  StyleContext,
  StyleContextOptions,
  StyleDiffEntry,
  StyleDocument,
  StyleLayer,
  StyleOperation,
  StyleOperationResult,
} from './types.js';
export type {
  CoreExecutionLimits,
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
