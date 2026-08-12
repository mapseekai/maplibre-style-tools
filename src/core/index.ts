export type {
  CoreExecutionLimits,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  OperationApplyResult,
  OperationContext,
  SetLayerPropertiesOperation,
  StyleDiffEntry,
  StyleDiffTarget,
  StyleDocument,
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
  styleDocumentSchema,
  styleOperationSchema,
  styleTransactionSchema,
} from './schemas.js';
export { validateStyleDocument } from './validation.js';
