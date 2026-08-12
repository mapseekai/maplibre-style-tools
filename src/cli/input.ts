import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_MAX_STYLE_BYTES } from '../core/index.js';
import type { CliIo } from './types.js';

export class CliInputError extends Error {
  override readonly name = 'CliInputError';
}

export interface FileIdentity {
  device: bigint;
  inode: bigint;
}

export type JsonInputRead =
  | { value: unknown; source: { kind: 'stdin' } }
  | {
      value: unknown;
      source: {
        kind: 'file';
        absolutePath: string;
        identity: FileIdentity;
        originalBytes: Uint8Array;
      };
    };

export interface JsonInputReadHooks {
  afterFileStat?: () => Promise<void>;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const tooLarge = (label: string): CliInputError =>
  new CliInputError(`Input ${label} exceeds the 5 MiB UTF-8 limit.`);

const decodeAndParse = (bytes: Uint8Array, label: string): unknown => {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CliInputError(`Input ${label} is not valid UTF-8.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new CliInputError(`Invalid JSON in ${label}: ${messageOf(error)}`);
  }
};

const readStdinBytes = async (io: CliIo, label: string): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const chunk of io.stdin) {
      let bytes: Uint8Array;
      if (typeof chunk === 'string') {
        bytes = Buffer.from(chunk, 'utf8');
      } else if (chunk instanceof Uint8Array) {
        bytes = chunk;
      } else {
        throw new CliInputError(`Input ${label} produced a non-byte stream chunk.`);
      }
      total += bytes.byteLength;
      if (total > DEFAULT_MAX_STYLE_BYTES) throw tooLarge(label);
      chunks.push(bytes);
    }
  } catch (error) {
    if (error instanceof CliInputError) throw error;
    throw new CliInputError(`Unable to read ${label}: ${messageOf(error)}`);
  }
  return Buffer.concat(chunks, total);
};

const readFileInput = async (
  input: string,
  io: CliIo,
  hooks?: JsonInputReadHooks,
): Promise<JsonInputRead> => {
  const absolutePath = resolve(io.cwd, input);
  const label = JSON.stringify(input);
  try {
    const handle = await open(absolutePath, 'r');
    try {
      const descriptorStat = await handle.stat({ bigint: true });
      if (!descriptorStat.isFile()) {
        throw new CliInputError(`Input ${label} is not a regular file.`);
      }
      if (descriptorStat.size > BigInt(DEFAULT_MAX_STYLE_BYTES)) {
        throw tooLarge(label);
      }
      await hooks?.afterFileStat?.();

      const buffer = Buffer.allocUnsafe(DEFAULT_MAX_STYLE_BYTES + 1);
      let total = 0;
      while (total < buffer.byteLength) {
        const { bytesRead } = await handle.read(
          buffer,
          total,
          buffer.byteLength - total,
          total,
        );
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      if (total > DEFAULT_MAX_STYLE_BYTES) throw tooLarge(label);
      const originalBytes = Uint8Array.from(buffer.subarray(0, total));
      return {
        value: decodeAndParse(originalBytes, label),
        source: {
          kind: 'file',
          absolutePath,
          identity: { device: descriptorStat.dev, inode: descriptorStat.ino },
          originalBytes,
        },
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof CliInputError) throw error;
    throw new CliInputError(`Unable to read ${label}: ${messageOf(error)}`);
  }
};

export async function readJsonInput(
  input: string,
  io: CliIo,
  hooks?: JsonInputReadHooks,
): Promise<JsonInputRead> {
  if (input !== '-') return readFileInput(input, io, hooks);
  const label = 'stdin';
  const bytes = await readStdinBytes(io, label);
  return { value: decodeAndParse(bytes, label), source: { kind: 'stdin' } };
}
