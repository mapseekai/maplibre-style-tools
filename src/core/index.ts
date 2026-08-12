export type {
  CoreExecutionLimits,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  LayerSearchQuery,
  LayerSearchResult,
  LayerSummary,
  OperationApplyResult,
  OperationContext,
  Placement,
  SetLayerPropertiesOperation,
  SetStyleRootPropertiesOperation,
  StyleDiffEntry,
  StyleDiffTarget,
  StyleDocument,
  StyleContext,
  StyleContextOptions,
  StyleLayer,
  StyleOperation,
  StyleReplacementOptions,
  StyleSource,
  StyleToolError,
  StyleTransaction,
  StyleTransactionOptions,
  StyleTransactionResult,
  StyleWarning,
} from './types.js';
export type { StyleToolErrorCode } from './errors.js';
export type {
  StyleValidationOptions,
  StyleValidationResult,
} from './validation.js';
export {
  createStyleToolError,
  isStyleToolError,
  STYLE_TOOL_ERROR_CODES,
} from './errors.js';
export {
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
  jsonUtf8ByteLength,
  utf8ByteLength,
} from './utf8.js';
export {
  createStyleTransactionSchema,
  jsonValueSchema,
  setLayerPropertiesOperationSchema,
  setStyleRootPropertiesOperationSchema,
  styleDocumentSchema,
  styleOperationSchema,
  styleTransactionSchema,
} from './schemas.js';
export { validateStyleDocument } from './validation.js';
export { buildStyleContext } from './context.js';
export { searchLayers } from './search.js';
export { applyRootOperation } from './operations/root.js';
export { applyMergePatch, resolveInsertionIndex } from './operations/shared.js';
export {
  applyStyleTransaction,
  finalizeStyleReplacement,
} from './transaction.js';
