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
  McpJsonValue,
  McpMessagePolicy,
  McpTextToolResult,
  McpToolEnvelope,
  McpToolMeta,
  ResourceUriAdmission,
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
