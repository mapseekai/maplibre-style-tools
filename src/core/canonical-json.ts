import { jsonValueSchema } from './schemas.js';
import type { JsonObject, JsonValue } from './types.js';

const INVALID_JSON_MESSAGE = 'Value must be a strict JSON tree.';

type SerializationWork =
  | { kind: 'value'; value: JsonValue }
  | { kind: 'text'; value: string };

function primitiveJson(value: string | number | boolean | null): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError(INVALID_JSON_MESSAGE);
  return serialized;
}

function serializeCanonical(value: JsonValue): string {
  const output: string[] = [];
  const work: SerializationWork[] = [{ kind: 'value', value }];

  while (work.length > 0) {
    const item = work.pop()!;
    if (item.kind === 'text') {
      output.push(item.value);
      continue;
    }

    const current = item.value;
    if (typeof current !== 'object' || current === null) {
      output.push(primitiveJson(current));
      continue;
    }

    if (Array.isArray(current)) {
      work.push({ kind: 'text', value: ']' });
      for (let index = current.length - 1; index >= 0; index -= 1) {
        work.push({ kind: 'value', value: current[index]! });
        if (index > 0) work.push({ kind: 'text', value: ',' });
      }
      work.push({ kind: 'text', value: '[' });
      continue;
    }

    const object = current as JsonObject;
    const keys = Object.keys(object).sort();
    work.push({ kind: 'text', value: '}' });
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]!;
      work.push({ kind: 'value', value: object[key]! });
      work.push({ kind: 'text', value: ':' });
      work.push({ kind: 'text', value: primitiveJson(key) });
      if (index > 0) work.push({ kind: 'text', value: ',' });
    }
    work.push({ kind: 'text', value: '{' });
  }

  return output.join('');
}

export function canonicalizeJson(value: unknown): string {
  try {
    const parsed = jsonValueSchema.safeParse(value);
    if (parsed.success) return serializeCanonical(parsed.data);
  } catch {
    // Normalize every descriptor, proxy, and schema failure below.
  }
  throw new TypeError(INVALID_JSON_MESSAGE);
}
