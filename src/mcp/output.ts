import {
  CallToolResultSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { STYLE_TOOL_ERROR_CODES } from '../core/errors.js';
import { jsonValueSchema } from '../core/schemas.js';
import type { JsonObject, JsonValue, StyleToolError } from '../core/types.js';
import type {
  McpTextToolResult,
  McpToolEnvelope,
  McpToolMeta,
} from './types.js';

const jsonObjectWireSchema = jsonValueSchema.refine(
  (value): value is JsonObject => typeof value === 'object'
    && value !== null
    && !Array.isArray(value),
  { message: 'Expected a JSON object.' },
);

export const styleToolErrorWireSchema = z.strictObject({
  code: z.enum(STYLE_TOOL_ERROR_CODES),
  message: z.string(),
  path: z.string().optional(),
  details: jsonObjectWireSchema.optional(),
});

const mcpToolMetaSchema = jsonObjectWireSchema;

export const createMcpToolEnvelopeSchema = <DataSchema extends z.ZodTypeAny>(
  dataSchema: DataSchema,
) => z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    data: dataSchema,
    meta: mcpToolMetaSchema.optional(),
  }),
  z.strictObject({
    ok: z.literal(false),
    error: styleToolErrorWireSchema,
    meta: mcpToolMetaSchema.optional(),
  }),
]);

export const mcpToolEnvelopeSchema = createMcpToolEnvelopeSchema(jsonValueSchema);

export const parseStyleToolErrorShape = (value: unknown): StyleToolError =>
  styleToolErrorWireSchema.parse(value);

export const parseMcpToolEnvelope = (value: unknown): McpToolEnvelope<JsonValue> =>
  mcpToolEnvelopeSchema.parse(value) as McpToolEnvelope<JsonValue>;

const toMcpResult = <T>(
  envelope: McpToolEnvelope<T>,
  isError = false,
): McpTextToolResult<T> => {
  const structuredContent = mcpToolEnvelopeSchema.parse(envelope) as McpToolEnvelope<T>;
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
};

export const toolSuccess = <T>(data: T, meta?: McpToolMeta): McpTextToolResult<T> =>
  toMcpResult<T>({ ok: true, data, ...(meta === undefined ? {} : { meta }) });

export const toolFailure = (error: StyleToolError): McpTextToolResult<never> => {
  const sanitizedError = styleToolErrorWireSchema.parse(error);
  return toMcpResult<never>({ ok: false, error: sanitizedError }, true);
};

const compatibilityWrapperError = (): TypeError =>
  new TypeError('MCP compatibility wrapper is not an official call tool result.');

export const parseOfficialCallToolResult = (value: unknown): CallToolResult => {
  if (typeof value !== 'object' || value === null) {
    return CallToolResultSchema.parse(value);
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, 'toolResult');
  } catch {
    throw compatibilityWrapperError();
  }
  if (descriptor !== undefined) throw compatibilityWrapperError();
  return CallToolResultSchema.parse(value);
};
