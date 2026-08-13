import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { JsonObject, JsonValue, StyleToolError } from '../core/types.js';

export const MAX_MCP_MESSAGE_BYTES = 5 * 1024 * 1024;
export const MIN_MCP_MESSAGE_BYTES = 128 * 1024;
export const MAX_CONFIGURABLE_MCP_MESSAGE_BYTES = 64 * 1024 * 1024;
export const MCP_RESPONSE_ENVELOPE_RESERVE_BYTES = 64 * 1024;
export const MAX_MCP_REQUEST_ID_BYTES = 256;
export const MAX_MCP_METHOD_BYTES = 128;
export const MAX_MCP_RESOURCE_URI_BYTES = 8 * 1024;
export const MAX_STYLE_SESSION_ID_BYTES = 512;

export type McpJsonValue = JsonValue;

export type McpToolMeta = JsonObject;

export type McpToolEnvelope<T = JsonValue> =
  | (Record<string, unknown> & { ok: true; data: T; meta?: McpToolMeta })
  | (Record<string, unknown> & { ok: false; error: StyleToolError; meta?: McpToolMeta });

export type McpTextToolResult<T = JsonValue> = Omit<
  CallToolResult,
  'content' | 'structuredContent'
> & {
  content: [{ type: 'text'; text: string }];
  structuredContent: McpToolEnvelope<T>;
};

export interface McpMessagePolicy {
  readonly maxMessageBytes: number;
  readonly applicationResultBytes: number;
}

export interface ResourceUriAdmission {
  readonly scheme: string;
  readonly authority: string;
  assertCanonical(rawUri: string): void;
}
