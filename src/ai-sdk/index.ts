/// <reference types="node" preserve="true" />

export {
  MAX_AI_TEXT_BYTES,
  normalizeLegacyOperations,
  parseJsonOrRawString,
  parseStrictJson,
} from './compatibility.js';
export type { ParseResult } from './compatibility.js';
export {
  compactAddGeoJsonLayerInputSchema,
  compactAddLayerFromSourceInputSchema,
  compactAnalyzeGeoJsonInputSchema,
  compactApplyStyleOperationsInputSchema,
  compactApplyStyleTransactionInputSchema,
  compactDuplicateLayerInputSchema,
  compactGetStyleContextInputSchema,
  compactInspectLayersCompactInputSchema,
  compactListSourceLayersInputSchema,
  compactSearchLayersInputSchema,
  compactValidateStylePatchJsonInputSchema,
  filterTextSchema,
  jsonOrRawStringTextSchema,
  legacyOperationsTextSchema,
  strictJsonTextSchema,
  styleJsonOrUrlTextSchema,
} from './schemas.js';
export {
  createCompactMapLibreStyleTools,
  COMPACT_LEGACY_TOOL_NAMES,
} from './compact-tools.js';
export { createMapLibreStyleTools } from './full-tools.js';
export type {
  CreateMapLibreStyleToolsOptions,
  MapAccessor,
  StyleAccessor,
  ToolCallResult,
} from './full-tools.js';
export * from './schemas.js';
export type {
  CompactMapAccessor,
  CompactToolContext,
  CreateCompactMapLibreStyleToolsOptions,
} from './compact-tools.js';
export { toAiToolResult } from './result.js';
export type {
  AiStyleToolResult,
  CommonResultFields,
  CommonResultInput,
} from './result.js';
