import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { after, describe, it } from 'node:test';
import type { StyleDocument } from '../core/index.js';
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


const makeIo = (
  cwd: string,
  stdinText: string | Buffer = '',
  stdout: Writable = new BufferWriter(),
  stderr: Writable = new BufferWriter(),
) => ({
  stdin: Readable.from([stdinText]), stdout, stderr, cwd,
});


const validStyle = { version: 8, sources: {}, layers: [] };
const temporaryDirectories: string[] = [];


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
  it('writes capability envelopes for valid and invalid style documents', async () => {
    const cwd = await makeDirectory();
    await writeFile(join(cwd, 'valid.json'), JSON.stringify(validStyle));
    await writeFile(join(cwd, 'invalid.json'), JSON.stringify({ ...validStyle, version: 7 }));
    const validIo = makeIo(cwd);
    assert.equal(await runCli(['validate', 'valid.json'], validIo), 0);
    assert.equal(JSON.parse((validIo.stdout as BufferWriter).text).success, true);
    const invalidIo = makeIo(cwd);
    assert.equal(await runCli(['validate', 'invalid.json'], invalidIo), 1);
    assert.equal(JSON.parse((invalidIo.stdout as BufferWriter).text).success, false);
  });
});

describe('runCli inspect', () => {
  const style = {
    version: 8,
    sources: {
      points: {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } }],
        },
      },
    },
    layers: [{ id: 'points', type: 'circle', source: 'points' }],
  };

  it('maps every flag mode to an inspection capability envelope', async () => {
    const cwd = await makeDirectory();
    const stylePath = join(cwd, 'style.json');
    await writeFile(stylePath, JSON.stringify(style));
    for (const argv of [
      ['inspect', stylePath],
      ['inspect', stylePath, '--layer', 'points'],
      ['inspect', stylePath, '--source-id', 'points'],
      ['inspect', stylePath, '--source-layers'],
      ['inspect', stylePath, '--query', 'point'],
      ['inspect', stylePath, '--analyze-geojson', 'points'],
    ]) {
      const io = makeIo(cwd);
      assert.equal(
        await runCli(argv, io),
        0,
        `${argv.join(' ')}: ${(io.stderr as BufferWriter).text} ${(io.stdout as BufferWriter).text}`,
      );
      const output = JSON.parse((io.stdout as BufferWriter).text) as {
        success: boolean; data: { action: string };
      };
      assert.equal(output.success, true);
      assert.equal(typeof output.data.action, 'string');
    }
  });

  it('uses capability failures for missing resources', async () => {
    const cwd = await makeDirectory();
    const stylePath = join(cwd, 'style.json');
    await writeFile(stylePath, JSON.stringify(style));
    const io = makeIo(cwd);
    assert.equal(await runCli(['inspect', stylePath, '--layer', 'missing'], io), 1);
    assert.equal(JSON.parse((io.stdout as BufferWriter).text).success, false);
  });
});

describe('runCli apply', () => {
  const style: StyleDocument = {
    version: 8,
    sources: { base: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] } },
    layers: [{ id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads' }],
  };
  const operations = [{
    op: 'setLayerProperties',
    layerId: 'roads',
    paint: { 'line-color': '#ffffff' },
  }];

  it('dry-runs without writing and returns a capability receipt', async () => {
    const cwd = await makeDirectory();
    const stylePath = join(cwd, 'style.json');
    const operationsPath = join(cwd, 'operations.json');
    await writeFile(stylePath, JSON.stringify(style));
    await writeFile(operationsPath, JSON.stringify(operations));
    const before = await readFile(stylePath);
    const io = makeIo(cwd);
    assert.equal(await runCli(['apply', stylePath, '--operations', operationsPath, '--dry-run'], io), 0);
    const output = JSON.parse((io.stdout as BufferWriter).text) as {
      success: boolean; data: { applied: boolean; styleAuthority: string };
    };
    assert.equal(output.success, true);
    assert.equal(output.data.applied, false);
    assert.equal(output.data.styleAuthority, 'not-checked');
    assert.deepEqual(await readFile(stylePath), before);
  });

  it('writes --output only after a successful capability transaction', async () => {
    const cwd = await makeDirectory();
    const stylePath = join(cwd, 'style.json');
    const operationsPath = join(cwd, 'operations.json');
    const outputPath = join(cwd, 'output.json');
    await writeFile(stylePath, JSON.stringify(style));
    await writeFile(operationsPath, JSON.stringify(operations));
    const io = makeIo(cwd);
    assert.equal(await runCli([
      'apply', stylePath, '--operations', operationsPath, '--output', outputPath,
    ], io), 0);
    assert.equal(JSON.parse((io.stdout as BufferWriter).text).success, true);
    assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).layers[0].paint['line-color'], '#ffffff');
  });

  it('returns capability failures and preserves argument and JSON input exit codes', async () => {
    const cwd = await makeDirectory();
    const stylePath = join(cwd, 'style.json');
    const operationsPath = join(cwd, 'operations.json');
    await writeFile(stylePath, JSON.stringify(style));
    await writeFile(operationsPath, JSON.stringify({}));
    const failureIo = makeIo(cwd);
    assert.equal(await runCli(['apply', stylePath, '--operations', operationsPath], failureIo), 1);
    assert.equal(JSON.parse((failureIo.stdout as BufferWriter).text).success, false);
    const usageIo = makeIo(cwd);
    assert.equal(await runCli(['apply', stylePath], usageIo), 2);
    await writeFile(operationsPath, '{');
    const inputIo = makeIo(cwd);
    assert.equal(await runCli(['apply', stylePath, '--operations', operationsPath], inputIo), 2);
  });
});
