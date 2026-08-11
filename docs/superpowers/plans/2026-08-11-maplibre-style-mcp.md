# MapLibre Style MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Node-only, transport-neutral Model Context Protocol server that safely opens bounded in-memory MapLibre style sessions and exposes inspection and transaction capabilities through tools, resources, stdio, and an optional protected loopback HTTP endpoint.

**Architecture:** Keep all MapLibre-style transformations in synchronous, pure core functions and make MCP adapters thin asynchronous boundaries. A bounded `StyleSessionStore` owns cloned documents, revision snapshots, expiration, and per-session serialization; tool and resource handlers consume the store without learning which transport called them. `McpServerExtension` is the only server-registration seam so a later live-map bridge can use the same contracts without modifying transport wiring.

**Tech Stack:** TypeScript 5.9, Node.js >=22.13, `@modelcontextprotocol/sdk` ^1.30.0, Zod 4, Node `http`, Node test runner, existing MapLibre style-spec validation, pnpm 10.

## Global Constraints

- Execute only after the standalone extraction, core foundation, layer/data, and CLI plans are complete and green. The fixed delivery order is `standalone extraction → core foundation → layer/data → CLI → MCP → live bridge`.
- The package must install `@modelcontextprotocol/sdk` at version `^1.30.0` and use only its documented v1 subpath entries: `server/mcp.js` (`McpServer`, `ResourceTemplate`), `server/stdio.js`, `server/streamableHttp.js`, `client/index.js`, `client/streamableHttp.js`, `client/stdio.js`, `inMemory.js`, and `types.js`. Do not import the package root or assume `@modelcontextprotocol/sdk/server` exports `McpServer`.
- All document-domain interfaces remain synchronous and pure: `validateStyleDocument(style, options?)`, `applyStyleTransaction(style, transaction, options?)`, `buildStyleContext`, `searchLayers`, `analyzeGeoJson`, and `listSourceLayers(style, { sourceId? })`.
- MCP handlers and every session queue boundary are asynchronous even when they invoke synchronous domain functions.
- Session data is strictly in-memory JSON supplied by MCP inputs; the server must never open or read a filesystem path requested by a client.
- A store defaults to 32 sessions, a 5 MiB serialized style limit, 100 transaction operations, 20 history entries, a 1 MiB serialized diff limit, and a 30-minute TTL.
- A committed transaction uses optimistic concurrency through `expectedRevision`; a successful `dryRun` never increments the revision or alters session history.
- Work for one session is serial; work for different sessions may run concurrently.
- Document tool names are exactly `style_session_open`, `style_session_close`, `style_validate`, `style_inspect`, `style_search_layers`, `style_analyze_geojson`, `style_apply_transaction`, and `style_export`.
- Resource templates are exactly `maplibre-style://sessions/~{sessionId}`, `maplibre-style://sessions/~{sessionId}/style`, `maplibre-style://sessions/~{sessionId}/context`, `maplibre-style://sessions/~{sessionId}/layers/~{layerId}`, `maplibre-style://sessions/~{sessionId}/sources/~{sourceId}`, and `maplibre-style://sessions/~{sessionId}/revisions/~{revision}/diff`; the literal marker is advertised while each raw semantic variable is percent-encoded once by RFC6570, and resolvers reject unmarked aliases before decoding exactly once.
- `./mcp` is an explicit package export and importing it must not start a server, listen on a port, write standard streams, or retain active handles.
- The stdio binary is named `maplibre-style-mcp`; its stdout contains MCP framing from byte zero, while help text, diagnostics, startup connection details, and errors are written only to stderr.
- Streamable HTTP is optional, listens on loopback and a random port by default, requires a bearer token, validates `Host` against the bound loopback authority, and rejects non-loopback hosts unless an explicit opt-in is provided.
- MCP transport session state is distinct from application `StyleSessionStore` state, although both may be created by the same HTTP process.
- Each task must retain existing user changes, must not rewrite unrelated files, and must finish with its listed `rtk git add` and `rtk git commit` commands after passing its focused checks.
- All shell commands in this plan are written with the `rtk` prefix so the repository command wrapper is always used.

## Proposed File Structure

- `src/core/validation.ts` — existing synchronous `validateStyleDocument` contract consumed by the MCP adapter.
- `src/core/transaction.ts` — existing synchronous `applyStyleTransaction` contract consumed by the session store.
- `src/core/geojson-analysis.ts` — existing synchronous `analyzeGeoJson` contract consumed by the document handler.
- `src/core/context.ts` — existing synchronous `buildStyleContext` contract consumed by handlers and resources.
- `src/core/search.ts` — existing synchronous `searchLayers` and `listSourceLayers` contracts consumed by handlers and resources.
- `src/mcp/types.ts` — request, response, revision, resource, store, and extension contracts owned by the MCP package boundary.
- `src/mcp/version.generated.ts` — build-time generated MCP implementation version derived only from the root package manifest.
- `src/mcp/schemas.ts` — the eight complete strict document-tool input schemas and their command-specific response-data schemas.
- `src/mcp/output.ts` — stable `McpToolEnvelope<T>` construction with identical JSON content and `structuredContent` payloads.
- `src/mcp/session-store.ts` — bounded style-session ownership, fake-clock injection, history, expiration, and per-session queues.
- `src/mcp/document-handlers.ts` — transport-neutral asynchronous handlers for the eight document tools.
- `src/mcp/resources.ts` — transport-neutral asynchronous resource resolution and URI parsing.
- `src/mcp/server-extension.ts` — `McpServerExtension` seam and registration into a v1 `McpServer`.
- `src/mcp/create-server.ts` — side-effect-free server factory that composes store, handlers, resources, and extension.
- `src/mcp/stdio.ts` — explicit stdio runner used only by the executable entry point.
- `src/mcp/http.ts` — optional secure Streamable HTTP listener and loopback request protection.
- `src/mcp/main.ts` — public MCP API and executable entry point exported as `./mcp` and used by the existing binary field.
- `src/mcp/*.test.ts` — Node tests compiled by the project test TypeScript configuration.
- `tsconfig.mcp.json` — Node-only compiler project with Node types and no DOM library.
- `scripts/check-package.mjs` — package export and packed-artifact smoke checks.
- `scripts/generate-mcp-version.mjs` — deterministic generator/checker that prevents the MCP implementation version from drifting from the root package manifest.
- `scripts/check-mcp-typegraph.mjs` — `tsc --listFiles` assertion that keeps browser/MapLibre runtime modules out of the Node-only MCP project.
- `README.md` — installation, stdio, and protected loopback HTTP usage documentation.

---

### Task 1: Establish Node-only MCP package scaffolding

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `tsconfig.mcp.json`
- Modify: `tsconfig.build.json`
- Modify: `tsconfig.test.json`
- Create: `scripts/generate-mcp-version.mjs`
- Create: `scripts/check-mcp-typegraph.mjs`
- Create: `src/mcp/types.ts`
- Create: `src/mcp/version.generated.ts`
- Create: `src/mcp/version.test.ts`
- Create: `src/mcp/main.ts`
- Create: `src/mcp/main.test.ts`
- Create: `src/mcp/sdk-imports.test.ts`

**Interfaces:**
- Consumes: existing ESM package settings, Node >=22.13 engine, existing TypeScript build references.
- Produces: a lockfile-pinned `@modelcontextprotocol/sdk` ^1.30.0 dependency, package export `maplibre-style-tools/mcp` with a `default` condition, the existing binary retained, exported default `MAX_MCP_MESSAGE_BYTES = 5 * 1024 * 1024` plus fixed framing/headroom constants including `MAX_STYLE_SESSION_ID_BYTES = 512`, an MCP implementation version generated from the root manifest as its only authority, and a Node-only compiler project that later MCP modules reference.

- [ ] **Step 1: Write a failing package-surface test (2 minutes).**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import * as mcp from './main.js';

test('MCP public module is importable without starting a server', () => {
  assert.equal(typeof mcp, 'object');
  assert.equal(process.stdout.listenerCount('data'), 0);
});
```

In `src/mcp/sdk-imports.test.ts`, import each SDK symbol from the exact subpath listed in Global Constraints and assert its constructor/function shape, including `InMemoryTransport.createLinkedPair` and `isInitializeRequest`. This is a compile/import smoke, not a re-export requirement for this package.

In `src/mcp/version.test.ts`, read the root `package.json` in test code and assert its `version` equals the generated `MCP_SERVER_VERSION`. Also assert `MAX_MCP_MESSAGE_BYTES === 5 * 1024 * 1024`, `MIN_MCP_MESSAGE_BYTES === 128 * 1024`, `MCP_RESPONSE_ENVELOPE_RESERVE_BYTES === 64 * 1024`, `MAX_MCP_REQUEST_ID_BYTES === 256`, `MAX_MCP_METHOD_BYTES === 128`, `MAX_MCP_RESOURCE_URI_BYTES === 8 * 1024`, and `MAX_STYLE_SESSION_ID_BYTES === 512`; importing `main.ts` adds no active handle. The runtime module itself must not search for or read a manifest.

- [ ] **Step 2: Run the focused test and verify it fails because the MCP public entry does not exist (2 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="MCP public module|SDK 1.30 public subpath"
```

Expected: FAIL with a TypeScript module-resolution error for `./main.js` and missing generated version/type-graph scripts.

- [ ] **Step 3: Add the smallest build and export skeleton (4 minutes).**

```bash
rtk pnpm add @modelcontextprotocol/sdk@^1.30.0
```

Add an `exports["./mcp"]` entry whose `types` points to `./dist/mcp/main.d.ts` and whose `import`/`default` point to `./dist/mcp/main.js`. Extend rather than replace the CLI bin:

```json
"bin": {
  "maplibre-style": "./dist/cli/main.js",
  "maplibre-style-mcp": "./dist/mcp/main.js"
}
```

Create `tsconfig.mcp.json` with `"lib": ["ES2023"]`, `"types": ["node"]`, `"module": "NodeNext"`, no DOM library, exact `"include": ["src/mcp/**/*.ts"]`, and `"exclude": ["src/mcp/**/*.test.ts", "dist", ".tmp", "node_modules", "examples"]`. Imported pure-core files may enter the program, but browser adapters, AI SDK modules, legacy tools, examples, and `maplibre-gl` runtime modules may not. The only future adapter exception is the live-bridge plan's pure, Node-safe `src/adapters/maplibre/style-hash.ts`; allowing that exact leaf must not allow its directory siblings. Add `typecheck:mcp` and call it from the root `typecheck` script.

Use the root manifest as the only editable version source without a fragile runtime JSON import whose relative path changes under `.tmp/test-dist`. `scripts/generate-mcp-version.mjs` reads and validates root `package.json`, deterministically writes only `src/mcp/version.generated.ts`, and supports `--check` to compare expected content without writing. Add `generate:mcp-version` and `check:mcp-version` package scripts; compose the check into existing typecheck/test/build hooks without dropping prior hook work. Run the generator once in this task. Never hand-edit the generated file. Export `MCP_SERVER_VERSION`, `MAX_MCP_MESSAGE_BYTES`, `MIN_MCP_MESSAGE_BYTES`, `MAX_CONFIGURABLE_MCP_MESSAGE_BYTES = 64 * 1024 * 1024`, `MCP_RESPONSE_ENVELOPE_RESERVE_BYTES`, `MAX_MCP_REQUEST_ID_BYTES`, `MAX_MCP_METHOD_BYTES`, `MAX_MCP_RESOURCE_URI_BYTES`, and `MAX_STYLE_SESSION_ID_BYTES` through `main.ts`; all byte constants are declared once in `types.ts`. `MAX_MCP_MESSAGE_BYTES` is the safe default resolved per-message limit, while later embedders may explicitly lower/raise it only within the exported configurable bounds. The session-ID bound guarantees both the fixed open envelope and every percent-encoded resource URI fit the minimum policy/URI framing reserves. This generated artifact is the safer build-time equivalent of an ESM JSON import: installed runtime code performs no manifest I/O, while every quality gate fails on drift.

`scripts/check-mcp-typegraph.mjs` launches the repository TypeScript compiler with `-p tsconfig.mcp.json --listFiles`, requires at least one `src/mcp/` and one `src/core/` file, and fails if any normalized path contains `/src/ai-sdk/`, `/src/tools/`, `/src/engine/`, `/examples/`, `maplibre-gl/dist`, or a DOM lib. It also fails for every `/src/adapters/maplibre/` path except the exact normalized suffix `/src/adapters/maplibre/style-hash.ts`; test both one allowed fixture path and representative rejected sibling/runtime paths so the exception cannot widen accidentally. The later live-bridge plan must rerun this checker after wiring its exports. Create the initial shared MCP types and a `main.ts` with no module-scope `McpServer`; later direct execution uses a shebang plus an `import.meta.url`/`process.argv[1]` guard, so package import remains side-effect-free.

Because the public MCP declarations expose Node stream/server types while the package's general root surface is browser-capable, begin the Node-only MCP declaration root with `/// <reference types="node" preserve="true" />` and verify the emitted `dist/mcp/main.d.ts` retains that directive. Use the foundation package's regular `@types/node@^22.20.1` dependency; do not rely on a dev-only ambient installation or add DOM types to MCP merely to satisfy consumers.

```bash
rtk pnpm run generate:mcp-version
```

- [ ] **Step 4: Run typecheck and the focused test (3 minutes).**

```bash
rtk pnpm run typecheck
rtk pnpm run check:mcp-version
rtk node scripts/check-mcp-typegraph.mjs
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="MCP public module|SDK 1.30 public subpath|MCP version|message byte limit|framing byte bounds"
```

Expected: PASS; the generated version and message/framing constants match their single authorities, the `--listFiles` program contains only MCP plus pure dependencies, and importing `src/mcp/main.ts` does not connect, listen, read a manifest, or write to standard streams.

- [ ] **Step 5: Commit the independently buildable MCP scaffold (2 minutes).**

```bash
rtk git add package.json pnpm-lock.yaml tsconfig.mcp.json tsconfig.build.json tsconfig.test.json scripts/generate-mcp-version.mjs scripts/check-mcp-typegraph.mjs src/mcp/types.ts src/mcp/version.generated.ts src/mcp/version.test.ts src/mcp/main.ts src/mcp/main.test.ts src/mcp/sdk-imports.test.ts
rtk git commit -m "build: scaffold MapLibre style MCP package"
```

### Task 2: Verify and consume existing synchronous validation core

**Files:**
- Modify: `src/mcp/types.ts`
- Create: `src/mcp/core-adapters.ts`
- Create: `src/mcp/core-adapters.test.ts`

**Interfaces:**
- Consumes: existing `src/core/validation.ts` export `validateStyleDocument(style, options?)`, whose discriminated result has `ok`, a required normalized `style` only in the `ok:true` branch, `errors`, and `warnings`.
- Produces: a typed synchronous adapter declaration preserving `validateStyleDocument(style, options?)` exactly; it adds no core implementation and introduces no Promise at the core boundary.

- [ ] **Step 1: Write the failing validation contract tests (4 minutes).**

```ts
test('validation adapter preserves existing result fields synchronously', () => {
  const result = validateStyleDocument(validStyle);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.style.version, 8);
  assert.ok(Array.isArray(result.errors));
  assert.ok(Array.isArray(result.warnings));
});

test('validateStyleDocument reports invalid documents synchronously', () => {
  const result = validateStyleDocument({ version: 7, layers: [] } as StyleDocument);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});
```

- [ ] **Step 2: Run only the validation test and confirm the named function is unavailable (2 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --test .tmp/test-dist/mcp/core-adapters.test.js
```

Expected: FAIL until the MCP adapter imports the already-existing core symbol and preserves its field names.

- [ ] **Step 3: Implement a typed synchronous import adapter only (4 minutes).**

```ts
import { validateStyleDocument } from '../core/validation.js';
export { validateStyleDocument };
export type { StyleValidationResult as ValidationResult } from '../core/validation.js';
```

Do not edit `src/core/validation.ts` or recreate its validator. The adapter only narrows compile-time types for MCP callers and never performs I/O or invokes a transport.

- [ ] **Step 4: Verify the core remains synchronous and passes (3 minutes).**

```bash
rtk pnpm run typecheck
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --test .tmp/test-dist/mcp/core-adapters.test.js
```

Expected: PASS; TypeScript rejects assigning this pure core result to `Promise<ValidationResult>`.

- [ ] **Step 5: Commit validation core (2 minutes).**

```bash
rtk git add src/mcp/types.ts src/mcp/core-adapters.ts src/mcp/core-adapters.test.ts
rtk git commit -m "test: verify existing style validation core contract"
```

### Task 3: Verify and consume existing transaction, GeoJSON, and search core

**Files:**
- Modify: `src/mcp/core-adapters.ts`
- Modify: `src/mcp/core-adapters.test.ts`
- Modify: `src/mcp/types.ts`

**Interfaces:**
- Consumes: existing `src/core/transaction.ts`, `src/core/geojson-analysis.ts`, and `src/core/search.ts` exports. The transaction input includes an `op` field and its result has `changedLayers`, `changedSources`, and `diff`.
- Produces: adapter exports for the existing synchronous `applyStyleTransaction`, `analyzeGeoJson`, `buildStyleContext`, `searchLayers`, and `listSourceLayers(style, { sourceId? })` contracts.

- [ ] **Step 1: Write failing tests for all three pure functions (5 minutes).**

```ts
test('transaction adapter passes op and exposes existing changed fields', () => {
  const result = applyStyleTransaction(style, { operations: [{
    op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#fff' },
  }] });
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.changedLayers));
  assert.ok(Array.isArray(result.changedSources));
  assert.ok(Array.isArray(result.diff));
});

test('analyzeGeoJson counts feature geometry types', () => {
  const result = analyzeGeoJson({ type: 'FeatureCollection', features: [{
    type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {},
  }] });
  assert.equal(result.ok, true);
  if (!result.ok || !result.analysis.available) assert.fail('expected available inline analysis');
  assert.deepEqual(result.analysis.geometryTypes, { Point: 1 });
});

test('listSourceLayers filters by source id', () => {
  assert.deepEqual(listSourceLayers(style, { sourceId: 'streets' }).map((entry) => entry.sourceLayer), ['road']);
});
```

- [ ] **Step 2: Run the core test files and verify all imports fail (2 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="transaction adapter|analyzeGeoJson|listSourceLayers"
```

Expected: FAIL until the adapter imports the existing exports without changing their synchronous signatures.

- [ ] **Step 3: Implement imports and type assertions only (4 minutes).**

```ts
export { applyStyleTransaction } from '../core/transaction.js';
export { analyzeGeoJson } from '../core/geojson-analysis.js';
export { buildStyleContext } from '../core/context.js';
export { searchLayers, listSourceLayers } from '../core/search.js';
```

Do not edit or reimplement the existing core modules. Confirm in the test that `StyleTransaction` contains `operations:[{op: ...}]`, the result retains `changedLayers`, `changedSources`, and `diff`, and all five functions return synchronously.

- [ ] **Step 4: Run focused tests and the existing engine tests (3 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="transaction adapter|analyzeGeoJson|listSourceLayers|buildStyleContext|searchLayers"
```

Expected: PASS; MCP code consumes the already-approved pure core API without creating a parallel domain implementation.

- [ ] **Step 5: Commit pure domain extensions (2 minutes).**

```bash
rtk git add src/mcp/core-adapters.ts src/mcp/core-adapters.test.ts src/mcp/types.ts
rtk git commit -m "test: verify existing MapLibre core contracts"
```

### Task 4: Implement stable MCP tool envelopes

**Files:**
- Create: `src/mcp/output.ts`
- Create: `src/mcp/output.test.ts`
- Create: `src/mcp/message-boundary.ts`
- Create: `src/mcp/message-boundary.test.ts`
- Modify: `src/mcp/types.ts`
- Modify: `src/mcp/main.ts`

**Interfaces:**
- Consumes: core `JsonValue`, `JsonObject`, `StyleToolError`, `STYLE_TOOL_ERROR_CODES`, provenance-based `isStyleToolError`, `jsonValueSchema`, Task 1 message/framing constants, and SDK 1.30 `McpServer`, `McpError`, `ErrorCode`, plus `CallToolResultSchema`/JSON-RPC/tool-result shapes only from the already-approved `server/mcp.js` and `types.js` subpaths.
- Produces: `McpToolMeta`, `McpToolEnvelope<T>`, `McpTextToolResult<T>`, exported `McpMessagePolicy`/`resolveMcpMessagePolicy({maxMessageBytes?})` and `ResourceUriAdmission`, Node-internal `createMcpResponseBoundary(policy)`, composition-time `createResourceUriAdmissionRegistry()` and frozen `InboundMcpFramingContext`, `assertInboundMcpFraming(value, policy, context?)`, and transparent `createBoundedMcpTransport(raw, policy, context, onTerminal)`, exported `parseOfficialCallToolResult(value: unknown): CallToolResult`, wire-only `styleToolErrorWireSchema`/`parseStyleToolErrorShape(value)`, `createMcpToolEnvelopeSchema(dataSchema)`, general `mcpToolEnvelopeSchema`/`parseMcpToolEnvelope(value: unknown)`, unconstrained `toolSuccess<T>(data: T, meta?: McpToolMeta)`, and covariant `toolFailure(error: StyleToolError): McpTextToolResult<never>`; each result has one statically known text-content tuple and an equal `structuredContent` object. MCP does not define a second error-code, error-shape union, or authenticity guard.

- [ ] **Step 1: Write failing envelope parity tests (4 minutes).**

```ts
test('toolSuccess keeps content JSON and structuredContent equal', () => {
  const result = toolSuccess({ revision: 3, layers: ['roads'] });
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(result.isError, undefined);
});

test('toolFailure has stable envelope fields', () => {
  const result = toolFailure(createStyleToolError(
    'NOT_FOUND', 'Session was not found.', undefined, { entity: 'session' },
  ));
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(result.isError, true);
  assert.equal(parseStyleToolErrorShape(result.structuredContent.ok ? undefined : result.structuredContent.error).code, 'NOT_FOUND');
});

test('toolSuccess accepts core interface results and still emits an SDK record', () => {
  const validation: StyleValidationResult = validateStyleDocument({ version: 8, sources: {}, layers: [] });
  const result = toolSuccess(validation);
  const structured: Record<string, unknown> = result.structuredContent;
  assert.equal(structured.ok, true);
});

test('failure result is assignable through a generic guarded return', async () => {
  const guarded: Promise<McpTextToolResult<number>> = Promise.resolve(
    toolFailure(createStyleToolError('NOT_FOUND', 'missing')),
  );
  assert.equal((await guarded).isError, true);
});

test('official result parser excludes the SDK compatibility wrapper before content access', () => {
  assert.equal(parseOfficialCallToolResult(toolSuccess({ value: 1 })).content[0]?.type, 'text');
  const compatibility = {
    toolResult: toolSuccess({ value: 1 }),
    content: [{ type: 'text', text: '{"ok":true,"data":{"value":1}}' }],
    structuredContent: { ok: true, data: { value: 1 } },
    isError: false,
  };
  assert.throws(() => parseOfficialCallToolResult(compatibility), /compatibility wrapper/);
  let getterCalls = 0;
  const hostile = { ...compatibility };
  Object.defineProperty(hostile, 'toolResult', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('private getter'); },
  });
  assert.throws(() => parseOfficialCallToolResult(hostile), /compatibility wrapper/);
  assert.equal(getterCalls, 0);
});

test('response boundary measures duplicated text and structured content without leaking data', () => {
  const boundary = createMcpResponseBoundary(resolveMcpMessagePolicy({ maxMessageBytes: MIN_MCP_MESSAGE_BYTES }));
  const secret = 'private-style-value'.repeat(20_000);
  assert.throws(
    () => boundary.requireToolSuccess({ style: secret }),
    (error) => isStyleToolError(error)
      && error.code === 'INVALID_INPUT'
      && error.details?.reason === 'responseTooLarge'
      && !JSON.stringify(error).includes('private-style-value'),
  );
  const boundedFailure = boundary.requireToolFailure(createStyleToolError(
    'INVALID_INPUT', 'private-error-value'.repeat(20_000), '/private/path'.repeat(20_000),
  ));
  assert.equal(parseFailure(boundedFailure).error.details?.reason, 'responseTooLarge');
  assert.doesNotMatch(boundedFailure.content[0].text, /private-error-value|private\/path/);
  assert.ok(utf8JsonBytes(boundedFailure) <= boundary.policy.applicationResultBytes);
  const resourceError = boundary.requireResourceFailure(createStyleToolError(
    'INVALID_INPUT', 'private-resource-error'.repeat(20_000),
  ));
  assert.equal(parseStyleToolErrorShape(resourceError.data).details?.reason, 'responseTooLarge');
  assert.doesNotMatch(JSON.stringify(resourceError.data), /private-resource-error/);
});

test('message policy accepts explicit lower and raised bounds but rejects unsafe values', () => {
  assert.equal(resolveMcpMessagePolicy({ maxMessageBytes: MIN_MCP_MESSAGE_BYTES }).maxMessageBytes, MIN_MCP_MESSAGE_BYTES);
  assert.equal(resolveMcpMessagePolicy({ maxMessageBytes: 8 * 1024 * 1024 }).maxMessageBytes, 8 * 1024 * 1024);
  for (const value of [0, MIN_MCP_MESSAGE_BYTES - 1, MAX_CONFIGURABLE_MCP_MESSAGE_BYTES + 1, 1.5, Number.NaN]) {
    assert.throws(() => resolveMcpMessagePolicy({ maxMessageBytes: value }), { code: 'INVALID_INPUT' });
  }
});

test('bounded transport sends exact bytes once and replaces an oversized response once', async () => {
  const raw = createRecordingTransport();
  const terminal: unknown[] = [];
  const policy = resolveMcpMessagePolicy({ maxMessageBytes: MIN_MCP_MESSAGE_BYTES });
  const bounded = createBoundedMcpTransport(raw, policy, canonicalInbound, (error) => terminal.push(error));
  await bounded.send(makeJsonRpcResponseOfSerializedSize(policy.maxMessageBytes));
  assert.equal(utf8JsonBytes(raw.sent[0]), policy.maxMessageBytes);
  await bounded.send(makeJsonRpcResponseOfSerializedSize(policy.maxMessageBytes + 1, { id: 'safe-id' }));
  assert.equal(raw.sent.length, 2);
  assert.equal(raw.sent[1]?.id, 'safe-id');
  assert.equal(raw.sent[1]?.error?.data?.details?.reason, 'responseTooLarge');
  assert.ok(utf8JsonBytes(raw.sent[1]) <= policy.maxMessageBytes);
  assert.deepEqual(terminal, []);
});

test('unsafe framing and uncorrelatable oversized messages terminate before dispatch', async () => {
  const policy = resolveMcpMessagePolicy({});
  assert.throws(
    () => assertInboundMcpFraming(requestWithSerializedIdBytes(MAX_MCP_REQUEST_ID_BYTES + 1), policy),
    { code: 'INVALID_INPUT', details: { reason: 'requestIdTooLarge' } },
  );
  assert.throws(
    () => assertInboundMcpFraming(resourceReadWithUriBytes(MAX_MCP_RESOURCE_URI_BYTES + 1), policy),
    { code: 'INVALID_INPUT', details: { reason: 'resourceUriTooLarge' } },
  );
  const terminal = createTerminalRecorder();
  const raw = createRecordingTransport();
  const bounded = createBoundedMcpTransport(raw, policy, canonicalInbound, terminal.record);
  const protocolCalls = { value: 0 };
  bounded.onmessage = () => { protocolCalls.value += 1; };
  await bounded.start();
  raw.emitMessage(requestWithSerializedIdBytes(MAX_MCP_REQUEST_ID_BYTES + 1));
  assert.equal(protocolCalls.value, 0);
  await assert.rejects(() => bounded.send(makeOversizedNotification(policy.maxMessageBytes + 1)));
  assert.equal(raw.sent.length, 0);
  assert.equal(terminal.calls, 1); // both failures share the terminal latch
  await bounded.close();
  await bounded.close();
  assert.equal(raw.startCalls, 1);
  assert.equal(raw.closeCalls, 1);
  assertRawTransportCallbackBaseline(raw);
});

test('raw resource URI admission rejects aliases before protocol URL parsing', async () => {
  const policy = resolveMcpMessagePolicy({});
  const registry = createResourceUriAdmissionRegistry();
  registry.register({
    scheme: 'example-resource',
    authority: 'items',
    assertCanonical: (rawUri) => {
      if (rawUri !== 'example-resource://items/~.') throw nonCanonicalResourceUri();
    },
  });
  registry.register({
    scheme: 'example-resource',
    authority: 'maps',
    assertCanonical: (rawUri) => {
      if (rawUri !== 'example-resource://maps/~map-1') throw nonCanonicalResourceUri();
    },
  });
  assert.throws(
    () => registry.register({ ...otherAdmission, scheme: 'example-resource', authority: 'items' }),
    { code: 'INVALID_INPUT', details: { reason: 'duplicateResourceNamespace' } },
  );
  const admissions = registry.freeze();
  assert.throws(
    () => registry.register({ ...otherAdmission, scheme: 'late-resource', authority: 'items' }),
    { code: 'INVALID_INPUT', details: { reason: 'resourceAdmissionsFrozen' } },
  );
  assert.doesNotThrow(() => assertInboundMcpFraming(
    resourceReadRequest('example-resource://items/~.'), policy, canonicalInboundWith(admissions),
  ));
  for (const rawUri of [
    'example-resource://items/..',
    'example-resource://items/%2e%2e',
    'example-resource://items/foo/../~.',
    'unknown-resource://items/~.',
    'example-resource://unknown/~.',
  ]) {
    assert.throws(
      () => assertInboundMcpFraming(resourceReadRequest(rawUri), policy, canonicalInboundWith(admissions)),
      { code: 'INVALID_INPUT' },
    );
  }

  const raw = createRecordingTransport();
  const terminal = createAsyncTerminalRecorder();
  const bounded = createBoundedMcpTransport(raw, policy, canonicalInboundWith(admissions), terminal.record);
  let protocolCalls = 0;
  bounded.onmessage = () => { protocolCalls += 1; };
  await bounded.start();
  raw.emitMessage(resourceReadRequest('example-resource://items/%2e%2e', { id: 'safe' }));
  await raw.nextSend;
  assert.equal(protocolCalls, 0);
  assert.match(
    raw.sent[0]?.error?.data?.details?.reason,
    /nonCanonicalResourceUri|unregisteredResourceNamespace/,
  );
  assert.equal(terminal.calls, 0);
  raw.emitMessage(smallNonResourceRequest);
  assert.equal(protocolCalls, 1); // correlated URI rejection keeps the connection usable
  await bounded.close();
});

test('a byte-bounded runner does not remeasure expanded canonical JSON', () => {
  const compactWire = makeRequestWithManyExponentNumbers(MIN_MCP_MESSAGE_BYTES);
  assert.equal(Buffer.byteLength(compactWire.bytes), MIN_MCP_MESSAGE_BYTES);
  assert.ok(utf8JsonBytes(compactWire.parsed) > MIN_MCP_MESSAGE_BYTES);
  assert.doesNotThrow(() => assertInboundMcpFraming(
    compactWire.parsed,
    resolveMcpMessagePolicy({ maxMessageBytes: MIN_MCP_MESSAGE_BYTES }),
    preboundedInbound,
  ));
  const prebounded = createBoundedMcpTransport(
    createRecordingTransport(), lowerPolicy, preboundedInbound, noopTerminal,
  );
  const canonical = createBoundedMcpTransport(
    createRecordingTransport(), lowerPolicy, canonicalInbound, noopTerminal,
  );
  assert.equal(dispatchToProtocol(prebounded, compactWire.parsed), 'forwarded');
  assert.equal(dispatchToProtocol(canonical, compactWire.parsed), 'rejected-messageTooLarge');
});

test('raw send rejection enters the terminal latch for ordinary and fallback sends', async () => {
  for (const scenario of [rejectOrdinaryRawSend, rejectOversizeFallbackRawSend]) {
    const primary = new Error(`raw-send-${scenario.name}`);
    const raw = createRejectingRecordingTransport(primary, scenario);
    const terminal = createAsyncTerminalRecorder();
    const bounded = createBoundedMcpTransport(
      raw, resolveMcpMessagePolicy({}), canonicalInbound, terminal.record,
    );
    await bounded.start();
    await assert.rejects(() => scenario.sendThrough(bounded), (error) => error === primary);
    await terminal.settled;
    assert.equal(terminal.calls, 1);
    assert.equal(raw.sendCalls, 1); // a rejected fallback is never followed by another fallback/send
    assert.equal(raw.closeCalls, 1);
    assertRawTransportCallbackBaseline(raw);
  }
});

test('bounded decorator is transparent for the complete SDK 1.30 transport surface', async () => {
  const prior = { errors: [] as unknown[], closes: 0 };
  const raw = createRecordingTransport({
    sessionId: 'before-init',
    onerror: (error) => { prior.errors.push(error); },
    onclose: () => { prior.closes += 1; },
  });
  const terminal = createAsyncTerminalRecorder();
  const bounded = createBoundedMcpTransport(
    raw, resolveMcpMessagePolicy({}), canonicalInbound, terminal.record,
  );
  assert.equal(bounded.sessionId, 'before-init');
  raw.sessionId = 'after-init';
  assert.equal(bounded.sessionId, 'after-init'); // dynamic getter, not a construction-time copy
  bounded.setProtocolVersion?.('2025-11-25');
  assert.deepEqual(raw.protocolVersions, ['2025-11-25']);

  const options = {
    relatedRequestId: 'request-1',
    resumptionToken: 'token-1',
    onresumptiontoken: () => undefined,
  };
  await bounded.send(smallResponse, options);
  assert.strictEqual(raw.sendOptions[0], options);
  const message = smallRequest;
  const extra = { authInfo: { token: 'opaque' } };
  let forwarded: unknown[] | undefined;
  bounded.onmessage = (...args) => { forwarded = args; };
  raw.emitMessage(message, extra);
  assert.deepEqual(forwarded, [message, extra]);

  const routine = new Error('ordinary HTTP request error');
  const observedErrors: unknown[] = [];
  bounded.onerror = (error) => { observedErrors.push(error); };
  raw.emitError(routine);
  assert.deepEqual(observedErrors, [routine]);
  assert.deepEqual(prior.errors, [routine]);
  assert.equal(terminal.calls, 0); // raw onerror is not universally connection-fatal

  let closes = 0;
  bounded.onclose = () => { closes += 1; };
  raw.emitClose();
  await terminal.settled;
  await bounded.close();
  assert.equal(closes, 1);
  assert.equal(prior.closes, 1);
  assert.equal(raw.closeCalls, 0); // spontaneous raw close satisfied the shared close latch
  assertRawTransportCallbackBaseline(raw);
});
```

- [ ] **Step 2: Confirm both helpers are missing (2 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="content JSON and structuredContent|stable envelope|core interface results|generic guarded return|official result parser|response boundary|message policy|bounded transport|unsafe framing|raw resource URI admission|byte-bounded runner|raw send rejection|complete SDK 1.30 transport surface"
```

Expected: FAIL with unresolved `toolSuccess` and `toolFailure` imports.

- [ ] **Step 3: Implement a single canonical object before serializing it (4 minutes).**

```ts
export type McpToolMeta = JsonObject;
export type McpToolEnvelope<T = JsonValue> =
  | (Record<string, unknown> & { ok: true; data: T; meta?: McpToolMeta })
  | (Record<string, unknown> & { ok: false; error: StyleToolError; meta?: McpToolMeta });
export type McpTextToolResult<T = JsonValue> = Omit<CallToolResult, 'content' | 'structuredContent'> & {
  content: [{ type: 'text'; text: string }];
  structuredContent: McpToolEnvelope<T>;
};

const toMcpResult = <T>(envelope: McpToolEnvelope<T>, isError = false): McpTextToolResult<T> => {
  const structuredContent = mcpToolEnvelopeSchema.parse(envelope) as McpToolEnvelope<T>;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
};

export const toolFailure = (error: StyleToolError): McpTextToolResult<never> =>
  toMcpResult<never>({ ok: false, error }, true);
```

Resolve one immutable policy at composition time:

```ts
export interface McpMessagePolicy {
  readonly maxMessageBytes: number;
  readonly applicationResultBytes: number;
}

export const resolveMcpMessagePolicy = (
  options: { maxMessageBytes?: number },
): McpMessagePolicy => {
  const maxMessageBytes = options.maxMessageBytes ?? MAX_MCP_MESSAGE_BYTES;
  assertSafeMessageLimit(maxMessageBytes);
  return Object.freeze({
    maxMessageBytes,
    applicationResultBytes: maxMessageBytes - MCP_RESPONSE_ENVELOPE_RESERVE_BYTES,
  });
};
```

Define the exported extension contract without exposing registry mutation after composition:

```ts
export interface ResourceUriAdmission {
  readonly scheme: string;
  readonly authority: string;
  assertCanonical(rawUri: string): void;
}
```

The Node-internal registry validates an exact lowercase RFC 3986 scheme plus a lowercase raw authority token, permits one admission per `{scheme, authority}` namespace, and has explicit `registering → frozen` state. It parses only the original `scheme://authority/` prefix with ASCII delimiters—never `new URL`—and rejects credentials, ports, escapes, or malformed authority spelling. Multiple extensions may share a scheme under disjoint authorities: the built-in document admission owns `{maplibre-style, sessions}` while the live bridge owns `{maplibre-style, maps}`. `register()` after `freeze()` and a duplicate/ambiguous namespace throw fixed provenance-authentic `INVALID_INPUT` errors. The frozen view dispatches exactly one matching admission and is the same identity captured by the final transport. Unknown scheme/authority follows one explicit policy: reject with `INVALID_INPUT/details.reason:'unregisteredResourceNamespace'` rather than allowing SDK URL normalization or a fallback resolver. No admission may perform I/O or mutate application/session state.

Accept only finite safe integers from `MIN_MCP_MESSAGE_BYTES` through `MAX_CONFIGURABLE_MCP_MESSAGE_BYTES`; reject anything else with a provenance-authentic `INVALID_INPUT/details.reason:'invalidMessageLimit'`. The fixed 64 KiB reserve covers the worst-case JSON escaping of the bounded request ID/resource URI plus JSON-RPC fields, but it is not the final authority. `createMcpResponseBoundary(policy)` measures the **actual** UTF-8 bytes of `JSON.stringify(candidate)` with `Buffer.byteLength`, including both `content[0].text` and `structuredContent` for a tool result. `requireToolSuccess(data, meta?)` constructs the canonical `McpTextToolResult` once, returns that same object when it fits `applicationResultBytes`, and otherwise throws a fresh provenance-authentic `INVALID_INPUT/details:{reason:'responseTooLarge'}` containing no candidate, Style, diff, URI, byte sample, or cause. `requireToolFailure(error)` constructs/measures the authentic stable failure once; if an otherwise-authentic core error has an enormous message/path/details, replace it with the fixed data-free `responseTooLarge` failure instead of leaking it to the final transport gate. `requireResourceResult(result)` performs the success measurement for the complete resource-handler result. `requireResourceFailure(error)` performs the same redaction/measurement and returns a small SDK `McpError(ErrorCode.InvalidParams, ...)` whose data carries only the sanitized core code/path/details; resource registration throws that value because resources have no tool envelope. Precompute and assert at boundary construction that both fixed replacement forms plus the reserve fit the resolved minimum. Never truncate data or reconstruct/re-run a rejected application result.

Handlers/resolvers use these `require*` methods **inside** the same queued read/projection/pre-commit callback that owns TTL/commit, as detailed in Tasks 5–8. Inline/no-session operations can call the boundary immediately before returning. The thrown authentic error then crosses the ordinary guard; tool calls become the small stable failure envelope, while resource registration maps the same sanitized error to one bounded SDK JSON-RPC error. A response-budget rejection must not rerun domain work, refresh idle TTL, commit a revision/history entry, or contain the rejected value.

Build one frozen `InboundMcpFramingContext` from the admission table plus `totalBytesAlreadyBounded:boolean`. Stdio/HTTP set it true only after their byte readers have accepted the exact original payload; public/in-memory connections use false. `assertInboundMcpFraming(value, policy, context?)` operates on the already parsed JSON value without transforming or reserializing the whole message. It bounds `Buffer.byteLength(JSON.stringify(id), 'utf8')` to `MAX_MCP_REQUEST_ID_BYTES`, method names to `MAX_MCP_METHOD_BYTES`, and any `resources/read` URI string to `MAX_MCP_RESOURCE_URI_BYTES`; validate batch members independently. It must **not** use `JSON.stringify(value)` as a second raw-byte authority: legal compact JSON such as exponent-form numbers can expand substantially after parse. Instead, the bounded transport performs a whole-message canonical byte check only when `context.totalBytesAlreadyBounded === false` (the public/in-memory defense); a true context trusts the already-completed raw reader for total bytes while still enforcing all field/admission checks.

For each raw `resources/read.params.uri`, before any `new URL`, split only its original ASCII `/` delimiters and reject every literal or case-insensitive percent-encoded segment whose one strict percent decode is exactly `.` or `..`; marked semantic IDs `~.` and `~..` are not dot segments and remain legal. Then invoke the frozen namespace admission on the same original string, so normalization-changing, legacy unmarked, wrong-case escape, and re-encoding aliases cannot reach SDK URL construction. When no context is supplied, this helper performs only generic field checks; every composed server transport supplies a frozen context, and public/in-memory transport construction uses canonical total-byte mode.

An unsafe total/ID/URI/method fails before SDK dispatch or transport/session allocation. Stdio terminates without echoing an unsafe/unbounded ID. A canonical-admission failure with a safe request ID is correlatable: the bounded transport sends one fixed small `-32602` response carrying only `INVALID_INPUT/details.reason:'nonCanonicalResourceUri'` or `'unregisteredResourceNamespace'`, skips the protocol handler/resolver/store, and keeps the connection usable; an admission failure in a notification/no-safe-ID request is terminal. HTTP performs the same assertion on the parsed raw string before `handleRequest`, returns a bounded 400 for admission failure, and leaves a known pair usable. Raw stdio/HTTP byte readers enforce the resolved total exactly once before parsing so they never allocate a too-large string; the parsed assertion remains the shared field/admission authority.

Define the transport type only as `Parameters<McpServer['connect']>[0]`, using the approved `server/mcp.js` import rather than adding an undocumented SDK subpath. `createBoundedMcpTransport(raw, policy, inboundContext, onTerminal)` implements the complete inferred SDK 1.30 surface: once-delegated `start`/`close`, a dynamic `sessionId` getter, optional `setProtocolVersion` passthrough, assignable `onmessage`/`onerror`/`onclose`, and `send(message, options?)` preserving the exact options reference including `relatedRequestId`, `resumptionToken`, and `onresumptiontoken`. It descriptor-safely captures any preinstalled raw callbacks, chains the prior `onerror`/`onclose` hooks exactly once before its public callbacks, and restores the originals on close; this lets stdio install a transport-fatal baseline hook while HTTP leaves routine request errors nonterminal. Its installed raw `onmessage` first applies the conditional total-byte rule above and calls `assertInboundMcpFraming(message, policy, inboundContext)` on the original parsed request, then forwards the same message and `extra` references to the SDK protocol handler. It handles a safe-ID resource-admission rejection with the single bounded error described above; uncorrelatable unsafe inbound data enters `onTerminal` with no handler call. Raw `onerror` is forwarded exactly once but is not inherently terminal by the generic decorator, because SDK Streamable HTTP uses it for routine per-request 400/406/409/415 and invalid-JSON-RPC errors; only a captured transport-specific hook may request terminal cleanup. Raw `onclose` forwards exactly once and enters the terminal latch. It first marks the shared raw-close latch satisfied, so re-entrant/default cleanup calling decorator `close()` does not delegate a second raw close. Closing the decorator before a spontaneous close delegates raw close once. Every path restores the prior raw callbacks/listener baseline.

Its `send(message, options?)` computes `Buffer.byteLength(JSON.stringify(message), 'utf8')` on the complete JSON-RPC message. At or below the resolved limit it calls `raw.send` exactly once with the original object/options. For an unexpected oversized response carrying an already-bounded ID, it bypasses itself and sends exactly one fixed small JSON-RPC `-32603` error with the same ID and sanitized `data:{code:'INVALID_INPUT',details:{reason:'responseTooLarge'}}`; assert that fallback's final serialized bytes fit before the raw send. Do not invoke a handler/projector again and do not recursively re-enter the decorator. If either the ordinary raw send or that one fallback raw send rejects, preserve the exact rejection, enter and await the same terminal latch, and never attempt a second/fallback send; SDK 1.30 protocol error forwarding alone does not close the connection. An oversized notification/request, unsafe/unbounded ID, serialization failure, or fallback that somehow cannot fit likewise calls `onTerminal` and rejects without any partial raw send. The terminal gate accepts `void | Promise<void>`, invokes it at most once, awaits/observes any rejection, and never creates an unhandled rejection even when default server cleanup fails; late/repeated terminal signals share the settled terminal promise.

This decorator is the defense-in-depth final authority for SDK-generated errors/notifications as well as application responses. Stdio connects `McpServer` to the decorator around its raw `StdioServerTransport`; Streamable HTTP calls `raw.handleRequest(...)` for wire parsing but connects each `McpServer` to a decorator around that exact raw transport. Both paths therefore use the same serializer/limit/fallback, and each lifecycle owns/closes one raw/decorated pair exactly once. SSE or LF framing bytes are transport framing outside the measured JSON-RPC message; tests inspect the exact `JSON.stringify(message)` bytes before those encodings, as required by the protocol-message contract.

Build exported `styleToolErrorWireSchema` from the exported core error-code tuple, the stable serializable `StyleToolError` fields, and descriptor-sanitized `jsonValueSchema`; `parseStyleToolErrorShape` uses it only to parse already-sanitized wire envelopes. Do not define, shadow, or re-export an MCP `isStyleToolError`. Handler authenticity comes only from the core provenance guard backed by core-created error identity, while wire-shape parsing answers only whether received JSON has the documented shape. Build `createMcpToolEnvelopeSchema(dataSchema)` as a strict `ok:true` success object using the supplied data schema unioned with the same strict `ok:false` wire error object. The general `mcpToolEnvelopeSchema` is the factory instantiated with `jsonValueSchema`; make `parseMcpToolEnvelope` the sole narrowing boundary for SDK results whose `structuredContent` is optional and typed only as a generic record.

SDK 1.30 `Client.callTool()` returns `CallToolResult | CompatibilityCallToolResult`; the compatibility branch exposes `content` only as `unknown`, while `CallToolResultSchema` is loose and defaults missing content, so schema parsing alone does not exclude a wrapper that also carries otherwise-valid result fields. `parseOfficialCallToolResult(value)` first performs a descriptor-safe object/own-key check: use `Object.getOwnPropertyDescriptor` without reading the property, and reject any own `toolResult` data or accessor descriptor as a compatibility wrapper. If descriptor inspection itself throws, reject with a fixed redacted parse error. Only then call the official `CallToolResultSchema.parse(value)` from the exact `types.js` subpath. Tests include a wrapper with fully valid `content`/`structuredContent`/`isError` and a hostile throwing `toolResult` getter whose getter count remains zero. All official-client tests and consumer helpers must call this helper immediately on the awaited outer union before accessing `content`, `structuredContent`, or `isError`; then independently narrow a content block by `type === 'text'`. Do not cast or merely check `'content' in value`.

Do not constrain `T` to `JsonValue`: TypeScript interfaces such as `StyleValidationResult` and `GeoJsonAnalysisResult` are valid JSON at runtime but do not declare a string index signature. Instead, validate/sanitize the complete envelope exactly once in `toMcpResult`; the explicit `Record<string, unknown>` intersection satisfies the SDK without weakening command-specific `T` for callers. `toolFailure` must parse its already-authentic argument through `styleToolErrorWireSchema`, explicitly call `toMcpResult<never>`, and declare `McpTextToolResult<never>`. The failure branch contains no success data, so `never` is accurate and remains assignable from a generic guard catch path; leaving the type argument inferred produces `McpTextToolResult<unknown>` and fails strict TS 5.9. Never independently construct JSON content and structured data; serialize the same sanitized `structuredContent` reference.

- [ ] **Step 4: Run output tests and static checks (3 minutes).**

```bash
rtk pnpm run typecheck
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="content JSON and structuredContent|stable envelope|core interface results|generic guarded return|official result parser|response boundary|message policy|bounded transport|unsafe framing|raw resource URI admission|byte-bounded runner|raw send rejection|complete SDK 1.30 transport surface"
```

Expected: PASS; failure and success envelopes have a predictable JSON schema, application candidates reserve enough outer framing space, and the transparent final transport never writes a serialized JSON-RPC message above the resolved limit.

- [ ] **Step 5: Commit output boundary (2 minutes).**

```bash
rtk git add src/mcp/types.ts src/mcp/output.ts src/mcp/output.test.ts src/mcp/message-boundary.ts src/mcp/message-boundary.test.ts src/mcp/main.ts
rtk git commit -m "feat: add bounded MCP output envelopes"
```

### Task 5: Build bounded StyleSessionStore with fake time and revisions

**Files:**
- Create: `src/mcp/session-store.ts`
- Create: `src/mcp/session-store.test.ts`
- Modify: `src/mcp/types.ts`
- Modify: `src/mcp/main.ts`

**Interfaces:**
- Consumes: `StyleDocument`, core `DEFAULT_MAX_STYLE_BYTES`, `DEFAULT_MAX_DIFF_BYTES`, `DEFAULT_MAX_OPERATIONS`, `validateStyleDocument(style, {maxStyleBytes})`, and a `Clock` with `now(): number`.
- Produces: exported immutable `DEFAULT_STYLE_SESSION_LIMITS`, a factory-created nominal `StyleSessionStore` with readonly resolved `limits`, `createStyleSessionStore(options?: StyleSessionStoreOptions)`, `open(style)`, `close(sessionId)`, `read(sessionId)`, `readRevision(sessionId, revision)`, `apply(sessionId, request)`, `export(sessionId, revision?)`, `OpenStyleSessionResult`, `CloseStyleSessionResult`, `ExportStyleSessionResult`, `RevisionSnapshot`, and `SessionSnapshot` with `revision`, retained-history metadata, `lastAccessedAt`, and expiry fields. It also produces Node-internal `assertFactoryStyleSessionStore(store)`, current `projectStyleSession(store, sessionId, projector)`, and exact current/retained `projectStyleSessionRevision(store, sessionId, revision, projector)` for capability-checked, synchronous, immutable, queue-atomic adapter projections plus an internal read-only observer seam; none is re-exported from `./mcp`. `open` resolves `{sessionId, revision: 0, expiresAt}`, `close` resolves `{sessionId, closed: true}`, and export resolves `{sessionId, revision, style}` so no tool success ever contains `undefined`. Errors use existing core codes such as `NOT_FOUND`, `CONFLICT`, `INVALID_INPUT`, and `REVISION_CONFLICT`, with the specific limit or expiration reason in `details`.

- [ ] **Step 1: Write failing default-bound and fake-clock tests (5 minutes).**

```ts
const createFakeClock = () => {
  const clock = { value: 0, now: () => clock.value };
  return clock;
};
test('store rejects session 33 with default bounds', async () => {
  const clock = createFakeClock();
  const store = createStyleSessionStore({ clock, idFactory: sequenceIds });
  await Promise.all(Array.from({ length: 32 }, () => store.open(validStyle)));
  await assert.rejects(() => store.open(validStyle), { code: 'CONFLICT', details: { reason: 'maxSessions' } });
});

test('store expires sessions after the default 30 minutes', async () => {
  const clock = createFakeClock();
  const store = createStyleSessionStore({ clock });
  const { sessionId } = await store.open(validStyle);
  clock.value = 30 * 60_000 + 1;
  await assert.rejects(() => store.read(sessionId), { code: 'NOT_FOUND', details: { reason: 'expired' } });
});

test('successful access refreshes idle TTL but failed access does not', async () => {
  const clock = createFakeClock();
  const store = createStyleSessionStore({ clock });
  const { sessionId } = await store.open(validStyle);
  clock.value = 29 * 60_000;
  await store.read(sessionId);
  clock.value += 29 * 60_000;
  await store.export(sessionId);
  clock.value += 29 * 60_000;
  await store.apply(sessionId, { expectedRevision: 0, dryRun: true, transaction: changeRoads });
  clock.value += 29 * 60_000;
  await store.read(sessionId); // still alive only because each successful operation refreshed it

  clock.value = 0;
  const failedStore = createStyleSessionStore({ clock });
  const failed = await failedStore.open(validStyle);
  clock.value = 29 * 60_000;
  await assert.rejects(() => failedStore.apply(failed.sessionId, { expectedRevision: 99, transaction: changeRoads }), { code: 'REVISION_CONFLICT' });
  clock.value = 30 * 60_000 + 1;
  await assert.rejects(() => failedStore.read(failed.sessionId), { code: 'NOT_FOUND', details: { reason: 'expired' } });
});

test('open sweeps every expired session before enforcing maxSessions', async () => {
  const clock = createFakeClock();
  const store = createStyleSessionStore({ clock, idFactory: sequenceIds });
  await Promise.all(Array.from({ length: 32 }, () => store.open(validStyle)));
  clock.value = 30 * 60_000 + 1;
  const opened = await store.open(validStyle);
  assert.equal(opened.revision, 0);
  assert.equal(store.size, 1);
});

test('open rejects invalid or oversized Styles without consuming a slot', async () => {
  const clock = createFakeClock();
  const store = createStyleSessionStore({ clock, limits: { maxStyleBytes: 128 } });
  await assert.rejects(() => store.open(invalidStyle), { code: 'STYLE_INVALID' });
  await assert.rejects(() => store.open(oversizedStyle), { code: 'INVALID_INPUT', details: { reason: 'maxStyleBytes' } });
  assert.equal(store.size, 0);
});

test('open validates generated session IDs before reserving or replacing a slot', async () => {
  for (const invalidId of ['', 'x'.repeat(MAX_STYLE_SESSION_ID_BYTES + 1), '\uD800']) {
    const store = createStyleSessionStore({ idFactory: () => invalidId });
    await assert.rejects(
      () => store.open(validStyle),
      { code: 'INVALID_INPUT', details: { reason: 'invalidSessionId' } },
    );
    assert.equal(store.size, 0);
  }

  const store = createStyleSessionStore({ idFactory: () => 'same-id' });
  const first = await store.open(validStyle);
  await assert.rejects(
    () => store.open(differentValidStyle),
    { code: 'CONFLICT', details: { reason: 'sessionIdCollision' } },
  );
  assert.equal(store.size, 1);
  const original = await store.export(first.sessionId);
  assert.deepEqual(original.style, validStyle);
  assert.equal(original.revision, 0);

  const clock = createFakeClock();
  const ttlStore = createStyleSessionStore({
    clock, limits: { ttlMs: 100 }, idFactory: () => 'ttl-id',
  });
  await ttlStore.open(validStyle);
  clock.value = 99;
  await assert.rejects(() => ttlStore.open(differentValidStyle), { code: 'CONFLICT' });
  clock.value = 101;
  await assert.rejects(() => ttlStore.read('ttl-id'), { code: 'NOT_FOUND', details: { reason: 'expired' } });
});

test('expired ID reuse cannot be deleted by an older queued session job', async () => {
  const clock = createFakeClock();
  const store = createStyleSessionStore({
    clock, limits: { ttlMs: 100 }, idFactory: () => 'reused-id',
  });
  await store.open(validStyle); // generation A
  const oldClose = store.close('reused-id'); // synchronously captures/marks A, job is queued
  clock.value = 101;
  const replacementPromise = store.open(differentValidStyle); // same-turn sweep A, insert B
  const [replacement] = await Promise.all([
    replacementPromise,
    oldClose.catch(() => undefined),
  ]);
  assert.equal(replacement.sessionId, 'reused-id');
  const current = await store.export('reused-id');
  assert.deepEqual(current.style, differentValidStyle);
  assert.equal(current.revision, 0);
  assert.equal(store.size, 1);
});

test('open delegates its resolved Style limit to core validation exactly once', async () => {
  const calls: unknown[][] = [];
  const store = createStyleSessionStoreWithDependencies(
    { limits: { maxStyleBytes: 777 } }, spyCoreDependencies(calls),
  );
  await store.open(validStyle);
  assert.deepEqual(calls, [[validStyle, { maxStyleBytes: 777 }]]);
});

test('store rejects every invalid resolved numeric limit before allocation', () => {
  for (const [name, value] of invalidResolvedLimits()) {
    assert.throws(
      () => createStyleSessionStore({ limits: { [name]: value } }),
      { code: 'INVALID_INPUT', details: { reason: 'invalidLimit', limit: name } },
    );
  }
});

test('atomic session projection refreshes idle TTL only after projector success', async () => {
  const failedClock = createFakeClock();
  const failedStore = createStyleSessionStore({ clock: failedClock, limits: { ttlMs: 100 } });
  const failed = await failedStore.open(validStyle);
  failedClock.value = 99;
  await assert.rejects(
    () => projectStyleSession(failedStore, failed.sessionId, () => {
      throw createStyleToolError('NOT_FOUND', 'Layer was not found.', '/layers/missing');
    }),
    { code: 'NOT_FOUND' },
  );
  failedClock.value = 101;
  await assert.rejects(() => failedStore.read(failed.sessionId), { code: 'NOT_FOUND', details: { reason: 'expired' } });

  const successClock = createFakeClock();
  const successStore = createStyleSessionStore({ clock: successClock, limits: { ttlMs: 100 } });
  const succeeded = await successStore.open(validStyle);
  successClock.value = 99;
  assert.equal(await projectStyleSession(successStore, succeeded.sessionId, (snapshot) => snapshot.revision), 0);
  successClock.value = 101;
  assert.equal((await successStore.read(succeeded.sessionId)).revision, 0);
});

const assertFrozenSnapshotTypes = (snapshot: FrozenSessionSnapshot): void => {
  // @ts-expect-error the public view of the frozen Style forbids nested mutation
  snapshot.style.view.layers.length = 0;
};
void assertFrozenSnapshotTypes;

test('session projection is internal, synchronous, and cannot mutate stored state', async () => {
  const store = createStyleSessionStore();
  const opened = await store.open(validStyle);
  await assert.rejects(
    () => projectStyleSession(store, opened.sessionId, async () => 'not allowed'),
    { code: 'INTERNAL', details: { reason: 'asyncSessionProjection' } },
  );
  await projectStyleSession(store, opened.sessionId, (snapshot) => snapshot.style.withStyle((style) => {
    assert.throws(() => {
      (style.layers as unknown as { length: number }).length = 0;
    }, TypeError);
    return snapshot.revision;
  }));
  assert.equal((await store.read(opened.sessionId)).style.layers.length, validStyle.layers.length);
  assert.equal('projectStyleSession' in publicMcpModule, false);
});

test('factory-created store retains its nominal capability when observed', async () => {
  const events: string[] = [];
  const store = createStyleSessionStoreWithDependencies(
    { idFactory: () => 'observed-session' },
    undefined,
    { observer: { onProjectionAttempt: () => events.push('project') } },
  );
  assert.strictEqual(assertFactoryStyleSessionStore(store), store);
  const opened = await store.open(validStyle);
  assert.equal(await projectStyleSession(store, opened.sessionId, (snapshot) => snapshot.revision), 0);
  assert.deepEqual(events, ['project']);
});

test('failed current and retained revision projections do not refresh idle TTL', async () => {
  for (const revision of [undefined, 0] as const) {
    const clock = createFakeClock();
    const store = createStyleSessionStore({ clock, limits: { ttlMs: 100 }, idFactory: () => 'budget-session' });
    const opened = await store.open(validLargeStyleUnderCoreLimit);
    await store.apply(opened.sessionId, { expectedRevision: 0, transaction: smallChange });
    const boundary = createMcpResponseBoundary(resolveMcpMessagePolicy({ maxMessageBytes: MIN_MCP_MESSAGE_BYTES }));
    clock.value = 99;
    await assert.rejects(
      () => projectStyleSessionRevision(store, opened.sessionId, revision, (snapshot) =>
        boundary.requireToolSuccess({ sessionId: opened.sessionId, revision: snapshot.revision, style: snapshot.style.view })),
      { code: 'INVALID_INPUT', details: { reason: 'responseTooLarge' } },
    );
    clock.value = 101;
    await assert.rejects(() => store.read(opened.sessionId), { code: 'NOT_FOUND', details: { reason: 'expired' } });
  }
});
```

- [ ] **Step 2: Run the store tests and verify the constructor does not exist (2 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="session 33|30 minutes|atomic session projection|session projection is internal|nominal capability|current and retained revision projections"
```

Expected: FAIL with missing `createStyleSessionStore`.

- [ ] **Step 3: Implement session ownership and fixed defaults (5 minutes).**

```ts
export const DEFAULT_STYLE_SESSION_LIMITS = Object.freeze({
  maxSessions: 32,
  maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
  maxOperations: DEFAULT_MAX_OPERATIONS,
  maxHistory: 20,
  maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
  ttlMs: 30 * 60_000,
});

export const createStyleSessionStore = (options: StyleSessionStoreOptions = {}): StyleSessionStore => {
  const clock = options.clock ?? { now: Date.now };
  const limits = Object.freeze({ ...DEFAULT_STYLE_SESSION_LIMITS, ...options.limits });
  assertValidResolvedSessionLimits(limits);
  const sessions = new Map<string, InternalSession>();
  const store = { limits, open, close, read, readRevision, apply, export: exportStyle, dispose };
  return registerFactoryStyleSessionStore(store, internalProjector);
};
```

Define `StyleSessionStore` beside the factory in `session-store.ts` with a non-exported runtime `unique symbol` member, and install that immutable brand only inside `createStyleSessionStoreWithDependencies`; a plain structural object can neither type-check as the interface nor acquire the runtime capability. Register the exact returned identity in a module-private `WeakMap<StyleSessionStore, InternalStoreCapability>` holding current/revision projectors (and Task 6's pre-commit apply finalizer). `assertFactoryStyleSessionStore(value)` requires both the private symbol value and the matching WeakMap entry, returns that same identity on success, and otherwise throws a provenance-authentic `INVALID_INPUT/details.reason:'invalidStyleSessionStore'`. Export the interface type through `main.ts`, but export the assertion and projectors only from their Node-internal module for trusted sibling MCP composition; do not re-export those functions from `main.ts`, expose the brand symbol, or fall back to `store.read` when capability lookup fails.

Define a Node-internal read facade rather than weakening the immutable type merely to satisfy existing core reader signatures:

```ts
type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export interface FrozenStyleFacade {
  readonly view: DeepReadonly<StyleDocument>;
  withStyle<T>(reader: (style: StyleDocument) => T): T;
}
export interface FrozenSessionSnapshot
  extends Omit<DeepReadonly<SessionSnapshot>, 'style'> {
  readonly style: FrozenStyleFacade;
}
export interface FrozenRevisionSnapshot
  extends Omit<DeepReadonly<RevisionSnapshot>, 'style'> {
  readonly style: FrozenStyleFacade;
}

export const assertFactoryStyleSessionStore = (value: unknown): StyleSessionStore =>
  requireFactoryStoreCapability(value).store;
export const projectStyleSession = <T>(
  store: StyleSessionStore,
  sessionId: string,
  projector: (snapshot: FrozenSessionSnapshot) => T,
): Promise<T> => requireInternalProjector(store)(sessionId, projector);
export const projectStyleSessionRevision = <T>(
  store: StyleSessionStore,
  sessionId: string,
  revision: number | undefined,
  projector: (snapshot: FrozenRevisionSnapshot) => T,
): Promise<T> => requireInternalRevisionProjector(store)(sessionId, revision, projector);
```

The internal projector enters the same per-session queue as `read`/`export`/`apply`, checks closing/expiry at execution time, and constructs `FrozenSessionSnapshot` from a deep clone—never the mutable `InternalSession`. Recursively freeze the clone at runtime. `style.view` exposes the accurate deep-readonly type, while `style.withStyle(reader)` passes that **same frozen clone** to a synchronous trusted pure reader with the ordinary `StyleDocument` parameter expected by `buildStyleContext`, `searchLayers`, `listSourceLayers`, and `analyzeGeoJson`; this is the only controlled type bridge, so callers need no unsafe casts and mutation still throws at runtime. Reject a Promise/thenable returned by either `withStyle` or the outer projector as provenance-authentic `INTERNAL/details.reason:'asyncSessionProjection'`; adapter projections must not hold the queue across I/O or re-enter it. Use a compile-only, never-invoked `@ts-expect-error` assertion for nested mutation and a separate runtime cast solely to prove recursive freezing—never leave an ordinary illegal assignment in a green test.

`projectStyleSessionRevision` runs on the same queue and selects the current revision when the argument is `undefined` or an exact current/retained revision value otherwise; it never treats the value as an array index. It exposes the selected frozen Style and incoming-diff metadata through `FrozenRevisionSnapshot`, allowing export and diff resource construction/budgeting to finish before access time changes. Missing/evicted revisions fail before the projector. Do not implement it by first calling public `readRevision`, because that would touch TTL before a later response-budget failure.

Deep-clone/sanitize the projector output before committing access time. Only after the projector and output clone both succeed does the queued job set `lastAccessedAt`/`expiresAt` and return the clone. A known or unknown projector throw—including `responseTooLarge` from a tool/resource result built inside it—missing subresource, invalid projection, async result, or output-clone failure propagates without touching idle time. `createStyleSessionStoreWithDependencies(options, coreDependencies?, {observer?, queueScheduler?})` may inject a read-only test observer with separate `onProjectionAttempt` and `onRevisionReadAttempt` notifications containing only operation-kind/ID metadata; it must return the same branded store object and may not proxy, wrap, replace, mutate, or receive an `InternalSession`. The optional Node-internal test scheduler is a separate `beforeQueuedWork({sessionId, kind}): Promise<void>` gate used only to deterministically pause **before** synchronous queued work begins; production always uses an immediately resolved scheduler, public options/barrels cannot inject it, and core/projector/finalizer callbacks remain synchronous/thenable-rejecting once admitted. These hooks return the same store identity and see no Style/session object. Observer notifications fire before capability-backed projection/revision lookup but never on `open`, so integration sentinels can prove malformed resource aliases were rejected before store access. This observer is the only allowed store-access sentinel for integration tests, so instrumentation cannot lose the WeakMap capability.

Define `DEFAULT_STYLE_SESSION_LIMITS` with `maxStyleBytes: DEFAULT_MAX_STYLE_BYTES`, `maxOperations: DEFAULT_MAX_OPERATIONS`, and `maxDiffBytes: DEFAULT_MAX_DIFF_BYTES`; only session count/history/TTL are MCP-owned literals. Tests assert both value equality and direct identity of the imported core constants, preventing duplicated defaults.

Before allocating any map/queue/session, validate all six resolved numeric limits—`maxSessions`, `maxStyleBytes`, `maxOperations`, `maxHistory`, `maxDiffBytes`, and `ttlMs`—as finite positive safe integers. Reject zero, negatives, fractions, `NaN`, infinities, and values above `Number.MAX_SAFE_INTEGER` with a provenance-authentic core `INVALID_INPUT/details:{reason:'invalidLimit',limit}`. Never let invalid `maxSessions` disable the count guard, invalid TTL create immortal entries, or invalid `maxHistory` enter a non-terminating prune loop.

Define revision storage precisely. `RevisionSnapshot` is an immutable deep-cloned state `{revision, style, incomingDiff, committedAt}` where revision 0 is the opened baseline with an empty incoming diff, and every revision `N > 0` is the post-transaction style whose `incomingDiff` transforms `N-1 → N`. Keep the current snapshot separately plus at most `limits.maxHistory` prior snapshots in ascending FIFO order. Public `SessionSnapshot.history` exposes bounded metadata (`revision`, `committedAt`) rather than mutable stored styles. `export(sessionId, revision)` looks up the exact numeric revision value, never an array index; omitted revision means current. Revision 0 is exportable while current or retained, and diff lookup for revision 0 is invalid because it has no predecessor.

Before allocating an ID or slot, call `validateStyleDocument(style, { maxStyleBytes: limits.maxStyleBytes })` exactly once and use only its sanitized success `style` as the stored clone. Do not separately sanitize, stringify, count bytes, or validate the document in MCP. Throw the core failure's canonical first error unchanged, including its code/path/details. This lets an operator's explicit lower or higher store limit flow through the trusted core option consistently instead of silently reapplying the core default. Use an internal `createStyleSessionStoreWithDependencies(options, coreDependencies?, testHooks?)` module export for validation/transaction spies, read-only access observer, and deterministic pre-work scheduler described above, but expose only `createStyleSessionStore(options)` from `./mcp`; `StyleSessionStoreOptions` itself cannot accept replacement core functions, observers, or schedulers. Every path through both factory functions installs the same private brand and WeakMap capability on the exact returned identity.

After validation and the full expired-session sweep, call `idFactory` exactly once but validate its result **before** reserving a slot, inserting into the map, setting TTL, or replacing any entry. Require a primitive non-empty Unicode scalar-value string (no lone surrogate), at most `MAX_STYLE_SESSION_ID_BYTES` UTF-8 bytes, whose one `encodeURIComponent` call succeeds; this bound guarantees the duplicated fixed open result and every canonical marked resource URI fit `MIN_MCP_MESSAGE_BYTES`/`MAX_MCP_RESOURCE_URI_BYTES`. If invalid, throw `INVALID_INPUT/details.reason:'invalidSessionId'` without a slot or retry. If the exact ID is already active, throw `CONFLICT/details.reason:'sessionIdCollision'` without retrying, overwriting, touching the existing session's style/revision/history/TTL, or consuming another slot. Expired entries were already swept, so their IDs may be reused. Add huge, empty, lone-surrogate, and duplicate-ID tests that retain the original session byte-for-byte and prove collision failure does not refresh its idle expiry.

Before enforcing `maxSessions`, synchronously sweep the complete session map and remove every entry whose idle TTL has expired; otherwise 32 dead sessions could permanently block a new open. Every sweep, execution-time expiry, failed-open rollback, and Task 6 terminal-close deletion is identity-CAS guarded: capture the `InternalSession` generation and call `sessions.delete(id)` only when `sessions.get(id) === capturedSession`. A deterministic `idFactory` may reuse an expired ID immediately, so an old queued read/close/finalizer that settles later must never delete or touch the replacement generation. Do not key destructive cleanup solely by ID or let an old tail retrieve the new map entry. Add a fake-clock/held-tail regression where generation A expires, generation B opens with the same ID in the same turn, then A's old job settles; B's Style/revision/TTL/size must remain intact. Inject `idFactory` and `clock` only through public options. Export the default constant, readonly `store.size`, and resolved readonly `store.limits` through `src/mcp/main.ts`; this is production configuration introspection, not a test-only registry.

TTL is idle time, not absolute age. Evaluate expiry inside the session queue at execution time. Only a successful `read`, `readRevision`, `export`, `apply` (including a successful dry run/no-op), or successful internal projection updates `lastAccessedAt` and the derived `expiresAt`, after its complete result has been computed and cloned. Validation errors, stale revisions, missing retained revisions/subresources, projector failures, candidate/diff limit failures, and all other rejected work must leave `lastAccessedAt` unchanged. Add separate fake-clock assertions for successful read, revision read, export, apply, and projection refreshes and for every representative failure; do not use a succeeding read to infer the timestamp after a failure—advance directly beyond the original expiry and assert expiration. Task 7 inspect and session-source analysis plus Task 8 resource resolution must use the atomic projector wherever success depends on a layer/source/context lookup; a `read` followed by adapter-side lookup/manual touch violates the end-to-end failure contract.

- [ ] **Step 4: Verify defaults, expiry, and no shared mutable document (3 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="session 33|30 minutes|refreshes idle TTL|validates generated session IDs|expired ID reuse|atomic session projection|session projection is internal|nominal capability|current and retained revision projections|sweeps every expired|delegates its resolved Style limit|invalid resolved numeric limit|invalid or oversized|mutable"
rtk pnpm run typecheck
```

Expected: PASS; an expired or closed ID never returns its prior style, invalid/colliding generated IDs allocate nothing and cannot overwrite or refresh an active session, successful access/projection extends idle life, failed current/retained response projection and every other rejected work do not, factory branding survives read-only observation without accepting structural fakes, projector code cannot mutate state or await inside the queue, and expired entries cannot consume the count bound.

- [ ] **Step 5: Commit bounded session base (2 minutes).**

```bash
rtk git add src/mcp/types.ts src/mcp/session-store.ts src/mcp/session-store.test.ts src/mcp/main.ts
rtk git commit -m "feat: add bounded atomic style session projections"
```

### Task 6: Add transaction concurrency, history, dry-run, and queue semantics

**Files:**
- Modify: `src/mcp/session-store.ts`
- Modify: `src/mcp/session-store.test.ts`
- Modify: `src/mcp/types.ts`

**Interfaces:**
- Consumes: every existing per-session store method, `StyleSessionStore.apply(sessionId, { expectedRevision, transaction: unknown, dryRun? })`, and core `applyStyleTransaction(style, transaction, {maxOperations, maxStyleBytes, maxDiffBytes})` as the sole transaction parse/limit authority.
- Produces: one per-session queue shared by `read`, `readRevision`, `export`, `apply`, and terminal `close`; `ApplySessionTransactionResult` with `revision`, `dryRun`, `diff`, `changedLayers`, `changedSources`, and `warnings`; Node-internal capability-backed `applyStyleSessionTransactionResult(store, sessionId, request, finalizer)` that finalizes/budgets a result before commit or idle touch; core failures are rethrown as their exact `StyleToolError` and never committed.

- [ ] **Step 1: Write failing revision and ordering tests (5 minutes).**

```ts
test('dry run returns a diff without changing revision or history', async () => {
  const opened = await store.open(validStyle);
  const preview = await store.apply(opened.sessionId, { expectedRevision: 0, dryRun: true, transaction: changeRoads });
  const after = await store.read(opened.sessionId);
  assert.equal(preview.revision, 0);
  assert.equal(after.revision, 0);
  assert.equal(after.history.length, 0);
});

test('same-session applies serialize while separate sessions may overlap', async () => {
  const order: string[] = [];
  const scheduler = createDeterministicQueueScheduler({ hold: ['a:apply:1'], order });
  const store = createStyleSessionStoreWithDependencies({}, undefined, { queueScheduler: scheduler });
  const { a, b } = await openTwoSessions(store);
  const work = [
    store.apply(a, numberedChange(1)),
    store.apply(a, numberedChange(2)),
    store.apply(b, numberedChange(1)),
  ];
  await scheduler.waitUntilStarted('a:apply:1');
  await scheduler.waitUntilCompleted('b:apply:1');
  scheduler.release('a:apply:1');
  await Promise.all(work);
  assert.ok(order.indexOf('a:apply:1:end') < order.indexOf('a:apply:2:start'));
  assert.ok(order.indexOf('b:apply:1:start') < order.indexOf('a:apply:1:end'));
});

test('read, export, and terminal close share the apply queue', async () => {
  const scheduler = createDeterministicQueueScheduler({ hold: ['a:apply:1'] });
  const store = createStyleSessionStoreWithDependencies({}, undefined, { queueScheduler: scheduler });
  const { sessionId: a } = await store.open(validStyle);
  const apply = store.apply(a, numberedChange(1));
  await scheduler.waitUntilStarted('a:apply:1');
  const read = store.read(a);
  const exported = store.export(a);
  const close = store.close(a);
  await assert.rejects(() => store.read(a), { code: 'NOT_FOUND', details: { reason: 'closing' } });
  scheduler.release('a:apply:1');
  await apply;
  assert.equal((await read).revision, 1);
  assert.equal((await exported).revision, 1);
  await close;
  await assert.rejects(() => store.read(a), { code: 'NOT_FOUND' });
});

test('an oversized candidate Style never commits', async () => {
  const opened = await store.open(validStyle);
  await assert.rejects(
    () => store.apply(opened.sessionId, oversizedMetadataChange),
    { code: 'INVALID_INPUT', details: { reason: 'maxStyleBytes' } },
  );
  const after = await store.read(opened.sessionId);
  assert.equal(after.revision, 0);
  assert.equal(after.history.length, 0);
});

test('store delegates unknown transaction and all resolved limits to core exactly once', async () => {
  const calls: unknown[][] = [];
  const store = createStyleSessionStoreWithDependencies(
    { limits: raisedAndLoweredLimits }, spyCoreDependencies(calls),
  );
  const opened = await store.open(validStyle);
  await store.apply(opened.sessionId, { expectedRevision: 0, transaction: hostileUnknownTransaction });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![1], hostileUnknownTransaction);
  assert.deepEqual(calls[0]![2], {
    maxOperations: store.limits.maxOperations,
    maxStyleBytes: store.limits.maxStyleBytes,
    maxDiffBytes: store.limits.maxDiffBytes,
  });
});

test('a returned core failure is rethrown unchanged and never committed', async () => {
  const error = createStyleToolError('INVALID_INPUT', 'Too many operations.', '/operations', { reason: 'maxOperations' });
  const store = createStyleSessionStoreWithDependencies({}, failingTransactionCore(error));
  const opened = await store.open(validStyle);
  await assert.rejects(() => store.apply(opened.sessionId, {
    expectedRevision: 0, transaction: { deliberately: 'unknown' },
  }), (caught) => caught === error);
  assert.equal((await store.read(opened.sessionId)).revision, 0);
});

test('history uses revision values, incoming diffs, and the resolved FIFO bound', async () => {
  const store = createStyleSessionStore({ limits: { maxHistory: 2 } });
  const opened = await store.open(validStyle);
  assert.equal((await store.export(opened.sessionId, 0)).revision, 0);
  await commitNumberedChanges(store, opened.sessionId, 4);
  assert.deepEqual((await store.read(opened.sessionId)).history.map(({ revision }) => revision), [2, 3]);
  assert.equal((await store.export(opened.sessionId)).revision, 4);
  assert.equal((await store.export(opened.sessionId, 2)).revision, 2);
  await assert.rejects(() => store.export(opened.sessionId, 1), { code: 'NOT_FOUND', details: { reason: 'revisionEvicted' } });
  assertDiffTransforms(await store.readRevision(opened.sessionId, 4), 3, 4);
});

test('raised maxHistory retains the configured number of prior revisions', async () => {
  const store = createStyleSessionStore({ limits: { maxHistory: 3 } });
  const opened = await store.open(validStyle);
  await commitNumberedChanges(store, opened.sessionId, 4);
  assert.deepEqual((await store.read(opened.sessionId)).history.map(({ revision }) => revision), [1, 2, 3]);
});

test('response finalizer failure neither commits nor reruns core work', async () => {
  const calls = { value: 0 };
  const store = createStyleSessionStoreWithDependencies({}, coreReturningLargeApplyResult(calls));
  const opened = await store.open(validStyle);
  const boundary = createMcpResponseBoundary(resolveMcpMessagePolicy({ maxMessageBytes: MIN_MCP_MESSAGE_BYTES }));
  await assert.rejects(
    () => applyStyleSessionTransactionResult(
      store,
      opened.sessionId,
      { expectedRevision: 0, transaction: changeRoads },
      (result) => boundary.requireToolSuccess(result),
    ),
    { code: 'INVALID_INPUT', details: { reason: 'responseTooLarge' } },
  );
  assert.equal(calls.value, 1);
  assert.equal((await store.read(opened.sessionId)).revision, 0);
});

test('response finalizer failure for commit and dry run does not refresh idle TTL', async () => {
  for (const dryRun of [false, true]) {
    const clock = createFakeClock();
    const store = createStyleSessionStoreWithDependencies(
      { clock, limits: { ttlMs: 100 } }, coreReturningLargeApplyResult(),
    );
    const opened = await store.open(validStyle);
    const boundary = createMcpResponseBoundary(resolveMcpMessagePolicy({ maxMessageBytes: MIN_MCP_MESSAGE_BYTES }));
    clock.value = 99;
    await assert.rejects(
      () => applyStyleSessionTransactionResult(
        store,
        opened.sessionId,
        { expectedRevision: 0, dryRun, transaction: changeRoads },
        (result) => boundary.requireToolSuccess(result),
      ),
      { code: 'INVALID_INPUT', details: { reason: 'responseTooLarge' } },
    );
    clock.value = 101;
    await assert.rejects(() => store.read(opened.sessionId), { code: 'NOT_FOUND', details: { reason: 'expired' } });
  }
});
```

- [ ] **Step 2: Run transaction tests and verify they expose missing behavior (2 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="dry run|same-session applies|response finalizer failure"
```

Expected: FAIL because `apply` lacks dry-run state protection, all session methods do not yet share one keyed serial queue, and candidate-size enforcement is absent.

- [ ] **Step 3: Add keyed async serialization around synchronous core work (5 minutes).**

```ts
const enqueue = <T>(session: InternalSession, work: () => Promise<T>): Promise<T> => {
  const next = session.tail.then(work, work);
  session.tail = next.then(() => undefined, () => undefined);
  return next;
};
```

Use this same queue for `read`, `readRevision`, `export`, `apply`, and `close`, not only writes. In tests, invoke Task 5's Node-internal `beforeQueuedWork` scheduler immediately after a job reaches its session-tail head and before state/core work; production's gate resolves immediately. This makes serialization/cross-session overlap observable without making synchronous core/projectors async or exposing a public scheduler. A close request synchronously marks its captured session generation `closing`, is queued behind already accepted work, rejects later work against that generation with stable `NOT_FOUND/details.reason:'closing'`, and deletes only when its terminal job reaches the head **and** `sessions.get(sessionId) === capturedSession`. Every queued callback closes over the captured session object rather than re-looking up by ID; this is the Task 5 identity-CAS rule that prevents an expired/reused ID's old tail from touching or deleting its replacement. Evaluate TTL, exact revision lookup, and clone results inside the queued job so readers can observe only a complete before-or-after revision; different session tails remain independent.

Within the apply job, check session state and `expectedRevision`, then pass the caller's `transaction` value **unchanged and exactly once** to:

```ts
const result = applyStyleTransaction(session.style, request.transaction, {
  maxOperations: limits.maxOperations,
  maxStyleBytes: limits.maxStyleBytes,
  maxDiffBytes: limits.maxDiffBytes,
});
if (!result.ok) throw result.error;
```

Do not run `styleTransactionSchema`, inspect `operations.length`, stringify a candidate/diff, or otherwise pre-read/reimplement any core schema/limit in the store. The core owns hostile-input safety and its default/raised/lowered byte and operation semantics. Expose a narrow internal core-dependency injection seam (not re-exported from `./mcp`) so tests can prove exactly one call, strict reference identity for the unknown transaction, exact resolved options, and unchanged propagation of a returned failure. A core `{ok:false}` is not a no-op: throw the same `result.error` reference before any revision/history/access-time change.

For `ok:true`, clone the core result, but do not commit or touch idle time yet. Extend the factory-only `InternalStoreCapability` with:

```ts
export const applyStyleSessionTransactionResult = <T>(
  store: StyleSessionStore,
  sessionId: string,
  request: ApplyStyleSessionRequest,
  finalizer: (result: ApplySessionTransactionResult) => T,
): Promise<T> => requireFactoryStoreCapability(store).apply(sessionId, request, finalizer);
```

The capability executes core exactly once inside the same session queue, constructs the candidate `ApplySessionTransactionResult`, synchronously calls `finalizer`, rejects a thenable, and deep-clones the finalized value. Only after all of that succeeds may a dry run update idle time or a commit move the prior current snapshot into FIFO history, prune from the oldest end until `history.length <= limits.maxHistory`, create current revision `N+1` with the core diff as its `incomingDiff`, increment exactly once, and update idle time. If the finalizer throws `responseTooLarge` or any other error, both commit and dry-run paths leave revision/history/style/TTL unchanged; core and finalizer each ran once. Public `store.apply` delegates to this capability with an identity/clone finalizer, while the MCP handler supplies `responseBoundary.requireToolSuccess`, so the store never imports transport policy and no adapter parses the transaction.

Never hard-code 20 in pruning. Test lower and raised history bounds, revision-0 retention/eviction, exact revision-value lookup, current-versus-retained export, immutable clones, and that revision N's diff really replays N-1 to N. Core limit failures, response-finalizer failures, and all other failures change neither revision, history, nor idle access time.

- [ ] **Step 4: Run race, limit, and history tests (4 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="dry run|same-session applies|terminal close|oversized candidate|delegates unknown transaction|returned core failure|response finalizer failure|history uses revision values|raised maxHistory|expected revision|100 operations|20 history|1 MiB"
```

Expected: PASS; every operation for one session uses its single tail, separate sessions remain concurrent, the core alone parses/enforces all three limits, failed core or response finalization never commits/touches/retries, terminal close cannot race/revive state, and stale writers receive `REVISION_CONFLICT`.

- [ ] **Step 5: Commit transactional store semantics (2 minutes).**

```bash
rtk git add src/mcp/session-store.ts src/mcp/session-store.test.ts src/mcp/types.ts
rtk git commit -m "feat: serialize preflighted style session transactions"
```

### Task 7: Implement transport-neutral document tool handlers

**Files:**
- Create: `src/mcp/schemas.ts`
- Create: `src/mcp/schemas.test.ts`
- Create: `src/mcp/document-handlers.ts`
- Create: `src/mcp/document-handlers.test.ts`
- Modify: `src/mcp/types.ts`
- Modify: `src/mcp/main.ts`

**Interfaces:**
- Consumes: Zod 4, core `jsonValueSchema`, provenance-based core `isStyleToolError`, `StyleToolError` contracts, `StyleSessionStore`, module-internal atomic current/revision projectors and pre-commit apply finalizer, one resolved `McpResponseBoundary`, `toolFailure`, existing core `validateStyleDocument`, `buildStyleContext`, `searchLayers`, `analyzeGeoJson`, existing `applyStyleTransaction` through store apply, and `listSourceLayers`.
- Produces: exact `DOCUMENT_TOOL_NAMES`; eight exported complete strict root-object Zod input schemas; `documentToolInputSchemas`; eight command-specific response-data schemas; `documentToolResponseDataSchemas`; `parseDocumentToolSuccessData(name, envelope)` for consumer narrowing; and `createDocumentToolHandlers(store, responseBoundary)` returning guarded async methods named `style_session_open`, `style_session_close`, `style_validate`, `style_inspect`, `style_search_layers`, `style_analyze_geojson`, `style_apply_transaction`, and `style_export`.

- [ ] **Step 1: Write failing schema, full tool-name, and guarded-result tests (5 minutes).**

```ts
test('all eight tools own complete strict schemas with cross-field rules intact', () => {
  assert.deepEqual(Object.keys(documentToolInputSchemas).sort(), [...DOCUMENT_TOOL_NAMES].sort());
  for (const schema of Object.values(documentToolInputSchemas)) {
    assert.equal(schema.safeParse({ unexpected: true }).success, false);
  }
  assert.equal(styleValidateInputSchema.safeParse({ target: { kind: 'inline', style: validStyle, sessionId: 's1' } }).success, false);
  assert.equal(styleValidateInputSchema.safeParse({}).success, false);
  assert.equal(styleAnalyzeGeoJsonInputSchema.safeParse({ target: { kind: 'inline', data: points, sessionId: 's1' } }).success, false);
});

test('document handlers expose exactly the required tool set', () => {
  assert.deepEqual(Object.keys(createDocumentToolHandlers(store, defaultResponseBoundary)).sort(), [
    'style_analyze_geojson', 'style_apply_transaction', 'style_export', 'style_inspect',
    'style_search_layers', 'style_session_close', 'style_session_open', 'style_validate',
  ]);
});

test('style_validate returns one stable envelope', async () => {
  const result = await handlers.style_validate({ target: { kind: 'inline', style: validStyle } });
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
});

test('direct parse, known business, and unknown failures keep the stable boundary', async () => {
  const invalid = await handlers.style_validate({ target: { kind: 'inline', style: validStyle, sessionId: 's1' } });
  assert.equal(parseMcpToolEnvelope(invalid.structuredContent).ok, false);
  assert.equal(parseFailure(invalid).error.code, 'INVALID_INPUT');

  const missing = await handlers.style_export({ sessionId: 'missing' });
  assert.equal(parseFailure(missing).error.code, 'NOT_FOUND');

  const redacted = await createDocumentToolHandlers(throwingStore, defaultResponseBoundary).style_export({ sessionId: 's1' });
  assert.equal(parseFailure(redacted).error.code, 'INTERNAL');
  assert.doesNotMatch(redacted.content[0].text, /database-password|stack/i);

  const forged = await createDocumentToolHandlers(forgedErrorStore, defaultResponseBoundary).style_export({ sessionId: 's1' });
  assert.equal(parseFailure(forged).error.code, 'INTERNAL');
  assert.doesNotMatch(forged.content[0].text, /forged-secret/i);
});

test('generic guard failure remains assignable to its success data type', async () => {
  const guardedNumber = guardDocumentTool(
    z.strictObject({ value: z.number() }),
    defaultResponseBoundary,
    async () => defaultResponseBoundary.requireToolSuccess(42),
  );
  const result: McpTextToolResult<number> = await guardedNumber({ value: 'invalid' });
  assert.equal(result.isError, true);
  const success: McpTextToolResult<number> = await guardedNumber({ value: 1 });
  assert.equal(success.structuredContent.ok && success.structuredContent.data, 42);
  assert.equal(success.structuredContent.ok && typeof success.structuredContent.data, 'number');
});

test('apply keeps the transaction opaque until the single core boundary', async () => {
  const malformed = { operations: 'not-an-array', secretAdjacentValue: 7 };
  const recordingStore = createRecordingApplyStore();
  const result = await createDocumentToolHandlers(recordingStore, defaultResponseBoundary).style_apply_transaction({
    sessionId: 's1', expectedRevision: 0, transaction: malformed,
  });
  assert.strictEqual(recordingStore.seenTransaction, malformed);
  assert.equal(recordingStore.applyCalls, 1);
  assert.equal(parseFailure(result).error.code, 'INVALID_INPUT');
});

test('failed inspect layer and source projections do not refresh idle TTL', async () => {
  for (const selection of [
    { view: 'layer' as const, layerId: 'missing-layer' },
    { view: 'source' as const, sourceId: 'missing-source' },
    { view: 'sourceLayers' as const, sourceId: 'missing-source' },
  ]) {
    const clock = createFakeClock();
    const store = createStyleSessionStore({ clock, limits: { ttlMs: 100 }, idFactory: () => 'ttl-session' });
    const opened = await store.open(validStyle);
    const handlers = createDocumentToolHandlers(store, defaultResponseBoundary);
    clock.value = 99;
    const failed = await handlers.style_inspect({ sessionId: opened.sessionId, selection });
    assert.equal(parseFailure(failed).error.code, 'NOT_FOUND');
    clock.value = 101;
    await assert.rejects(() => store.read(opened.sessionId), { code: 'NOT_FOUND', details: { reason: 'expired' } });
  }
});

test('successful inspect projection refreshes idle TTL', async () => {
  const clock = createFakeClock();
  const store = createStyleSessionStore({ clock, limits: { ttlMs: 100 }, idFactory: () => 'ttl-session' });
  const opened = await store.open(validStyle);
  clock.value = 99;
  const result = await createDocumentToolHandlers(store, defaultResponseBoundary).style_inspect({
    sessionId: opened.sessionId, selection: { view: 'context' },
  });
  assert.equal(parseDocumentToolSuccessData('style_inspect', result.structuredContent).view, 'context');
  clock.value = 101;
  assert.equal((await store.read(opened.sessionId)).revision, 0);
});

test('failed session-source analysis does not refresh idle TTL', async () => {
  for (const fixture of [
    { style: validStyle, sourceId: 'missing-source', expectedCode: 'NOT_FOUND' },
    { style: styleWithVectorSource('vector-source'), sourceId: 'vector-source', expectedCode: 'INVALID_INPUT' },
  ] as const) {
    const clock = createFakeClock();
    const store = createStyleSessionStore({ clock, limits: { ttlMs: 100 }, idFactory: () => 'ttl-session' });
    const opened = await store.open(fixture.style);
    clock.value = 99;
    const failed = await createDocumentToolHandlers(store, defaultResponseBoundary).style_analyze_geojson({
      target: { kind: 'sessionSource', sessionId: opened.sessionId, sourceId: fixture.sourceId },
    });
    assert.equal(parseFailure(failed).error.code, fixture.expectedCode);
    clock.value = 101;
    await assert.rejects(() => store.read(opened.sessionId), { code: 'NOT_FOUND', details: { reason: 'expired' } });
  }
});

test('successful session-source analysis refreshes idle TTL', async () => {
  const clock = createFakeClock();
  const store = createStyleSessionStore({ clock, limits: { ttlMs: 100 }, idFactory: () => 'ttl-session' });
  const opened = await store.open(styleWithInlineGeoJsonSource('points', pointFeatureCollection));
  clock.value = 99;
  const analyzed = await createDocumentToolHandlers(store, defaultResponseBoundary).style_analyze_geojson({
    target: { kind: 'sessionSource', sessionId: opened.sessionId, sourceId: 'points' },
  });
  const data = parseDocumentToolSuccessData('style_analyze_geojson', analyzed.structuredContent);
  if (!data.ok) assert.fail('expected successful GeoJSON analysis');
  assert.equal(data.analysis.available, true);
  clock.value = 101;
  assert.equal((await store.read(opened.sessionId)).revision, 0);
});

test('oversized session-backed tool results fail atomically without refreshing idle TTL', async () => {
  for (const scenario of [
    oversizedValidateSession,
    oversizedInspectSource,
    oversizedSearchLayers,
    oversizedAnalyzeSessionSource,
    oversizedExportCurrent,
    oversizedExportRetained,
  ]) {
    const clock = createFakeClock();
    const boundary = createMcpResponseBoundary(resolveMcpMessagePolicy({ maxMessageBytes: MIN_MCP_MESSAGE_BYTES }));
    const { store, sessionId, invoke, dependencyCalls } = await scenario({ clock, boundary });
    clock.value = 99;
    const result = await invoke(createDocumentToolHandlers(store, boundary), sessionId);
    assert.equal(parseFailure(result).error.code, 'INVALID_INPUT');
    assert.equal(parseFailure(result).error.details?.reason, 'responseTooLarge');
    assert.doesNotMatch(result.content[0].text, /private-style-value/);
    assert.equal(dependencyCalls.value, 1);
    clock.value = 101;
    await assert.rejects(() => store.read(sessionId), { code: 'NOT_FOUND', details: { reason: 'expired' } });
  }
});

test('oversized apply result is rejected before commit and core runs once', async () => {
  const coreCalls = { value: 0 };
  const store = createStyleSessionStoreWithDependencies({}, coreReturningLargeApplyResult(coreCalls));
  const opened = await store.open(validStyle);
  const boundary = createMcpResponseBoundary(resolveMcpMessagePolicy({ maxMessageBytes: MIN_MCP_MESSAGE_BYTES }));
  const result = await createDocumentToolHandlers(store, boundary).style_apply_transaction({
    sessionId: opened.sessionId, expectedRevision: 0, transaction: changeRoads,
  });
  assert.equal(parseFailure(result).error.details?.reason, 'responseTooLarge');
  assert.equal(coreCalls.value, 1);
  assert.equal((await store.read(opened.sessionId)).revision, 0);
});
```

- [ ] **Step 2: Run schema/handler tests and confirm both modules are absent (2 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="complete strict schemas|required tool set|stable boundary|opaque until the single core boundary|inspect layer and source projections|successful inspect projection|session-source analysis|oversized session-backed|oversized apply result"
```

Expected: FAIL with missing `documentToolInputSchemas` and `createDocumentToolHandlers`.

- [ ] **Step 3: Define all eight complete input schemas and command-specific outputs (5 minutes).**

In `schemas.ts`, first define bounded `sessionId`, `layerId`, `sourceId`, and non-negative safe-integer revision primitives. Then export these complete Zod schemas (the names are part of the package contract):

```ts
export const styleSessionOpenInputSchema = z.strictObject({ style: jsonValueSchema });
export const styleSessionCloseInputSchema = z.strictObject({ sessionId: sessionIdSchema });
export const styleValidateInputSchema = z.strictObject({
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('inline'), style: jsonValueSchema }),
    z.strictObject({ kind: z.literal('session'), sessionId: sessionIdSchema }),
  ]),
  options: validationDisplayOptionsSchema.optional(),
});
export const styleInspectInputSchema = z.strictObject({
  sessionId: sessionIdSchema,
  selection: z.discriminatedUnion('view', [
    z.strictObject({ view: z.literal('context') }),
    z.strictObject({ view: z.literal('layer'), layerId: layerIdSchema }),
    z.strictObject({ view: z.literal('source'), sourceId: sourceIdSchema }),
    z.strictObject({ view: z.literal('sourceLayers'), sourceId: sourceIdSchema.optional() }),
  ]),
});
export const styleSearchLayersInputSchema = z.strictObject({
  sessionId: sessionIdSchema,
  query: layerSearchQuerySchema.optional().default({}),
});
export const styleAnalyzeGeoJsonInputSchema = z.strictObject({
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('inline'), data: jsonValueSchema }),
    z.strictObject({ kind: z.literal('sessionSource'), sessionId: sessionIdSchema, sourceId: sourceIdSchema }),
  ]),
});
export const styleApplyTransactionInputSchema = z.strictObject({
  sessionId: sessionIdSchema,
  expectedRevision: revisionSchema,
  transaction: z.unknown().describe(
    'MapLibre StyleTransaction; shape and limits are validated by the core transaction boundary',
  ),
  dryRun: z.boolean().optional(),
});
export const styleExportInputSchema = z.strictObject({
  sessionId: sessionIdSchema,
  revision: revisionSchema.optional(),
});
```

Use `z.strictObject` for every one of the eight exported roots. SDK 1.30's `normalizeObjectSchema` turns root unions/discriminated unions into an empty-object advertisement, so do not use either at an input root and never pass `.shape`. Zod 4 JSON-schema conversion also drops `superRefine`, so a flat optional-field root plus refinements would falsely advertise `{}` and mutually present fields as valid. Preserve truthful discovery by putting required nested discriminated unions in object properties: `style_validate.target`, `style_analyze_geojson.target`, and `style_inspect.selection`. Their `kind`/`view` variants render as nested `anyOf`/`oneOf` plus required fields in `listTools`, while the root remains strict and non-empty. The registration callback receives the output of that same complete schema.

Add concise `.describe(...)` text to every public field and nested variant, including bounds and a small example where useful; the complete root schema also describes the command's exact input choice. `validationDisplayOptionsSchema` is a strict object exposing only bounded `maxIssues`; it must not expose core trusted byte-limit options that an untrusted client could raise. `layerSearchQuerySchema` is adapter-owned but typed as `z.ZodType<LayerSearchQuery>` and strictly allows only `query`, `type`, `source`, `sourceLayer`, and bounded `limit`.

Keep `style_apply_transaction.transaction` as described `z.unknown()`. SDK 1.30 parses `inputSchema` before the callback and passes its parsed value onward, so embedding any core transaction schema here would create an adapter parse/sanitize boundary, reject malformed transactions outside the stable business envelope, and make reference-preservation impossible. The SDK validates only the strict outer session/revision/dry-run object; the guarded handler passes the opaque transaction reference unchanged to `store.apply`, and Task 6 passes it unchanged exactly once to core. The core alone parses shape and applies the resolved default/lowered/raised operation and byte limits, returning the canonical business failure/success. Compensate for the intentionally open transaction property with a narrow tool description that names the `operations` envelope and gives one small operation example; do not imply SDK structural validation. The shared 5 MiB transport limit still bounds total input. `style_session_open` likewise deliberately accepts any JSON value at the protocol boundary so the store can return the canonical style-validation business result instead of the SDK inventing a second style error shape.

Export `DOCUMENT_TOOL_NAMES` and one explicitly keyed `documentToolInputSchemas` object. Do not build it from a loose string map. Also define and export these typed response-data schemas, each matching the declared production result rather than using `z.unknown()` or an undefined name:

```ts
styleSessionOpenDataSchema: z.ZodType<OpenStyleSessionResult>;
styleSessionCloseDataSchema: z.ZodType<CloseStyleSessionResult>;
styleValidateDataSchema: z.ZodType<StyleValidationResult>;
styleInspectDataSchema: z.ZodType<StyleInspectResult>;
styleSearchLayersDataSchema: z.ZodType<LayerSearchResult>;
styleAnalyzeGeoJsonDataSchema: z.ZodType<GeoJsonAnalysisResult>;
styleApplyTransactionDataSchema: z.ZodType<ApplySessionTransactionResult>;
styleExportDataSchema: z.ZodType<ExportStyleSessionResult>;
```

The validation and analysis schemas preserve their public discriminated success/failure branches. The inspect schema is a discriminated union by `view`; open/close/apply/export schemas require their exact revision/session/style/change fields. JSON-extensible Style/GeoJSON members use the already-sanitizing core schemas, while adapter-owned wrapper objects are strict. Export the exact keyed `documentToolResponseDataSchemas` and implement `parseDocumentToolSuccessData` by first calling `parseMcpToolEnvelope`, requiring `ok:true`, and then selecting the named response-data schema. Add tests that narrow one real success for every response schema, retain failures through the general envelope parser, and reject success data whose command-specific required field is absent.

Define the previously named inspect result exactly in `types.ts`; do not leave it as `unknown` or an undeclared forward reference:

```ts
export type StyleInspectResult =
  | { view: 'context'; sessionId: string; revision: number; context: StyleContext }
  | { view: 'layer'; sessionId: string; revision: number; layer: StyleLayer }
  | { view: 'source'; sessionId: string; revision: number; source: StyleSource }
  | { view: 'sourceLayers'; sessionId: string; revision: number; sourceLayers: SourceLayerUsage[] };
```

Task 5 already defines `ExportStyleSessionResult` exactly as `{sessionId:string; revision:number; style:StyleDocument}`. Its response schema and every inspect branch must assert those precise fields and reject missing or cross-view fields. Likewise, `ApplySessionTransactionResult` is the Task 6 object with revision/dryRun/diff/change IDs/warnings; do not reference any response type that no earlier task declares.

Do **not** register an SDK `outputSchema` for these document tools. Their public structured result is a root success/failure union; SDK 1.30 normalizes tool output through `normalizeObjectSchema`, and supplying a non-object root union can degrade or mis-advertise it. The general runtime envelope sanitizer remains authoritative, and the command-specific response-data schemas are for consumer narrowing after `ok:true`. A future SDK integration may add `outputSchema` only after representing the exact success/failure contract as a truthful root-object schema; it must never pass the current union just to satisfy a type.

- [ ] **Step 4: Implement one asynchronous guard and all transport-neutral handlers (5 minutes).**

```ts
export const guardDocumentTool = <S extends z.ZodTypeAny, T>(
  schema: S,
  responseBoundary: McpResponseBoundary,
  run: (input: z.output<S>) => McpTextToolResult<T> | Promise<McpTextToolResult<T>>,
): ((input: unknown) => Promise<McpTextToolResult<T>>) => async (input) => {
  let parsed: z.output<S>;
  try {
    parsed = schema.parse(input);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) return responseBoundary.requireToolFailure(invalidInputFromZod(error));
    return responseBoundary.requireToolFailure(createStyleToolError('INTERNAL', 'The tool failed internally.'));
  }
  try {
    return await run(parsed);
  } catch (error: unknown) {
    if (isStyleToolError(error)) return responseBoundary.requireToolFailure(error);
    return responseBoundary.requireToolFailure(createStyleToolError('INTERNAL', 'The tool failed internally.'));
  }
};
```

Define `DocumentToolHandlers` so every public method accepts `unknown`; its guard is the single direct-call parse boundary. The guard may be a named module export for direct generic testing but is not re-exported from `./mcp`. Instantiate each method with its own schema and a callback that returns an already-finalized `McpTextToolResult<T>`. The guard only parses and catches; on success it returns the callback result directly and never calls `toolSuccess` or wraps a result a second time. Every inline/no-session callback calls the injected `responseBoundary.requireToolSuccess(data)` exactly once. Every session-backed callback calls that same method **inside** its atomic current/revision projector or pre-commit apply finalizer, returning the already-built result; this is what makes response-budget failure occur before TTL/commit. Add the generic success assertion above so a number remains the envelope `data`, not a nested `McpTextToolResult`.

This fixes the inspect path too: it may never return a naked `StyleInspectResult`. Dispatch only on parsed `input.target.kind` or `input.selection.view`, with no optional non-null assertions. Implement every `style_inspect` view with one internal `projectStyleSession` call: inside it, call `snapshot.style.withStyle(style => ...)`, run context building, exact layer lookup, exact source lookup, or source-layer listing synchronously against that one frozen Style clone, construct the result data, and finish with `responseBoundary.requireToolSuccess(data)` before returning from the projector. A requested layer/source that does not exist—including an explicit `sourceLayers.sourceId`—throws the provenance-authentic `NOT_FOUND` from inside the projector, so the projection fails without TTL refresh. Never call public `store.read` and then perform inspect lookup or manually touch the session.

`style_validate` returns the core discriminated validation result as ordinary success data; `style_analyze_geojson` does likewise. Its `sessionSource` branch must also use exactly one `projectStyleSession` and one `snapshot.style.withStyle(...)` call encompassing source lookup, the GeoJSON-source type check, extraction of `data`, and `analyzeGeoJson`. Analyze only the already-stored source JSON: preserve core's `available:false` result for URL/string GeoJSON data and never fetch it. A missing source throws the stable `NOT_FOUND`, while a non-GeoJSON source throws the existing provenance-authentic `INVALID_INPUT`, all from inside the projector. Therefore missing/non-GeoJSON/analysis failures at `ttlMs - 1` leave the original expiry unchanged, while a completed `available:true` or `available:false` analysis refreshes exactly once. There is no preliminary `store.read`, fallback read, manual touch, or second projection. Store methods and projectors throw known structured errors, which the guard turns into `toolFailure`.

Apply the same atomic output boundary to **every** composite session-backed tool. Session-target validation and layer search each run their reader plus `responseBoundary.requireToolSuccess` within one current projector. Session-source analysis does so after analysis. `style_export` uses `projectStyleSessionRevision` for both omitted/current and exact retained revisions, constructs `{sessionId, revision, style:snapshot.style.view}`, and finalizes the tool result before touch; it must not call public `store.export`. `style_apply_transaction` uses `applyStyleSessionTransactionResult` with `responseBoundary.requireToolSuccess` as the pre-commit finalizer; it must not call public `store.apply`. A too-large result from committed or dry-run mode therefore leaves style/revision/history/TTL unchanged after one core call. Inline validation/analysis and the fixed-small open/close results call the same boundary immediately; the configured minimum is chosen so the fixed open/close result and `responseTooLarge` failure always fit.

Use two separate try/catch phases. Only a `z.ZodError` thrown by the direct `schema.parse(input)` phase becomes bounded `INVALID_INPUT` without echoing the complete input. A Zod error thrown by a dependency or by output-envelope validation is an internal implementation failure, never a client input error. In the execution/output phase, a caught value is a known business error only when the imported **core provenance** `isStyleToolError` accepts its identity. A plain object that perfectly forges `code/message/path/details` (including secret fields) is still unknown and becomes the fixed `INTERNAL` message with no original message, stack, property, or cause in `details`; add this explicit dependency-forgery test. Unknown `Error`, string, object, or rejected Promise follows the same path. Both catch phases call `responseBoundary.requireToolFailure`, never bare `toolFailure`, so even a provenance-authentic dependency error with a huge message/path/details becomes the fixed redacted `responseTooLarge` envelope before transport. Because the low-level failure result is `McpTextToolResult<never>`, both catch phases compile as `McpTextToolResult<T>` for any guarded success type; retain the generic guard compile/runtime/non-nesting test above.

The SDK performs the first parse from the complete schemas during Task 9. Therefore an SDK-level schema rejection is a protocol validation result and the callback is not invoked; it is intentionally not a business envelope. Once invocation begins, no known domain/store error may escape for the SDK to reshape. Direct handler calls still parse defensively and return the stable `INVALID_INPUT` envelope. Map failures only to existing core codes and never read a filename, URL, environment variable, or working directory.

- [ ] **Step 5: Exercise successful outputs and stable business failures (4 minutes).**

Add a stale-revision case that opens a session, commits revision 1, calls `style_apply_transaction` again with `expectedRevision: 0`, and asserts `isError:true`, `REVISION_CONFLICT`, text/structured parity, and unchanged revision. Test missing sessions through both inspect and export, exact missing layer/source/sourceLayers targets at `ttlMs - 1`, missing and non-GeoJSON session-source analysis at `ttlMs - 1`, a successful context projection, a successful inline-GeoJSON session-source analysis, a direct Zod failure, a known store error, and an injected unknown rejection containing a secret string. Lock the open-result assumption at the minimum policy: an exactly `MAX_STYLE_SESSION_ID_BYTES` valid factory ID produces one bounded successful open envelope, while empty/lone-surrogate/one-byte-over and duplicate IDs return the stable failure with zero new session/slot and no later response-budget rejection. For small-message-policy tests, cover current/retained export, session validate, inspect source, search, session-source analysis, committed apply, and dry-run apply; each over-budget response must be the fixed redacted `responseTooLarge`, run its projector/core once, and fail before TTL/commit. Advance every failed-projection clock beyond the original expiry to prove no refresh; advance each successful projection beyond the original expiry to prove it did refresh. For every success, call `parseDocumentToolSuccessData` with the matching command name; for every failure, call the general envelope parser and never attempt command-data narrowing.

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="complete strict schemas|required tool set|stable boundary|generic guard failure|opaque until the single core boundary|inspect layer and source projections|successful inspect projection|session-source analysis|oversized session-backed|oversized apply result|style_validate|style_inspect|style_analyze_geojson|style_session_open|style_export|missing session|stale revision|redacts unknown|forged|filesystem"
rtk pnpm run typecheck
```

Expected: PASS; each handler returns one non-nested prebuilt result, every direct call is parsed, missing/stale/response-budget business failures retain the stable envelope, failed inspect/session-source/export/other session projections leave idle TTL unchanged while successful ones refresh it, over-budget apply never commits or reruns core, unknown failures are redacted, and file-looking strings are merely data rather than paths to open.

- [ ] **Step 6: Commit document schemas and handler layer (2 minutes).**

```bash
rtk git add src/mcp/schemas.ts src/mcp/schemas.test.ts src/mcp/document-handlers.ts src/mcp/document-handlers.test.ts src/mcp/types.ts src/mcp/main.ts
rtk git commit -m "feat: add atomic transport-neutral MCP document handlers"
```

### Task 8: Resolve exact dynamic MCP resources and URI boundaries

**Files:**
- Create: `src/mcp/resources.ts`
- Create: `src/mcp/resources.test.ts`
- Modify: `src/mcp/types.ts`
- Modify: `src/mcp/main.ts`

**Interfaces:**
- Consumes: module-internal atomic current/revision projectors, one resolved `McpResponseBoundary`, exported `ResourceUriAdmission`, `buildStyleContext`, `searchLayers`, `listSourceLayers`, exact `RevisionSnapshot` incoming-diff semantics, and encoded MCP resource URIs.
- Produces: `documentResourceUriAdmission` for the original raw `maplibre-style:` URI string, `McpResourceResolver.resolve(uri: URL): Promise<{ contents: Array<{ uri: string; mimeType: 'application/json'; text: string }> }>` plus exactly six templates with literal markers: `sessions/~{sessionId}`, `style`, `context`, `layers/~{layerId}`, `sources/~{sourceId}`, and `revisions/~{revision}/diff`; baseline revision 0 is rejected before store access so an invalid diff request cannot refresh idle TTL.

- [ ] **Step 1: Write failing URI and failure-mode tests (5 minutes).**

```ts
test('resource URI round trips encoded session and layer IDs', async () => {
  const uri = makeLayerUri('city/one', 'road & rail');
  const result = await resolver.resolve(uri);
  const first = result.contents[0];
  assert.ok(first);
  assert.equal(JSON.parse(first.text).layer.id, 'road & rail');
  assert.equal(parseLayerUri(makeLayerUri('percent%~', 'a/b%~')).sessionId, 'percent%~');
  assert.equal(parseLayerUri(makeLayerUri('percent%~', 'a/b%~')).layerId, 'a/b%~');
  assert.equal(parseLayerUri(makeLayerUri('.', '..')).sessionId, '.');
  assert.equal(parseLayerUri(makeLayerUri('.', '..')).layerId, '..');
  assert.equal(parseSourceUri(makeSourceUri('..', '.')).sourceId, '.');
  assert.equal(parseLayerUri(makeLayerUri('~', '%2F')).sessionId, '~');
  const expanded = new ResourceTemplate(styleResourceTemplates[1], { list: undefined })
    .uriTemplate.expand({ sessionId: 's1' });
  assert.equal(JSON.parse((await resolver.resolve(new URL(expanded))).contents[0]!.text).version, 8);
  const expandedLayer = new ResourceTemplate(styleResourceTemplates[3], { list: undefined })
    .uriTemplate.expand({ sessionId: 'percent%~', layerId: 'a/b%~' });
  assert.equal(expandedLayer, makeLayerUri('percent%~', 'a/b%~').href);
  await assert.rejects(
    () => resolver.resolve(new URL('maplibre-style://sessions/s1/style')),
    { code: 'INVALID_INPUT', details: { reason: 'nonCanonicalResourceUri' } },
  );
});

test('document raw URI admission rejects every normalization alias before URL construction', () => {
  for (const uri of [
    makeSessionUri('.').href,
    makeLayerUri('s1', '..').href,
    makeSourceUri('percent%~', 'a/b%~').href,
    makeDiffUri('s1', 1).href,
  ]) assert.doesNotThrow(() => documentResourceUriAdmission.assertCanonical(uri));

  for (const alias of [
    'maplibre-style://sessions/s1/style',
    'maplibre-style://sessions/../~s1/style',
    'maplibre-style://sessions/%2e%2e/~s1/style',
    'maplibre-style://sessions/~s1/layers/../~roads',
    'maplibre-style://sessions/~s1/layers/%2E/~roads',
    'maplibre-style://sessions/~s1/layers/~%72oads',
    'maplibre-style://sessions/%2573%2531/style',
    'maplibre-style://sessions/~s1/style?alias=1',
    'maplibre-style://sessions/~s1/style#alias',
  ]) {
    assert.throws(
      () => documentResourceUriAdmission.assertCanonical(alias),
      { code: 'INVALID_INPUT', details: { reason: 'nonCanonicalResourceUri' } },
    );
  }
});

test('resource resolver distinguishes absent, expired, and out-of-range revisions', async () => {
  await assert.rejects(() => resolver.resolve(sessionUri('missing')), { code: 'NOT_FOUND' });
  await assert.rejects(() => resolver.resolve(diffUri(id, 99)), { code: 'NOT_FOUND' });
  clock.advance(30 * 60_000 + 1);
  await assert.rejects(() => resolver.resolve(sessionUri(id)), { code: 'NOT_FOUND' });
});

test('revision resource addresses post-state revisions rather than array indices', async () => {
  const opened = await store.open(validStyle);
  await commitNumberedChanges(store, opened.sessionId, 3);
  const revisionThree = JSON.parse((await resolver.resolve(diffUri(opened.sessionId, 3))).contents[0]!.text);
  assertDiffTransforms(revisionThree, 2, 3);
  await assert.rejects(() => resolver.resolve(diffUri(opened.sessionId, 0)), { code: 'INVALID_INPUT', details: { reason: 'baselineHasNoDiff' } });
  await evictRevision(store, opened.sessionId, 1);
  await assert.rejects(() => resolver.resolve(diffUri(opened.sessionId, 1)), { code: 'NOT_FOUND', details: { reason: 'revisionEvicted' } });
});

test('baseline diff rejection happens before store access and does not refresh idle TTL', async () => {
  const clock = createFakeClock();
  const ttlStore = createStyleSessionStore({ clock, limits: { ttlMs: 100 }, idFactory: () => 'ttl-session' });
  const ttlResolver = createResourceResolver(ttlStore, defaultResponseBoundary);
  const opened = await ttlStore.open(validStyle);
  clock.value = 99;
  await assert.rejects(
    () => ttlResolver.resolve(makeDiffUri(opened.sessionId, 0)),
    { code: 'INVALID_INPUT', details: { reason: 'baselineHasNoDiff' } },
  );
  clock.value = 101;
  await assert.rejects(
    () => ttlStore.read(opened.sessionId),
    { code: 'NOT_FOUND', details: { reason: 'expired' } },
  );
});

test('unknown layer and source resources fail without refreshing idle TTL', async () => {
  for (const makeMissingUri of [
    (sessionId: string) => makeLayerUri(sessionId, 'missing-layer'),
    (sessionId: string) => makeSourceUri(sessionId, 'missing-source'),
  ]) {
    const clock = createFakeClock();
    const store = createStyleSessionStore({ clock, limits: { ttlMs: 100 }, idFactory: () => 'ttl-session' });
    const resolver = createResourceResolver(store, defaultResponseBoundary);
    const opened = await store.open(validStyle);
    clock.value = 99;
    await assert.rejects(() => resolver.resolve(makeMissingUri(opened.sessionId)), { code: 'NOT_FOUND' });
    clock.value = 101;
    await assert.rejects(() => store.read(opened.sessionId), { code: 'NOT_FOUND', details: { reason: 'expired' } });
  }
});

test('successful resource projection refreshes idle TTL', async () => {
  const clock = createFakeClock();
  const store = createStyleSessionStore({ clock, limits: { ttlMs: 100 }, idFactory: () => 'ttl-session' });
  const resolver = createResourceResolver(store, defaultResponseBoundary);
  const opened = await store.open(validStyle);
  clock.value = 99;
  const result = await resolver.resolve(makeStyleUri(opened.sessionId));
  assert.equal(JSON.parse(result.contents[0]!.text).version, 8);
  clock.value = 101;
  assert.equal((await store.read(opened.sessionId)).revision, 0);
});

test('oversized style, context, layer, source, and diff resources do not refresh idle TTL', async () => {
  for (const scenario of [
    oversizedStyleResource,
    oversizedContextResource,
    oversizedLayerResource,
    oversizedSourceResource,
    oversizedPositiveRevisionDiffResource,
  ]) {
    const clock = createFakeClock();
    const boundary = createMcpResponseBoundary(resolveMcpMessagePolicy({ maxMessageBytes: MIN_MCP_MESSAGE_BYTES }));
    const { store, sessionId, uri, dependencyCalls } = await scenario({ clock });
    const resolver = createResourceResolver(store, boundary);
    clock.value = 99;
    await assert.rejects(
      () => resolver.resolve(uri(sessionId)),
      { code: 'INVALID_INPUT', details: { reason: 'responseTooLarge' } },
    );
    assert.equal(dependencyCalls.value, 1);
    clock.value = 101;
    await assert.rejects(() => store.read(sessionId), { code: 'NOT_FOUND', details: { reason: 'expired' } });
  }
});
```

- [ ] **Step 2: Run resource tests and confirm URI helpers are absent (2 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="round trips encoded|raw URI admission|absent, expired|baseline diff rejection|unknown layer and source resources|successful resource projection|oversized style, context, layer, source"
```

Expected: FAIL because no resource parser or resolver exists.

- [ ] **Step 3: Implement exact templates and decode-once parsing (5 minutes).**

```ts
const encodeDynamicSegment = (value: string) => `~${encodeURIComponent(value)}`;
const decodeDynamicSegment = (raw: string) => {
  if (!raw.startsWith('~')) throw nonCanonicalResourceUri();
  return decodeURIComponent(raw.slice(1));
};
export const styleResourceTemplates = [
  'maplibre-style://sessions/~{sessionId}',
  'maplibre-style://sessions/~{sessionId}/style',
  'maplibre-style://sessions/~{sessionId}/context',
  'maplibre-style://sessions/~{sessionId}/layers/~{layerId}',
  'maplibre-style://sessions/~{sessionId}/sources/~{sourceId}',
  'maplibre-style://sessions/~{sessionId}/revisions/~{revision}/diff',
] as const;
```

WHATWG URL parsing normalizes raw or percent-encoded path segments equal to `.`/`..` before a resolver sees `pathname`. Avoid value-specific aliases by using one canonical representation for **every** dynamic path segment: the literal raw marker `~` followed by `encodeURIComponent(value)`. Thus `.`/`..` become `~.`/`~..` and cannot be interpreted as dot segments, while literal `~`, `%`, `/`, and `%2F` values remain distinguishable after one decode. Put the literal `~` in every advertised `ResourceTemplate`, so a generic RFC6570 client passes the raw semantic session/layer/source/revision value and the template expander performs the one percent-encoding step. Export the typed `makeSessionUri`/`makeStyleUri`/`makeContextUri`/`makeLayerUri`/`makeSourceUri`/`makeDiffUri` helpers, which call `encodeDynamicSegment` directly and produce byte-identical URIs. Never ask a client to pre-mark or pre-encode a template variable; that would make discovery non-portable or double-encode `%`. Resource descriptions and README must state this contract and recommend the typed helpers for application code.

Implement `documentResourceUriAdmission` as `{scheme:'maplibre-style', authority:'sessions', assertCanonical(rawUri)}` without calling `new URL`. Match the entire original string against only the six static route grammars; forbid query/fragment/userinfo/port, require exact lowercase scheme and `sessions` authority/static tokens, split only literal raw `/`, and require every dynamic segment to equal `encodeDynamicSegment(decodeURIComponentOnce(segmentWithoutMarker))`. Before that route match, Task 4's global raw-dot gate rejects literal or case-insensitive encoded `.`/`..` segments. This combination rejects normalization-changing, missing-marker, non-canonical percent spelling, and legacy/re-encoded aliases before SDK constructs a URL. A canonical marked `~.` or `~..` is legal because its decoded full segment is not a dot segment. A canonical ID whose semantic value literally contains `%2F` remains distinct: the raw segment is `%252F`, one decode yields `%2F`, and neither admission nor resolver decodes twice.

The SDK ResourceTemplate callback receives a `URL` only **after** this factory-registered admission has accepted the original request string; the callback cannot recover a spelling erased by WHATWG normalization and must never pretend to be the primary alias boundary. Within the resolver, split the already-admitted encoded pathname defensively, require/strip the first raw `~` marker from every expected dynamic segment, and decode exactly once. A second `~` is value data (the canonical representation of literal ID `~`), not another marker. A decoded `/`, `.`, `..`, `%`, `~`, `@`, space, or ampersand remains ordinary ID data and must not be split, normalized, or rejected. Direct resolver calls still reject visible unmarked/wrong-shape URLs, but transport admission is what makes pre-normalization spelling authoritative. Leave the six advertised template strings unchanged and return MCP resource `contents` text only; do not attach tool-style `structuredContent`.

Resolve session metadata, style, context, exact layer, and exact source resources through one synchronous internal `projectStyleSession` callback per request. Use `snapshot.style.view` when only serializing the immutable Style and `snapshot.style.withStyle(style => ...)` for existing typed core readers; perform context building and layer/source existence checks inside that projector, construct the **complete** `{contents:[...]}` result, and call `responseBoundary.requireResourceResult(result)` before it returns. A missing layer/source, `responseTooLarge`, or any other projector failure therefore leaves `lastAccessedAt` unchanged; a successful resource projection refreshes it exactly once. Never use public `store.read` followed by resolver-side lookup/manual touch, never budget only inner `text`, and never cast away the frozen facade.

Positive revision-diff resources use `projectStyleSessionRevision` rather than public `readRevision`: select the exact revision, construct the full result from its cloned `incomingDiff`, and run `requireResourceResult` inside the revision projector before touch. This matters when an embedder lowers `maxMessageBytes` below the core diff limit. Revision 0 is still rejected before any store call as specified below. `createResourceResolver(store, responseBoundary)` requires the boundary explicitly; no per-resolver default may silently diverge from the factory policy.

Resolve `/revisions/~{revision}/diff` by first decoding and validating the revision as a non-negative safe integer. If it is 0, immediately return the provenance-authentic `INVALID_INPUT/details.reason:'baselineHasNoDiff'` **before** calling any store capability; this prevents the otherwise-successful baseline selection from refreshing `lastAccessedAt` for a rejected resource request. Only positive revisions enter queued `projectStyleSessionRevision(sessionId, revision, ...)` and are treated as exact post-state revision values. Return that snapshot's cloned `incomingDiff`, which transforms revision `N-1` to `N`; a positive never-created or FIFO-evicted revision returns `NOT_FOUND` with its specific reason. Do not index a history array or synthesize a diff after predecessor eviction. Reject malformed percent escapes, wrong raw segment counts/static segments, non-integer decoded revision text, missing or expired sessions, unknown layers/sources, revisions outside retained history, and over-budget complete results using only `NOT_FOUND` or provenance-authentic `INVALID_INPUT`. The fake-clock regressions above must prove revision-0 and over-budget current/positive-revision requests at `ttlMs - 1` do not keep the session alive past its original expiry.

- [ ] **Step 4: Verify every template and parser boundary (4 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="resource URI|raw URI admission|encoded|dot segment|revision resource addresses|baseline diff rejection|unknown layer and source resources|successful resource projection|oversized style, context, layer, source|missing|expired|out-of-range|malformed"
rtk pnpm run typecheck
```

Expected: PASS; canonical marked values round-trip through the official `ResourceTemplate`, raw aliases are rejected before `new URL`, revision 0, unknown subresources, and over-budget current/retained resources fail without touching TTL or re-running a projector, successful resources refresh it, and a resource URI cannot escape its intended dynamic segment.

- [ ] **Step 5: Commit resource resolver (2 minutes).**

```bash
rtk git add src/mcp/resources.ts src/mcp/resources.test.ts src/mcp/types.ts src/mcp/main.ts
rtk git commit -m "feat: add atomically budgeted MapLibre style MCP resources"
```

### Task 9: Register handlers with v1 McpServer through an extension seam

**Files:**
- Create: `src/mcp/server-extension.ts`
- Create: `src/mcp/server-extension.test.ts`
- Create: `src/mcp/create-server.ts`
- Create: `src/mcp/create-server.test.ts`
- Modify: `src/mcp/main.ts`

**Interfaces:**
- Consumes: v1 `McpServer`, `ResourceTemplate`, `MCP_SERVER_VERSION`, `DOCUMENT_TOOL_NAMES`, the eight complete `documentToolInputSchemas`, `DocumentToolHandlers`, `McpResourceResolver`, `documentResourceUriAdmission`, `resolveMcpMessagePolicy`, `createMcpResponseBoundary`, the Task 4 resource-admission registry and bounded transport, nominal `StyleSessionStore`, Node-internal `assertFactoryStyleSessionStore`, and session-store options.
- Produces: `McpServerExtensionContext` containing one resolved readonly `messagePolicy`, its same `responseBoundary`, composition-only `registerResourceUriAdmission`, and variadic `guardResourceHandler`; `McpServerExtension = (server: McpServer, context: McpServerExtensionContext) => undefined`; `createMapLibreStyleMcpServer(options?)` returning `{server: McpServer; store; messagePolicy; connect(rawTransport, onTerminal?): Promise<void>; close(): Promise<void>}`; and Node-internal `preflightCreatedMcpInbound(created, parsedMessage): void` for exact-handle HTTP preflight. Before extensions run, the factory immutably replaces all public high/low SDK `connect` and `close` spellings with the same bounded/stateful capabilities, leaving no raw connection or ownership-bypassing close path. Factory options accept `extensions?: McpServerExtension[]`, `store?: StyleSessionStore`, `storeOptions?: StyleSessionStoreOptions`, and `maxMessageBytes?: number`; supplying both store forms is invalid.

- [ ] **Step 1: Write failing extension registration tests (5 minutes).**

```ts
test('extension registers eight tools and six ResourceTemplate entries', () => {
  const server = new RecordingMcpServer();
  createMcpServerExtension({ handlers, resources })(server as unknown as McpServer, extensionContext);
  assert.equal(server.tools.length, 8);
  assert.equal(server.resources.filter((entry) => entry.template instanceof ResourceTemplate).length, 6);
  assert.deepEqual(extensionContext.registeredAdmissions.map((entry) => entry.scheme), ['maplibre-style']);
  for (const entry of server.tools) {
    const name = requireDocumentToolName(entry.name);
    const expected = expectedToolMetadata[name];
    assert.equal(entry.config.inputSchema, documentToolInputSchemas[name]);
    assert.equal(entry.config.title, expected.title);
    assert.equal(entry.config.description, expected.description);
    assert.deepEqual(entry.config.annotations, expected.annotations);
    assert.deepEqual(Object.keys(entry.config.annotations).sort(), [
      'destructiveHint', 'idempotentHint', 'openWorldHint', 'readOnlyHint',
    ]);
    assert.equal('outputSchema' in entry.config, false);
  }
});

test('base and caller extensions receive the one resolved response policy', () => {
  const seen: McpServerExtensionContext[] = [];
  let registerAfterComposition: ((admission: ResourceUriAdmission) => void) | undefined;
  const counters = createCompositionDependencyCounters();
  const created = createMapLibreStyleMcpServerWithDependencies({
    maxMessageBytes: 256 * 1024,
    extensions: [(_server, context) => {
      seen.push(context);
      context.registerResourceUriAdmission(customResourceAdmission);
      registerAfterComposition = context.registerResourceUriAdmission;
      return undefined;
    }],
  }, counters.dependencies);
  assert.equal(seen.length, 1);
  assert.strictEqual(seen[0]!.messagePolicy, created.messagePolicy);
  assert.strictEqual(counters.handlerBoundary, seen[0]!.responseBoundary);
  assert.strictEqual(counters.resourceBoundary, seen[0]!.responseBoundary);
  assert.strictEqual(counters.transportAdmissions, counters.frozenAdmissions);
  assert.deepEqual(counters.frozenAdmissions.namespaces, [
    ['maplibre-style', 'sessions'], ['maplibre-style', 'maps'],
  ]);
  assert.throws(
    () => registerAfterComposition!(lateAdmission),
    { code: 'INVALID_INPUT', details: { reason: 'resourceAdmissionsFrozen' } },
  );
  assert.equal(created.messagePolicy.maxMessageBytes, 256 * 1024);
});

test('McpServerExtension is synchronous and runtime rejects thenables without late work', async () => {
  // @ts-expect-error Promise-returning registration is not an McpServerExtension.
  const compileRejected: McpServerExtension = async () => undefined;
  void compileRejected;
  for (const scenario of [asyncRegistersBeforeAwait, asyncRegistersAfterAwait, asyncRejects]) {
    const deps = createAsyncExtensionCompositionDependencies();
    assert.throws(
      () => createMapLibreStyleMcpServerWithDependencies({
        extensions: [scenario.extension as unknown as McpServerExtension],
      }, deps.dependencies),
      { code: 'INVALID_INPUT', details: { reason: 'asyncMcpExtension' } },
    );
    await scenario.settled;
    assert.equal(deps.serverHandles, 0);
    assert.equal(deps.ownedStoreDisposeCalls, 1);
    assert.equal(deps.admissionsFrozen, false);
    assert.equal(deps.lateRegistrationCalls, 0);
    assert.equal(deps.unhandledRejections.length, 0);
  }
  const shared = createStyleSessionStore();
  assert.throws(() => createMapLibreStyleMcpServer({
    store: shared,
    extensions: [asyncRejects.extension as unknown as McpServerExtension],
  }), { details: { reason: 'asyncMcpExtension' } });
  assert.ok((await shared.open(validStyle)).sessionId);
  shared.dispose();
});

test('internal HTTP preflight requires the exact live created handle and frozen admission identity', async () => {
  const deps = createRecordingCompositionDependencies();
  const policy = resolveMcpMessagePolicy({ maxMessageBytes: 256 * 1024 });
  const created = createMapLibreStyleMcpServerWithDependencies(
    {}, deps, policy, 'transport-prebounded',
  );
  assert.doesNotThrow(() => preflightCreatedMcpInbound(
    created, resourceReadRequest(makeStyleUri('s1').href),
  ));
  assert.throws(
    () => preflightCreatedMcpInbound(
      created, resourceReadRequest('maplibre-style://sessions/../~s1/style'),
    ),
    { code: 'INVALID_INPUT', details: { reason: 'nonCanonicalResourceUri' } },
  );
  assert.throws(
    () => preflightCreatedMcpInbound({ ...created }, smallRequest),
    { code: 'INVALID_INPUT', details: { reason: 'invalidMcpServerHandle' } },
  );
  assert.throws(
    () => preflightCreatedMcpInbound('not-a-handle', smallRequest),
    { code: 'INVALID_INPUT', details: { reason: 'invalidMcpServerHandle' } },
  );
  assert.throws(
    () => preflightCreatedMcpInbound({ server: created.server, store: created.store }, smallRequest),
    { code: 'INVALID_INPUT', details: { reason: 'invalidMcpServerHandle' } },
  );
  const foreign = createMapLibreStyleMcpServerWithDependencies({}, createRecordingCompositionDependencies());
  assert.throws(
    () => preflightCreatedMcpInbound(foreign.server, smallRequest),
    { code: 'INVALID_INPUT', details: { reason: 'invalidMcpServerHandle' } },
  );
  await created.close();
  assert.throws(
    () => preflightCreatedMcpInbound(created, smallRequest),
    { code: 'INVALID_INPUT', details: { reason: 'invalidMcpServerHandle' } },
  );
  await foreign.close();
  assert.strictEqual(deps.preflightInboundContext, deps.transportInboundContext);
  assert.equal(deps.protocolDispatchCalls, 0);
});

test('an extension can capture only already-bounded high and low connect capabilities', async () => {
  for (const spelling of ['high', 'low'] as const) {
    const deps = createRecordingCompositionDependencies();
    let capturedConnect: ((raw: TestTransport) => Promise<void>) | undefined;
    const created = createMapLibreStyleMcpServerWithDependencies({
      extensions: [(server) => {
        capturedConnect = spelling === 'high'
          ? server.connect.bind(server)
          : server.server.connect.bind(server.server);
        return undefined;
      }],
    }, deps);
    if (!capturedConnect) assert.fail('extension did not receive its server');
    const raw = createRecordingTransport();
    await capturedConnect(raw);
    assert.notStrictEqual(deps.connectedTransport, raw);
    await deps.connectedTransport!.send(
      makeOversizedResponseWithSafeId(created.messagePolicy.maxMessageBytes + 1),
    );
    assert.equal(raw.sent[0]?.error?.data?.details?.reason, 'responseTooLarge');
    await created.close();
    assert.equal(raw.closeCalls, 1);
  }
});

test('all public connect spellings install exactly one bounded transport', async () => {
  for (const spelling of ['created', 'high', 'low'] as const) {
    const deps = createRecordingCompositionDependencies();
    const created = createMapLibreStyleMcpServerWithDependencies({}, deps);
    const raw = createRecordingTransport();
    if (spelling === 'created') await created.connect(raw, deps.onTerminal);
    else if (spelling === 'high') await created.server.connect(raw);
    else await created.server.server.connect(raw);
    assert.notStrictEqual(deps.connectedTransport, raw);
    const connected = deps.connectedTransport;
    if (!connected) assert.fail('expected the SDK to receive a bounded transport');
    await connected.send(makeOversizedResponseWithSafeId(created.messagePolicy.maxMessageBytes + 1));
    assert.equal(raw.sent.length, 1);
    assert.equal(raw.sent[0]?.error?.data?.details?.reason, 'responseTooLarge');
    await created.close();
    assert.equal(raw.startCalls, 1);
    assert.equal(raw.closeCalls, 1);
  }
});

test('all close spellings share state and preserve store ownership', async () => {
  for (const spelling of ['created', 'high', 'low'] as const) {
    const deps = createRecordingCompositionDependencies();
    const created = createMapLibreStyleMcpServerWithDependencies({}, deps);
    const raw = createRecordingTransport();
    await created.connect(raw);
    if (spelling === 'created') await created.close();
    else if (spelling === 'high') await created.server.close();
    else await created.server.server.close();
    await Promise.all([created.close(), created.server.close(), created.server.server.close()]);
    assert.equal(raw.closeCalls, 1);
    assert.equal(deps.protocolCloseCalls, 1);
    assert.equal(deps.storeDisposeCalls, 1);
  }
  const callerStore = createStyleSessionStore();
  const callerOwned = createMapLibreStyleMcpServer({ store: callerStore });
  await callerOwned.server.server.close();
  assert.ok((await callerStore.open(validStyle)).sessionId);
  callerStore.dispose();
});

test('factory close-before-connect and close-during-connect cannot resurrect a server', async () => {
  const closed = createMapLibreStyleMcpServerWithDependencies({}, createRecordingCompositionDependencies());
  await closed.close();
  const rejectedRaw = createRecordingTransport();
  await assert.rejects(() => closed.connect(rejectedRaw), { details: { reason: 'serverClosed' } });
  assert.equal(rejectedRaw.startCalls, 0);
  assert.equal(rejectedRaw.closeCalls, 1);

  const delayed = createDelayedProtocolConnectDependencies();
  const connecting = createMapLibreStyleMcpServerWithDependencies({}, delayed.dependencies);
  const raw = createRecordingTransport();
  const connectPromise = connecting.connect(raw);
  await delayed.afterRawStart;
  const closePromise = connecting.close();
  delayed.releaseConnect();
  await assert.rejects(() => connectPromise, { details: { reason: 'serverClosed' } });
  await closePromise;
  assert.equal(raw.closeCalls, 1);
  assert.equal(delayed.storeDisposeCalls, 1);
  assert.equal(delayed.liveHandles, 0);
});

test('bounded connect failure and default terminal cleanup settle without leaks', async () => {
  const failing = createConnectFailureDependencies({ failAfterTransportStart: true });
  const created = createMapLibreStyleMcpServerWithDependencies({}, failing.dependencies);
  const raw = createRecordingTransport();
  await assert.rejects(() => created.connect(raw), (error) => error === failing.primaryError);
  assert.equal(raw.closeCalls, 1);
  assert.equal(failing.storeDisposeCalls, 1);

  const rejecting = createRejectingCloseDependencies();
  const second = createMapLibreStyleMcpServerWithDependencies({}, rejecting.dependencies);
  const secondRaw = createRecordingTransport();
  await second.connect(secondRaw);
  secondRaw.emitMessage(requestWithSerializedIdBytes(MAX_MCP_REQUEST_ID_BYTES + 1));
  await rejecting.terminalSettled;
  assert.equal(secondRaw.closeCalls, 1);
  assert.equal(rejecting.unhandledRejections.length, 0);
});

test('bounded resource registration preserves known reasons and redacts unknown failures', async () => {
  const uri = new URL('maplibre-style://sessions/~s1/style');
  const variables = { sessionId: 's1' };
  const extra = { signal: AbortSignal.timeout(1_000) };
  const calls: unknown[][] = [];
  const guarded = extensionContext.guardResourceHandler((...args: unknown[]) => {
    calls.push(args);
    return smallResourceResult;
  });
  assert.strictEqual(await guarded(uri, variables, extra), smallResourceResult);
  assert.deepEqual(calls, [[uri, variables, extra]]);
  const known = await invokeGuardedResourceHandler(throwResponseTooLarge);
  assert.equal(parseStyleToolErrorShape(known.error.data).details?.reason, 'responseTooLarge');
  const unknown = await invokeGuardedResourceHandler(() => { throw new Error('private-resource-secret'); });
  assert.doesNotMatch(JSON.stringify(unknown.error), /private-resource-secret/);
  assert.ok(utf8JsonBytes(unknown) <= extensionContext.messagePolicy.maxMessageBytes);
});

test('server factory has no import-time server side effects', async () => {
  const before = activeHandleNames();
  await import('./create-server.js');
  assert.deepEqual(activeHandleNames(), before);
});

test('server factory rejects a structural store before composing any handler', () => {
  const structural = createPlainStructuralStoreFake();
  const counters = createCompositionDependencyCounters();
  assert.throws(
    () => createMapLibreStyleMcpServerWithDependencies(
      { store: structural as unknown as StyleSessionStore, extensions: [counters.extension] },
      counters.dependencies,
    ),
    { code: 'INVALID_INPUT', details: { reason: 'invalidStyleSessionStore' } },
  );
  assert.deepEqual(counters.snapshot(), {
    serverFactories: 0, handlerFactories: 0, resourceFactories: 0, extensions: 0,
  });
  assert.equal(structural.methodCalls, 0);
});

test('a branded factory-created injected store is accepted and remains caller-owned', async () => {
  const store = createStyleSessionStore();
  const first = createMapLibreStyleMcpServer({ store });
  const second = createMapLibreStyleMcpServer({ store });
  assert.strictEqual(first.store, store);
  assert.strictEqual(second.store, store);
  await first.close();
  const opened = await second.store.open(validStyle);
  assert.ok(opened.sessionId);
  await second.close();
  store.dispose();
});

test('an owned store is disposed only after server close settles', async () => {
  const order: string[] = [];
  const close = createOwnedClose(
    async () => { order.push('server:close'); },
    () => { order.push('store:dispose'); },
  );
  await close();
  assert.deepEqual(order, ['server:close', 'store:dispose']);
  await close();
  assert.deepEqual(order, ['server:close', 'store:dispose']);
});
```

- [ ] **Step 2: Run server tests and verify the seam is not implemented (2 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --test --test-name-pattern="extension registers|one resolved response policy|synchronous and runtime rejects thenables|internal HTTP preflight|already-bounded high and low|all public connect|all close spellings|close-before-connect|bounded connect failure|bounded resource registration|import-time|structural store|branded factory-created|owned store" .tmp/test-dist/mcp/server-extension.test.js .tmp/test-dist/mcp/create-server.test.js
```

Expected: FAIL with missing extension or factory symbols.

- [ ] **Step 3: Compose an explicit extension rather than subclassing a transport (5 minutes).**

```ts
export interface McpServerExtensionContext {
  readonly messagePolicy: McpMessagePolicy;
  readonly responseBoundary: McpResponseBoundary;
  registerResourceUriAdmission(admission: ResourceUriAdmission): void;
  guardResourceHandler<Args extends unknown[], T>(
    handler: (...args: Args) => T | Promise<T>,
  ): (...args: Args) => Promise<T>;
}
export type McpServerExtension = (
  server: McpServer,
  context: McpServerExtensionContext,
) => undefined;

interface CreatedMcpInboundCapability {
  readonly messagePolicy: McpMessagePolicy;
  readonly inboundContext: InboundMcpFramingContext;
  readonly isLive: () => boolean;
}

// Node-internal authority only: this is intentionally not exported through ./mcp.
const createdMcpInboundCapabilities = new WeakMap<object, CreatedMcpInboundCapability>();

const invalidMcpServerHandle = (): never => {
  throw createStyleToolError('INVALID_INPUT', 'Invalid MCP server handle.', undefined, {
    reason: 'invalidMcpServerHandle',
  });
};

export const preflightCreatedMcpInbound = (created: unknown, parsedMessage: unknown): void => {
  if ((typeof created !== 'object' || created === null) && typeof created !== 'function') {
    invalidMcpServerHandle();
  }
  const capability = createdMcpInboundCapabilities.get(created);
  if (!capability || !capability.isLive()) invalidMcpServerHandle();
  assertInboundMcpFraming(parsedMessage, capability.messagePolicy, capability.inboundContext);
};

export const createMcpServerExtension = (deps: ExtensionDependencies): McpServerExtension => (server, context) => {
  context.registerResourceUriAdmission(documentResourceUriAdmission);
  registerDocumentTools(server, deps.handlers);
  registerStyleResources(server, deps.resources, ResourceTemplate, context.guardResourceHandler);
  return undefined;
};

export const createMapLibreStyleMcpServerWithDependencies = (
  options: CreateMapLibreStyleMcpServerOptions,
  deps: ServerCompositionDependencies,
  preResolvedPolicy?: McpMessagePolicy,
  inboundByteAuthority: 'canonical' | 'transport-prebounded' = 'canonical',
) => {
  if (options.store && options.storeOptions) throw createStyleToolError('INVALID_INPUT', 'Choose store or storeOptions.');
  const messagePolicy = preResolvedPolicy
    ?? deps.resolveMessagePolicy({ maxMessageBytes: options.maxMessageBytes });
  const responseBoundary = deps.responseBoundaryFactory(messagePolicy);
  const ownsStore = !options.store;
  const store = assertFactoryStyleSessionStore(
    options.store ?? deps.storeFactory(options.storeOptions),
  );
  const admissionRegistry = deps.resourceAdmissionRegistryFactory();
  const server = deps.serverFactory({ name: 'maplibre-style-mcp-server', version: MCP_SERVER_VERSION });
  // Capture the sole SDK sinks, then seal every public high/low capability before extensions run.
  const sdkProtocolConnect = server.server.connect.bind(server.server);
  const sdkProtocolClose = server.server.close.bind(server.server);
  const lifecycle = createServerLifecycle({
    sdkProtocolConnect,
    sdkProtocolClose,
    disposeOwnedStore: ownsStore ? () => store.dispose() : undefined,
    makeBoundedTransport: (rawTransport, inboundContext, onTerminal) =>
      createBoundedMcpTransport(rawTransport, messagePolicy, inboundContext, onTerminal),
  });
  const connect = lifecycle.connect;
  const close = lifecycle.close;
  sealServerCapabilities(server, { connect, close }); // patches server and server.server immutably
  const extensionContext = createExtensionContext(
    messagePolicy,
    responseBoundary,
    (admission) => admissionRegistry.register(admission),
  );
  const extension = createMcpServerExtension({
    handlers: deps.handlerFactory(store, responseBoundary),
    resources: deps.resourceFactory(store, responseBoundary),
  });
  try {
    for (const applyExtension of [extension, ...(options.extensions ?? [])]) {
      const returned: unknown = applyExtension(server, extensionContext);
      if (returned !== undefined) throw rejectAsyncOrInvalidExtension(returned);
    }
    const inboundContext = createInboundMcpFramingContext({
      admissions: admissionRegistry.freeze(),
      totalBytesAlreadyBounded: inboundByteAuthority === 'transport-prebounded',
    });
    lifecycle.finishComposition(inboundContext);
    const created = { server, store, messagePolicy, connect, close };
    createdMcpInboundCapabilities.set(created, {
      messagePolicy,
      inboundContext,
      // This closes over factory lifecycle only; it never reads a handle property.
      isLive: () => lifecycle.state === 'new'
        || lifecycle.state === 'connecting'
        || lifecycle.state === 'connected',
    });
    return created;
  } catch (error: unknown) {
    admissionRegistry.abort(); // every late register now fails deterministically
    lifecycle.abortComposition(error); // consumes protocol-close cleanup; disposes only an owned store
    throw error;
  }
};

export const createMapLibreStyleMcpServer = (
  options: CreateMapLibreStyleMcpServerOptions = {},
) => createMapLibreStyleMcpServerWithDependencies(options, defaultServerCompositionDependencies);
```

The public function delegates to a Node-internal `createMapLibreStyleMcpServerWithDependencies(options, compositionDependencies, preResolvedPolicy?, inboundByteAuthority?)` used to record composition and let stdio/HTTP inject the one runner-resolved policy. Public factory calls always use canonical inbound-byte mode; only the bounded stdio/HTTP runners may pass `'transport-prebounded'` after installing their exact raw readers, so an ordinary embedder cannot falsely bypass total-message checks. Production dependencies supply the exact SDK `McpServer` constructor and real factories. Resolve the message policy exactly once (or accept the runner's already-resolved object), build exactly one response boundary, resolve mutually-exclusive store options, then call `assertFactoryStyleSessionStore` **before** invoking the server factory, handler factory, resource factory, user extension, or any registration. An injected plain structural object—even one cast through `unknown`—therefore fails startup synchronously with the stable provenance-authentic `INVALID_INPUT/details.reason:'invalidStyleSessionStore'`, invokes none of its methods, and cannot allocate a transport, server handler, or application session. There is no fallback `read` path and no attempt to retrofit a brand. A store returned by either public/internal Task 5 factory is accepted by exact identity; injected stores remain caller-owned, while the internally created branded store retains the existing owned-close behavior.

Freeze one `McpServerExtensionContext` and pass that exact object to the built-in extension and every caller/live-bridge extension. Its `registerResourceUriAdmission` is bound to the one factory registry and works only during composition. The built-in extension first registers `{scheme:'maplibre-style',authority:'sessions'}`; a live extension may register `{scheme:'maplibre-style',authority:'maps'}` in the same registry. Complete all registrations, reject duplicate namespaces, then freeze the registry once before enabling connect. A captured late registration function fails stably, and a connect attempted from inside an extension is rejected/closed as `serverCompositionInProgress` rather than observing a partial table. The decorator, stdio/HTTP preflight, document routes, and live routes all consume that same frozen registry identity. Test both namespaces together: canonical document and live URIs pass, aliases/unknown namespaces are rejected, and neither resolver handles the other's namespace.

The context's variadic `guardResourceHandler` forwards the official ResourceTemplate callback's `uri`, `variables`, and `extra` references in order exactly once, awaits the handler, applies `responseBoundary.requireResourceResult` as a final defense, and catches only provenance-authentic core errors into `responseBoundary.requireResourceFailure`; unknown thrown values become the fixed redacted internal `McpError`. A stateful resource extension must still call `requireResourceResult` inside its own atomic projection before touch/commit, just like the built-in resolver—the registration guard cannot roll state back—but no extension can bypass the final transport decorator. Tool extensions likewise use the same `responseBoundary.requireToolSuccess/Failure`, never construct a private default. Export `ResourceUriAdmission` plus the context/extension types through `./mcp` so the later bridge consumes this exact signature. The returned `messagePolicy` is the same readonly identity runners use for inbound framing and the final bounded transport.

Type `McpServerExtension` as returning exactly `undefined`, and make every built-in/user example explicitly return `undefined`; an `async` function is therefore rejected by strict TypeScript, with a compile-only `@ts-expect-error` contract test. Runtime still treats every extension as untrusted JavaScript: capture its result as `unknown`, and if it is non-`undefined`, inspect/consume a Promise/thenable settlement under a guarded fixed-error path, abort (do not freeze) the admission registry, close the unconnected protocol server, dispose only an owned store, and synchronously throw `INVALID_INPUT/details.reason:'asyncMcpExtension'`. A hostile `then` accessor or rejected Promise must not leak its value or cause an unhandled rejection. Async code that registered before its first await is rolled back with the aborted composition; code that resumes after abort can only hit the rejected registry and its Promise rejection is already observed. Test registration before/after await, async rejection, non-thenable invalid return, and caller-owned versus owned-store cleanup. Composition remains synchronous; do not make runners await partially registered extensions.

SDK 1.30 `McpServer.connect()` merely delegates to the publicly reachable low-level `McpServer.server.connect()`, and both high/low close spellings are public. Immediately after `serverFactory` returns—and **before** creating handlers/resources or invoking any extension—capture only `server.server.connect.bind(server.server)` and `server.server.close.bind(server.server)` as the private SDK sinks. Immutably replace `server.connect`, `server.server.connect`, `server.close`, and `server.server.close` with the same factory `connect`/`close` capabilities. The bounded connect invokes the captured **low-level** connect directly exactly once, so it neither recurses through a patched method nor double-wraps. Thus `created.connect`, both public SDK connect spellings, and high/low methods captured during extension registration all install the same one decorator; no public raw sink remains. Likewise every close spelling enters the same factory gate, so an owned store cannot be bypassed and a caller-owned store is never disposed. Do not export either captured sink or the Node-internal decorator.

Implement the factory lifecycle as `composing → new → connecting → connected → closing → closed`, with one latched connect and one idempotent close promise. Before starting a raw transport, connect requires a frozen admission table. Close-before-connect permanently transitions closed; a later connect closes its supplied unowned raw transport once without starting it and rejects `INVALID_INPUT/details.reason:'serverClosed'`. If close races a connecting SDK call, transfer bounded/raw ownership before invoking the captured sink, close only through the protocol/decorator owner, consume the losing connect work, and never resolve a live handle after closing won. Connect failure before/after raw start all-settles bounded plus factory close while preserving the original error; default terminal cleanup uses the same close promise and consumes cleanup rejection. A spontaneous raw close marks the decorator close latch before this gate, avoiding a second raw close. Registration/composition failure consumes the unconnected protocol close and disposes only an owned store without an unhandled rejection. Add recording tests for all three connect and all three close spellings, extension-time high/low capture, close-before-connect, close-during-connect, connect failure after start, rejecting default cleanup, repeat/concurrent calls, one start/close delegation, callback/listener restoration, raw-send failure, and final-message fallback.

After successful composition, register the **exact returned live created-handle identity** in a module-private `WeakMap` capability containing the same resolved `messagePolicy`, frozen `InboundMcpFramingContext`, and a lifecycle predicate which closes only over factory state and never reads a handle property. That predicate is live only in `new`, `connecting`, or `connected`; it is false in `closing` and `closed`. Node-internal `preflightCreatedMcpInbound(created, parsedMessage)` requires that exact identity, requires the capability to be live, and invokes `assertInboundMcpFraming` with those same policy/context objects later captured by its decorator. A primitive, clone, wrapper, structural fake, foreign server/handle, aborted handle, or closed/stale handle always fails with factory-authentic `INVALID_INPUT/details.reason:'invalidMcpServerHandle'`. Do not re-export this helper from `./mcp`. HTTP imports it from `create-server.ts` only after a read-only session-pair lookup, before raw `handleRequest`; it does not invoke a handler/store or mutate lifecycle state. Test policy/context identity, canonical document/live namespaces, alias rejection with zero protocol calls, each invalid-handle shape, and closed-handle rejection.

Use SDK 1.30 v1 registration signatures exactly: `server.registerTool(name, config, handler)` and `server.registerResource(name, new ResourceTemplate(pattern, { list: undefined }), config, context.guardResourceHandler(handler))`. Register every tool through an explicitly keyed metadata table; each `config` must have a human-readable `title`, a narrow one-sentence `description` of only that command, the complete root `inputSchema: documentToolInputSchemas[name]`, and all four annotation hints. Pass the complete schema object, never `.shape`, so SDK validation invokes its refinements. Do not pass `outputSchema`: the stable structured result is a root success/failure union, and SDK 1.30's object normalization cannot truthfully advertise that union. Consumers narrow successful `data` with `documentToolResponseDataSchemas` after parsing the general envelope.

Lock this complete metadata table in the recording fake and official `listTools` response:

| Tool | Title | Narrow description | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
|---|---|---|---:|---:|---:|---:|
| `style_session_open` | Open style session | Open one bounded in-memory session from inline Style JSON. | false | false | false | false |
| `style_session_close` | Close style session | Close one in-memory style session. | false | true | true | false |
| `style_validate` | Validate style | Validate inline Style JSON or one open session snapshot. | true | false | true | false |
| `style_inspect` | Inspect style | Read one context, layer, source, or source-layer view from a session. | true | false | true | false |
| `style_search_layers` | Search style layers | Search layer summaries in one session without mutation. | true | false | true | false |
| `style_analyze_geojson` | Analyze GeoJSON | Analyze inline GeoJSON or one session GeoJSON source. | true | false | true | false |
| `style_apply_transaction` | Apply style transaction | Dry-run or commit one revision-checked `{operations:[...]}` transaction whose shape and limits core validates. | false | true | false | false |
| `style_export` | Export style snapshot | Export the current or one retained revision of a session. | true | false | true | false |

`style_apply_transaction` is destructive at the tool level even though an individual call may use `dryRun`; `style_session_close` is effect-idempotent even though a repeat reports not found. Create a fresh `ResourceTemplate` per URI pattern using the required `{ list: undefined }` callback contract and test that both recording fakes and the official Client see the exact eight/six registrations. Each resource config has a narrow title/description and states that the template already contains its literal `~` marker, so clients pass raw semantic variable values. The server implementation metadata name is exactly `maplibre-style-mcp-server`; the executable remains `maplibre-style-mcp`. Its version is the generated `MCP_SERVER_VERSION`, never an undefined or separately typed `packageVersion`.

An injected store is shared and caller-owned, so closing one per-transport server must not dispose it. For an internally owned store, an idempotent close gate must await `server.close()` first and dispose the store in `finally`; this prevents store teardown while an SDK close callback is still settling yet guarantees cleanup if SDK close rejects. Factor that two-callback lifecycle primitive as an internal module export for direct fake testing, but do not re-export it from `./mcp` or add a production introspection registry. Test success, rejection, and repeat-close order. This ownership rule is required by HTTP and the later live bridge.

- [ ] **Step 4: Run registration, module import, and type tests (3 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --test --test-name-pattern="extension registers|one resolved response policy|synchronous and runtime rejects thenables|internal HTTP preflight|already-bounded high and low|all public connect|all close spellings|close-before-connect|bounded connect failure|bounded resource registration|import-time|structural store|branded factory-created|owned store" .tmp/test-dist/mcp/server-extension.test.js .tmp/test-dist/mcp/create-server.test.js
rtk pnpm run typecheck
```

Expected: PASS; `McpServerExtension` can be reused with one shared immutable response context, built-in/live handlers cannot silently choose another default, factory-created injected stores retain their capability/ownership, bounded resource errors preserve stable reasons without secrets, and structural fakes fail before any composition side effect.

- [ ] **Step 5: Commit server composition seam (2 minutes).**

```bash
rtk git add src/mcp/server-extension.ts src/mcp/server-extension.test.ts src/mcp/create-server.ts src/mcp/create-server.test.ts src/mcp/main.ts
rtk git commit -m "feat: compose MCP server through bounded extension context"
```

### Task 10: Prove official Client and InMemoryTransport integration

**Files:**
- Create: `src/mcp/integration.test.ts`
- Modify: `src/mcp/create-server.ts`
- Modify: `src/mcp/document-handlers.ts`
- Modify: `src/mcp/resources.ts`
- Modify: `src/mcp/server-extension.ts`

**Interfaces:**
- Consumes: `Client`, `InMemoryTransport.createLinkedPair()`, `createMapLibreStyleMcpServer`, the same-identity internal session-store observer seam, `MCP_SERVER_VERSION`, `documentToolResponseDataSchemas`, official MCP tool calls, and resource reads.
- Produces: an end-to-end proof that the public server advertises `maplibre-style-mcp-server` at the package-derived version, accepts an official client, exposes all exact capabilities/metadata, distinguishes SDK schema rejection from executed business envelopes, preserves envelope parity, and resolves resources through the linked transports.

- [ ] **Step 1: Write a failing SDK integration test (5 minutes).**

```ts
test('official Client uses linked InMemoryTransport to open, apply, and read a session', async (t) => {
  const client = new Client({ name: 'maplibre-style-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const resourceLookupSentinel = { value: 0 };
  const store = createStyleSessionStoreWithDependencies(
    { idFactory: () => 's1' },
    undefined,
    { observer: {
      onProjectionAttempt: () => { resourceLookupSentinel.value += 1; },
      onRevisionReadAttempt: () => { resourceLookupSentinel.value += 1; },
    } },
  );
  assert.strictEqual(assertFactoryStyleSessionStore(store), store);
  const created = createMapLibreStyleMcpServer({ store });
  t.after(async () => {
    await Promise.allSettled([client.close(), created.close()]);
    store.dispose();
  });
  await Promise.all([created.connect(serverTransport), client.connect(clientTransport)]);
  assert.deepEqual(client.getServerVersion(), { name: 'maplibre-style-mcp-server', version: MCP_SERVER_VERSION });
  const opened = parseOfficialCallToolResult(await client.callTool({ name: 'style_session_open', arguments: { style: validStyle } }));
  const applied = parseOfficialCallToolResult(await client.callTool({ name: 'style_apply_transaction', arguments: { sessionId: 's1', expectedRevision: 0, transaction: changeRoads } }));
  const resource = await client.readResource({ uri: makeDiffUri('s1', 1).href });
  const openedData = parseDocumentToolSuccessData('style_session_open', opened.structuredContent);
  const appliedData = parseDocumentToolSuccessData('style_apply_transaction', applied.structuredContent);
  assert.equal(openedData.sessionId, 's1');
  assert.equal(appliedData.revision, 1);
  const first = resource.contents[0];
  assert.ok(first && 'text' in first);
  if (!first || !('text' in first)) assert.fail('expected text resource');
  assert.ok(first.text.includes('line-color'));
  const readsBeforeAlias = resourceLookupSentinel.value;
  for (const uri of [
    'maplibre-style://sessions/s1/revisions/1/diff',
    'maplibre-style://sessions/../~s1/style',
    'maplibre-style://sessions/%2e%2e/~s1/style',
    'maplibre-style://sessions/~s1/layers/../~roads',
    'maplibre-style://sessions/~s1/layers/%2E/~roads',
    'maplibre-style://sessions/%2573%2531/style',
  ]) await assert.rejects(() => client.readResource({ uri }));
  assert.equal(resourceLookupSentinel.value, readsBeforeAlias);
  const stillUsable = parseOfficialCallToolResult(await client.callTool({
    name: 'style_export', arguments: { sessionId: 's1' },
  }));
  assert.equal(parseDocumentToolSuccessData('style_export', stillUsable.structuredContent).revision, 1);
});

test('official Client composes document and same-scheme live resource admissions', async (t) => {
  const calls = { document: 0, live: 0 };
  const liveExtension: McpServerExtension = (server, context) => {
    context.registerResourceUriAdmission(testLiveMapsAdmission(calls));
    server.registerResource(
      'test-live-map',
      new ResourceTemplate('maplibre-style://maps/~{mapId}', { list: undefined }),
      { title: 'Test live map', description: 'Read one deterministic test live map.' },
      context.guardResourceHandler(async () => {
        calls.live += 1;
        return smallLiveResourceResult;
      }),
    );
    return undefined;
  };
  const { client } = await connectOfficialClient(t, {
    extensions: [liveExtension],
    storeObserver: { onProjectionAttempt: () => { calls.document += 1; } },
  });
  await openStyle(client, validStyle);
  await client.readResource({ uri: makeStyleUri('s1').href });
  await client.readResource({ uri: 'maplibre-style://maps/~map-1' });
  assert.deepEqual(calls, { document: 1, live: 1 });
  for (const alias of [
    'maplibre-style://maps/../~map-1',
    'maplibre-style://maps/%2e/~map-1',
    'maplibre-style://unknown/~map-1',
  ]) await assert.rejects(() => client.readResource({ uri: alias }));
  assert.deepEqual(calls, { document: 1, live: 1 });
  const listed = await client.listResourceTemplates();
  assert.ok(listed.resourceTemplates.some((entry) => entry.uriTemplate === 'maplibre-style://maps/~{mapId}'));
});

test('official Client keeps SDK input rejection separate from business failures', async (t) => {
  const { client, created } = await connectOfficialClient(t);
  const invalid = parseOfficialCallToolResult(await client.callTool({
    name: 'style_validate',
    arguments: { target: { kind: 'inline', style: validStyle, sessionId: 'forbidden' } },
  }));
  assert.equal(invalid.isError, true);
  assert.equal(invalid.structuredContent, undefined); // SDK rejected before the guarded callback

  const missing = parseOfficialCallToolResult(await client.callTool({ name: 'style_export', arguments: { sessionId: 'missing' } }));
  assert.equal(parseFailure(missing).error.code, 'NOT_FOUND');

  parseOfficialCallToolResult(await client.callTool({ name: 'style_session_open', arguments: { style: validStyle } }));
  parseOfficialCallToolResult(await client.callTool({ name: 'style_apply_transaction', arguments: { sessionId: 's1', expectedRevision: 0, transaction: changeRoads } }));
  const stale = parseOfficialCallToolResult(await client.callTool({ name: 'style_apply_transaction', arguments: { sessionId: 's1', expectedRevision: 0, transaction: changeRoads } }));
  assert.equal(parseFailure(stale).error.code, 'REVISION_CONFLICT');
  assert.equal((await created.store.read('s1')).revision, 1);
});

test('official Client preserves operator-raised and lowered operation limits', async (t) => {
  const raised = await connectOfficialClient(t, { storeOptions: { limits: { maxOperations: 101 } } });
  parseOfficialCallToolResult(await raised.client.callTool({ name: 'style_session_open', arguments: { style: validStyle } }));
  const accepted = parseOfficialCallToolResult(await raised.client.callTool({
    name: 'style_apply_transaction',
    arguments: { sessionId: 's1', expectedRevision: 0, transaction: transactionWithOperations(101) },
  }));
  assert.equal(parseDocumentToolSuccessData('style_apply_transaction', accepted.structuredContent).revision, 1);

  const lowered = await connectOfficialClient(t, { storeOptions: { limits: { maxOperations: 1 } } });
  parseOfficialCallToolResult(await lowered.client.callTool({ name: 'style_session_open', arguments: { style: validStyle } }));
  const rejected = parseOfficialCallToolResult(await lowered.client.callTool({
    name: 'style_apply_transaction',
    arguments: { sessionId: 's1', expectedRevision: 0, transaction: transactionWithOperations(2) },
  }));
  assert.equal(parseFailure(rejected).error.code, 'INVALID_INPUT');
  assert.equal((await lowered.created.store.read('s1')).revision, 0);
});

test('official Client lets core return the canonical malformed-transaction envelope', async (t) => {
  const { client, created, transactionCoreCalls } = await connectOfficialClientWithCoreSpy(t);
  parseOfficialCallToolResult(await client.callTool({
    name: 'style_session_open', arguments: { style: validStyle },
  }));
  const malformed = parseOfficialCallToolResult(await client.callTool({
    name: 'style_apply_transaction',
    arguments: { sessionId: 's1', expectedRevision: 0, transaction: { operations: 'wrong' } },
  }));
  assert.equal(parseFailure(malformed).error.code, 'INVALID_INPUT');
  assert.equal(transactionCoreCalls.value, 1);
  assert.equal((await created.store.read('s1')).revision, 0);
});

test('official Client sees bounded oversized tool and resource failures without idle refresh', async (t) => {
  const clock = createFakeClock();
  const fixture = makeStyleWhoseRequestFitsButDuplicatedExportDoesNot(MIN_MCP_MESSAGE_BYTES);
  const store = createStyleSessionStore({ clock, limits: { ttlMs: 100 }, idFactory: () => 's1' });
  const connected = await connectOfficialClient(t, {
    store,
    maxMessageBytes: MIN_MCP_MESSAGE_BYTES,
    recordServerMessages: true,
  });
  parseOfficialCallToolResult(await connected.client.callTool({
    name: 'style_session_open', arguments: { style: fixture.style },
  }));
  clock.value = 99;
  const exported = parseOfficialCallToolResult(await connected.client.callTool({
    name: 'style_export', arguments: { sessionId: 's1' },
  }));
  assert.equal(parseFailure(exported).error.details?.reason, 'responseTooLarge');
  await assert.rejects(
    () => connected.client.readResource({ uri: makeStyleUri('s1').href }),
    (error) => parseOfficialMcpError(error).data.details.reason === 'responseTooLarge',
  );
  assert.ok(connected.serverMessages.every((message) => utf8JsonBytes(message) <= MIN_MCP_MESSAGE_BYTES));
  assert.equal(connected.projectionCalls.value, 2);
  clock.value = 101;
  await assert.rejects(() => store.read('s1'), { code: 'NOT_FOUND', details: { reason: 'expired' } });
});

test('official Client message lower and raise share application and final transport policy', async (t) => {
  const fixture = makeResultBetweenMessageLimits(256 * 1024, 512 * 1024);
  const lower = await connectOfficialClient(t, { maxMessageBytes: 256 * 1024 });
  const raised = await connectOfficialClient(t, { maxMessageBytes: 512 * 1024 });
  assert.strictEqual(lower.extensionContext.messagePolicy, lower.created.messagePolicy);
  assert.strictEqual(raised.extensionContext.messagePolicy, raised.created.messagePolicy);
  const lowerResult = await openAndExport(lower.client, fixture.style);
  const raisedResult = await openAndExport(raised.client, fixture.style);
  assert.equal(parseFailure(lowerResult).error.details?.reason, 'responseTooLarge');
  assert.equal(parseDocumentToolSuccessData('style_export', raisedResult.structuredContent).revision, 0);
  assert.ok(lower.serverMessages.every((message) => utf8JsonBytes(message) <= 256 * 1024));
  assert.ok(raised.serverMessages.every((message) => utf8JsonBytes(message) <= 512 * 1024));
});

test('official oversized apply failure runs core once and does not commit', async (t) => {
  const calls = { value: 0 };
  const store = createStyleSessionStoreWithDependencies({}, coreReturningLargeApplyResult(calls));
  const { client, created } = await connectOfficialClient(t, {
    store, maxMessageBytes: MIN_MCP_MESSAGE_BYTES,
  });
  parseOfficialCallToolResult(await client.callTool({ name: 'style_session_open', arguments: { style: validStyle } }));
  const result = parseOfficialCallToolResult(await client.callTool({
    name: 'style_apply_transaction',
    arguments: { sessionId: 's1', expectedRevision: 0, transaction: changeRoads },
  }));
  assert.equal(parseFailure(result).error.details?.reason, 'responseTooLarge');
  assert.equal(calls.value, 1);
  assert.equal((await created.store.read('s1')).revision, 0);
});
```

- [ ] **Step 2: Run the integration test and verify it fails before connection wiring is complete (2 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="official Client uses linked|same-scheme live resource admissions|canonical malformed-transaction|bounded oversized tool|message lower and raise|oversized apply failure"
```

Expected: FAIL at connection, tool registration, or resource dispatch until all v1 SDK adapters are implemented.

- [ ] **Step 3: Correct registration adapters to match official v1 SDK signatures (5 minutes).**

```ts
const client = new Client({ name: 'maplibre-style-mcp-test', version: '1.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await created.connect(serverTransport);
await client.connect(clientTransport);
```

Use only public `Client` calls and public `InMemoryTransport` factory methods; do not inspect private server maps in this integration test. Assert all eight `listTools()` entries expose the exact titles, descriptions, complete non-empty input JSON schemas, and four annotation flags from Task 9; assert all six resource templates. For `style_validate.target`, `style_analyze_geojson.target`, and `style_inspect.selection`, traverse the advertised JSON schema and require the nested `anyOf`/`oneOf`, discriminant constants, and variant-specific `required` arrays; also require root `additionalProperties:false`. Feed one sample from every advertised variant through `callTool` and prove it reaches the guarded handler, while an unknown root key and an illegal cross-variant key receive SDK validation errors before the sentinel. Lock `client.getServerVersion()` to `{name:'maplibre-style-mcp-server', version:MCP_SERVER_VERSION}`.

Read canonical resource URIs through the official client, not only by calling the resolver directly. Cover the exported helpers for a style, a layer whose legal MapLibre ID is `.`, a source whose ID is `..`, and a revision diff; all must round-trip. Then send raw unmarked, literal/encoded dot-segment, normalization-changing, and legacy double-encoded aliases through `Client.readResource`; assert the admission response rejects before SDK URL construction and before the store observer/resolver runs, then issue a valid export/read on the same connection. The direct admission/resolver tests lock the underlying `INVALID_INPUT/details.reason:'nonCanonicalResourceUri'` identity. Implement the sentinel only with Task 5's read-only observer on the exact factory-returned store, and assert `assertFactoryStyleSessionStore(store) === store` before injection; do not proxy/wrap the store, replace its identity, or expose a mutable callback. Manually expand every listed `ResourceTemplate` with raw semantic IDs (never pre-marked/pre-encoded values) and prove the expanded URI equals the corresponding helper output and reads the same resource without double-encoding `%` or `/`.

Also compose a deterministic test extension that registers `{scheme:'maplibre-style',authority:'maps'}` plus one ResourceTemplate while the document extension owns `{scheme:'maplibre-style',authority:'sessions'}`. Through the same official Client, read one canonical URI from each namespace; aliases and an unknown authority must hit neither resolver, while `listResourceTemplates` still advertises both. This proves the frozen registry multiplexes same-scheme authorities rather than rejecting the later live extension or using a single permissive scheme fallback.

SDK `structuredContent` is optional/unknown-shaped and resource contents are a text/blob union, so parse a successful tool result through `parseDocumentToolSuccessData(name, structuredContent)` and narrow `content.type === 'text'` before dereferencing resource text. Do not use unchecked property access. A request rejected by SDK input-schema validation must have `isError:true`, must not invoke a handler/store sentinel, and is not required to contain the business envelope. In contrast, valid-schema missing-session and stale-revision calls entered the handler and must have the exact stable `NOT_FOUND`/`REVISION_CONFLICT` envelope with text parity.

Through official clients, prove a 101-operation transaction reaches and succeeds in a store configured for 101, while a two-operation transaction reaches a store configured for one and returns the stable core `INVALID_INPUT` envelope without advancing revision. Also send a malformed transaction whose outer tool input is valid and prove it reaches core exactly once, returns core's canonical stable envelope, and is not rejected or transformed by SDK/handler transaction parsing. This locks the distinction between strict outer transport fields and the sole core transaction shape/domain-policy boundary.

Every `connectOfficialClient` path calls the factory's bounded `created.connect`, captures the exact messages delivered to the raw server-side `InMemoryTransport`, and asserts their serialized UTF-8 size. Calibrate a Style whose open request fits the lower policy but whose real export tool result exceeds it because text and structured content duplicate/escape the Style. Through the official Client, require the stable redacted tool failure and bounded resource `McpError`, then prove current/retained projections ran once and did not refresh TTL. With one result between 256 and 512 KiB, prove a factory configured to 256 KiB rejects while 512 KiB succeeds, and assert each extension saw the same policy object returned by its factory. Use a core spy returning a large apply result to prove official over-budget apply invokes core once and leaves revision/history unchanged. Caller-owned observed stores are disposed explicitly after `created.close()` in test cleanup; helpers never proxy them.

- [ ] **Step 4: Run integration plus direct unit suites (4 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="official Client uses linked|same-scheme live resource admissions|SDK input rejection|operator-raised and lowered|canonical malformed-transaction|bounded oversized tool|message lower and raise|oversized apply failure|required tool set|resource URI"
rtk pnpm run typecheck
```

Expected: PASS; metadata/version, SDK schema rejection, stable/size-bounded business failures, single-policy lower/raise behavior, atomic no-touch/no-commit behavior, and tool/resource behavior all travel through the official bounded transport rather than a test-only shortcut.

- [ ] **Step 5: Commit official SDK integration coverage (2 minutes).**

```bash
rtk git add src/mcp/integration.test.ts src/mcp/create-server.ts src/mcp/document-handlers.ts src/mcp/resources.ts src/mcp/server-extension.ts
rtk git commit -m "test: cover bounded MCP server with official in-memory client"
```

### Task 11: Add clean stdio entry-point behavior

**Files:**
- Create: `src/mcp/stdio.ts`
- Create: `src/mcp/stdio.test.ts`
- Modify: `src/mcp/main.ts`
- Modify: `src/mcp/main.test.ts`

**Interfaces:**
- Consumes: `createMapLibreStyleMcpServer`, its one returned resolved `messagePolicy`, `assertInboundMcpFraming`, Node byte streams/`Transform`/`Writable`, v1 `StdioServerTransport`, explicit `process.argv`, and non-barrel server/transport/stdout/stderr dependency injection for lifecycle tests.
- Produces: `runStdioMcp(options): Promise<StartedStdioMcp>` where options include `startupDiagnosticLine?: string | null` and `serverOptions.maxMessageBytes`; `StartedStdioMcp` exposes the factory's same readonly `messagePolicy`, `closed: Promise<void>`, and idempotent `close(): Promise<void>`; owned bounded-input and transparent guarded-output handles feed the raw SDK transport while the factory-owned decorator gates parsed inbound/final outbound messages; Node-internal `writeMcpStderrLine(stderr, line): Promise<void>` serves this runner and the later bridge, plus executable `maplibre-style-mcp`; `--help` is non-connecting, errors go to stderr, and stdout starts with protocol framing when connected.

- [ ] **Step 1: Write failing subprocess behavior tests (5 minutes).**

```ts
test('help exits without writing to stdout', async () => {
  const result = await spawnBinary('--help');
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /maplibre-style-mcp/);
});

test('stdio protocol output starts at byte zero', async () => {
  const child = spawnBinary();
  try {
    child.stdin.write(initializedRequest);
    const first = await readFirstStdoutChunk(child.stdout);
    assert.match(first, /^(Content-Length:|[\[{])/);
    assert.doesNotMatch(first, /listening|connected|maplibre-style-mcp/i);
  } finally {
    child.stdin.end();
    await terminateChild(child);
  }
});

test('stdio rejects a frame above the shared MCP byte limit', async () => {
  const child = spawnBinary();
  try {
    await initialize(child);
    child.stdin.write(makeOversizedJsonRpcFrame(MAX_MCP_MESSAGE_BYTES + 1));
    const outcome = await readProtocolErrorOrClose(child);
    assert.equal(outcome.handlerSentinelCalls, 0);
  } finally {
    child.stdin.end();
    await terminateChild(child);
  }
});

test('bounded stdio framing accepts exact, batched, and split legal payloads', async () => {
  await assertAccepted(makeJsonPayload(MAX_MCP_MESSAGE_BYTES));
  await assertAccepted(makeRawExponentPayload(MAX_MCP_MESSAGE_BYTES));
  await assertAccepted(Buffer.concat([smallRequestOne, LF, smallRequestTwo, LF]));
  await assertAcceptedInChunks(splitAcrossUtf8AndDelimiter(smallRequestOne));
  await assertRejected(makeJsonPayload(MAX_MCP_MESSAGE_BYTES + 1), { handlerCalls: 0 });
  await assertRejected(Buffer.from('{"jsonrpc":"2.0"'), { endWithoutLf: true, handlerCalls: 0 });
});

test('stdio uses the factory policy for explicit lower and raised input bounds', async () => {
  for (const maxMessageBytes of [256 * 1024, 8 * 1024 * 1024]) {
    const deps = startupDependencies();
    const started = await runStdioMcp({ serverOptions: { maxMessageBytes } }, deps);
    assert.strictEqual(deps.extensionContext.messagePolicy, started.messagePolicy);
    assert.equal(deps.input.maxPayloadBytes, maxMessageBytes);
    assert.equal(deps.transport.maxBufferSize, maxMessageBytes + 1);
    await sendJsonPayloadOfExactBytes(deps.stdin, maxMessageBytes);
    await assertHandlerCalledOnce(deps);
    await sendJsonPayloadOfExactBytes(deps.stdin, maxMessageBytes + 1);
    await started.closed;
    assert.equal(deps.handlerCallsAfterOversize, 0);
  }
});

test('stdio rejects an unsafe request id before protocol dispatch', async () => {
  const deps = startupDependencies();
  const inputBefore = inputListenerSnapshot(deps.stdin);
  const outputBefore = stdoutListenerSnapshot(deps.stdout);
  const started = await runStdioMcp({}, deps);
  deps.stdin.write(ndjson(requestWithSerializedIdBytes(MAX_MCP_REQUEST_ID_BYTES + 1)));
  await started.closed;
  assert.equal(deps.protocolHandlerCalls, 0);
  assert.equal(deps.transport.closeCalls, 1);
  assert.equal(deps.server.closeCalls, 1);
  assert.equal(deps.input.unpipeCalls, 1);
  assertInputListenerSnapshot(deps.stdin, inputBefore);
  assertStdoutListenerSnapshot(deps.stdout, outputBefore);
});

test('stdio transfers one raw transport owner and closes it exactly once', async () => {
  for (const scenario of [
    transportConstructorFailureBeforeAcquisition,
    terminalBeforeConnectTransfer,
    connectFailureAfterRawStart,
    diagnosticFailureAfterConnectTransfer,
    explicitCloseAfterStart,
    decoratorTerminalAfterStart,
    stdoutEpipeAfterStart,
  ]) {
    const result = await runOwnershipScenario(scenario);
    assert.equal(result.rawTransportCloseCalls, scenario.constructed ? 1 : 0);
    assert.equal(result.decoratorCloseCalls, scenario.transferred ? 1 : 0);
    assert.equal(result.rawAndDecoratorClosedInParallel, false);
    assert.equal(result.inputDisposeCalls, 1);
    assert.equal(result.outputDisposeCalls, 1);
  }
});

test('real stdio tool and resource responses never exceed the resolved message limit', async (t) => {
  const child = spawnBinary();
  const client = await connectOfficialStdioClient(child);
  t.after(async () => { await Promise.allSettled([client.close(), terminateChild(child)]); });
  const fixture = makeStyleWhoseRequestFitsButDuplicatedExportDoesNot(MAX_MCP_MESSAGE_BYTES);
  await openStyle(client, fixture.style);
  const exported = parseOfficialCallToolResult(await client.callTool({
    name: 'style_export', arguments: { sessionId: fixture.sessionId },
  }));
  assert.equal(parseFailure(exported).error.details?.reason, 'responseTooLarge');
  await assert.rejects(
    () => client.readResource({ uri: makeStyleUri(fixture.sessionId).href }),
    (error) => parseOfficialMcpError(error).data.details.reason === 'responseTooLarge',
  );
  assert.ok(child.capturedJsonRpcMessages.every((message) => utf8JsonBytes(message) <= MAX_MCP_MESSAGE_BYTES));
});

test('stdio startup failure closes partially acquired transport and server state', async () => {
  const before = activeHandleNames();
  const listeners = inputListenerSnapshot(failingConnectDependencies.stdin);
  await assert.rejects(() => runStdioMcp({}, failingConnectDependencies));
  assert.equal(failingConnectDependencies.transport.closeCalls, 1);
  assertInputListenerSnapshot(failingConnectDependencies.stdin, listeners);
  assert.deepEqual(activeHandleNames(), before);
});

test('every stdio terminal path owns and releases bounded input and guarded output', async () => {
  for (const scenario of [normalClose, cleanEof, oversizedFrame, invalidUtf8, unterminatedEof]) {
    const source = createObservedInput();
    const output = createObservedOutput();
    const before = inputListenerSnapshot(source);
    const outputBefore = stdoutListenerSnapshot(output);
    const started = await startScenario(source, output, scenario);
    await scenario.terminate(source, started);
    await started.closed;
    assert.equal(started.handlerSentinelCalls, scenario.expectedHandlerCalls);
    assert.equal(source.unpipeCalls, 1);
    assertInputListenerSnapshot(source, before);
    assert.equal(output.destroyCalls, 0);
    assert.equal(output.endCalls, 0);
    assertStdoutListenerSnapshot(output, outputBefore);
  }
});

test('stderr line writes absorb every EPIPE reporting shape and release listeners', async () => {
  for (const stderr of [syncThrowStream(), asyncCallbackEpipe(), errorEventEpipe(), callbackThenEventEpipe(), eventThenCallbackEpipe(), alreadyClosedStream()]) {
    const before = stderrListenerSnapshot(stderr);
    await assert.rejects(() => writeMcpStderrLine(stderr, 'maplibre-style-mcp: ready'));
    assert.equal(stderr.uncaughtErrors.length, 0);
    assertStderrListenerSnapshot(stderr, before);
  }
  const writable = successfulBackpressuredStream();
  await writeMcpStderrLine(writable, 'one line');
  assert.deepEqual(writable.chunks, ['one line\n']);
});

test('asynchronous stderr EPIPE aborts startup and closes every acquired owner', async () => {
  const deps = startupDependencies({ stderr: asyncCallbackAndEventEpipe() });
  await assert.rejects(() => runStdioMcp({}, deps), { code: 'EPIPE' });
  assert.equal(deps.transport.closeCalls, 1);
  assert.equal(deps.server.closeCalls, 1);
  assert.equal(deps.store.disposeCalls, 1);
  assert.equal(deps.input.unpipeCalls, 1);
  assert.equal(deps.startedHandles, 0);
});

test('startup diagnostic supports default, override, and suppression', async () => {
  const suppressed: RunStdioMcpOptions = { startupDiagnosticLine: null };
  assert.deepEqual(await captureStartupDiagnostic({}), ['maplibre-style-mcp: stdio transport ready\n']);
  assert.deepEqual(await captureStartupDiagnostic({ startupDiagnosticLine: '{"kind":"custom"}' }), ['{"kind":"custom"}\n']);
  assert.deepEqual(await captureStartupDiagnostic(suppressed), []);
});

test('terminal during a delayed startup diagnostic cannot return a dead handle', async () => {
  for (const terminal of [cleanEofTerminal, framingFailureTerminal, transportCloseTerminal]) {
    const deps = startupDependencies({ stderr: delayedCallbackStream() });
    const before = lifecycleListenerSnapshot(deps);
    const starting = runStdioMcp({}, deps);
    await deps.stderr.writeStarted;
    terminal.fire(deps);
    deps.stderr.releaseCallback();
    await assert.rejects(() => starting, { code: terminal.expectedCode });
    assert.equal(deps.startedHandles, 0);
    assert.equal(deps.transport.closeCalls, 1);
    assert.equal(deps.server.closeCalls, 1);
    assert.equal(deps.store.disposeCalls, 1);
    assert.equal(deps.input.unpipeCalls, 1);
    assertLifecycleListenerSnapshot(deps, before);
  }
});

test('asynchronous stdout failure enters the same terminal gate without hanging sends', async () => {
  for (const scenario of [
    outputFailure({ phase: 'starting', writeReturns: true }),
    outputFailure({ phase: 'starting', writeReturns: false }),
    outputFailure({ phase: 'started', writeReturns: true }),
    outputFailure({ phase: 'started', writeReturns: false }),
  ]) {
    const deps = startupDependencies({ stdout: scenario.stream });
    const before = stdoutListenerSnapshot(deps.stdout);
    const starting = runStdioMcp({}, deps);
    const started = scenario.phase === 'started' ? await starting : undefined;
    await scenario.waitForSdkWrite();
    scenario.emitAsyncEpipeWithoutDrain();
    if (scenario.phase === 'starting') {
      await assert.rejects(() => starting, { code: 'EPIPE' });
      assert.equal(deps.startedHandles, 0);
    } else {
      if (!started) assert.fail('expected a started handle');
      await started.closed;
    }
    await scenario.sendPromiseSettled;
    scenario.emitLateDuplicateFailure();
    assert.equal(deps.transport.closeCalls, 1);
    assert.equal(deps.server.closeCalls, 1);
    assert.equal(deps.store.disposeCalls, 1);
    assert.equal(deps.input.unpipeCalls, 1);
    assert.equal(deps.stdout.destroyCalls, 0);
    assert.equal(deps.stdout.endCalls, 0);
    assert.equal(scenario.uncaughtErrors.length, 0);
    assert.equal(scenario.unhandledRejections.length, 0);
    assertStdoutListenerSnapshot(deps.stdout, before);
  }
});

test('stdio-specific raw transport error hook remains fatal through the decorator', async () => {
  const deps = startupDependencies();
  const before = lifecycleListenerSnapshot(deps);
  const started = await runStdioMcp({}, deps);
  deps.rawTransport.emitError(new Error('stdio transport input failure'));
  await started.closed;
  assert.equal(deps.rawTransport.closeCalls, 1);
  assert.equal(deps.server.closeCalls, 1);
  assert.equal(deps.input.unpipeCalls, 1);
  assert.equal(deps.output.disposeCalls, 1);
  assertLifecycleListenerSnapshot(deps, before);
});
```

- [ ] **Step 2: Run binary tests and verify no executable runner exists (2 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="help exits|byte zero|shared MCP byte limit|bounded stdio framing|factory policy for explicit lower|unsafe request id|one raw transport owner|real stdio tool and resource|startup failure|terminal path owns|stderr line writes|stderr EPIPE|startup diagnostic supports|terminal during a delayed startup diagnostic|stdout failure enters|stdio-specific raw transport error"
```

Expected: FAIL with a missing bin target or an unavailable `runStdioMcp` export.

- [ ] **Step 3: Implement explicit stdio startup and diagnostics routing (5 minutes).**

```ts
export const runStdioMcp = async (
  options: RunStdioMcpOptions = {},
  deps: StdioDependencies = defaultStdioDependencies,
): Promise<StartedStdioMcp> => {
  const created = deps.serverFactory(options.serverOptions, 'transport-prebounded');
  const lifecycle = createStdioLifecycle(created, deps);
  try {
    const input = createBoundedNdjsonInput(
      deps.stdin,
      created.messagePolicy,
      (terminal) => lifecycle.requestTerminal(terminal),
    );
    lifecycle.ownInput(input);
    const output = createGuardedStdioOutput(
      deps.stdout,
      (terminal) => lifecycle.requestTerminal(terminal),
    );
    lifecycle.ownOutput(output);
    const acquiredTransport = deps.transportFactory(
      input.stream,
      output.stream,
      created.messagePolicy.maxMessageBytes + 1,
    );
    lifecycle.ownProvisionalRawTransport(acquiredTransport);
    return await lifecycle.finishStartup(async () => {
      await lifecycle.transferRawTransportToCreated(acquiredTransport, () =>
        created.connect(acquiredTransport, (terminal) => lifecycle.requestTerminal(terminal)));
      const diagnosticLine = options.startupDiagnosticLine === undefined
        ? 'maplibre-style-mcp: stdio transport ready'
        : options.startupDiagnosticLine;
      if (diagnosticLine !== null) await writeMcpStderrLine(deps.stderr, diagnosticLine);
    });
  } catch (error: unknown) {
    await lifecycle.closePartialStartup(error);
    throw error;
  }
};
```

Treat `MAX_MCP_MESSAGE_BYTES` as the default maximum UTF-8 bytes of one JSON-RPC message, excluding stdio's single LF delimiter; the actual runner limit is always `created.messagePolicy.maxMessageBytes`. SDK 1.30 checks its entire appended stdio buffer before consuming LF, so passing raw process stdin with `maxBufferSize:resolvedMax` would reject an exact-limit payload plus LF and could reject two individually legal frames delivered in one OS chunk.

Implement `createBoundedNdjsonInput(source, messagePolicy, onTerminal)` in `stdio.ts` as a byte-oriented Transform/reader ahead of the SDK. It returns an owned `{stream, dispose()}` handle rather than a bare stream. Scan raw bytes for LF without decoding partial UTF-8, bound the pending no-LF payload before allocating more than `messagePolicy.maxMessageBytes`, validate each complete payload with a fatal UTF-8 decoder, parse JSON once for `assertInboundMcpFraming(parsed, messagePolicy, rawReaderPreflightContext)` without reserializing the whole parsed value, and emit each accepted original payload plus its LF as a separate downstream chunk. `rawReaderPreflightContext` has `totalBytesAlreadyBounded:true` and no scheme admissions; it checks only bounded fields/global raw-dot spelling, while the composed decorator applies the full frozen admission registry before SDK dispatch. A compact exponent-number payload of exactly the resolved raw byte limit succeeds even when canonical reserialization would expand; one raw byte more or an unsafe ID/method/resource URI fails before SDK/handler dispatch. Multiple legal frames arriving in one source chunk are emitted separately, a legal frame split across arbitrary byte/UTF-8/delimiter boundaries succeeds, and EOF with non-empty unterminated bytes is a protocol failure rather than an implicit frame. Empty lines, invalid UTF-8/JSON/framing, source aborts, and over-limit pending data invoke `onTerminal` exactly once and invoke no handler; clean EOF invokes the same callback with an EOF terminal reason. The factory decorator validates the parsed message again immediately before the protocol callback, using the same policy and prebounded-total mode plus frozen admissions.

The bounded-input handle owns only the listeners/pipe it adds and the intermediate Transform, never caller-owned `source`. Its idempotent `dispose()` calls `source.unpipe(stream)`, removes every listener it installed, clears pending buffers, and destroys/ends the intermediate stream exactly once. It must run after normal close, clean EOF, framing failure, source error, transport-constructor failure, connect failure, stderr failure, and explicit/signal close. SDK 1.30's `StdioServerTransport.close()` only removes/pauses its own input listeners; it does not unpipe this wrapper, so transport close is not a substitute for disposing the owned input. Tests capture source `data`/`end`/`error`/pipe listener baselines and prove they are restored in every path.

Before constructing or connecting the SDK transport, also create `createGuardedStdioOutput(deps.stdout, onTerminal)`, returning an owned `{stream, dispose()}` facade. The facade forwards every SDK chunk byte-for-byte and in order to the caller-owned stdout; it never adds a prefix, decodes/re-encodes data, calls `end()`/`destroy()` on stdout, or swallows backpressure. Install temporary `error` and premature `close` listeners on the underlying stdout before the first write. Its `write` catches synchronous throws, supplies an underlying write callback for asynchronous failures, relays the original boolean, and relays `drain` to the facade. A callback error, `error` event, or unexpected close enters `onTerminal` through a once gate; callback-plus-event and late duplicates are inert.

SDK 1.30 resolves `send()` immediately when `write()` returns true and otherwise waits only for `drain`, without listening for output errors. Therefore, when an error wins while one or more facade writes are backpressured, the facade must settle its pending relay exactly once (including a terminal synthetic `drain` after the latch) so an SDK send/`server.close()` cannot wait forever. This settlement does not claim delivery; the latched terminal error remains authoritative and triggers cleanup. Keep the facade's source listeners through all in-flight write callbacks/same-turn paired events, then its idempotent `dispose()` removes only listeners it installed and restores the exact caller baseline. It owns the facade and pending bookkeeping, not caller stdout. Cover synchronous write throw, write-returned-true followed by async EPIPE, write-returned-false followed by EPIPE without drain, callback+event duplicates, and late callbacks in both `starting` and `started` states; no uncaught exception, unhandled rejection, dead started handle, or unresolved send may remain.

The default server factory is the Node-internal stdio wrapper around `createMapLibreStyleMcpServerWithDependencies(..., undefined, 'transport-prebounded')`; it resolves the policy once and returns it, while the public factory remains canonical-byte mode. The default raw transport factory is exactly `(input, output, maxBufferSize) => new StdioServerTransport(input, output, { maxBufferSize })`, called with the bounded input, guarded output facade, and `created.messagePolicy.maxMessageBytes + 1` solely to accommodate the accepted payload plus LF. The raw transport may never receive raw process stdin/stdout and is never connected directly: the created bounded capability installs the same-policy/frozen-admission final decorator. Export `RunStdioMcpOptions` and `StartedStdioMcp` with `runStdioMcp` from `main.ts`; the started handle returns that exact policy identity. Public `RunStdioMcpOptions` may provide `serverOptions` (including a caller-owned store, extensions, and `maxMessageBytes`) and `startupDiagnosticLine?: string | null`: `undefined` writes the default ready line, a string writes that exact one line, and `null` suppresses startup output. The later bridge passes `null`, waits until both MCP and WebSocket components are started, then uses `writeMcpStderrLine` once for its sole JSON handoff; this prevents a plain ready line from preceding bridge JSON. Stream/server-factory/transport-factory/stdout/stderr dependencies remain the non-barrel second argument used by direct tests. Tests inject explicit streams and ownership-recording fakes for lifecycle assertions but may not replace the production path with an unbounded input, unguarded output, or private policy.

Export `writeMcpStderrLine(stderr, line): Promise<void>` from the Node-internal `stdio.ts` module, but do not re-export it from the package `./mcp` barrel; the later bridge imports this exact internal symbol instead of reimplementing unsafe writes. The caller supplies a line without CR/LF, the helper rejects embedded line breaks, appends exactly one LF, and awaits completion. Install a temporary `error` listener before checking/writing, handle an already-ended/destroyed/non-writable stream, synchronous `write` throws, callback errors, and an `error` event. An idempotent settle gate records the first failure while keeping the listener through the write callback and its same-turn paired error event, so callback-plus-event EPIPE cannot reject twice or become uncaught; remove only the helper's listener in `finally` on every success/failure. Route the executable's help, ready, and top-level diagnostic lines through this helper too; if stderr itself fails, do not recursively log—finish cleanup, set failure status, and exit. Tests use real/fake Writable streams for synchronous throw, asynchronous callback EPIPE, event-only EPIPE, callback-plus-event in both orders, already-closed state, and success/backpressure, and assert one line, one settlement, no `uncaughtException`, and exact listener baselines.

Create one lifecycle controller before the bounded input/guarded output and let it acquire the input and output handles incrementally. Treat the raw SDK transport as **provisional** only between construction and the atomic `transferRawTransportToCreated(raw, connectWork)` call. Before transfer, the lifecycle is its sole owner and may close it directly. `ownProvisionalRawTransport` installs stdio-specific raw `onerror` and `onclose` hooks before transfer; Task 4's decorator captures/chains these baseline hooks and restores them on close, so a post-transfer raw stdio error is terminal even though generic/HTTP raw `onerror` is not. The transfer marks raw ownership as handed to the created decorator before invoking connect work; from that instant every explicit/terminal/startup cleanup closes only `created.close()`, whose connected decorator delegates `raw.close()` exactly once. The lifecycle must never retain raw ownership, call raw and created close in parallel, or infer ownership from connect success—SDK connect may start raw before rejecting. `requestTerminal` is the wrappers' only EOF/framing/input-source/output-write/output-close callback and starts the same idempotent cleanup gate used by explicit close; the callback passed explicitly to the created bounded connect also routes decorator inbound/framing/final-send and raw close failures through this gate. Do not use a public default connect in this runner, because its default terminal only closes the server and would strand input/output/signal ownership. Do not rely on SDK `input.onerror`, because SDK 1.30 merely forwards that error and does not close, and do not rely on SDK output handling, because it observes neither async write failure nor a missing drain.

Model lifecycle state as `starting → started | closing → closed` behind one compare-and-set gate. `finishStartup(work)` owns the **entire** startup phase: it races the latched terminal signal against both `server.connect` and the awaited default/override diagnostic, consumes the losing work promise safely, and atomically changes `starting` to `started` only if the work completed and no terminal was already latched. If clean EOF, framing/source failure, stdout callback/event/close failure, or transport close/error wins at any point—including while connect, a backpressured SDK send, or the stderr callback is delayed—cleanup owns the transition; later connect/send/diagnostic success cannot call start, resurrect state, or return a dead handle. `finishStartup` is single-settlement and re-entrant/concurrency safe: repeat/concurrent calls share the same startup promise/handle or the same terminal failure and can never install duplicate signal/transport listeners.

If transport construction, `created.connect`, invalid multiline diagnostic input, any synchronous/asynchronous stderr write path, or guarded stdout write/close fails, `closePartialStartup(primary)` performs one ownership-aware all-settled cleanup before rethrowing the original error: close raw directly only if it is still provisional; otherwise close only `created`, then always dispose bounded input and guarded output. `runStdioMcp` must not return `StartedStdioMcp`. Keep the output guard installed until the selected transport/server owner closes and all in-flight write callbacks or synthetic-drain settlement complete, then restore the caller's stdout listener baseline. Cleanup failure must not replace that primary startup error. SDK connect can own/start the transport before rejecting, so returning no handle is never permission to leak or double-close it. Add constructor-failure-before-acquisition, terminal-before-transfer, connect-failure-after-start/transfer, diagnostic failure after transfer, sync/async stderr failure, framing during connect, terminal during delayed diagnostic, true/false stdout-write EPIPE, and close-failure tests; every constructed raw transport closes exactly once and every handle/listener baseline is restored.

After `start()`, clean EOF, input framing/source error, stdout write/close error, decorator/raw transport close/error, SIGINT/SIGTERM, and explicit `close()` all enter that same gate, close only the transferred `created` owner, settle pending output facade writes, dispose both owned stream handles, remove signal handlers, and settle `StartedStdioMcp.closed` exactly once. `closed` resolves after cleanup even for a post-start protocol failure; diagnostics contain only a fixed bounded reason on stderr and never echo payload bytes. `close()` is safe when called repeatedly or concurrently with a terminal callback. Add exact-limit, one-byte-over, two-valid-frames-in-one-source-chunk, cross-chunk UTF-8, invalid UTF-8, unterminated EOF, clean EOF, decorator-triggered unsafe-ID/send-failure, true/false async stdout EPIPE, and explicit close assertions that wait for `closed`, prove no handler ran for invalid frames, close raw exactly once, leave no unresolved SDK send, never end/destroy caller stdout, and restore all handle/listener/pipe baselines. `src/mcp/main.ts` is both the side-effect-free `./mcp` module and bin target: execute argument parsing only under a tested direct-execution guard, never on import. The executable parses `--help`, `--stdio`, and HTTP options, awaits `started.closed`, and closes in `finally`; it must not use `console.log`, `console.info`, or `console.error` after a stdio transport claims stdout, and it never writes a banner to stdout. Every subprocess test ends stdin and terminates/awaits its child in `finally` so no test leaves a handle behind. The later bridge-hosting plan reuses this close handle for signal shutdown.

- [ ] **Step 4: Run subprocess tests and smoke the command help (3 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="help exits|byte zero|shared MCP byte limit|bounded stdio framing|factory policy for explicit lower|unsafe request id|one raw transport owner|real stdio tool and resource|startup failure|terminal path owns|stderr line writes|stderr EPIPE|startup diagnostic supports|terminal during a delayed startup diagnostic|stdout failure enters|stdio-specific raw transport error"
rtk pnpm run build
rtk node dist/mcp/main.js --help
```

Expected: PASS; help and connection information are exclusively stderr, synchronous/asynchronous stderr or stdout failure and terminals during delayed diagnostics never return/resurrect a started handle or strand an SDK send, the provisional raw transport transfers to the decorator exactly once and is never double-closed, caller-owned stdout remains open with its listener baseline restored, a live MCP conversation has no banner prefix, and stdio uses one resolved lower/default/raised policy for application results, JSON payloads, and final outbound messages without rejecting separately valid batched frames.

- [ ] **Step 5: Commit stdio executable (2 minutes).**

```bash
rtk git add src/mcp/stdio.ts src/mcp/stdio.test.ts src/mcp/main.ts src/mcp/main.test.ts
rtk git commit -m "feat: add race-safe MapLibre style MCP stdio binary"
```

### Task 12: Implement protected optional Streamable HTTP transport

**Files:**
- Create: `src/mcp/http.ts`
- Create: `src/mcp/http.test.ts`
- Modify: `src/mcp/main.ts`

**Interfaces:**
- Consumes: Node `http`, `resolveMcpMessagePolicy`, generic `assertInboundMcpFraming`, Node-internal `preflightCreatedMcpInbound`, `StreamableHTTPServerTransport`, official `StreamableHTTPClientTransport`, the Task 9 factory's pre-resolved-policy/prebounded-byte seam and bounded `connect`, a configured bearer token, bind host/port options, optional browser-Origin allowlist, and request headers/body bytes.
- Produces: `startStreamableHttpMcp(options): Promise<StartedHttpMcp>` with `url`, the listener's exact readonly `messagePolicy`, idempotent `close()`, one shared caller-owned application `StyleSessionStore`, and an internal stateful map from MCP SDK session ID to ownership-aware `{ created, rawTransport }` pairs.

- [ ] **Step 1: Write failing loopback security and real-client tests (5 minutes).**

```ts
test('HTTP defaults to random loopback port and rejects absent bearer token', async (t) => {
  const started = await startStreamableHttpMcp({ bearerToken: 'secret-test-token' });
  t.after(async () => { await started.close(); });
  assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  const response = await fetch(started.url, { method: 'POST', headers: { host: '127.0.0.1' } });
  assert.equal(response.status, 401);
});

test('HTTP rejects an invalid configured bearer before binding or allocation', async () => {
  for (const bearerToken of ['', '   ', 'line\r\nbreak', 'x'.repeat(MAX_HTTP_BEARER_TOKEN_BYTES + 1)]) {
    const deps = createCountingHttpDependencies();
    await assert.rejects(
      () => startStreamableHttpMcpWithDependencies({ bearerToken }, deps),
      { code: 'INVALID_INPUT', details: { reason: 'invalidBearerToken' } },
    );
    assert.deepEqual(deps.snapshot(), {
      listenCalls: 0, storeFactories: 0, serverFactories: 0,
      rawTransportFactories: 0, sessionCallbacks: 0, handlerCalls: 0,
    });
  }
});

test('official StreamableHTTPClientTransport opens one app session while transport IDs remain separate', async (t) => {
  const started = await startStreamableHttpMcp({ bearerToken: 'secret-test-token' });
  const transport = new StreamableHTTPClientTransport(new URL(started.url), { requestInit: { headers: { authorization: 'Bearer secret-test-token' } } });
  const client = new Client({ name: 'http-test', version: '1.0.0' });
  t.after(async () => { await Promise.allSettled([client.close(), started.close()]); });
  await client.connect(transport);
  const opened = parseOfficialCallToolResult(await client.callTool({ name: 'style_session_open', arguments: { style: validStyle } }));
  const openedData = parseDocumentToolSuccessData('style_session_open', opened.structuredContent);
  assert.ok(transport.sessionId);
  assert.notEqual(transport.sessionId, openedData.sessionId);
  await transport.terminateSession();
});

test('HTTP rejects a wrong browser Origin and every oversized POST before dispatch', async (t) => {
  const deps = createCountingHttpDependencies();
  const started = await startStreamableHttpMcpWithDependencies({
    bearerToken: 'secret-test-token', extensions: [deps.sentinelExtension],
  }, deps);
  t.after(async () => { await started.close(); });
  const wrongOrigin = await postInitialize(started.url, { origin: 'https://attacker.example' });
  assert.equal(wrongOrigin.status, 403);
  const oversizedInitialize = await postRaw(
    started.url, oversizedJson(started.messagePolicy.maxMessageBytes + 1), authorizedHeaders(started),
  );
  assert.equal(oversizedInitialize.status, 413);
  const unsafeId = await postJson(
    started.url,
    initializeWithSerializedIdBytes(MAX_MCP_REQUEST_ID_BYTES + 1),
    authorizedHeaders(started),
  );
  assert.equal(unsafeId.status, 400);
  assert.deepEqual(deps.snapshot(), {
    serverFactories: 0, rawTransportFactories: 0, sessionCallbacks: 0, handlerCalls: 0,
  });
});

test('HTTP resolves one policy for bodies, extensions, application results, and final sends', async (t) => {
  for (const maxMessageBytes of [256 * 1024, 8 * 1024 * 1024]) {
    const deps = createCountingHttpDependencies();
    const started = await startStreamableHttpMcpWithDependencies({
      bearerToken: 'secret-test-token', maxMessageBytes, extensions: [deps.sentinelExtension],
    }, deps);
    const client = await connectOfficialHttpClient(started);
    t.after(async () => { await Promise.allSettled([client.close(), started.close()]); });
    assert.strictEqual(deps.factoryPreResolvedPolicy, started.messagePolicy);
    assert.strictEqual(deps.extensionContext.messagePolicy, started.messagePolicy);
    assert.strictEqual(deps.bodyReaderPolicy, started.messagePolicy);
    assert.strictEqual(deps.boundedTransportPolicy, started.messagePolicy);
    assert.equal(started.messagePolicy.maxMessageBytes, maxMessageBytes);
    await assertKnownSessionBodyAccepted(client, jsonRpcPayloadOfExactBytes(maxMessageBytes));
    await assertKnownSessionBodyRejectedButStillUsable(
      client, jsonRpcPayloadOfExactBytes(maxMessageBytes + 1), 413,
    );
  }
});

test('real HTTP tool and resource responses stay bounded without touching rejected sessions', async (t) => {
  const clock = createFakeClock();
  const deps = createRecordingHttpDependencies();
  const fixture = makeStyleWhoseRequestFitsButDuplicatedExportDoesNot(MIN_MCP_MESSAGE_BYTES);
  const started = await startStreamableHttpMcpWithDependencies({
    bearerToken: 'secret-test-token',
    maxMessageBytes: MIN_MCP_MESSAGE_BYTES,
    storeOptions: { clock, limits: { ttlMs: 100 }, idFactory: () => 's1' },
  }, deps);
  const client = await connectOfficialHttpClient(started);
  t.after(async () => { await Promise.allSettled([client.close(), started.close()]); });
  await openStyle(client, fixture.style);
  clock.value = 99;
  const exported = parseOfficialCallToolResult(await client.callTool({
    name: 'style_export', arguments: { sessionId: 's1' },
  }));
  assert.equal(parseFailure(exported).error.details?.reason, 'responseTooLarge');
  await assert.rejects(
    () => client.readResource({ uri: makeStyleUri('s1').href }),
    (error) => parseOfficialMcpError(error).data.details.reason === 'responseTooLarge',
  );
  assert.ok(deps.finalJsonRpcMessages.every(
    (message) => utf8JsonBytes(message) <= started.messagePolicy.maxMessageBytes,
  ));
  assert.equal(deps.projectionCalls.value, 2);
  clock.value = 101;
  await assert.rejects(() => started.store.read('s1'), { code: 'NOT_FOUND' });
});

test('HTTP pair transfers raw ownership once and decorator terminals close the whole pair', async (t) => {
  for (const scenario of [
    connectFailureAfterRawStart,
    initializeFailureAfterTransfer,
    explicitSessionDelete,
    rawSessionClose,
    boundedDecoratorUnsafeMessage,
    boundedDecoratorRawSendRejection,
    listenerShutdown,
  ]) {
    const result = await runHttpPairOwnershipScenario(scenario);
    t.after(result.finalCleanup);
    assert.equal(result.rawTransportCloseCalls, 1);
    assert.equal(result.createdCloseCalls, 1);
    assert.equal(result.rawAndCreatedClosedInParallel, false);
    assert.equal(result.pairMapSize, 0);
    assert.equal(result.unhandledRejections.length, 0);
    assertTransportListenerBaseline(result.rawTransport);
  }
});

test('HTTP keeps batch responses as individually bounded SSE messages', async (t) => {
  const deps = createRecordingHttpDependencies();
  const started = await startStreamableHttpMcpWithDependencies({
    bearerToken: 'secret-test-token', maxMessageBytes: 256 * 1024,
  }, deps);
  t.after(async () => { await started.close(); });
  const session = await initializeRawHttpSession(started);
  const response = await postRawJson(started.url, [smallToolRequest(1), smallToolRequest(2)], {
    ...authorizedHeaders(started), 'mcp-session-id': session.id,
  });
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  const messages = parseSseDataJson(response.body);
  assert.equal(messages.length, 2);
  assert.ok(messages.every((message) => utf8JsonBytes(message) <= started.messagePolicy.maxMessageBytes));
  assert.equal(deps.handlerCalls, 2);
  assert.equal(response.body.trimStart().startsWith('['), false); // no ungated JSON aggregate
  assert.deepEqual(deps.rawTransportOptions, {
    enableJsonResponse: false, eventStore: undefined,
  });
  await assertKnownSessionStillUsable(started, session.id);
});

test('SDK-generated HTTP errors remain fixed, bounded, and input-redacted', async (t) => {
  const started = await startStreamableHttpMcp({ bearerToken: 'secret-test-token' });
  t.after(async () => { await started.close(); });
  for (const scenario of [wrongMethod, wrongContentType, wrongAccept, unknownSession, wrongProtocolVersion]) {
    const secret = `private-${scenario.name}`.repeat(10_000);
    const response = await scenario.request(started, secret);
    const bytes = Buffer.byteLength(await response.clone().arrayBuffer());
    assert.ok(bytes <= started.messagePolicy.maxMessageBytes);
    assert.doesNotMatch(await response.text(), /private-/);
  }
});
```

- [ ] **Step 2: Run HTTP tests and verify the listener factory is missing (2 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="random loopback|transport IDs remain|wrong browser Origin|resolves one policy|real HTTP tool and resource|pair transfers raw ownership|individually bounded SSE|SDK-generated HTTP errors"
```

Expected: FAIL with unresolved `startStreamableHttpMcp` or connection refusal.

- [ ] **Step 3: Implement host, token, and bind policy before transport dispatch (5 minutes).**

```ts
const assertRequestAllowed = (request: IncomingMessage, options: ResolvedHttpOptions): void => {
  if (!timingSafeBearerEquals(request.headers.authorization, options.bearerToken)) throw httpError(401, 'INVALID_INPUT');
  if (!isAllowedHost(request.headers.host, options.host, options.port)) throw httpError(421, 'INVALID_INPUT');
  if (!isAllowedOrigin(request.headers.origin, options)) throw httpError(403, 'INVALID_INPUT');
};
```

Default to host `127.0.0.1` and port `0`; only accept `0.0.0.0`, `::`, or other non-loopback bind hosts when `allowNonLoopback: true` is explicitly passed. After every startup option has passed its pre-allocation validation, bind, derive the actual authority and origin from `server.address()`, and require the Host header to match that authority exactly before handling the request. A native MCP client may omit `Origin`. When `Origin` is present, require exact equality with the derived bound loopback origin or with one entry in an explicit `allowedOrigins` array; normalize/validate that allowlist once at startup and never accept wildcard, prefix, suffix, opaque `null`, credential-bearing, or malformed origins. Compare a supplied bearer against the configured token with equal-length buffers and `timingSafeEqual`. Apply bearer, Host, and Origin policy before reading a body or allocating any transport. At listener startup call `resolveMcpMessagePolicy({maxMessageBytes: options.maxMessageBytes})` exactly once and create exactly one application `StyleSessionStore`. Return that exact frozen policy on `StartedHttpMcp`; every per-session factory receives it through the Task 9 `preResolvedPolicy` argument rather than resolving/defaulting again.

Before resolving policy, creating a store, or binding a socket, validate `options.bearerToken` as a primitive string containing 1 through `MAX_HTTP_BEARER_TOKEN_BYTES = 4096` UTF-8 bytes and no ASCII whitespace/control character; do not trim or coerce it. Empty, whitespace-only, CR/LF-bearing, oversized, boxed-string, or non-string values fail with provenance-authentic `INVALID_INPUT/details.reason:'invalidBearerToken'` and leave every listener/store/pair counter at zero. This prevents an empty configured secret from accepting the guessable `Authorization: Bearer ` spelling. The request-side parser accepts exactly one `Bearer <token>` authorization value and compares the extracted bytes to the already validated configured bytes; it never logs or includes either value in an error.

For **every** POST—including requests carrying a known `mcp-session-id`—read bytes through one `readBoundedJsonBody(request, messagePolicy)` helper before transport dispatch. Reject declared or streamed bytes above `messagePolicy.maxMessageBytes` with 413, invalid UTF-8 (fatal decoder) or JSON with 400, and client abort with a normalized bounded response. Count original raw bytes, not JavaScript characters; stop consuming immediately after the first over-limit chunk and never canonical-reserialize the parsed whole value as a second total-byte check. For a headerless request, call generic `assertInboundMcpFraming(parsedBody, messagePolicy, preboundedNoAdmissions)` for fields/global dot segments, then require initialize before allocating a pair. For a known-session request, do a read-only map lookup, then call `preflightCreatedMcpInbound(pair.created, parsedBody)`, which uses that pair's exact frozen `{totalBytesAlreadyBounded:true, admissions}` identity; only after it succeeds may raw `handleRequest` or SDK `new URL` run. Unknown sessions never borrow another pair's admission table. Translate unsafe field/admission failures to a fixed bounded 400 before handler/store/session callbacks. Pass that same parsed reference to `rawTransport.handleRequest(request, response, parsedBody)` so SDK never rereads the consumed stream. An over-limit/malformed/unsafe request must invoke no document/live handler, resolver/projector, or application revision mutation and must allocate no provisional pair; for an existing known session it leaves the pair usable. Test exact/one-byte-over raw exponent and multibyte payloads, malicious IDs, and document/live URI aliases on both headerless/known paths.

For a headerless, already-bounded parsed POST, call SDK `isInitializeRequest(parsedBody)` before allocating any MCP server/transport pair; reject every other headerless request. For a valid initialize request, call the internal factory with `{store: sharedStore, extensions}`, the already-resolved policy, and `'transport-prebounded'`, then create a fresh raw `StreamableHTTPServerTransport` with `{sessionIdGenerator: randomUUID, onsessioninitialized, onsessionclosed, enableJsonResponse:false, eventStore:undefined}`. Keep JSON-response aggregation and event replay disabled: SDK 1.30 would otherwise collect several individually gated batch responses and serialize one ungated JSON array. With SSE, each response is a separate `data:` JSON-RPC message that has passed the shared decorator; LF/SSE framing remains outside the per-message byte contract. The callbacks store/delete the closed-over pair by emitted MCP session ID. Use the SDK 1.30 low-level `created.server.server.onclose` notification only for pair bookkeeping after connect; do not assign `rawTransport.onsessioninitialized` or overwrite SDK-owned callbacks.

Represent each pair with an explicit `provisional | transferred | closed` ownership latch. Raw is owned directly only between construction and an atomic transfer that marks it `transferred` **before** calling `created.connect(raw, terminal => closePair(pair, terminal))`; this pair-specific terminal callback is mandatory so decorator framing/final-send failures delete the map entry and close the whole pair. Before transfer, failure closes raw directly and closes the unconnected created server. From transfer onward, `closePair` closes only `created`, because its connected decorator owns and closes raw once; never `Promise.all` raw and created close. A spontaneous raw `onclose` reaches the decorator/pair latch, marks raw already closed, and later `created.close()` must not call raw close again. By contrast, ordinary SDK HTTP request errors reported through raw `onerror` (400/406/409/415 or invalid JSON-RPC) are forwarded for observability but are **not** pair-terminal; a rejected known-session POST remains usable. If connect, request handling, initialization, or final bounded send fails, preserve the primary error, all-settle the ownership-aware pair cleanup, and create no dead registered pair. Route subsequent GET, POST, and DELETE only by a known `mcp-session-id` header and always invoke `rawTransport.handleRequest` on the raw object while the server remains connected through its bounded decorator.

The same policy identity drives body bytes, pair-specific preflight/admissions, application response boundaries seen by built-in/caller extensions, and the decorator's final serialized outbound gate. Calibrate real exports/resources whose duplicated text plus structured content exceed a lower limit: clients receive only the fixed `responseTooLarge` result/error, every captured final `JSON.stringify(message)` byte count is within the policy, and the atomic projection does not touch TTL or rerun work. Send a real two-request batch and prove the wire is two individually bounded SSE data messages, never an aggregate JSON body; handler calls remain exactly two and the pair remains usable. SDK-generated fixed HTTP errors for method/content-type/Accept/session/protocol-version failures are separately byte-asserted below the same policy and never echo request bodies. Also exercise an unexpected oversized SDK response/fallback and a rejecting raw send; both enter the pair terminal latch once, never send twice, and never leave a hanging HTTP response. `StartedHttpMcp.close()` uses one idempotent gate, prevents new dispatch, ownership-closes every provisional/transferred/registered pair, closes the HTTP server, and finally disposes the shared store exactly once. Application style-session IDs remain independent from the transport map.

- [ ] **Step 4: Test bearer, Host, DNS-rebinding, non-loopback policy, and SDK request flow (5 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="bearer|Host|Origin|rebinding|non-loopback|oversized POST|unsafe request id|resolves one policy|real HTTP tool and resource|pair transfers raw ownership|individually bounded SSE|SDK-generated HTTP errors|random loopback|official StreamableHTTPClientTransport"
rtk pnpm run typecheck
```

Expected: PASS; `Host: attacker.example`, a wrong present Origin, and an absent or wrong bearer credential cannot reach the MCP transport. Native official clients without Origin still work. The single resolved policy controls exact inbound bytes, pair-specific raw URI admissions, every application boundary, and final outbound JSON-RPC bytes at lower/default/raised values. JSON aggregation/replay stays disabled and batch results are individually bounded SSE messages. Add exactly-at-limit/one-byte-over tests for headerless initialize and known-session POSTs, compact exponent/multibyte UTF-8 boundaries, invalid UTF-8/JSON, unsafe IDs/URI aliases, lying `Content-Length`, truncated/aborted bodies, malformed/headerless non-initialize, bounded/redacted SDK HTTP errors, failed-initialize cleanup, routine nonterminal SDK errors, double-close, session-close removal, decorator terminal cleanup, and test-finally client/transport/listener cleanup cases. After a rejected known-session POST, issue a valid request and prove the same transport remains usable and its style revision unchanged; each raw transport closes exactly once and no active handle, provisional pair, or unhandled rejection remains.

- [ ] **Step 5: Commit protected HTTP option (2 minutes).**

```bash
rtk git add src/mcp/http.ts src/mcp/http.test.ts src/mcp/main.ts
rtk git commit -m "feat: add protected Streamable HTTP MCP transport"
```

### Task 13: Finish package artifacts, export smoke coverage, and documentation

**Files:**
- Modify: `scripts/check-package.mjs`
- Modify: `README.md`
- Create: `src/mcp/package-smoke.test.ts`

**Interfaces:**
- Consumes: package `exports`, the retained existing `bin`, compiled `dist/mcp/main.js`, and the existing package-check script.
- Produces: a freshly packed archive whose packlist contains `dist/mcp/main.js` and `dist/mcp/main.d.ts`, whose installed manifest maps `./mcp` exactly, whose JavaScript plus separate root-Bundler, core-NodeNext, and MCP-NodeNext TypeScript consumers resolve the public types from a bare temporary project, which installs an executable named `maplibre-style-mcp`, and which documents stdin/stdout and secure HTTP contracts accurately.

- [ ] **Step 1: Write failing packed-artifact assertions (5 minutes).**

```ts
const packageSmoke = process.env.MAPLIBRE_PACKAGE_SMOKE === '1' ? test : test.skip;

packageSmoke('packed package exposes mcp without import-time handles', async (t) => {
  const packed = await createFreshPackedConsumer(t);
  const output = await runNodeIn(packed.consumerDir, "import('maplibre-style-tools/mcp').then(m => console.log(typeof m.createMapLibreStyleMcpServer))");
  assert.equal(output.stdout.trim(), 'function');
  assert.equal(output.stderr, '');
  assert.ok(packed.packlist.includes('dist/mcp/main.js'));
  assert.ok(packed.packlist.includes('dist/mcp/main.d.ts'));
  assert.match(
    await readFile(join(packed.installedPackageDir, 'dist/mcp/main.d.ts'), 'utf8'),
    /^\/\/\/ <reference types="node" preserve="true" \/>/m,
  );
  assert.equal(packed.packlist.some((path) => path === 'evals' || path.startsWith('evals/')), false);
});

packageSmoke('packed manifest, NodeNext types, and binary all resolve from the exact tgz', async (t) => {
  const packed = await createFreshPackedConsumer(t);
  assert.deepEqual(packed.manifest.exports['./mcp'], {
    types: './dist/mcp/main.d.ts', import: './dist/mcp/main.js', default: './dist/mcp/main.js',
  });
  await writeRootBundlerTypeSmoke(packed.consumerDir);
  await writeCoreNodeNextTypeSmoke(packed.consumerDir);
  await writeMcpNodeNextTypeSmoke(packed.consumerDir);
  await runAllThreeRepositoryTscConfigs(packed.consumerDir);
  const result = await runPackedBinary(packed.consumerDir, '--help');
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Usage:/);
});

test('README documents the discoverable nested MCP inputs and error boundary', async () => {
  const readme = await readFile('README.md', 'utf8');
  assert.match(readme, /style_validate[\s\S]*target[\s\S]*kind/);
  assert.match(readme, /style_inspect[\s\S]*selection[\s\S]*view/);
  assert.match(readme, /SDK schema rejection[\s\S]*business envelope/);
  assert.match(readme, /sessions\/~\{sessionId\}[\s\S]*raw semantic[\s\S]*RFC6570/);
  assert.match(readme, /style_apply_transaction[\s\S]*transaction[\s\S]*core validates/);
  assert.match(readme, /startupDiagnosticLine[\s\S]*null[\s\S]*composite/);
  assert.match(readme, /maxMessageBytes[\s\S]*responseTooLarge[\s\S]*inbound[\s\S]*outbound/);
  assert.match(readme, /ResourceUriAdmission[\s\S]*scheme[\s\S]*authority[\s\S]*synchronous/);
  assert.match(readme, /Streamable HTTP[\s\S]*SSE[\s\S]*batch/);
});
```

- [ ] **Step 2: Run the package-smoke test and check script to establish failure (3 minutes).**

```bash
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --input-type=module --eval "process.env.MAPLIBRE_PACKAGE_SMOKE='1'; await import('./.tmp/test-dist/mcp/package-smoke.test.js')"
rtk node scripts/check-package.mjs
```

Expected: FAIL at least on the new README discovery/error-boundary contract (which no earlier task writes), and on any stale-archive/type-resolution behavior still present in the old checker. Do not claim the already-added export/bin alone supplies the red state.

- [ ] **Step 3: Extend package checks and write operational documentation (5 minutes).**

```md
## MCP server

Use `maplibre-style-mcp --stdio` for MCP clients. The process reserves stdout for the protocol; read startup diagnostics only from stderr.

Use `maplibre-style-mcp --http --bearer-token "$TOKEN"` only on trusted loopback clients. It binds `127.0.0.1` and a random port by default; exposing another interface requires `--allow-non-loopback`.
```

Document copyable JSON examples for all three nested discoverability contracts: `style_validate: {target:{kind:'inline', style}}`, `style_analyze_geojson: {target:{kind:'sessionSource', sessionId, sourceId}}`, and `style_inspect: {sessionId, selection:{view:'layer', layerId}}`; JSON examples use double quotes in the actual README. Add open/apply/export lifecycle examples, the revision/dry-run behavior, size/session/ID limits, six resource URIs, and the difference between SDK input-schema rejection and a stable business envelope after handler entry. Show the literal marker in every advertised template (for example `sessions/~{sessionId}`), explain that a generic RFC6570 client supplies raw semantic IDs and the template performs the one encoding step, and show the exported `make*Uri` helpers so IDs such as `.`, `..`, `~`, `%`, and `/` round-trip without aliases or double decoding. Document all eight tool titles/descriptions, including that `style_apply_transaction.transaction` is intentionally SDK-opaque and core validates its `{operations:[...]}` shape/limits.

For embedders, document that an injected `store` must be the exact object returned by `createStyleSessionStore` (plain structural fakes/proxies are rejected), extensions are strictly synchronous and explicitly return `undefined`, and every resource extension registers a disjoint `ResourceUriAdmission` `{scheme,authority,assertCanonical}` through its shared context before composition freezes. Explain that public factory connect/close spellings are already bounded/stateful and raw SDK low-level methods must not be retained. Document `maxMessageBytes` lower/default/raise bounds, exact inbound/raw and outbound/final semantics, atomic `responseTooLarge` behavior, and that stdio/HTTP runners alone use prebounded input mode. Describe `startupDiagnosticLine`'s default/string/null behavior and that composite hosts suppress it with `null` before emitting their own awaited handoff. Also document stdio's default 5 MiB cap, HTTP bearer/Host/Origin protections, HTTP's intentionally non-replay SSE mode with individually bounded batch responses, no path/network reads, and the generated package-derived server version.

Both the explicitly enabled `src/mcp/package-smoke.test.ts` and `scripts/check-package.mjs` must create their own OS temporary pack directory and bare consumer with `mkdtemp`; they may never reuse `.tmp/*.tgz`, glob for a "latest" archive, or consume a workspace link. In JavaScript, use `spawn`/`execFile` without a shell to invoke the portable `npm` executable with argument arrays equivalent to `pack --json --pack-destination <empty-pack-dir>` and `install --ignore-scripts --no-package-lock --no-audit --no-fund <absolute-tgz>`. Do not make shipped tests or package checks depend on the developer-local `rtk` executable; `rtk` prefixes only the human-run shell command fences in this plan. Parse the one pack filename from that exact invocation. Register/remove the pack directory and consumer in `t.after` for tests and `try/finally` for the script, including command-failure paths. Every enabled invocation therefore creates and cleans a fresh archive.

Root packing runs the prepack build/clean and therefore must not execute concurrently with ordinary Node test files that consume `dist`. Gate only the two real-pack tests behind `MAPLIBRE_PACKAGE_SMOKE=1`; normal recursive `pnpm test` discovers them as skipped before creating any temp directory or child process. The README unit test remains ungated. Focused Task 13 verification imports the compiled test once with that environment set in a dedicated process, after compilation and with no other tests running. The final gate runs ordinary tests first and then `scripts/check-package.mjs` serially. No test body may invoke root build, pack, or clean concurrently.

Inspect the real tgz packlist and require both `dist/mcp/main.js` and `dist/mcp/main.d.ts`; reject `src/`, tests, examples, the entire top-level `evals/` tree, `.tmp`, caches, and a nested workspace. Both `src/mcp/package-smoke.test.ts` and `scripts/check-package.mjs` independently assert that no entry equals `evals` or starts with `evals/`, so the later evaluation fixture/XML can never ship accidentally. Read the installed package manifest and assert the exact `exports['./mcp']` mapping shown above, both binary mappings, and the package version equals exported `MCP_SERVER_VERSION`. From the bare consumer, run a JavaScript ESM import/callable smoke with no repository `NODE_PATH` or workspace fallback.

Retain and run the foundation plan's two independent declaration consumers unchanged: a root `moduleResolution:'Bundler'` consumer (the root surface intentionally reaches AI/MapLibre declarations) and a `/core` strict `NodeNext` consumer. Do **not** import the package root from a NodeNext source merely to make MCP pass; that would incorrectly force root's upstream declaration graph through NodeNext.

Add a third independent `mcp-consumer.ts` plus `tsconfig.mcp-consumer.json`. Configure `module`/`moduleResolution:'NodeNext'`, `strict:true`, `noEmit:true`, `types:[]`, and `skipLibCheck:false`; import only `maplibre-style-tools/mcp` and, where a Style type is genuinely needed, `maplibre-style-tools/core`—never the package root. Construct typed `CreateMapLibreStyleMcpServerOptions`, `RunStdioMcpOptions = {startupDiagnosticLine:null}`, a resolved message policy, and an `McpServerExtension` that explicitly returns `undefined`, registers a `{scheme,authority,assertCanonical}` admission, and uses the shared response boundary. Exercise `created.connect`'s type and the factory's high/low-safe server view without actually opening handles. Construct an injected store only with `createStyleSessionStore()` and prove it is accepted; add compile-only `@ts-expect-error` cases for a structurally complete plain `StyleSessionStore` and an async `McpServerExtension`. Assert exported `MAX_MCP_MESSAGE_BYTES`, `MAX_STYLE_SESSION_ID_BYTES`, policy/context/admission types, and startup options compile.

The emitted `dist/mcp/main.d.ts` must preserve an explicit Node type reference needed by its public stream/server types; the regular package dependency `@types/node@^22.20.1` supplies it in the bare install even with consumer `types:[]`. Run the MCP config with `--listFiles` and fail if it resolves the package root, AI SDK, `maplibre-gl`, browser adapters, or DOM libs. Conversely, do not hide real declaration errors with `skipLibCheck` or extra consumer-installed declaration packages. Both package-smoke and `check-package.mjs` invoke the repository's one pinned TypeScript executable by absolute path against all three configs; module resolution must find only the installed tgz. Execute the installed `node_modules/.bin/maplibre-style-mcp --help` and retain the existing CLI/root/core/maplibre/ai package checks. `check-package.mjs` itself performs build, fresh pack, packlist, bare install, ESM import, all three type-resolution checks, and both binary smokes in one cleanup-safe run.

- [ ] **Step 4: Build, pack, and run all targeted package tests (5 minutes).**

```bash
rtk pnpm run build
rtk node scripts/check-package.mjs
rtk pnpm exec tsc -p tsconfig.test.json
rtk node --input-type=module --eval "process.env.MAPLIBRE_PACKAGE_SMOKE='1'; await import('./.tmp/test-dist/mcp/package-smoke.test.js')"
```

Expected: PASS; each checker used and removed a newly created tgz/consumer, the archive contains MCP JavaScript and declarations but no evaluation assets, root Bundler/core NodeNext/MCP NodeNext declarations each resolve in their intended isolated graph, the MCP graph retains Node types without leaking root AI/MapLibre/DOM declarations, installed exports/binaries work without source or workspace fallback, and importing it has no startup behavior.

- [ ] **Step 5: Commit release-ready packaging and docs (2 minutes).**

```bash
rtk git add scripts/check-package.mjs README.md src/mcp/package-smoke.test.ts
rtk git commit -m "docs: package MapLibre style MCP server"
```

### Task 14: Run the full quality gate and record protocol invariants

**Files:**
- Modify: `README.md`
- Create: `src/mcp/contract.test.ts`
- Modify: `src/mcp/integration.test.ts`
- Create: `evals/maplibre-style-mcp.xml`
- Create: `evals/maplibre-style-mcp-fixture-server.mjs`

**Interfaces:**
- Consumes: every public MCP export, generated server metadata version, all eight tool configurations, six resource templates, linked in-memory integration, stdio binary, optional HTTP listener, built package artifact, and MCP Builder evaluation format.
- Produces: a regression contract suite that fails on renamed/misdescribed tools/resources, changed core-derived session or independent transport limits, envelope divergence, unsafe endpoint defaults, import-time side effects, or an invalid/non-independent ten-question read-only evaluation set.

- [ ] **Step 1: Write a failing cross-boundary invariant test (5 minutes).**

```ts
test('MCP contract retains exact tools, resources, store defaults, and envelope parity', async () => {
  const contract = await inspectMcpContract();
  assert.deepEqual(contract.serverVersion, { name: 'maplibre-style-mcp-server', version: MCP_SERVER_VERSION });
  assert.deepEqual(contract.toolNames, ['style_session_open', 'style_session_close', 'style_validate', 'style_inspect', 'style_search_layers', 'style_analyze_geojson', 'style_apply_transaction', 'style_export']);
  assert.deepEqual(contract.resourceTemplates, styleResourceTemplates);
  assert.deepEqual(contract.limits, { maxSessions: 32, maxStyleBytes: 5 * 1024 * 1024, maxOperations: 100, maxHistory: 20, maxDiffBytes: 1024 * 1024, ttlMs: 30 * 60_000 });
  assert.strictEqual(contract.limits.maxStyleBytes, DEFAULT_MAX_STYLE_BYTES);
  assert.strictEqual(contract.limits.maxOperations, DEFAULT_MAX_OPERATIONS);
  assert.strictEqual(contract.limits.maxDiffBytes, DEFAULT_MAX_DIFF_BYTES);
  assert.strictEqual(MAX_MCP_MESSAGE_BYTES, 5 * 1024 * 1024);
  for (const result of contract.sampleToolResults) {
    const first = result.content[0];
    assert.ok(first);
    if (!first || first.type !== 'text') assert.fail('expected text tool content');
    assert.deepEqual(JSON.parse(first.text), result.structuredContent);
  }
});

test('MCP Builder evaluation file has ten independent read-only answers', async () => {
  const pairs = parseEvaluationXml(await readFile('evals/maplibre-style-mcp.xml', 'utf8'));
  assert.equal(pairs.length, 10);
  for (const pair of pairs) {
    assert.ok(pair.question.trim().length > 0);
    assert.ok(pair.answer.trim().length > 0);
    assert.equal(pair.answer.includes('\n'), false);
    assert.doesNotMatch(pair.question, /style_(?:session_open|session_close|apply_transaction)/);
    assert.doesNotMatch(pair.question, /fetch|download|internet|current time/i);
  }
});
```

- [ ] **Step 2: Run the invariant test and observe a failure for any unasserted contract (2 minutes).**

```bash
rtk pnpm run pretest
rtk pnpm exec tsc -p tsconfig.test.json
rtk node scripts/run-tests.mjs --test-name-pattern="MCP contract retains|MCP Builder evaluation"
```

Expected: FAIL until the test’s contract inspector reads real registered capabilities/defaults and the ten-question XML exists.

- [ ] **Step 3: Implement the contract inspector strictly in test support (4 minutes).**

```ts
const inspectMcpContract = async () => {
  const created = createMapLibreStyleMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'contract-test', version: '1.0.0' });
  try {
    await Promise.all([created.connect(serverTransport), client.connect(clientTransport)]);
    return await collectContractFromOfficialClient(client, created.store);
  } finally {
    await Promise.allSettled([client.close(), created.close()]);
  }
};
```

Do not add production test-only introspection. Use real `Client.listTools()`, `listResourceTemplates()`, tool calls, explicit resource reads, `getServerVersion()`, and the immutable `created.store.limits` production configuration exposed by Task 5. Assert each listed tool's title/description/non-empty object input schema/four annotations against Task 9 and assert no advertised `outputSchema`. In `collectContractFromOfficialClient`, immediately wrap every awaited `client.callTool(...)` with `parseOfficialCallToolResult`, type `sampleToolResults` as the resulting official `CallToolResult[]`, and only then inspect `content`/`structuredContent`; the raw compatibility union must never enter the returned contract. Independently narrow every parsed result's content member by `type === 'text'` before `.text`; no unchecked `content[0].text` is allowed. Narrow resource content independently by `'text' in content`. Always close client/server in `finally`, including failed collection.

Implement a bounded test-only parser for the exact MCP Builder grammar `<evaluation><qa_pair><question>…</question><answer>…</answer></qa_pair>…</evaluation>` with XML entity decoding and rejection of unexpected/malformed nodes; do not add a runtime XML dependency. Create exactly ten `qa_pair` elements. Each question names its complete immutable fixture contract plus a unique pre-seeded session ID `eval-01` through `eval-10`; the dedicated fixture server opens those styles before accepting stdio, so the evaluated agent never needs a mutating tool and no question depends on a previous question. No fixture may fetch a URL or use current/external data.

`evals/maplibre-style-mcp-fixture-server.mjs` is an evaluation-only executable, excluded by the package packlist. It imports the built public `./mcp` API plus the built Node-internal `dist/mcp/stdio.js` `writeMcpStderrLine` helper, creates one caller-owned store with a deterministic ID sequence, opens exactly ten inline fixture styles, asserts the returned IDs match the XML, then calls public `runStdioMcp({serverOptions:{store}})` so it shares the production server metadata, handlers/schemas/resources, bounded NDJSON framing, and lifecycle. It only differs by deterministic startup seeding. Use the nested-finally ownership pattern below on normal EOF/signal and every failure; since the server does not own the injected store, the runner disposes it exactly once after the server-close attempt. Seed failure and startup failure also dispose it, use awaited `writeMcpStderrLine` for any fixed diagnostic, and exit before protocol connection. Do not add hidden fixtures or seed flags to the production binary.

```js
const store = createStyleSessionStore({ idFactory: createEvalIdFactory() });
let started;
try {
  await seedAndAssertTenSessions(store);
  started = await runStdioMcp({ serverOptions: { store } });
  await started.closed;
} finally {
  try {
    if (started) await started.close();
  } finally {
    store.dispose();
  }
}
```

Keep `store.dispose()` outside the conditional and in the nested `finally`, so seed rejection, stdio startup rejection, and even a started-close rejection dispose the caller-owned store. The store implementation's dispose is idempotent, but the harness itself calls it exactly once and only after the started server's close attempt settles.

The ten questions must be realistic multi-hop tasks with one single-line, direct-string answer and collectively cover these read-only surfaces:

| Pair | Required read-only path | Stable answer kind |
|---:|---|---|
| 1 | inline `style_validate` + session context resource | `True`/`False` |
| 2 | `style_inspect(context)` + `style_search_layers` | one layer ID |
| 3 | search + two layer resources | one paint color |
| 4 | `style_inspect(sourceLayers)` + source resource | one source-layer name |
| 5 | inline `style_analyze_geojson` + validation | one feature count |
| 6 | session GeoJSON analysis + source/style resources | one geometry type |
| 7 | `style_export` + style resource comparison | one revision number |
| 8 | session metadata + context + export | one layer count |
| 9 | search + layer/source resource joins | one source ID |
| 10 | validation + context/layer resource consistency | `True`/`False` |

Each case's test fixture/solver starts from a fresh store, uses at least two listed read-only calls/resource reads, recomputes the answer, and compares it to the XML answer. Resource reads expand the advertised literal-marker templates with raw `eval-*`, layer, source, and revision values, and the test asserts those URIs equal the exported helper output; no eval embeds a pre-marked variable workaround. The fixture seed is test setup, not an evaluated tool call. Add a subprocess smoke that uses the artifact already built by the quality gate (the test body itself never builds/cleans), starts the dedicated fixture server, connects an official stdio client, reads `eval-01`, and always closes it. README shows the user command as `node evals/maplibre-style-mcp-fixture-server.mjs` without the developer-local wrapper; plan verification fences still prefix commands with `rtk`. Never claim the default `maplibre-style-mcp` binary contains or can discover those sessions.

- [ ] **Step 4: Run the complete quality gate (5 minutes).**

```bash
rtk pnpm run build
rtk pnpm run lint
rtk pnpm run typecheck
rtk pnpm run check:mcp-version
rtk node scripts/check-mcp-typegraph.mjs
rtk pnpm test
rtk node scripts/check-package.mjs
```

Expected: PASS; the build occurs before the full test command, `pnpm test` executes its composed pretest cleanup/generation checks rather than bypassing them, all ten eval answers are reproducible from independent fixtures, and direct tests, official in-memory integration, stdio subprocess checks, protected HTTP client checks, and a fresh packed-artifact/type-resolution smoke all remain green.

- [ ] **Step 5: Commit the final regression contract (2 minutes).**

```bash
rtk git add README.md src/mcp/contract.test.ts src/mcp/integration.test.ts evals/maplibre-style-mcp.xml evals/maplibre-style-mcp-fixture-server.mjs
rtk git commit -m "test: lock MapLibre style MCP contract"
```

## Implementation Handoff

Execute tasks in numeric order because each task publishes the interfaces consumed by the next. Keep test data as inline JSON fixtures so no tool, resource, test, or transport path can be interpreted as a request to read a local file. Before beginning any task, inspect the current worktree and preserve changes from other workers; after each task, run only its focused checks before committing its exact file set.

The completed server will have one application-level in-memory store per factory or HTTP process, a distinct SDK transport session for each MCP connection, and no network or process activity until an explicit stdio or HTTP runner calls the factory's bounded `connect()`.
