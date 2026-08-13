import { randomUUID } from 'node:crypto';
import { lstat, open, rename, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { StyleDocument } from '../core/index.js';
import type { FileIdentity } from './input.js';

export type CliOutputFailureState =
  | { committed: false }
  | { committed: true; durable: false };

export interface CliOutputCleanupDetail {
  artifact: 'output' | 'temporary' | 'backup';
  path: string;
  reason:
    | 'identity-unavailable'
    | 'identity-mismatch'
    | 'unsafe-entry'
    | 'inspection-failed'
    | 'unlink-failed';
}

export interface CliOutputErrorDetails {
  cleanup: CliOutputCleanupDetail[];
}

export class CliOutputError extends Error {
  override readonly name = 'CliOutputError';

  constructor(
    message: string,
    readonly state: CliOutputFailureState = { committed: false },
    readonly details?: CliOutputErrorDetails,
  ) {
    super(message);
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface ArtifactIdentity {
  device: bigint;
  inode: bigint;
}

interface CreatedArtifact {
  artifact: CliOutputCleanupDetail['artifact'];
  path: string;
  identity?: ArtifactIdentity;
}

const captureCreatedArtifactIdentity = async (
  handle: FileHandle,
  created: CreatedArtifact,
): Promise<void> => {
  const entry = await handle.stat({ bigint: true });
  if (!entry.isFile()) {
    throw new Error(`Created ${created.artifact} artifact is not a regular file.`);
  }
  created.identity = { device: entry.dev, inode: entry.ino };
};

const outputErrorDetails = (
  cleanup: CliOutputCleanupDetail[],
): CliOutputErrorDetails | undefined => cleanup.length === 0
  ? undefined
  : { cleanup };

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
  let created: CreatedArtifact | undefined;
  try {
    const handle = await open(absolutePath, 'wx', 0o600);
    created = { artifact: 'output', path: absolutePath };
    try {
      await captureCreatedArtifactIdentity(handle, created);
      await handle.writeFile(encoded, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    const cleanupFailures: string[] = [];
    const cleanupDetails: CliOutputCleanupDetail[] = [];
    if (created !== undefined) {
      await cleanupCreatedArtifact(created, cleanupFailures, cleanupDetails);
    }
    const cleanupSuffix = cleanupFailures.length === 0
      ? ''
      : ` ${cleanupFailures.join(' ')}`;
    throw new CliOutputError(
      `Unable to write output file ${JSON.stringify(path)}: ${messageOf(error)}.${cleanupSuffix}`,
      { committed: false },
      outputErrorDetails(cleanupDetails),
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

const cleanupCreatedArtifact = async (
  created: CreatedArtifact,
  failures: string[],
  details: CliOutputCleanupDetail[],
): Promise<void> => {
  const label = created.artifact[0]?.toUpperCase()
    + created.artifact.slice(1);
  if (created.identity === undefined) {
    failures.push(`${label} cleanup skipped: created identity is unavailable.`);
    details.push({
      artifact: created.artifact,
      path: created.path,
      reason: 'identity-unavailable',
    });
    return;
  }

  let entry;
  try {
    entry = await lstat(created.path, { bigint: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    failures.push(`${label} cleanup skipped: identity inspection failed.`);
    details.push({
      artifact: created.artifact,
      path: created.path,
      reason: 'inspection-failed',
    });
    return;
  }

  let isSymbolicLink: boolean;
  let isFile: boolean;
  try {
    isSymbolicLink = entry.isSymbolicLink();
    isFile = entry.isFile();
  } catch {
    failures.push(`${label} cleanup skipped: entry inspection failed.`);
    details.push({
      artifact: created.artifact,
      path: created.path,
      reason: 'inspection-failed',
    });
    return;
  }
  if (isSymbolicLink || !isFile) {
    failures.push(`${label} cleanup skipped: pathname is not a regular file.`);
    details.push({
      artifact: created.artifact,
      path: created.path,
      reason: 'unsafe-entry',
    });
    return;
  }
  if (
    entry.dev !== created.identity.device
    || entry.ino !== created.identity.inode
  ) {
    failures.push(`${label} cleanup skipped: pathname identity changed.`);
    details.push({
      artifact: created.artifact,
      path: created.path,
      reason: 'identity-mismatch',
    });
    return;
  }

  try {
    await rm(created.path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    failures.push(`${label} cleanup failed: ${messageOf(error)}`);
    details.push({
      artifact: created.artifact,
      path: created.path,
      reason: 'unlink-failed',
    });
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
  let backupCreated: CreatedArtifact | undefined;
  let temporaryCreated: CreatedArtifact | undefined;
  let committed = false;

  try {
    await requireExpectedIdentity(stylePath, options.expectedIdentity, 'entry');

    if (options.backup) {
      await options.hooks?.beforeBackupWrite?.();
      const backupHandle = await open(backupPath, 'wx', 0o600);
      backupCreated = { artifact: 'backup', path: backupPath };
      try {
        await captureCreatedArtifactIdentity(backupHandle, backupCreated);
        await backupHandle.writeFile(options.originalBytes);
        await backupHandle.sync();
      } finally {
        await backupHandle.close();
      }
      await syncDirectoryPhase(directoryPath, 'backup', options.hooks);
    }

    const encoded = serializeStyleFile(style);
    const temporaryHandle = await open(temporaryPath, 'wx', 0o600);
    temporaryCreated = { artifact: 'temporary', path: temporaryPath };
    try {
      await captureCreatedArtifactIdentity(temporaryHandle, temporaryCreated);
      await temporaryHandle.writeFile(encoded, 'utf8');
      await temporaryHandle.sync();
    } finally {
      await temporaryHandle.close();
    }
    await options.hooks?.afterTempSync?.();
    await requireExpectedIdentity(stylePath, options.expectedIdentity, 'pre-rename');

    await rename(temporaryPath, stylePath);
    committed = true;
    temporaryCreated = undefined;
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
    const cleanupDetails: CliOutputCleanupDetail[] = [];
    if (temporaryCreated !== undefined) {
      await cleanupCreatedArtifact(
        temporaryCreated,
        cleanupFailures,
        cleanupDetails,
      );
    }
    if (backupCreated !== undefined) {
      await cleanupCreatedArtifact(backupCreated, cleanupFailures, cleanupDetails);
    }
    if (temporaryCreated !== undefined || backupCreated !== undefined) {
      try {
        await syncDirectoryPhase(directoryPath, 'backup', options.hooks);
      } catch (cleanupError) {
        cleanupFailures.push(`Directory cleanup sync failed: ${messageOf(cleanupError)}`);
      }
    }
    const primary = error instanceof CliOutputError ? error.message : messageOf(error);
    if (error instanceof CliOutputError && error.details !== undefined) {
      cleanupDetails.unshift(...error.details.cleanup);
    }
    const cleanupSuffix = cleanupFailures.length === 0
      ? ''
      : ` ${cleanupFailures.join(' ')}`;
    throw new CliOutputError(
      `Unable to replace Style file: ${primary}.${cleanupSuffix}`,
      { committed: false },
      outputErrorDetails(cleanupDetails),
    );
  }
}
