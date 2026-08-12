import assert from 'node:assert/strict';
import {
  mkdtemp, open, readFile, readdir, rename, rm, stat, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { after, describe, it } from 'node:test';
import type { StyleDocument } from '../core/index.js';
import {
  CliOutputError, replaceStyleFileAtomically, serializeStyleFile,
  temporaryStylePath, writeNewOutputFile,
} from './file-output.js';
import { readJsonInput } from './input.js';

const style: StyleDocument = {
  version: 8,
  sources: {},
  layers: [{
    id: 'background', type: 'background',
    paint: { 'background-color': '#000000' },
  }],
};

const temporaryDirectories: string[] = [];
const makeDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'maplibre-style-output-'));
  temporaryDirectories.push(directory);
  return directory;
};

const sink = (): Writable => new Writable({
  write(_chunk, _encoding, callback): void {
    callback();
  },
});

const readFileSource = async (path: string) => {
  const read = await readJsonInput(path, {
    stdin: Readable.from([]), stdout: sink(), stderr: sink(), cwd: dirname(path),
  });
  assert.equal(read.source.kind, 'file');
  if (read.source.kind !== 'file') assert.fail('expected file source');
  return read.source;
};

const nextStyle = (): StyleDocument => ({
  ...style,
  layers: [{
    id: 'background',
    type: 'background',
    paint: { 'background-color': '#ffffff' },
  }],
});

const tempArtifacts = async (directory: string): Promise<string[]> =>
  (await readdir(directory)).filter((name) => name.startsWith('.') && name.endsWith('.tmp'));

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('separate CLI output files', () => {
  it('serializes compactly and creates an exclusive 0600 file relative to cwd', async () => {
    const cwd = await makeDirectory();
    assert.equal(serializeStyleFile(style), JSON.stringify(style));
    await writeNewOutputFile('next.json', style, cwd);
    const outputPath = join(cwd, 'next.json');
    assert.equal(await readFile(outputPath, 'utf8'), JSON.stringify(style));
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);

    await writeFile(outputPath, 'original');
    await assert.rejects(
      writeNewOutputFile('next.json', style, cwd),
      CliOutputError,
    );
    assert.equal(await readFile(outputPath, 'utf8'), 'original');
  });

  it('removes only its newly created target after injected write and sync failures', async () => {
    const cwd = await makeDirectory();
    const probePath = join(cwd, 'probe');
    const probe = await open(probePath, 'wx', 0o600);
    const prototype = Object.getPrototypeOf(probe) as object;
    await probe.close();
    await rm(probePath);

    for (const method of ['writeFile', 'sync'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
      assert.notEqual(descriptor, undefined);
      Object.defineProperty(prototype, method, {
        ...descriptor,
        value: async () => {
          throw new Error(`injected ${method} failure`);
        },
      });
      const outputPath = join(cwd, `${method}.json`);
      try {
        await assert.rejects(
          writeNewOutputFile(outputPath, style, cwd),
          (error: unknown) => error instanceof CliOutputError
            && error.state.committed === false,
        );
        await assert.rejects(stat(outputPath), { code: 'ENOENT' });
      } finally {
        if (descriptor !== undefined) {
          Object.defineProperty(prototype, method, descriptor);
        }
      }
    }
  });
});

describe('atomic in-place Style replacement', () => {
  it('uses a same-directory temp, preserves exact backup bytes, and cleans artifacts', async () => {
    assert.equal(
      temporaryStylePath('/work/styles/map.json', 'fixed-token'),
      '/work/styles/.map.json.fixed-token.tmp',
    );
    const cwd = await makeDirectory();
    const stylePath = join(cwd, 'style.json');
    const originalBytes = Buffer.from(`${JSON.stringify(style, null, 2)}\n`);
    await writeFile(stylePath, originalBytes);
    const source = await readFileSource(stylePath);
    const phases: string[] = [];
    await replaceStyleFileAtomically(stylePath, nextStyle(), {
      backup: true,
      expectedIdentity: source.identity,
      originalBytes: source.originalBytes,
      hooks: {
        syncDirectory: async (_directory, phase) => {
          phases.push(phase);
        },
      },
    });
    assert.equal(await readFile(stylePath, 'utf8'), JSON.stringify(nextStyle()));
    assert.deepEqual(await readFile(`${stylePath}.bak`), originalBytes);
    assert.deepEqual(phases, ['backup', 'replacement']);
    assert.deepEqual(await tempArtifacts(cwd), []);
  });

  it('rejects symlinks and entry/final identity replacements before commit', async () => {
    const cwd = await makeDirectory();
    const targetPath = join(cwd, 'target.json');
    const linkPath = join(cwd, 'style-link.json');
    await writeFile(targetPath, JSON.stringify(style));
    await symlink(targetPath, linkPath);
    const linkSource = await readFileSource(linkPath);
    await assert.rejects(
      replaceStyleFileAtomically(linkPath, nextStyle(), {
        backup: true,
        expectedIdentity: linkSource.identity,
        originalBytes: linkSource.originalBytes,
      }),
      (error: unknown) => error instanceof CliOutputError
        && error.state.committed === false,
    );
    assert.equal(await readFile(targetPath, 'utf8'), JSON.stringify(style));
    await assert.rejects(stat(`${linkPath}.bak`), { code: 'ENOENT' });

    const entryPath = join(cwd, 'entry.json');
    const entryAside = join(cwd, 'entry-original.json');
    await writeFile(entryPath, JSON.stringify(style));
    const entrySource = await readFileSource(entryPath);
    await rename(entryPath, entryAside);
    await writeFile(entryPath, 'foreign entry');
    await assert.rejects(
      replaceStyleFileAtomically(entryPath, nextStyle(), {
        backup: true,
        expectedIdentity: entrySource.identity,
        originalBytes: entrySource.originalBytes,
      }),
      (error: unknown) => error instanceof CliOutputError
        && error.state.committed === false,
    );
    assert.equal(await readFile(entryPath, 'utf8'), 'foreign entry');
    await assert.rejects(stat(`${entryPath}.bak`), { code: 'ENOENT' });

    const finalPath = join(cwd, 'final.json');
    const finalAside = join(cwd, 'final-original.json');
    await writeFile(finalPath, JSON.stringify(style));
    const finalSource = await readFileSource(finalPath);
    await assert.rejects(
      replaceStyleFileAtomically(finalPath, nextStyle(), {
        backup: false,
        expectedIdentity: finalSource.identity,
        originalBytes: finalSource.originalBytes,
        hooks: {
          afterTempSync: async () => {
            await rename(finalPath, finalAside);
            await writeFile(finalPath, 'foreign final');
          },
        },
      }),
      (error: unknown) => error instanceof CliOutputError
        && error.state.committed === false,
    );
    assert.equal(await readFile(finalPath, 'utf8'), 'foreign final');
    assert.deepEqual(await tempArtifacts(cwd), []);
  });

  it('backs up descriptor bytes through transient races and removes its backup on failure', async () => {
    const cwd = await makeDirectory();
    const stylePath = join(cwd, 'transient.json');
    const asidePath = join(cwd, 'transient-aside.json');
    const originalBytes = Buffer.from(`${JSON.stringify(style)}\n`);
    await writeFile(stylePath, originalBytes);
    const source = await readFileSource(stylePath);
    await replaceStyleFileAtomically(stylePath, nextStyle(), {
      backup: true,
      expectedIdentity: source.identity,
      originalBytes: source.originalBytes,
      hooks: {
        beforeBackupWrite: async () => {
          await rename(stylePath, asidePath);
          await writeFile(stylePath, 'transient foreign bytes');
          await rm(stylePath);
          await rename(asidePath, stylePath);
        },
        syncDirectory: async () => {},
      },
    });
    assert.deepEqual(await readFile(`${stylePath}.bak`), originalBytes);

    const failedPath = join(cwd, 'failed.json');
    const failedAside = join(cwd, 'failed-aside.json');
    await writeFile(failedPath, originalBytes);
    const failedSource = await readFileSource(failedPath);
    const phases: string[] = [];
    await assert.rejects(
      replaceStyleFileAtomically(failedPath, nextStyle(), {
        backup: true,
        expectedIdentity: failedSource.identity,
        originalBytes: failedSource.originalBytes,
        hooks: {
          afterTempSync: async () => {
            await rename(failedPath, failedAside);
            await writeFile(failedPath, 'foreign after backup');
          },
          syncDirectory: async (_directory, phase) => {
            phases.push(phase);
          },
        },
      }),
      (error: unknown) => error instanceof CliOutputError
        && error.state.committed === false,
    );
    assert.equal(await readFile(failedPath, 'utf8'), 'foreign after backup');
    await assert.rejects(stat(`${failedPath}.bak`), { code: 'ENOENT' });
    assert.equal(phases.filter((phase) => phase === 'backup').length >= 2, true);
    assert.deepEqual(await tempArtifacts(cwd), []);
  });

  it('reports non-portable post-rename sync failures as committed but not durable', async () => {
    const cwd = await makeDirectory();
    const stylePath = join(cwd, 'style.json');
    await writeFile(stylePath, JSON.stringify(style));
    const source = await readFileSource(stylePath);
    const eio = Object.assign(new Error('directory sync failed'), { code: 'EIO' });
    await assert.rejects(
      replaceStyleFileAtomically(stylePath, nextStyle(), {
        backup: false,
        expectedIdentity: source.identity,
        originalBytes: source.originalBytes,
        hooks: {
          syncDirectory: async (_directory, phase) => {
            if (phase === 'replacement') throw eio;
          },
        },
      }),
      (error: unknown) => error instanceof CliOutputError
        && error.state.committed === true
        && error.state.durable === false,
    );
    assert.equal(await readFile(stylePath, 'utf8'), JSON.stringify(nextStyle()));
    assert.deepEqual(await tempArtifacts(cwd), []);

    const portablePath = join(cwd, 'portable.json');
    await writeFile(portablePath, JSON.stringify(style));
    const portableSource = await readFileSource(portablePath);
    const unsupported = Object.assign(new Error('unsupported'), { code: 'EINVAL' });
    await replaceStyleFileAtomically(portablePath, nextStyle(), {
      backup: false,
      expectedIdentity: portableSource.identity,
      originalBytes: portableSource.originalBytes,
      hooks: {
        syncDirectory: async (_directory, phase) => {
          if (phase === 'replacement') throw unsupported;
        },
      },
    });
    assert.equal(await readFile(portablePath, 'utf8'), JSON.stringify(nextStyle()));
  });
});
