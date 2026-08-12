import type { JsonObject, StyleToolError } from './types.js';

export const STYLE_TOOL_ERROR_CODES = [
  'INVALID_INPUT',
  'STYLE_INVALID',
  'NOT_FOUND',
  'CONFLICT',
  'DEPENDENCY_CONFLICT',
  'UNSUPPORTED_SOURCE',
  'REVISION_CONFLICT',
  'MAP_NOT_READY',
  'BRIDGE_DISCONNECTED',
  'CAPABILITY_DENIED',
  'IO_ERROR',
  'TIMEOUT',
  'INTERNAL',
] as const;

export type StyleToolErrorCode = (typeof STYLE_TOOL_ERROR_CODES)[number];

const knownStyleToolErrors = new WeakSet<object>();

export function createStyleToolError(
  code: StyleToolErrorCode,
  message: string,
  path?: string,
  details?: JsonObject,
): StyleToolError {
  const error: StyleToolError = { code, message };
  if (path !== undefined) {
    error.path = path;
  }
  if (details !== undefined) {
    error.details = details;
  }
  knownStyleToolErrors.add(error);
  return error;
}

export function isStyleToolError(value: unknown): value is StyleToolError {
  return typeof value === 'object' && value !== null && knownStyleToolErrors.has(value);
}
