import {
  createStyleToolError,
  jsonUtf8ByteLength,
  jsonValueSchema,
  styleTransactionSchema,
} from '../core/index.js';
import type {
  JsonObject,
  JsonValue,
  StyleToolError,
  StyleTransaction,
} from '../core/index.js';

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StyleToolError };

export const MAX_AI_TEXT_BYTES = 1024 * 1024;

function safeLabel(label: string): string {
  return /^[A-Za-z][A-Za-z0-9 ]{0,63}$/.test(label) ? label : 'Input';
}

function invalidInput(message: string): ParseResult<never> {
  return { ok: false, error: createStyleToolError('INVALID_INPUT', message) };
}

function validateText(raw: string, label: string): ParseResult<string> {
  const safe = safeLabel(label);
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return invalidInput(`${safe} must be a non-empty string.`);
  }
  if (jsonUtf8ByteLength(raw) > MAX_AI_TEXT_BYTES) {
    return invalidInput(`${safe} exceeds the maximum serialized size.`);
  }
  return { ok: true, value: raw };
}

function snapshotParsedJson(value: unknown, label: string): ParseResult<JsonValue> {
  const parsed = jsonValueSchema.safeParse(value);
  if (!parsed.success) return invalidInput(`${safeLabel(label)} must be a valid JSON value.`);
  return { ok: true, value: parsed.data };
}

export function parseStrictJson(raw: string, label: string): ParseResult<JsonValue> {
  const text = validateText(raw, label);
  if (!text.ok) return text;

  try {
    return snapshotParsedJson(JSON.parse(text.value) as unknown, label);
  } catch {
    return invalidInput(`${safeLabel(label)} must be valid JSON.`);
  }
}

export function parseJsonOrRawString(raw: string, label: string): ParseResult<JsonValue> {
  const text = validateText(raw, label);
  if (!text.ok) return text;

  try {
    return snapshotParsedJson(JSON.parse(text.value) as unknown, label);
  } catch {
    const trimmed = text.value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return invalidInput(`${safeLabel(label)} must be valid JSON.`);
    }
    return { ok: true, value: text.value };
  }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLegacyOperation(operation: JsonObject): unknown[] {
  const layerId = operation.layerId;
  const normalized: unknown[] = [];
  const properties: Record<string, unknown> = {
    op: 'setLayerProperties',
    layerId,
  };
  let hasProperties = false;

  for (const key of ['paint', 'layout', 'minzoom', 'maxzoom'] as const) {
    if (Object.hasOwn(operation, key)) {
      properties[key] = operation[key];
      hasProperties = true;
    }
  }

  if (hasProperties || !Object.hasOwn(operation, 'filter')) normalized.push(properties);

  if (Object.hasOwn(operation, 'filter')) {
    const filter = operation.filter;
    normalized.push(filter === null
      ? { op: 'setLayerFilter', layerId, mode: 'clear' }
      : { op: 'setLayerFilter', layerId, mode: 'replace', filter });
  }

  return normalized;
}

export function normalizeLegacyOperations(raw: string): ParseResult<StyleTransaction> {
  const parsed = parseStrictJson(raw, 'operationsJson');
  if (!parsed.ok) return parsed;
  if (!Array.isArray(parsed.value)) {
    return invalidInput('operationsJson must be a JSON array.');
  }

  // Legacy compact callers treat an empty batch as a no-op. This sentinel is
  // deliberately outside styleTransactionSchema: Task 15 must short-circuit it
  // rather than sending an empty transaction to the strict core boundary.
  if (parsed.value.length === 0) {
    return { ok: true, value: { operations: [], validate: true } };
  }

  const operations: unknown[] = [];
  for (const value of parsed.value) {
    if (!isJsonObject(value)) return invalidInput('operationsJson entries must be JSON objects.');
    operations.push(...normalizeLegacyOperation(value));
  }

  const transaction = styleTransactionSchema.safeParse({ operations });
  if (!transaction.success) return invalidInput('operationsJson contains invalid operations.');
  return { ok: true, value: transaction.data };
}
