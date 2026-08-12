import { z } from 'zod';
import {
  MAX_AI_TEXT_BYTES,
  normalizeLegacyOperations,
  parseJsonOrRawString,
  parseStrictJson,
} from './compatibility.js';

function boundedTextSchema(
  label: string,
  parser: (raw: string, parserLabel: string) => { ok: boolean },
): z.ZodType<string> {
  return z.string().superRefine((value, context) => {
    if (value.length > MAX_AI_TEXT_BYTES || !parser(value, label).ok) {
      context.addIssue({ code: 'custom', message: `${label} is invalid.` });
    }
  });
}

export const strictJsonTextSchema = boundedTextSchema('JSON value', parseStrictJson);
export const jsonOrRawStringTextSchema = boundedTextSchema('Value', parseJsonOrRawString);
export const legacyOperationsTextSchema = boundedTextSchema(
  'operationsJson', normalizeLegacyOperations,
);
export const filterTextSchema = boundedTextSchema('filterJson', parseStrictJson);
export const styleJsonOrUrlTextSchema = boundedTextSchema(
  'styleJsonOrUrl', parseJsonOrRawString,
);
