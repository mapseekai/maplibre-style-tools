import assert from 'node:assert/strict';
import { mkdtemp, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { after, describe, it } from 'node:test';
import { DEFAULT_MAX_STYLE_BYTES } from '../core/index.js';
import { readJsonInput } from './input.js';
import { runCli } from './run.js';

class BufferWriter extends Writable {
  readonly chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  get text(): string {
    return this.chunks.join('');
  }
}

class CallbackErrorWriter extends Writable {
  constructor(private readonly failure: Error) {
    super();
  }

  override _write(
    _chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    callback(this.failure);
  }
}

const immediate = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const makeIo = (
  cwd: string,
  stdinText: string | Buffer = '',
  stdout: Writable = new BufferWriter(),
  stderr: Writable = new BufferWriter(),
) => ({
  stdin: Readable.from([stdinText]), stdout, stderr, cwd,
});

const closeWriter = async (): Promise<Writable> => {
  const stream = new BufferWriter();
  const closed = new Promise<void>((resolve) => stream.once('close', resolve));
  stream.destroy();
  await closed;
  return stream;
};

const validStyle = { version: 8, sources: {}, layers: [] };
const temporaryDirectories: string[] = [];

const styleTextAtBytes = (character: string, bytes: number): string => {
  const base = {
    ...validStyle,
    metadata: { padding: '' },
  };
  const baseBytes = Buffer.byteLength(JSON.stringify(base));
  const characterBytes = Buffer.byteLength(character);
  const repeated = Math.floor((bytes - baseBytes) / characterBytes);
  const remainder = bytes - baseBytes - repeated * characterBytes;
  return JSON.stringify({
    ...base,
    metadata: { padding: character.repeat(repeated) + 'a'.repeat(remainder) },
  });
};

const makeDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'maplibre-style-cli-'));
  temporaryDirectories.push(directory);
  return directory;
};

after(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('runCli validate', () => {
  it('validates files, semantic failures, malformed JSON, and stdin', async () => {
    const cwd = await makeDirectory();
    await writeFile(join(cwd, 'valid.json'), JSON.stringify(validStyle));
    await writeFile(join(cwd, 'invalid.json'), JSON.stringify({ ...validStyle, version: 7 }));
    await writeFile(join(cwd, 'malformed.json'), '{');

    const validIo = makeIo(cwd);
    assert.equal(await runCli(['validate', 'valid.json'], validIo), 0);
    assert.deepEqual(JSON.parse((validIo.stdout as BufferWriter).text), {
      ok: true, errors: [], warnings: [],
    });
    assert.equal((validIo.stderr as BufferWriter).text, '');

    const invalidIo = makeIo(cwd);
    assert.equal(await runCli(['validate', 'invalid.json'], invalidIo), 1);
    assert.equal(JSON.parse((invalidIo.stdout as BufferWriter).text).ok, false);
    assert.equal((invalidIo.stderr as BufferWriter).text, '');

    const malformedIo = makeIo(cwd);
    assert.equal(await runCli(['validate', 'malformed.json'], malformedIo), 2);
    assert.equal((malformedIo.stdout as BufferWriter).text, '');
    assert.match((malformedIo.stderr as BufferWriter).text, /Invalid JSON/);

    const stdinIo = makeIo(cwd, JSON.stringify(validStyle));
    assert.equal(await runCli(['validate', '-'], stdinIo), 0);
    assert.equal(JSON.parse((stdinIo.stdout as BufferWriter).text).ok, true);
  });

  it('counts UTF-8 input bytes, rejects invalid UTF-8, and bounds file reads', async () => {
    const cwd = await makeDirectory();
    const multibyte = `"${'你'.repeat(Math.ceil(DEFAULT_MAX_STYLE_BYTES / 3))}"`;
    assert.ok(multibyte.length < DEFAULT_MAX_STYLE_BYTES);
    assert.ok(Buffer.byteLength(multibyte) > DEFAULT_MAX_STYLE_BYTES);
    const oversizedIo = makeIo(cwd, multibyte);
    assert.equal(await runCli(['validate', '-'], oversizedIo), 2);
    assert.match((oversizedIo.stderr as BufferWriter).text, /exceeds.*5 MiB/i);

    const invalidUtf8Io = makeIo(cwd, Buffer.from([0xc3, 0x28]));
    assert.equal(await runCli(['validate', '-'], invalidUtf8Io), 2);
    assert.match((invalidUtf8Io.stderr as BufferWriter).text, /UTF-8/);

    await writeFile(join(cwd, 'large.json'), Buffer.alloc(DEFAULT_MAX_STYLE_BYTES + 1, 0x20));
    const largeFileIo = makeIo(cwd);
    assert.equal(await runCli(['validate', 'large.json'], largeFileIo), 2);
    assert.match((largeFileIo.stderr as BufferWriter).text, /exceeds.*5 MiB/i);

    for (const character of ['你', '😀']) {
      const exactText = styleTextAtBytes(character, DEFAULT_MAX_STYLE_BYTES);
      assert.equal(Buffer.byteLength(exactText), DEFAULT_MAX_STYLE_BYTES);
      assert.ok(exactText.length < DEFAULT_MAX_STYLE_BYTES);
      const exactIo = makeIo(cwd, exactText);
      assert.equal(await runCli(['validate', '-'], exactIo), 0);

      const overText = styleTextAtBytes(character, DEFAULT_MAX_STYLE_BYTES + 1);
      assert.ok(overText.length < DEFAULT_MAX_STYLE_BYTES);
      const overIo = makeIo(cwd, overText);
      assert.equal(await runCli(['validate', '-'], overIo), 2);
      assert.match((overIo.stderr as BufferWriter).text, /exceeds.*5 MiB/i);
    }

    const chunksIo = {
      ...makeIo(cwd),
      stdin: Readable.from(['{"version":', '8,"sources":{},', '"layers":[]}']),
    };
    assert.equal(await runCli(['validate', '-'], chunksIo), 0);
  });

  it('reads bytes and identity from the already-open descriptor during a path race', async () => {
    const cwd = await makeDirectory();
    const inputPath = join(cwd, 'style.json');
    const movedPath = join(cwd, 'original.json');
    const replacementPath = join(cwd, 'replacement.json');
    const originalText = JSON.stringify(validStyle);
    const replacement = { version: 8, sources: {}, layers: [], name: 'replacement' };
    await writeFile(inputPath, originalText);
    await writeFile(replacementPath, JSON.stringify(replacement));

    const read = await readJsonInput(inputPath, makeIo(cwd), {
      afterFileStat: async () => {
        await rename(inputPath, movedPath);
        await rename(replacementPath, inputPath);
      },
    });
    assert.deepEqual(read.value, validStyle);
    assert.equal(read.source.kind, 'file');
    if (read.source.kind === 'file') {
      const originalStat = await stat(movedPath, { bigint: true });
      assert.deepEqual(read.source.identity, {
        device: originalStat.dev, inode: originalStat.ino,
      });
      assert.equal(Buffer.from(read.source.originalBytes).toString('utf8'), originalText);
    }
  });

  it('rejects a file that grows beyond the bound after descriptor fstat', async () => {
    const cwd = await makeDirectory();
    const inputPath = join(cwd, 'growing.json');
    await writeFile(inputPath, JSON.stringify(validStyle));
    await assert.rejects(
      readJsonInput(inputPath, makeIo(cwd), {
        afterFileStat: async () => {
          await writeFile(inputPath, Buffer.alloc(DEFAULT_MAX_STYLE_BYTES + 1, 0x20));
        },
      }),
      /exceeds.*5 MiB/i,
    );
  });

  it('maps stdout and stderr failures without uncaught stream errors', async () => {
    const cwd = await makeDirectory();
    await writeFile(join(cwd, 'valid.json'), JSON.stringify(validStyle));
    await writeFile(join(cwd, 'malformed.json'), '{');
    const epipe = Object.assign(new Error('broken pipe'), { code: 'EPIPE' });

    const stderr = new BufferWriter();
    const outputFailureIo = makeIo(cwd, '', new CallbackErrorWriter(epipe), stderr);
    assert.equal(await runCli(['validate', 'valid.json'], outputFailureIo), 3);
    assert.match(stderr.text, /output/i);

    const malformedClosedIo = makeIo(cwd, '', new BufferWriter(), await closeWriter());
    assert.equal(await runCli(['validate', 'malformed.json'], malformedClosedIo), 2);

    const bothClosedIo = makeIo(cwd, '', await closeWriter(), await closeWriter());
    assert.equal(await runCli(['validate', 'valid.json'], bothClosedIo), 3);
    await immediate();
  });
});
