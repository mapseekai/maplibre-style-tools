import { jsonUtf8ByteLength as coreJsonUtf8ByteLength, utf8ByteLength } from '../core/index.js';

export const jsonUtf8ByteLength = (value: unknown): number => coreJsonUtf8ByteLength(value as never);

export const truncateUtf8 = (value: string, maxBytes: number): string => {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
};
