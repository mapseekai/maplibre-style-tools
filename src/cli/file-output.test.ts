import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import type { StyleDocument } from '../core/index.js';
import {
  CliOutputError, serializeStyleFile, writeNewOutputFile,
} from './file-output.js';

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
