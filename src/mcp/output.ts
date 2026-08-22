import { z } from 'zod';

import { STYLE_TOOL_ERROR_CODES } from '../core/errors.js';
import { jsonValueSchema } from '../core/schemas.js';
import type { JsonObject, JsonValue, StyleToolError } from '../core/types.js';
import type { CapabilityResult } from '../capabilities/contracts.js';
import type {
  McpTextToolResult,
  McpToolEnvelope,
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

export const createMcpToolEnvelopeSchema = <DataSchema extends z.ZodTypeAny>(
  dataSchema: DataSchema,
) => z.discriminatedUnion('success', [
  z.strictObject({
    success: z.literal(true),
    message: z.string(),
    data: dataSchema,
  }),
  z.strictObject({
    success: z.literal(false),
    message: z.string(),
    error: styleToolErrorWireSchema,
  }),
]);

export const mcpToolEnvelopeSchema = createMcpToolEnvelopeSchema(jsonValueSchema);

/**
 * Advertised MCP outputSchema for every tool. Kept non-recursive (unlike
 * mcpToolEnvelopeSchema) so the advertised JSON Schema stays a plain object
 * without $defs; runtime envelopes are still validated by toMcpResult.
 */
export const mcpToolOutputSchema = z.strictObject({
  success: z.boolean(),
  message: z.string(),
  data: z.unknown().optional(),
  error: z.strictObject({
    code: z.enum(STYLE_TOOL_ERROR_CODES),
    message: z.string(),
    path: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
});

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

export const toolSuccess = <T>(message: string, data: T): McpTextToolResult<T> =>
  toMcpResult<T>({ success: true, message, data });

export const toolFailure = (error: StyleToolError): McpTextToolResult<never> => {
  const sanitizedError = styleToolErrorWireSchema.parse(error);
  return toMcpResult<never>({ success: false, message: sanitizedError.message, error: sanitizedError }, true);
};

export const capabilityToolResult = <Data extends JsonValue>(
  result: CapabilityResult<Data>,
): McpTextToolResult<Data> => ({
  content: [{ type: 'text', text: JSON.stringify(result) }],
  structuredContent: result,
  ...(result.success ? {} : { isError: true }),
});
