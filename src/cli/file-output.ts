import { randomUUID } from 'node:crypto';
import { lstat, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { StyleDocument } from '../core/index.js';
import type { FileIdentity } from './input.js';

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

export interface AtomicReplaceHooks {
  beforeBackupWrite?: () => Promise<void>;
  afterTempSync?: () => Promise<void>;
  syncDirectory?: (
    directoryPath: string,
    phase: 'backup' | 'replacement',
  ) => Promise<void>;
}

export interface AtomicReplaceOptions {
  backup: boolean;
  expectedIdentity: FileIdentity;
  originalBytes: Uint8Array;
  hooks?: AtomicReplaceHooks;
}

export const temporaryStylePath = (stylePath: string, token: string): string =>
  join(dirname(stylePath), `.${basename(stylePath)}.${token}.tmp`);

const errorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return descriptor !== undefined && 'value' in descriptor
    && typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
};

const unsupportedDirectorySync = (error: unknown): boolean => {
  const code = errorCode(error);
  return code === 'EINVAL' || code === 'ENOTSUP';
};

const syncDirectoryDefault = async (directoryPath: string): Promise<void> => {
  const handle = await open(directoryPath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const syncDirectoryPhase = async (
  directoryPath: string,
  phase: 'backup' | 'replacement',
  hooks: AtomicReplaceHooks | undefined,
): Promise<void> => {
  try {
    await (hooks?.syncDirectory ?? syncDirectoryDefault)(directoryPath, phase);
  } catch (error) {
    if (!unsupportedDirectorySync(error)) throw error;
  }
};

const requireExpectedIdentity = async (
  stylePath: string,
  expected: FileIdentity,
  phase: 'entry' | 'pre-rename',
): Promise<void> => {
  let entry;
  try {
    entry = await lstat(stylePath, { bigint: true });
  } catch (error) {
    throw new CliOutputError(
      `Style path identity check failed at ${phase}: ${messageOf(error)}`,
    );
  }
  if (
    entry.isSymbolicLink()
    || !entry.isFile()
    || entry.dev !== expected.device
    || entry.ino !== expected.inode
  ) {
    throw new CliOutputError(`Style path identity changed at ${phase}.`);
  }
};

const cleanupCreatedPath = async (
  path: string,
  label: string,
  failures: string[],
): Promise<void> => {
  try {
    await rm(path, { force: true });
  } catch (error) {
    failures.push(`${label} cleanup failed: ${messageOf(error)}`);
  }
};

/**
 * Atomically installs a compact Style after best-effort pathname identity checks.
 * Node has no portable compare-and-swap rename, so a replacement in the narrow
 * interval between the final lstat and rename cannot be detected.
 */
export async function replaceStyleFileAtomically(
  path: string,
  style: StyleDocument,
  options: AtomicReplaceOptions,
): Promise<void> {
  const stylePath = resolve(path);
  const directoryPath = dirname(stylePath);
  const backupPath = `${stylePath}.bak`;
  const temporaryPath = temporaryStylePath(
    stylePath,
    `${process.pid}.${randomUUID()}`,
  );
  let backupCreated = false;
  let temporaryCreated = false;
  let committed = false;

  try {
    await requireExpectedIdentity(stylePath, options.expectedIdentity, 'entry');

    if (options.backup) {
      await options.hooks?.beforeBackupWrite?.();
      const backupHandle = await open(backupPath, 'wx', 0o600);
      backupCreated = true;
      try {
        await backupHandle.writeFile(options.originalBytes);
        await backupHandle.sync();
      } finally {
        await backupHandle.close();
      }
      await syncDirectoryPhase(directoryPath, 'backup', options.hooks);
    }

    const encoded = serializeStyleFile(style);
    const temporaryHandle = await open(temporaryPath, 'wx', 0o600);
    temporaryCreated = true;
    try {
      await temporaryHandle.writeFile(encoded, 'utf8');
      await temporaryHandle.sync();
    } finally {
      await temporaryHandle.close();
    }
    await options.hooks?.afterTempSync?.();
    await requireExpectedIdentity(stylePath, options.expectedIdentity, 'pre-rename');

    await rename(temporaryPath, stylePath);
    committed = true;
    temporaryCreated = false;
    try {
      await syncDirectoryPhase(directoryPath, 'replacement', options.hooks);
    } catch (error) {
      throw new CliOutputError(
        `Style file was committed, but directory durability is uncertain: ${messageOf(error)}`,
        { committed: true, durable: false },
      );
    }
  } catch (error) {
    if (committed) {
      if (error instanceof CliOutputError && error.state.committed) throw error;
      throw new CliOutputError(
        `Style file was committed, but directory durability is uncertain: ${messageOf(error)}`,
        { committed: true, durable: false },
      );
    }

    const cleanupFailures: string[] = [];
    if (temporaryCreated) {
      await cleanupCreatedPath(temporaryPath, 'Temporary file', cleanupFailures);
    }
    if (backupCreated) {
      await cleanupCreatedPath(backupPath, 'Backup file', cleanupFailures);
    }
    if (temporaryCreated || backupCreated) {
      try {
        await syncDirectoryPhase(directoryPath, 'backup', options.hooks);
      } catch (cleanupError) {
        cleanupFailures.push(`Directory cleanup sync failed: ${messageOf(cleanupError)}`);
      }
    }
    const primary = error instanceof CliOutputError ? error.message : messageOf(error);
    const cleanupSuffix = cleanupFailures.length === 0
      ? ''
      : ` ${cleanupFailures.join(' ')}`;
    throw new CliOutputError(`Unable to replace Style file: ${primary}.${cleanupSuffix}`);
  }
}
