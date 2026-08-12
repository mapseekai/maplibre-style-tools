import { open, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { StyleDocument } from '../core/index.js';

export type CliOutputFailureState =
  | { committed: false }
  | { committed: true; durable: false };

export class CliOutputError extends Error {
  override readonly name = 'CliOutputError';

  constructor(
    message: string,
    readonly state: CliOutputFailureState = { committed: false },
  ) {
    super(message);
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function serializeStyleFile(style: StyleDocument): string {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(style);
  } catch (error) {
    throw new CliOutputError(`Unable to serialize Style output: ${messageOf(error)}`);
  }
  if (encoded === undefined) {
    throw new CliOutputError('Unable to serialize Style output.');
  }
  return encoded;
}

export async function writeNewOutputFile(
  path: string,
  style: StyleDocument,
  cwd: string,
): Promise<void> {
  const absolutePath = resolve(cwd, path);
  const encoded = serializeStyleFile(style);
  let created = false;
  try {
    const handle = await open(absolutePath, 'wx', 0o600);
    created = true;
    try {
      await handle.writeFile(encoded, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    let cleanupMessage = '';
    if (created) {
      try {
        await rm(absolutePath);
      } catch (cleanupError) {
        cleanupMessage = ` Cleanup failed: ${messageOf(cleanupError)}`;
      }
    }
    throw new CliOutputError(
      `Unable to write output file ${JSON.stringify(path)}: ${messageOf(error)}.${cleanupMessage}`,
    );
  }
}
