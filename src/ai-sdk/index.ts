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
  compactApplyStyleTransactionInputSchema,
  compactDuplicateLayerInputSchema,
  compactListSourceLayersInputSchema,
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
