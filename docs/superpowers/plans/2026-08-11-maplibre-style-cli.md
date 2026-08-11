# MapLibre Style CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe `maplibre-style` executable that validates, inspects, and transactionally edits local MapLibre Style JSON through the transport-neutral core.

**Architecture:** Keep command parsing, JSON stream/file I/O, presentation, and atomic filesystem replacement in focused CLI modules under `src/cli/`. `runCli(argv, io)` is the testable boundary: it returns an explicit exit code, writes JSON results only to stdout, and sends diagnostics only to stderr; the executable entry point only adapts `process.argv` and process streams. All style semantics remain in the public core, while process-level tests execute the compiled ESM CLI.

**Tech Stack:** Node.js `>=22.13.0`, TypeScript `~5.9.3`, NodeNext ESM, `node:util.parseArgs`, `node:fs/promises`, `node:test`, MapLibre Style Spec `^26.2.1`, pnpm `10.10.0`.

## Global Constraints

- Execute only after the standalone extraction, MapLibre v6/core foundation, and layer/data capability plans are complete and green. The fixed order is `standalone extraction → core foundation → layer/data → CLI → MCP → live bridge`; CLI consumes `analyzeGeoJson` and `listSourceLayers` created by layer/data.
- Work only in `/Users/zhang/code/maplibre-style-tools`; do not modify `/Users/zhang/code/ai-style-editor`.
- Keep one npm package and one root `pnpm-lock.yaml`; do not add a CLI parsing dependency.
- Preserve `createMapLibreStyleTools`, `createCompactMapLibreStyleTools`, and all approved package subpath exports.
- Keep ESM, `"type": "module"`, NodeNext resolution, and `.js` suffixes on relative TypeScript imports.
- The default command never changes the input style file.
- `STYLE` and `OPERATIONS` accept a path or `-`, but both cannot read stdin in one invocation.
- While stdout remains writable, it is either empty or contains exactly one JSON document plus a trailing newline and no diagnostics; diagnostics go to stderr. If stdout itself rejects after accepting zero or more bytes, its contents are untrusted and may be empty or partial, so the CLI makes no JSON-delivery claim for that invocation.
- Exit code `0` means success, `1` means a valid invocation with a style or transaction semantic failure, `2` means argument/JSON/input-read failure, and `3` means internal/output-write failure.
- The core is the sole authority for the 5 MiB candidate-Style and 1 MiB diff result limits. The CLI keeps its independent 5 MiB UTF-8 input-read gate, but never reimplements candidate/diff sizing and passes the core result through unchanged.
- Style files created by `--output` or installed by `--in-place` are exactly the UTF-8 bytes of compact `JSON.stringify(result.style)`, with no indentation or trailing newline. The CLI does not measure that candidate again; this preserves core's exact-5-MiB acceptance at the CLI reread boundary. A `.bak` remains a byte-for-byte copy of the original input.
- `--output FILE` and `--in-place` are mutually exclusive; `--backup` is valid only with `--in-place`.
- `--dry-run` never writes a file and is incompatible with `--output`, `--in-place`, and `--backup`.
- In-place reads capture device/inode identity from `fstat` on the same opened descriptor that supplies the parsed bytes. Replacement compares that read-time identity at helper entry and immediately before an exclusive same-directory temporary-file `fsync` + atomic `rename` + directory `fsync` commit.
- If `rename` succeeds but the final directory `fsync` fails with a non-portability error, the CLI returns exit `3`, reports a JSON `{committed:true,durable:false,...}` acknowledgement when stdout remains writable plus a diagnostic on stderr, and never claims that the Style remained unchanged. If that acknowledgement also fails, stderr alone must say that the file was committed, durability is uncertain, and callers must not retry as though no file was written.
- Once `writeNewOutputFile` returns or an in-place `rename` succeeds, a later stdout failure never rolls the file back or removes it. Return exit `3` and write a stable stderr diagnostic containing `File committed` and `do not retry as though no file was written`; stdout is not a usable acknowledgement channel in this branch.
- Every stdout/stderr write installs its own temporary Writable `error` listener before calling `write`, observes callback errors and emitted errors, settles once, and removes the listener after the write's error-event window. `runCli` maps stdout EPIPE/closed-stream failures to the existing exit code and treats every stderr diagnostic as best-effort so a broken stderr cannot escape as an uncaught exception or change the chosen exit code.
- `--backup` writes the exact bounded bytes read from the original Style descriptor to `<STYLE>.bak` with exclusive creation; it never rereads/copies the pathname and never overwrites an existing backup.
- CLI commands never fetch remote Style, TileJSON, GeoJSON, tiles, sprites, glyphs, or images and never instantiate a MapLibre renderer.
- Keep generated output in `dist/` and `.tmp/`; do not publish `src/`, tests, examples, caches, or stale artifacts.
- Run every command in this plan with the `rtk` prefix.
- Treat each checkbox as one 2–5-minute action; stop at the stated red/green or commit boundary before continuing.
- Do not publish, push, create a release, add CI, or invent repository/license metadata.

---

## File Structure

```text
src/cli/
  types.ts                 # Command/result/exit-code and runCli I/O contracts
  args.ts                  # util.parseArgs conversion and option compatibility checks
  input.ts                 # stdin/file text and JSON reads with stable input errors
  output.ts                # JSON stdout and stderr diagnostic writers
  inspect.ts               # Inspect request dispatch over the pure core
  file-output.ts           # Exclusive output and atomic in-place/backup writes
  run.ts                   # runCli(argv, io) command orchestration
  main.ts                  # shebang and process adapter only
  args.test.ts
  output.test.ts
  run.test.ts
  file-output.test.ts
  spawn-cli.test.ts
scripts/
  check-package.mjs        # Extend the foundation dist/export/tarball acceptance check
package.json
README.md
tsconfig.test.json
eslint.config.js
```

The plan consumes the approved core entry point `src/core/index.ts`; it must import these contracts directly and must not hand-copy structural substitutes:

```ts
import {
  analyzeGeoJson,
  applyStyleTransaction,
  buildStyleContext,
  createStyleToolError,
  DEFAULT_MAX_STYLE_BYTES,
  jsonUtf8ByteLength,
  listSourceLayers,
  searchLayers,
  validateStyleDocument,
} from '../core/index.js';
import type {
  GeoJsonAnalysis,
  JsonObject,
  JsonValue,
  LayerSearchQuery,
  LayerSearchResult,
  SourceLayerUsage,
  StyleContext,
  StyleDocument,
  StyleLayer,
  StyleSource,
  StyleToolError,
  StyleTransactionResult,
  StyleValidationResult,
} from '../core/index.js';
```

The imported `StyleDocument` is the JSON-safe Style Spec intersection, diff entries retain their semantic `target`, and `applyStyleTransaction(style, unknownInput)` is the sole runtime transaction parse/result authority. If an earlier core task exports the same behavior through different internal files, adapt only the imports in `src/cli/inspect.ts` and `src/cli/run.ts`; do not duplicate style validation, search, analysis, operation, error-code, or result-shape logic in the CLI.

### Task 1: Define the CLI Contract and Parse Arguments

**Files:**
- Create: `src/cli/types.ts`
- Create: `src/cli/args.ts`
- Create: `src/cli/args.test.ts`

**Interfaces:**
- Consumes: Node `parseArgs({ args, allowPositionals: true, strict: true, options })` from `node:util`.
- Produces: `CliExitCode`, `CliIo`, `CliCommand`, `CliArgumentError`, and `parseCliArgs(argv: readonly string[]): CliCommand`.

- [ ] **Step 1: Write the failing tests for command parsing**

Create `src/cli/args.test.ts` with table tests for the three valid commands and explicit invalid combinations:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCliArgs } from './args.js';
import { CliArgumentError } from './types.js';

describe('parseCliArgs', () => {
  it('parses validate, inspect, and apply', () => {
    assert.deepEqual(parseCliArgs(['validate', 'style.json']), {
      kind: 'validate', styleInput: 'style.json',
    });
    assert.deepEqual(parseCliArgs(['inspect', '-', '--query', 'road']), {
      kind: 'inspect', styleInput: '-', query: 'road',
    });
    assert.deepEqual(parseCliArgs([
      'apply', 'style.json', '--operations', 'ops.json', '--dry-run',
    ]), {
      kind: 'apply', styleInput: 'style.json', operationsInput: 'ops.json',
      dryRun: true, inPlace: false, backup: false,
    });
  });

  it('rejects incompatible inputs and output modes', () => {
    const invalid = [
      ['apply', '-', '--operations', '-'],
      ['apply', 'style.json', '--operations', 'ops.json', '--output', 'out.json', '--in-place'],
      ['apply', 'style.json', '--operations', 'ops.json', '--backup'],
      ['apply', 'style.json', '--operations', 'ops.json', '--dry-run', '--output', 'out.json'],
      ['inspect', 'style.json', '--layer', 'roads', '--source', 'basemap'],
    ];
    for (const argv of invalid) {
      assert.throws(() => parseCliArgs(argv), CliArgumentError);
    }
  });
});
```

- [ ] **Step 2: Run the parser tests and verify the red state**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.test.json
```

Expected: FAIL because `src/cli/args.ts` does not exist.

- [ ] **Step 3: Define the CLI types and argument error**

Create `src/cli/types.ts` with the exact command union and process-independent I/O contract:

```ts
import type { Readable, Writable } from 'node:stream';

export type CliExitCode = 0 | 1 | 2 | 3;
export interface CliIo {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  cwd: string;
}
export type CliCommand =
  | { kind: 'help' }
  | { kind: 'validate'; styleInput: string }
  | { kind: 'inspect'; styleInput: string; query?: string; type?: string; source?: string; sourceLayer?: string; layerId?: string; sourceId?: string; sourceLayers?: boolean; analyzeGeoJsonSourceId?: string }
  | { kind: 'apply'; styleInput: string; operationsInput: string; dryRun: boolean; output?: string; inPlace: boolean; backup: boolean };
export class CliArgumentError extends Error {
  override readonly name = 'CliArgumentError';
}
```

- [ ] **Step 4: Implement `parseCliArgs` with `node:util.parseArgs`**

Create `src/cli/args.ts`. Configure string options `operations`, `output`, `query`, `type`, `source`, `source-layer`, `layer`, `source-id`, and `analyze-geojson`; configure boolean options `help`, `dry-run`, `in-place`, `backup`, and `source-layers`. `--help` is valid only as the sole argument and returns `{kind:'help'}`; any command or second option combined with it is an argument error. Otherwise require exactly `validate STYLE`, `inspect STYLE`, or `apply STYLE --operations OPERATIONS`, then perform these checks in order:

```ts
if (styleInput === '-' && operationsInput === '-') throw new CliArgumentError('STYLE and OPERATIONS cannot both read stdin.');
if (output !== undefined && inPlace) throw new CliArgumentError('--output and --in-place are mutually exclusive.');
if (backup && !inPlace) throw new CliArgumentError('--backup requires --in-place.');
if (dryRun && (output !== undefined || inPlace || backup)) throw new CliArgumentError('--dry-run cannot be combined with file output options.');
if (inPlace && styleInput === '-') throw new CliArgumentError('--in-place requires STYLE to be a file path.');
```

Wrap `parseArgs` exceptions in `CliArgumentError` without changing their message. First enforce an allowlist per command: `validate` accepts no options; `inspect` accepts only its search/exact selectors; `apply` accepts only `--operations`, `--dry-run`, `--output`, `--in-place`, and `--backup`. Reject cross-command options such as `validate --output`, `inspect --in-place`, and `apply --layer` instead of silently ignoring them. For `inspect`, treat `--query`, `--type`, `--source`, and `--source-layer` as combinable layer-search filters. Treat `--layer`, `--source-id`, `--source-layers`, and `--analyze-geojson` as mutually exclusive modes and reject mixing an exact mode with search filters, except that `--source-layers --source SOURCE_ID` is allowed to scope source-layer usage.

- [ ] **Step 5: Compile and run the parser tests**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --test .tmp/test-dist/cli/args.test.js
```

Expected: PASS with 2 tests and 0 failures.

- [ ] **Step 6: Commit the parser contract**

```bash
rtk git add src/cli/types.ts src/cli/args.ts src/cli/args.test.ts
rtk git commit -m "feat(cli): define command argument contract"
```

### Task 2: Read JSON Inputs and Implement `validate`

**Files:**
- Create: `src/cli/input.ts`
- Create: `src/cli/output.ts`
- Create: `src/cli/output.test.ts`
- Create: `src/cli/run.ts`
- Create: `src/cli/run.test.ts`

**Interfaces:**
- Consumes: `parseCliArgs`, `validateStyleDocument(value)`, `CliIo`, and Node file/stream APIs.
- Produces: `CliInputError`, `FileIdentity`, `JsonInputRead`, `readJsonInput(input, io, hooks?): Promise<JsonInputRead>`, `writeJson(stream, value): Promise<void>`, `writeDiagnostic(stream, message): Promise<void>`, and `runCli(argv, io): Promise<CliExitCode>`.

- [ ] **Step 1: Write failing `runCli` tests for validate**

Create `src/cli/run.test.ts` with this in-memory stream helper, then use `mkdtemp` and `writeFile` for each test's inputs:

```ts
import { Readable, Writable } from 'node:stream';

class BufferWriter extends Writable {
  readonly chunks: string[] = [];
  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }
  get text(): string { return this.chunks.join(''); }
}

const makeIo = (cwd: string, stdinText = '') => ({
  stdin: Readable.from([stdinText]),
  stdout: new BufferWriter(),
  stderr: new BufferWriter(),
  cwd,
});
```

Create `src/cli/output.test.ts` before the implementation. Import `writeJson`/`writeDiagnostic` and define three Writable fixtures without installing any test-owned `error` listener: one `_write` calls its callback with an `EPIPE` error (Node subsequently emits `error`), one emits an `error` and then invokes the callback, and one is destroyed/closed before the call. For each, capture `listenerCount('error')` before invocation, assert the returned promise rejects once, wait one `setImmediate` turn, and assert the listener count returns to its baseline with no uncaught event. Add a successful `BufferWriter` case proving listener cleanup and exact trailing-newline transport JSON. The callback+event assertion must count the rejection branch exactly once:

```ts
const epipe = Object.assign(new Error('broken pipe'), { code: 'EPIPE' });
const stream = new CallbackErrorWriter(epipe);
const baseline = stream.listenerCount('error');
let settlements = 0;
await writeJson(stream, { ok: true }).then(
  () => { settlements += 1; assert.fail('expected rejection'); },
  (error: unknown) => {
    settlements += 1;
    assert.equal((error as NodeJS.ErrnoException).code, 'EPIPE');
  },
);
await new Promise<void>((resolve) => setImmediate(resolve));
assert.equal(settlements, 1);
assert.equal(stream.listenerCount('error'), baseline);
```

Do not add `stream.on('error', ...)` in the test setup: owning that listener is the behavior under test. Exercise both `writeJson` and `writeDiagnostic`, including a callback-error-plus-emitted-error sequence and an already closed stream.

With the normal writable `BufferWriter`, assert a valid style returns `0`, invalid style semantics return `1`, malformed JSON returns `2`, and stdout is always either empty or one parseable JSON document:

```ts
const code = await runCli(['validate', stylePath], io);
assert.equal(code, 0);
assert.deepEqual(JSON.parse(stdout.text), { ok: true, errors: [], warnings: [] });
assert.equal(stderr.text, '');

const badCode = await runCli(['validate', malformedPath], badIo);
assert.equal(badCode, 2);
assert.equal(badStdout.text, '');
assert.match(badStderr.text, /Invalid JSON/);
```

Also pass `Readable.from([validStyleJson])` as stdin for `['validate', '-']` and assert exit `0`. Add byte-boundary cases with Chinese and astral characters where JavaScript string length is below 5 MiB but UTF-8 bytes exceed it, plus a `Buffer` containing invalid UTF-8; both must fail before `JSON.parse`.

- [ ] **Step 2: Compile to verify the missing implementation failure**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.test.json
```

Expected: FAIL because `runCli`, input helpers, output helpers, and their Writable error lifecycle do not exist.

- [ ] **Step 3: Implement bounded stdin/file JSON input and capture file identity from the read descriptor**

Create `src/cli/input.ts`. Import `DEFAULT_MAX_STYLE_BYTES` from core and use it as this transport's `limit`; do not redeclare `5 * 1024 * 1024`. Resolve relative paths against `io.cwd`. For a file, call `open(absolutePath, 'r')` first, then call `handle.stat({bigint:true})` on that exact descriptor; require a regular file, reject a size above `limit`, and derive `FileIdentity` from that same `fstat`. Read at most `limit + 1` bytes through the same handle (not a second path-based `readFile`) so a racing/growing file cannot bypass the gate, and close the handle in `finally`. Do not use a path `stat` result as the replacement identity. For stdin, read through async iteration and normalize every chunk to bytes: use Buffer/Uint8Array byte length directly and `Buffer.byteLength(chunk, 'utf8')` plus UTF-8 encoding for string chunks. Stop/reject immediately above `limit`; never count JavaScript code units. Accumulate bounded bytes, decode once with a fatal UTF-8 decoder, and only then call `JSON.parse`. Convert open/read/fstat, UTF-8, and JSON parse failures into `CliInputError` with messages that include the input label but never echo document contents. Tests must cover an oversized file, multi-chunk stdin, multibyte/astral exact boundaries, invalid UTF-8, and prove the JSON parser seam is not called.

```ts
export class CliInputError extends Error { override readonly name = 'CliInputError'; }
export interface FileIdentity { device: bigint; inode: bigint }
export type JsonInputRead =
  | { value: unknown; source: { kind: 'stdin' } }
  | {
      value: unknown;
      source: {
        kind: 'file'; absolutePath: string; identity: FileIdentity;
        originalBytes: Uint8Array;
      };
    };
export interface JsonInputReadHooks { afterFileStat?: () => Promise<void> }
export async function readJsonInput(
  input: string,
  io: CliIo,
  hooks?: JsonInputReadHooks,
): Promise<JsonInputRead>;
```

Invoke `afterFileStat` only after the handle's `fstat` and before its first read; production callers omit it. Add a focused injected-race test that replaces the pathname from this hook: `.value`, `source.originalBytes`, and `FileIdentity` must all come from the already-open descriptor, not from the replacement pathname. `originalBytes` is the same bounded byte sequence decoded by the fatal UTF-8/JSON pipeline and is retained only for an exact in-place backup; do not reread the path to obtain it. Add type/runtime assertions that bigint identity and original bytes are internal and are never serialized to CLI stdout.

- [ ] **Step 4: Implement JSON-only stdout and diagnostic stderr**

Create `src/cli/output.ts` with a private `writeText(stream: Writable, text: string): Promise<void>`. Install the module-owned `error` listener **before** calling `stream.write`. A callback error rejects immediately but keeps the listener installed until one `setImmediate` turn so the Writable's corresponding emitted `error` cannot become uncaught; an emitted error without a callback error follows the same path. Callback plus event may reject only once. Successful callback cleanup is immediate. Synchronous `write` throws use the same failure path. Remove only this invocation's listener and attempt exactly one `write`:

```ts
const writeText = (stream: Writable, text: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let settled = false;
    let cleanupImmediate: NodeJS.Immediate | undefined;

    const cleanup = (): void => {
      stream.off('error', onError);
      if (cleanupImmediate !== undefined) {
        clearImmediate(cleanupImmediate);
        cleanupImmediate = undefined;
      }
    };
    const scheduleCleanup = (): void => {
      if (cleanupImmediate === undefined) {
        cleanupImmediate = setImmediate(cleanup);
      }
    };
    const fail = (error: unknown): void => {
      if (!settled) {
        settled = true;
        reject(error);
      }
      scheduleCleanup();
    };
    const succeed = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => fail(error);

    stream.on('error', onError);
    try {
      stream.write(text, (error?: Error | null) => {
        if (error != null) fail(error);
        else succeed();
      });
    } catch (error) {
      fail(error);
    }
  });
```

Then expose only the JSON/diagnostic writers:

```ts
export const writeJson = (stream: Writable, value: unknown): Promise<void> => {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('Value is not JSON serializable.');
  return writeText(stream, `${encoded}\n`);
};
export const writeDiagnostic = (stream: Writable, message: string): Promise<void> =>
  writeText(stream, `${message}\n`);
```

Do not call `console.log`, `console.error`, or pretty-print JSON. The `setImmediate` error window is intentional; do not replace it with immediate listener removal on a callback error.

- [ ] **Step 5: Implement the validate path in `runCli`**

Create `src/cli/run.ts` with the exact public signature:

```ts
export async function runCli(argv: readonly string[], io: CliIo): Promise<CliExitCode>
```

Export a stable JSON-safe `CLI_HELP` value such as `{ok:true, command:'help', usage:[...]}` from `run.ts`. Add a private `writeDiagnosticBestEffort(stream, message): Promise<void>` that awaits `writeDiagnostic` in `try/catch` and intentionally swallows its rejection. Route **every** runCli diagnostic through that helper; a closed/EPIPE stderr must never escape, trigger an unhandled event, or replace the already selected exit code.

For `{kind:'help'}`, call `writeJson(io.stdout, CLI_HELP)`, write nothing to stderr, and return `0` without reading stdin or a file. Never write plain usage text to stdout. Map `CliArgumentError` and `CliInputError` to best-effort stderr plus exit `2`. For `validate`, read `JsonInputRead.value`, call `validateStyleDocument`, write only `{ok, errors, warnings}` to stdout (never echo the normalized Style or internal file identity), and return `0` when `ok` is true or `1` otherwise. Treat `writeJson` rejection—including `EPIPE`, an already closed/destroyed Writable, callback error, emitted error, or top-level `undefined`—as internal/output failure with exit `3`; do not assume a failing stream left stdout empty, and do not attempt a second stdout write. Because validate never commits a file, its best-effort stderr diagnostic must not contain the later post-commit warning. Catch unexpected errors, write `Internal error: <message>` best-effort, and return `3` even if stderr also fails.

Add `run.test.ts` cases using the erroring/closed writers without external `error` listeners: valid validate + EPIPE stdout + working stderr returns `3`; malformed input + closed stderr still returns `2`; valid validate + both stdout/stderr closed returns `3`; none produces an uncaught event after one `setImmediate` turn.

- [ ] **Step 6: Run validate tests and static checks**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --test .tmp/test-dist/cli/output.test.js .tmp/test-dist/cli/run.test.js
rtk pnpm run lint
rtk pnpm run typecheck
```

Expected: all commands pass; stdout assertions contain JSON only.

- [ ] **Step 7: Commit validate and I/O**

```bash
rtk git add src/cli/input.ts src/cli/output.ts src/cli/output.test.ts src/cli/run.ts src/cli/run.test.ts
rtk git commit -m "feat(cli): validate style JSON from files and stdin"
```

### Task 3: Implement Deterministic `inspect`

**Files:**
- Create: `src/cli/inspect.ts`
- Modify: `src/cli/run.ts`
- Modify: `src/cli/run.test.ts`

**Interfaces:**
- Consumes: validated `StyleDocument`, `buildStyleContext`, `searchLayers`, `listSourceLayers`, and `analyzeGeoJson` from `maplibre-style-tools/core` internals.
- Produces: the JSON-safe DTO union `InspectValue`, `InspectRequest`, `InspectResult`, and `inspectStyle(style, request): InspectResult`, called by `runCli` after full style validation.

- [ ] **Step 1: Add failing default, layer, and source inspect tests**

Use a style containing vector source `basemap`, GeoJSON source `points`, layer `road-primary`, and inline FeatureCollection. Add these assertions:

```ts
assert.equal((await invoke(['inspect', stylePath])).code, 0);
assert.equal((await invoke(['inspect', stylePath, '--layer', 'road-primary'])).json.id, 'road-primary');
assert.equal((await invoke(['inspect', stylePath, '--source-id', 'basemap'])).json.type, 'vector');
```

For the default branch, assert the exact `InspectStyleSummaryDto` keys and primitive/array/object value types. Add a compile-time helper `const acceptsJsonValue = (_value: JsonValue): void => {};` and pass every successful inspect variant to it; no inspect result type may contain `unknown`.

- [ ] **Step 2: Add failing search, source-layer, and GeoJSON inspect tests**

Add these assertions against the same fixture:

```ts
assert.deepEqual((await invoke(['inspect', stylePath, '--query', 'road'])).json.layers.map((x: { id: string }) => x.id), ['road-primary']);
assert.deepEqual((await invoke(['inspect', stylePath, '--type', 'line', '--source', 'basemap', '--source-layer', 'transportation'])).json.layers.map((x: { id: string }) => x.id), ['road-primary']);
assert.equal((await invoke(['inspect', stylePath, '--source-layers'])).json.sources[0].sourceId, 'basemap');
assert.equal((await invoke(['inspect', stylePath, '--source-layers', '--source', 'basemap'])).json.sources.length, 1);
assert.equal((await invoke(['inspect', stylePath, '--analyze-geojson', 'points'])).json.featureCount, 1);
```

Add a second GeoJSON source whose `data` is `https://example.invalid/points.geojson`. Compute the expected DTO by calling `analyzeGeoJson(url)`, narrow its `ok:true` branch, and deep-equal the CLI JSON to `expected.analysis`; separately assert `available === false`, `reason === 'remote-url'`, and `Array.isArray(warnings)`. Temporarily replace `globalThis.fetch` in a non-concurrent test and restore it in `finally`; assert exit `0` with zero fetch calls. Snapshot the input bytes and containing-directory entries before the call and assert both are unchanged afterward: URL analysis is read-only and must not create output, backup, or temp files.

- [ ] **Step 3: Add failing semantic-error inspect tests**

Add not-found tests for layer, source, and GeoJSON source. Include source IDs `toString`, `constructor`, and `__proto__` and prove inherited prototype values are never returned. Assert each returns exit `1`, a JSON error envelope on stdout, and empty stderr.

- [ ] **Step 4: Run the inspect tests to verify red**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --test .tmp/test-dist/cli/run.test.js
```

Expected: FAIL because `runCli` does not handle `inspect`.

- [ ] **Step 5: Implement context, layer, and source inspection**

Create `src/cli/inspect.ts`. Return a freshly constructed summary DTO with no selector and lookup layer/source IDs without mutating the document. Exact source lookup must use `Object.hasOwn(style.sources, sourceId)` before indexing; never use truthiness or the `in` operator on an untrusted ID. Define the DTO schema explicitly from core `JsonObject`/`JsonValue`; do not use `unknown`, `Record<string, unknown>`, or an unconstrained generic as the return type:

```ts
export type InspectWarningDto = JsonObject & {
  code: string; message: string; path?: string;
};
export type InspectLayerSummaryDto = JsonObject & {
  id: string; type: string; source?: string; sourceLayer?: string;
  minzoom?: number; maxzoom?: number; visibility?: JsonValue;
};
export type InspectStyleSummaryDto = JsonObject & {
  activeSourceId?: string | null; selectedLayerId?: string | null;
  layerCount: number; sourceCount: number;
  layerTypes: Record<string, number> & JsonObject;
  layers: InspectLayerSummaryDto[];
};
export type InspectLayerSearchDto = JsonObject & {
  layers: InspectLayerSummaryDto[]; total: number;
};
export type InspectLayerDto = StyleLayer;
export type InspectSourceDto = StyleSource;
export type InspectSourceLayersDto = JsonObject & {
  sources: Array<JsonObject & {
    sourceId: string; sourceLayer: string;
    layers: Array<JsonObject & { id: string; type: string }>;
  }>;
};
export type InspectGeoJsonPropertyDto = JsonObject & {
  name: string;
  types: Array<'string' | 'number' | 'boolean' | 'null' | 'array' | 'object'>;
  numericRange?: JsonObject & { min: number; max: number };
  topValues?: Array<JsonObject & {
    value: string | number | boolean | null; count: number;
  }>;
};
export type InspectGeoJsonDto =
  | (JsonObject & {
      available: false; reason: 'remote-url'; warnings: InspectWarningDto[];
    })
  | (JsonObject & {
      available: true; featureCount: number;
      geometryTypes: Record<string, number> & JsonObject;
      bbox?: [number, number, number, number];
      properties: InspectGeoJsonPropertyDto[];
      warnings: InspectWarningDto[];
    });
export type InspectValue = InspectStyleSummaryDto | InspectLayerSearchDto
  | InspectLayerDto | InspectSourceDto | InspectSourceLayersDto | InspectGeoJsonDto;
export type InspectResult = { ok: true; value: InspectValue } | { ok: false; error: StyleToolError };
export type InspectRequest = Omit<Extract<CliCommand, { kind: 'inspect' }>, 'kind' | 'styleInput'>;
export function inspectStyle(style: StyleDocument, request: InspectRequest): InspectResult;
```

Map `StyleContext`, `LayerSearchResult`, `SourceLayerUsage[]`, and `GeoJsonAnalysis` into these DTOs with focused pure functions that construct fresh plain objects and preserve core ordering. Add `const jsonValue: JsonValue = result.value` in the success-branch type test. Exact layer/source lookup may return the already-sanitized `StyleLayer`/`StyleSource` because those core types intersect `JsonObject`.

- [ ] **Step 6: Add search, source-layer, and inline GeoJSON inspection**

Dispatch any combination of `--query`/`--type`/`--source`/`--source-layer` to `searchLayers`, then map the result to `InspectLayerSearchDto`. Return source-layer usage as `InspectSourceLayersDto`. For `--analyze-geojson`, require a GeoJSON source, call the core analyzer with its `data`, map every successful `.analysis` to `InspectGeoJsonDto`, and map a failed core result to the CLI semantic error envelope. In particular, string URL data is a successful `{available:false,reason:'remote-url',warnings:[...]}` DTO, is never fetched, and never reaches any file-output function. Only a non-GeoJSON source uses `createStyleToolError('UNSUPPORTED_SOURCE', ...)`; do not hand-copy the error shape or invent a different code.

- [ ] **Step 7: Wire inspect into `runCli`**

After reading the Style, call `validateStyleDocument`. Invalid Style returns its validation envelope and exit `1`. Write `result.value` and exit `0` on inspect success; write `{ ok: false, error }` and exit `1` on semantic lookup failure.

- [ ] **Step 8: Run inspect and regression tests**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --test .tmp/test-dist/cli/run.test.js
rtk pnpm run lint
rtk pnpm run typecheck
```

Expected: all validate and inspect tests pass.

- [ ] **Step 9: Commit inspect**

```bash
rtk git add src/cli/inspect.ts src/cli/run.ts src/cli/run.test.ts
rtk git commit -m "feat(cli): inspect styles and inline GeoJSON"
```

### Task 4: Implement Transactional `apply` and Dry Run

**Files:**
- Modify: `src/cli/run.ts`
- Modify: `src/cli/run.test.ts`

**Interfaces:**
- Consumes: `applyStyleTransaction(style, { operations, validate: true })` and the structured transaction result envelope.
- Produces: apply stdout envelope; no file write occurs in this task.

- [ ] **Step 1: Add failing apply tests**

Add tests that read Style and operations from files, then Style from stdin and operations from a file. Assert a successful dry run returns the full transaction result with changed style but leaves the input bytes unchanged:

```ts
const before = await readFile(stylePath, 'utf8');
const result = await invoke(['apply', stylePath, '--operations', operationsPath, '--dry-run']);
assert.equal(result.code, 0);
assert.equal(result.json.ok, true);
assert.equal(result.json.style.layers[0].paint['line-color'], '#ff0000');
assert.equal(await readFile(stylePath, 'utf8'), before);
```

Add tests for a non-array operations JSON and a semantically invalid transaction. Both are valid JSON but invalid transaction semantics, so both exit `1` with the core `INVALID_INPUT` envelope on stdout and empty stderr. Assert the invalid result preserves the original Style, has empty `changedLayers`/`changedSources`/`diff`, and retains the core-normalized RFC 6901 `path`/details exactly. Retain malformed JSON as the separate `CliInputError`/exit `2` case. Add an unusual layer ID containing `/` and `~` and assert exact pass-through of `changedLayers`, `changedSources`, RFC 6901 paths, and semantic `diff.target`. Add a structural no-op and an atomic rollback case and assert their core result envelopes are not reshaped: both have empty changed-ID/diff arrays, and failure preserves the original Style.

Add one candidate-Style limit failure and one diff-limit failure using the core's existing focused fixtures. Assert the CLI passes each stable core result through byte-for-byte after JSON serialization; it must not recalculate either limit, change the error/path/details, or partially write a file.

- [ ] **Step 2: Run apply tests to verify red**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --test .tmp/test-dist/cli/run.test.js
```

Expected: FAIL because apply is not handled.

- [ ] **Step 3: Implement apply input validation and transaction dispatch**

In `run.ts`, read Style and operations independently through `readJsonInput` and use each result's `.value`. Retain the Style read's file source metadata for Task 6, but never serialize it. Call `validateStyleDocument(styleRead.value)` and continue only from the discriminated success branch's non-optional `style`. Pass `{operations: operationsRead.value, validate:true}` directly to the core, including a non-array operations value; `applyStyleTransaction` owns `styleTransactionSchema.safeParse`, candidate-Style/diff byte limits, and the canonical failure result. The CLI must not parse the transaction schema, construct an `INVALID_INPUT` transaction envelope, or duplicate either result-size gate. Schema/limit failure exits `1`, not `CliInputError`/exit `2`:

```ts
const result = applyStyleTransaction(validated.style, {
  operations: operationsRead.value,
  validate: true,
});
await writeJson(io.stdout, result);
return result.ok ? 0 : 1;
```

Do not write a file when no output option is present or when `dryRun` is true.

- [ ] **Step 4: Run apply tests and the full Node suite**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs
rtk pnpm run lint
rtk pnpm run typecheck
```

Expected: all tests and checks pass.

- [ ] **Step 5: Commit transactional apply**

```bash
rtk git add src/cli/run.ts src/cli/run.test.ts
rtk git commit -m "feat(cli): apply style transactions with dry runs"
```

### Task 5: Add Exclusive Separate Output Files

**Files:**
- Create: `src/cli/file-output.ts`
- Create: `src/cli/file-output.test.ts`
- Modify: `src/cli/run.ts`
- Modify: `src/cli/run.test.ts`

**Interfaces:**
- Consumes: successful `StyleTransactionResult.style` and `CliIo.cwd`.
- Produces: `CliOutputError` with a discriminated commit state, `serializeStyleFile(style): string`, `writeNewOutputFile(path, style, cwd): Promise<void>` using exclusive creation, and stable `POST_COMMIT_STDOUT_FAILURE_DIAGNOSTIC` handling in `runCli`.

- [ ] **Step 1: Write failing exclusive-output tests**

Test that `serializeStyleFile(style)` and `writeNewOutputFile` write exactly `JSON.stringify(style)` as UTF-8—no replacer, indentation, or trailing newline—resolve paths from `cwd`, and refuse an existing file without changing it. Add a `runCli` test proving `--output out.json` changes only the new output path and still writes the transaction envelope to stdout.

Build a valid exact-boundary fixture using the core exports rather than a CLI byte counter:

```ts
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
```

Write that compact Style as the input and apply a same-width change from `#000000` to `#ffffff` with `--output`. Assert success, output `stat.size === DEFAULT_MAX_STYLE_BYTES`, the final byte is `}` rather than newline, and `jsonUtf8ByteLength(JSON.parse(bytes))` remains exactly the core limit. Directly call `readJsonInput(outputPath, makeIo(tempDir))`, narrow its file source, and deep-equal `.value` to the successful core result Style. Then feed the generated file back through `validate`, default `inspect`, and a no-op `apply --dry-run` that sets `#ffffff` again; all three must exit `0`. This is the regression proving file serialization preserves core's exact boundary. Do not call `stat`, `Buffer.byteLength`, `utf8ByteLength`, or `jsonUtf8ByteLength` as a production candidate gate—the latter appears only in the test fixture/assertions.

Add a `RejectingWriter` whose first `_write` calls its callback with `new Error('stdout unavailable')`; do **not** install a test-owned `error` listener because `writeText` owns the write-period listener. Run a successful `--output out.json` transaction with that writer as stdout and a working `BufferWriter` as stderr. Assert exit `3`, the newly committed output file still contains the complete next Style, stderr equals `POST_COMMIT_STDOUT_FAILURE_DIAGNOSTIC + '\n'`, and no cleanup unlinks or rewrites the file. Wait one `setImmediate` turn, assert no uncaught error and the writer's `error` listener count returned to baseline, and do not parse or otherwise trust the failed stdout stream.

Repeat the committed-stdout-failure case with both stdout and stderr rejecting and no external `error` listeners. Assert `runCli` still resolves to `3`, the output file remains complete, both writers return to their baseline listener counts after one `setImmediate`, and no uncaught error changes process/test state; stderr reporting is best-effort, not a second failure result.

In the same test group distinguish the pre-commit branch: make `--output existing.json` fail exclusive creation while stdout is the same rejecting writer. Assert exit `3`, the existing file is unchanged, stdout's `_write` was never called, stderr does not contain `File committed`, and no new file exists. Also run a dry-run with rejecting stdout and assert its exit `3` diagnostic does not claim a file commit.

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --test .tmp/test-dist/cli/file-output.test.js .tmp/test-dist/cli/run.test.js
```

Expected: FAIL because `file-output.ts` does not exist.

- [ ] **Step 3: Implement exclusive output**

Create `src/cli/file-output.ts` using `open(resolve(cwd, path), 'wx', 0o600)`, `FileHandle.writeFile`, `FileHandle.sync`, and `FileHandle.close` in `finally`. `serializeStyleFile` calls `JSON.stringify(style)` exactly once, treats the impossible `undefined` as an internal `CliOutputError`, and returns that compact string unchanged. Write those UTF-8 bytes directly; never add whitespace/newline and never measure them against a CLI-owned limit. Track whether this invocation created the target; if write, sync, or close fails after exclusive creation, remove only that exact newly-created target so a retry is possible. Convert failures to `CliOutputError` and never unlink a target that existed before the call. Add injected write/sync failure tests for handle cleanup and target removal.

```ts
export type CliOutputFailureState =
  | { committed: false }
  | { committed: true; durable: false };
export class CliOutputError extends Error {
  override readonly name = 'CliOutputError';
  constructor(message: string, readonly state: CliOutputFailureState = { committed: false }) {
    super(message);
  }
}
export function serializeStyleFile(style: StyleDocument): string;
export async function writeNewOutputFile(path: string, style: StyleDocument, cwd: string): Promise<void>;
```

Every `writeNewOutputFile` failure is `{committed:false}`. Once it resolves, however, the separate output file is committed for CLI reporting purposes: a subsequent stdout failure must not delete it. Task 6 is the only filesystem helper path that may throw `{committed:true,durable:false}` after an atomic rename.

- [ ] **Step 4: Wire `--output` and exit code 3**

After a successful transaction, call `writeNewOutputFile` before writing the stdout result. Catch a `CliOutputError` from that call as a pre-commit failure: write its diagnostic through `writeDiagnosticBestEffort`, do not attempt stdout, and return `3` even if stderr rejects. Semantic failures never create output.

Export this exact stable diagnostic from `run.ts` for direct tests:

```ts
export const POST_COMMIT_STDOUT_FAILURE_DIAGNOSTIC =
  'File committed, but stdout result delivery failed; do not retry as though no file was written.';
```

Only after `writeNewOutputFile` resolves, call `writeJson(io.stdout, result)` in its own `try/catch`. If that write rejects, do not enter the pre-commit cleanup path and do not call stdout again; attempt exactly `POST_COMMIT_STDOUT_FAILURE_DIAGNOSTIC` through `writeDiagnosticBestEffort`, leave the committed output bytes intact, and return `3` whether stderr succeeds or fails. A stdout failure before any file-output helper succeeds remains the ordinary no-commit exit-`3` path and must not use this diagnostic.

- [ ] **Step 5: Run output tests and static checks**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --test .tmp/test-dist/cli/file-output.test.js .tmp/test-dist/cli/run.test.js
rtk pnpm run lint
rtk pnpm run typecheck
```

Expected: PASS; exact-5-MiB output rereads through validate/inspect/apply, existing-output refusal remains byte-for-byte unchanged, committed output survives failed stdout/stderr delivery, and diagnostics distinguish pre-commit from post-commit failure whenever stderr is writable.

- [ ] **Step 6: Commit separate output support**

```bash
rtk git add src/cli/file-output.ts src/cli/file-output.test.ts src/cli/run.ts src/cli/run.test.ts
rtk git commit -m "feat(cli): write transaction results to new files"
```

### Task 6: Add Atomic In-Place Writes and Non-Overwriting Backups

**Files:**
- Modify: `src/cli/file-output.ts`
- Modify: `src/cli/file-output.test.ts`
- Modify: `src/cli/run.ts`
- Modify: `src/cli/run.test.ts`

**Interfaces:**
- Consumes: a file-backed `STYLE` read's absolute path, `FileIdentity`, and bounded `originalBytes`; Task 5's compact `serializeStyleFile`; a successful transaction style; and `backup: boolean`.
- Produces: `temporaryStylePath(stylePath, token): string`, `AtomicReplaceOptions`, `replaceStyleFileAtomically(path, style, options): Promise<void>`, the internal `runCliWithDependencies` test seam, and stable post-commit/durability diagnostics with read-time identity checks, same-directory temporary file, fsync, rename, and optional exclusive `<STYLE>.bak`.

- [ ] **Step 1: Add failing temp-path and replacement tests**

Test successful replacement and cleanup. Obtain `expectedIdentity` through `readJsonInput(stylePath, io)` and assert its source discriminant is `file`; never synthesize identity by restatting the pathname in the test or helper. Call `temporaryStylePath('/work/styles/map.json', 'fixed-token')` and assert it equals `/work/styles/.map.json.fixed-token.tmp`, proving the temp is in the Style directory. After success, assert no `.*.tmp` file remains.

Reuse Task 5's `makeExactStyle`, write its compact bytes, and apply the same-width `#000000`→`#ffffff` operation with `--in-place --backup`. Assert exit `0`, the installed Style is exactly `DEFAULT_MAX_STYLE_BYTES`, its final byte is `}`, and the backup is the exact original compact byte sequence. Directly call `readJsonInput(stylePath, makeIo(tempDir))`, narrow its file source, and deep-equal `.value` to the successful core result Style. Then run `validate`, default `inspect`, and a no-op `apply --dry-run` against the installed path and assert all exit `0`. This in-place regression must not add a second production size measurement; compact serialization alone keeps the core-accepted candidate readable.

- [ ] **Step 2: Add failing backup and failure-cleanup tests**

Test backup content, existing-backup refusal, original preservation, and absence of `.*.tmp` after failure:

```ts
await replaceStyleFileAtomically(stylePath, nextStyle, {
  backup: true,
  expectedIdentity: styleRead.source.identity,
  originalBytes: styleRead.source.originalBytes,
});
assert.deepEqual(JSON.parse(await readFile(stylePath, 'utf8')), nextStyle);
assert.deepEqual(
  await readFile(`${stylePath}.bak`),
  Buffer.from(styleRead.source.originalBytes),
);
```

Create a symlink `style-link.json` pointing at a real Style and assert in-place mode rejects it with exit `3`: neither the symlink nor its target changes, and no backup/temp file is created. Add two deterministic pathname-replacement races:

1. read the Style and retain its `FileIdentity`, atomically replace the pathname with a different regular file **before** calling the helper, and assert the entry check rejects with `{committed:false}` before creating backup/temp files;
2. replace the pathname from an injected `afterTempSync` hook **after** the helper starts but before its final identity check, and assert the final check rejects with `{committed:false}`, preserves the foreign replacement, and removes only the helper's temp.

Add the backup-specific transient race with `backup:true`: from `beforeBackupWrite`, rename the original inode aside, place foreign bytes at the Style pathname, then remove the foreign pathname and rename the original inode back before returning. The helper may succeed because final identity is restored, but `${stylePath}.bak` must deep-equal `styleRead.source.originalBytes`, never the transient foreign bytes, and no aside/foreign/temp artifact may remain. Add a second pre-commit failure after this backup is created (for example leave a foreign inode for the final identity check) and assert the invocation-created `.bak` is removed and the parent directory resynced, so a corrected retry is not blocked. Never remove a backup that pre-existed the invocation.

Add a final-directory-sync failure test using the injected directory-sync seam. Make the replacement-phase sync throw `EIO` after `rename`; assert the helper throws `CliOutputError` with exactly `{committed:true,durable:false}`, the new Style is present, the old pathname content is not restored, and no temp remains. At the `runCli` level retain the successful core transaction result before injecting the failure, then assert exit `3`, parse stdout, deep-equal `transactionResult` to that retained result, and assert the remaining fields are exactly `ok:false`, `committed:true`, `durable:false`, and `error.code:'OUTPUT_DURABILITY_UNCERTAIN'`; stderr contains the same diagnostic message. This is a committed write with uncertain crash durability, not an unwritten failure.

Add two stdout-failure cases using Task 5's `RejectingWriter` and a usable stderr:

1. let a normal in-place replacement finish completely, then make transaction-result stdout delivery reject. Assert exit `3`, the Style path contains the new Style, backup/temp state is unchanged from a successful commit, stderr equals `POST_COMMIT_STDOUT_FAILURE_DIAGNOSTIC + '\n'`, and the failed stdout is not parsed or retried;
2. inject the real replacement helper through `runCliWithDependencies`, wrapping it with a replacement-phase `syncDirectory` hook that throws `EIO` after rename, and also reject the attempted committed-state stdout acknowledgement. Assert exit `3`, the Style path still contains the new Style, stdout receives only that one failed attempt, and stderr equals `POST_COMMIT_DURABILITY_STDOUT_FAILURE_DIAGNOSTIC + '\n'`. The test must not depend on a JSON acknowledgement because stdout is the failed subsystem.

Repeat each post-commit case with stderr also rejecting and no test-owned `error` listener. After one `setImmediate`, assert both stream listener counts returned to baseline, `runCli` still resolved to `3`, no uncaught error occurred, and the new Style/backup remain committed. The inability to deliver the best-effort diagnostic must not create a fourth state or alter the exit code.

For comparison, run an identity-mismatch or existing-backup pre-commit failure with rejecting stdout and assert stdout is never called, the old Style remains, and stderr does not contain either stable `File committed` diagnostic.

- [ ] **Step 3: Run atomic tests to verify red**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --test .tmp/test-dist/cli/file-output.test.js .tmp/test-dist/cli/run.test.js
```

Expected: FAIL because `replaceStyleFileAtomically`, `runCliWithDependencies`, and committed stdout-failure handling are missing.

- [ ] **Step 4: Implement the same-directory temporary write**

Implement the pure helper and call it with `${process.pid}.${randomUUID()}`:

```ts
export const temporaryStylePath = (stylePath: string, token: string): string =>
  join(dirname(stylePath), `.${basename(stylePath)}.${token}.tmp`);
```

After the entry identity check below and optional backup step succeed, call Task 5's `serializeStyleFile(style)` once, open the temp with `'wx'` and mode `0o600`, write that compact UTF-8 string unchanged, call `sync()`, and close before rename. Do not indent, append a newline, or compare its byte length to any CLI threshold. Track whether the temp exists and remove only that exact path on a pre-commit failure. Backup creation remains a byte-for-byte copy of the originally read file and does not pass through `serializeStyleFile`.

Do **not** capture a new identity in this helper. Accept the read-time identity and explicit internal test seams with these exact contracts:

```ts
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
export async function replaceStyleFileAtomically(
  path: string,
  style: StyleDocument,
  options: AtomicReplaceOptions,
): Promise<void>;
```

At helper entry, call `lstat(path, {bigint:true})`, require a regular non-symlink file, and compare `dev`/`ino` with `options.expectedIdentity` before creating a backup or temp. The default `syncDirectory` implementation opens, syncs, and closes the directory; hooks exist only for deterministic filesystem tests and are never exposed through the CLI API.

- [ ] **Step 5: Implement exclusive backup before replacement**

When `backup` is true, invoke `beforeBackupWrite` after the entry identity check, then open `${stylePath}.bak` directly with `'wx'` and mode `0o600`. Write `options.originalBytes` from the original read descriptor unchanged, call the backup handle's `sync()`, close it in `finally`, and fsync the parent directory before creating the replacement temp. Do not use path-based `copyFile`, `cp`, a second `readFile`, or a newly opened Style pathname: a transient replacement after the entry check must never enter the backup. This makes the read-time backup bytes and directory entry durable before the original can be overwritten.

Track whether this invocation created the backup. On every failure before `rename`, remove that exact invocation-created backup as well as the temp and best-effort fsync the parent directory after cleanup, preventing a failed attempt from blocking a corrected retry. Never unlink a backup that existed before this call. If cleanup itself fails, preserve the primary pre-commit error plus safe cleanup details in `CliOutputError`; do not report success or proceed to rename.

- [ ] **Step 6: Rename atomically and fsync the containing directory**

After the temp is synced/closed and `afterTempSync` returns, immediately `lstat(path, {bigint:true})` again and compare its regular-file `dev`/`ino` to the original read-time `options.expectedIdentity`; reject symlinks, disappearance, or replacement as `new CliOutputError(message, {committed:false})` and clean the exact temp. Then call `rename(temporaryPath, stylePath)` and mark the commit point as crossed before opening/syncing/closing the containing directory. On platforms that report directory fsync itself as unsupported, accept only the documented `EINVAL` or `ENOTSUP`; every other directory open/sync/close error after rename becomes `new CliOutputError(message, {committed:true,durable:false})` and must not trigger rollback or claims that the old file survived.

Document the unavoidable boundary precisely in the module comment and README: Node's pathname APIs provide no portable compare-and-swap rename, so a replacement in the narrow interval between the final `lstat` and `rename` cannot be detected. The entry and pre-rename checks are a best-effort guard, not a lock or absolute race-free guarantee.

- [ ] **Step 7: Wire `--in-place` and `--backup`**

Require the retained Style `JsonInputRead.source.kind` to be `file` and pass its already-resolved `absolutePath`, read-descriptor `identity`, and `originalBytes` to `replaceStyleFileAtomically`; do not resolve, restat, or reread the input independently in `run.ts`. Candidate serialization targets the same path while `.bak` is guaranteed to contain the exact bytes that produced the parsed transaction baseline, even when `io.cwd !== process.cwd()`. Call it only after a successful transaction.

Keep the public signature `runCli(argv, io)` unchanged, but implement it through this direct-module-only test seam; do not export the seam from a package barrel:

```ts
export interface CliRunDependencies {
  replaceStyleFileAtomically: typeof replaceStyleFileAtomically;
}
export async function runCliWithDependencies(
  argv: readonly string[],
  io: CliIo,
  dependencies: CliRunDependencies,
): Promise<CliExitCode>;
export async function runCli(
  argv: readonly string[], io: CliIo,
): Promise<CliExitCode> {
  return runCliWithDependencies(argv, io, { replaceStyleFileAtomically });
}

export const POST_COMMIT_DURABILITY_STDOUT_FAILURE_DIAGNOSTIC =
  'File committed and directory durability is uncertain; stdout acknowledgement failed; do not retry as though no file was written.';
```

Move the existing orchestration body into `runCliWithDependencies` and use `dependencies.replaceStyleFileAtomically` only at the in-place boundary. The production `runCli` delegate supplies the real helper; tests supply a wrapper around that same helper solely to inject the post-rename directory-sync error. Do not replace the filesystem operation with a fake that merely claims a commit—the test must inspect the actually renamed file.

After a fully successful replacement, call `writeJson(io.stdout, result)` in its own `try/catch`. If it rejects, never roll back, delete the backup, or call stdout again; attempt `POST_COMMIT_STDOUT_FAILURE_DIAGNOSTIC` through `writeDiagnosticBestEffort` and return `3` with the new Style left in place even when stderr also rejects.

For `CliOutputError.state.committed === false`, write the diagnostic through `writeDiagnosticBestEffort`, never call stdout, and return `3`. For `{committed:true,durable:false}`, try to write this exact JSON-safe acknowledgement to stdout:

```ts
{
  ok: false,
  committed: true,
  durable: false,
  error: {
    code: 'OUTPUT_DURABILITY_UNCERTAIN',
    message: error.message,
  },
  transactionResult: result,
}
```

If that acknowledgement succeeds, attempt the original durability diagnostic through `writeDiagnosticBestEffort` and return `3`. If it rejects, do not retry or append to stdout; attempt exactly `POST_COMMIT_DURABILITY_STDOUT_FAILURE_DIAGNOSTIC` through `writeDiagnosticBestEffort` and return `3`. A stderr failure is swallowed after its listener lifecycle completes and cannot change the return code. In all cases the new file remains installed. Add a regression test with different `io.cwd` and process cwd. The test matrix must distinguish all three states:

| State | File bytes | Stdout | Stderr | Exit |
|---|---|---|---|---:|
| pre-commit filesystem failure | original/no new output | untouched | ordinary output error; no `File committed` | 3 |
| post-rename directory durability failure | new | committed-state JSON if writable; otherwise untrusted | durability diagnostic, with explicit committed fallback if stdout failed | 3 |
| fully committed file, then stdout result failure | new | untrusted; never retried | `POST_COMMIT_STDOUT_FAILURE_DIAGNOSTIC` | 3 |

- [ ] **Step 8: Run atomic, CLI, and regression tests**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --test .tmp/test-dist/cli/file-output.test.js .tmp/test-dist/cli/run.test.js
rtk pnpm run lint
rtk pnpm run typecheck
```

Expected: all tests pass; exact-5-MiB compact replacement rereads through validate/inspect/apply, backup refusal preserves existing bytes, transient pathname races cannot poison a backup, failed attempts leave no invocation-created backup blocker, and broken stdout/stderr produce no uncaught error.

- [ ] **Step 9: Commit atomic replacement**

```bash
rtk git add src/cli/file-output.ts src/cli/file-output.test.ts src/cli/run.ts src/cli/run.test.ts
rtk git commit -m "feat(cli): replace styles atomically with backups"
```

### Task 7: Add the Executable and Spawned-Process Contract Tests

**Files:**
- Create: `src/cli/main.ts`
- Create: `src/cli/spawn-cli.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runCli(process.argv.slice(2), { stdin, stdout, stderr, cwd })`.
- Produces: compiled executable `.tmp/test-dist/cli/main.js`, production executable `dist/cli/main.js`, and automatic discovery of every compiled `*.test.js`.

- [ ] **Step 1: Create the spawned-process test helper**

Create `src/cli/spawn-cli.test.ts` with `spawnCli(argv, stdinText?)`. It spawns `process.execPath` and `.tmp/test-dist/cli/main.js`, captures stdout/stderr, closes stdin, kills the child after 5 seconds, and returns `Promise<{ code: number; stdout: string; stderr: string }>`. Add `spawnCliWithClosedStdout(argv)`, which uses a piped child stdout but immediately calls `child.stdout.destroy()`, continues capturing stderr, and waits for exit without installing any listener on the child's internal `process.stdout` Writable. Add a generic `spawnEval(source)` for the already-destroyed-Writable harness in Step 3; every helper retains the same five-second kill guard.

- [ ] **Step 2: Add failing process output and exit-code tests**

Add these assertions:

```ts
const success = await spawnCli(['validate', stylePath]);
assert.equal(success.code, 0);
assert.doesNotThrow(() => JSON.parse(success.stdout));
assert.equal(success.stderr, '');
const help = await spawnCli(['--help']);
assert.equal(help.code, 0);
const helpJson = JSON.parse(help.stdout);
assert.equal(helpJson.ok, true);
assert.ok(helpJson.usage.includes('maplibre-style validate STYLE'));
assert.equal(help.stderr, '');
assert.equal((await spawnCli(['apply', '-', '--operations', '-'], '{}')).code, 2);
assert.equal((await spawnCli(['apply', stylePath, '--operations', invalidOps])).code, 1);
assert.equal((await spawnCli(['apply', stylePath, '--operations', ops, '--output', directoryPath])).code, 3);
```

- [ ] **Step 3: Add failing stdin, dry-run, and output process tests**

Spawn validate from stdin and apply with separate stdin/file inputs. Add one test each for dry-run and separate output; inspect input/output bytes as well as exit/stdout/stderr.

Add two real child-process stream-failure gates:

1. In this test file, construct an exact-`DEFAULT_MAX_STYLE_BYTES` Style with the explicit `metadata.padding`/`jsonUtf8ByteLength` formula from Task 5, write same-width color operations, and run `apply STYLE --operations OPS --output OUT` through `spawnCliWithClosedStdout`. Closing the parent read end before the child reports forces the compiled CLI's `process.stdout` path through EPIPE while the large result is delivered. Assert exit `3`, stderr matches `/File committed.*do not retry as though no file was written/i`, `OUT` exists as compact JSON of exactly `DEFAULT_MAX_STYLE_BYTES`, and a subsequent normal spawned `validate OUT` exits `0`.
2. Use `spawnEval` with a generated `harnessSource` that imports `.tmp/test-dist/cli/run.js` by `pathToFileURL`. Generate it with this exact shape (interpolate the test paths with `JSON.stringify`, never shell quoting):

```ts
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
    cwd: ${JSON.stringify(tempDir)},
  });
`;
```

Assert `spawnEval(harnessSource(false))` exits `3`, not an uncaught-error exit. Repeat with `harnessSource(true)`; assert exit `3`, no signal, and no uncaught stack on captured process stderr. Neither closed Writable has an `error` listener. This directly covers an already-closed stream and best-effort diagnostic failure rather than relying only on the EPIPE pipe race.

Both gates must wait one event-loop turn before child exit if needed for `writeText` listener cleanup. Do not add process-level `uncaughtException` handlers that could hide a bug.

- [ ] **Step 4: Add failing in-place and backup process tests**

Add one test each for in-place, backup, and existing-backup refusal; inspect the Style, backup, and absence of temporary files as well as exit/stdout/stderr.

- [ ] **Step 5: Compile and run to verify the missing executable failure**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --test .tmp/test-dist/cli/spawn-cli.test.js
```

Expected: compilation succeeds, then the process test FAILS because `.tmp/test-dist/cli/main.js` does not exist.

- [ ] **Step 6: Add the thin executable entry point**

Create `src/cli/main.ts`:

```ts
#!/usr/bin/env node
import { runCli } from './run.js';

process.exitCode = await runCli(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd(),
});
```

No other module may set `process.exitCode`, read `process.argv`, or write directly to process streams.

- [ ] **Step 7: Verify the foundation recursive runner covers all CLI tests**

Keep the existing `pretest` script explicitly clearing `.tmp/test-dist`, keep `test` compiling with `tsconfig.test.json`, and keep the foundation contract:

```json
"pretest": "node --input-type=module --eval \"import { rmSync } from 'node:fs'; rmSync('.tmp/test-dist', { recursive: true, force: true });\"",
"posttest": "node scripts/run-tests.mjs"
```

Do not replace it with `node --test .tmp/test-dist` or a quoted glob: Node's test runner does not recursively discover this compiled tree from a directory. Keep `tsconfig.test.json` rooted at `src/`, so `main.ts` and all colocated tests compile into the same ESM tree. Lock stale-output cleanup with this executable gate:

```bash
rtk node --input-type=module --eval "import {mkdirSync,writeFileSync} from 'node:fs'; mkdirSync('.tmp/test-dist',{recursive:true}); writeFileSync('.tmp/test-dist/stale-should-not-run.test.js','throw new Error(\"stale sentinel executed\");\n')"
rtk pnpm test
rtk node --input-type=module --eval "import {existsSync} from 'node:fs'; if(existsSync('.tmp/test-dist/stale-should-not-run.test.js')) process.exit(1)"
```

Expected: `pretest` removes the sentinel before compilation, the recursive runner never executes it, all real tests pass, and the final assertion exits 0.

- [ ] **Step 8: Run spawned and complete test suites**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --test .tmp/test-dist/cli/spawn-cli.test.js
rtk pnpm test
rtk pnpm run lint
rtk pnpm run typecheck
rtk pnpm run build
```

Expected: all commands pass, spawned EPIPE/already-closed/both-closed stream cases exit with the prescribed codes and no uncaught stack, exact-boundary committed output remains readable, and `dist/cli/main.js` begins with `#!/usr/bin/env node`.

- [ ] **Step 9: Commit the executable and process tests**

```bash
rtk git add src/cli/main.ts src/cli/spawn-cli.test.ts package.json
rtk git commit -m "test(cli): verify the compiled process contract"
```

### Task 8: Publish the Bin Contract, Document Usage, and Verify Packaging

**Files:**
- Modify: `scripts/check-package.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `eslint.config.js`

**Interfaces:**
- Consumes: a fresh production build, `dist/cli/main.js`, existing root/core/maplibre/ai exports, one real `npm pack --json --pack-destination <unique-temp-dir>` artifact, and the package `files: ["dist"]` allowlist.
- Produces: npm bin `maplibre-style`, documented command/exit/output contracts, and the extended repeatable `pnpm run check:package` acceptance.

- [ ] **Step 1: Extend the foundation package smoke with failing CLI assertions**

Modify `scripts/check-package.mjs`. Preserve the complete layer/data checker, including creation of a real tarball and a temporary bare consumer that imports `maplibre-style-tools`, `/core`, `/maplibre`, and `/ai` through package specifiers. Read the root manifest as `packageJson` and use this syntactically valid assertion exactly—never property syntax across the hyphenated bin name:

```js
assert.equal(packageJson.bin?.['maplibre-style'], './dist/cli/main.js');
```

Use a new `mkdtemp` pack directory on every invocation, execute one checked `npm pack --json --pack-destination <that-directory>` before inspecting or installing anything, require exactly one result/tarball, resolve the returned filename inside that directory, and verify that exact file exists. Never reuse a repository `.tgz`, cached filename, dry-run listing, or an artifact created before the current build. Assert the returned real pack listing contains `dist/cli/main.js` plus `dist/cli/main.d.ts`; install that exact tarball in the bare consumer, then assert the installed `.bin/maplibre-style --help` works and the installed binary can validate a tiny JSON Style fixture. Continue rejecting entries beginning with `src/`, `examples/`, `.tmp/`, `test-results/`, or `playwright-report/`; never replace packed-consumer checks with direct `dist/*` imports. Keep tarball, consumer, and fixture creation/cleanup in one `try/finally` and make every child-process status/stderr check fail loudly.

- [ ] **Step 2: Run the smoke script to verify red**

Run:

```bash
rtk pnpm run build
rtk node scripts/check-package.mjs
```

Expected: the explicit build completes first, then the checker creates a fresh real artifact and FAILS because `package.json` has no `maplibre-style` bin. `scripts/check-package.mjs` does not silently consume a pre-existing tarball or stale `dist` tree.

- [ ] **Step 3: Add the bin without broadening subpath exports**

Modify `package.json`:

```json
"bin": {
  "maplibre-style": "./dist/cli/main.js"
}
```

Do not add a `./cli` subpath export: the approved CLI surface is the binary. Preserve root, `./core`, `./maplibre`, and `./ai` exports exactly, and keep the build-before-check order in the existing script:

```json
"check:package": "pnpm run build && node scripts/check-package.mjs"
```

The package's existing `prepack` may perform its own clean build during the real `npm pack`; this is intentional. The outer `check:package` build makes self-import checks fresh, and the pack-time build makes the tarball fresh.

- [ ] **Step 4: Document exact CLI usage and safety rules**

Add a README section containing these invocations:

```text
maplibre-style --help
maplibre-style validate style.json
maplibre-style inspect style.json --query road
maplibre-style inspect style.json --type line --source basemap --source-layer transportation
maplibre-style inspect style.json --layer road-primary
maplibre-style inspect style.json --source-id basemap
maplibre-style inspect style.json --source-layers
maplibre-style inspect style.json --analyze-geojson points
maplibre-style apply style.json --operations operations.json --dry-run
maplibre-style apply style.json --operations operations.json --output next-style.json
maplibre-style apply style.json --operations operations.json --in-place --backup
```

Document stdin `-`, the two-stdin prohibition, JSON-only stdout while the stream is writable (including the `--help` envelope), stderr diagnostics, exit codes `0/1/2/3`, default non-mutation, exclusive output, same-directory temp+fsync+rename, and non-overwriting `<STYLE>.bak`. State that `--output` and the installed `--in-place` candidate use compact `JSON.stringify(style)` bytes with no newline, so a core-accepted exact-5-MiB Style remains readable by the CLI; `.bak` preserves the exact original input bytes instead of reserializing them or copying from a path that may have raced.

Explicitly state that a stdout transport failure can leave stdout empty or partial and therefore unparseable; stderr is the only possible reporting channel in that branch. Writes own a temporary Writable error listener, EPIPE/closed streams return exit `3`, and stderr reporting is best-effort—if stderr is also closed, the CLI still returns the already selected code without an uncaught error.

Document that in-place identity checks use the descriptor that supplied the read bytes and are best-effort across the final `lstat`→`rename` interval. Explain that backup bytes are retained from that same bounded read, not reread by pathname; invocation-created backups are removed on pre-commit failure so a retry is not blocked, while a pre-existing backup is never removed. Include the same three-state table from Task 6. Explain both committed cases: exit `3` plus `{committed:true,durable:false,...}` stdout means the new Style is installed but directory sync failed; if that acknowledgement cannot be written and stderr works, stderr explicitly reports committed/uncertain state. If either `--output` or `--in-place` commits successfully and only the later result write to stdout fails, the file remains changed and writable stderr prints `POST_COMMIT_STDOUT_FAILURE_DIAGNOSTIC`. In either committed branch, callers must not treat exit `3` as proof that no file was written and must not blindly retry.

- [ ] **Step 5: Keep scripts linted and generated reports ignored**

Extend ESLint global ignores with `examples/browser-bridge/dist`, `playwright-report`, and `test-results`. Add an explicit `files: ['**/*.{js,mjs}']` block extending `js.configs.recommended`, with ESM/ES2023 language options and readonly Node globals actually used by scripts (`process`, `Buffer`, `console`, `setTimeout`, `clearTimeout`, `URL`, `TextEncoder`, and `structuredClone`). Do not disable `no-undef` globally. The package checker and recursive runner must now be linted rather than silently omitted by the TypeScript-only pattern.

- [ ] **Step 6: Run final CLI and package acceptance**

Run:

```bash
rtk pnpm install --frozen-lockfile
rtk pnpm run lint
rtk pnpm run typecheck
rtk pnpm run build
rtk pnpm test
rtk node --input-type=module --eval "import {spawnSync} from 'node:child_process'; const r=spawnSync(process.execPath,['dist/cli/main.js','validate','README.md'],{encoding:'utf8'}); if(r.status!==2||r.stdout!==''||!/Invalid JSON/i.test(r.stderr)) process.exit(1)"
rtk pnpm run clean
rtk pnpm run check:package
rtk git diff --check
```

Expected: every listed command exits 0; the spawned assertion internally proves README validation exits `2`, writes no stdout, and writes an invalid-JSON diagnostic to stderr. Cleaning immediately before `check:package` proves its build ordering works from a fresh checkout without `dist`; the checker then packs a newly built artifact and succeeds with no source, examples, tests, caches, or stale artifact.

- [ ] **Step 7: Verify root and approved subpath imports still load**

Run:

```bash
rtk node --input-type=module --eval "await import('maplibre-style-tools'); await import('maplibre-style-tools/core'); await import('maplibre-style-tools/maplibre'); await import('maplibre-style-tools/ai')"
```

Expected: exit code `0` with no output and no import-time DOM or server side effects.

- [ ] **Step 8: Commit CLI packaging and documentation**

```bash
rtk git add scripts/check-package.mjs package.json README.md eslint.config.js
rtk git commit -m "docs(cli): publish and verify the binary contract"
```

## Final Acceptance

Before handing the CLI subproject to the MCP implementation plan, run:

```bash
rtk pnpm install --frozen-lockfile
rtk pnpm run lint
rtk pnpm run typecheck
rtk pnpm run build
rtk pnpm test
rtk pnpm run clean
rtk pnpm run check:package
rtk git status --short
```

Expected: every command succeeds, the clean-before-package gate rebuilds and tests one fresh real tarball through a bare consumer, and `git status --short` prints nothing. The package remains local on `main`; do not push or publish it.
