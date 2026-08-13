/// <reference types="node" preserve="true" />

export { MCP_SERVER_VERSION } from './version.generated.js';
export {
  MAX_CONFIGURABLE_MCP_MESSAGE_BYTES,
  MAX_MCP_MESSAGE_BYTES,
  MAX_MCP_METHOD_BYTES,
  MAX_MCP_REQUEST_ID_BYTES,
  MAX_MCP_RESOURCE_URI_BYTES,
  MAX_STYLE_SESSION_ID_BYTES,
  MCP_RESPONSE_ENVELOPE_RESERVE_BYTES,
  MIN_MCP_MESSAGE_BYTES,
} from './types.js';
export type {
  ApplySessionTransactionResult,
  ApplyStyleSessionRequest,
  Clock,
  CloseStyleSessionResult,
  ExportStyleSessionResult,
  McpJsonValue,
  McpMessagePolicy,
  McpResourceContent,
  McpResourceResult,
  McpTextToolResult,
  McpToolEnvelope,
  McpToolMeta,
  ResourceUriAdmission,
  RevisionSnapshot,
  SessionRevisionMetadata,
  SessionSnapshot,
  OpenStyleSessionResult,
  StyleSessionLimits,
  StyleSessionStoreOptions,
  StyleInspectResult,
} from './types.js';
export {
  createMcpToolEnvelopeSchema,
  mcpToolEnvelopeSchema,
  parseMcpToolEnvelope,
  parseOfficialCallToolResult,
  parseStyleToolErrorShape,
  styleToolErrorWireSchema,
  toolFailure,
  toolSuccess,
} from './output.js';
export { resolveMcpMessagePolicy } from './message-boundary.js';
export {
  DEFAULT_STYLE_SESSION_LIMITS,
  createStyleSessionStore,
} from './session-store.js';
export type { StyleSessionStore } from './session-store.js';
export {
  DOCUMENT_TOOL_NAMES,
  documentToolInputSchemas,
  documentToolResponseDataSchemas,
  parseDocumentToolSuccessData,
  styleAnalyzeGeoJsonDataSchema,
  styleAnalyzeGeoJsonInputSchema,
  styleApplyTransactionDataSchema,
  styleApplyTransactionInputSchema,
  styleExportDataSchema,
  styleExportInputSchema,
  styleInspectDataSchema,
  styleInspectInputSchema,
  styleSearchLayersDataSchema,
  styleSearchLayersInputSchema,
  styleSessionCloseDataSchema,
  styleSessionCloseInputSchema,
  styleSessionOpenDataSchema,
  styleSessionOpenInputSchema,
  styleValidateDataSchema,
  styleValidateInputSchema,
} from './schemas.js';
export type { DocumentToolName } from './schemas.js';
export { createDocumentToolHandlers } from './document-handlers.js';
export type { DocumentToolHandlers } from './document-handlers.js';
export {
  createResourceResolver,
  documentResourceUriAdmission,
  makeContextUri,
  makeDiffUri,
  makeLayerUri,
  makeSessionUri,
  makeSourceUri,
  makeStyleUri,
  parseContextUri,
  parseDiffUri,
  parseLayerUri,
  parseSessionUri,
  parseSourceUri,
  parseStyleUri,
  styleResourceTemplates,
} from './resources.js';
export {
  createMapLibreStyleMcpServer,
} from './create-server.js';
export type {
  CreatedMapLibreStyleMcpServer,
  CreateMapLibreStyleMcpServerOptions,
} from './create-server.js';
export { createMcpServerExtension } from './server-extension.js';
export type {
  McpServerExtension,
  McpServerExtensionContext,
  McpServerExtensionDependencies,
} from './server-extension.js';
export type {
  McpResourceResolver,
  ParsedContextUri,
  ParsedDiffUri,
  ParsedLayerUri,
  ParsedSessionUri,
  ParsedSourceUri,
  ParsedStyleUri,
} from './resources.js';
