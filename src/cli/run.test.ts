import assert from 'node:assert/strict';
import {
  mkdtemp, readFile, readdir, rename, stat, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { after, describe, it } from 'node:test';
import {
  analyzeGeoJson, applyStyleTransaction, DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_STYLE_BYTES, jsonUtf8ByteLength,
} from '../core/index.js';
import type { JsonValue, StyleDocument } from '../core/index.js';
import { replaceStyleFileAtomically } from './file-output.js';
import { readJsonInput } from './input.js';
import {
  POST_COMMIT_DURABILITY_STDOUT_FAILURE_DIAGNOSTIC,
  POST_COMMIT_STDOUT_FAILURE_DIAGNOSTIC,
  runCli, runCliWithDependencies,
} from './run.js';

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

class RejectingWriter extends Writable {
  writes = 0;

  constructor(private readonly failure = new Error('stdout unavailable')) {
    super();
  }

  override _write(
    _chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.writes += 1;
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

const acceptsJsonValue = (value: JsonValue): void => {
  void value;
};

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

const makeExactStyle = (): StyleDocument => {
  const style = {
    version: 8,
    sources: {},
    layers: [{
      id: 'background', type: 'background',
      paint: { 'background-color': '#000000' },
    }],
    metadata: { padding: '' },
  } satisfies StyleDocument;
  style.metadata.padding = 'a'.repeat(
    DEFAULT_MAX_STYLE_BYTES - jsonUtf8ByteLength(style),
  );
  assert.equal(jsonUtf8ByteLength(style), DEFAULT_MAX_STYLE_BYTES);
  return style;
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

describe('runCli inspect', () => {
  const inspectStyleFixture = {
    version: 8,
    sources: {
      basemap: { type: 'vector', url: 'maplibre://basemap' },
      points: {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: { category: 'park' },
            geometry: { type: 'Point', coordinates: [1, 2] },
          }],
        },
      },
      remote: { type: 'geojson', data: 'https://example.invalid/points.geojson' },
    },
    layers: [
      {
        id: 'road-primary', type: 'line', source: 'basemap',
        'source-layer': 'transportation',
        paint: { 'line-color': '#000000' },
      },
      { id: 'point-layer', type: 'circle', source: 'points' },
    ],
  };

  const writeFixture = async (): Promise<{ cwd: string; stylePath: string }> => {
    const cwd = await makeDirectory();
    const stylePath = join(cwd, 'style.json');
    await writeFile(stylePath, JSON.stringify(inspectStyleFixture));
    return { cwd, stylePath };
  };

  const invoke = async (
    cwd: string,
    argv: readonly string[],
  ): Promise<{
    code: number;
    json?: JsonValue;
    stdout: string;
    stderr: string;
  }> => {
    const io = makeIo(cwd);
    const code = await runCli(argv, io);
    const stdout = (io.stdout as BufferWriter).text;
    const json = stdout.length === 0 ? undefined : JSON.parse(stdout) as JsonValue;
    if (json !== undefined) acceptsJsonValue(json);
    return { code, json, stdout, stderr: (io.stderr as BufferWriter).text };
  };

  it('returns default, exact, search, source-layer, and inline GeoJSON DTOs', async () => {
    const { cwd, stylePath } = await writeFixture();
    const summary = await invoke(cwd, ['inspect', stylePath]);
    assert.equal(summary.code, 0);
    assert.deepEqual(Object.keys(summary.json as object), [
      'layerCount', 'sourceCount', 'layerTypes', 'layers',
    ]);
    assert.equal((summary.json as { layerCount: number }).layerCount, 2);

    const layer = await invoke(cwd, ['inspect', stylePath, '--layer', 'road-primary']);
    assert.equal((layer.json as { id: string }).id, 'road-primary');
    const source = await invoke(cwd, ['inspect', stylePath, '--source-id', 'basemap']);
    assert.equal((source.json as { type: string }).type, 'vector');

    const query = await invoke(cwd, ['inspect', stylePath, '--query', 'road']);
    assert.deepEqual(
      (query.json as { layers: Array<{ id: string }> }).layers.map(({ id }) => id),
      ['road-primary'],
    );
    const filtered = await invoke(cwd, [
      'inspect', stylePath, '--type', 'line', '--source', 'basemap',
      '--source-layer', 'transportation',
    ]);
    assert.deepEqual(
      (filtered.json as { layers: Array<{ id: string }> }).layers.map(({ id }) => id),
      ['road-primary'],
    );

    const usages = await invoke(cwd, ['inspect', stylePath, '--source-layers']);
    assert.equal(
      (usages.json as { sources: Array<{ sourceId: string }> }).sources[0]?.sourceId,
      'basemap',
    );
    const scopedUsages = await invoke(cwd, [
      'inspect', stylePath, '--source-layers', '--source', 'basemap',
    ]);
    assert.equal(
      (scopedUsages.json as { sources: JsonValue[] }).sources.length,
      1,
    );

    const analysis = await invoke(cwd, [
      'inspect', stylePath, '--analyze-geojson', 'points',
    ]);
    assert.equal((analysis.json as { featureCount: number }).featureCount, 1);
    assert.equal(analysis.stderr, '');
  });

  it('reports remote GeoJSON analysis without fetching or changing the directory', async () => {
    const { cwd, stylePath } = await writeFixture();
    const beforeBytes = await readFile(stylePath);
    const beforeEntries = await readdir(cwd);
    const expected = analyzeGeoJson('https://example.invalid/points.geojson');
    assert.equal(expected.ok, true);
    if (!expected.ok) assert.fail('expected remote analysis success');

    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      throw new Error('fetch must not run');
    }) as typeof fetch;
    try {
      const result = await invoke(cwd, [
        'inspect', stylePath, '--analyze-geojson', 'remote',
      ]);
      assert.equal(result.code, 0);
      assert.deepEqual(result.json, expected.analysis);
      assert.equal((result.json as { available: boolean }).available, false);
      assert.equal((result.json as { reason: string }).reason, 'remote-url');
      assert.equal(Array.isArray((result.json as { warnings: JsonValue[] }).warnings), true);
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.deepEqual(await readFile(stylePath), beforeBytes);
    assert.deepEqual(await readdir(cwd), beforeEntries);
  });

  it('returns semantic error envelopes for absent and unsupported exact lookups', async () => {
    const { cwd, stylePath } = await writeFixture();
    for (const argv of [
      ['inspect', stylePath, '--layer', 'missing'],
      ['inspect', stylePath, '--source-id', 'missing'],
      ['inspect', stylePath, '--analyze-geojson', 'basemap'],
      ['inspect', stylePath, '--source-id', 'toString'],
      ['inspect', stylePath, '--source-id', 'constructor'],
      ['inspect', stylePath, '--source-id', '__proto__'],
      ['inspect', stylePath, '--source-id', 'valueOf'],
      ['inspect', stylePath, '--source-id', '__defineGetter__'],
    ]) {
      const result = await invoke(cwd, argv);
      assert.equal(result.code, 1);
      assert.equal((result.json as { ok: boolean }).ok, false);
      assert.equal(typeof (result.json as { error: { code: string } }).error.code, 'string');
      assert.equal(result.stderr, '');
    }

  });
});

describe('runCli apply', () => {
  const baseStyle: StyleDocument = {
    version: 8,
    sources: {
      base: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] },
    },
    layers: [{
      id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads',
      paint: { 'line-color': '#000000' },
    }],
  };

  const invokeApply = async (
    cwd: string,
    argv: readonly string[],
    stdinText: string | Buffer = '',
  ): Promise<{ code: number; stdout: string; stderr: string; json?: JsonValue }> => {
    const io = makeIo(cwd, stdinText);
    const code = await runCli(argv, io);
    const stdout = (io.stdout as BufferWriter).text;
    return {
      code,
      stdout,
      stderr: (io.stderr as BufferWriter).text,
      ...(stdout.length === 0 ? {} : { json: JSON.parse(stdout) as JsonValue }),
    };
  };

  const writeApplyInputs = async (
    style: StyleDocument,
    operations: JsonValue,
  ): Promise<{ cwd: string; stylePath: string; operationsPath: string }> => {
    const cwd = await makeDirectory();
    const stylePath = join(cwd, 'style.json');
    const operationsPath = join(cwd, 'operations.json');
    await writeFile(stylePath, JSON.stringify(style));
    await writeFile(operationsPath, JSON.stringify(operations));
    return { cwd, stylePath, operationsPath };
  };

  it('applies a successful dry run from files and stdin without changing input bytes', async () => {
    const operations = [{
      op: 'setLayerProperties', layerId: 'roads',
      paint: { 'line-color': '#ff0000' },
    }];
    const { cwd, stylePath, operationsPath } = await writeApplyInputs(baseStyle, operations);
    const before = await readFile(stylePath, 'utf8');
    const result = await invokeApply(cwd, [
      'apply', stylePath, '--operations', operationsPath, '--dry-run',
    ]);
    assert.equal(result.code, 0);
    assert.equal((result.json as { ok: boolean }).ok, true);
    assert.equal(
      (result.json as { style: { layers: Array<{ paint: { 'line-color': string } }> } })
        .style.layers[0]?.paint['line-color'],
      '#ff0000',
    );
    assert.equal(await readFile(stylePath, 'utf8'), before);
    assert.equal(result.stderr, '');

    const stdinResult = await invokeApply(cwd, [
      'apply', '-', '--operations', operationsPath, '--dry-run',
    ], JSON.stringify(baseStyle));
    assert.equal(stdinResult.code, 0);
    assert.equal(stdinResult.stdout, result.stdout);
  });

  it('passes invalid transaction semantics through and keeps malformed JSON at exit 2', async () => {
    const invalidInputs: JsonValue[] = [
      { not: 'an array' },
      [{
        op: 'setLayerProperties', layerId: 'roads', minzoom: 10, maxzoom: 5,
      }],
    ];
    for (const operations of invalidInputs) {
      const { cwd, stylePath, operationsPath } = await writeApplyInputs(baseStyle, operations);
      const result = await invokeApply(cwd, [
        'apply', stylePath, '--operations', operationsPath, '--dry-run',
      ]);
      const expected = applyStyleTransaction(baseStyle, { operations, validate: true });
      assert.equal(result.code, 1);
      assert.equal(result.stdout, `${JSON.stringify(expected)}\n`);
      assert.equal((result.json as { error: { code: string } }).error.code, 'INVALID_INPUT');
      assert.deepEqual((result.json as { changedLayers: string[] }).changedLayers, []);
      assert.deepEqual((result.json as { changedSources: string[] }).changedSources, []);
      assert.deepEqual((result.json as { diff: JsonValue[] }).diff, []);
      assert.deepEqual((result.json as { style: JsonValue }).style, baseStyle);
      assert.equal(result.stderr, '');
    }

    const { cwd, stylePath } = await writeApplyInputs(baseStyle, []);
    await writeFile(join(cwd, 'malformed.json'), '{');
    const malformed = await invokeApply(cwd, [
      'apply', stylePath, '--operations', 'malformed.json', '--dry-run',
    ]);
    assert.equal(malformed.code, 2);
    assert.equal(malformed.stdout, '');
    assert.match(malformed.stderr, /Invalid JSON/);
  });

  it('preserves escaped IDs, semantic diff targets, no-ops, and atomic rollback', async () => {
    const unusualStyle: StyleDocument = {
      ...baseStyle,
      layers: [{ ...baseStyle.layers[0] as object, id: 'road/~primary' }] as StyleDocument['layers'],
    };
    const unusualOperations: JsonValue = [{
      op: 'setLayerProperties', layerId: 'road/~primary', paint: { 'line-width': 3 },
    }];
    const unusual = await writeApplyInputs(unusualStyle, unusualOperations);
    const unusualResult = await invokeApply(unusual.cwd, [
      'apply', unusual.stylePath, '--operations', unusual.operationsPath, '--dry-run',
    ]);
    const unusualExpected = applyStyleTransaction(unusualStyle, {
      operations: unusualOperations, validate: true,
    });
    assert.equal(unusualResult.stdout, `${JSON.stringify(unusualExpected)}\n`);
    assert.deepEqual((unusualResult.json as { changedLayers: string[] }).changedLayers, ['road/~primary']);
    assert.equal(
      (unusualResult.json as { diff: Array<{ path: string }> }).diff[0]?.path,
      '/layers/0/paint/line-width',
    );
    assert.deepEqual(
      (unusualResult.json as { diff: Array<{ target: JsonValue }> }).diff[0]?.target,
      { kind: 'layer', id: 'road/~primary' },
    );

    for (const operations of [
      [{ op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#000000' } }],
      [
        { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2 } },
        { op: 'setLayerProperties', layerId: 'missing', paint: { 'line-width': 3 } },
      ],
    ] satisfies JsonValue[]) {
      const inputs = await writeApplyInputs(baseStyle, operations);
      const result = await invokeApply(inputs.cwd, [
        'apply', inputs.stylePath, '--operations', inputs.operationsPath, '--dry-run',
      ]);
      const expected = applyStyleTransaction(baseStyle, { operations, validate: true });
      assert.equal(result.stdout, `${JSON.stringify(expected)}\n`);
      assert.deepEqual((result.json as { changedLayers: string[] }).changedLayers, []);
      assert.deepEqual((result.json as { changedSources: string[] }).changedSources, []);
      assert.deepEqual((result.json as { diff: JsonValue[] }).diff, []);
    }
  });

  it('passes candidate-style and diff-limit failures through without CLI sizing', async () => {
    const nearLimitText = styleTextAtBytes('a', DEFAULT_MAX_STYLE_BYTES - 16);
    const nearLimitStyle = JSON.parse(nearLimitText) as StyleDocument;
    const candidateOperations: JsonValue = [{
      op: 'setStyleRootProperties', properties: { name: 'candidate-overflow' },
    }];
    const candidate = await writeApplyInputs(nearLimitStyle, candidateOperations);
    await writeFile(candidate.stylePath, nearLimitText);
    const candidateResult = await invokeApply(candidate.cwd, [
      'apply', candidate.stylePath, '--operations', candidate.operationsPath, '--dry-run',
    ]);
    const candidateExpected = applyStyleTransaction(nearLimitStyle, {
      operations: candidateOperations, validate: true,
    });
    assert.equal(candidateResult.code, 1);
    assert.equal(candidateResult.stdout, `${JSON.stringify(candidateExpected)}\n`);
    assert.equal(
      (candidateResult.json as { error: { details: { reason: string } } }).error.details.reason,
      'maxStyleBytes',
    );

    const diffOperations: JsonValue = [{
      op: 'setLayerProperties', layerId: 'roads',
      metadata: { padding: 'a'.repeat(DEFAULT_MAX_DIFF_BYTES) },
    }];
    const diff = await writeApplyInputs(baseStyle, diffOperations);
    const diffResult = await invokeApply(diff.cwd, [
      'apply', diff.stylePath, '--operations', diff.operationsPath, '--dry-run',
    ]);
    const diffExpected = applyStyleTransaction(baseStyle, {
      operations: diffOperations, validate: true,
    });
    assert.equal(diffResult.code, 1);
    assert.equal(diffResult.stdout, `${JSON.stringify(diffExpected)}\n`);
    assert.equal(
      (diffResult.json as { error: { details: { reason: string } } }).error.details.reason,
      'maxDiffBytes',
    );
  });

  it('creates only a new output path and preserves the exact 5 MiB boundary', async () => {
    const exactStyle = makeExactStyle();
    const operations: JsonValue = [{
      op: 'setLayerProperties', layerId: 'background',
      paint: { 'background-color': '#ffffff' },
    }];
    const inputs = await writeApplyInputs(exactStyle, operations);
    const before = await readFile(inputs.stylePath);
    const result = await invokeApply(inputs.cwd, [
      'apply', inputs.stylePath, '--operations', inputs.operationsPath,
      '--output', 'next.json',
    ]);
    assert.equal(result.code, 0);
    assert.deepEqual(await readFile(inputs.stylePath), before);
    const outputPath = join(inputs.cwd, 'next.json');
    const outputBytes = await readFile(outputPath);
    assert.equal((await stat(outputPath)).size, DEFAULT_MAX_STYLE_BYTES);
    assert.equal(outputBytes.at(-1), '}'.charCodeAt(0));
    const outputValue = JSON.parse(outputBytes.toString('utf8')) as StyleDocument;
    assert.equal(jsonUtf8ByteLength(outputValue), DEFAULT_MAX_STYLE_BYTES);
    assert.deepEqual(outputValue, (result.json as { style: JsonValue }).style);

    const reread = await readJsonInput(outputPath, makeIo(inputs.cwd));
    assert.equal(reread.source.kind, 'file');
    assert.deepEqual(reread.value, outputValue);

    const validateResult = await invokeApply(inputs.cwd, ['validate', outputPath]);
    const inspectResult = await invokeApply(inputs.cwd, ['inspect', outputPath]);
    const noopOperationsPath = join(inputs.cwd, 'noop.json');
    await writeFile(noopOperationsPath, JSON.stringify(operations));
    const noopResult = await invokeApply(inputs.cwd, [
      'apply', outputPath, '--operations', noopOperationsPath, '--dry-run',
    ]);
    assert.deepEqual(
      [validateResult.code, inspectResult.code, noopResult.code],
      [0, 0, 0],
    );
  });

  it('keeps a committed output when stdout or stderr acknowledgement fails', async () => {
    const operations: JsonValue = [{
      op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2 },
    }];
    for (const rejectStderr of [false, true]) {
      const inputs = await writeApplyInputs(baseStyle, operations);
      const stdout = new RejectingWriter();
      const stderr: Writable = rejectStderr ? new RejectingWriter() : new BufferWriter();
      const stdoutBaseline = stdout.listenerCount('error');
      const stderrBaseline = stderr.listenerCount('error');
      const io = makeIo(inputs.cwd, '', stdout, stderr);
      const code = await runCli([
        'apply', inputs.stylePath, '--operations', inputs.operationsPath,
        '--output', 'committed.json',
      ], io);
      assert.equal(code, 3);
      const committed = JSON.parse(
        await readFile(join(inputs.cwd, 'committed.json'), 'utf8'),
      ) as StyleDocument;
      assert.equal(committed.layers[0]?.paint?.['line-width'], 2);
      if (!rejectStderr) {
        assert.equal(
          (stderr as BufferWriter).text,
          `${POST_COMMIT_STDOUT_FAILURE_DIAGNOSTIC}\n`,
        );
      }
      await immediate();
      assert.equal(stdout.listenerCount('error'), stdoutBaseline);
      assert.equal(stderr.listenerCount('error'), stderrBaseline);
      assert.equal(stdout.writes, 1);
    }
  });

  it('does not touch stdout or claim a commit for pre-commit and dry-run failures', async () => {
    const operations: JsonValue = [{
      op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2 },
    }];
    const inputs = await writeApplyInputs(baseStyle, operations);
    const existingPath = join(inputs.cwd, 'existing.json');
    await writeFile(existingPath, 'existing bytes');
    const stdout = new RejectingWriter();
    const stderr = new BufferWriter();
    const code = await runCli([
      'apply', inputs.stylePath, '--operations', inputs.operationsPath,
      '--output', existingPath,
    ], makeIo(inputs.cwd, '', stdout, stderr));
    assert.equal(code, 3);
    assert.equal(stdout.writes, 0);
    assert.equal(await readFile(existingPath, 'utf8'), 'existing bytes');
    assert.doesNotMatch(stderr.text, /File committed/);

    const dryStdout = new RejectingWriter();
    const dryStderr = new BufferWriter();
    const dryCode = await runCli([
      'apply', inputs.stylePath, '--operations', inputs.operationsPath, '--dry-run',
    ], makeIo(inputs.cwd, '', dryStdout, dryStderr));
    assert.equal(dryCode, 3);
    assert.doesNotMatch(dryStderr.text, /File committed/);
  });

  it('replaces an exact 5 MiB style in place and backs up the descriptor bytes', async () => {
    const exactStyle = makeExactStyle();
    const operations: JsonValue = [{
      op: 'setLayerProperties', layerId: 'background',
      paint: { 'background-color': '#ffffff' },
    }];
    const inputs = await writeApplyInputs(exactStyle, operations);
    const originalBytes = await readFile(inputs.stylePath);
    const result = await invokeApply(inputs.cwd, [
      'apply', 'style.json', '--operations', 'operations.json',
      '--in-place', '--backup',
    ]);
    assert.equal(result.code, 0);
    const installed = await readFile(inputs.stylePath);
    assert.equal(installed.byteLength, DEFAULT_MAX_STYLE_BYTES);
    assert.equal(installed.at(-1), '}'.charCodeAt(0));
    assert.deepEqual(await readFile(`${inputs.stylePath}.bak`), originalBytes);
    assert.deepEqual(
      JSON.parse(installed.toString('utf8')),
      (result.json as { style: JsonValue }).style,
    );
    assert.deepEqual(
      (await readdir(inputs.cwd)).filter((name) => name.startsWith('.') && name.endsWith('.tmp')),
      [],
    );

    const noopPath = join(inputs.cwd, 'noop-in-place.json');
    await writeFile(noopPath, JSON.stringify(operations));
    const followups = await Promise.all([
      invokeApply(inputs.cwd, ['validate', inputs.stylePath]),
      invokeApply(inputs.cwd, ['inspect', inputs.stylePath]),
      invokeApply(inputs.cwd, [
        'apply', inputs.stylePath, '--operations', noopPath, '--dry-run',
      ]),
    ]);
    assert.deepEqual(followups.map(({ code }) => code), [0, 0, 0]);
  });

  it('rejects in-place symlinks and existing backups before stdout', async () => {
    const operations: JsonValue = [{
      op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2 },
    }];
    const inputs = await writeApplyInputs(baseStyle, operations);
    const targetPath = join(inputs.cwd, 'target.json');
    const linkPath = join(inputs.cwd, 'link.json');
    await writeFile(targetPath, JSON.stringify(baseStyle));
    await symlink(targetPath, linkPath);
    const targetBefore = await readFile(targetPath);
    const linkIo = makeIo(inputs.cwd);
    assert.equal(await runCli([
      'apply', linkPath, '--operations', inputs.operationsPath, '--in-place', '--backup',
    ], linkIo), 3);
    assert.equal((linkIo.stdout as BufferWriter).text, '');
    assert.doesNotMatch((linkIo.stderr as BufferWriter).text, /File committed/);
    assert.deepEqual(await readFile(targetPath), targetBefore);
    await assert.rejects(stat(`${linkPath}.bak`), { code: 'ENOENT' });

    await writeFile(`${inputs.stylePath}.bak`, 'preexisting backup');
    const stdout = new RejectingWriter();
    const stderr = new BufferWriter();
    const styleBefore = await readFile(inputs.stylePath);
    assert.equal(await runCli([
      'apply', inputs.stylePath, '--operations', inputs.operationsPath,
      '--in-place', '--backup',
    ], makeIo(inputs.cwd, '', stdout, stderr)), 3);
    assert.equal(stdout.writes, 0);
    assert.deepEqual(await readFile(inputs.stylePath), styleBefore);
    assert.equal(await readFile(`${inputs.stylePath}.bak`, 'utf8'), 'preexisting backup');
    assert.doesNotMatch(stderr.text, /File committed/);
  });

  it('acknowledges a real post-rename durability failure with the core transaction result', async () => {
    const operations: JsonValue = [{
      op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2 },
    }];
    const inputs = await writeApplyInputs(baseStyle, operations);
    const expected = applyStyleTransaction(baseStyle, { operations, validate: true });
    const eio = Object.assign(new Error('replacement directory sync failed'), { code: 'EIO' });
    const io = makeIo(inputs.cwd);
    const code = await runCliWithDependencies([
      'apply', inputs.stylePath, '--operations', inputs.operationsPath, '--in-place',
    ], io, {
      replaceStyleFileAtomically: async (path, next, options) =>
        replaceStyleFileAtomically(path, next, {
          ...options,
          hooks: {
            syncDirectory: async (_directory, phase) => {
              if (phase === 'replacement') throw eio;
            },
          },
        }),
    });
    assert.equal(code, 3);
    const acknowledgement = JSON.parse((io.stdout as BufferWriter).text) as {
      ok: boolean;
      committed: boolean;
      durable: boolean;
      error: { code: string; message: string };
      transactionResult: JsonValue;
    };
    assert.deepEqual(Object.keys(acknowledgement), [
      'ok', 'committed', 'durable', 'error', 'transactionResult',
    ]);
    assert.equal(acknowledgement.ok, false);
    assert.equal(acknowledgement.committed, true);
    assert.equal(acknowledgement.durable, false);
    assert.equal(acknowledgement.error.code, 'OUTPUT_DURABILITY_UNCERTAIN');
    assert.deepEqual(acknowledgement.transactionResult, expected);
    assert.match((io.stderr as BufferWriter).text, /replacement directory sync failed/);
    assert.equal(
      (JSON.parse(await readFile(inputs.stylePath, 'utf8')) as StyleDocument)
        .layers[0]?.paint?.['line-width'],
      2,
    );
  });

  it('keeps in-place commits when normal or durability acknowledgement streams fail', async () => {
    const operations: JsonValue = [{
      op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2 },
    }];
    for (const durabilityFailure of [false, true]) {
      for (const rejectStderr of [false, true]) {
        const inputs = await writeApplyInputs(baseStyle, operations);
        const stdout = new RejectingWriter();
        const stderr: Writable = rejectStderr ? new RejectingWriter() : new BufferWriter();
        const stdoutBaseline = stdout.listenerCount('error');
        const stderrBaseline = stderr.listenerCount('error');
        const eio = Object.assign(new Error('directory durability uncertain'), { code: 'EIO' });
        const code = durabilityFailure
          ? await runCliWithDependencies([
              'apply', inputs.stylePath, '--operations', inputs.operationsPath, '--in-place',
            ], makeIo(inputs.cwd, '', stdout, stderr), {
              replaceStyleFileAtomically: async (path, next, options) =>
                replaceStyleFileAtomically(path, next, {
                  ...options,
                  hooks: {
                    syncDirectory: async (_directory, phase) => {
                      if (phase === 'replacement') throw eio;
                    },
                  },
                }),
            })
          : await runCli([
              'apply', inputs.stylePath, '--operations', inputs.operationsPath, '--in-place',
            ], makeIo(inputs.cwd, '', stdout, stderr));
        assert.equal(code, 3);
        assert.equal(stdout.writes, 1);
        assert.equal(
          (JSON.parse(await readFile(inputs.stylePath, 'utf8')) as StyleDocument)
            .layers[0]?.paint?.['line-width'],
          2,
        );
        if (!rejectStderr) {
          assert.equal(
            (stderr as BufferWriter).text,
            `${durabilityFailure
              ? POST_COMMIT_DURABILITY_STDOUT_FAILURE_DIAGNOSTIC
              : POST_COMMIT_STDOUT_FAILURE_DIAGNOSTIC}\n`,
          );
        }
        await immediate();
        assert.equal(stdout.listenerCount('error'), stdoutBaseline);
        assert.equal(stderr.listenerCount('error'), stderrBaseline);
      }
    }
  });
});
