import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtemp, readFile, readdir, rm, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, describe, it } from 'node:test';
import {
  DEFAULT_MAX_STYLE_BYTES, jsonUtf8ByteLength,
} from '../core/index.js';
import type { JsonValue, StyleDocument } from '../core/index.js';

interface SpawnResult {
  code: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const mainPath = resolve('.tmp/test-dist/cli/main.js');
const temporaryDirectories: string[] = [];

const makeDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'maplibre-style-spawn-'));
  temporaryDirectories.push(directory);
  return directory;
};

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

const spawnProcess = (
  arguments_: readonly string[],
  options: { stdinText?: string; closeStdout?: boolean; cwd?: string } = {},
): Promise<SpawnResult> => new Promise((resolveResult, reject) => {
  const child = spawn(process.execPath, [...arguments_], {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  if (options.closeStdout) child.stdout.destroy();
  else child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
  timeout.unref();
  child.once('error', (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.once('close', (code, signal) => {
    clearTimeout(timeout);
    resolveResult({
      code: code ?? 128,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    });
  });
  child.stdin.end(options.stdinText ?? '');
});

const spawnCli = (
  argv: readonly string[],
  stdinText = '',
  cwd?: string,
): Promise<SpawnResult> =>
  spawnProcess([mainPath, ...argv], { stdinText, cwd });

const spawnCliWithClosedStdout = (
  argv: readonly string[],
  cwd?: string,
): Promise<SpawnResult> =>
  spawnProcess([mainPath, ...argv], { closeStdout: true, cwd });

const spawnEval = (source: string): Promise<SpawnResult> =>
  spawnProcess(['--input-type=module', '--eval', source]);

const baseStyle: StyleDocument = {
  version: 8,
  sources: {},
  layers: [{
    id: 'background', type: 'background',
    paint: { 'background-color': '#000000' },
  }],
};

const operations: JsonValue = [{
  op: 'setLayerProperties', layerId: 'background',
  paint: { 'background-color': '#ffffff' },
}];

const makeExactStyle = (): StyleDocument => {
  const style = {
    ...baseStyle,
    metadata: { padding: '' },
  } satisfies StyleDocument;
  style.metadata.padding = 'a'.repeat(
    DEFAULT_MAX_STYLE_BYTES - jsonUtf8ByteLength(style),
  );
  assert.equal(jsonUtf8ByteLength(style), DEFAULT_MAX_STYLE_BYTES);
  return style;
};

describe('compiled CLI process contract', () => {
  it('maps help, success, argument, semantic, and output failures to exit codes', async () => {
    const cwd = await makeDirectory();
    const stylePath = join(cwd, 'style.json');
    const invalidOperationsPath = join(cwd, 'invalid-operations.json');
    const operationsPath = join(cwd, 'operations.json');
    await writeFile(stylePath, JSON.stringify(baseStyle));
    await writeFile(invalidOperationsPath, JSON.stringify({ invalid: true }));
    await writeFile(operationsPath, JSON.stringify(operations));

    const success = await spawnCli(['validate', stylePath]);
    assert.equal(success.code, 0);
    assert.doesNotThrow(() => JSON.parse(success.stdout));
    assert.equal(success.stderr, '');

    const help = await spawnCli(['--help']);
    assert.equal(help.code, 0);
    const helpJson = JSON.parse(help.stdout) as { ok: boolean; usage: string[] };
    assert.equal(helpJson.ok, true);
    assert.ok(helpJson.usage.includes('maplibre-style validate STYLE'));
    assert.equal(help.stderr, '');

    assert.equal((await spawnCli([
      'apply', '-', '--operations', '-',
    ], '{}')).code, 2);
    assert.equal((await spawnCli([
      'apply', stylePath, '--operations', invalidOperationsPath,
    ])).code, 1);
    assert.equal((await spawnCli([
      'apply', stylePath, '--operations', operationsPath,
      '--output', cwd,
    ])).code, 3);
  });

  it('supports stdin, dry-run, and separate output without mutating the input', async () => {
    const cwd = await makeDirectory();
    const stylePath = join(cwd, 'style.json');
    const operationsPath = join(cwd, 'operations.json');
    const outputPath = join(cwd, 'output.json');
    const styleBytes = Buffer.from(JSON.stringify(baseStyle));
    await writeFile(stylePath, styleBytes);
    await writeFile(operationsPath, JSON.stringify(operations));

    const stdinValidate = await spawnCli(['validate', '-'], styleBytes.toString('utf8'));
    assert.equal(stdinValidate.code, 0);
    const stdinApply = await spawnCli([
      'apply', '-', '--operations', operationsPath, '--dry-run',
    ], styleBytes.toString('utf8'));
    assert.equal(stdinApply.code, 0);
    const stdinApplyResult = JSON.parse(stdinApply.stdout) as {
      success: boolean;
      data: { applied: boolean; diff: Array<{ after?: unknown }> };
    };
    assert.equal(stdinApplyResult.success, true);
    assert.equal(stdinApplyResult.data.applied, false);
    assert.ok(stdinApplyResult.data.diff.some((entry) => entry.after === '#ffffff'));

    const dryRun = await spawnCli([
      'apply', stylePath, '--operations', operationsPath, '--dry-run',
    ]);
    assert.equal(dryRun.code, 0);
    assert.deepEqual(await readFile(stylePath), styleBytes);

    const output = await spawnCli([
      'apply', stylePath, '--operations', operationsPath, '--output', outputPath,
    ]);
    assert.equal(output.code, 0);
    assert.equal(output.stderr, '');
    assert.deepEqual(await readFile(stylePath), styleBytes);
    assert.equal(
      (JSON.parse(await readFile(outputPath, 'utf8')) as StyleDocument)
        .layers[0]?.paint?.['background-color'],
      '#ffffff',
    );
  });

  it('survives EPIPE after committing an exact-boundary output', async () => {
    const cwd = await makeDirectory();
    const stylePath = join(cwd, 'exact.json');
    const operationsPath = join(cwd, 'operations.json');
    const outputPath = join(cwd, 'output.json');
    await writeFile(stylePath, JSON.stringify(makeExactStyle()));
    await writeFile(operationsPath, JSON.stringify(operations));
    const result = await spawnCliWithClosedStdout([
      'apply', stylePath, '--operations', operationsPath, '--output', outputPath,
    ]);
    assert.equal(result.code, 3);
    assert.match(
      result.stderr,
      /File committed.*do not retry as though no file was written/i,
    );
    const outputBytes = await readFile(outputPath);
    assert.equal(outputBytes.byteLength, DEFAULT_MAX_STYLE_BYTES);
    assert.equal((await spawnCli(['validate', outputPath])).code, 0);
  });

  it('survives already-closed stdout and stderr without uncaught errors', async () => {
    const cwd = await makeDirectory();
    const stylePath = join(cwd, 'style.json');
    await writeFile(stylePath, JSON.stringify(baseStyle));
    const runModuleUrl = pathToFileURL(
      resolve('.tmp/test-dist/cli/run.js'),
    ).href;
    const harnessSource = (closeStderr: boolean): string => `
      import { once } from 'node:events';
      import { Writable } from 'node:stream';
      import { runCli } from ${JSON.stringify(runModuleUrl)};
      const makeClosed = async () => {
        const stream = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
        stream.destroy();
        if (!stream.closed) await once(stream, 'close');
        return stream;
      };
      const stdout = await makeClosed();
      const closedStderr = ${closeStderr ? 'await makeClosed()' : 'process.stderr'};
      process.exitCode = await runCli(['validate', ${JSON.stringify(stylePath)}], {
        stdin: process.stdin,
        stdout,
        stderr: closedStderr,
        cwd: ${JSON.stringify(cwd)},
      });
      await new Promise((resolve) => setImmediate(resolve));
    `;
    for (const closeStderr of [false, true]) {
      const result = await spawnEval(harnessSource(closeStderr));
      assert.equal(result.code, 3);
      assert.equal(result.signal, null);
      assert.doesNotMatch(result.stderr, /uncaught|Unhandled|node:events/i);
    }
  });

  it('handles in-place, backup, and existing-backup refusal as real processes', async () => {
    const cwd = await makeDirectory();
    const stylePath = join(cwd, 'style.json');
    const operationsPath = join(cwd, 'operations.json');
    const originalBytes = Buffer.from(`${JSON.stringify(baseStyle, null, 2)}\n`);
    await writeFile(stylePath, originalBytes);
    await writeFile(operationsPath, JSON.stringify(operations));

    const inPlace = await spawnCli([
      'apply', stylePath, '--operations', operationsPath, '--in-place', '--backup',
    ]);
    assert.equal(inPlace.code, 0);
    assert.deepEqual(await readFile(`${stylePath}.bak`), originalBytes);
    assert.equal(
      (JSON.parse(await readFile(stylePath, 'utf8')) as StyleDocument)
        .layers[0]?.paint?.['background-color'],
      '#ffffff',
    );
    assert.deepEqual(
      (await readdir(cwd)).filter((name) => name.startsWith('.') && name.endsWith('.tmp')),
      [],
    );

    await writeFile(stylePath, originalBytes);
    const refused = await spawnCli([
      'apply', stylePath, '--operations', operationsPath, '--in-place', '--backup',
    ]);
    assert.equal(refused.code, 3);
    assert.deepEqual(await readFile(stylePath), originalBytes);
    assert.deepEqual(await readFile(`${stylePath}.bak`), originalBytes);
    assert.doesNotMatch(refused.stderr, /File committed/);
    assert.deepEqual(
      (await readdir(cwd)).filter((name) => name.startsWith('.') && name.endsWith('.tmp')),
      [],
    );
    assert.equal((await stat(`${stylePath}.bak`)).isFile(), true);
  });
});
