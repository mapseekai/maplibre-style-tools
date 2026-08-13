import type { JsonValue } from '../core/types.js';

export const MAX_MCP_MESSAGE_BYTES = 5 * 1024 * 1024;
export const MIN_MCP_MESSAGE_BYTES = 128 * 1024;
export const MAX_CONFIGURABLE_MCP_MESSAGE_BYTES = 64 * 1024 * 1024;
export const MCP_RESPONSE_ENVELOPE_RESERVE_BYTES = 64 * 1024;
export const MAX_MCP_REQUEST_ID_BYTES = 256;
export const MAX_MCP_METHOD_BYTES = 128;
export const MAX_MCP_RESOURCE_URI_BYTES = 8 * 1024;
export const MAX_STYLE_SESSION_ID_BYTES = 512;

export type McpJsonValue = JsonValue;
