import type { JsonValue } from './types.js';

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

export function jsonUtf8ByteLength(value: JsonValue): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('JSON serialization returned undefined for a JSON value');
  }
  return utf8ByteLength(serialized);
}
