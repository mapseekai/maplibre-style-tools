import type { JsonObject, JsonValue } from './types.js';

export const DEFAULT_MAX_STYLE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_DIFF_BYTES = 1 * 1024 * 1024;
export const DEFAULT_MAX_OPERATIONS = 100;

export function utf8ByteLength(value: string): number {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800 && codeUnit <= 0xdbff
      && index + 1 < value.length
    ) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

function jsonStringByteLength(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x22 || codeUnit === 0x5c) {
      bytes += 2;
    } else if (codeUnit <= 0x1f) {
      bytes += (
        codeUnit === 0x08
        || codeUnit === 0x09
        || codeUnit === 0x0a
        || codeUnit === 0x0c
        || codeUnit === 0x0d
      ) ? 2 : 6;
    } else if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = index + 1 < value.length
        ? value.charCodeAt(index + 1)
        : 0;
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

type JsonContainerFrame =
  | { kind: 'array'; value: JsonValue[]; index: number }
  | { kind: 'object'; value: JsonObject; keys: string[]; index: number };

function primitiveJsonByteLength(value: string | number | boolean | null): number {
  if (value === null) return 4;
  if (typeof value === 'string') return jsonStringByteLength(value);
  if (typeof value === 'boolean') return value ? 4 : 5;
  return value === 0 ? 1 : String(value).length;
}

function iterativeJsonByteLength(value: JsonValue): number {
  let bytes = 0;
  let current: JsonValue | undefined = value;
  const stack: JsonContainerFrame[] = [];

  while (current !== undefined || stack.length > 0) {
    if (current !== undefined) {
      if (typeof current !== 'object' || current === null) {
        bytes += primitiveJsonByteLength(current);
        current = undefined;
      } else if (Array.isArray(current)) {
        bytes += 1;
        if (current.length === 0) {
          bytes += 1;
          current = undefined;
        } else {
          stack.push({ kind: 'array', value: current, index: 0 });
          current = current[0];
        }
      } else {
        const keys = Object.keys(current);
        bytes += 1;
        if (keys.length === 0) {
          bytes += 1;
          current = undefined;
        } else {
          const firstKey = keys[0]!;
          bytes += jsonStringByteLength(firstKey) + 1;
          stack.push({ kind: 'object', value: current, keys, index: 0 });
          current = current[firstKey];
        }
      }
      continue;
    }

    const frame = stack[stack.length - 1]!;
    frame.index += 1;
    const length = frame.kind === 'array' ? frame.value.length : frame.keys.length;
    if (frame.index >= length) {
      bytes += 1;
      stack.pop();
      continue;
    }
    bytes += 1;
    if (frame.kind === 'array') {
      current = frame.value[frame.index];
    } else {
      const key = frame.keys[frame.index]!;
      bytes += jsonStringByteLength(key) + 1;
      current = frame.value[key];
    }
  }
  return bytes;
}

export function jsonUtf8ByteLength(value: JsonValue): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    if (error instanceof RangeError) return iterativeJsonByteLength(value);
    throw error;
  }
  if (serialized === undefined) {
    throw new Error('JSON serialization returned undefined for a JSON value');
  }
  return utf8ByteLength(serialized);
}
