# MapLibre Live Browser Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated, revision-safe browser WebSocket bridge that lets the existing MCP server inspect and mutate a real MapLibre GL JS 6 map, with bounded runtime commands and a standalone end-to-end example.

**Architecture:** A browser-safe protocol/client entry point communicates with an internal Node `ws` server. The server owns connection correlation and a per-map registry; the browser remains authoritative for the live Style, rechecks revision/hash at queue dequeue, applies pure-core transactions through the MapLibre adapter, and reports a new snapshot only after MapLibre finishes loading it. Live MCP tools/resources are registered through the extension seam created by the MCP document-session plan.

**Tech Stack:** TypeScript 5.9, Node.js `>=22.13.0`, MapLibre GL JS `^6.3.0`, Zod 4, `ws ^8.21.3`, `@modelcontextprotocol/sdk ^1.30.0`, Vite `^8.2.1`, Playwright `^1.62.1`, Node test runner.

## Global Constraints

- Execute only after standalone extraction, core foundation, layer/data, CLI, and MCP document-session plans are complete and green. The fixed delivery order is `standalone extraction → core foundation → layer/data → CLI → MCP → live bridge`; this plan consumes those public interfaces and does not duplicate their logic.
- Protocol version is exactly `1`; every frame carries `protocolVersion`, and every request/result pair carries the same opaque `correlationId`.
- The canonical Style hash is lowercase SHA-256 hex over UTF-8 canonical JSON with recursively sorted object keys and preserved array order.
- Default hard limits are 5 MiB per protocol frame or Style document, 100 operations per transaction, 100 features and 1 MiB serialized output per query, and one absolute 10-second deadline per operation. Queue time, transport, hashing, resource loading, MapLibre completion, and rollback all consume that same budget; no layer may restart it.
- Core execution and frame overrides are negotiated, not assumed: the authenticated server result advertises its positive-safe-integer ceilings for message bytes, Style bytes, diff bytes, and operations; registration declares the browser's effective values; omitted browser values use the lower of core defaults and server ceilings, while an explicit raise is accepted only when both server and browser opt into it. The registry stores and enforces that exact set before dispatch, and the browser passes the same core values through the adapter.
- A Style that is valid at the 5 MiB document limit is not assumed to fit inside a 5 MiB protocol envelope. Every browser-originated registration, result, and event is measured after full UTF-8 JSON encoding and follows one deterministic typed degradation order: omit optional Style, omit optional transaction diff, then use a receipt or metadata-only authoritative snapshot. Revision/hash from every correlated `applyTransaction` failure with `styleAuthority:'current'`—including ordinary `INTERNAL`/`IO_ERROR`, conflicts, and post-timeout settlement—is never replaced by a generic size error; non-mutation failures may not carry an authoritative snapshot.
- The WebSocket server listens on `127.0.0.1` by default, requires an explicit Origin allowlist, and authenticates the first frame with a bearer token containing 32–256 UTF-8 bytes; an omitted token is generated from exactly 32 random bytes.
- Every registration carries one browser-generated cryptographically random persistent `registrationAttemptId`. Server-side registration receives an unforgeable socket-generation liveness capability, commits only while that generation is current, and replays an ack-lost attempt idempotently with the same lease. A replay generation is installed unknown/no-dispatch, rejects old-generation work, and becomes known only after its mandatory authoritative snapshot confirmation; the finite client replay budget is shorter than the bounded server record retention, with one record per map and a global hard cap. A different attempt or live owner cannot borrow it.
- Live mutations are serialized per map and must carry both `expectedRevision` and `expectedStyleHash`; the browser atomically recomputes and rechecks both only after the command reaches the front of its queue.
- The layer's `PreparedMapStyleTransaction` is a provenance-bearing opaque handle. Bridge code may inspect only its deeply readonly `view.baselineHash` and `view.transactionResult.style`, must revalidate the latter into an ordinary core `StyleDocument` before byte/hash/policy work, and must pass the original handle by identity to `applyPreparedStyleToMap`; it never casts/mutates the view, reads private baseline/candidate authority, or rebuilds/clones a handle.
- The live resource collection URI is exactly `maplibre-style://maps`; dynamic metadata/style resources use the literal-marker templates `maplibre-style://maps/~{mapId}` and `maplibre-style://maps/~{mapId}/style`. Public URI builders accept a semantic, never pre-encoded, map ID and encode it once. The shared raw transport admission validates the original URI before SDK `new URL`, rejects normalization-changing/dot/non-canonical aliases with zero resolver work, and only then permits one defensive marked-segment decode in the callback.
- The server mirror changes only after a schema-valid, correlation-valid, capability-compatible browser result or authoritative resynchronization snapshot. A disconnect returns `BRIDGE_DISCONNECTED`; a revision conflict triggers metadata resynchronization and is never automatically retried.
- Every official SDK `Client.callTool()` result is first narrowed from the SDK compatibility union with the MCP package's exported `parseOfficialCallToolResult`; only that parsed result's `structuredContent` may be passed to `parseMcpToolEnvelope` or otherwise accessed.
- Every live MCP extension receives the factory's one frozen `McpServerExtensionContext`; tools/resources use that exact resolved `messagePolicy`, `responseBoundary`, and raw resource-admission composition seam, never a private default. Actual read results cross an atomic caller finalizer before cache/mirror/touch/settlement (a browser read itself may already have run), mutation tools project fixed bounded receipts whose fit is proven before dispatch, mutation failures become fresh authentic metadata-only errors that preserve safe code/revision/hash without Style/secrets, and every actual success/failure/resource result crosses the matching `require*` boundary before it can reach a transport.
- A baseline Style may retain an unchanged resource URL at the same JSON Pointer. Every newly introduced or changed absolute URL-bearing field requires `network.load` and an explicit matching rule; newly introduced or changed relative Style URLs are always rejected before any Map call, regardless of `resourceBaseUrl` or `document.baseURI`. Relative runtime-image inputs are a separate API and are resolved/authorized once to the exact absolute URL passed to the loader.
- `src/bridge/index.ts` is browser-safe and must never export or import the Node WebSocket server, registry, `ws`, Node HTTP, or Node crypto modules.
- The browser example uses an empty local Style plus inline GeoJSON, performs no external tile/glyph/sprite/image request, and is excluded from the npm tarball.
- Do not modify `/Users/zhang/code/ai-style-editor`; do not publish, push, add CI, or change licensing.
- All shell commands in this plan are run from `/Users/zhang/code/maplibre-style-tools` and begin with `rtk`.

---

### Task 1: Versioned protocol, bounded codec, correlation, and canonical Style hashing

**Files:**
- Create: `src/bridge/protocol.ts`
- Create: `src/bridge/codec.ts`
- Create: `src/bridge/protocol.test.ts`

**Interfaces:**
- Consumes: `StyleDocument`, `StyleTransaction`, `StyleToolError`, `StyleDiffEntry`, `styleDocumentSchema`, core `createStyleTransactionSchema(maxOperations)`, and the single canonical `canonicalizeJson` implementation from `src/core/index.ts`; `sha256CanonicalJson`/`hashStyle` from `src/adapters/maplibre/style-hash.ts`.
- Produces: `BRIDGE_PROTOCOL_VERSION`, `MAX_BRIDGE_MESSAGE_BYTES`, browser-safe shared `REGISTRATION_REPLAY_CLIENT_BUDGET_MS`/`REGISTRATION_ATTEMPT_RETENTION_MS`, `BridgeLimitSetSchema`, `BridgeCapabilitySchema`, shared `BridgeMapIdSchema`, `RegistrationAttemptIdSchema`, bridge-local wire schemas for stable errors/diffs, `MapSnapshotMetadataSchema`, `MapSnapshotSchema`, `BridgeAuthFrameSchema`, `BridgeRegisterFrameSchema`, the ten strict schemas in `BridgeCommandVariantSchemas`, `BridgeCommandFrameSchema`, `BridgeResultFrameSchema`, `BridgeEventFrameSchema`, `BridgeFrameSchema`, `AuthoritativeSnapshotDetailsSchema`, value mapping `BRIDGE_COMMAND_RESULT_TYPES`, type lookup `BridgeCommandResultMap`/`BridgeResultFor<C>`, `encodeBridgeFrame(frame, maxBytes?)`, `decodeBridgeFrame(data, schema, maxBytes?)`, and `assertCorrelated(request, result)`. It does not create a second canonicalization or hash implementation.

- [ ] **Step 1: Write failing canonicalization and hash tests**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalizeJson } from '../core/index.js';
import { sha256CanonicalJson } from '../adapters/maplibre/style-hash.js';
import { BRIDGE_PROTOCOL_VERSION } from './protocol.js';

test('canonical JSON sorts object keys recursively but preserves arrays', async () => {
  assert.equal(BRIDGE_PROTOCOL_VERSION, 1);
  const left = { z: [{ b: 2, a: 1 }], a: true };
  const right = { a: true, z: [{ a: 1, b: 2 }] };
  assert.equal(canonicalizeJson(left), '{"a":true,"z":[{"a":1,"b":2}]}');
  assert.equal(await sha256CanonicalJson(left), await sha256CanonicalJson(right));
});

test('canonical JSON rejects cycles and non-JSON numeric values', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeJson(cyclic), /JSON value/);
  assert.throws(() => canonicalizeJson({ n: Number.NaN }), /finite/);
});
```

- [ ] **Step 2: Compile to verify protocol reuse before adding its schemas**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json`

Expected: FAIL because `src/bridge/protocol.ts` and `src/bridge/codec.ts` do not exist; the explicit `BRIDGE_PROTOCOL_VERSION` import guarantees this red step cannot pass merely because the reused canonical/hash functions already exist.

- [ ] **Step 3: Lock reuse of the existing canonical JSON and Web Crypto SHA-256**

Keep the test imports pointed at `src/core/index.ts` and `src/adapters/maplibre/style-hash.ts`. Add no bridge-local implementation or wrapper. This makes the Map adapter, external-change detector, registry snapshots, and MCP results compare exactly the same lowercase SHA-256.

- [ ] **Step 4: Write failing protocol/codec tests for version, size, and correlation**

```ts
test('codec rejects oversized and wrong-version frames', () => {
  const auth = { protocolVersion: 1, kind: 'auth', correlationId: 'auth-1', token: 'x'.repeat(43) };
  const encoded = encodeBridgeFrame(auth);
  assert.deepEqual(decodeBridgeFrame(encoded, BridgeAuthFrameSchema), auth);
  assert.throws(() => decodeBridgeFrame(encoded, BridgeAuthFrameSchema, 8), /5 MiB|size limit/);
  assert.throws(
    () => decodeBridgeFrame(JSON.stringify({ ...auth, protocolVersion: 2 }), BridgeAuthFrameSchema),
    /protocolVersion/,
  );
});

test('correlation rejects a result for a different request', () => {
  const request = { protocolVersion: 1 as const, kind: 'command' as const, correlationId: 'a', mapId: 'map', command: { type: 'getStyle' as const } };
  const result = { protocolVersion: 1 as const, kind: 'result' as const, correlationId: 'b', ok: true as const, result: { type: 'style', revision: 0, styleHash: '0'.repeat(64), style: { version: 8, sources: {}, layers: [] } } };
  assert.throws(() => assertCorrelated(request, result), /correlation/);
});

test('correlation rejects the wrong success discriminant for a command', () => {
  const request = commandFrame('applyTransaction', { correlationId: 'same', deadlineAt: now + 10_000 });
  const forged = successFrame('same', { type: 'ack' });
  assert.throws(() => assertCorrelated(request, forged), /expected transaction/);
});

test('strict protocol round-trips explicit transaction degradation markers', () => {
  const degraded = resultFrame({
    type: 'transaction', detail: 'full', revision: 1, styleHash: hash1,
    applied: true, noOp: false, changedLayerIds: ['roads'], changedSourceIds: [],
    warnings: [], omitted: { style: true, diff: true },
  });
  assert.deepEqual(BridgeResultFrameSchema.parse(degraded), degraded);
  assert.throws(
    () => BridgeResultFrameSchema.parse({ ...degraded, result: { ...degraded.result, omitted: { style: false } } }),
    /omitted/,
  );
});

test('transaction success has exactly one semantic applied/no-op branch', () => {
  assert.equal(BridgeResultFrameSchema.safeParse(resultFrame(transactionReceipt({
    revision: 1, styleHash: hash1, applied: true, noOp: false,
  }))).success, true);
  assert.equal(BridgeResultFrameSchema.safeParse(resultFrame(transactionReceipt({
    revision: 0, styleHash: hash0, applied: false, noOp: true,
  }))).success, true);
  for (const flags of [
    { applied: true, noOp: true },
    { applied: false, noOp: false },
  ]) {
    assert.equal(BridgeResultFrameSchema.safeParse(resultFrame(transactionReceipt({
      revision: 1, styleHash: hash1, ...flags,
    }))).success, false);
  }
});

test('wire transaction structure admits a negotiated 101st operation', () => {
  const command = applyCommandWithOperationCount(101);
  assert.equal(BridgeCommandSchema.safeParse(command).success, true);
});

test('map IDs reject literal or encoded dot-segment spellings without rejecting ordinary dots', () => {
for (const invalid of ['.', '..', '%2e', '%2E', '%2e%2e', '%252e']) {
  assert.equal(BridgeMapIdSchema.safeParse(invalid).success, false);
}
assert.equal(BridgeMapIdSchema.safeParse('a.b').success, true);
assert.equal(BridgeRegisterFrameSchema.safeParse(registerFrame({ mapId: '..' })).success, false);
});

test('registration attempt IDs are exact 32-byte base64url tokens', () => {
  const valid = 'A'.repeat(43);
  assert.equal(RegistrationAttemptIdSchema.parse(valid), valid);
  assert.equal(BridgeRegisterFrameSchema.safeParse(registerFrame({ registrationAttemptId: valid })).success, true);
  for (const invalid of ['', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`, `${'A'.repeat(42)}+`]) {
    assert.equal(RegistrationAttemptIdSchema.safeParse(invalid).success, false);
    assert.equal(BridgeRegisterFrameSchema.safeParse(registerFrame({ registrationAttemptId: invalid })).success, false);
  }
});

test('fixed query/image result schemas reject impossible collection metadata', () => {
  assert.equal(BridgeResultFrameSchema.safeParse(successFrame('q', featuresResult({
    features: featureArray(101), returned: 101, serializedBytes: 1, truncated: false,
  }))).success, false);
  assert.equal(BridgeResultFrameSchema.safeParse(successFrame('q', featuresResult({
    features: featureArray(1), returned: 0, serializedBytes: 1, truncated: false,
  }))).success, false);
  assert.equal(BridgeResultFrameSchema.safeParse(successFrame('i', imagesResult({
    imageIds: imageIdArray(501), serializedBytes: 1,
  }))).success, false);
});

test('mapStatus can only announce unknown; recovery requires a snapshot', () => {
  assert.equal(BridgeEventFrameSchema.safeParse(mapStatusEvent({ syncState: 'unknown' })).success, true);
  assert.equal(BridgeEventFrameSchema.safeParse(mapStatusEvent({ syncState: 'known' })).success, false);
  assert.equal(BridgeEventFrameSchema.safeParse(mapStatusEvent({ syncState: 'unknown', details: {} })).success, false);
});
```

- [ ] **Step 5: Run the focused test to verify the protocol surface is red**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json`

Expected: FAIL with missing exports from `protocol.ts` or `codec.ts`.

- [ ] **Step 6: Define all protocol schemas as closed discriminated unions**

```ts
export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export const MAX_BRIDGE_MESSAGE_BYTES = 5 * 1024 * 1024;
export const REGISTRATION_REPLAY_CLIENT_BUDGET_MS = 30_000;
export const REGISTRATION_ATTEMPT_RETENTION_MS = 60_000;
export const BridgeLimitSetSchema = z.strictObject({
  maxMessageBytes: z.number().int().safe().positive(),
  maxStyleBytes: z.number().int().safe().positive(),
  maxDiffBytes: z.number().int().safe().positive(),
  maxOperations: z.number().int().safe().positive(),
});
export const BridgeCapabilitySchema = z.enum([
  'style.read', 'style.write', 'features.query', 'runtime.state', 'images.write', 'network.load',
]);
export const BridgeMapIdSchema = z.string()
  .min(1).max(128)
  .regex(/^[A-Za-z0-9._-]+$/)
  .refine((value) => value !== '.' && value !== '..', 'mapId must not be a URL dot segment');
export const RegistrationAttemptIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const BridgeTokenSchema = z.string().refine((value) => {
  const bytes = new TextEncoder().encode(value).byteLength;
  return bytes >= 32 && bytes <= 256;
}, 'token must contain 32..256 UTF-8 bytes');
export const MapSnapshotMetadataSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  styleHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const MapSnapshotSchema = MapSnapshotMetadataSchema.extend({
  style: styleDocumentSchema.optional(),
});
export const BridgeAuthFrameSchema = z.strictObject({
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  kind: z.literal('auth'),
  correlationId: z.string().min(1).max(128),
  token: BridgeTokenSchema,
});
export const BridgeRegisterFrameSchema = z.strictObject({
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  kind: z.literal('register'),
  correlationId: z.string().min(1).max(128),
  registrationAttemptId: RegistrationAttemptIdSchema,
  mapId: BridgeMapIdSchema,
  replaceLeaseId: z.string().min(32).max(256).optional(),
  capabilities: z.array(BridgeCapabilitySchema).max(6),
  limits: BridgeLimitSetSchema,
  snapshot: MapSnapshotSchema,
});
```

Create one bridge structural transaction schema with `createStyleTransactionSchema(Number.MAX_SAFE_INTEGER)` and reuse its operation union/sanitizer; actual allocation is bounded first by the negotiated frame decoder, so this is not a competing operational limit. Export one immutable `BridgeCommandVariantSchemas` object whose values are ten `z.strictObject` schemas for exactly these command discriminants and inputs: `getStyle`, `applyTransaction`, `querySourceFeatures`, `queryRenderedFeatures`, `setFeatureState`, `removeFeatureState`, `setGlobalState`, `listImages`, `addImage`, and `removeImage`; build `BridgeCommandSchema` as their discriminated union rather than hiding the variants inside an unexported union. `BridgeCommandFrameSchema` reuses `BridgeMapIdSchema` and additionally requires absolute integer `deadlineAt` (Unix milliseconds); it is stamped exactly once when `LiveMapRegistry.execute` accepts the request into its per-map queue, so server queue time is included, and no later server/browser layer refreshes it. The dot-segment refinement is shared by registration, command frames, browser client, server, registry, MCP tools, and resource templates; no layer redefines only the regex. `applyTransaction` contains `expectedRevision`, `expectedStyleHash`, and a structurally valid non-empty transaction; do not import the default 100-operation schema or hand-redeclare core operations, because the registry/runtime/core must apply the registered negotiated `maxOperations`. Query inputs retain their independent fixed `limit <= 100` and property allowlist of at most 100 names; RGBA image input contains `width`, `height`, and base64 bytes, while URL image input contains one `url`.

Define bridge-local strict wire schemas matching `StyleToolError` and `StyleDiffEntry`, plus `AuthoritativeSnapshotDetailsSchema = z.strictObject({currentSnapshot: MapSnapshotSchema})` for authoritative mutation-failure narrowing. Define the success result as an explicit discriminated union with exactly `authenticated`, `registered`, `style`, `transaction`, `features`, `state`, `images`, and `ack` result schemas; each carries only the fields valid for that discriminant, and snapshots use optional `style`. `authenticated` carries the server's `BridgeLimitSet` ceilings; `registered` echoes the exact accepted effective limits with the lease so both ends can assert agreement. At the shape boundary, `features.features` has `.max(100)`, `returned` is `0..100`, a refinement requires `returned === features.length`, and claimed `serializedBytes` is an integer `0..1 MiB`; `images.imageIds` has `.max(500)` and claimed `serializedBytes` is `0..64 KiB`. Task 3 still recomputes bytes and checks the correlated request/property allowlist because these declared counters are untrusted. The `transaction` schema itself is discriminated as:

- `detail:'full'`: revision, styleHash, applied, noOp, changed IDs/warnings, optional Style, optional diff, and an optional strict `omitted:{style?:true,diff?:true}` marker. The marker accepts literal `true` only and a refinement rejects `omitted.style` alongside an actual `style` or `omitted.diff` alongside an actual `diff`. It is permitted on the wire only when the registered peer has `style.read`.
- `detail:'receipt'`: only type/detail, revision, styleHash, applied, and noOp. It is safe for write-only peers and is also the final size-degradation form for read-capable peers.

Refine both transaction variants to exactly one semantic success branch: either `{applied:true,noOp:false}` or `{applied:false,noOp:true}`. This shape-level invariant is necessary but not sufficient: Task 3 also validates revision/hash context against the correlated pending command before settlement (no-op keeps the exact baseline pair; applied advances exactly once and changes the hash).

`BridgeResultFrameSchema` is then `ok:true + result union` or `ok:false + stable error`. Bound error code/message/path lengths. Structurally, any stable primary error code may carry `AuthoritativeSnapshotDetailsSchema`, because this frame alone does not contain the correlated command; Task 2 projection and Task 3 pending-correlation validation must reject it unless the request was `applyTransaction` and runtime reported `styleAuthority:'current'`. This includes ordinary `INTERNAL`/`IO_ERROR`, `REVISION_CONFLICT`, and post-deadline `TIMEOUT` while preserving the original code. The details object remains valid after Style omission, so metadata-only revision/hash is a first-class value. Define `BridgeEventFrameSchema` for `mapSnapshot`, `externalStyleChange`, and strict `mapStatus = {kind/event metadata, syncState:'unknown'}` with no `known` variant or arbitrary JSON details. Synchronization can become known only through a validated authoritative snapshot/result. Add round-trip tests for every result/event variant, full and metadata-only `INTERNAL`/`IO_ERROR` mutation failures, both full and degraded transaction results, full/metadata-only snapshots, and the one status shape. Both protocol and Node server must import the same `BridgeTokenSchema`; there is no separate server-only minimum.

Export one immutable mapping: auth→`authenticated`, register→`registered`, getStyle→`style`, applyTransaction→`transaction`, both queries→`features`, feature/global-state commands→`state`, listImages→`images`, and add/remove image→`ack`. Define the matching compile-time lookup explicitly:

```ts
export interface BridgeCommandResultMap {
  getStyle: BridgeStyleResult;
  applyTransaction: BridgeTransactionResult;
  querySourceFeatures: BridgeFeaturesResult;
  queryRenderedFeatures: BridgeFeaturesResult;
  setFeatureState: BridgeStateResult;
  removeFeatureState: BridgeStateResult;
  setGlobalState: BridgeStateResult;
  listImages: BridgeImagesResult;
  addImage: BridgeAckResult;
  removeImage: BridgeAckResult;
}
export type BridgeResultFor<C extends BridgeCommand> = BridgeCommandResultMap[C['type']];
```

`assertCorrelated` validates protocol version, correlation ID, and this expected success discriminant before any caller settles or mirror state changes. A pending request stores the expected discriminant; a forged same-ID result of another type is a protocol error. Add compile-only assertions that `BridgeResultFor<Extract<BridgeCommand,{type:'getStyle'}>>` exposes `style` while the apply result exposes `detail`, and that neither field is available on the other result type.

- [ ] **Step 7: Implement the UTF-8 codec and strict request/result correlation**

```ts
export function encodeBridgeFrame(frame: unknown, maxBytes = MAX_BRIDGE_MESSAGE_BYTES): string {
  const encoded = JSON.stringify(BridgeFrameSchema.parse(frame));
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) throw new RangeError('bridge frame exceeds size limit');
  return encoded;
}

export function decodeBridgeFrame<T>(
  data: string | ArrayBuffer | ArrayBufferView,
  schema: z.ZodType<T>,
  maxBytes = MAX_BRIDGE_MESSAGE_BYTES,
): T {
  const bytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.byteLength > maxBytes) throw new RangeError('bridge frame exceeds size limit');
  return schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}

export function assertCorrelated(
  request: BridgeAuthFrame | BridgeRegisterFrame | BridgeCommandFrame,
  result: BridgeResultFrame,
): void {
  if (request.correlationId !== result.correlationId) throw new Error('bridge correlation mismatch');
  if (result.ok && result.result.type !== expectedResultType(request)) throw new Error(`expected ${expectedResultType(request)} result`);
}
```

- [ ] **Step 8: Run protocol tests and the browser-only typecheck**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/bridge/protocol.test.js`

Expected: PASS, including equal hashes for differently ordered objects, version rejection, size rejection, exact 43-character registration-attempt tokens, transaction applied/no-op exclusivity, structural round trips for authoritative current snapshots under every primary error code, and correlation rejection; command-aware tests later prove only correlated mutations may use that structural option.

- [ ] **Step 9: Commit the protocol boundary**

```bash
rtk git add src/bridge/protocol.ts src/bridge/codec.ts src/bridge/protocol.test.ts
rtk git commit -m "feat: define live bridge protocol"
```

### Task 2: Capability authorization, deterministic outbound projection, and exhaustive resource URL policy

**Files:**
- Create: `src/bridge/capabilities.ts`
- Create: `src/bridge/outbound.ts`
- Create: `src/bridge/outbound.test.ts`
- Create: `src/bridge/resource-policy.ts`
- Create: `src/bridge/resource-policy.test.ts`

**Interfaces:**
- Consumes: `BridgeCapability` and `BridgeCommand` from `src/bridge/protocol.ts`; `StyleDocument`, `StyleToolError`, and `createStyleToolError` from `src/core/index.ts`.
- Produces: `requiredCapabilityForCommand(command)`, `assertCapability(capabilities, command)`, `publicBridgeErrorMessage(code)`, `assertInboundResultAllowed(capabilities, command, result)`, `assertInboundEventAllowed(capabilities, event)`, typed `prepareOutboundBridgeFrame` overloads whose result form requires its correlated `BridgeCommand`, `ResourcePolicy`, internal-module export `normalizeResourcePolicy(policy): NormalizedResourcePolicy`, `ResourceReference`, `collectStyleResourceReferences(style)`, `assertStyleResourcePolicy(input)`, `assertRuntimeImageResourcePolicy(input): {resolvedUrl:string}`, and `redactResourceUrl(value)`.

- [ ] **Step 1: Write failing capability matrix tests**

```ts
test('each command requires its explicit capability', () => {
  assert.equal(requiredCapabilityForCommand({ type: 'getStyle' }), 'style.read');
  assert.equal(requiredCapabilityForCommand(applyCommand), 'style.write');
  assert.equal(requiredCapabilityForCommand(sourceQueryCommand), 'features.query');
  assert.equal(requiredCapabilityForCommand(setFeatureStateCommand), 'runtime.state');
  assert.equal(requiredCapabilityForCommand(addRgbaImageCommand), 'images.write');
  assert.throws(() => assertCapability(['style.read'], applyCommand), (error: StyleToolError) => error.code === 'CAPABILITY_DENIED');
});
```

- [ ] **Step 2: Run the capability test to verify it is red**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json`

Expected: FAIL because `src/bridge/capabilities.ts` does not exist.

- [ ] **Step 3: Implement one exhaustive command-to-capability switch**

```ts
export function requiredCapabilityForCommand(command: BridgeCommand): BridgeCapability {
  switch (command.type) {
    case 'getStyle':
    case 'listImages': return 'style.read';
    case 'applyTransaction': return 'style.write';
    case 'querySourceFeatures':
    case 'queryRenderedFeatures': return 'features.query';
    case 'setFeatureState':
    case 'removeFeatureState':
    case 'setGlobalState': return 'runtime.state';
    case 'addImage':
    case 'removeImage': return 'images.write';
  }
}
```

`assertCapability` must return a `CAPABILITY_DENIED` error containing only the command type and required capability; it must not include Style contents or command values.

- [ ] **Step 4: Write failing outbound degradation and inbound capability-contract tests**

```ts
test('a near-limit registration deterministically falls back to metadata-only', () => {
  const style = validStyleWithinDocumentLimitButTooLargeForRegistrationFrame();
  const prepared = prepareOutboundBridgeFrame(registerFrame(snapshot(7, hash7, style)), ['style.read']);
  assert.ok(new TextEncoder().encode(prepared.encoded).byteLength <= MAX_BRIDGE_MESSAGE_BYTES);
  assert.deepEqual(prepared.frame.snapshot, { revision: 7, styleHash: hash7 });
});

test('full transactions degrade through Style and diff omission before a receipt', () => {
  const result = fullTransactionResult({ style: nearLimitStyle, diff: nearLimitDiff });
  const withoutStyle = prepareOutboundBridgeFrame(resultFrame(result), ['style.read'], applyCommand, fullWithoutStyleBudget);
  assert.equal(withoutStyle.frame.ok && withoutStyle.frame.result.type === 'transaction' && withoutStyle.frame.result.detail, 'full');
  assert.deepEqual(withoutStyle.frame.ok && withoutStyle.frame.result.type === 'transaction' && withoutStyle.frame.result.omitted, { style: true });
  const receipt = prepareOutboundBridgeFrame(resultFrame(result), ['style.read'], applyCommand, receiptOnlyBudget);
  assert.equal(receipt.frame.ok && receipt.frame.result.type === 'transaction' && receipt.frame.result.detail, 'receipt');
});

test('every current-authority mutation failure keeps its code and authoritative metadata', () => {
  for (const code of ['INTERNAL', 'IO_ERROR', 'REVISION_CONFLICT', 'TIMEOUT'] as const) {
    const prepared = prepareOutboundBridgeFrame(
      failureFrame(code, { currentSnapshot: snapshot(9, hash9, nearLimitStyle) }),
      ['style.read'],
      applyCommand,
    );
    assert.equal(prepared.frame.ok, false);
    if (prepared.frame.ok) assert.fail('expected failure');
    assert.equal(prepared.frame.error.code, code);
    assert.deepEqual(prepared.frame.error.details, { currentSnapshot: { revision: 9, styleHash: hash9 } });
  }
});

test('write-only peers permit receipts and metadata but reject full or Style-bearing frames', () => {
  assert.doesNotThrow(() => assertInboundResultAllowed(['style.write'], applyCommand, receiptFrame));
  assert.throws(() => assertInboundResultAllowed(['style.write'], applyCommand, fullFrameWithSecret), /capability/i);
  assert.throws(() => assertInboundEventAllowed(['style.write'], eventWithStyleSecret), /capability/i);
});

test('write-only error projection replaces primary and rollback strings with fixed public text', () => {
  const secret = 'https://user:credential@example.test/private-style';
  const prepared = prepareOutboundBridgeFrame(
    unsafeFailureFrame({
      code: 'INTERNAL', message: `failed for ${secret}`, path: `/sources/${secret}`,
      details: {
        currentSnapshot: snapshot(1, hash1, styleContaining(secret)),
        rolledBack: false,
        rollbackError: { code: 'IO_ERROR', message: secret, path: `/${secret}`, details: { secret } },
      },
    }),
    ['style.write'],
    applyCommand,
  );
  assert.equal(prepared.encoded.includes(secret), false);
  assert.equal(prepared.frame.ok, false);
  if (prepared.frame.ok) assert.fail('expected failure');
  assert.equal(prepared.frame.error.message, publicBridgeErrorMessage('INTERNAL'));
  assert.equal('path' in prepared.frame.error, false);
  assert.deepEqual(prepared.frame.error.details?.currentSnapshot, { revision: 1, styleHash: hash1 });
});

test('authoritative error snapshots are restricted to correlated applyTransaction failures', () => {
  assert.throws(
    () => prepareOutboundBridgeFrame(
      failureFrame('INTERNAL', { currentSnapshot: snapshot(1, hash1, style1) }),
      ['style.read'],
      getStyleCommand,
    ),
    /mutation|command|protocol/i,
  );
});
```

- [ ] **Step 5: Run the outbound tests to verify they are red**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json`

Expected: FAIL because `src/bridge/outbound.ts` and its capability validators do not exist.

- [ ] **Step 6: Implement capability projection and encoded-size degradation as typed candidates**

```ts
export type BrowserOutboundBridgeFrame = BridgeRegisterFrame | BridgeResultFrame | BridgeEventFrame;

export interface PreparedOutboundBridgeFrame<T extends BrowserOutboundBridgeFrame = BrowserOutboundBridgeFrame> {
  frame: T;
  encoded: string;
}

export function prepareOutboundBridgeFrame(
  frame: BridgeRegisterFrame,
  capabilities: readonly BridgeCapability[],
  maxBytes?: number,
): PreparedOutboundBridgeFrame<BridgeRegisterFrame>;
export function prepareOutboundBridgeFrame(
  frame: BridgeResultFrame,
  capabilities: readonly BridgeCapability[],
  command: BridgeCommand,
  maxBytes?: number,
): PreparedOutboundBridgeFrame<BridgeResultFrame>;
export function prepareOutboundBridgeFrame(
  frame: BridgeEventFrame,
  capabilities: readonly BridgeCapability[],
  maxBytes?: number,
): PreparedOutboundBridgeFrame<BridgeEventFrame>;
export function prepareOutboundBridgeFrame(
  frame: BrowserOutboundBridgeFrame,
  capabilities: readonly BridgeCapability[],
  commandOrMaxBytes?: BridgeCommand | number,
  maxBytes = MAX_BRIDGE_MESSAGE_BYTES,
): PreparedOutboundBridgeFrame;
```

The result overload requires the exact correlated command and validates it before candidate construction; registration/event overloads retain their optional numeric third argument. A result error containing `currentSnapshot` is valid only when that command is `applyTransaction`. Never infer mutation context from the error code or payload alone.

Build each candidate as a fresh object satisfying its strict Zod schema; never recursively delete arbitrary keys from caller-owned data. Apply capability projection before size measurement, then call `encodeBridgeFrame(candidate, maxBytes)` in this exact order:

1. Registration and `mapSnapshot`/`externalStyleChange`: full snapshot only with `style.read`, then the same revision/hash without Style.
2. First normalize every error string through one exhaustive fixed mapping: `INVALID_INPUT→Invalid bridge input`, `STYLE_INVALID→Style validation failed`, `NOT_FOUND→Requested map resource was not found`, `CONFLICT→Bridge request conflict`, `DEPENDENCY_CONFLICT→Style dependency conflict`, `UNSUPPORTED_SOURCE→Unsupported source`, `REVISION_CONFLICT→Live map revision conflict`, `MAP_NOT_READY→Map is not ready`, `BRIDGE_DISCONNECTED→Browser bridge disconnected`, `CAPABILITY_DENIED→Bridge capability denied`, `IO_ERROR→Bridge I/O failed`, `TIMEOUT→Bridge operation timed out`, and `INTERNAL→Bridge operation failed`. The primary path is omitted without `style.read`; with `style.read`, retain it only after bounded RFC 6901 validation. Any failure correlated to `applyTransaction` may keep a runtime-authoritative `currentSnapshot` while preserving its original primary code; when necessary it falls back to metadata-only revision/hash, including ordinary `INTERNAL`/`IO_ERROR`, conflict, and post-deadline timeout. A non-mutation result carrying that field is rejected. Error details never pass through wholesale. The complete allowlist is: a correlated mutation failure may carry `currentSnapshot`, `rolledBack:boolean`, and a nested rollback error reduced to code plus its fixed public message (no path/details); `CAPABILITY_DENIED` may carry only `commandType` and `requiredCapability`; `INVALID_INPUT` may carry only the fixed enum `reason:'relative-style-url'`; `MAP_NOT_READY` may carry only `syncState:'known'|'unknown'`; every other optional detail is omitted. A snapshot Style is copied only with `style.read`; write-only peers retain revision/hash; no allowlist copies diff/before/after. If an error without authoritative metadata is still too large, retain bounded code/fixed-message and omit optional path/details, but never discard an allowed current revision/hash pair.
3. Full transaction for a read-capable peer: full value, then no Style plus `omitted.style=true`, then no diff plus `omitted.diff=true`, then `detail:'receipt'`. A peer without `style.read` starts and ends at receipt.
4. `getStyle`: the Style result is indivisible. If it does not fit, emit a bounded correlated `ok:false`, `INVALID_INPUT` result using `publicBridgeErrorMessage('INVALID_INPUT')` and no path/details. This failure does not carry or change mirror state.
5. All other bounded results are encoded without semantic truncation. If even the protocol-defined minimal candidate cannot fit, throw a local protocol-size error and close rather than sending partial JSON.

Validate every returned candidate with `BridgeRegisterFrameSchema`, `BridgeResultFrameSchema`, or `BridgeEventFrameSchema` before returning its encoded text. For registration, require the passed capability set to equal the frame's normalized unique capability set before projection. `assertInboundResultAllowed` independently requires the command's server-side capability, accepts a full transaction only with `style.read`, accepts a receipt with `style.write`, rejects any Style-bearing snapshot/error without `style.read`, requires the fixed public message and no write-only path, allows `currentSnapshot` only for an `applyTransaction` error, enforces the exact error-details allowlist above, and enforces the command/result discriminant. `assertInboundEventAllowed` applies snapshot capability checks to events but never treats an event as a correlated mutation failure. Both validators inspect parsed typed fields only; string searching is used only by sentinel tests, never as authorization logic.

- [ ] **Step 7: Write failing URL inventory tests covering every MapLibre resource category**

```ts
test('collects all Style resource-bearing fields with RFC 6901 paths', () => {
  const style = styleWithResources({
    glyphs: 'https://fonts.example/{fontstack}/{range}.pbf',
    sprite: [{ id: 'base', url: 'https://sprites.example/base' }],
    imports: [{ id: 'theme', url: 'https://styles.example/theme.json' }],
    sources: {
      vector: { type: 'vector', url: 'https://tiles.example/index.json', tiles: ['custom://tiles/{z}/{x}/{y}'] },
      geojson: { type: 'geojson', data: 'data:application/geo+json,%7B%22type%22%3A%22FeatureCollection%22%2C%22features%22%3A%5B%5D%7D' },
      image: { type: 'image', url: 'https://images.example/overlay.png', coordinates: coordinates() },
      video: { type: 'video', urls: ['https://video.example/a.mp4'], coordinates: coordinates() },
    },
  });
  assert.deepEqual(
    collectStyleResourceReferences(style).map(({ path, value }) => [path, value]),
    expectedResourcePointers,
  );
});
```

- [ ] **Step 8: Run the resource inventory test to verify it is red**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json`

Expected: FAIL with missing `collectStyleResourceReferences`.

- [ ] **Step 9: Implement explicit resource collection without scanning metadata**

```ts
export interface ResourceReference { path: string; value: string }

export function collectStyleResourceReferences(style: StyleDocument): ResourceReference[] {
  const refs: ResourceReference[] = [];
  addString(refs, '/glyphs', style.glyphs);
  collectSprite(refs, style.sprite);
  collectImports(refs, style.imports);
  for (const [sourceId, source] of Object.entries(style.sources)) {
    const base = `/sources/${escapeJsonPointer(sourceId)}`;
    addString(refs, `${base}/url`, source.url);
    addStringArray(refs, `${base}/tiles`, source.tiles);
    addStringArray(refs, `${base}/urls`, source.urls);
    if (source.type === 'geojson') addString(refs, `${base}/data`, source.data);
  }
  return refs.sort((left, right) => left.path.localeCompare(right.path));
}
```

Only Style fields that MapLibre treats as resource locations are collected. Arbitrary `metadata`, layer expressions, labels, canvas element IDs, and ordinary feature string properties are never interpreted as URLs.

- [ ] **Step 10: Write failing baseline/new/changed policy tests**

```ts
test('retains an unchanged baseline URL without network.load', () => {
  assert.doesNotThrow(() => assertStyleResourcePolicy({ baseline, candidate: structuredClone(baseline), capabilities: ['style.write'], policy: denyAllPolicy }));
});

test('requires network.load and a matching HTTP origin for a new field', () => {
  const candidate = withGlyphs(baseline, 'https://fonts.example/{fontstack}/{range}.pbf');
  assertDenied(candidate, ['style.write'], { allowedResourceOrigins: ['https://fonts.example'] });
  assertDenied(candidate, ['style.write', 'network.load'], denyAllPolicy);
  assert.doesNotThrow(() => assertCandidate(candidate, ['style.write', 'network.load'], { allowedResourceOrigins: ['https://fonts.example'] }));
});

test('a copied URL at a different JSON Pointer is new and requires authorization', () => {
  assertDenied(duplicateSourceWithSameUrl(baseline), ['style.write'], denyAllPolicy);
});

test('rejects lossy origin entries and validates URL prefixes separately', () => {
  for (const origin of [
    'https://example.test/safe/path?x=1',
    'https://user:password@example.test',
    'https://example.test/#fragment',
    'data:text/plain,opaque',
    'https://*.example.test',
  ]) {
    assert.throws(() => normalizeResourcePolicy({
      ...denyAllPolicy, allowedResourceOrigins: [origin],
    }), /origin/i);
  }
  assert.doesNotThrow(() => normalizeResourcePolicy({
    ...denyAllPolicy,
    allowedResourceOrigins: ['https://example.test/'],
    allowedUrlPrefixes: ['https://example.test/safe/path/'],
  }));
  assert.throws(() => normalizeResourcePolicy({
    ...denyAllPolicy,
    allowedUrlPrefixes: ['https://user:password@example.test/safe/'],
  }), /prefix/i);
  assert.throws(() => normalizeResourcePolicy({
    ...denyAllPolicy,
    allowedUrlPrefixes: ['https://example.test/safe/#fragment'],
  }), /prefix/i);
});
```

- [ ] **Step 11: Implement path-plus-value retention, absolute matching, and relative-Style denial**

```ts
export interface ResourcePolicy {
  baseUrl: string;
  allowedResourceOrigins: readonly string[];
  allowedUrlPrefixes?: readonly string[];
  allowDataUrls?: boolean;
  maxDataUrlBytes?: number;
  allowedProtocols?: readonly string[];
  isProtocolRegistered?: (scheme: string) => boolean;
}

const ABSOLUTE_RESOURCE_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const isRelativeStyleResource = (value: string): boolean => !ABSOLUTE_RESOURCE_SCHEME.test(value);
const relativeStyleUrlDenied = (path: string): StyleToolError => createStyleToolError(
  'INVALID_INPUT',
  'Relative Style resources are not allowed.',
  path,
  { reason: 'relative-style-url' },
);

export function assertStyleResourcePolicy(input: ResourcePolicyInput): void {
  const retained = new Set(collectStyleResourceReferences(input.baseline).map((ref) => `${ref.path}\u0000${ref.value}`));
  for (const ref of collectStyleResourceReferences(input.candidate)) {
    if (retained.has(`${ref.path}\u0000${ref.value}`)) continue;
    if (isRelativeStyleResource(ref.value)) throw relativeStyleUrlDenied(ref.path);
    if (!input.capabilities.includes('network.load')) throw capabilityDenied(ref.path);
    assertNewResourceAllowed(ref, input.policy);
  }
}
```

Implement that configuration boundary once as module export `normalizeResourcePolicy(policy: ResourcePolicy): NormalizedResourcePolicy`; Task 6 imports it directly, while `src/bridge/index.ts` need not expose it as package API. Validate configuration before inspecting a candidate. An `allowedResourceOrigins` entry must parse as an absolute non-opaque HTTP(S) URL with no username/password, query, fragment, wildcard host, and no path other than `/`; only after those losslessness checks may it be normalized to `url.origin`. Never turn `https://example.test/safe/path` into authority for the whole origin. Validate `baseUrl` as an absolute URL separately for the runtime-image API. Validate every `allowedUrlPrefixes` entry as its own normalized absolute HTTP(S) URL with no credentials or fragment; preserve its path/query prefix and compare normalized URL components with a path-segment boundary rather than feeding it through `.origin`. For a newly introduced or changed Style reference, reject every value without an absolute scheme—including `./`, `../`, root-relative, and protocol-relative forms—with fixed `INVALID_INPUT`/`reason:'relative-style-url'` before the `network.load` capability check, origin/prefix resolution, or MapLibre sees the candidate. This makes the unconditional prohibition independently testable even on a least-privilege peer. Never resolve/rewrite a relative Style value, and never use `document.baseURI` as Style authorization. Absolute URLs continue through `network.load` and the exact origin/prefix/data/custom-protocol policy. Never use substring, suffix, wildcard-host, or credentials-based matching.

- [ ] **Step 12: Write failing `data:` and custom-protocol tests**

```ts
test('data URLs require opt-in and enforce decoded size', () => {
  assertDenied(dataCandidate('data:text/plain,small'), ['style.write', 'network.load'], denyAllPolicy);
  assertAllowed(dataCandidate('data:text/plain,small'), ['style.write', 'network.load'], { ...denyAllPolicy, allowDataUrls: true, maxDataUrlBytes: 32 });
  assertDenied(dataCandidate(`data:text/plain;base64,${Buffer.alloc(33).toString('base64')}`), ['style.write', 'network.load'], { ...denyAllPolicy, allowDataUrls: true, maxDataUrlBytes: 32 });
});

test('custom protocols require allowlisting and host registration', () => {
  const candidate = tileCandidate('pmtiles://catalog/world.pmtiles/{z}/{x}/{y}');
  assertDenied(candidate, allNetworkCapabilities, { ...denyAllPolicy, allowedProtocols: ['pmtiles'] });
  assertAllowed(candidate, allNetworkCapabilities, { ...denyAllPolicy, allowedProtocols: ['pmtiles'], isProtocolRegistered: (scheme) => scheme === 'pmtiles' });
});

test('new or changed relative Style URLs are denied under every base configuration', () => {
  for (const value of [
    './fonts/{fontstack}/{range}.pbf',
    '../fonts/{fontstack}/{range}.pbf',
    '/fonts/{fontstack}/{range}.pbf',
    '//cdn.example/fonts/{fontstack}/{range}.pbf',
  ]) {
    const candidate = withGlyphs(baseline, value);
    for (const capabilities of [allNetworkCapabilities, ['style.write'] as const]) {
      assert.throws(
        () => assertCandidate(candidate, capabilities, {
          ...allowAppOriginPolicy,
          baseUrl: 'https://allowed.example/app/',
        }),
        hasCodeAndReason('INVALID_INPUT', 'relative-style-url'),
      );
    }
  }
  assert.doesNotThrow(() => assertStyleResourcePolicy({
    baseline: baselineWithGlyphs('./fonts/{fontstack}/{range}.pbf'),
    candidate: baselineWithGlyphs('./fonts/{fontstack}/{range}.pbf'),
    capabilities: ['style.write'], policy: denyAllPolicy,
  }));
});

test('runtime image policy returns the canonical URL actually passed to the loader', () => {
  const decision = assertRuntimeImageResourcePolicy({
    imageId: 'marker', url: './images/marker.png', capabilities: allNetworkCapabilities,
    policy: { ...allowAppOriginPolicy, baseUrl: 'https://allowed.example/app/' },
  });
  assert.equal(decision.resolvedUrl, 'https://allowed.example/app/images/marker.png');
});
```

- [ ] **Step 13: Implement bounded `data:` decoding, custom schemes, runtime image checks, and redaction**

`data:` decoding must count decoded bytes for both percent-encoded and base64 forms and default to 1 MiB. Custom schemes require both `allowedProtocols` and `isProtocolRegistered`; `file:`, `javascript:`, and `blob:` remain denied even if supplied as an origin. The Style policy never stores or compares a second MapLibre/document base: every new/changed relative Style reference is rejected with fixed `INVALID_INPUT` and only `reason:'relative-style-url'`, even when `resourceBaseUrl` currently equals `document.baseURI`. Unchanged baseline path-plus-value pairs remain retainable because the bridge did not introduce them. Absolute HTTP(S), `data:`, and registered custom schemes follow their normal policy.

`assertRuntimeImageResourcePolicy` applies the same resource decision to `/runtime/images/{escapedImageId}/url` but returns `{resolvedUrl}`. Resolve a relative image URL exactly once against the captured trusted `baseUrl`, authorize that canonical absolute value, and pass that same `resolvedUrl` to the loader; the original relative string must never be resolved a second time by a changing document. `redactResourceUrl` removes username, password, query, and fragment and returns only `scheme://host/path` (or `scheme:[redacted]` for opaque URLs).

- [ ] **Step 14: Run all capability, projection, and policy tests**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/bridge/outbound.test.js .tmp/test-dist/bridge/resource-policy.test.js`

Expected: PASS for capability-safe full/receipt variants, command-aware failure projection, deterministic near-limit projection that preserves original `INTERNAL`/`IO_ERROR`/conflict/timeout plus authoritative mutation revision/hash, write-only metadata and read-capable optional Style, rejection of non-mutation failure snapshots, primary/rollback secret redaction, root glyph/sprite/import fields, source `url`/`tiles`/`urls`, GeoJSON `data`, image/video resources, unchanged baselines, moved/copied fields, strict lossless HTTP origin configuration, separately validated URL prefixes, unconditional denial of every new/changed relative Style reference before Map access, single-resolution runtime image URLs, `data:` sizes, custom protocols, runtime images, and redaction.

- [ ] **Step 15: Commit capability, projection, and network policy**

```bash
rtk git add src/bridge/capabilities.ts src/bridge/outbound.ts src/bridge/outbound.test.ts src/bridge/resource-policy.ts src/bridge/resource-policy.test.ts
rtk git commit -m "feat: enforce live bridge outbound policy"
```

### Task 3: Per-map registry, command correlation, mirror state, and serial queues

**Files:**
- Create: `src/bridge/registry.ts`
- Create: `src/bridge/registry.test.ts`

**Interfaces:**
- Consumes: protocol frame/result types, `encodeBridgeFrame`, browser-safe `REGISTRATION_REPLAY_CLIENT_BUDGET_MS`/`REGISTRATION_ATTEMPT_RETENTION_MS`, `assertCapability`, `assertInboundResultAllowed`, `assertInboundEventAllowed`, core `StyleToolError`, `createStyleToolError`, `isStyleToolError`, `validateStyleDocument`, `jsonUtf8ByteLength`, and shared async `hashStyle`.
- Produces: `BridgePeer`, `LiveMapMetadata`, `LiveMapRegistry`, `LiveMapHandle`, module-internal provenance-backed `RegistrationLiveness`/factory consumed only by the server (never re-exported from public barrels), async `LiveMapRegistry.register(peer, registration, liveness)`, `.list()`, `.get(mapId)`, generic atomic `.projectList(finalize)`, `.projectMetadata(mapId, finalize)`, `.projectCachedStyle(mapId, finalize)`, generic `.execute<C,T = BridgeResultFor<C>>(mapId, command, timeoutMs?, finalize?): Promise<T>`, async `.acceptResult(peerId, result): Promise<void>`, async `.acceptEvent(peerId, event): Promise<void>`, `.disconnect(peerId)`, and `.close()`. Each synchronous finalizer receives a validated cloned result and must finish before that read refreshes/touches anything or that result merges into cache/mirror/settles; this lets live MCP apply its actual shared response boundary without coupling the registry to MCP types. The registry accepts server `limitCeilings`, injects a clock, caps `timeoutMs` at 10 seconds, stamps the one absolute `deadlineAt` at enqueue, keeps a short transport-grace timer separate from the operation budget, and accepts only test-lowered registration-attempt retention/capacity options.

- [ ] **Step 1: Write failing registration and duplicate-ID lease tests**

```ts
const registerLive = (
  registry: LiveMapRegistry,
  peer: BridgePeer,
  frame: BridgeRegisterFrame,
) => registry.register(peer, frame, liveRegistrationLiveness());

test('rejects a duplicate active map id without the matching replacement lease', async () => {
  const registry = new LiveMapRegistry({ operationTimeoutMs: 10_000 });
  const firstPeer = peer('peer-1');
  const first = await registerLive(registry, firstPeer, registration('demo-map'));
  assert.match(first.leaseId, /^[A-Za-z0-9_-]{43}$/);
  await assert.rejects(registerLive(registry, peer('peer-2'), registration('demo-map')), hasCode('CONFLICT'));
  await assert.rejects(registerLive(registry, peer('peer-2'), registration('demo-map', 'wrong-lease')), hasCode('CONFLICT'));
  const replacement = await registerLive(registry, peer('peer-2'), registration('demo-map', first.leaseId));
  assert.equal(registry.get('demo-map')?.peerId, 'peer-2');
  assert.equal(firstPeer.closeCode, 4001);
  assert.notEqual(replacement.leaseId, first.leaseId);
});

test('replacement atomically rejects old active and queued work before installing the new peer', async () => {
  const first = await registerLive(registry, peer('peer-1'), registration('demo-map'));
  const active = registry.execute('demo-map', getStyleCommand());
  const queued = registry.execute('demo-map', listImagesCommand());
  await registerLive(registry, peer('peer-2'), registration('demo-map', first.leaseId));
  await assert.rejects(active, hasCode('BRIDGE_DISCONNECTED'));
  await assert.rejects(queued, hasCode('BRIDGE_DISCONNECTED'));
  assert.equal(registry.get('demo-map')?.peerId, 'peer-2');
  assert.equal(activeTimerCount(), 0);
});

test('registration negotiates exact limits and rejects any value above a server ceiling', async () => {
  const ceilings = bridgeLimits({ maxOperations: 250, maxMessageBytes: 6 * 1024 * 1024 });
  const registry = new LiveMapRegistry({ limitCeilings: ceilings });
  await assert.rejects(
    registerLive(registry, peer('too-large'), registration('map-a', undefined, undefined, { ...ceilings, maxOperations: 251 })),
    hasCode('INVALID_INPUT'),
  );
  const accepted = await registerLive(registry, peer('raised'), registration('map-a', undefined, undefined, ceilings));
  assert.deepEqual(accepted.metadata.limits, ceilings);
  await assert.rejects(
    registerLive(
      registry,
      peer('self-oversized'),
      registrationWhoseEncodedFrameExceedsDeclaredLimit('map-b', bridgeLimits({ maxMessageBytes: 512 })),
    ),
    hasCode('INVALID_INPUT'),
  );
});

test('rejects forged initial/replacement snapshot hashes before changing ownership', async () => {
  const registry = new LiveMapRegistry();
  await assert.rejects(
    registerLive(registry, peer('forged-initial'), registrationWithSnapshot('map-a', snapshot(0, hashB, styleA))),
    hasCode('INVALID_INPUT'),
  );
  assert.equal(registry.get('map-a'), undefined);

  const oldPeer = peer('old');
  const installed = await registerLive(registry, oldPeer, registrationWithSnapshot('map-a', snapshot(0, hashA, styleA)));
  await assert.rejects(
    registerLive(registry, peer('forged-replacement'), registrationWithSnapshot('map-a', snapshot(1, hashB, styleA), installed.leaseId)),
    hasCode('INVALID_INPUT'),
  );
  assert.equal(registry.get('map-a')?.peerId, oldPeer.id);
  assert.equal(oldPeer.closeCode, undefined);
});

test('rejects over-limit initial/replacement Styles before changing ownership', async () => {
  const limits = bridgeLimits({ maxStyleBytes: 1024 });
  const oversized = validStyleLargerThan(1024);
  const registry = new LiveMapRegistry({ limitCeilings: defaultBridgeLimits });
  await assert.rejects(
    registerLive(registry, peer('initial'), registrationWithSnapshot('map-a', await snapshotFor(oversized), undefined, limits)),
    hasCode('INVALID_INPUT'),
  );
  const oldPeer = peer('old');
  const installed = await registerLive(registry, oldPeer, registrationWithSnapshot('map-a', snapshot(0, hashA, styleA), undefined, limits));
  await assert.rejects(
    registerLive(registry, peer('replacement'), registrationWithSnapshot('map-a', await snapshotFor(oversized), installed.leaseId, limits)),
    hasCode('INVALID_INPUT'),
  );
  assert.equal(registry.get('map-a')?.peerId, oldPeer.id);
  assert.equal(oldPeer.closeCode, undefined);
});

test('rejects URL dot-segment map IDs before registration', async () => {
  const registry = new LiveMapRegistry();
  for (const mapId of ['.', '..']) {
    await assert.rejects(
      registerLive(registry, peer(mapId), registration(mapId)),
      hasCode('INVALID_INPUT'),
    );
  }
  const accepted = await registerLive(registry, peer('ordinary-dot'), registration('a.b'));
  assert.equal(accepted.metadata.mapId, 'a.b');
});

test('does not install a replacement snapshot made stale during async validation', async () => {
  const hashes = controlledHashStyle();
  const registry = new LiveMapRegistry({ hashStyle: hashes.hash });
  const oldPeer = peer('old');
  const installed = await registerLive(registry, oldPeer, registrationWithSnapshot('map-a', snapshot(0, hash0, style0)));
  hashes.defer(styleReplacement);
  const replacement = registerLive(
    registry,
    peer('replacement'),
    registrationWithSnapshot('map-a', snapshot(0, hashReplacement, styleReplacement), installed.leaseId),
  );
  await hashes.waitUntilStarted(styleReplacement);
  await registry.acceptEvent(oldPeer.id, externalStyleEvent(snapshot(1, hash1, style1)));
  hashes.resolve(styleReplacement, hashReplacement);
  await assert.rejects(replacement, hasCode('REVISION_CONFLICT'));
  assert.equal(registry.get('map-a')?.peerId, oldPeer.id);
  assert.deepEqual(registry.get('map-a')?.snapshot, snapshot(1, hash1, style1));
  assert.equal(oldPeer.closeCode, undefined);
});

test('socket termination during deferred registration hashing cannot install a ghost', async () => {
  for (const scenario of ['initial', 'replacement'] as const) {
    const hashes = controlledHashStyle();
    const registry = new LiveMapRegistry({ hashStyle: hashes.hash });
    const oldPeer = scenario === 'replacement' ? peer('healthy-old') : undefined;
    const installed = oldPeer
      ? await registerLive(registry, oldPeer, registrationWithSnapshot('map-a', snapshot(0, hash0, style0)))
      : undefined;
    const candidatePeer = peer(`candidate-${scenario}`);
    const liveness = liveRegistrationLiveness();
    hashes.defer(style1);
    const pending = registry.register(
      candidatePeer,
      registrationWithSnapshot('map-a', snapshot(1, hash1, style1), installed?.leaseId),
      liveness.token,
    );
    await hashes.waitUntilStarted(style1);
    liveness.terminate();
    hashes.resolve(style1, hash1);
    await assert.rejects(pending, hasCode('BRIDGE_DISCONNECTED'));
    if (oldPeer) {
      assert.equal(registry.get('map-a')?.peerId, oldPeer.id);
      assert.equal(registry.get('map-a')?.leaseId, installed?.leaseId);
      assert.equal(oldPeer.closeCode, undefined);
    } else {
      assert.equal(registry.get('map-a'), undefined);
    }
  }
});

test('replays an ack-lost registration attempt with the same lease exactly once', async () => {
  const registry = new LiveMapRegistry();
  const oldPeer = peer('old');
  const old = await registerLive(registry, oldPeer, registration('map-a'));
  const attemptId = randomRegistrationAttemptId();
  const frame = registration('map-a', old.leaseId, { registrationAttemptId: attemptId });
  const firstPeer = peer('replacement-before-ack-loss');
  const committed = await registerLive(registry, firstPeer, frame);
  const committedMirror = registry.get('map-a')?.snapshot;
  assert.equal(oldPeer.closeCalls, 1);

  const active = registry.execute('map-a', getStyleCommand());
  const queued = registry.execute('map-a', listImagesCommand());
  assert.equal(firstPeer.sent.length, 1);

  // The registered acknowledgement is held/lost while the committed generation still looks active.
  const replayPeer = peer('replacement-reconnect');
  const replayed = await registerLive(registry, replayPeer, frame);
  assert.equal(replayed.leaseId, committed.leaseId);
  await assert.rejects(active, hasCode('BRIDGE_DISCONNECTED'));
  await assert.rejects(queued, hasCode('BRIDGE_DISCONNECTED'));
  assert.equal(activeTimerCount(), 0);
  assert.equal(firstPeer.sent.length, 1); // no old command is replayed to the new generation
  assert.equal(registry.get('map-a')?.metadata.syncState, 'unknown');
  assert.equal(registry.get('map-a')?.snapshot.style, undefined);
  assert.equal(oldPeer.closeCalls, 1);
  assert.equal(firstPeer.closeCalls, 1); // generation handoff, not a second logical replacement
  assert.equal(registryTestDiagnostics(registry).registrationAttempts, 1);

  await assert.rejects(registry.projectCachedStyle('map-a', identity), hasCode('MAP_NOT_READY'));
  await assert.rejects(registry.execute('map-a', getStyleCommand()), hasCode('MAP_NOT_READY'));
  assert.equal(replayPeer.sent.length, 0);
  await registry.acceptEvent(replayPeer.id, mapSnapshotEvent(committedMirror!));
  assert.equal(registry.get('map-a')?.metadata.syncState, 'known');
  assert.deepEqual(registry.get('map-a')?.snapshot, committedMirror);
  assert.equal(registryTestDiagnostics(registry).retainedAttemptCount, 0);
  const afterConfirmation = registry.execute('map-a', getStyleCommand());
  assert.equal(replayPeer.sent.length, 1);
  await registry.acceptResult(replayPeer.id, successFor(replayPeer.sent[0], styleResultFrom(committedMirror!)));
  await afterConfirmation;

  await assert.rejects(
    registerLive(
      registry,
      peer('different-peer'),
      registration('map-a', old.leaseId, { registrationAttemptId: randomRegistrationAttemptId() }),
    ),
    hasCode('CONFLICT'),
  );
  assert.equal(registry.get('map-a')?.peerId, replayPeer.id);
});

test('attempt replay retention outlives the finite client budget and remains globally bounded', async () => {
  const clock = fakeClock();
  const registry = new LiveMapRegistry({
    now: clock.now,
    maxRetainedRegistrationAttempts: 2,
    registrationAttemptRetentionMs: 60_000,
  });
  await commitAckLostAttempt(registry, 'a', attemptA);
  await commitAckLostAttempt(registry, 'b', attemptB);
  await assert.rejects(commitAckLostAttempt(registry, 'c', attemptC), hasCode('CONFLICT'));
  clock.advance(30_001); // the client replay budget is exhausted first
  assert.equal(registryTestDiagnostics(registry).retainedAttemptCount, 2);
  assert.equal((await replayAttempt(registry, 'a', attemptA)).leaseId, leaseA);
  clock.advance(30_000);
  registry.sweepExpiredRegistrationAttempts();
  assert.equal(registryTestDiagnostics(registry).retainedAttemptCount, 0);
  assert.equal(registryTestDiagnostics(registry).maxAttemptsPerMap, 1);
});
```

- [ ] **Step 2: Run the registry test to verify it is red**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json`

Expected: FAIL because `src/bridge/registry.ts` does not exist.

- [ ] **Step 3: Implement registration, private replacement leases, and metadata-only listing**

```ts
export interface BridgePeer {
  readonly id: string;
  send(frame: BridgeCommandFrame): Promise<void>;
  close(code: number, reason: string): void;
}

export interface LiveMapMetadata {
  mapId: string;
  capabilities: readonly BridgeCapability[];
  limits: BridgeLimitSet;
  revision: number;
  styleHash: string;
  syncState: 'known' | 'unknown';
  connectedAt: number;
  lastSeenAt: number;
}

export class LiveMapRegistry {
  readonly limitCeilings: BridgeLimitSet;
  register(
    peer: BridgePeer,
    frame: BridgeRegisterFrame,
    liveness: RegistrationLiveness,
  ): Promise<{ leaseId: string; metadata: LiveMapMetadata }>;
  list(): LiveMapMetadata[];
  get(mapId: string): LiveMapHandle | undefined;
  projectList<T>(finalize: (maps: LiveMapMetadata[]) => T): T;
  projectMetadata<T>(mapId: string, finalize: (metadata: LiveMapMetadata) => T): T;
  projectCachedStyle<T>(mapId: string, finalize: (style: StyleDocument) => T): T;
  execute<C extends BridgeCommand, T = BridgeResultFor<C>>(
    mapId: string,
    command: C,
    timeoutMs?: number,
    finalize?: (result: BridgeResultFor<C>) => T,
  ): Promise<T>;
  acceptResult(peerId: string, result: BridgeResultFrame): Promise<void>;
  acceptEvent(peerId: string, event: BridgeEventFrame): Promise<void>;
}
```

Generate each server replacement lease from exactly 32 random bytes encoded as 43-character base64url; validate the browser-generated `registrationAttemptId` against the same exact encoded-length schema but never regenerate it server-side. Never expose either through `list()` or MCP resources, and keep `peerId` only on the internal handle rather than `LiveMapMetadata`. Resolve registry ceilings from explicit options or the four default constants. Registration is async because a Style-bearing snapshot must first pass `validateStyleDocument(frame.snapshot.style,{maxStyleBytes:frame.limits.maxStyleBytes})` and the one shared async `hashStyle`; cache only the normalized Style and reject when its canonical hash differs from claimed `styleHash`. Do not copy a Node-only hash implementation. Also reject any effective limit above its corresponding server ceiling, require the registration frame itself to encode within its declared effective `maxMessageBytes`, and reject a Style-bearing snapshot unless the same frame declares `style.read`. Perform every validation/hash before generating/installing a lease or touching an existing handle, so a forged replacement leaves the old owner and queued work intact. Retain the accepted exact limit set in metadata/handle. A valid read-capable near-limit registration may be metadata-only and simply starts without a cached Style.

`RegistrationLiveness` is a module-private frozen capability registered in a `WeakSet`; only the WebSocket server's internal factory can create one for its current socket generation. It owns that generation's `AbortSignal` plus an identity callback. `register` rejects an unproven token before parsing/awaiting. Check it before and after every validation/hash await, then once more synchronously inside the per-map critical section **before** generating a lease, closing/rejecting/touching an old handle, recording an attempt, or installing a mapping. Socket close/error/policy close/server shutdown abort the token first. A terminated initial registration therefore installs no ghost, and a terminated replacement leaves the healthy old owner, lease, mirror, timers, and queue untouched; late hash fulfillment/rejection is consumed without side effects or unhandled rejection.

`projectList`, `projectMetadata`, and `projectCachedStyle` construct one validated/cloned read candidate and invoke their synchronous caller finalizer while the same handle/generation still owns it. Only a successful finalizer may return the value or perform any otherwise-required access/touch bookkeeping; a thrown finalizer propagates without mutating cache, mirror, timestamps, or connection state. They never expose a mutable internal object. The optional `execute` finalizer follows the same rule after complete schema/correlation/capability/size/hash validation but before success mirror/cache merge and caller settlement. A read finalizer rejection may follow a harmless browser read, but never caches or exposes that result. A mutation caller must separately prove its fixed result projection fits before `execute`; the identical projection is then used as the finalizer, so it cannot fail after a Map side effect.

After validation, replacement is one ordered per-map critical section. Recheck not only liveness/ownership/lease but also the current old-handle revision/hash after the async work: reject the replacement with an authoritative `REVISION_CONFLICT` if its snapshot revision is lower, or policy/conflict reject if the revision is equal with a different hash; only an equal same-hash or higher validated snapshot may replace. This prevents an old peer event/result on its separate socket tail from advancing the handle while a stale replacement hash is pending. On acceptance, mark the old handle closed, cancel both timer classes, reject its active correlation and every queued promise with `BRIDGE_DISCONNECTED`, clear its queue/correlation tables, close the old peer with code `4001`, and only then install the new mapping/lease. A stale old-peer close event must not remove the replacement; `disconnect(peerId)` removes a mapping only when it still owns it.

Keep exactly one bounded committed-attempt record per map: attempt ID, canonical fingerprint of map ID/replacement lease/capabilities/limits/validated snapshot metadata, resulting lease, and committed mirror. A fresh attempt follows the full path above and atomically replaces that record. If the `registered` acknowledgement is held or lost, a transient reconnect repeats the **same** attempt ID, old replacement lease, and exact fingerprint even while the first committed generation still appears active. After fresh authentication, validation, and liveness checks, treat that as an idempotent generation handoff: reject the superseded generation's active and queued correlations exactly once with `BRIDGE_DISCONNECTED`, clear its timers/correlation tables, close that socket once, attach the new peer, and return the same resulting lease without closing the original pre-replacement owner again, rotating a lease, or replaying old work.

The replay handoff atomically marks the new handle `syncState:'unknown'`, clears every tagged Style cache, and disables dispatch before its `registered` acknowledgement is sent. Preserve only the last revision/hash as comparison metadata; no MCP read or command may treat it as current. The replaying client must send an authoritative `mapSnapshot` confirmation after it receives `registered`, even when its live pair appears unchanged. Only validated/hash-checked acceptance of that confirmation restores `known`, cache, and dispatch. Thus the ack→snapshot window returns `MAP_NOT_READY` locally with zero peer command rather than exposing a stale mirror. A same ID with different fields or a new/guessed ID remains `CONFLICT` while an owner is live; possession of another map's attempt cannot transfer ownership.

Retain the committed-attempt record until the matching replay generation's authoritative confirmation is accepted, a genuinely new successful attempt supersedes it, or the hard server retention expires. Use exported shared constants `REGISTRATION_REPLAY_CLIENT_BUDGET_MS = 30_000` and `REGISTRATION_ATTEMPT_RETENTION_MS = 60_000`: the client must terminally stop pending-ack replay at its shorter budget, while the server cannot erase the record before the longer retention boundary. Reset neither deadline on an attacker replay. Fake-clock tests cover just-before/at/after both boundaries and prove an accepted same-attempt replay never rotates a lease twice.

Memory is bounded twice: exactly one committed record per map and a default hard global `maxRetainedRegistrationAttempts = 1024` registry ceiling (test-injectable only to lower it). At capacity, reject a fresh logical attempt with fixed `CONFLICT` before hashing/lease/owner side effects; an existing same-attempt replay still uses its slot. Confirmation/new-attempt replacement/retention expiry removes or replaces the slot exactly once. This is idempotent recovery, not a general lease bypass.

- [ ] **Step 4: Write failing command serialization, timeout, disconnect, and mirror tests**

```ts
test('serializes one command per map and updates the mirror only on success', async () => {
  const first = registry.execute('demo-map', getStyleCommand());
  const second = registry.execute('demo-map', listImagesCommand());
  assert.equal(fakePeer.sent.length, 1);
  await registry.acceptResult(fakePeer.id, successFor(fakePeer.sent[0], styleResult(1, hash1)));
  await first;
  assert.equal(fakePeer.sent.length, 2);
  await registry.acceptResult(fakePeer.id, failureFor(fakePeer.sent[1], 'MAP_NOT_READY'));
  await assert.rejects(second, hasCode('MAP_NOT_READY'));
  assert.equal(registry.get('demo-map')?.metadata.styleHash, hash1);
});

test('rejects in-flight and queued work on disconnect', async () => {
  const pending = registry.execute('demo-map', getStyleCommand());
  registry.disconnect(fakePeer.id);
  await assert.rejects(pending, hasCode('BRIDGE_DISCONNECTED'));
});

test('send throw/callback failure enters one terminal disconnect path without waiting for timeout', async () => {
  for (const peer of [throwingSendPeer(), asynchronouslyRejectingSendPeer()]) {
    const registry = await registryWithPeer(peer);
    const active = registry.execute('demo-map', getStyleCommand());
    const queued = registry.execute('demo-map', listImagesCommand());
    await assert.rejects(active, hasCode('BRIDGE_DISCONNECTED'));
    await assert.rejects(queued, hasCode('BRIDGE_DISCONNECTED'));
    assert.equal(peer.sendCalls, 1);
    assert.equal(registry.get('demo-map'), undefined);
    assert.equal(activeTimerCount(), 0);
    assert.equal(transportGraceTimerCount(), 0);
    assert.equal(unhandledRejections.length, 0);
  }
});

test('rejects stale write preconditions locally without sending a WebSocket command', async () => {
  await registry.acceptEvent(fakePeer.id, externalStyleEvent(snapshot(1, hash1)));
  await assert.rejects(
    registry.execute('demo-map', applyCommand(0, hash0)),
    hasCode('REVISION_CONFLICT'),
  );
  assert.equal(fakePeer.sent.length, 0);
});

test('enforces the registered capability on the server before queueing or sending', async () => {
  const writeOnly = await registryWithCapabilities(['style.write']);
  await assert.rejects(writeOnly.registry.execute('demo-map', getStyleCommand()), hasCode('CAPABILITY_DENIED'));
  await assert.rejects(writeOnly.registry.execute('demo-map', sourceQueryCommand()), hasCode('CAPABILITY_DENIED'));
  assert.equal(writeOnly.peer.sent.length, 0);
  assert.equal(writeOnly.activeTimerCount(), 0);
});

test('enforces negotiated operation and frame limits before sending', async () => {
  const bounded = await registryWithLimits(bridgeLimits({ maxOperations: 2, maxMessageBytes: 512 }));
  await assert.rejects(
    bounded.registry.execute('demo-map', applyCommandWithOperationCount(3)),
    hasCode('INVALID_INPUT'),
  );
  await assert.rejects(
    bounded.registry.execute('demo-map', commandWhoseEncodedFrameExceeds(512)),
    hasCode('INVALID_INPUT'),
  );
  assert.equal(bounded.peer.sent.length, 0);
});

test('recomputes correlated query bounds instead of trusting browser counters', async () => {
  for (const { command, forged } of [
    {
      command: sourceQueryCommand({ limit: 1, properties: ['name'] }),
      forged: featuresResult({ features: [feature({ name: 'a' }), feature({ name: 'b' })], returned: 2, serializedBytes: 2 }),
    },
    {
      command: sourceQueryCommand({ limit: 1, properties: ['name'] }),
      forged: featuresResult({ features: [feature({ name: 'a', secret: 'forbidden' })], returned: 1, serializedBytes: 2 }),
    },
    {
      command: renderedQueryCommand({ limit: 1, properties: ['name'] }),
      forged: featuresResult({ features: [feature({ name: 'x'.repeat(1024 * 1024 + 1) })], returned: 1, serializedBytes: 1 }),
    },
  ]) {
    const fixture = await registryWithCapabilities(['features.query']);
    const before = fixture.registry.get('demo-map')?.snapshot;
    const pending = fixture.registry.execute('demo-map', command);
    await assertProtocolViolationDoesNotSettle(
      fixture,
      pending,
      successFor(fixture.peer.sent[0], forged),
    );
    assert.deepEqual(fixture.registry.get('demo-map')?.snapshot, before);
  }
});

test('recomputes listImages count and JSON bytes before settlement', async () => {
  const fixture = await registryWithCapabilities(['style.read']);
  const pending = fixture.registry.execute('demo-map', listImagesCommand());
  const forged = imagesResult({
    imageIds: Array.from({ length: 500 }, (_, index) => `${index}-${'x'.repeat(140)}`),
    serializedBytes: 1,
  });
  await assertProtocolViolationDoesNotSettle(
    fixture,
    pending,
    successFor(fixture.peer.sent[0], forged),
  );
  assert.equal(fixture.peer.closeCode, 1008);
});

test('rejects a same-correlation result with the wrong command result type', async () => {
  const pending = registry.execute('demo-map', applyCommand(0, hash0));
  await assert.rejects(
    registry.acceptResult(fakePeer.id, successFor(fakePeer.sent[0], { type: 'ack' })),
    /expected transaction/,
  );
  assert.equal(registry.get('demo-map')?.metadata.revision, 0);
  registry.disconnect(fakePeer.id);
  await assert.rejects(pending, hasCode('BRIDGE_DISCONNECTED'));
});

test('disconnects a write-only peer that forges a full result without settling or changing the mirror', async () => {
  const secret = 'secret-sentinel-never-retain';
  const writeOnly = await registryWithCapabilities(['style.write']);
  const before = writeOnly.registry.get('demo-map')?.snapshot;
  const pending = writeOnly.registry.execute('demo-map', applyCommand(0, hash0));
  let settled = false;
  void pending.then(() => { settled = true; }, () => { settled = true; });
  await assert.rejects(
    writeOnly.registry.acceptResult(
      writeOnly.peer.id,
      successFor(writeOnly.peer.sent[0], fullTransactionResultContaining(secret)),
    ),
    /capability|protocol/i,
  );
  await flushMicrotasks();
  assert.equal(writeOnly.peer.closeCode, 1008);
  assert.equal(settled, false); // the malicious frame itself did not settle the correlation
  assert.deepEqual(writeOnly.registry.get('demo-map')?.snapshot, before);
  assert.equal(JSON.stringify(writeOnly.registry.list()).includes(secret), false);
  writeOnly.registry.disconnect(writeOnly.peer.id);
  await assert.rejects(pending, hasCode('BRIDGE_DISCONNECTED'));
});

test('rejects Style/diff secrets hidden in write-only error details and events', async () => {
  const secret = 'secret-sentinel-error-detail';
  const errorPeer = await registryWithCapabilities(['style.write']);
  const pending = errorPeer.registry.execute('demo-map', applyCommand(0, hash0));
  await assert.rejects(
    errorPeer.registry.acceptResult(
      errorPeer.peer.id,
      conflictWithUnsafeDetails(errorPeer.peer.sent[0], snapshot(1, hash1, styleContaining(secret)), {
        diff: [{ path: '/metadata/secret', before: secret, after: 'changed' }],
      }),
    ),
    /capability|protocol/i,
  );
  assert.equal(JSON.stringify(errorPeer.registry.list()).includes(secret), false);
  errorPeer.registry.disconnect(errorPeer.peer.id);
  await assert.rejects(pending, hasCode('BRIDGE_DISCONNECTED'));

  const eventPeer = await registryWithCapabilities(['style.write']);
  await assert.rejects(
    eventPeer.registry.acceptEvent(eventPeer.peer.id, externalStyleEvent(snapshot(1, hash1, styleContaining(secret)))),
    /capability|protocol/i,
  );
  assert.equal(JSON.stringify(eventPeer.registry.list()).includes(secret), false);
});

test('disconnects independently on Style or diff above registered limits before settlement', async () => {
  for (const forgedResult of [
    fullTransactionResult({
      revision: 1, styleHash: hash1,
      style: validStyleLargerThan(2048), diff: smallDiff,
    }),
    fullTransactionResult({
      revision: 1, styleHash: hash1,
      style: undefined, omitted: { style: true }, diff: diffLargerThan(128),
    }),
  ]) {
    const bounded = await registryWithCapabilities(
      ['style.read', 'style.write'],
      snapshot(0, hash0, style0),
      bridgeLimits({ maxStyleBytes: 2048, maxDiffBytes: 128 }),
    );
    const pending = bounded.registry.execute('demo-map', applyCommand(0, hash0));
    const before = bounded.registry.get('demo-map')?.snapshot;
    await assert.rejects(
      bounded.registry.acceptResult(
        bounded.peer.id,
        successFor(bounded.peer.sent[0], forgedResult),
      ),
      /limit|protocol/i,
    );
    assert.deepEqual(bounded.registry.get('demo-map')?.snapshot, before);
    assert.equal(bounded.peer.closeCode, 1008);
    bounded.registry.disconnect(bounded.peer.id);
    await assert.rejects(pending, hasCode('BRIDGE_DISCONNECTED'));
  }
});

test('rejects forged transaction receipt semantics without settling or changing the mirror', async () => {
  for (const forged of [
    transactionReceipt({ revision: 0, styleHash: hash1, applied: false, noOp: true }),
    transactionReceipt({ revision: 1, styleHash: hash0, applied: true, noOp: false }),
    transactionReceipt({ revision: 2, styleHash: hash1, applied: true, noOp: false }),
  ]) {
    const fixture = await registryWithCapabilities(['style.write']);
    const before = fixture.registry.get('demo-map')?.snapshot;
    const pending = fixture.registry.execute('demo-map', applyCommand(0, hash0));
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await assert.rejects(
      fixture.registry.acceptResult(fixture.peer.id, successFor(fixture.peer.sent[0], forged)),
      /revision|hash|protocol/i,
    );
    await flushMicrotasks();
    assert.equal(settled, false);
    assert.deepEqual(fixture.registry.get('demo-map')?.snapshot, before);
    assert.equal(fixture.peer.closeCode, 1008);
    fixture.registry.disconnect(fixture.peer.id);
    await assert.rejects(pending, hasCode('BRIDGE_DISCONNECTED'));
  }
});

test('one stamped deadline times out the caller but never overlaps an unsettled map command', async () => {
  const first = registry.execute('demo-map', slowApplyCommand());
  const second = registry.execute('demo-map', getStyleCommand());
  assert.equal(fakePeer.sent[0]?.deadlineAt, clock.now() + 10_000);
  clock.advanceBy(10_000);
  await assert.rejects(first, hasCode('TIMEOUT'));
  await assert.rejects(second, hasCode('TIMEOUT'));
  assert.equal(fakePeer.sent.length, 1);
  clock.advanceBy(1_000); // transport grace
  assert.equal(registry.get('demo-map')?.syncState, 'unknown');
  assert.equal(fakePeer.closeCode, 4002);
});

test('server queue time consumes the original deadline', async () => {
  const first = registry.execute('demo-map', getStyleCommand());
  const second = registry.execute('demo-map', listImagesCommand());
  const originalDeadline = clock.now() + 10_000;
  clock.advanceBy(4_000);
  await registry.acceptResult(fakePeer.id, successFor(fakePeer.sent[0], styleResult(0, hash0)));
  await first;
  assert.equal(fakePeer.sent[1]?.deadlineAt, originalDeadline);
  clock.advanceBy(6_000);
  await assert.rejects(second, hasCode('TIMEOUT'));
});

test('a late authoritative timeout snapshot repairs the mirror before transport grace', async () => {
  const pending = registry.execute('demo-map', slowApplyCommand());
  clock.advanceBy(10_000);
  await assert.rejects(pending, hasCode('TIMEOUT'));
  await registry.acceptResult(fakePeer.id, timeoutFor(fakePeer.sent[0], snapshot(1, hash1)));
  assert.equal(registry.get('demo-map')?.metadata.revision, 1);
  assert.equal(registry.get('demo-map')?.metadata.styleHash, hash1);
  assert.equal(registry.get('demo-map')?.snapshot.style, undefined);
  assert.equal(registry.get('demo-map')?.syncState, 'known');
  assert.equal(fakePeer.closeCode, undefined);
});

test('a metadata-only receipt never leaves the previous Style cached under a new hash', async () => {
  const readWriter = await registryWithCapabilities(['style.read', 'style.write'], snapshot(0, hash0, style0));
  const pending = readWriter.registry.execute('demo-map', applyCommand(0, hash0));
  await readWriter.registry.acceptResult(
    readWriter.peer.id,
    successFor(readWriter.peer.sent[0], transactionReceipt(1, hash1)),
  );
  await pending;
  assert.equal(readWriter.registry.get('demo-map')?.metadata.styleHash, hash1);
  assert.equal(readWriter.registry.get('demo-map')?.snapshot.style, undefined);
});

test('settles a stale result once without rolling a newer event mirror backward', async () => {
  const pending = registry.execute('demo-map', getStyleCommand());
  let settlements = 0;
  void pending.then(() => { settlements += 1; }, () => { settlements += 1; });
  await registry.acceptEvent(fakePeer.id, externalStyleEvent(snapshot(2, hash2, style2)));
  await registry.acceptResult(
    fakePeer.id,
    successFor(fakePeer.sent[0], styleResult(1, hash1, style1)),
  );
  assert.deepEqual(await pending, styleResult(1, hash1, style1));
  assert.equal(settlements, 1);
  assert.deepEqual(registry.get('demo-map')?.snapshot, snapshot(2, hash2, style2));
});

test('policy-closes on the same revision with a different hash', async () => {
  await assert.rejects(
    registry.acceptEvent(fakePeer.id, externalStyleEvent(snapshot(0, hash1, style1))),
    /revision.*hash|protocol/i,
  );
  assert.equal(fakePeer.closeCode, 1008);
  assert.deepEqual(registry.get('demo-map')?.snapshot, snapshot(0, hash0, style0));
});

test('mapStatus makes the server mirror unknown until an authoritative snapshot restores it', async () => {
  const readPeer = await registryWithCapabilities(['style.read'], snapshot(0, hash0, style0));
  await readPeer.registry.acceptEvent(readPeer.peer.id, mapStatusEvent({ syncState: 'unknown' }));
  assert.equal(readPeer.registry.get('demo-map')?.syncState, 'unknown');
  assert.equal(readPeer.registry.get('demo-map')?.snapshot.style, undefined);
  await assert.rejects(
    readPeer.registry.execute('demo-map', getStyleCommand()),
    hasCode('MAP_NOT_READY'),
  );
  assert.equal(readPeer.peer.sent.length, 0);

  await readPeer.registry.acceptEvent(
    readPeer.peer.id,
    mapSnapshotEvent(snapshot(1, hash1, style1)),
  );
  assert.equal(readPeer.registry.get('demo-map')?.syncState, 'known');
  const pending = readPeer.registry.execute('demo-map', getStyleCommand());
  assert.equal(readPeer.peer.sent.length, 1);
  readPeer.registry.disconnect(readPeer.peer.id);
  await assert.rejects(pending, hasCode('BRIDGE_DISCONNECTED'));
});

test('a pre-status pending result settles once but cannot restore a newer unknown epoch', async () => {
  const readPeer = await registryWithCapabilities(['style.read'], snapshot(0, hash0, style0));
  const pending = readPeer.registry.execute('demo-map', getStyleCommand());
  let settlements = 0;
  void pending.then(() => { settlements += 1; }, () => { settlements += 1; });
  await readPeer.registry.acceptEvent(readPeer.peer.id, mapStatusEvent({ syncState: 'unknown' }));
  await readPeer.registry.acceptResult(
    readPeer.peer.id,
    successFor(readPeer.peer.sent[0], styleResult(0, hash0, style0)),
  );
  assert.deepEqual(await pending, styleResult(0, hash0, style0));
  assert.equal(settlements, 1);
  assert.equal(readPeer.registry.get('demo-map')?.syncState, 'unknown');
  assert.equal(readPeer.registry.get('demo-map')?.snapshot.style, undefined);
});
```

- [ ] **Step 5: Implement per-map promise tails and correlation ownership**

Each map owns a promise tail. When `execute` receives a request, first call `assertCapability(handle.capabilities, command)` and compare transaction length with `handle.metadata.limits.maxOperations`; a denied/oversized command returns `CAPABILITY_DENIED` or `INVALID_INPUT` locally and sends nothing. Then calculate `deadlineAt = clock.now() + min(requestedTimeout, 10_000)` exactly once, construct the command frame with that deadline, and prove `encodeBridgeFrame(frame, handle.metadata.limits.maxMessageBytes)` succeeds before allocating a timer/correlation or joining the queue. Store the same deadline on the queued record and start its caller timer immediately. If a request expires before it reaches the head, reject it with `TIMEOUT`, mark it skipped, and never send a frame or start transport grace. At the queue head, before sending an `applyTransaction`, compare the command's `expectedRevision` and `expectedStyleHash` with the then-current server mirror; reject a mismatch locally with `REVISION_CONFLICT` and send no WebSocket frame.

Otherwise create one pending correlation record `{mapId, peerId, command, expectedResultType, deadlineAt, dispatchSyncEpoch, resolve, reject, callerTimer, graceTimer, callerSettled}` before the send so an immediate response has an owner, then `await peer.send(frame)`. `BridgePeer.send` resolves only from the WebSocket send callback and converts both synchronous throws and callback errors into rejection; its server terminal gate also rejects it if close/error/shutdown happens before a callback. Any send rejection enters the same idempotent terminal disconnect path as socket error: clear caller/grace timers, remove the handle only if this peer still owns it, reject active and queued calls exactly once with a fresh provenance-authentic `BRIDGE_DISCONNECTED`, and never pump the next command or wait until deadline. After a send resolves, recheck map-handle identity, peer ownership, and active correlation before arming/preserving any work; a terminal or replaced peer simply exits, so a late callback cannot revive dispatch. Do not include the transport exception text in an error or close reason. A successful owned send retains the active caller timer at that same absolute deadline; timeout retains correlation ownership and keeps the per-map queue blocked until the browser command actually settles. A small fixed transport grace (default 1 second, injected in tests) is not a renewed operation timeout; if it expires without a result, mark the mirror `syncState:'unknown'`, close the peer with code `4002`, reject still-unsettled queued work with `BRIDGE_DISCONNECTED`, and require a fresh authoritative registration before any next command.

`acceptResult` and `acceptEvent` are async. Parse the complete strict schema, verify correlation/peer/map ownership, call `assertCorrelated`, and then call the capability validator before any await that could settle or change the mirror. For every optional Style in a success/error/event, run `validateStyleDocument(style,{maxStyleBytes:handle.limits.maxStyleBytes})`, hash only its normalized result with the shared implementation, and require the claimed hash. For a full transaction result, call `jsonUtf8ByteLength(diff)` exactly once and require `<= handle.limits.maxDiffBytes`; Style and diff checks are independent, so omitting one never bypasses the other. For a correlated features result, recompute `jsonUtf8ByteLength(result.features)`, require it to equal the claimed `serializedBytes` and be at most 1 MiB, require `returned === features.length <= min(command.limit ?? 100,100)`, and, when `command.properties` exists, require every returned feature-property key to be in that exact allowlist. For `listImages`, recompute `jsonUtf8ByteLength(result.imageIds)`, require the claim to match and be at most 64 KiB, and require at most 500 IDs. Do not trust browser counters or rely only on the package's own runtime. Recheck peer/map/correlation ownership after every await before committing. A write-only `applyTransaction` accepts only `detail:'receipt'`; a read-capable writer may return full, degraded-full, or receipt. Before accepting either variant, contextually validate it against the pending mutation's dispatch baseline: `{applied:false,noOp:true}` must retain the exact revision/hash pair, while `{applied:true,noOp:false}` must use `revision === baseline.revision + 1` and a different, validated `styleHash`. Any full write-only result, Style-bearing write-only snapshot/error, over-limit/mismatched Style or diff, forged query/image count/bytes/properties, invalid applied/no-op/revision/hash semantics, disallowed detail field, unknown ID, wrong peer, wrong map, or wrong result discriminant is a protocol/capability violation: close the peer with `1008`, do not settle the correlation from that frame, do not copy any value into the mirror, and let the normal disconnect path reject pending/queued work as a provenance-authentic `BRIDGE_DISCONNECTED`. Never include a validation/hash exception string in a close reason. A valid result arriving after caller timeout but before transport grace may reconcile revision/hash and unblock the queue without resolving the caller twice.

Wire errors are plain parsed JSON and therefore deliberately fail core's provenance guard. Only after schema, correlation, capability, fixed-message/path/details, size, and snapshot-hash checks succeed, rebuild the sanitized error with `createStyleToolError(code,message,path,details)` and reject the pending call with that fresh object. Never cast or throw the decoded wire object. Unknown internal failures become a fixed provenance-authentic `INTERNAL`; live MCP catch paths may then rely only on `isStyleToolError`, preserving every validated primary code—including ordinary `INTERNAL`/`IO_ERROR`, `REVISION_CONFLICT`, and `TIMEOUT`—while mapping forged/unknown values safely.

Store any cached Style as a tagged pair `{style, styleHash}`. On every accepted success or authoritative error/event snapshot, validate first and then feed metadata through the monotonic merge below; retain/cache Style only when `style.read` is present, the frame actually contains Style, and its recomputed hash equals the accepted styleHash. If an advancing metadata-only snapshot/receipt changes the hash, clear the old cached Style immediately. It may be retained across a revision-only change only while its tagged hash still equals current metadata. A receipt transaction therefore updates metadata without inventing diff contents or leaving stale Style. The Style MCP resource/getter returns a cache only when `cached.styleHash === metadata.styleHash`.

An error `currentSnapshot` is allowed only on the pending correlated `applyTransaction`. Validate it under the handle's capability/Style byte/hash rules and against that mutation's dispatch baseline before rehydrating the error: the pair is either exactly the baseline revision/hash (no authoritative Style change) or exactly `baseline.revision + 1` with a different hash (one changed current Style). Any other revision/hash semantics, any snapshot on a non-mutation error, or any write-only Style is a `1008` violation that neither settles nor changes the mirror. For a valid snapshot under any primary error code, run the monotonic merge first, clearing/filling the tagged cache as appropriate, and only then rebuild/reject the original code and release/pump the queue. `TIMEOUT` remains valid only after the browser's underlying non-abortable Map work settled or was authoritatively resynchronized; it is not speculative. A mutation failure without `currentSnapshot` does not change the mirror. `disconnect` rejects active and queued calls with `BRIDGE_DISCONNECTED`; `close` disconnects every peer and clears both timer classes.

Route every success metadata pair and authoritative mutation-failure/event snapshot through one `mergeMirrorRevision` function after all capability/size/hash checks and transaction-baseline checks. If `candidate.revision < current.revision`, treat it as stale: a correlated result still settles its caller exactly once with its validated typed value/error, but it cannot change revision, hash, cached Style, or sync state; a stale event is ignored. If revisions are equal, require identical hashes or policy-close with `1008` before settlement; an identical pair may fill an absent tagged cache only with its separately validated matching Style. Only a higher revision advances metadata and applies the tagged-cache rule. This covers an event overtaking an earlier command result without requiring browser send ordering and prevents any mutation-failure snapshot from rolling the server backward.

A strict `mapStatus(syncState:'unknown')` from the active peer bypasses revision merge because it carries no snapshot: increment the handle's monotonic `syncEpoch`, immediately set it unknown, clear its tagged Style cache, reject new and not-yet-sent queued commands locally with provenance-authentic `MAP_NOT_READY`, and send no browser command. Stamp each pending correlation with `dispatchSyncEpoch`. A result from an older epoch is still fully validated and may settle its original caller exactly once, but none of its success/error snapshot data may merge, fill cache, or restore synchronization—even when revision/hash equals the pre-status pair. Keep an already active non-abortable correlation under its normal timeout/resync rules. There is deliberately no `mapStatus:'known'`; only a later capability/size/hash-valid authoritative snapshot event in the current epoch (or a fresh registration) may restore `syncState:'known'` and dispatch. MCP list/resources therefore cannot expose a stale Style while the browser has declared uncertainty.

- [ ] **Step 6: Write failing external-snapshot and revision-conflict resync tests**

```ts
test('accepts authoritative browser snapshots and never retries a conflict', async () => {
  const pending = registry.execute('demo-map', applyCommand(0, hash0));
  await registry.acceptResult(fakePeer.id, conflictFor(fakePeer.sent[0], snapshot(1, hash1, style1)));
  await assert.rejects(pending, (error: unknown) => {
    assert.equal(isStyleToolError(error), true);
    assert.equal((error as StyleToolError).code, 'REVISION_CONFLICT');
    return true;
  });
  assert.equal(fakePeer.sent.length, 1);
  assert.deepEqual(registry.get('demo-map')?.snapshot, snapshot(1, hash1, style1));
});

test('merges an ordinary mutation failure snapshot before rejecting and pumping the next command', async () => {
  const first = registry.execute('demo-map', applyCommand(0, hash0));
  const second = registry.execute('demo-map', applyCommand(1, hash1));
  await registry.acceptResult(
    fakePeer.id,
    failureFor(fakePeer.sent[0], 'INTERNAL', {
      currentSnapshot: snapshot(1, hash1, style1),
      rolledBack: false,
    }),
  );
  await assert.rejects(first, (error: unknown) =>
    isStyleToolError(error) && error.code === 'INTERNAL');
  assert.deepEqual(registry.get('demo-map')?.snapshot, snapshot(1, hash1, style1));
  assert.equal(fakePeer.sent.length, 2);
  assert.equal(fakePeer.sent[1]?.command.expectedRevision, 1);
  assert.equal(fakePeer.sent[1]?.command.expectedStyleHash, hash1);
  registry.disconnect(fakePeer.id);
  await assert.rejects(second, hasCode('BRIDGE_DISCONNECTED'));
});

test('write-only IO failure preserves metadata, original code, and clears the old tagged Style', async () => {
  const fixture = await registryWithCapabilities(['style.write'], snapshot(0, hash0));
  const pending = fixture.registry.execute('demo-map', applyCommand(0, hash0));
  await fixture.registry.acceptResult(
    fixture.peer.id,
    failureFor(fixture.peer.sent[0], 'IO_ERROR', {
      currentSnapshot: { revision: 1, styleHash: hash1 },
      rolledBack: false,
    }),
  );
  await assert.rejects(pending, (error: unknown) =>
    isStyleToolError(error) && error.code === 'IO_ERROR');
  assert.equal(fixture.registry.get('demo-map')?.metadata.revision, 1);
  assert.equal(fixture.registry.get('demo-map')?.metadata.styleHash, hash1);
  assert.equal(fixture.registry.get('demo-map')?.snapshot.style, undefined);
});

test('policy-closes a non-mutation error that forges an authoritative snapshot', async () => {
  const pending = registry.execute('demo-map', getStyleCommand());
  await assert.rejects(
    registry.acceptResult(
      fakePeer.id,
      failureFor(fakePeer.sent[0], 'INTERNAL', { currentSnapshot: snapshot(1, hash1, style1) }),
    ),
    /mutation|protocol/i,
  );
  assert.equal(fakePeer.closeCode, 1008);
  assert.deepEqual(registry.get('demo-map')?.snapshot, snapshot(0, hash0, style0));
  registry.disconnect(fakePeer.id);
  await assert.rejects(pending, hasCode('BRIDGE_DISCONNECTED'));
});

test('an application finalizer rejection rejects only its caller and keeps the peer/queue healthy', async () => {
  const first = registry.execute(
    'demo-map',
    getStyleCommand(),
    undefined,
    () => { throw responseTooLargeError(); },
  );
  await registry.acceptResult(fakePeer.id, successFor(fakePeer.sent[0], styleResult(0, hash0, largeStyle)));
  await assert.rejects(first, hasReason('responseTooLarge'));
  assert.equal(fakePeer.closeCode, undefined);
  assert.equal(registry.get('demo-map')?.snapshot.style, undefined);
  const second = registry.execute('demo-map', getStyleCommand());
  assert.equal(fakePeer.sent.length, 2);
  await registry.acceptResult(fakePeer.id, successFor(fakePeer.sent[1], styleResult(0, hash0, smallStyle)));
  assert.equal((await second).style.version, 8);
  assert.equal(unhandledRejections.length, 0);
});

test('contains unknown hash failures and rejects callers only with provenance-authentic errors', async () => {
  const secret = 'secret-sentinel-hash-failure';
  const fixture = await registryWithInjectedHash(async (style) => {
    if (styleHasSentinel(style, secret)) throw new Error(secret);
    return hashStyle(style);
  });
  const pending = fixture.registry.execute('demo-map', getStyleCommand());
  await assert.rejects(
    fixture.registry.acceptResult(
      fixture.peer.id,
      successFor(fixture.peer.sent[0], styleResult(1, hashB, styleContaining(secret))),
    ),
    /protocol|hash/i,
  );
  assert.equal(fixture.peer.closeReason?.includes(secret), false);
  assert.deepEqual(fixture.registry.get('demo-map')?.snapshot, snapshot(0, hash0, style0));
  fixture.registry.disconnect(fixture.peer.id);
  await assert.rejects(
    pending,
    (error: unknown) => isStyleToolError(error) && error.code === 'BRIDGE_DISCONNECTED',
  );
});

test('externalStyleChange advances the mirror only for the current peer', async () => {
  await registry.acceptEvent(fakePeer.id, externalStyleEvent(snapshot(2, hash2, style2)));
  assert.equal(registry.get('demo-map')?.metadata.revision, 2);
  await assert.rejects(registry.acceptEvent('stale-peer', externalStyleEvent(snapshot(3, hash3, style3))), /peer/);
});

test('rejects Style/hash mismatch independently in results and events', async () => {
  const resultPeer = await registryWithCapabilities(['style.read'], snapshot(0, hash0, style0));
  const pending = resultPeer.registry.execute('demo-map', getStyleCommand());
  await assert.rejects(
    resultPeer.registry.acceptResult(
      resultPeer.peer.id,
      successFor(resultPeer.peer.sent[0], styleResult(1, hashB, styleA)),
    ),
    /hash|protocol/i,
  );
  assert.deepEqual(resultPeer.registry.get('demo-map')?.snapshot, snapshot(0, hash0, style0));
  resultPeer.registry.disconnect(resultPeer.peer.id);
  await assert.rejects(pending, hasCode('BRIDGE_DISCONNECTED'));

  const eventPeer = await registryWithCapabilities(['style.read'], snapshot(0, hash0, style0));
  await assert.rejects(
    eventPeer.registry.acceptEvent(
      eventPeer.peer.id,
      externalStyleEvent(snapshot(1, hashB, styleA)),
    ),
    /hash|protocol/i,
  );
  assert.deepEqual(eventPeer.registry.get('demo-map')?.snapshot, snapshot(0, hash0, style0));
  assert.equal(eventPeer.peer.closeCode, 1008);
});
```

- [ ] **Step 7: Implement authoritative mutation-failure resync without retries**

For any correlated `applyTransaction` error carrying a bounded `currentSnapshot`, validate capability/Style/hash/baseline semantics, feed it through `mergeMirrorRevision`, rebuild the authentic error with its original code, reject the original request, and do not retry. Merge must finish before the error settles or the next queued command is checked, so the next mutation sees the new revision/hash. A finalizer error is an application-result rejection, not a peer protocol failure: reject only that `execute` promise, complete `acceptResult`/the server inbound tail normally, pump the next command, keep the socket connected, and never re-run the browser read; late or unknown exceptions are handled once without an unhandled rejection. Call `assertInboundEventAllowed` before accepting `mapSnapshot`, `externalStyleChange`, or `mapStatus`, and accept them only from the active peer. The unified merge advances on higher revision, accepts only the same hash at an equal revision, and ignores a lower event/result snapshot for mirror purposes as specified above; the first post-reconnect registration remains the sole fresh ownership install. For a peer without `style.read`, reject any inbound snapshot or error detail that nevertheless contains a Style/diff/before/after value and never retain or expose it; authoritative mutation failures/events are metadata-only by contract. Capability checks and code-specific error-detail allowlists are required even if the browser client is this package's own implementation, because the WebSocket peer is untrusted.

- [ ] **Step 8: Run registry tests**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/bridge/registry.test.js`

Expected: PASS for liveness-gated registration with no initial/replacement ghost after deferred-hash termination, idempotent same-attempt ack-loss replay with the same lease and no second eviction, rejection of borrowed/different attempts, async replacement races, private lease replacement, server-side capability denial before queueing, write-only receipt enforcement, independent Style/diff/hash/query/image validation, applied/no-op revision semantics, `INTERNAL`/`IO_ERROR` authoritative mutation-failure merge before original-code rejection and next-command dispatch, non-mutation snapshot closure, application-finalizer rejection without disconnect/retry/cache merge, malicious full-result disconnect without settlement/mirror change, send failure cleanup, serialization, typed correlation, monotonic revision merge, unknown sync epochs/status recovery, one deadline plus transport grace, no overlap after caller timeout, disconnect, mirror-on-success, external changes, and conflict resync without retry.

- [ ] **Step 9: Commit the registry**

```bash
rtk git add src/bridge/registry.ts src/bridge/registry.test.ts
rtk git commit -m "feat: add revisioned live map registry"
```

### Task 4: Authenticated loopback WebSocket server

**Files:**
- Create: `src/bridge/server.ts`
- Create: `src/bridge/server.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `LiveMapRegistry`, protocol codecs/schemas including the shared `BridgeTokenSchema`, and bridge error types.
- Produces: `BridgeServerOptions`, `BridgeServerHandle`, and `createBridgeServer(options): Promise<BridgeServerHandle>`. This Node-only module is imported internally by MCP and is never exported by `src/bridge/index.ts`.

- [ ] **Step 1: Add the Node WebSocket dependencies**

Run: `rtk pnpm add ws@^8.21.3 && rtk pnpm add -D @types/ws@^8.18.1`

Expected: `package.json` contains `ws` in dependencies and `@types/ws` in devDependencies; the lockfile resolves 8.21.x and 8.18.x respectively.

- [ ] **Step 2: Write failing real-WebSocket tests for defaults, token entropy, and Origin checks**

```ts
test('starts on loopback with a generated 32-byte token', async (t) => {
  const server = await createBridgeServer({ port: 0, allowedOrigins: ['http://127.0.0.1:5173'] });
  t.after(() => server.close());
  assert.equal(server.host, '127.0.0.1');
  assert.equal(Buffer.from(server.generatedToken ?? '', 'base64url').byteLength, 32);
  assert.equal(new URL(server.url).search, '');
});

test('never exposes a supplied token on the public server handle', async (t) => {
  const server = await createBridgeServer({ token: token32, port: 0, allowedOrigins: ['http://127.0.0.1:5173'] });
  t.after(() => server.close());
  assert.equal(server.generatedToken, undefined);
  assert.equal(JSON.stringify(server).includes(token32), false);
});

test('rejects missing or unlisted Origin before WebSocket acceptance', async (t) => {
  const server = await startServer(t);
  await assert.rejects(openWs(server.url), /401|403|unexpected server response/i);
  await assert.rejects(openWs(server.url, 'https://evil.example'), /401|403|unexpected server response/i);
  await assert.doesNotReject(openWs(server.url, 'http://127.0.0.1:5173'));
});

test('rejects lossy or non-HTTP Origin allowlist entries before listening', async () => {
  for (const origin of [
    'https://app.example/restricted', 'https://user:password@app.example',
    'https://app.example?scope=all', 'data:text/plain,opaque', 'https://*.example',
  ]) {
    await assert.rejects(createBridgeServer({ port: 0, allowedOrigins: [origin] }), /origin/i);
  }
  assert.equal(activeListeningServerCount(), 0);
});
```

- [ ] **Step 3: Compile to verify the server test is red**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json`

Expected: FAIL because `src/bridge/server.ts` does not exist.

- [ ] **Step 4: Implement loopback binding, exact Origin validation, and token construction**

```ts
export interface BridgeServerOptions {
  host?: string;
  port?: number;
  token?: string;
  allowedOrigins: readonly string[];
  authTimeoutMs?: number;
  registrationTimeoutMs?: number;
  operationTimeoutMs?: number;
  limitCeilings?: Partial<BridgeLimitSet>;
  registry?: LiveMapRegistry;
}

export interface BridgeServerHandle {
  host: string;
  port: number;
  url: string;
  generatedToken?: string;
  limitCeilings: BridgeLimitSet;
  registry: LiveMapRegistry;
  close(): Promise<void>;
}

export async function createBridgeServer(options: BridgeServerOptions): Promise<BridgeServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const authenticationToken = options.token ?? randomBytes(32).toString('base64url');
  const limitCeilings = resolveBridgeLimitCeilings(options.limitCeilings);
  BridgeTokenSchema.parse(authenticationToken);
  // Create an HTTP server, reject upgrades whose normalized Origin is absent from
  // the exact allowlist, then pass accepted sockets to WebSocketServer({ noServer: true,
  // maxPayload: limitCeilings.maxMessageBytes }).
}
```

Resolve omitted ceilings from `MAX_BRIDGE_MESSAGE_BYTES`, `DEFAULT_MAX_STYLE_BYTES`, `DEFAULT_MAX_DIFF_BYTES`, and `DEFAULT_MAX_OPERATIONS`; validate explicit lower/raise values with `BridgeLimitSetSchema`. Construct an injected registry with the same ceilings, or reject an injected registry whose exposed ceilings differ. Normalize allowed origins once and reject entries containing paths, credentials, queries, or fragments. Import and apply the same UTF-8 32..256-byte `BridgeTokenSchema` used by the wire auth frame, so every server-startable token is wire-valid. Keep `authenticationToken` in the server closure. Return only `ws://host:assignedPort` without a token/query; expose `generatedToken` only when this call generated it, and expose no supplied token or `tokenWasGenerated` flag that invites callers to read it.

- [ ] **Step 5: Write failing first-frame, timeout, version, and oversized-frame tests**

```ts
test('requires auth as the first frame and closes wrong tokens with policy violation', async (t) => {
  const server = await startServer(t);
  const socket = await acceptedSocket(server);
  socket.send(JSON.stringify(registerFrame()));
  assert.equal(await closeCode(socket), 1008);
  const wrong = await acceptedSocket(server);
  wrong.send(JSON.stringify(authFrame('wrong-token-with-at-least-thirty-two-bytes')));
  assert.equal(await closeCode(wrong), 1008);
});

test('closes unauthenticated, wrong-version, and oversized clients', async (t) => {
  const { server, authenticationToken } = await startServerWithKnownToken(t, { authTimeoutMs: 30, limitCeilings: { maxMessageBytes: 256 } });
  assert.equal(await closeCode(await acceptedSocket(server)), 1008);
  assert.equal(await sendAndClose(server, { ...authFrame(authenticationToken), protocolVersion: 2 }), 1002);
  assert.equal(await sendRawAndClose(server, 'x'.repeat(257)), 1009);
  assert.equal(activeAuthTimerCount(), 0);
});

test('clears the auth timer on success, parse/token failure, socket close, and socket error', async (t) => {
  const server = await startServer(t, { authTimeoutMs: 10_000 });
  await exerciseEveryAuthTerminalBranch(server);
  assert.equal(activeAuthTimerCount(), 0);
});

test('uses a separate bounded registration timer after authentication', async (t) => {
  const { server, client } = await authenticatedClient(t, undefined, { registrationTimeoutMs: 30 });
  assert.equal(await closeCode(client.socket), 1008);
  assert.equal(activeAuthTimerCount(), 0);
  assert.equal(activeRegistrationTimerCount(), 0);
});
```

- [ ] **Step 6: Implement the authentication state machine before general decoding**

For each accepted socket, start a default 5-second auth timer and create one idempotent `finishAuthentication()` cleanup closure that clears it and updates the injected test timer tracker exactly once. Invoke that closure on every terminal auth branch: schema/version parse failure, wrong token, auth timeout, oversized payload, socket close, socket error, server shutdown, and synchronous send/handler failure. Decode the first frame only with `BridgeAuthFrameSchema`. Use `timingSafeEqual` over equal-length UTF-8 buffers. On credential success, send a correlated `authenticated` result with a public `connectionId` and exact server ceilings through the same outstanding-send Promise gate used by commands. Only its successful send callback finishes auth cleanup, advances to `authenticated`, and starts a separate default 5-second registration timer. Clear that second timer on successful registered-send completion and every terminal branch; an authenticated client that never registers closes `1008` with both timer trackers at zero.

The `registered` result also crosses the outstanding-send gate: registry commit alone leaves the socket in `registering`; only the callback success advances it to `registered` and permits result/event handling. Close/error/server shutdown rejects either outstanding control send even when the callback never arrives; late callbacks are idempotent no-ops. Every inbound tail continuation rechecks generation/state after the awaited send, so no frame can overtake an unsent `authenticated`/`registered` acknowledgement. Decode later inbound frames with the registered effective `maxMessageBytes` (which cannot exceed the server ceiling). Map parse failures to `1002`, authentication/origin/registration-timeout failures to `1008`, and payload failures to `1009`; do not echo tokens, attempt IDs, Style values, or raw frames in reasons.

- [ ] **Step 7: Write failing registration, replacement, and correlated routing tests**

```ts
test('registers one map and routes correlated results through the registry', async (t) => {
  const { server, client } = await authenticatedClient(t);
  const registered = await client.register(registration('demo-map'));
  assert.match(registered.leaseId, /^[A-Za-z0-9_-]{43}$/);
  const pending = server.registry.execute('demo-map', { type: 'getStyle' });
  const command = await client.nextCommand();
  client.send(successFor(command, styleResult(0, hash0, style0)));
  assert.deepEqual(await pending, styleResult(0, hash0, style0));
});

test('only the matching private lease can replace an active map', async (t) => {
  const first = await authenticatedClient(t);
  const lease = (await first.client.register(registration('demo-map'))).leaseId;
  const second = await authenticatedClient(t, first.server);
  await assert.rejects(second.client.register(registration('demo-map')), /CONFLICT/);
  await second.client.register(registration('demo-map', lease));
  assert.equal(await closeCode(first.socket), 4001);
});

test('close during deferred initial/replacement registration hash never installs a ghost', async (t) => {
  for (const mode of ['initial', 'replacement'] as const) {
    const hashes = controlledHashStyle();
    const { server, authenticationToken } = await startServerWithKnownToken(t, { hashStyle: hashes.hash });
    const old = mode === 'replacement' ? await fullyRegisteredClient(server, authenticationToken) : undefined;
    hashes.defer(style1);
    const candidate = await authenticatedClient(t, server);
    candidate.send(registrationWithSnapshot('demo-map', snapshot(1, hash1, style1), old?.leaseId));
    await hashes.waitUntilStarted(style1);
    candidate.socket.terminate();
    hashes.resolve(style1, hash1);
    await server.waitForInboundIdle();
    assert.equal(server.registry.get('demo-map')?.peerId, old?.peerId);
    assert.equal(old?.socket.closeCalls ?? 0, 0);
  }
});

test('an ack-lost registration attempt replays the same lease across socket generations', async (t) => {
  const first = await fullyRegisteredClientForMap(t, 'demo-map');
  const attemptId = randomRegistrationAttemptId();
  const frame = registration('demo-map', first.leaseId, { registrationAttemptId: attemptId });
  const replacing = await authenticatedClient(t, first.server);
  const heldAck = replacing.holdRegisteredSendCallback();
  replacing.send(frame);
  await replacing.waitUntilRegistryCommit();
  const committedLease = first.server.registry.get('demo-map')?.leaseId;
  assert.equal(first.socket.closeCalls, 1);

  const replay = await authenticatedClient(t, first.server);
  const registered = await replay.register(frame); // same attempt while the held-ack generation still looks live
  assert.equal(registered.leaseId, committedLease);
  assert.equal(first.socket.closeCalls, 1);
  assert.equal(replacing.socket.closeCalls, 1);
  assert.equal(first.server.registry.get('demo-map')?.peerId, replay.peerId);
  assert.equal(first.server.registry.get('demo-map')?.metadata.syncState, 'unknown');
  await assert.rejects(first.server.registry.projectCachedStyle('demo-map', identity), hasCode('MAP_NOT_READY'));
  await assert.rejects(first.server.registry.execute('demo-map', getStyleCommand()), hasCode('MAP_NOT_READY'));
  assert.equal(replay.commandsReceived.length, 0);
  replay.send(mapSnapshotEvent(snapshot(0, hash0, style0)));
  await first.server.waitForInboundIdle();
  assert.equal(first.server.registry.get('demo-map')?.metadata.syncState, 'known');
  const resumed = first.server.registry.execute('demo-map', getStyleCommand());
  assert.equal((await replay.nextCommand()).command.type, 'getStyle');
  replay.respondToNext(styleResult(0, hash0, style0));
  await resumed;
  heldAck(undefined); // late callback cannot rotate/revive the superseded generation
  await flushMicrotasks();
  assert.equal(first.server.registry.get('demo-map')?.leaseId, committedLease);
});

test('auth and registration control results advance state only after their send callback succeeds', async (t) => {
  const fixture = await serverWithControllableSends(t, { registrationTimeoutMs: 30 });
  const socket = await fixture.acceptedSocket();
  const authCallback = socket.holdNextSendCallback();
  socket.sendFromClient(authFrame(fixture.token));
  assert.equal(fixture.registry.get('demo-map'), undefined);
  authCallback(undefined);
  const registeredCallback = socket.holdNextSendCallback();
  socket.sendFromClient(registration('demo-map'));
  await fixture.waitUntilRegistryCommit();
  socket.sendFromClient(externalStyleEvent(snapshot(1, hash1, style1)));
  assert.equal(fixture.registry.get('demo-map')?.metadata.revision, 0);
  registeredCallback(undefined);
  await fixture.waitForInboundIdle();
  assert.equal(fixture.registry.get('demo-map')?.metadata.revision, 1);
  assert.equal(fixture.activeRegistrationTimers(), 0);
});

test('closes a write-only browser that returns a forged full transaction', async (t) => {
  const { server, client, socket } = await authenticatedClient(t);
  await client.register(registration('demo-map', undefined, ['style.write']));
  const pending = server.registry.execute('demo-map', applyCommand(0, hash0));
  const command = await client.nextCommand();
  client.send(successFor(command, fullTransactionResultContaining('secret-sentinel')));
  assert.equal(await closeCode(socket), 1008);
  await assert.rejects(pending, hasCode('BRIDGE_DISCONNECTED'));
  assert.equal(JSON.stringify(server.registry.list()).includes('secret-sentinel'), false);
});

test('a WebSocket send callback error disconnects and clears registry work once', async (t) => {
  const { server, client, socket } = await authenticatedClient(t);
  await client.register(registration('demo-map'));
  socket.failNextSendCallback(new Error('transport-secret'));
  const first = server.registry.execute('demo-map', getStyleCommand());
  const second = server.registry.execute('demo-map', listImagesCommand());
  await assert.rejects(first, hasCode('BRIDGE_DISCONNECTED'));
  await assert.rejects(second, hasCode('BRIDGE_DISCONNECTED'));
  assert.equal(server.registry.get('demo-map'), undefined);
  assert.equal(activeOperationTimerCount(), 0);
  assert.equal(unhandledRejections.length, 0);
});

test('close before send callback rejects the send and a late callback cannot revive dispatch', async (t) => {
  const { server, client, socket } = await authenticatedClient(t);
  await client.register(registration('demo-map'));
  const callback = socket.holdNextSendCallback();
  const first = server.registry.execute('demo-map', getStyleCommand());
  const second = server.registry.execute('demo-map', listImagesCommand());
  socket.closeFromClient();
  await assert.rejects(first, hasCode('BRIDGE_DISCONNECTED'));
  await assert.rejects(second, hasCode('BRIDGE_DISCONNECTED'));
  const replacement = await authenticatedClient(t, server);
  await replacement.client.register(registration('demo-map'));
  callback(undefined); // deliberately late success
  await flushMicrotasks();
  assert.equal(socket.commandSendCount, 1);
  assert.equal(server.registry.get('demo-map')?.peerId, replacement.peerId);
  assert.equal(activeOperationTimerCount(), 0);
  assert.equal(server.outstandingSendCount(), 0);
  assert.equal(unhandledRejections.length, 0);
});

test('server close terminates a send whose WebSocket callback never arrives', async (t) => {
  const { server, client, socket } = await authenticatedClient(t);
  await client.register(registration('demo-map'));
  socket.neverCompleteNextSend();
  const pending = server.registry.execute('demo-map', getStyleCommand());
  await server.close();
  await assert.rejects(pending, hasCode('BRIDGE_DISCONNECTED'));
  assert.equal(server.outstandingSendCount(), 0);
  assert.equal(activeOperationTimerCount(), 0);
  assert.equal(unhandledRejections.length, 0);
});

test('serializes event1 then event2 despite different hash delays', async (t) => {
  const hashes = controlledHashStyle();
  const { server, client } = await authenticatedClient(t, undefined, { hashStyle: hashes.hash });
  await client.register(registration('demo-map'));
  hashes.resetStarted();
  hashes.defer(style1);
  hashes.resolveImmediately(style2, hash2);
  client.send(externalStyleEvent(snapshot(1, hash1, style1)));
  client.send(externalStyleEvent(snapshot(2, hash2, style2)));
  assert.deepEqual(hashes.startedStyles(), [style1]);
  await flushMicrotasks();
  assert.equal(server.registry.get('demo-map')?.metadata.revision, 0);
  hashes.resolve(style1, hash1);
  await server.waitForInboundIdle();
  assert.deepEqual(hashes.startedStyles(), [style1, style2]);
  assert.equal(server.registry.get('demo-map')?.metadata.revision, 2);
  assert.equal(server.registry.get('demo-map')?.metadata.styleHash, hash2);
  assert.equal(unhandledRejections.length, 0);
});

test('serializes a delayed result before a following event', async (t) => {
  const hashes = controlledHashStyle();
  const { server, client } = await authenticatedClient(t, undefined, { hashStyle: hashes.hash });
  await client.register(registration('demo-map'));
  hashes.resetStarted();
  hashes.defer(style1);
  hashes.resolveImmediately(style2, hash2);
  const pending = server.registry.execute('demo-map', getStyleCommand());
  const command = await client.nextCommand();
  client.send(successFor(command, styleResult(1, hash1, style1)));
  client.send(externalStyleEvent(snapshot(2, hash2, style2)));
  assert.deepEqual(hashes.startedStyles(), [style1]);
  assert.equal(isSettled(pending), false);
  hashes.resolve(style1, hash1);
  await server.waitForInboundIdle();
  assert.deepEqual(await pending, styleResult(1, hash1, style1));
  assert.deepEqual(hashes.startedStyles(), [style1, style2]);
  assert.equal(server.registry.get('demo-map')?.metadata.revision, 2);
  assert.equal(unhandledRejections.length, 0);
});
```

- [ ] **Step 8: Connect authenticated socket frames to `LiveMapRegistry`**

Wrap the socket as a `BridgePeer`; its `send(frame):Promise<void>` strict-encodes the frame, catches a synchronous `ws.send` throw, and otherwise settles only from the `ws.send(data, callback)` error/success callback. Register each send settler in a socket-local outstanding set before calling `ws.send`. The single idempotent terminal gate rejects and removes every outstanding send on close, error, policy close, or server shutdown; each WebSocket callback first removes/settles only if still outstanding, so a late callback is a no-op. `BridgeServerHandle.close()` therefore cannot hang on a missing callback. Give every socket generation one AbortController plus a provenance-backed registry liveness capability; the terminal gate aborts it before disconnect/cleanup.

Give every authenticated socket one `inboundTail: Promise<void>` and append each raw post-auth message with `inboundTail = inboundTail.then(() => decodeParseAndHandleInArrivalOrder(raw))`; both bounded decode/strict parse and every async registry await occur inside that FIFO tail. Attach one terminal rejection handler so no schema/hash rejection becomes unhandled. The registration is the first tail operation: move the connection into `registering`, pass its exact generation liveness capability to async `registry.register`, and policy-close if any unrelated frame arrives while registration is unresolved. A same-map/exact-fingerprint `registrationAttemptId` replay is the one idempotent generation-handoff exception defined in Task 3. Recheck generation after the await, send the correlated `registered` result echoing the exact accepted limits/lease through the outstanding-send gate, and enter `registered` only after its callback succeeds. Route later `result` and `event` frames by awaiting async `registry.acceptResult`/`acceptEvent` on the same tail, so delayed Style validation/hash can never let a later result→event or event1→event2 sequence overtake. Recheck socket/peer ownership after each await. A failed hash/validation/replacement returns the stable projected error without evicting an old peer. A registry application-finalizer rejection is delivered only to its original `execute` caller; `acceptResult` resolves normally and the inbound tail must not convert `responseTooLarge` into a `1008`/disconnect.

Reject command frames sent by the browser. Treat registry capability-contract violations as WebSocket policy violations: close with `1008`, never echo the offending frame, and rely on one idempotent socket terminal gate shared by tail failures, `close`, `error`, and server shutdown to call `registry.disconnect(peerId)` exactly once. Once terminal, queued tail operations become no-ops and cannot mutate the mirror or send. `BridgeServerHandle.close()` stops upgrades, closes all sockets, awaits every inbound tail and the HTTP close callback, and closes only a registry it created itself.

- [ ] **Step 9: Run the real WebSocket integration tests**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/bridge/server.test.js`

Expected: PASS for loopback, generated-token-only handoff, supplied-token non-exposure, URL secrecy, strict Origin rejection, first-frame authentication, separate auth/registration timeouts, control-frame send-callback state gates, max payload, liveness-aborted initial/replacement hashing with no ghost or old-owner eviction, same-attempt ack-loss replay with one lease/generation handoff, old-generation work rejection, unknown/cache-cleared/no-dispatch replay window, mandatory snapshot confirmation before server recovery, async registration, strict inbound arrival ordering across delayed Style hashes, private lease replacement, correlation, application-finalizer rejection without socket termination, malicious capability-variant closure, send throw/callback/close races including missing/late callbacks, idempotent disconnect, and clean shutdown with no outstanding sends.

- [ ] **Step 10: Commit the Node bridge server**

```bash
rtk git add package.json pnpm-lock.yaml src/bridge/server.ts src/bridge/server.test.ts
rtk git commit -m "feat: add authenticated bridge websocket server"
```

### Task 5: Bounded browser runtime command dispatcher

**Files:**
- Create: `src/bridge/browser-runtime.ts`
- Create: `src/bridge/browser-runtime.test.ts`
- Create: `src/bridge/browser-runtime-layer-contract.test.ts`

**Interfaces:**
- Consumes: `prepareTransactionForMap`, its `Promise<PreparedMapStyleTransaction | MapStyleApplyResult>` return, the opaque handle's only public inspection surface `PreparedMapStyleTransaction.view`, `applyPreparedStyleToMap` with shared `MapOperationDeadline`, `querySourceFeaturesBounded(map, input)`, `queryRenderedFeaturesBounded(map, input)`, `createMapRuntimeCommands(map, {imageLoader})`, protocol commands/results, capability authorization, resource policy, canonical JSON/hash, core `validateStyleDocument`, browser-safe `jsonUtf8ByteLength(value: JsonValue): number`, `DEFAULT_MAX_STYLE_BYTES`, `DEFAULT_MAX_DIFF_BYTES`, `DEFAULT_MAX_OPERATIONS`, `CoreExecutionLimits`, and adapter `RuntimeImageLoader`.
- Produces: `BrowserMapState`, `BrowserRuntimeOptions`, `BrowserRuntimeResult<C> = BridgeResultFor<C>`, `BrowserMapRuntime`, async `createBrowserMapRuntime(map, options): Promise<BrowserMapRuntime>`, `.snapshot()`, `.noteExternalStyle()`, and generic `.execute<C extends BridgeCommand>(command, execution?): Promise<BrowserRuntimeResult<C>>`.

- [ ] **Step 1: Write failing queue-dequeue revision/hash recheck tests**

```ts
test('atomically rechecks revision and canonical hash only after queue dequeue', async () => {
  const runtime = await createBrowserMapRuntime(fakeMap(style0), options());
  const blocker = runtime.execute(queryCommandHeldByLatch);
  const mutation = runtime.execute(applyCommand({ expectedRevision: 0, expectedStyleHash: hash0 }));
  fakeMapInstance.setExternalStyle(style1);
  releaseQueryLatch();
  await blocker;
  await assert.rejects(mutation, (error: StyleToolError) => {
    assert.equal(error.code, 'REVISION_CONFLICT');
    const details = AuthoritativeSnapshotDetailsSchema.parse(error.details);
    assert.equal(details.currentSnapshot.revision, 1);
    assert.equal(details.currentSnapshot.styleHash, hash1);
    return true;
  });
  assert.equal(fakeMapInstance.setStyleCalls, 0);
});

test('rejects an oversized initial or external Style even for a write-only peer', async () => {
  const oversized = styleLargerThan(DEFAULT_MAX_STYLE_BYTES);
  await assert.rejects(
    createBrowserMapRuntime(fakeMap(oversized), options({ capabilities: ['style.write'] })),
    hasCode('INVALID_INPUT'),
  );
  const runtime = await createBrowserMapRuntime(fakeMap(style0), options({ capabilities: ['style.write'] }));
  fakeMapInstance.setExternalStyle(oversized);
  await assert.rejects(runtime.noteExternalStyle(), hasCode('INVALID_INPUT'));
  await assert.rejects(runtime.execute(applyCommand({ expectedRevision: 0, expectedStyleHash: hash0 })), hasCode('MAP_NOT_READY'));
  assert.equal(fakeMapInstance.setStyleCalls, 0);
});

test('sanitizes every initial/external Style without invoking hostile getters', async () => {
  let getterCalls = 0;
  const hostile = styleWithAccessor(() => { getterCalls += 1; throw new Error('must not run'); });
  await assert.rejects(createBrowserMapRuntime(fakeMap(hostile), options()), hasCode('INVALID_INPUT'));
  assert.equal(getterCalls, 0);

  const runtime = await createBrowserMapRuntime(fakeMap(style0), options());
  fakeMapInstance.setExternalStyle(hostile);
  await assert.rejects(runtime.noteExternalStyle(), hasCode('INVALID_INPUT'));
  assert.equal(getterCalls, 0);
  await assert.rejects(runtime.execute(getStyleCommand()), hasCode('MAP_NOT_READY'));
});

test('never accepts hostile post-settlement map output as authoritative', async () => {
  let getterCalls = 0;
  const hostile = styleWithAccessor(() => { getterCalls += 1; return 'secret'; });
  const runtime = await runtimeWhoseMapReturnsAfterApply(hostile);
  const pending = runtime.execute(applyCommand({ expectedRevision: 0, expectedStyleHash: hash0 }));
  await underlyingAdapterSettled();
  assert.equal(getterCalls, 0);
  assert.equal(runtimeTestDiagnostics(runtime).syncState, 'unknown');
  fakeMapInstance.setExternalStyle(styleRecovered);
  await runtime.noteExternalStyle();
  await assert.rejects(pending, hasCode('INTERNAL'));
  assert.equal(runtime.snapshot().styleHash, await hashStyle(styleRecovered));
});
```

- [ ] **Step 2: Compile to verify the browser runtime test is red**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json`

Expected: FAIL because `src/bridge/browser-runtime.ts` does not exist.

- [ ] **Step 3: Implement one serial queue and authoritative pre-command reconciliation**

```ts
export interface BrowserMapState {
  revision: number;
  styleHash: string;
  style: StyleDocument;
}

export interface BrowserRuntimeOptions {
  capabilities: readonly BridgeCapability[];
  resourcePolicy: ResourcePolicy;
  timeoutMs?: number;
  maxQueryFeatures?: number;
  maxQueryBytes?: number;
  maxRuntimeStateBytes?: number;
  maxImageBytes?: number;
  maxStyleBytes?: number;
  maxDiffBytes?: number;
  maxOperations?: number;
  imageLoader?: RuntimeImageLoader;
  onExternalStyleChange?: (snapshot: BrowserMapState) => void;
  onSyncStateChange?: (event: {
    syncState: 'unknown';
    reason: 'invalid-map-style' | 'adapter-authority-unavailable';
  }) => void;
}

export type BrowserRuntimeResult<C extends BridgeCommand> = BridgeResultFor<C>;
export interface BrowserMapRuntime {
  snapshot(): BrowserMapState;
  noteExternalStyle(): Promise<BrowserMapState>;
  execute<C extends BridgeCommand>(
    command: C,
    execution?: { deadlineAt?: number; signal?: AbortSignal },
  ): Promise<BrowserRuntimeResult<C>>;
}
export function createBrowserMapRuntime(
  map: Map,
  options: BrowserRuntimeOptions,
): Promise<BrowserMapRuntime>;
```

Resolve one immutable `CoreExecutionLimits` object per runtime: `maxStyleBytes = options.maxStyleBytes ?? DEFAULT_MAX_STYLE_BYTES`, `maxDiffBytes = options.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES`, and `maxOperations = options.maxOperations ?? DEFAULT_MAX_OPERATIONS`. Require each to be a positive safe integer. Embedders may lower or explicitly raise any of the three, and capability selection never changes them. Runtime creation is asynchronous because canonical SHA-256 is asynchronous: call `validateStyleDocument(map.getStyle(), {maxStyleBytes})`, retain only its normalized `ok:true.style`, then hash that normalized Style before resolving `createBrowserMapRuntime`. Never cast MapLibre's raw `StyleSpecification`, hash raw input, or read it after validation failure.

For `.execute`, resolve one absolute deadline when the call is enqueued, not when it reaches the queue head. The public runtime entry independently validates an explicit `execution.deadlineAt` as a safe integer satisfying `now() < deadlineAt <= now() + 10_000`; an equal/past value returns `TIMEOUT`, while a farther/unsafe value returns fixed `INVALID_INPUT`, all before queue insertion or Map/runtime work. Never clamp, rebase, or silently extend a wire deadline. Only a direct local call with no explicit value may create `now() + min(options.timeoutMs ?? 10_000, 10_000)`. Queue time therefore consumes the same budget. Combine optional caller `execution.signal` with one AbortController tied to that deadline and pass the single resulting `{expiresAt: deadlineAt, signal, now}` through validation, hashing/resource/image work and both adapter calls; never pass a new `timeoutMs` to a nested layer. A caller abort prevents not-yet-started work and abortable work; it cannot pretend an already invoked `Map#setStyle` settled. Settle abortable work once and discard its late completions.

Every authoritative observation—including initialization, dequeue reconciliation, post-settlement reads, and public no-argument `noteExternalStyle()`—must call `map.getStyle()` internally, pass that complete unknown value through `validateStyleDocument(raw, {maxStyleBytes})`, and hash/store only the normalized `ok:true.style`. `noteExternalStyle` accepts no caller value or alternate authority seam; tests first mutate the fake Map, then call it. If the hash differs from tracked state, advance revision once and publish an external-change callback before checking mutation preconditions. Invalid, accessor-bearing, or oversized Map output is never accepted merely because the peer lacks `style.read`: do not invoke getters, mark runtime synchronization unknown, call `onSyncStateChange({syncState:'unknown',reason:'invalid-map-style'})` exactly once for that transition, reject the observation with `INVALID_INPUT`, and block subsequent commands with `MAP_NOT_READY` until a later valid bounded no-argument `noteExternalStyle()` restores authority. Compare both expected values, return `REVISION_CONFLICT` with a bounded current snapshot on either mismatch, and include `style` only when `style.read` is granted. A MapLibre `setStyle` already invoked is not abortable: deadline expiry records the eventual response as `TIMEOUT`, but `runtime.execute` and the per-map promise tail remain unsettled until the adapter reports completion/rollback or a later validated Map observation yields authority. Only then update revision/hash, attach that `currentSnapshot`, return it, and release the next command. If state remains unknown, notify the recovery channel and keep writes blocked; never send a speculative timeout result.

- [ ] **Step 4: Write failing transaction/no-op/resource-policy tests**

```ts
test('applies a validated transaction and advances revision only after MapLibre completion', async () => {
  const runtime = runtimeWithDeferredAdapter();
  const pending = runtime.execute(applyCommand({ expectedRevision: 0, expectedStyleHash: hash0 }));
  assert.equal(runtime.snapshot().revision, 0);
  resolveAdapter({ ok: true, styleAuthority: 'current', style: style1, diff, changedLayers: ['roads'], changedSources: [], warnings: [], applied: true });
  const result = await pending;
  assert.equal(result.revision, 1);
  assert.equal(result.styleHash, hash1);
});

test('a no-op neither calls setStyle nor advances revision', async () => {
  const result = await runtime.execute(noOpApplyCommand(0, hash0));
  assert.equal(result.revision, 0);
  assert.equal(fakeMapInstance.setStyleCalls, 0);
});

test('checks all resulting resource fields before calling the adapter', async () => {
  await assert.rejects(runtime.execute(addRemoteSourceCommand), hasCode('CAPABILITY_DENIED'));
  assert.equal(fakeMapInstance.setStyleCalls, 0);
});

test('rejects every new relative Style candidate before prepared apply or Map access', async () => {
  const runtime = await createBrowserMapRuntime(fakeMap(style0), options({
    resourcePolicy: {
      baseUrl: 'https://allowed.example/app/',
      allowedResourceOrigins: ['https://allowed.example'],
    },
  }));
  for (const command of [
    applyCommandProducingRelativeGlyphs('./fonts/{fontstack}/{range}.pbf'),
    addGeoJsonLayerCommand({ data: './data/events.geojson' }),
  ]) {
    await assert.rejects(
      runtime.execute(command),
      hasCodeAndReason('INVALID_INPUT', 'relative-style-url'),
    );
  }
  assert.equal(applyPreparedSpy.calls.length, 0);
  assert.equal(fakeMapInstance.setStyleCalls, 0);
});

test('rejects an oversized prepared candidate before policy or MapLibre access', async () => {
  const runtime = runtimeWhoseCorePrepareRejects(styleLargerThan(configuredMaxStyleBytes));
  await assert.rejects(runtime.execute(applyCommand({ expectedRevision: 0, expectedStyleHash: hash0 })), hasCode('INVALID_INPUT'));
  assert.equal(resourcePolicySpy.calls.length, 0);
  assert.equal(fakeMapInstance.setStyleCalls, 0);
});

test('forwards one resolved limit set through adapter to core, including explicit raises', async () => {
  const raised = {
    maxStyleBytes: DEFAULT_MAX_STYLE_BYTES + 1024,
    maxDiffBytes: DEFAULT_MAX_DIFF_BYTES + 1024,
    maxOperations: DEFAULT_MAX_OPERATIONS + 1,
  };
  const runtime = await createBrowserMapRuntime(fakeMap(style0), options(raised));
  await runtime.execute(applyCommandWithOperationCount(raised.maxOperations));
  assert.deepEqual(pickCoreLimits(prepareTransactionSpy.calls[0]?.options), raised);
  assert.strictEqual(
    prepareTransactionSpy.calls[0]?.options.deadline,
    applyPreparedSpy.calls[0]?.options.deadline,
  );
  assert.deepEqual(Object.keys(applyPreparedSpy.calls[0]?.options ?? {}).sort(), ['deadline']);
  assert.equal(prepareTransactionSpy.calls.length, 1);
});

// compile-only contract: limits are frozen into PreparedMapStyleTransaction in phase one
// @ts-expect-error phase-two options deliberately reject execution-limit fields
void applyPreparedStyleToMap(fakeMapInstance, prepared, { deadline, maxStyleBytes: 1 });

// src/bridge/browser-runtime-layer-contract.test.ts: the Layer handle is opaque and its view is DeepReadonly.
declare const opaquePrepared: PreparedMapStyleTransaction;
void opaquePrepared.view.baselineHash;
void opaquePrepared.view.transactionResult.style;
// @ts-expect-error private authority is not a public top-level field
void opaquePrepared.transactionResult;
// @ts-expect-error private canonical baseline is not exported
void opaquePrepared.baselineCanonical;
// @ts-expect-error the public inspection graph cannot be mutated
opaquePrepared.view.transactionResult.style.layers.push(validLayer);
// @ts-expect-error a DeepReadonly inspection value is not a mutable validated StyleDocument
const mutableCandidate: StyleDocument = opaquePrepared.view.transactionResult.style;
// @ts-expect-error a DeepReadonly inspection value is not passed directly to mutable JsonValue consumers
const mutableJson: JsonValue = opaquePrepared.view.transactionResult.style;
void mutableCandidate;
void mutableJson;

test('browser runtime never casts the readonly view or reaches Layer private authority', async () => {
  const source = await readProjectSource('src/bridge/browser-runtime.ts');
  assert.doesNotMatch(source, /prepared\.(?:transactionResult|baselineCanonical|baselineHash|candidateStyle)/);
  assert.doesNotMatch(source, /prepared\.view[\s\S]{0,120}\bas\s+(?:StyleDocument|JsonValue|unknown|never)\b/);
  assert.match(source, /applyPreparedStyleToMap\(map,\s*prepared,\s*\{\s*deadline:/);
});

test('returns a same-baseline terminal core failure/no-op without reading Prepared fields or applying', async () => {
  const failed = runtimeWithPrepareResult(coreFailureMapResult({ styleAuthority: 'current', style: style0 }));
  await assert.rejects(failed.execute(applyCommand({ expectedRevision: 0, expectedStyleHash: hash0 })), hasCode('INVALID_INPUT'));
  const noOp = runtimeWithPrepareResult(coreNoOpMapResult({ styleAuthority: 'current', style: style0 }));
  const result = await noOp.execute(applyCommand({ expectedRevision: 0, expectedStyleHash: hash0 }));
  assert.equal(result.applied, false);
  assert.equal(resourcePolicySpy.calls.length, 0);
  assert.equal(applyPreparedSpy.calls.length, 0);
  assert.equal(fakeMapInstance.setStyleCalls, 0);
});

test('a terminal current-authority race advances once and returns conflict instead of stale no-op', async () => {
  const runtime = runtimeWithPrepareResult(coreNoOpMapResult({ styleAuthority: 'current', style: styleExternal }));
  await assert.rejects(
    runtime.execute(applyCommand({ expectedRevision: 0, expectedStyleHash: hash0 })),
    (error: StyleToolError) => {
      assert.equal(error.code, 'REVISION_CONFLICT');
      assert.deepEqual(
        AuthoritativeSnapshotDetailsSchema.parse(error.details).currentSnapshot,
        snapshot(1, hashExternal, styleExternal),
      );
      return true;
    },
  );
  assert.deepEqual(runtime.snapshot(), snapshot(1, hashExternal, styleExternal));
  assert.equal(resourcePolicySpy.calls.length, 0);
  assert.equal(applyPreparedSpy.calls.length, 0);
  assert.equal(fakeMapInstance.setStyleCalls, 0);
});

test('adopts current-authority Style while preserving each ordinary mutation failure code', async () => {
  for (const code of ['INTERNAL', 'IO_ERROR'] as const) {
    const runtime = runtimeWithApplyResult(rollbackFailedWithValidatedStyle({
      code, styleAuthority: 'current', style: styleAfterFailure,
    }));
    await assert.rejects(
      runtime.execute(applyCommand({ expectedRevision: 0, expectedStyleHash: hash0 })),
      (error: StyleToolError) => {
        assert.equal(error.code, code);
        assert.deepEqual(AuthoritativeSnapshotDetailsSchema.parse(error.details).currentSnapshot.style, styleAfterFailure);
        return true;
      },
    );
    assert.equal(runtime.snapshot().revision, 1);
    assert.equal(runtime.snapshot().styleHash, await hashStyle(styleAfterFailure));
    assert.equal(externalChangeCallbacksFor(runtime), 0);
  }
});

test('never adopts a pre-operation Style and blocks until an authoritative resync', async () => {
  const secret = 'pre-operation-style-must-not-become-current';
  const preOperation = styleContaining(secret);
  const runtime = runtimeWithApplyResult(rollbackFailedStateUnknown({
    styleAuthority: 'pre-operation', style: preOperation,
  }));
  const first = runtime.execute(applyCommand({ expectedRevision: 0, expectedStyleHash: hash0 }));
  const second = runtime.execute(getStyleCommand());
  await flushMicrotasks();
  assert.equal(secondCommandStarted(), false);
  assert.throws(() => runtime.snapshot(), hasCode('MAP_NOT_READY'));
  assert.equal(JSON.stringify(runtimeTestDiagnostics(runtime)).includes(secret), false);
  assert.deepEqual(syncStateEvents, [{ syncState: 'unknown', reason: 'adapter-authority-unavailable' }]);
  fakeMapInstance.setExternalStyle(styleRecovered);
  await runtime.noteExternalStyle();
  await assert.rejects(first, hasCode('INTERNAL'));
  assert.equal(secondCommandStarted(), true);
  assert.equal(runtime.snapshot().styleHash, await hashStyle(styleRecovered));
  assert.equal(JSON.stringify(runtime.snapshot()).includes(secret), false);
});

test('unavailable authority also blocks the queue until resync', async () => {
  const runtime = runtimeWithApplyResult(rollbackFailedStateUnknown({ styleAuthority: 'unavailable' }));
  const first = runtime.execute(applyCommand({ expectedRevision: 0, expectedStyleHash: hash0 }));
  const second = runtime.execute(getStyleCommand());
  await flushMicrotasks();
  assert.equal(secondCommandStarted(), false);
  fakeMapInstance.setExternalStyle(styleRecovered);
  await runtime.noteExternalStyle();
  await assert.rejects(first, hasCode('INTERNAL'));
  assert.equal(secondCommandStarted(), true);
});

test('prepare hashing consumes the wire deadline and late completion has no side effect', async () => {
  const runtime = runtimeWithSlowPrepareHash();
  const pending = runtime.execute(applyCommand(0, hash0), { deadlineAt: clock.now() + 10_000 });
  clock.advanceBy(10_000);
  await assert.rejects(pending, hasCode('TIMEOUT'));
  finishPrepareHashLate();
  await flushMicrotasks();
  assert.equal(resourcePolicySpy.calls.length, 0);
  assert.equal(applyPreparedSpy.calls.length, 0);
  assert.equal(fakeMapInstance.setStyleCalls, 0);
  assert.equal(unhandledRejections.length, 0);
});

test('rejects an invalid opaque-view candidate before bytes, hash, authorization, apply, or Map mutation', async () => {
  const prepared = opaquePreparedFixture({
    baselineHash: hash0,
    transactionResult: successfulCoreResultWithStyle(hostileOrInvalidReadonlyStyle),
  });
  const runtime = runtimeWithPrepareResult(prepared);
  await assert.rejects(
    runtime.execute(applyCommand({ expectedRevision: 0, expectedStyleHash: hash0 })),
    hasCode('INVALID_INPUT'),
  );
  assert.strictEqual(validateStyleSpy.calls.at(-1)?.value, prepared.view.transactionResult.style);
  assert.equal(candidateByteLengthSpy.calls.length, 0);
  assert.equal(candidateHashSpy.calls.length, 0);
  assert.equal(resourcePolicySpy.calls.length, 0);
  assert.equal(applyPreparedSpy.calls.length, 0);
  assert.equal(fakeMapInstance.setStyleCalls, 0);
});

test('runs the transaction once and applies exactly the authorized prepared candidate', async () => {
  const prepared = opaquePreparedFixture({
    baselineHash: hash0,
    transactionResult: successfulCoreResultWithStyle(readonlyInspectionCandidate),
  });
  const validatedCandidate = ordinaryValidatedStyleClone(readonlyInspectionCandidate);
  validateStyleSpy.returnCandidate(validatedCandidate);
  const runtime = runtimeWithPrepareResult(prepared);
  const result = await runtime.execute(applyCommand({ expectedRevision: 0, expectedStyleHash: hash0 }));
  assert.equal(coreTransactionSpy.calls.length, 1);
  assert.strictEqual(validateStyleSpy.calls.at(-1)?.value, prepared.view.transactionResult.style);
  assert.strictEqual(candidateByteLengthSpy.calls[0]?.value, validatedCandidate);
  assert.strictEqual(candidateHashSpy.calls[0]?.value, validatedCandidate);
  assert.strictEqual(resourcePolicySpy.baseline, reconciledRuntimeStyle0);
  assert.strictEqual(resourcePolicySpy.candidate, validatedCandidate);
  assert.notStrictEqual(validatedCandidate, prepared.view.transactionResult.style);
  assert.strictEqual(preparedApplySpy.argument, prepared);
  assert.deepEqual(preparedApplySpy.options, { deadline: sharedDeadline });
  assert.equal(result.revision, 1);
});

test('rejects a baseline change immediately before setStyle without rerunning authorization', async () => {
  mutateMapAfterPolicyApproval(styleExternal);
  await assert.rejects(runtime.execute(applyCommand({ expectedRevision: 0, expectedStyleHash: hash0 })), hasCode('REVISION_CONFLICT'));
  assert.equal(coreTransactionSpy.calls.length, 1);
  assert.equal(fakeMapInstance.setStyleCalls, 0);
});
```

- [ ] **Step 5: Prepare once, authorize once, and apply the exact prepared candidate**

For `applyTransaction`, construct exactly one `sharedDeadline = {expiresAt: deadlineAt, signal, now}` and call `prepareTransactionForMap(map, transaction, {...resolvedCoreLimits, deadline: sharedDeadline})` once after dequeue reconciliation; the layer adapter must forward those exact three limits into core `applyStyleTransaction`, and its baseline validation/hash must consume the same wire deadline rather than letting core defaults or a fresh clock decide. Race any non-abortable hash promise against that deadline, attach both fulfillment/rejection handlers, and ignore late completion without policy/Map side effects or unhandled rejection. Branch on the declared return union before inspecting the prepared handle. If `'applied' in preparedOrResult`, first reconcile the terminal `MapStyleApplyResult` by its explicit `styleAuthority` using the rules below; never read prepared-only fields or call policy/`applyPreparedStyleToMap`. A terminal `current` Style is validated and hashed before mapping the core no-op/failure. If it differs from the dequeue-reconciled hash, record it as one external revision advance and return `REVISION_CONFLICT` with that snapshot instead of reporting a stale no-op/success; only a same-hash `current` result may map directly. A terminal `pre-operation` or `unavailable` result makes synchronization unknown and holds settlement/the queue until a valid bounded resync.

Otherwise retain the returned `PreparedMapStyleTransaction` as one opaque identity and inspect only `prepared.view.baselineHash` and `prepared.view.transactionResult.style`. First require `prepared.view.baselineHash === reconciledState.styleHash`; the policy baseline is the ordinary `StyleDocument` already obtained by dequeue reconciliation, never a baseline reconstructed from the public view. Then call `validateStyleDocument(prepared.view.transactionResult.style, {maxStyleBytes: resolvedCoreLimits.maxStyleBytes})`. The view is `DeepReadonly`: never cast it to `StyleDocument`, `JsonValue`, `unknown`, or a mutable structural type, never mutate it, and never clone/rebuild a handle from it. A failed validation returns the normalized core validation error immediately with zero candidate byte/hash calls, zero resource authorization, zero `applyPreparedStyleToMap`, and zero `Map#setStyle` calls. On success, retain only `validation.style` as the ordinary `validatedCandidate`; run `jsonUtf8ByteLength(validatedCandidate)`, the deadline-bounded candidate hash, and `assertStyleResourcePolicy(reconciledState.style, validatedCandidate, ...)` against that exact object. Require the measured bytes to remain within the same resolved `maxStyleBytes`; core remains sole authority for operation count and deterministic diff, so do not read `view.limitOptions` or reinterpret the diff. Any new/changed relative Style reference fails here with `INVALID_INPUT`/`relative-style-url` before prepared apply or Map access.

Pass the original opaque `prepared` object by strict identity, unchanged and uncloned, to `applyPreparedStyleToMap(map, prepared, {deadline: sharedDeadline})`. Never access a private baseline/candidate/canonical field and never try to duplicate the adapter's authority check. The three limits and private immutable candidate are frozen into the genuine handle during phase one; `PreparedStyleApplyOptions` deliberately rejects `maxStyleBytes`, `maxDiffBytes`, and `maxOperations`, so never spread `resolvedCoreLimits` into phase two. Immediately before `setStyle`, the adapter alone rechecks the live Map against its module-private canonical baseline authority, applies its private candidate, and gives rollback only the remaining shared budget. A prepared core no-op returns the current revision/hash without calling `setStyle`. This is the only mutation path; there is no second transaction execution, authorization decision, timeout clock, or bridge-side reconstruction of layer authority.

Handle every terminal/adapter `MapStyleApplyResult` according to its declared authority; `rolledBack`, success, and the mere presence of a `style` field never establish authority:

- `styleAuthority:'current'`: require the result's current Style, independently pass it through `validateStyleDocument(raw,{maxStyleBytes})`, and hash only its normalized form. For `ok && applied`, require the hash previously computed from the ordinary `validatedCandidate`, increment revision exactly once, and store that normalized current Style. For `ok && !applied`, require the reconciled hash and do not emit a mutation event; if the current hash instead changed, record one external revision advance and return `REVISION_CONFLICT`. For every failure (including rollback success/failure and the adapter's final pre-`setStyle` race), adopt only this validated current Style, advance once if its hash differs, attach the resulting authoritative `currentSnapshot`, and then reject with the preserved primary error. Invalid/hostile current output marks synchronization unknown and follows the blocked-resync path.
- `styleAuthority:'pre-operation'`: never hash, cache, expose, or adopt the attached old baseline Style as current. Mark synchronization unknown and invoke `onSyncStateChange({syncState:'unknown',reason:'adapter-authority-unavailable'})` exactly once, after the adapter settled but before holding the recorded result/per-map queue. The client owns ordered `mapStatus` emission and the independent recovery lane; runtime waits for one valid bounded no-argument `noteExternalStyle()` before settling/releasing. The fresh Map read, not the pre-operation Style, is the only authority.
- `styleAuthority:'unavailable'`: use the identical callback/block/recovery path and never infer that either baseline or candidate won.

These authority rules run before terminal result conversion and before interpreting `rolledBack`; they apply equally to the early `PreparedMapStyleTransaction | MapStyleApplyResult` branch and to `applyPreparedStyleToMap` completion. Preserve primary error plus rollback fields after safe projection, but never claim the baseline/candidate is authoritative merely because it was prepared or rollback was attempted.

- [ ] **Step 6: Write failing bounded query and runtime-state tests**

```ts
test('caps source/rendered feature queries at 100 features and 1 MiB', async () => {
  const result = await runtime.execute(sourceQuery({ limit: 100, properties: ['name'] }));
  assert.equal(result.returned, 100);
  assert.equal(result.truncated, true);
  assert.ok(result.serializedBytes <= 1024 * 1024);
  assert.deepEqual(Object.keys(result.features[0].properties), ['name']);
});

test('rejects feature/global state larger than 64 KiB before touching MapLibre', async () => {
  await assert.rejects(runtime.execute(setGlobalState({ payload: 'x'.repeat(65 * 1024) })), hasCode('INVALID_INPUT'));
  assert.equal(fakeMapInstance.setGlobalStateCalls, 0);
});
```

- [ ] **Step 7: Route queries and state with explicit bounds**

Pass query inputs to the existing bounded adapter with effective limits `min(requested, 100)` and 1 MiB. Preserve only requested properties. Define `serializedBytes` as exactly `jsonUtf8ByteLength(result.features)` so browser runtime and registry independently recompute the same JSON value; never report a transport-envelope estimate. Before calling `createMapRuntimeCommands(map)`, serialize feature targets/state/global values and reject payloads over 64 KiB. Return `MAP_NOT_READY` for adapter readiness failures and enforce the capability matrix before any Map access.

- [ ] **Step 8: Write failing bounded image tests**

```ts
test('requires images.write and exact RGBA byte length', async () => {
  await assert.rejects(readOnlyRuntime.execute(addRgbaImage(2, 2, Buffer.alloc(16))), hasCode('CAPABILITY_DENIED'));
  await assert.rejects(imageRuntime.execute(addRgbaImage(2, 2, Buffer.alloc(15))), hasCode('INVALID_INPUT'));
});

test('URL image loading requires network.load, policy approval, and a 3 MiB response cap', async () => {
  await assert.rejects(imageRuntime.execute(addUrlImage('https://images.example/a.png')), hasCode('CAPABILITY_DENIED'));
  await assert.rejects(networkRuntime.execute(addUrlImage('https://evil.example/a.png')), hasCode('CAPABILITY_DENIED'));
  await assert.rejects(allowedRuntimeWithFetch(bytesResponse(3 * 1024 * 1024 + 1)).execute(addUrlImage(allowedUrl)), hasCode('INVALID_INPUT'));
});

test('passes the one authorized absolute resolution of a relative image to the loader', async () => {
  const runtime = runtimeWithResourceBaseAndImageLoader('https://allowed.example/app/', imageLoaderSpy);
  await runtime.execute(addUrlImage('./images/marker.png'));
  assert.equal(imageLoaderSpy.calls[0]?.url, 'https://allowed.example/app/images/marker.png');
});

test('custom-protocol image loading uses the registered abortable loader', async () => {
  const result = await customProtocolRuntime.execute(addUrlImage('pmtiles://catalog/icon'));
  assert.equal(protocolLoader.calls[0]?.url, 'pmtiles://catalog/icon');
  assert.ok(protocolLoader.calls[0]?.signal instanceof AbortSignal);
  assert.equal(result.type, 'ack');
});

test('one deadline aborts image work and ignores a late decode before any Map call', async () => {
  const pending = runtimeWithSlowImageLoader.execute(addUrlImage(allowedUrl));
  timers.advanceBy(10_001);
  await assert.rejects(pending, hasCode('TIMEOUT'));
  finishLateDecode();
  await flushMicrotasks();
  assert.equal(fakeMapInstance.addImageCalls, 0);
});

test('runtime independently rejects past or over-window explicit deadlines before queue or Map work', async () => {
  const now = clock.now();
  await assert.rejects(runtime.execute(getStyleCommand(), { deadlineAt: now }), hasCode('TIMEOUT'));
  await assert.doesNotReject(runtime.execute(getStyleCommand(), { deadlineAt: now + 10_000 }));
  for (const deadlineAt of [now + 10_001, Number.MAX_SAFE_INTEGER, 1.5]) {
    await assert.rejects(runtime.execute(getStyleCommand(), { deadlineAt }), hasCode('INVALID_INPUT'));
  }
  assert.equal(commandsEnqueuedForInvalidDeadlines(), 0);
  assert.equal(fakeMapCallsForInvalidDeadlines(), 0);
});

test('deadline during apply or rollback does not release the next map command early', async () => {
  const first = runtime.execute(slowApply, { deadlineAt: clock.now() + 10_000 });
  let firstSettled = false;
  void first.then(() => { firstSettled = true; }, () => { firstSettled = true; });
  clock.advanceBy(9_000);
  const second = runtime.execute(getStyleCommand(), { deadlineAt: clock.now() + 10_000 });
  clock.advanceBy(1_001);
  await flushMicrotasks();
  assert.equal(firstSettled, false);
  assert.equal(secondCommandStarted(), false);
  finishUnderlyingMapSettlement(styleAfterTimeout);
  await authoritativeResyncObserved();
  await assert.rejects(first, hasCode('TIMEOUT'));
  assert.equal(secondCommandStarted(), true);
});
```

- [ ] **Step 9: Implement bounded image list/add/remove routing**

Limit `listImages` to 500 IDs and a 64 KiB serialized result. For RGBA input, require positive integer dimensions no larger than 2048, decoded bytes exactly `width * height * 4`, and at most 3 MiB. For URL/data input, apply runtime resource policy, then call the injected abortable `RuntimeImageLoader` through `createMapRuntimeCommands`; provide a default HTTP(S)/`data:` loader that uses `fetch` with `credentials:'omit'`, `redirect:'manual'`, a streaming 3 MiB encoded cap, and bounded decode. Custom protocols are allowed only when policy registration succeeds and a protocol-aware loader is injected. Recheck decoded dimensions/bytes before `addImageData`. Pass the command deadline signal through fetch/load/decode, and after every await check that the command is still current; a timeout or abort invalidates late results so they can never call a Map API.

- [ ] **Step 10: Run browser runtime tests**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/bridge/browser-runtime-layer-contract.test.js .tmp/test-dist/bridge/browser-runtime.test.js`

Expected: PASS for the strict Layer→bridge opaque-handle compile contract, forbidden view mutation/casts/private-field access, validation failure before candidate bytes/hash/authorization/apply/Map mutation, validated-candidate identity through byte/hash/resource policy, original prepared-handle identity at phase two, atomic dequeue checks, initial/external/candidate Style byte limits including write-only peers, exact maxStyleBytes/maxDiffBytes/maxOperations lowering/raising through adapter/core, explicit Prepared-versus-result branching, terminal-current race reconciliation, `current`/`pre-operation`/`unavailable` authority handling without adopting an old Style, one-time prepare/authorization, unconditional new-relative-Style rejection before prepared apply/`Map#setStyle`, adapter-owned pre-`setStyle` baseline conflict, no-op, authoritative rollback-success/rollback-failure handling, policy denial, bounded queries, 64 KiB state, protocol-aware images, one absolute deadline/abort, shared apply/rollback budget, no queue overlap after timeout, forced resync, ignored late decode, and capability denial without leaking data.

- [ ] **Step 11: Commit the browser runtime**

```bash
rtk git add src/bridge/browser-runtime.ts src/bridge/browser-runtime.test.ts src/bridge/browser-runtime-layer-contract.test.ts
rtk git commit -m "feat: dispatch bounded live map commands"
```

### Task 6: Browser bridge client, reconnect/resync, and external Style detection

**Files:**
- Create: `src/bridge/client.ts`
- Create: `src/bridge/client.test.ts`

**Interfaces:**
- Consumes: `createBrowserMapRuntime` and its typed `onSyncStateChange`/no-argument authority recovery, protocol codec/schemas plus browser-safe `REGISTRATION_REPLAY_CLIENT_BUDGET_MS`/`REGISTRATION_ATTEMPT_RETENTION_MS`, `prepareOutboundBridgeFrame` from `src/bridge/outbound.ts`, canonical hashing, `Map` type from `maplibre-gl`, and browser `WebSocket`.
- Produces: `ConnectMapLibreBridgeOptions`, `MapLibreBridgeStatus`, `MapLibreBridgeConnection`, and `connectMapLibreBridge(map, options)`.

- [ ] **Step 1: Write failing authentication/registration tests that prove the token is not in the URL**

```ts
test('authenticates in the first frame, then registers the current Style snapshot', async () => {
  const sockets = new FakeWebSocketFactory();
  const connection = connectMapLibreBridge(fakeMap(style0), bridgeOptions({ websocketFactory: sockets.create }));
  const socket = sockets.latest();
  assert.equal(socket.url, 'ws://127.0.0.1:7777');
  assert.equal(new URL(socket.url).search, '');
  socket.open();
  assert.deepEqual(decode(socket.sent[0]), authFrame(token));
  socket.receive(authenticatedFor(socket.sent[0]));
  assert.throws(() => connection.snapshot(), hasCode('MAP_NOT_READY'));
  const registration = decode(await socket.nextSentFrame());
  assert.equal(registration.kind, 'register');
  assert.equal(registration.mapId, 'demo-map');
  assert.match(registration.registrationAttemptId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(registration.snapshot.styleHash, hash0);
  socket.receive(registeredFor(registration));
  await connection.whenReady();
});

test('public client registers a near-limit Style as authoritative metadata', async () => {
  const style = validStyleWithinDocumentLimitButTooLargeForRegistrationFrame();
  const connected = connectFixture(style, { capabilities: ['style.read', 'style.write'] });
  await connected.authenticate();
  const registration = await connected.nextSentFrameOfKind('register');
  assert.ok(new TextEncoder().encode(connected.lastSentText()).byteLength <= MAX_BRIDGE_MESSAGE_BYTES);
  assert.deepEqual(registration.snapshot, { revision: 0, styleHash: await hashStyle(style) });
  connected.serverSend(registeredFor(registration));
  await connected.connection.whenReady();
  assert.equal(connected.connection.snapshot().styleHash, registration.snapshot.styleHash);
});

test('negotiates one effective limit set and requires both ends for a raise', async () => {
  const requested = bridgeLimits({
    maxMessageBytes: MAX_BRIDGE_MESSAGE_BYTES + 1024,
    maxStyleBytes: DEFAULT_MAX_STYLE_BYTES + 1024,
    maxDiffBytes: DEFAULT_MAX_DIFF_BYTES + 1024,
    maxOperations: DEFAULT_MAX_OPERATIONS + 1,
  });
  const connected = connectFixture(style0, requested);
  await connected.openAndAuthenticate(authenticatedWithCeilings(requested));
  const registration = await connected.nextSentFrameOfKind('register');
  assert.deepEqual(registration.limits, requested);
  assert.deepEqual(connected.runtimeOptions().coreLimits, requestedCoreLimits(requested));
  connected.serverSend(registeredFor(registration));
  await connected.connection.whenReady();

  const denied = connectFixture(style0, requested);
  await denied.openAndAuthenticate(authenticatedWithCeilings(defaultBridgeLimits));
  await assert.rejects(denied.connection.whenReady(), /limit.*ceiling/i);
  assert.equal(denied.registrationFrames().length, 0);
});

test('applies a server ceiling lower than the client default before runtime initialization', async () => {
  const style = styleLargerThan(1024);
  const connected = connectFixture(style); // no explicit client overrides
  await connected.openAndAuthenticate(authenticatedWithCeilings(bridgeLimits({ maxStyleBytes: 1024 })));
  await assert.rejects(connected.connection.whenReady(), hasCode('INVALID_INPUT'));
  assert.equal(connected.runtimeCreationCount(), 1);
  assert.equal(connected.runtimeOptions().maxStyleBytes, 1024);
  assert.equal(connected.registrationFrames().length, 0);
});

test('rejects a registered acknowledgement that echoes different limits', async () => {
  const connected = connectFixture(style0);
  await connected.openAndAuthenticate(authenticatedWithCeilings(defaultBridgeLimits));
  const registration = await connected.nextSentFrameOfKind('register');
  connected.serverSend(registeredFor(registration, { ...registration.limits, maxOperations: registration.limits.maxOperations + 1 }));
  await assert.rejects(connected.connection.whenReady(), /registered.*limits/i);
  assert.equal(connected.socket.closeCode, 1002);
});

test('validates and captures resource policy before opening a socket', () => {
  const sockets = new FakeWebSocketFactory();
  assert.throws(() => connectMapLibreBridge(fakeMap(style0), bridgeOptions({
    document: undefined,
    resourceBaseUrl: undefined,
    websocketFactory: sockets.create,
  })), /resourceBaseUrl/);
  assert.throws(() => connectMapLibreBridge(fakeMap(style0), bridgeOptions({
    resourceBaseUrl: 'https://app.example/maps/',
    allowedResourceOrigins: ['https://tiles.example/safe/path'],
    websocketFactory: sockets.create,
  })), /origin/i);
  assert.equal(sockets.created.length, 0);

  const documentFixture = fakeDocument('https://app.example/first/');
  const connected = connectMapLibreBridge(fakeMap(style0), bridgeOptions({
    document: documentFixture,
    websocketFactory: sockets.create,
  }));
  documentFixture.baseURI = 'https://evil.example/later/';
  assert.equal(connected.capturedResourcePolicy().baseUrl, 'https://app.example/first/');

  const explicit = connectMapLibreBridge(fakeMap(style0), bridgeOptions({
    document: fakeDocument('https://evil.example/app/'),
    resourceBaseUrl: 'https://allowed.example/app/',
    allowedResourceOrigins: ['https://allowed.example'],
    websocketFactory: sockets.create,
  }));
  assert.equal(explicit.capturedResourcePolicy().baseUrl, 'https://allowed.example/app/');
});
```

- [ ] **Step 2: Compile to verify the client test is red**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json`

Expected: FAIL because `src/bridge/client.ts` does not exist.

- [ ] **Step 3: Implement the public connection lifecycle**

```ts
export interface ConnectMapLibreBridgeOptions {
  mapId: string;
  url: string;
  token: string;
  capabilities: readonly BridgeCapability[];
  resourceBaseUrl?: string;
  allowedResourceOrigins: readonly string[];
  allowedUrlPrefixes?: readonly string[];
  allowDataUrls?: boolean;
  allowedProtocols?: readonly string[];
  isProtocolRegistered?: (scheme: string) => boolean;
  maxMessageBytes?: number;
  maxStyleBytes?: number;
  maxDiffBytes?: number;
  maxOperations?: number;
  imageLoader?: RuntimeImageLoader;
  websocketFactory?: (url: string) => WebSocketLike;
  reconnect?: false | { initialDelayMs?: number; maxDelayMs?: number; factor?: number };
}

export interface MapLibreBridgeConnection {
  readonly status: MapLibreBridgeStatus;
  whenReady(): Promise<void>;
  snapshot(): BrowserMapState;
  subscribe(listener: (status: MapLibreBridgeStatus) => void): () => void;
  close(): void;
}
```

Validate `token`, every optional limit as a positive safe integer, and the complete resource-policy configuration before calling `websocketFactory`. Resolve and capture trusted `resourceBaseUrl` once from the explicit option or the current `document.baseURI`; it is used only to resolve relative runtime-image inputs to the exact authorized absolute loader URL. Do not capture or expose a separate actual-document base, and never compare bases to authorize relative Style values: those are unconditionally rejected when new/changed. In non-document test/worker contexts an explicit trusted runtime-image base is required. A later document or `<base>` mutation cannot change the captured runtime-image base and cannot make a relative Style candidate admissible. Reuse Task 2's strict origin/prefix normalization, so a lossy origin path, credentials, fragment, wildcard/opaque URL, invalid prefix, or missing worker base fails synchronously with zero sockets created. Expose status `authenticating`; until a runtime exists and registration succeeds, `snapshot()` throws provenance-safe `MAP_NOT_READY`, while `whenReady()` remains pending/rejects on terminal setup failure. Construct the socket with `options.url` verbatim, set `binaryType = 'arraybuffer'`, and send only bounded `auth` on open. Wait for its correlated `authenticated` result and parse the advertised server ceilings. Only then choose each effective limit: explicit client value when supplied, otherwise `min(packageDefault, serverCeiling)`; reject and close before runtime creation/registration if any explicit value exceeds its ceiling. Set status `initializing` and create exactly one `runtimeReady = createBrowserMapRuntime(map, {effective Style/diff/operation limits, captured normalized resource policy, imageLoader})`. This ordering ensures a server ceiling lower than the package default constrains initial Style validation.

Only after authentication succeeds, await `runtimeReady` and start one logical registration attempt. Pass the client-owned typed `onSyncStateChange` callback into that one runtime construction; it is the trigger for Step 7's generation-tagged status/recovery lane and must be installed before any command can execute. Generate the attempt's 32 random bytes with browser `crypto.getRandomValues`, base64url-encode them to `registrationAttemptId`, capture the then-current replacement lease, effective limits, capabilities, and authoritative runtime snapshot, construct the complete typed registration, and retain both that immutable semantic fingerprint and its exact projected encoded frame. Send only `prepareOutboundBridgeFrame(registration, capabilities, effective.maxMessageBytes).encoded`. A failed/late initialization closes without registering; attach both promise branches so it cannot become unhandled. Use `effective.maxMessageBytes` for all subsequent inbound decoding and outbound fitting; this removes the server/client frame-cap split.

Until the matching `registered` acknowledgement succeeds, never regenerate/recompute any field of that pending attempt. Track whether the current generation sent a fresh logical attempt or byte-for-byte replayed an unacknowledged one. A pending-ack transient generation loss re-authenticates and replays the exact retained attempt ID, old replacement lease, snapshot fingerprint, and encoded registration even if the live Map changed meanwhile; this is required for server idempotency.

When a replay generation receives the same-lease `registered` acknowledgement, atomically store the returned lease but do **not** treat the original snapshot as server-current. Run a fresh no-argument runtime observation and send one authoritative `mapSnapshot` unconditionally—even when revision/hash did not change—through the same outstanding-send gate. Only after that send succeeds may the client clear the pending attempt/reset its backoff/report local ready; local readiness means enqueued, not server acceptance, while the registry independently remains unknown/no-dispatch until its FIFO tail accepts the snapshot. A fresh first registration or ordinary transient reconnect after a previously acknowledged registration instead creates a fresh attempt ID with the last lease and a fresh current registration snapshot, so it needs no duplicate post-ack event. Use `assertCorrelated` for auth/register responses as well as commands, and require the `registered` result to echo exact effective limits. A full Style is eligible only under `style.read`; deterministic fitting may send metadata only. Add public-connect tests for unchanged and changed ack-loss replay, the server unknown window, and a custom-protocol image loader reached through `addImage(pmtiles://...)`.

- [ ] **Step 4: Write failing command routing and out-of-order result tests**

```ts
test('routes commands through the browser queue and returns correlated typed results', async () => {
  await connected.fixtureReady();
  connected.serverSend(applyFrame(0, hash0, duplicateLayerTransaction));
  connected.serverSend(getStyleFrame());
  await connected.map.finishStyleLoad();
  const [applyResult, styleResult] = connected.clientResults();
  assert.equal(applyResult.correlationId, applyCorrelation);
  assert.equal(applyResult.result.revision, 1);
  assert.equal(styleResult.result.revision, 1);
});

test('policy-closes on an active duplicate correlation without sending or settling the first ID', async () => {
  connected.serverSend(commandWithCorrelation('same'));
  const firstExecution = connected.runtime.pendingFor('same');
  connected.serverSend(commandWithCorrelation('same'));
  assert.equal(connected.clientResults().length, 0);
  assert.equal(connected.socket.closeCode, 1008);
  assert.equal(firstExecution.settled, false);
  firstExecution.finish(styleResult(0, hash0, style0));
  await flushMicrotasks();
  assert.equal(connected.clientResults().length, 0);
});

test('releases completed correlation IDs and remains bounded across a long connection', async () => {
  await connected.fixtureReady();
  for (let index = 0; index < 10_000; index += 1) {
    connected.serverSend(getStyleFrame({ correlationId: `sequential-${index}` }));
    await connected.waitForResult(`sequential-${index}`);
  }
  assert.equal(connected.activeCorrelationCount(), 0);
  connected.serverSend(getStyleFrame({ correlationId: 'sequential-0' })); // completed IDs may be reused sequentially
  await connected.waitForResult('sequential-0');
  assert.equal(connected.activeCorrelationCount(), 0);
  assert.equal(connected.socket.closeCode, undefined);
});

test('drops a queued mutation when its socket generation disconnects', async () => {
  await connected.fixtureReady();
  connected.serverSend(blockingQueryFrame({ correlationId: 'blocker' }));
  await connected.runtime.waitUntilStarted('blocker');
  connected.serverSend(applyFrame(0, hash0, transaction1, { correlationId: 'queued-write' }));
  assert.deepEqual(connected.runtime.startedCorrelations(), ['blocker']);
  connected.socket.closeFromServer(1006);
  connected.runtime.finish('blocker', boundedFeaturesResult());
  await connected.waitForOldGenerationIdle();
  assert.equal(connected.runtime.startedCorrelations().includes('queued-write'), false);
  assert.equal(connected.map.setStyleCalls, 0);
  assert.equal(connected.connection.snapshotAfterSettlement().revision, 0);
  await connected.reconnectAndRegister();
  assert.equal(connected.runtime.startedCorrelations().includes('queued-write'), false);
});

test('admits only the remaining hard deadline window before runtime dispatch', async () => {
  await connected.fixtureReady({ clock });
  for (const deadlineAt of [clock.now() - 1, clock.now()]) {
    connected.serverSend(getStyleFrame({ correlationId: `expired-${deadlineAt}`, deadlineAt }));
    const result = await connected.waitForResult(`expired-${deadlineAt}`);
    assert.equal(result.ok, false);
    if (result.ok) assert.fail('expected timeout');
    assert.equal(result.error.code, 'TIMEOUT');
  }
  assert.equal(connected.runtime.executeCalls.length, 0);

  connected.serverSend(getStyleFrame({ correlationId: 'edge', deadlineAt: clock.now() + 10_000 }));
  await connected.runtime.waitUntilStarted('edge');
  assert.equal(connected.runtime.executeCalls.length, 1);

  for (const deadlineAt of [clock.now() + 10_001, Number.MAX_SAFE_INTEGER]) {
    const fixture = await freshConnectedFixture({ clock });
    fixture.serverSend(getStyleFrame({ correlationId: `future-${deadlineAt}`, deadlineAt }));
    assert.equal(await fixture.closeCode(), 1008);
    assert.equal(fixture.runtime.executeCalls.length, 0);
    assert.equal(fixture.map.accessCalls, 0);
  }
});
```

- [ ] **Step 5: Implement command dispatch with one response per correlation ID**

Track only active correlation IDs in a per-connection `Map`, tagged with the current socket generation. An active duplicate is a protocol/policy violation: close with `1008`, send no result using that ID, do not settle the original execution from the duplicate, and discard any later old-socket completion. This avoids a correlated `CONFLICT` frame accidentally settling the server's legitimate first request. Remove an ID in `finally` only after its underlying runtime execution and its sole result send/close decision have both settled; completed IDs may then be reused sequentially on the same socket, while the generation tag prevents an old socket completion from matching a reconnect. Thus ordinary long-lived operation is bounded by active concurrency rather than historical traffic.

Give each socket generation its own AbortController and client-side FIFO command tail. Each queued record stores generation, signal, correlation, and absolute deadline; before it calls the runtime, recheck that the generation is still current, registered/open, and not aborted. Disconnect/replacement/close aborts the generation and removes every not-yet-started record, so a mutation waiting behind an active command never enters the runtime or touches MapLibre and is never replayed after reconnect. An active non-abortable Map operation may finish locally, but its old-generation result is discarded and reconnect waits for authoritative settlement as below.

For a fresh ID, validate the bounded frame and command/result mapping, negotiated operation count, and deadline before queue insertion or any Map/runtime access. Require integer schema plus `now() < deadlineAt <= now() + 10_000` with no hidden clock-skew extension: an already-expired/equal-now command gets one bounded correlated fixed `TIMEOUT` and never enters the runtime; a deadline beyond the hard window is a protocol violation that policy-closes with no result or Map access. Never clamp or replace the server's absolute deadline. At dequeue call generic `runtime.execute<C>(command, {deadlineAt: frame.deadlineAt, signal: generation.signal})`, whose result type is `BridgeResultFor<C>`. Emit at most one socket result per correlation even when local cleanup settles later.

Construct one complete typed result/event and use the projector overloads exactly: registration/event calls pass `(frame, capabilities, effective.maxMessageBytes)`, while every success or failure result passes `(frame, capabilities, activeRecord.command, effective.maxMessageBytes)`. The exact stored correlated command is mandatory for mutation-failure snapshot authorization; never synthesize it from result fields. Call `socket.send(prepared.encoded)` as the only post-auth browser send path. A runtime error may attach `currentSnapshot` only when that exact command is `applyTransaction` and runtime established `styleAuthority:'current'`; preserve ordinary `INTERNAL`/`IO_ERROR` as well as conflict/settled timeout. A non-mutation runtime error cannot send a snapshot. Do not bypass the helper with direct `JSON.stringify` or a second generic size check.

For a connection without `style.read`, capability projection happens before byte measurement: registration, every authoritative mutation-failure `currentSnapshot`, `mapSnapshot`, and `externalStyleChange` retain only revision/hash metadata, while apply success becomes the `transaction/detail:'receipt'` variant containing only revision, styleHash, applied, and noOp. It omits Style, layer/source IDs, diff paths, and every `before`/`after` value. Full transaction details require `style.read`. Never use a blanket `catch (RangeError) => INVALID_INPUT`: that can erase authoritative revision/hash after a non-abortable mutation and leave the server mirror stale while its queue resumes. Near-limit registration/events and every current-authority mutation failure drop Style while preserving revision/hash and original primary code; full mutation output drops Style then diff and may become a receipt; only an indivisible oversized `getStyle` success becomes the bounded correlated `INVALID_INPUT` size failure. An impossible-to-encode minimal frame closes without partial JSON.

- [ ] **Step 6: Write failing external Style change and revision-conflict tests**

```ts
test('advances revision and emits one snapshot when application code changes the Style', async () => {
  await connected.fixtureReady();
  connected.map.externalSetStyle(style1);
  connected.map.emit('style.load');
  await flushMicrotasks();
  assert.equal(connected.connection.snapshot().revision, 1);
  assert.deepEqual(connected.lastEvent(), externalStyleEvent(snapshot(1, hash1, style1)));
});

test('write-only clients never receive Style contents in conflicts or events', async () => {
  const writeOnly = await connectedWithCapabilities(['style.write']);
  writeOnly.map.externalSetStyle(style1);
  writeOnly.map.emit('style.load');
  await flushMicrotasks();
  assert.equal('style' in writeOnly.lastEvent().snapshot, false);
  writeOnly.serverSend(applyFrame(0, hash0, transaction1));
  assert.equal('style' in writeOnly.lastResult().error.details.currentSnapshot, false);
});

test('write-only transaction receipts cannot leak diff values', async () => {
  const secret = 'secret-sentinel-never-on-wire';
  const writeOnly = await connectedWithCapabilities(['style.write']);
  writeOnly.map.setStyleFixture(styleContaining(secret));
  writeOnly.serverSend(applyFrame(0, hash0, transactionTouchingSecret));
  await writeOnly.map.finishStyleLoad();
  const frame = writeOnly.lastResult();
  assert.equal(frame.result.detail, 'receipt');
  assert.deepEqual(Object.keys(frame.result).sort(), ['applied', 'detail', 'noOp', 'revision', 'styleHash', 'type']);
  assert.equal(JSON.stringify(frame).includes(secret), false);
  assert.equal(JSON.stringify(frame).includes('before'), false);
  assert.equal(JSON.stringify(frame).includes('after'), false);
});

test('write-only error projection drops arbitrary Style/diff details but keeps safe resync metadata', async () => {
  const secret = 'secret-sentinel-error-detail';
  const credential = 'https://user:password@example.test/private';
  const writeOnly = await connectedWithCapabilities(['style.write']);
  writeOnly.runtimeRejects(styleError('INTERNAL', {
    message: `conflict while loading ${credential}`,
    path: `/sources/${credential}`,
    details: {
      currentSnapshot: snapshot(2, hash2, styleContaining(secret)),
      diff: [{ path: '/metadata/secret', before: secret, after: 'changed' }],
      rollbackError: {
        code: 'IO_ERROR', message: `${secret}:${credential}`, path: `/${credential}`,
        details: { before: secret, url: credential },
      },
    },
  }));
  writeOnly.serverSend(applyFrame(1, hash1, transaction1));
  const frame = writeOnly.lastResult();
  assert.equal(frame.ok, false);
  if (frame.ok) assert.fail('expected failure');
  assert.equal(frame.error.code, 'INTERNAL');
  assert.deepEqual(frame.error.details, { currentSnapshot: { revision: 2, styleHash: hash2 } });
  assert.equal(JSON.stringify(frame).includes(secret), false);
  assert.equal(JSON.stringify(frame).includes(credential), false);
  assert.equal(JSON.stringify(frame).includes('before'), false);
  assert.equal(JSON.stringify(frame).includes('after'), false);
});

test('near-limit ordinary failures, conflict, and settled TIMEOUT keep authoritative metadata', async () => {
  const style = validStyleWithinDocumentLimitButTooLargeForErrorFrame();
  for (const fixture of [
    ordinaryMutationFailureFixture('INTERNAL', style),
    ordinaryMutationFailureFixture('IO_ERROR', style),
    revisionConflictFixture(style),
    settledMutationTimeoutFixture(style),
  ]) {
    const connected = await connectedWithCapabilities(['style.read', 'style.write'], fixture);
    connected.serverSend(fixture.command);
    await fixture.settleUnderlyingMapWork();
    const frame = connected.lastResult();
    assert.equal(frame.ok, false);
    if (frame.ok) assert.fail('expected failure');
    assert.equal(frame.error.code, fixture.expectedCode);
    const details = AuthoritativeSnapshotDetailsSchema.parse(frame.error.details);
    assert.deepEqual(details.currentSnapshot, { revision: fixture.revision, styleHash: fixture.styleHash });
    assert.ok(new TextEncoder().encode(connected.lastResultText()).byteLength <= MAX_BRIDGE_MESSAGE_BYTES);
  }
});

test('never projects a currentSnapshot for a non-mutation failure', async () => {
  const connected = await connectedWithCapabilities(['style.read']);
  connected.runtimeRejects(styleError('INTERNAL', {
    details: { currentSnapshot: snapshot(1, hash1, style1) },
  }));
  connected.serverSend(getStyleFrame());
  const frame = connected.lastResult();
  assert.equal(frame.ok, false);
  if (frame.ok) assert.fail('expected failure');
  assert.equal('currentSnapshot' in (frame.error.details ?? {}), false);
});

test('near-limit mutation becomes a receipt and oversized getStyle fails stably', async () => {
  const connected = await connectedWithCapabilities(['style.read', 'style.write']);
  connected.runtimeReturns(fullTransactionResultTooLargeForFrame({ revision: 1, styleHash: hash1 }));
  connected.serverSend(applyFrame(0, hash0, transaction1));
  const receipt = connected.lastResult();
  assert.equal(receipt.ok && receipt.result.type === 'transaction' && receipt.result.detail, 'receipt');
  assert.equal(receipt.ok && receipt.result.type === 'transaction' && receipt.result.revision, 1);

  connected.runtimeReturns(styleResultTooLargeForFrame(1, hash1));
  connected.serverSend(getStyleFrame());
  const failure = connected.lastResult();
  assert.equal(failure.ok, false);
  if (failure.ok) assert.fail('expected size failure');
  assert.equal(failure.error.code, 'INVALID_INPUT');
  assert.equal(failure.error.message, publicBridgeErrorMessage('INVALID_INPUT'));
  assert.equal(connected.connection.snapshot().styleHash, hash1);
});

test('near-limit external-change event keeps revision/hash and omits Style', async () => {
  const connected = await connectedWithCapabilities(['style.read', 'style.write']);
  const style = validStyleWithinDocumentLimitButTooLargeForEventFrame();
  connected.map.externalSetStyle(style);
  connected.map.emit('style.load');
  await flushMicrotasks();
  const event = connected.lastEvent();
  assert.deepEqual(event.snapshot, { revision: 1, styleHash: await hashStyle(style) });
  assert.ok(new TextEncoder().encode(connected.lastEventText()).byteLength <= MAX_BRIDGE_MESSAGE_BYTES);
});

test('an invalid external Style emits only unknown status until a valid snapshot resyncs', async () => {
  const connected = await connectedWithCapabilities(['style.read', 'style.write']);
  connected.map.externalSetStyle(hostileOrOversizedStyle);
  connected.map.emit('style.load');
  await flushMicrotasks();
  assert.deepEqual(connected.lastEvent(), mapStatusEvent({ syncState: 'unknown' }));
  assert.equal(JSON.stringify(connected.lastEvent()).includes('hostile'), false);
  assert.throws(() => connected.connection.snapshot(), hasCode('MAP_NOT_READY'));
  connected.map.externalSetStyle(styleRecovered);
  connected.map.emit('style.load');
  await flushMicrotasks();
  assert.equal(connected.lastEvent().event, 'mapSnapshot');
  assert.equal(connected.connection.snapshot().styleHash, await hashStyle(styleRecovered));
});

test('current-authority IO_ERROR settles once, advances the registry mirror, and dispatches the queued pair', async () => {
  const fixture = await connectedClientWithRegistry({ capabilities: ['style.read', 'style.write'] });
  const first = fixture.server.registry.execute('demo-map', applyCommand(0, hash0));
  const second = fixture.server.registry.execute('demo-map', applyCommand(1, hash1));
  const beforeRevision = fixture.server.registry.get('demo-map')!.metadata.revision;
  fixture.runtime.settleAdapterWithCurrentAuthorityError('IO_ERROR', snapshot(1, hash1, style1));

  await fixture.waitForOutboundSequence(['result']);
  assert.equal(fixture.correlatedResultsFor(first).length, 1);
  await assert.rejects(first, hasCode('IO_ERROR'));
  assert.equal(fixture.server.registry.get('demo-map')!.metadata.revision, beforeRevision + 1);
  assert.equal(fixture.server.registry.get('demo-map')!.metadata.styleHash, hash1);
  assert.equal(fixture.eventsOfType('externalStyleChange').length, 0);
  assert.equal(fixture.server.commandsSent, 2);
  assert.equal(fixture.server.lastBrowserCommand()!.expectedRevision, 1);
  assert.equal(fixture.server.lastBrowserCommand()!.expectedStyleHash, hash1);
  fixture.disconnect();
  await assert.rejects(second, hasCode('BRIDGE_DISCONNECTED'));
});

test('recovers pre-operation/unavailable authority before sending the original failure', async () => {
  for (const authority of ['pre-operation', 'unavailable'] as const) {
    const fixture = await connectedClientWithRegistry({ capabilities: ['style.write'] });
    const first = fixture.server.registry.execute('demo-map', applyCommand(0, hash0));
    const heldResult = fixture.holdOriginalResultSend();
    fixture.map.setExternalStyle(styleRecovered);
    fixture.runtime.settleAdapterWithUnknownAuthority(authority); // no later Map event is required

    await fixture.waitForOutboundSequence(['mapStatus', 'mapSnapshot']);
    assert.deepEqual(fixture.outbound[0], mapStatusEvent({ syncState: 'unknown' }));
    assert.deepEqual(fixture.outbound[1].snapshot, { revision: 1, styleHash: hashRecovered });
    assert.equal('style' in fixture.outbound[1].snapshot, false);
    await fixture.server.waitUntilSnapshotAccepted();
    const second = fixture.server.registry.execute('demo-map', applyCommand(1, hashRecovered));
    assert.equal(fixture.server.commandsSent, 1); // still blocked behind the original correlation
    heldResult.release();
    await fixture.waitForOutboundSequence(['mapStatus', 'mapSnapshot', 'result']);
    assert.equal(fixture.outbound[2].ok, false);
    await assert.rejects(first, hasCode('INTERNAL'));
    assert.equal(fixture.server.registry.get('demo-map')?.metadata.revision, 1);
    assert.equal(fixture.server.registry.get('demo-map')?.metadata.styleHash, hashRecovered);
    assert.equal(fixture.eventsOfType('externalStyleChange').length, 0);
    assert.equal(fixture.runtime.noteExternalStyleCalls, 1);
    assert.equal(fixture.server.commandsSent, 2); // next dispatch occurs only after original result settlement
    fixture.disconnect();
    await assert.rejects(second, hasCode('BRIDGE_DISCONNECTED'));
    assert.equal(fixture.recoveryLaneCount, 0);
  }
});

test('does not classify bridge-owned style events as external changes', async () => {
  await connected.applyRemoteTransaction(transaction1);
  assert.equal(connected.eventsOfType('externalStyleChange').length, 0);
  assert.equal(connected.connection.snapshot().revision, 1);
});
```

- [ ] **Step 7: Observe MapLibre style events without double-counting bridge mutations**

Install `style.load`, `styledata`, and `error` listeners before opening the socket. Coalesce ordinary style events into one microtask. Outside an active bridge command, call only no-argument `runtime.noteExternalStyle()`; it performs the sole `map.getStyle()`→validation→hash authority read. If the observation succeeds and differs, send `externalStyleChange` only after the revision commits. If it fails, or runtime invokes `onSyncStateChange({syncState:'unknown',...})`, keep public snapshot unavailable and schedule one generation-tagged recovery lane.

The recovery lane is independent of the client command tail and may run while the original `runtime.execute` remains pending. Coalesce callbacks/events to one lane. First send the strict projected metadata-only `mapStatus(syncState:'unknown')`; install a result-send barrier for the active correlation. Then attempt one no-argument `runtime.noteExternalStyle()` from the current live Map even when no later Map event arrives (a dirty event observed during mutation may trigger the same attempt). On valid recovery, send and await one projected authoritative `mapSnapshot`—not `externalStyleChange`—and only then resolve the barrier so the original correlated failure may be sent/settled and both runtime/server queues may advance. The snapshot follows the runtime's single revision-advance rule and includes Style only with `style.read`; a write-only client retains revision/hash. This prevents double revision/event counting for bridge-owned success or failure. If validation remains invalid, keep the barrier/state unknown and retry only on the next coalesced live event. Disconnect/replacement/terminal close aborts and removes the lane/barrier without sending on an old generation; reconnect must resynchronize before new commands.

For a normal bridge mutation whose authority remains current, suppress its style events until adapter completion stores the new hash, perform one final no-argument comparison, and emit no `externalStyleChange` for its own Style. Every status/snapshot/change event uses `prepareOutboundBridgeFrame(event, capabilities, effective.maxMessageBytes)`; every correlated result uses the command-aware overload. Never serialize a rejected/pre-operation Style.

- [ ] **Step 8: Write failing reconnect/resync/close tests**

```ts
test('reconnects with bounded backoff and resends a full current snapshot', async () => {
  const lease = await connected.lease();
  connected.socket.closeFromServer(1006);
  timers.advanceBy(250);
  const replacement = sockets.latest();
  replacement.open();
  replacement.receive(authenticatedFor(replacement.sent[0]));
  const register = decode(replacement.sent[1]);
  assert.equal(register.replaceLeaseId, lease);
  assert.deepEqual(register.snapshot, connected.connection.snapshot());
});

test('replays an ack-pending attempt exactly and publishes intervening Map change before ready', async () => {
  const fixture = await previouslyReadyClientStartingReplacement();
  const firstRegisterText = await fixture.nextRegistrationText();
  const firstRegister = decode(firstRegisterText);
  fixture.server.commitRegistrationButHoldAck(firstRegister);
  fixture.map.externalSetStyle(style1); // must not change the retained attempt fingerprint
  fixture.socket.closeFromServer(1006);
  timers.advanceBy(250);

  const replacement = fixture.sockets.latest();
  await fixture.authenticate(replacement);
  const replayText = await replacement.nextSentFrameOfKind('register', { raw: true });
  assert.equal(replayText, firstRegisterText);
  const replay = decode(replayText);
  assert.equal(replay.registrationAttemptId, firstRegister.registrationAttemptId);
  assert.equal(replay.replaceLeaseId, firstRegister.replaceLeaseId);
  replacement.receive(registeredFor(replay, { leaseId: fixture.server.committedLease }));
  const resync = await replacement.nextSentFrameOfKind('event');
  assert.equal(resync.event, 'mapSnapshot');
  assert.equal(resync.snapshot.styleHash, await hashStyle(style1));
  const heldConfirmation = fixture.server.holdInbound(resync);
  await fixture.connection.whenReady(); // local send/enqueue readiness is not a server acceptance claim
  await assert.rejects(fixture.server.registry.projectCachedStyle('demo-map', identity), hasCode('MAP_NOT_READY'));
  await assert.rejects(fixture.server.registry.execute('demo-map', getStyleCommand()), hasCode('MAP_NOT_READY'));
  assert.equal(fixture.server.browserCommands.length, 0);
  heldConfirmation.release();
  await fixture.server.waitUntilSnapshotAccepted();
  assert.equal(fixture.server.registryStyleHash, await hashStyle(style1));
});

test('an acknowledged reconnect creates a fresh attempt and fresh live snapshot', async () => {
  const fixture = await readyFixture();
  const acknowledgedAttempt = fixture.lastRegistration().registrationAttemptId;
  fixture.map.externalSetStyle(style1);
  fixture.socket.closeFromServer(1006);
  timers.advanceBy(250);
  await fixture.authenticateLatest();
  const registration = await fixture.latestRegistration();
  assert.notEqual(registration.registrationAttemptId, acknowledgedAttempt);
  assert.equal(registration.replaceLeaseId, fixture.lastAcknowledgedLease);
  assert.equal(registration.snapshot.styleHash, await hashStyle(style1));
});

test('an initial registration committed before a lost ack may replay its exact pending attempt', async () => {
  const fixture = connectingFixture();
  await fixture.authenticateCurrent();
  const raw = await fixture.nextRegistrationText();
  fixture.server.commitRegistrationButDropAck(decode(raw));
  fixture.socket.closeFromServer(1006);
  timers.advanceBy(250);
  await fixture.authenticateLatest();
  assert.equal(await fixture.latestRegistrationText(), raw);
  fixture.serverSend(registeredFor(decode(raw), { leaseId: fixture.server.committedLease }));
  const confirmation = await fixture.latestSocket.nextSentFrameOfKind('event');
  assert.equal(confirmation.event, 'mapSnapshot'); // mandatory even when the pair is unchanged
  assert.deepEqual(confirmation.snapshot, fixture.liveSnapshot());
  fixture.server.accept(confirmation);
  await fixture.connection.whenReady();
  assert.equal(fixture.sockets.created.length, 2);
});

test('pending-ack replay has a finite budget shorter than server attempt retention', async () => {
  const fixture = connectingFixture();
  const raw = await fixture.sendRegistrationAndDropEveryAck();
  timers.advanceBy(REGISTRATION_REPLAY_CLIENT_BUDGET_MS - 1);
  assert.equal(fixture.connection.status, 'reconnecting');
  assert.ok(fixture.registrationTexts.every((text) => text === raw));
  timers.advanceBy(1);
  await assert.rejects(fixture.connection.whenReady(), hasCode('BRIDGE_DISCONNECTED'));
  assert.equal(fixture.connection.status, 'terminal');
  const socketCount = fixture.sockets.created.length;
  timers.advanceBy(REGISTRATION_ATTEMPT_RETENTION_MS);
  assert.equal(fixture.sockets.created.length, socketCount);
});

test('explicit close removes listeners and never reconnects', async () => {
  connected.connection.close();
  assert.equal(connected.map.listenerCount(), 0);
  timers.advanceBy(60_000);
  assert.equal(sockets.created.length, 1);
});

test('lease replacement permanently stops the old client without disturbing the new owner', async () => {
  const old = await connectedClientWithQueuedMutation();
  const replacement = await secondClientReplacing(old.lease());
  old.socket.closeFromServer(4001);
  await old.waitForTerminal();
  timers.advanceBy(60_000);
  assert.equal(old.sockets.created.length, 1);
  assert.equal(old.runtime.startedQueuedMutation, false);
  assert.equal(replacement.server.registry.get('demo-map')?.peerId, replacement.peerId);
  assert.equal(replacement.connection.status, 'connected');
});

test('retries only exact post-ready transient closes and treats handshake failures as terminal', async () => {
  for (const code of [1000, 1002, 1008, 1009, 4001]) {
    const fixture = await readyFixture();
    fixture.socket.closeFromServer(code);
    timers.advanceBy(60_000);
    assert.equal(fixture.sockets.created.length, 1);
    assert.equal(fixture.connection.status, 'terminal');
    assert.equal(fixture.map.listenerCount(), 0);
    fixture.map.emit('style.load');
    assert.equal(fixture.socket.sentAfterTerminal, 0);
  }
  for (const code of [1006, 1011, 1012, 1013, 4002]) {
    const fixture = await readyFixture();
    fixture.socket.closeFromServer(code);
    timers.advanceBy(250);
    assert.equal(fixture.sockets.created.length, 2);
  }
  const neverReady = connectingFixture();
  neverReady.socket.closeFromServer(1006);
  await assert.rejects(neverReady.connection.whenReady(), /disconnected/i);
  timers.advanceBy(60_000);
  assert.equal(neverReady.sockets.created.length, 1);

  const staleLease = reconnectingFixtureWithRejectedRegistration('CONFLICT');
  await assert.rejects(staleLease.connection.whenReady(), hasCode('CONFLICT'));
  timers.advanceBy(60_000);
  assert.equal(staleLease.sockets.created.length, 1);
});

test('a late close from an old generation cannot terminate its registered replacement generation', async () => {
  const fixture = await readyFixture();
  const oldSocket = fixture.socket;
  oldSocket.closeFromServer(1006);
  timers.advanceBy(250);
  await fixture.registerLatestGeneration();
  oldSocket.emitLateClose(4001);
  assert.equal(fixture.connection.status, 'connected');
  assert.equal(fixture.socket, fixture.sockets.latest());
  assert.equal(fixture.sockets.created.length, 2);
});
```

- [ ] **Step 9: Implement reconnect and full resynchronization**

Reconnect is an exact allowlist, never a denylist. It is enabled after a connection reached `registered`, and also for the narrow first-registration case where a complete pending registration frame was already sent and may have committed before its acknowledgement was lost. In either case only current-generation transient `1006`, `1011`, `1012`, `1013`, or bridge sync-loss `4002` is retryable. A failure during auth/runtime initialization or before any registration frame was sent remains terminal. Clean `1000`, protocol `1002`, policy/auth `1008`, payload `1009`, lease replacement `4001`, explicit local close, and every stable auth/register result error (including stale-lease `CONFLICT` and negotiated-limit `INVALID_INPUT`) are terminal: abort the generation, cancel backoff, reject `whenReady`/queued records with a fixed provenance-safe error, publish terminal status, and create no new socket. Check the close/error generation before any transition; a late old-generation close is a no-op after a newer generation registers.

For allowed transient closes, default delays are 250 ms, 500 ms, 1 s, 2 s, 4 s, capped at 5 s. Reset backoff only after registration acknowledgement and any required post-ack snapshot finish. A pending-ack logical attempt has the finite `REGISTRATION_REPLAY_CLIENT_BUDGET_MS = 30_000` measured from its first send; at the boundary it enters terminal teardown, clears the attempt, and creates no more sockets. The server retains the matching committed record for the longer `REGISTRATION_ATTEMPT_RETENTION_MS = 60_000`, so every permitted retry remains idempotent. If an immutable pending attempt exists, replay its exact projected frame byte-for-byte; do not re-read/re-hash the Map or change attempt ID/lease/fingerprint.

After a replay acknowledgement, retain the attempt until sending an authoritative `mapSnapshot` confirmation **unconditionally**, even when the live revision/hash equals the retained fingerprint. The server has already marked this generation unknown. Because this protocol adds no snapshot acknowledgement, client `whenReady()` may mean only that the confirmation passed the outstanding-send gate and was enqueued successfully; it must not claim the server has accepted it. Server-side safety comes from the registry remaining `unknown`/no-dispatch until its FIFO inbound tail validates and accepts that snapshot. Clear the browser's pending attempt/reset backoff only after the confirmation send succeeds, while the server record remains until actual acceptance/retention expiry. A later ordinary reconnect uses the last acknowledged lease, a fresh random attempt ID, and a fresh no-argument Map snapshot. Reject all commands before registration plus post-ack resync. On disconnect, reject queued commands not begun and never replay them. An adapter call already in progress may settle locally because MapLibre loading is not abortable; do not register an uncertain snapshot until it or forced resync establishes authority. Discard old-socket results and report authority through the pending/fresh registration or required post-ack `mapSnapshot`, projecting Style only under `style.read`; metadata-only pairs remain valid.

All terminal paths—including every terminal close code, stable handshake error, explicit close, and replacement—call the same idempotent teardown: abort command/recovery generations, settle barriers/queued records safely, cancel all timers/backoff, close the socket, clear subscribers, and remove `style.load`/`styledata`/`error` listeners. Tests assert listener count zero and no later Map event sends a frame. Transient generation teardown removes old-generation listeners before installing the new set. `close()` invokes that gate and permanently disables reconnect.

- [ ] **Step 10: Run browser client tests**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/bridge/client.test.js`

Expected: PASS for token secrecy, first-frame auth, negotiated runtime limits, one immutable runtime-image base with no separate actual-document base, hard deadline admission, near-limit metadata-only registration/events/mutation failures, mutation receipt and getStyle size degradation, command/result-type correlation, bounded active IDs, generation-gated browser queue cancellation, write-only receipt/error secrecy, public custom-protocol image loading, external/unknown status changes and independent recovery, one correlated current-authority `IO_ERROR` failure with an exact +1 authoritative registry merge and next queued revision/hash pair, bridge-event suppression, exact transient-only reconnect, finite pending-attempt replay, mandatory post-ack snapshot confirmation with an unknown/no-dispatch server window, terminal auth/protocol/payload/replacement handling, reconnect-after-settlement resync, stale-generation isolation, lease replacement, listener cleanup, and no replayed old-generation work.

- [ ] **Step 11: Commit the browser client**

```bash
rtk git add src/bridge/client.ts src/bridge/client.test.ts
rtk git commit -m "feat: connect live MapLibre maps from browsers"
```

### Task 7: Live-map MCP tools and resources

**Files:**
- Create: `src/mcp/live-tools.ts`
- Create: `src/mcp/live-resources.ts`
- Create: `src/mcp/live-extension.ts`
- Create: `src/mcp/live-extension.test.ts`
- Reuse unchanged: `src/mcp/output.ts`
- Reuse unchanged: `src/mcp/message-boundary.ts`
- Reuse unchanged: `src/mcp/server-extension.ts`
- Reuse unchanged: `src/mcp/create-server.ts`
- Modify: `src/mcp/main.ts`
- Modify: `scripts/check-mcp-typegraph.mjs`
- Create: `scripts/check-mcp-typegraph.test.mjs`

**Interfaces:**
- Consumes: `LiveMapRegistry`; `BridgeMapIdSchema` and `BridgeCommandVariantSchemas`; core `createStyleToolError`/`isStyleToolError`; the existing exported `ResourceUriAdmission`, `McpMessagePolicy`, `McpServerExtensionContext`, `McpServerExtension = (server: McpServer, context: McpServerExtensionContext) => undefined`, context composition method `registerResourceUriAdmission`, and context-owned `McpResponseBoundary` methods `requireToolSuccess`/`requireToolFailure`/`requireResourceResult`/`requireResourceFailure`; exported `parseOfficialCallToolResult` and `parseMcpToolEnvelope` from `src/mcp/output.ts`; `createMapLibreStyleMcpServer({store?, extensions?, maxMessageBytes?})` returning `{server,store,messagePolicy,connect,close}` with both public connect spellings already bounded; and MCP SDK `McpServer`/`ResourceTemplate` APIs. The live extension consumes the exact frozen context supplied by the factory and never calls `resolveMcpMessagePolicy` or `createMcpResponseBoundary` itself.
- Produces: `registerLiveMapTools(server, registry, context)`, eleven root `z.strictObject` MCP input schemas, `registerLiveMapResources(server, registry, context)`, public `createLiveMapMcpExtension(registry): McpServerExtension`, exported `liveMapResourceUriAdmission: ResourceUriAdmission`, module-private atomic actual-read finalization, fixed live-mutation receipt projection, and metadata-only `projectLiveMutationError`, public `buildLiveMapMetadataUri(mapId: string): string` and `buildLiveMapStyleUri(mapId: string): string`, module-level post-admission `parseLiveMapResourceUri(uri: URL, kind: 'metadata' | 'style'): string`, `liveMapListDataSchema`, `liveMapStyleDataSchema`, exact fixed `liveTransactionDataSchema`, `liveMutationReceiptDataSchema`, and `liveFeatureQueryDataSchema` from `maplibre-style-tools/mcp`.

- [ ] **Step 1: Write a failing MCP SDK integration test for map discovery and read resources**

```ts
import { parseMcpToolEnvelope, parseOfficialCallToolResult } from './output.js';

test('lists connected maps and reads metadata/style resources', async (t) => {
  const registry = await registryWithConnectedMap({ mapId: 'demo-map', capabilities: ['style.read'], snapshot: snapshot0 });
  const created = createMapLibreStyleMcpServer({ extensions: [createLiveMapMcpExtension(registry)] });
  t.after(() => created.close());
  const client = await connectInMemoryMcpClient(t, created.server);
  const listed = parseOfficialCallToolResult(await client.callTool({ name: 'map_list', arguments: {} }));
  const listedEnvelope = parseMcpToolEnvelope(listed.structuredContent);
  assert.equal(listedEnvelope.ok, true);
  if (!listedEnvelope.ok) assert.fail('expected map_list success');
  assert.deepEqual(liveMapListDataSchema.parse(listedEnvelope.data), { maps: [publicMetadata('demo-map', snapshot0)] });
  const resource = await client.readResource({ uri: buildLiveMapStyleUri('demo-map') });
  const first = resource.contents[0];
  assert.ok(first && 'text' in first);
  if (!first || !('text' in first)) assert.fail('expected text resource');
  assert.equal(JSON.parse(first.text).version, 8);
});

test('narrows the official SDK compatibility union before structured content access', async (t) => {
  const client = await liveClientWithMaps(t, ['demo-map']);
  const raw = await client.callTool({ name: 'map_list', arguments: {} });
  // @ts-expect-error the compatibility branch exposes this property only as unknown.
  const unsafeStructured: Record<string, unknown> | undefined = raw.structuredContent;
  void unsafeStructured;
  const official = parseOfficialCallToolResult(raw);
  assert.equal(parseMcpToolEnvelope(official.structuredContent).ok, true);
});

test('lists both exact live ResourceTemplates through the official Client', async (t) => {
  const client = await liveClientWithMaps(t, ['demo-map']);
  const listed = await client.listResourceTemplates();
  const liveTemplates = listed.resourceTemplates.filter(({ uriTemplate }) =>
    uriTemplate.startsWith('maplibre-style://maps/~'),
  );
  assert.deepEqual(
    liveTemplates.map(({ uriTemplate, mimeType }) => ({ uriTemplate, mimeType })).sort(byUri),
    [
      { uriTemplate: 'maplibre-style://maps/~{mapId}', mimeType: 'application/json' },
      { uriTemplate: 'maplibre-style://maps/~{mapId}/style', mimeType: 'application/json' },
    ],
  );
  assert.equal(listed.resourceTemplates.length, 8); // existing six document templates + two live templates
  assert.equal(new Set(listed.resourceTemplates.map(({ uriTemplate }) => uriTemplate)).size, 8);
  const metadata = await client.readResource({ uri: buildLiveMapMetadataUri('demo-map') });
  const style = await client.readResource({ uri: buildLiveMapStyleUri('demo-map') });
  assert.equal(JSON.parse(requireText(metadata.contents[0])).mapId, 'demo-map');
  assert.equal(JSON.parse(requireText(style.contents[0])).version, 8);
});

test('lists and reads the fixed live-map collection through the official Client', async (t) => {
  const client = await liveClientWithMaps(t, ['demo-map']);
  const listed = await client.listResources();
  assert.deepEqual(
    listed.resources.filter(({ uri }) => uri === 'maplibre-style://maps'),
    [{
      uri: 'maplibre-style://maps',
      name: 'live-maps',
      title: 'Connected MapLibre Maps',
      mimeType: 'application/json',
    }],
  );
  const fixed = await client.readResource({ uri: 'maplibre-style://maps' });
  const fromResource = liveMapListDataSchema.parse(JSON.parse(requireText(fixed.contents[0])));
  const toolResult = parseOfficialCallToolResult(await client.callTool({
    name: 'map_list', arguments: {},
  }));
  const toolEnvelope = parseMcpToolEnvelope(toolResult.structuredContent);
  assert.equal(toolEnvelope.ok, true);
  if (!toolEnvelope.ok) assert.fail('expected map_list success');
  assert.deepEqual(fromResource, liveMapListDataSchema.parse(toolEnvelope.data));
});

test('fixed and template resources use the exact SDK 1.30 callback signatures', async () => {
  const fixedArgs: unknown[][] = [];
  const templateArgs: unknown[][] = [];
  const server = recordingMcpServer();
  registerLiveMapResources(server, registry, recordingExtensionContext({ fixedArgs, templateArgs }));
  const uri = new URL('maplibre-style://maps');
  const extra = requestExtraFixture();
  await server.fixedResource('live-maps').handler(uri, extra);
  assert.deepEqual(fixedArgs, [[uri, extra]]);

  const templateUri = new URL(buildLiveMapMetadataUri('demo-map'));
  const variables = { mapId: 'demo-map' };
  await server.templateResource('live-map-metadata').handler(templateUri, variables, extra);
  assert.deepEqual(templateArgs, [[templateUri, variables, extra]]);

  const fixedCallback: ReadResourceCallback = server.fixedResource('live-maps').handler;
  const templateCallback: ReadResourceTemplateCallback = server.templateResource('live-map-metadata').handler;
  void fixedCallback;
  void templateCallback;
});

test('marked live resource builders round-trip semantic IDs exactly once', async (t) => {
  const client = await liveClientWithMaps(t, ['demo-map', 'a.b', 'a_b', 'A-0']);
  for (const mapId of ['demo-map', 'a.b', 'a_b', 'A-0']) {
    const metadataUri = buildLiveMapMetadataUri(mapId);
    const styleUri = buildLiveMapStyleUri(mapId);
    assert.equal(metadataUri, `maplibre-style://maps/~${encodeURIComponent(mapId)}`);
    assert.equal(styleUri, `${metadataUri}/style`);
    const metadata = await client.readResource({ uri: metadataUri });
    assert.equal(JSON.parse(requireText(metadata.contents[0])).mapId, mapId);
    assert.equal((await client.readResource({ uri: styleUri })).contents.length, 1);
  }
  for (const nonSemantic of ['.', '..', '%2e', '%2e%2e', '%252e']) {
    assert.throws(() => buildLiveMapStyleUri(nonSemantic));
  }
});

test('marked MCP resource routing rejects dot, encoded, double-encoded, and legacy aliases', async (t) => {
  const { client, registry, resourceResolver } = await liveClientWithResourceCounters(t, ['a.b']);
  for (const alias of [
    'maplibre-style://maps/~./style',
    'maplibre-style://maps/~../style',
    'maplibre-style://maps/~%2e/style',
    'maplibre-style://maps/~%2E%2E/style',
    'maplibre-style://maps/~%252e/style',
    'maplibre-style://maps/~a%2Eb/style',
    'maplibre-style://maps/a.b',
    'maplibre-style://maps/a.b/style',
    'maplibre-style://maps/foo/../~a.b/style',
    'maplibre-style://maps/%2e%2e/~a.b/style',
    'maplibre-style://maps/~a.b/./style',
  ]) {
    await assertMcpResourceError(client, alias, 'INVALID_INPUT', {
      reason: 'nonCanonicalResourceUri',
    });
    assert.equal(resourceResolver.calls.length, 0);
    assert.equal(registry.resourceReadCalls.length, 0);
  }
  // A correlatable admission failure must not poison the bounded MCP connection.
  const resource = await client.readResource({ uri: buildLiveMapStyleUri('a.b') });
  assert.equal(resource.contents.length, 1);
  assert.equal(resourceResolver.calls.length, 1);
});

test('Style resource fetches one current Style when a connected known mirror is metadata-only', async (t) => {
  for (const fixture of [metadataOnlyRegistrationFixture(), receiptClearedCacheFixture()]) {
    const { client, browser, registry } = await liveClient(t, fixture);
    const read = client.readResource({ uri: buildLiveMapStyleUri('demo-map') });
    const command = await browser.nextCommand();
    assert.equal(command.command.type, 'getStyle');
    assert.equal(browser.commands.length, 1);
    browser.respond(command, styleResult(fixture.revision, fixture.styleHash, fixture.style));
    const resource = await read;
    assert.deepEqual(JSON.parse(requireText(resource.contents[0])), fixture.style);
    assert.equal(registry.get('demo-map')?.snapshot.styleHash, fixture.styleHash);
    assert.deepEqual(registry.get('demo-map')?.snapshot.style, fixture.style);
  }
});

test('Style resource distinguishes disconnected, denied, and unknown states', async (t) => {
  await assertMcpResourceError(disconnectedClient, buildLiveMapStyleUri('demo-map'), 'BRIDGE_DISCONNECTED');
  await assertMcpResourceError(writeOnlyClient, buildLiveMapStyleUri('demo-map'), 'CAPABILITY_DENIED');
  await assertMcpResourceError(unknownSyncClient, buildLiveMapStyleUri('demo-map'), 'MAP_NOT_READY');
  assert.equal(unknownSyncBrowser.commands.length, 0);
});

test('live registrars receive the factory one frozen message policy and boundary context', async (t) => {
  const seen: McpServerExtensionContext[] = [];
  const counters = createCompositionDependencyCounters();
  const live = createLiveMapMcpExtensionWithDependencies(registry, {
    registerTools: (_server, _registry, context) => { seen.push(context); },
    registerResources: (_server, _registry, context) => { seen.push(context); },
  });
  const created = createMapLibreStyleMcpServerWithDependencies({
    maxMessageBytes: MIN_MCP_MESSAGE_BYTES,
    extensions: [live, (_server, context) => { seen.push(context); }],
  }, counters.dependencies);
  t.after(() => created.close());
  assert.equal(seen.length, 3);
  assert.strictEqual(seen[0], seen[1]);
  assert.strictEqual(seen[1], seen[2]);
  assert.strictEqual(seen[0]?.messagePolicy, created.messagePolicy);
  assert.equal(Object.isFrozen(seen[0]), true);
  assert.deepEqual(counters.frozenAdmissions.namespaces, [
    ['maplibre-style', 'sessions'],
    ['maplibre-style', 'maps'],
  ]);
});

test('live extension composition is synchronous and rejects a thenable', () => {
  assert.equal(createLiveMapMcpExtension(registry)(recordingServer, frozenContext), undefined);
  // @ts-expect-error extensions are synchronous and cannot return Promise<void>.
  const asyncExtension: McpServerExtension = async () => undefined;
  assert.throws(
    () => createMapLibreStyleMcpServer({ extensions: [() => Promise.resolve()] as unknown as McpServerExtension[] }),
    /synchronous|thenable/i,
  );
  void asyncExtension;
});

test('a lowered MCP policy accepts a small Style and rejects an actual oversized read before cache merge', async (t) => {
  const smallFixture = await metadataOnlyLiveClient(t, {
    maxMessageBytes: MIN_MCP_MESSAGE_BYTES,
    browserStyle: smallStyleThatFitsDuplicatedMcpResult,
  });
  const small = parseLiveCallResult(await smallFixture.client.callTool({
    name: 'map_get_style', arguments: { mapId: 'demo-map' },
  }));
  assert.equal(small.ok, true);

  const secret = 'near-limit-style-must-not-leak';
  const fixture = await metadataOnlyLiveClient(t, {
    maxMessageBytes: MIN_MCP_MESSAGE_BYTES,
    browserStyle: styleWhoseActualMcpResultExceedsPolicy(secret),
  });
  const before = fixture.registrySnapshot();
  const failed = parseLiveCallResult(await fixture.client.callTool({
    name: 'map_get_style', arguments: { mapId: 'demo-map' },
  }));
  assert.equal(failed.ok, false);
  if (failed.ok) assert.fail('expected response budget failure');
  assert.equal(failed.error.details?.reason, 'responseTooLarge');
  assert.equal(JSON.stringify(failed).includes(secret), false);
  assert.equal(fixture.browser.getStyleCommands, 1); // the harmless read ran
  assert.equal(fixture.registry.cacheWritesAfter(before), 0);
  assert.equal(fixture.registry.mirrorWritesAfter(before), 0);
  assert.equal(fixture.registry.touchCallsAfter(before), 0);
  assert.equal(fixture.registry.pendingCount, 0);
});

test('an oversized Style resource is data-free and leaves a metadata-only mirror/cache untouched', async (t) => {
  const secret = 'resource-style-secret';
  const fixture = await metadataOnlyLiveClient(t, {
    maxMessageBytes: MIN_MCP_MESSAGE_BYTES,
    browserStyle: styleWhoseActualMcpResourceExceedsPolicy(secret),
  });
  const before = fixture.registrySnapshot();
  await assertMcpResourceError(
    fixture.client,
    buildLiveMapStyleUri('demo-map'),
    'INVALID_INPUT',
    { reason: 'responseTooLarge', excludes: secret },
  );
  assert.equal(fixture.browser.getStyleCommands, 1);
  assert.equal(fixture.registry.cacheWritesAfter(before), 0);
  assert.equal(fixture.registry.mirrorWritesAfter(before), 0);
  assert.equal(fixture.registry.touchCallsAfter(before), 0);
  assert.equal(fixture.registry.coalescerCount, 0);
});

test('query, image-list, map-list, and collection reads finalize actual results before any touch', async (t) => {
  const fixture = await liveClient(t, { maxMessageBytes: MIN_MCP_MESSAGE_BYTES });
  for (const scenario of loweredPolicyReadScenarios(fixture)) {
    const before = fixture.registrySnapshot();
    const failure = await scenario.invokeOfficialClient();
    assertResponseTooLargeWithoutSecret(failure, scenario.secret);
    assert.equal(fixture.registry.cacheWritesAfter(before), 0);
    assert.equal(fixture.registry.mirrorWritesAfter(before), 0);
    assert.equal(fixture.registry.touchCallsAfter(before), 0);
  }
});

test('fixed mutation receipts are proven before dispatch and hide full browser results', async (t) => {
  const fixture = await liveClient(t, { maxMessageBytes: MIN_MCP_MESSAGE_BYTES });
  const pending = fixture.client.callTool({
    name: 'map_apply_transaction', arguments: applyArgs(0, hash0),
  });
  fixture.browser.respondToNext(fullTransactionResultWithLargeStyleDiffAndSecret('browser-detail-secret'));
  const envelope = parseLiveCallResult(await pending);
  assert.equal(envelope.ok, true);
  if (!envelope.ok) assert.fail('expected fixed receipt');
  assert.deepEqual(liveTransactionDataSchema.parse(envelope.data), {
    type: 'transaction', detail: 'receipt', revision: 1, styleHash: hash1,
    applied: true, noOp: false,
  });
  assert.equal(JSON.stringify(envelope).includes('browser-detail-secret'), false);

  const denied = liveHandlersWithBoundaryRejectingMaxReceipt();
  const before = denied.registrySnapshot();
  const rejected = await denied.invoke('map_apply_transaction', applyArgs(0, hash0));
  assert.equal(parseFailure(rejected).error.details?.reason, 'responseTooLarge');
  assert.equal(denied.registry.executeCalls.length, 0);
  assert.equal(denied.browser.commands.length, 0);
  assert.equal(denied.mapMutationCalls, 0);
  assert.deepEqual(denied.registrySnapshot(), before);
});

test('lowered MCP policy preserves authoritative mutation failure metadata without Style or secrets', async (t) => {
  for (const code of ['INTERNAL', 'IO_ERROR', 'TIMEOUT'] as const) {
    const secret = `mutation-failure-secret-${code}`;
    const fixture = await liveClient(t, { maxMessageBytes: MIN_MCP_MESSAGE_BYTES });
    const pending = fixture.client.callTool({
      name: 'map_apply_transaction', arguments: applyArgs(0, hash0),
    });
    fixture.browser.respondToNext(failureResult(code, {
      currentSnapshot: snapshot(1, hash1, styleContaining(secret)),
      rolledBack: false,
      rollbackError: { code: 'IO_ERROR', message: secret, path: `/${secret}`, details: { secret } },
    }));
    const envelope = parseLiveCallResult(await pending);
    assert.equal(envelope.ok, false);
    if (envelope.ok) assert.fail('expected mutation failure');
    assert.equal(envelope.error.code, code);
    assert.deepEqual(envelope.error.details?.currentSnapshot, { revision: 1, styleHash: hash1 });
    assert.equal(envelope.error.details?.rolledBack, false);
    assert.notEqual(envelope.error.details?.reason, 'responseTooLarge');
    assert.equal(JSON.stringify(envelope).includes(secret), false);
    assert.deepEqual(registryPublicPair(fixture.registry, 'demo-map'), { revision: 1, styleHash: hash1 });
  }
});

test('mutation error projection retains only the fixed code-specific safe details', async (t) => {
  const fixture = await liveClient(t, { maxMessageBytes: MIN_MCP_MESSAGE_BYTES });
  const relative = parseLiveCallResult(await fixture.client.callTool({
    name: 'map_apply_transaction',
    arguments: transactionIntroducingRelativeSource('relative-probe.geojson'),
  }));
  assert.equal(relative.ok, false);
  if (relative.ok) assert.fail('expected relative Style rejection');
  assert.equal(relative.error.code, 'INVALID_INPUT');
  assert.deepEqual(relative.error.details, { reason: 'relative-style-url' });
  assert.equal(fixture.map.setStyleCalls, 0);

  assert.deepEqual(
    projectLiveMutationError(capabilityDeniedWithSecret()).details,
    { commandType: 'addImage', requiredCapability: 'network.load' },
  );
  assert.deepEqual(
    projectLiveMutationError(mapNotReadyWithSecret()).details,
    { syncState: 'unknown' },
  );
});
```

- [ ] **Step 2: Compile to verify the live extension test is red**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json`

Expected: FAIL because `src/mcp/live-extension.ts` does not exist.

- [ ] **Step 3: Register live resources with capability-safe snapshots**

```ts
export function createLiveMapMcpExtension(registry: LiveMapRegistry): McpServerExtension {
  return (server, context) => {
    context.registerResourceUriAdmission(liveMapResourceUriAdmission);
    registerLiveMapTools(server, registry, context);
    registerLiveMapResources(server, registry, context);
    return undefined;
  };
}
```

The extension receives the already-frozen `McpServerExtensionContext` from `createMapLibreStyleMcpServer`; register `liveMapResourceUriAdmission` exactly once during composition, then pass that exact context object by identity to both registrars. Its callback is strictly synchronous and explicitly returns `undefined`; a type test rejects `async` extensions and a runtime composition test rejects a returned thenable, so no admission/tool/resource registration can arrive after the factory freezes its boundary. Do not import the Node-internal boundary/admission registry, resolve another policy, or cache a module-level default. A dependency-injected registration test records the admission plus both registrar arguments and a sibling caller extension, and requires all three context identities, `context.messagePolicy === created.messagePolicy`, and the exact `{scheme:'maplibre-style',authority:'maps'}` admission namespace in the factory-frozen registry. Every tool handler uses `context.responseBoundary.requireToolSuccess` for an actual success and `requireToolFailure` for both authentic and fixed-internal failures. Every resource callback is registered through `context.guardResourceHandler(...)`, retains all SDK callback arguments, and also calls `context.responseBoundary.requireResourceResult` inside its own registry finalizer; the guard's second call is a final defense and must receive/return the same already-finalized object without repeating the read. Authentic resource errors reach the guard's `requireResourceFailure`; unknown values become its fixed redacted internal resource error.

Register `maplibre-style://maps` as a fixed resource with the SDK 1.30 `server.registerResource(name, uri, metadata, handler)` overload:

```ts
server.registerResource(
  'live-maps',
  'maplibre-style://maps',
  { title: 'Connected MapLibre Maps', mimeType: 'application/json' },
  context.guardResourceHandler((_uri, _extra) =>
    registry.projectList((maps) => context.responseBoundary.requireResourceResult(
      liveMapCollectionResourceResult(maps),
    )),
  ),
);
```

Its JSON payload must parse with `liveMapListDataSchema` and equal `map_list` data. The official Client `listResources`/`readResource` test filters the fixed URI and locks its exact name/title/mime without assuming the base document resources disappear. SDK 1.30's fixed-resource callback is exactly `(uri: URL, extra)`, while a `ResourceTemplate` callback is exactly `(uri: URL, variables, extra)`. A recording-server type/runtime test invokes each overload, proves the fixed handler receives exactly two arguments and the same `extra` identity, and proves both template handlers retain the exact `variables` and `extra` identities through `guardResourceHandler`; no handler declares a nonexistent third required parameter. Construct the two templates with the exact SDK constructor and registration overload—do not pass raw template strings:

```ts
const LIVE_MAP_RESOURCE_ROOT = 'maplibre-style://maps' as const;

const invalidLiveResourceUri = (): never => {
  throw createStyleToolError('INVALID_INPUT', 'Live map resource URI is invalid.', undefined, {
    reason: 'nonCanonicalResourceUri',
  });
};

const decodeCanonicalMarkedMapId = (rawSegment: string): string => {
  if (!rawSegment.startsWith('~') || rawSegment.length === 1) invalidLiveResourceUri();
  const encoded = rawSegment.slice(1);
  let semantic: string;
  try { semantic = decodeURIComponent(encoded); } catch { return invalidLiveResourceUri(); }
  if (encodeURIComponent(semantic) !== encoded) invalidLiveResourceUri();
  const parsed = BridgeMapIdSchema.safeParse(semantic);
  if (!parsed.success) invalidLiveResourceUri();
  return parsed.data;
};

export const liveMapResourceUriAdmission: ResourceUriAdmission = Object.freeze({
  scheme: 'maplibre-style',
  authority: 'maps',
  assertCanonical(rawUri: string): void {
    if (rawUri === LIVE_MAP_RESOURCE_ROOT) return;
    const prefix = `${LIVE_MAP_RESOURCE_ROOT}/`;
    if (!rawUri.startsWith(prefix) || rawUri.includes('?') || rawUri.includes('#')) {
      invalidLiveResourceUri();
    }
    const rawSegments = rawUri.slice(prefix.length).split('/');
    if (rawSegments.length !== 1 &&
        !(rawSegments.length === 2 && rawSegments[1] === 'style')) {
      invalidLiveResourceUri();
    }
    decodeCanonicalMarkedMapId(rawSegments[0] ?? '');
  },
});

export function buildLiveMapMetadataUri(mapId: string): string {
  const semanticMapId = BridgeMapIdSchema.parse(mapId); // callers never pass pre-encoded text
  return `${LIVE_MAP_RESOURCE_ROOT}/~${encodeURIComponent(semanticMapId)}`;
}

export function buildLiveMapStyleUri(mapId: string): string {
  return `${buildLiveMapMetadataUri(mapId)}/style`;
}

export function parseLiveMapResourceUri(uri: URL, kind: 'metadata' | 'style'): string {
  const invalid = (): never => {
    throw createStyleToolError('INVALID_INPUT', 'Live map resource URI is invalid.');
  };
  if (uri.protocol !== 'maplibre-style:' || uri.host !== 'maps' ||
      uri.username || uri.password || uri.port || uri.search || uri.hash) invalid();
  const segments = uri.pathname.split('/').slice(1);
  if (segments.length !== (kind === 'metadata' ? 1 : 2) ||
      (kind === 'style' && segments[1] !== 'style')) invalid();
  const marked = segments[0];
  if (!marked?.startsWith('~') || marked.length === 1) invalid();
  const encodedMapId = marked.slice(1);
  let semanticMapId: string;
  try { semanticMapId = decodeURIComponent(encodedMapId); } catch { return invalid(); }
  if (encodeURIComponent(semanticMapId) !== encodedMapId) invalid();
  const parsed = BridgeMapIdSchema.safeParse(semanticMapId);
  if (!parsed.success) invalid();
  return parsed.data;
}

server.registerResource(
  'live-map-metadata',
  new ResourceTemplate('maplibre-style://maps/~{mapId}', { list: undefined }),
  { title: 'Live Map Metadata', mimeType: 'application/json' },
  context.guardResourceHandler((uri, _variables, _extra) => {
    const mapId = parseLiveMapResourceUri(uri, 'metadata');
    return registry.projectMetadata(mapId, (metadata) =>
      context.responseBoundary.requireResourceResult(liveMapMetadataResourceResult(metadata)));
  }),
);
server.registerResource(
  'live-map-style',
  new ResourceTemplate('maplibre-style://maps/~{mapId}/style', { list: undefined }),
  { title: 'Live Map Style', mimeType: 'application/json' },
  context.guardResourceHandler((uri, _variables, _extra) => {
    const mapId = parseLiveMapResourceUri(uri, 'style');
    return readLiveMapStyleResource(registry, mapId, context.responseBoundary);
  }),
);
```

`liveMapResourceUriAdmission.assertCanonical` is the authoritative spelling boundary and must inspect the original `resources/read.params.uri` string before SDK 1.30 constructs any `URL`. It never calls `new URL`: require the exact lowercase `maplibre-style://maps` scheme/authority, the fixed collection or exactly one of the two literal marked route grammars, no credentials/port/query/fragment, and canonical one-time percent encoding. The factory's generic raw-dot gate runs first and rejects every literal or case-insensitive encoded `.`/`..` segment, including normalization-changing prefixes such as `foo/../~a`; this admission then rejects legacy unmarked routes, `%2e`/mixed-case escapes inside a marked ID, double encoding, and encoded-unreserved aliases. Admission failure with a safe request ID returns bounded `INVALID_INPUT/details.reason:'nonCanonicalResourceUri'`, performs zero resolver/registry calls, and leaves the connection usable.

The literal `~` and semantic map ID remain in the same path segment: `~.` and `~..` are not WHATWG dot segments, but `BridgeMapIdSchema` still rejects semantic `.`/`..`. The SDK callback runs only after raw admission; `parseLiveMapResourceUri(URL, kind)` is a defensive post-admission shape check, decodes the marked segment exactly once, requires canonical re-encoding, and must not claim it can recover spelling erased by WHATWG normalization. Never decode the SDK template variable. The official Client passes semantic map IDs to the builders, lists these two exact marked templates, and reads both builder-produced URIs. The collection and metadata resource expose only map ID, capabilities, revision, hash, connected timestamps/status; they never expose peer IDs or replacement leases.

The Style resource distinguishes state precisely: no active handle is `BRIDGE_DISCONNECTED`; missing `style.read` is `CAPABILITY_DENIED`; `syncState:'unknown'` is `MAP_NOT_READY` with no command sent. A tagged cached Style is read only through `registry.projectCachedStyle(mapId, style => context.responseBoundary.requireResourceResult(liveMapStyleResourceResult(style)))`, so an actual over-budget cached resource cannot escape or refresh/touch anything. For an active, readable, known handle whose tagged cache is absent because registration/receipt was metadata-only, coalesce concurrent readers through one per-map in-flight promise and issue exactly one `registry.execute(mapId,{type:'getStyle'}, undefined, result => context.responseBoundary.requireResourceResult(liveMapStyleResourceResult(result.style)))`. Registry schema/correlation/capability/Style/hash validation precedes that finalizer; cache/mirror merge and settlement follow it. Thus a small actual Style remains usable even when the peer's negotiated `maxStyleBytes` is 5 MiB, while a near-limit actual MCP resource becomes the bounded data-free `responseTooLarge` error after one harmless browser read and with zero cache/mirror/touch changes. After a successful finalized read, require tagged-cache hash equality before reuse and never retry automatically. An indivisible oversized WebSocket `getStyle` frame remains its stable bridge `INVALID_INPUT` size error, never a false disconnect. Clear the coalescing promise in `finally` and on disconnect/replacement; a boundary failure cannot leave a coalescer, pending correlation, or timer behind.

The collection and metadata resources likewise construct their complete `{contents:[...]}` candidate inside `projectList`/`projectMetadata` and call `requireResourceResult` there before returning. The same atomic actual-result pattern applies to `map_list`, `map_get_style`, both feature queries, and `map_list_images`: call `requireToolSuccess` as the registry projector/`execute` finalizer after bridge validation but before cache/mirror/touch/settlement. Do not conservatively reject every Style just because the registered maximum could exceed the lower MCP policy; tests must prove a small actual Style succeeds and a larger actual Style fails without cache mutation. Read-only browser/query work may already have occurred, but no rejected value or sentinel reaches either MCP result form and the operation is never rerun.

- [ ] **Step 4: Write failing tests for all eleven live tool registrations and schemas**

```ts
test('registers the complete live tool surface', async (t) => {
  const client = await liveClient(t);
  const listed = await client.listTools(); // official MCP Client, not a direct handler call
  const tools = listed.tools.filter((tool) => tool.name.startsWith('map_'));
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'map_add_image', 'map_apply_transaction', 'map_get_style', 'map_list', 'map_list_images',
    'map_query_rendered_features', 'map_query_source_features', 'map_remove_feature_state',
    'map_remove_image', 'map_set_feature_state', 'map_set_global_state',
  ]);
  assert.deepEqual(
    Object.fromEntries(tools.map(({ name, inputSchema }) => [name, inputSchema])),
    expectedLiveToolInputJsonSchemas(), // an exact literal snapshot for all 11 roots
  );
  assert.deepEqual(toolNamed(tools, 'map_list').inputSchema, {
    type: 'object', properties: {}, additionalProperties: false,
  });
  for (const tool of tools.filter(({ name }) => name !== 'map_list')) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(Object.keys(tool.inputSchema.properties ?? {}).length > 0);
    assert.ok(tool.inputSchema.required?.includes('mapId'));
  }
});

test('official MCP dispatch rejects missing, extra, and over-limit inputs before the handler', async (t) => {
  await assertMcpInputError(client, 'map_apply_transaction', { mapId: 'demo-map', transaction });
  await assertMcpInputError(client, 'map_get_style', { mapId: 'demo-map', extra: true });
  await assertMcpInputError(client, 'map_query_source_features', { mapId: 'demo-map', sourceId: 'roads', limit: 101 });
  await assertMcpInputError(client, 'map_add_image', oversizedRgbaInput());
  assert.equal(registry.executeCalls.length, 0);
});
```

- [ ] **Step 5: Define exact Zod inputs and registry command mappings**

Register these MCP tools and translate each directly to one registry call:

```ts
map_list({})
map_get_style({ mapId })
map_apply_transaction({ mapId, expectedRevision, expectedStyleHash, transaction })
map_query_source_features({ mapId, sourceId, sourceLayer?, filter?, properties?, limit? })
map_query_rendered_features({ mapId, geometry?, layerIds?, filter?, properties?, limit? })
map_set_feature_state({ mapId, target, state })
map_remove_feature_state({ mapId, target, key? })
map_set_global_state({ mapId, propertyName, value })
map_list_images({ mapId })
map_add_image({ mapId, imageId, image, options? })
map_remove_image({ mapId, imageId })
```

Derive, do not hand-redeclare, the ten command shapes, but make every MCP root independently strict and include `mapId` outside the wire command:

```ts
const mapListInputSchema = z.strictObject({});
const mapGetStyleInputSchema = z.strictObject({ mapId: BridgeMapIdSchema, ...BridgeCommandVariantSchemas.getStyle.omit({ type: true }).shape });
const mapApplyTransactionInputSchema = z.strictObject({ mapId: BridgeMapIdSchema, ...BridgeCommandVariantSchemas.applyTransaction.omit({ type: true }).shape });
const mapQuerySourceFeaturesInputSchema = z.strictObject({ mapId: BridgeMapIdSchema, ...BridgeCommandVariantSchemas.querySourceFeatures.omit({ type: true }).shape });
const mapQueryRenderedFeaturesInputSchema = z.strictObject({ mapId: BridgeMapIdSchema, ...BridgeCommandVariantSchemas.queryRenderedFeatures.omit({ type: true }).shape });
const mapSetFeatureStateInputSchema = z.strictObject({ mapId: BridgeMapIdSchema, ...BridgeCommandVariantSchemas.setFeatureState.omit({ type: true }).shape });
const mapRemoveFeatureStateInputSchema = z.strictObject({ mapId: BridgeMapIdSchema, ...BridgeCommandVariantSchemas.removeFeatureState.omit({ type: true }).shape });
const mapSetGlobalStateInputSchema = z.strictObject({ mapId: BridgeMapIdSchema, ...BridgeCommandVariantSchemas.setGlobalState.omit({ type: true }).shape });
const mapListImagesInputSchema = z.strictObject({ mapId: BridgeMapIdSchema, ...BridgeCommandVariantSchemas.listImages.omit({ type: true }).shape });
const mapAddImageInputSchema = z.strictObject({ mapId: BridgeMapIdSchema, ...BridgeCommandVariantSchemas.addImage.omit({ type: true }).shape });
const mapRemoveImageInputSchema = z.strictObject({ mapId: BridgeMapIdSchema, ...BridgeCommandVariantSchemas.removeImage.omit({ type: true }).shape });
```

Call `server.registerTool(name, {title, description, inputSchema, annotations}, handler)` exactly once for each of the eleven schemas; do not pass a root-union `outputSchema`. Lock annotations in one exhaustive name-keyed table: list/get/query/list-images are read-only, non-destructive, idempotent, and closed-world; mutation tools are write, destructive, non-idempotent; `map_apply_transaction` and URL-capable `map_add_image` additionally have `openWorldHint:true`, while all others have `openWorldHint:false`. An exhaustive TypeScript `satisfies Record<LiveToolName,...>` check prevents a tool from silently missing metadata. The official SDK list-tools test compares every emitted JSON input schema and annotation to exact literal fixtures, rather than merely checking names.

Negotiated operation count remains a registry check because the static structural MCP transaction schema intentionally admits an explicitly negotiated 101st operation. Export focused `liveMapListDataSchema`, `liveMapStyleDataSchema`, exact receipt-only `liveTransactionDataSchema`, `liveMutationReceiptDataSchema`, and `liveFeatureQueryDataSchema` response validators for handler, integration, and E2E narrowing. `liveTransactionDataSchema` is the strict `{type:'transaction',detail:'receipt',revision,styleHash,applied,noOp}` shape. The other mutation tools return only a strict fixed receipt `{type:'mutationReceipt',command:<the exact state/image command>,accepted:true}`; never reflect state, image input, browser details, Style, diff, changed IDs, warnings, or arbitrary message text.

Every official `Client.callTool()` consumer must immediately pass the awaited outer compatibility union to `parseOfficialCallToolResult`; only then may it read `.structuredContent` and pass that value to `parseMcpToolEnvelope`. The compile assertion above proves the raw compatibility property is not assignable to the expected record type, while the inherited MCP output test proves the runtime parser rejects a compatibility wrapper. Narrow resource text/blob unions independently before access. Wrap every live tool with one `guardLiveTool(schema, context.responseBoundary, run)` matching the document-tool two-phase guard: direct input Zod failures become `requireToolFailure(INVALID_INPUT)`, the execution callback returns an already-finalized tool result, provenance-authentic failures pass through `requireToolFailure`, and unknown/forged values become a fixed data-free `INTERNAL` before `requireToolFailure`. No live path calls bare `toolSuccess` or `toolFailure`.

`map_list` uses `registry.projectList(maps => responseBoundary.requireToolSuccess({maps}))`. Each read command strips `mapId`, restores/parses the fixed wire command type, and makes one `registry.execute(..., result => responseBoundary.requireToolSuccess(projectReadResult(result)))` call; the finalizer is inside registry validation and before cache/mirror/touch/settlement. For every write command, first construct both its schema-maximal fixed receipt and maximal metadata-only failure (maximum safe revision, 64-hex hash, longest fixed command/error discriminants and bounded rollback flags), pass both complete candidates through the response boundary, and discard only these preflight objects. This happens before `registry.execute`, queue/correlation/timer allocation, browser dispatch, or any Map side effect. Then make exactly one registry call whose success finalizer projects the actual browser result to the same fixed receipt and calls `requireToolSuccess` again; the preflight proves this second call cannot fail after mutation. Add an injected-boundary regression that forces the maximal-receipt/error preflight to fail and proves zero registry/browser/Map calls and unchanged revision/hash, even though every valid resolved policy at `MIN_MCP_MESSAGE_BYTES` is construction-tested to fit all fixed receipts/errors. Never pass missing expected revision/hash or automatically substitute the server mirror's values.

Mutation failure handling is also a fixed projection, not the generic guard pass-through. `projectLiveMutationError(error)` accepts only a provenance-authentic core error and creates a **fresh** authentic error with the same stable code, `publicBridgeErrorMessage(code)`, and no path/cause. Its cross-cutting safe fields are only `{currentSnapshot:{revision,styleHash}, rolledBack?:boolean, rollbackError?:{code,message:publicBridgeErrorMessage(code)}}` when those already-validated fields exist. It additionally retains the same fixed outbound code-specific allowlist: `INVALID_INPUT` may retain only `reason:'relative-style-url'`, `CAPABILITY_DENIED` only `commandType` plus `requiredCapability`, and `MAP_NOT_READY` only `syncState:'known'|'unknown'`. It never copies `currentSnapshot.style`, arbitrary details, rollback path/details, browser text, or a credential-bearing message. The handler passes that projected authentic error to `requireToolFailure`; therefore a near-limit `INTERNAL`/`IO_ERROR`/`TIMEOUT` after a committed current-authority change retains the original code and authoritative revision/hash instead of collapsing to generic `responseTooLarge`, while the registry mirror has already merged the pair, and the real relative-Style MCP failure still reports the exact safe reason required by the public contract. Non-mutation handlers do not accept or synthesize authoritative snapshots.

- [ ] **Step 6: Write failing success/conflict/disconnect/no-retry tests**

```ts
const parseLiveCallResult = (value: unknown) => {
  const official = parseOfficialCallToolResult(value);
  return parseMcpToolEnvelope(official.structuredContent);
};

test('returns the browser transaction result and advances the mirror once', async (t) => {
  const pending = client.callTool({ name: 'map_apply_transaction', arguments: applyArgs(0, hash0) });
  browser.respondToNext(successfulTransactionResult(1, hash1, diff));
  const result = parseLiveCallResult(await pending);
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('expected transaction success');
  assert.equal(liveTransactionDataSchema.parse(result.data).revision, 1);
  assert.equal(registry.get('demo-map')?.metadata.revision, 1);
});

test('surfaces conflict/disconnect without retrying or editing a stale mirror', async (t) => {
  const pending = client.callTool({ name: 'map_apply_transaction', arguments: applyArgs(0, hash0) });
  browser.respondToNext(conflictWithSnapshot(1, hash1));
  const conflict = parseLiveCallResult(await pending);
  assert.equal(conflict.ok, false);
  if (conflict.ok) assert.fail('expected conflict');
  assert.equal(conflict.error.code, 'REVISION_CONFLICT');
  assert.equal(browser.commands.length, 1);
  browser.disconnect();
  const disconnected = parseLiveCallResult(await client.callTool({
    name: 'map_get_style', arguments: { mapId: 'demo-map' },
  }));
  assert.equal(disconnected.ok, false);
  if (disconnected.ok) assert.fail('expected disconnect');
  assert.equal(disconnected.error.code, 'BRIDGE_DISCONNECTED');
});

test('passes a negotiated 101-operation transaction through real MCP to WebSocket', async (t) => {
  const raised = await liveClient(t, { limits: bridgeLimits({ maxOperations: 101 }) });
  const pending = raised.client.callTool({
    name: 'map_apply_transaction',
    arguments: applyArgs(0, hash0, transactionWithOperationCount(101)),
  });
  assert.equal(raised.browser.nextCommand().command.transaction.operations.length, 101);
  raised.browser.respondToNext(transactionReceipt(1, hash1));
  assert.equal(parseLiveCallResult(await pending).ok, true);

  const defaults = await liveClient(t, { limits: defaultBridgeLimits });
  const rejected = parseLiveCallResult(await defaults.client.callTool({
    name: 'map_apply_transaction',
    arguments: applyArgs(0, hash0, transactionWithOperationCount(101)),
  }));
  assert.equal(rejected.ok, false);
  if (rejected.ok) assert.fail('expected registered operation limit failure');
  assert.equal(rejected.error.code, 'INVALID_INPUT');
  assert.equal(defaults.browser.commands.length, 0);
});

test('preserves only provenance-authentic registry errors at the MCP boundary', async (t) => {
  const valid = await liveClient(t, { registry: registryRejectingWith(
    createStyleToolError('REVISION_CONFLICT', publicMessage('REVISION_CONFLICT')),
  ) });
  const conflict = parseLiveCallResult(await valid.client.callTool({
    name: 'map_apply_transaction', arguments: applyArgs(0, hash0),
  }));
  assert.equal(conflict.ok, false);
  if (conflict.ok) assert.fail('expected conflict');
  assert.equal(conflict.error.code, 'REVISION_CONFLICT');

  const secret = 'plain-wire-shaped-error-must-not-cross-mcp';
  const forged = await liveClient(t, { registry: registryRejectingWith({
    code: 'REVISION_CONFLICT', message: secret, details: { currentSnapshot: snapshot0 },
  }) });
  const internal = parseLiveCallResult(await forged.client.callTool({
    name: 'map_apply_transaction', arguments: applyArgs(0, hash0),
  }));
  assert.equal(internal.ok, false);
  if (internal.ok) assert.fail('expected failure');
  assert.equal(internal.error.code, 'INTERNAL');
  assert.equal(JSON.stringify(internal).includes(secret), false);
});
```

- [ ] **Step 7: Map registry errors to the stable MCP envelope**

Catch registry failures as `unknown`. For non-mutation tools, only `isStyleToolError(error)` may enter `context.responseBoundary.requireToolFailure`; otherwise construct a new provenance-authentic `createStyleToolError('INTERNAL', fixedInternalMessage)` with no attacker value. For every mutation tool, an authentic error first passes through `projectLiveMutationError` and only that fresh bounded error enters `requireToolFailure`; forged/unknown values still become the same fixed `INTERNAL`. This preserves registry-rehydrated `REVISION_CONFLICT`, `BRIDGE_DISCONNECTED`, `CAPABILITY_DENIED`, `TIMEOUT`, `MAP_NOT_READY`, `IO_ERROR`, and `INVALID_INPUT`, preserves validated mutation revision/hash metadata under the lowered policy, and never casts a decoded object to `StyleToolError` or copies full current Style/rollback secrets. Set `isError: true` for `ok: false` call results. Query responses keep `returned`, `truncated`, and `serializedBytes`; image results never include decoded bytes. Add resource-change notification only when the installed MCP SDK/server lifecycle supports it synchronously; correctness must not depend on notifications.

- [ ] **Step 8: Run live MCP integration tests**

First update `scripts/check-mcp-typegraph.mjs` for the intentional Node MCP bridge closure. Continue rejecting every `/src/adapters/maplibre/` file except the exact transport-neutral WebCrypto file `/src/adapters/maplibre/style-hash.ts`; continue rejecting `map-adapter.ts`, feature/runtime commands, `maplibre-gl`, DOM libs, browser client/runtime, examples, AI SDK, tools, and engine modules. Define an exact allowlist for MCP-reachable `/src/bridge/` modules (`protocol.ts`, `codec.ts`, `capabilities.ts`, `outbound.ts`, `registry.ts`, and `server.ts`), require `protocol.ts`, `registry.ts`, `server.ts`, and the single style-hash file to appear in the normalized `tsc -p tsconfig.mcp.json --listFiles` output, and fail on every unlisted bridge file. Do not weaken this to a directory prefix exception.

Export the checker predicate without suppressing its CLI entry point. In `scripts/check-mcp-typegraph.test.mjs`, feed synthetic normalized file lists that prove the exact closure passes and that each of `map-adapter.ts`, `browser-runtime.ts`, `client.ts`, `maplibre-gl`, and a DOM lib fails independently. Also spawn the real `pnpm exec tsc -p tsconfig.mcp.json --listFiles`, apply the same predicate, and assert the resulting allowlisted project set exactly matches the expected MCP/core/bridge/style-hash closure (ignoring TypeScript/Node/Zod/SDK library declarations). This is the regression test for the deliberately narrow exception.

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/mcp/live-extension.test.js && rtk node --test scripts/check-mcp-typegraph.test.mjs && rtk pnpm run typecheck:mcp && rtk node scripts/check-mcp-typegraph.mjs`

Expected: PASS for exact eleven-tool strict JSON schemas/annotations through the official SDK, outer-call-result parsing before every structured envelope, synchronous extension composition with the shared frozen policy/admission registry, the fixed collection and two exact literal-marker ResourceTemplates, semantic-ID builder round trips, pre-SDK rejection of normalization-changing/dot/encoded/double-encoded/legacy URI aliases with zero resolver calls and a still-usable connection, metadata-only Style cache recovery by one coalesced getStyle, precise disconnected/denied/unknown resource errors, actual-result response budgeting before cache/touch, fixed mutation success and metadata-only error projections under the lowered policy, preserved ordinary `INTERNAL`/`IO_ERROR`/`TIMEOUT` authoritative pairs without Style/secrets, read/write/query/state/image dispatch, typed structured results, provenance-safe conflicts/unknown failures, disconnects, capability denial, a negotiated 101-operation path, no retry, and an exact Node MCP type graph that admits only the neutral style hash and required server bridge closure while excluding MapLibre/DOM runtime code.

- [ ] **Step 9: Export the live MCP extension and an explicit Node hosting factory from the MCP entry**

```ts
// src/mcp/main.ts
export { createLiveMapMcpExtension } from './live-extension.js';
export {
  liveFeatureQueryDataSchema, liveMapListDataSchema,
  liveMapStyleDataSchema, liveMutationReceiptDataSchema, liveTransactionDataSchema,
} from './live-tools.js';
export {
  buildLiveMapMetadataUri, buildLiveMapStyleUri, liveMapResourceUriAdmission,
} from './live-resources.js';
export { createBridgeServer as createMapLibreStyleBridgeServer } from '../bridge/server.js';
export { LiveMapRegistry } from '../bridge/registry.js';
export type { BridgeServerHandle, BridgeServerOptions } from '../bridge/server.js';
export type { LiveMapMetadata } from '../bridge/registry.js';
```

Keep these Node-only exports under `maplibre-style-tools/mcp`, never under the browser `./bridge` entry. This lets embedders construct and own a registry/server and pass the registry to `createLiveMapMcpExtension`; the binary in Task 8 uses the same public factory.

- [ ] **Step 10: Run the full MCP test group and commit**

Run: `rtk pnpm test`

Expected: PASS for existing document-session tests and the new live-map tests.

```bash
rtk git add src/mcp/live-tools.ts src/mcp/live-resources.ts src/mcp/live-extension.ts src/mcp/live-extension.test.ts src/mcp/main.ts scripts/check-mcp-typegraph.mjs scripts/check-mcp-typegraph.test.mjs
rtk git commit -m "feat: expose live maps through MCP"
```

### Task 8: MCP binary bridge configuration and clean stderr connection handoff

**Files:**
- Create: `src/mcp/bridge-options.ts`
- Create: `src/mcp/bridge-options.test.ts`
- Modify: `src/mcp/main.ts`
- Modify: `src/mcp/stdio.ts`
- Modify: `src/mcp/http.ts`
- Modify: `src/mcp/main.test.ts`

**Interfaces:**
- Consumes: `createBridgeServer`, `createLiveMapMcpExtension`, `createMapLibreStyleMcpServer`, existing stdio/Streamable HTTP transport startup functions, and the MCP plan's single safe awaited `writeMcpStderrLine(stderr, line): Promise<void>` diagnostic writer.
- Produces: `parseBridgeOptions(argv)`, `formatBridgeConnectionInfo(handle, origins, mcpEndpoint)`, one strict discriminated startup record with `mcpTransport:'stdio'|'http'`, and binary flags `--bridge-host`, `--bridge-port`, `--bridge-token`, and repeatable `--bridge-origin`.

- [ ] **Step 1: Write failing option parsing tests with secure defaults**

```ts
test('uses loopback, ephemeral port, generated token, and no implicit Origins', () => {
  assert.deepEqual(parseBridgeOptions([]), {
    host: '127.0.0.1', port: 0, token: undefined, allowedOrigins: [],
  });
});

test('accepts repeatable exact Origins and rejects short tokens/bad ports', () => {
  assert.deepEqual(parseBridgeOptions([
    '--bridge-host', '127.0.0.1', '--bridge-port', '7788',
    '--bridge-token', token32, '--bridge-origin', 'http://127.0.0.1:5173',
    '--bridge-origin', 'https://maps.example',
  ]).allowedOrigins, ['http://127.0.0.1:5173', 'https://maps.example']);
  assert.throws(() => parseBridgeOptions(['--bridge-token', 'short']), /32 bytes/);
  assert.throws(() => parseBridgeOptions(['--bridge-port', '70000']), /port/);
  for (const origin of [
    'https://maps.example/restricted', 'https://user:password@maps.example',
    'https://maps.example?scope=all', 'data:text/plain,opaque', 'https://*.example',
  ]) assert.throws(() => parseBridgeOptions(['--bridge-origin', origin]), /origin/i);
});
```

- [ ] **Step 2: Compile to verify the option parser test is red**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json`

Expected: FAIL because `src/mcp/bridge-options.ts` does not exist.

- [ ] **Step 3: Implement option parsing and one-line JSON connection info**

```ts
export interface ParsedBridgeOptions {
  host: string;
  port: number;
  token?: string;
  allowedOrigins: string[];
}

export function formatBridgeConnectionInfo(
  server: Pick<BridgeServerHandle, 'url' | 'generatedToken'>,
  allowedOrigins: readonly string[],
  mcpEndpoint: { readonly mcpTransport: 'stdio' } |
    { readonly mcpTransport: 'http'; readonly mcpUrl: string },
): string {
  return JSON.stringify({
    event: 'bridge_listening',
    wsUrl: server.url,
    ...mcpEndpoint,
    ...(server.generatedToken ? { token: server.generatedToken } : {}),
    allowedOrigins,
  });
}
```

Parse bridge values with the shared `BridgeTokenSchema`, preserve repeated origin order while deduplicating exact values, and accept only absolute canonical HTTP(S) origins with root path and no credentials/query/fragment/wildcard/opaque form. A restricted path must never be normalized into whole-origin authority. Integrate this with one top-level `parseMcpProcessOptions(argv)` in `main.ts`: it owns stdio, Streamable HTTP, and bridge flags, then passes only the bridge subset to `parseBridgeOptions`. Tests mix `--stdio`/HTTP bearer flags with bridge flags and prove neither parser rejects or consumes the other's options. The formatter emits exactly one JSON line and no query string is ever appended to `wsUrl`. Stdio emits `mcpTransport:'stdio'` and no `mcpUrl`; HTTP emits `mcpTransport:'http'` plus the actual non-secret bound URL returned by its ephemeral listener. It includes `token` only for an omitted/generated token that the browser could not otherwise know; a caller-supplied token is never echoed to stderr or exposed by the bridge handle.

- [ ] **Step 4: Write failing spawned-process tests for stdio cleanliness and generated-token reporting**

```ts
test('prints bridge connection info once to stderr and keeps stdout valid MCP stdio', async (t) => {
  const child = spawnMcpBinary(['--bridge-port', '0', '--bridge-origin', 'http://127.0.0.1:5173']);
  t.after(() => stopChild(child));
  const info = JSON.parse(await readOneStderrLine(child));
  assert.equal(info.event, 'bridge_listening');
  assert.equal(info.mcpTransport, 'stdio');
  assert.equal('mcpUrl' in info, false);
  assert.equal(Buffer.from(info.token, 'base64url').byteLength, 32);
  assert.equal(new URL(info.wsUrl).search, '');
  const client = await connectStdioMcpClient(child);
  assert.ok((await client.listTools()).tools.some(({ name }) => name === 'map_list'));
  assert.deepEqual(await remainingStderrLines(child, 100), []);
});

test('does not echo a caller-supplied bridge token to stderr', async (t) => {
  const child = spawnMcpBinary([
    '--bridge-token', token32,
    '--bridge-origin', 'http://127.0.0.1:5173',
  ]);
  t.after(() => stopChild(child));
  const line = await readOneStderrLine(child);
  assert.equal(line.includes(token32), false);
  const info = JSON.parse(line);
  assert.equal('token' in info, false);
});

test('async stderr EPIPE cleans partial bridge, MCP, and transport startup', async () => {
  const stderr = asynchronouslyFailingStderr('EPIPE');
  const started = runDirectMcpProcessForTest({ stderr, bridgeToken: undefined });
  await assert.rejects(started, /EPIPE/);
  assert.equal(activeBridgeServerCount(), 0);
  assert.equal(activeMcpServerCount(), 0);
  assert.equal(activeTransportCount(), 0);
  assert.equal(capturedStdout().includes(lastGeneratedToken()), false);
  assert.equal(unhandledRejections.length, 0);
});
```

- [ ] **Step 5: Wire one registry into the bridge and MCP extension lifecycles**

In the direct-execution block of `main.ts`, handle `--help`/argument errors before opening sockets. For a real run, parse the unified process options, call `createBridgeServer` once, create the function extension `createLiveMapMcpExtension(bridge.registry)`, and pass that extension either to `runStdioMcp({startupDiagnosticLine:null,...})` or to the locked `startStreamableHttpMcp({...})`, which applies it to every per-transport `McpServer` sharing the HTTP application store. Only stdio owns `startupDiagnosticLine`; HTTP emits no generic ready diagnostic and must not receive that excess property. Suppressing the stdio generic ready line is mandatory: only after both the MCP transport/listener and WebSocket bridge have started successfully, emit the single first/only startup handoff with `await writeMcpStderrLine(stderr, formatBridgeConnectionInfo(...,{mcpTransport:'stdio'}))`. Apply the same one-handoff rule to HTTP only after its unchanged-options listener and the WS bridge both succeed, using the actual bound listener URL in `{mcpTransport:'http',mcpUrl:http.url}`. Do not call `stderr.write` directly or create a second drain/error implementation. Acquire bridge, MCP server, and transport under one incremental lifecycle controller before the awaited diagnostic. If that write rejects asynchronously (including `EPIPE`), close partial transport/server first and bridge second, preserve the primary write failure, consume cleanup failures, and leave no unhandled rejection or generated token on stdout/uncaught diagnostics. Use the same ordering on normal shutdown, SIGINT, SIGTERM, and every other startup failure. Never write logs or connection information to stdout in stdio mode; importing `src/mcp/main.ts` still performs none of this work. Subprocess and E2E tests assert there is no additional generic `ready` line before or after the JSON handoff.

- [ ] **Step 6: Add a Streamable HTTP coexistence test**

Start the existing bearer-protected loopback MCP HTTP transport plus the WS bridge on distinct ephemeral ports; assert the captured `startStreamableHttpMcp` options do not contain `startupDiagnosticLine`, verify MCP Host-header/bearer protections still pass, and parse the only handoff as `{event:'bridge_listening',mcpTransport:'http',mcpUrl:<actual bound HTTP URL>,wsUrl:<actual bound WS URL>}`. Construct the official SDK HTTP client from that `mcpUrl` plus the already-known bearer—never from a hard-coded port or side channel—connect an authenticated WebSocket browser stub through `wsUrl`, call `map_list`, and require the handoff only after both listeners are live. Shut both servers down without open handles.

- [ ] **Step 7: Run parser and binary integration tests**

Run: `rtk pnpm run build && rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/mcp/bridge-options.test.js .tmp/test-dist/mcp/main.test.js`

Expected: PASS for default/generated/configured tokens, supplied-token non-exposure, strict repeated Origins, stdio stdout isolation, exactly one awaited transport-discriminated stderr handoff with generic-ready suppression, stdio omission of `mcpUrl`, HTTP discovery from the actual bound `mcpUrl`/`wsUrl`, async EPIPE partial-startup cleanup, live tool registration, HTTP coexistence, and orderly shutdown.

- [ ] **Step 8: Commit binary bridge hosting**

```bash
rtk git add src/mcp/bridge-options.ts src/mcp/bridge-options.test.ts src/mcp/main.ts src/mcp/stdio.ts src/mcp/http.ts src/mcp/main.test.ts
rtk git commit -m "feat: host the browser bridge from the MCP binary"
```

### Task 9: Browser-safe public bridge entry and package export

**Files:**
- Create: `src/bridge/index.ts`
- Create: `src/bridge/index.test.ts`
- Create: `scripts/check-package.test.mjs`
- Create: `tsconfig.browser.json`
- Modify: `package.json`
- Modify: `scripts/check-package.mjs`

**Interfaces:**
- Consumes: browser client, protocol, capabilities, canonical JSON, resource-policy and runtime-image-loader public types, TypeScript's parser for emitted ESM import inspection, the foundation/layer checker's independent strict `core-consumer.ts`, `root-consumer.ts`, and maplibre-only `maplibre-consumer.ts`, plus the MCP plan's independent NodeNext `mcp-consumer.ts`, all generated inside the one real-tarball bare consumer.
- Produces: package subpath `maplibre-style-tools/bridge`, `typecheck:browser`, `scripts/check-package.mjs --check-browser-closure [entry]`, `/bridge` declaration coverage in the maplibre-only Bundler consumer, and live MCP declaration coverage in the NodeNext MCP consumer; it deliberately does not produce a Node server export or merge these isolated consumer programs.

- [ ] **Step 1: Write a failing public-surface test**

In `src/bridge/index.test.ts`:

```ts
test('bridge entry exports browser APIs and no Node server', async () => {
  const bridge = await import('./index.js');
  assert.equal(typeof bridge.connectMapLibreBridge, 'function');
  assert.equal(bridge.BRIDGE_PROTOCOL_VERSION, 1);
  assert.equal(typeof bridge.canonicalizeJson, 'function');
  assert.equal('createBridgeServer' in bridge, false);
  assert.equal('LiveMapRegistry' in bridge, false);
});
```

Create `scripts/check-package.test.mjs` as a real Node test. Each fixture lives under a unique repository-root `.tmp/check-package-closure-*` directory and is removed in `t.after()`/`finally`:

```js
test('browser closure checker recursively reports the clean visited closure', () => {
  const fixture = temporaryEsmClosure({
    'index.js': "export * from './nested.js';",
    'nested.js': "export * from './leaf.js';",
    'leaf.js': 'export const ok = true;',
  });
  const result = runClosureCheck(fixture.entry, '--json');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).files, ['index.js', 'leaf.js', 'nested.js']);
});

test('browser closure checker rejects every forbidden deep edge', () => {
  for (const nestedSource of [
    "import 'node:fs'; export const ok = true;",
    "import 'ws'; export const ok = true;",
    "export * from './missing.js';",
    "const name = './leaf.js'; export const load = () => import(name);",
  ]) {
    const fixture = temporaryEsmClosure({
      'index.js': "export * from './nested.js';",
      'nested.js': nestedSource,
      'leaf.js': 'export const ok = true;',
    });
    const result = runClosureCheck(fixture.entry);
    assert.notEqual(result.status, 0, `unexpected success for ${nestedSource}`);
  }
});
```

`temporaryEsmClosure` must use `mkdtempSync`, canonical absolute paths, `mkdirSync`/`writeFileSync`, and `rmSync(..., {recursive:true, force:true})`; `runClosureCheck` must use `spawnSync(process.execPath, ['scripts/check-package.mjs', '--check-browser-closure', entry, ...args], {cwd: repoRoot, encoding:'utf8'})`. Do not mock the checker or its filesystem traversal.

- [ ] **Step 2: Compile to verify the public entry test is red**

Run: `rtk pnpm run pretest && rtk pnpm exec tsc -p tsconfig.test.json`

Run: `rtk node --test scripts/check-package.test.mjs`

Expected: both commands FAIL: `src/bridge/index.ts` does not exist, and the existing package checker does not yet implement recursive closure inspection/JSON reporting.

- [ ] **Step 3: Export only browser-safe APIs**

```ts
export { connectMapLibreBridge } from './client.js';
export type { ConnectMapLibreBridgeOptions, MapLibreBridgeConnection, MapLibreBridgeStatus } from './client.js';
export { BRIDGE_PROTOCOL_VERSION, MAX_BRIDGE_MESSAGE_BYTES } from './protocol.js';
export type { BridgeCapability, BridgeCommand, BridgeFrame, MapSnapshot } from './protocol.js';
export { canonicalizeJson } from '../core/index.js';
export { sha256CanonicalJson } from '../adapters/maplibre/style-hash.js';
export type { ResourcePolicy } from './resource-policy.js';
export type { RuntimeImageLoader } from '../adapters/maplibre/index.js';
```

Do not export `server.ts`, `registry.ts`, `browser-runtime.ts`, `ws`, or Node-only option types. `client.ts` must use `import type { Map } from 'maplibre-gl'`, so importing the entry has no MapLibre renderer side effect.

- [ ] **Step 4: Add the `./bridge` conditional package export**

```json
"./bridge": {
  "types": "./dist/bridge/index.d.ts",
  "import": "./dist/bridge/index.js",
  "default": "./dist/bridge/index.js"
}
```

- [ ] **Step 5: Add and run a browser-only ambient typecheck**

Create `tsconfig.browser.json` extending the root config with `noEmit: true`, `lib: ["ES2023", "DOM", "DOM.Iterable"]`, `types: []`, and `include: ["src/bridge/index.ts", "src/bridge/client.ts", "src/bridge/protocol.ts", "src/bridge/codec.ts", "src/bridge/capabilities.ts", "src/bridge/outbound.ts", "src/bridge/resource-policy.ts", "src/bridge/browser-runtime.ts", "src/adapters/maplibre/**/*.ts"]`; exclude every `*.test.ts` and Node-only `src/bridge/server.ts`/`registry.ts`. Add `typecheck:browser` and include it in the root `typecheck` script after `typecheck:core`.

Run: `rtk pnpm run typecheck:browser`

Expected: PASS without Node ambient types. This catches typed direct Node usage; the recursive emitted-closure checker below independently catches deep/bare imports even if a bundler could shim or tree-shake them.

- [ ] **Step 6: Build and inspect the browser import graph**

Run: `rtk node --test scripts/check-package.test.mjs && rtk pnpm run build && rtk node --input-type=module --eval "const b=await import('./dist/bridge/index.js'); if(typeof b.connectMapLibreBridge!=='function'||'createBridgeServer' in b) process.exit(1)" && rtk node scripts/check-package.mjs --check-browser-closure dist/bridge/index.js`

Expected: the independent checker self-test passes first, including its clean visited-file assertion and all four deep-negative fixtures. The production check then exits 0 after recursively visiting the actual emitted relative-import/re-export/dynamic-literal closure from `dist/bridge/index.js`, including codec, capabilities, outbound, resource policy, browser runtime, core, and MapLibre adapter modules. The checker rejects `node:` specifiers, bare Node builtins, `ws`/`ws/*`, unresolved relative imports, and non-literal dynamic imports; it asserts the required bridge modules plus at least one emitted `dist/adapters/maplibre/` module were reached, so a shallow or accidentally empty scan cannot pass.

- [ ] **Step 7: Extend the real packed-consumer boundary**

Modify `scripts/check-package.mjs` without weakening its existing root/core/maplibre/ai/CLI/MCP assertions. Implement the recursive closure walk with the TypeScript AST over emitted JavaScript import/export declarations and literal dynamic imports, resolving relative specifiers canonically inside the package root and tracking a visited set. The optional entry argument supports the deep fixtures; `--json` prints a deterministic repository-or-fixture-relative sorted visited-file list, and the default entry is `dist/bridge/index.js`. Only an explicit fixture entry may skip the production required-module set; it must still enforce every forbidden/unresolved/dynamic edge. Require the production/default invocation to reach the required bridge modules plus an adapter module. Require the pack list to contain both `dist/bridge/index.js` and `dist/bridge/index.d.ts`; create a real `.tgz`, install that artifact into a temporary bare consumer, run the same closure assertion against the installed `dist/bridge/index.js`, and import `maplibre-style-tools/bridge` by package name. Assert `connectMapLibreBridge`, `BRIDGE_PROTOCOL_VERSION`, and canonical/hash exports load, while Node-only `createBridgeServer`/`LiveMapRegistry` are absent. Clean the tarball/consumer in `finally`.

Keep every packed declaration smoke isolated. Extend only the layer-owned `maplibre-consumer.ts` (ESNext/Bundler, DOM libs, `types:[]`, `skipLibCheck:false`) with `/bridge` browser values/types: `connectMapLibreBridge`, `BRIDGE_PROTOCOL_VERSION`, `canonicalizeJson`, `sha256CanonicalJson`, `ConnectMapLibreBridgeOptions`, `MapLibreBridgeConnection`, `MapLibreBridgeStatus`, `BridgeCommand`, and `ResourcePolicy`. Construct representative options/status/commands and retain its negative `Buffer`/`NodeJS.Process` probes, proving `/bridge` does not import server/Node declarations. Do **not** put `/bridge` in `root-consumer.ts` or a NodeNext program merely to make it compile.

Separately extend only the MCP-owned `mcp-consumer.ts` (strict NodeNext, `skipLibCheck:false`) with `createLiveMapMcpExtension`, `liveMapListDataSchema`, `liveMapStyleDataSchema`, `liveTransactionDataSchema`, `liveMutationReceiptDataSchema`, `liveFeatureQueryDataSchema`, `buildLiveMapMetadataUri`, and `buildLiveMapStyleUri` from `maplibre-style-tools/mcp`; instantiate/narrow each schema and assert the two builder literals. It must not import browser `/bridge`, `/maplibre`, DOM, or root/AI types. Invoke the repository-pinned compiler independently for `tsconfig.core-consumer.json`, `tsconfig.maplibre-consumer.json`, `tsconfig.root-consumer.json`, and `tsconfig.mcp-consumer.json`; no single config or ambient declaration leak may stand in for another.

Run: `rtk pnpm run build && rtk pnpm run check:package`

Expected: PASS through the installed tarball's export map, not a direct working-tree `dist` import; the four isolated strict declaration consumers all compile, `/bridge` remains browser-safe in the maplibre-only Bundler program, and the NodeNext MCP consumer resolves the live extension, fixed response schemas, and marked URI builders.

- [ ] **Step 8: Run bridge tests and commit**

Run: `rtk pnpm test`

Expected: PASS for all protocol, policy, registry, server, runtime, client, and MCP tests.

```bash
rtk git add package.json tsconfig.browser.json src/bridge/index.ts src/bridge/index.test.ts scripts/check-package.mjs scripts/check-package.test.mjs
rtk git commit -m "feat: export the browser bridge client"
```

### Task 10: Standalone Vite browser-bridge example

**Files:**
- Create: `examples/browser-bridge/index.html`
- Create: `examples/browser-bridge/vite.config.ts`
- Create: `examples/browser-bridge/tsconfig.json`
- Create: `examples/browser-bridge/tsconfig.test.json`
- Create: `examples/browser-bridge/src/main.ts`
- Create: `examples/browser-bridge/src/connection-form.ts`
- Create: `examples/browser-bridge/src/demo-style.ts`
- Create: `examples/browser-bridge/src/style.css`
- Create: `examples/browser-bridge/src/vite-env.d.ts`
- Create: `examples/browser-bridge/src/main.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `connectMapLibreBridge` from `maplibre-style-tools/bridge`, `applyTransactionToMap` from `maplibre-style-tools/maplibre`, structured operations from `maplibre-style-tools/core`, and MapLibre GL JS 6.
- Produces: a standalone Vite app with an explicit connection form, status fields, three local demonstration actions, and root scripts `example:dev`/`example:build`.

- [ ] **Step 1: Add the Vite development dependency and scripts**

Run: `rtk pnpm add -D vite@^8.2.1`

Expected: Vite 8.2.x is locked as a dev dependency.

Add these scripts:

```json
"example:typecheck": "tsc -p examples/browser-bridge/tsconfig.json",
"pretest:example:bridge": "node --input-type=module --eval \"import { rmSync } from 'node:fs'; rmSync('.tmp/example-test-dist', { recursive: true, force: true });\"",
"test:example:bridge": "pnpm run build && tsc -p examples/browser-bridge/tsconfig.test.json && node --test .tmp/example-test-dist/src/main.test.js",
"build:example:bridge": "pnpm run example:typecheck && vite build --config examples/browser-bridge/vite.config.ts",
"example:dev": "pnpm run build && pnpm run example:typecheck && vite --config examples/browser-bridge/vite.config.ts",
"example:build": "pnpm run build && pnpm run build:example:bridge"
```

- [ ] **Step 2: Write a failing example contract test**

```ts
test('example Style is self-contained and its demo operations are structured', () => {
  assert.equal(DEMO_STYLE.version, 8);
  assert.equal(DEMO_STYLE.glyphs, undefined);
  assert.equal(DEMO_STYLE.sprite, undefined);
  assert.equal(DEMO_STYLE.sources.places.type, 'geojson');
  assert.equal(typeof DEMO_STYLE.sources.places.data, 'object');
  assert.deepEqual(filterDemoTransaction.operations[0].op, 'setLayerFilter');
  assert.deepEqual(duplicateDemoTransaction.operations[0].op, 'duplicateLayer');
  assert.deepEqual(addGeoJsonDemoTransaction.operations[0].op, 'addGeoJsonLayer');
});

test('connection form exposes the stable E2E selector/default/submit contract', () => {
  const ui = renderExampleConnectionForm(fakeDocument(), connectSpy);
  assert.equal(ui.getByTestId('bridge-map-id').value, 'demo-map');
  assert.equal(ui.getByTestId('bridge-url').tagName, 'INPUT');
  assert.equal(ui.getByTestId('bridge-token').getAttribute('type'), 'password');
  ui.getByTestId('bridge-url').value = 'ws://127.0.0.1:7788';
  ui.getByTestId('bridge-token').value = token32;
  ui.getByTestId('bridge-connect').click();
  assert.deepEqual(connectSpy.calls[0]?.options, {
    mapId: 'demo-map', url: 'ws://127.0.0.1:7788', token: token32,
    capabilities: ['style.read', 'style.write', 'features.query', 'runtime.state'],
    allowedResourceOrigins: [],
  });
});
```

- [ ] **Step 3: Compile to verify the example test is red**

Run: `rtk pnpm exec tsc -p examples/browser-bridge/tsconfig.test.json`

Expected: FAIL because `examples/browser-bridge/tsconfig.test.json` and `demo-style.ts` do not exist.

- [ ] **Step 4: Add dedicated example typecheck/test configs and define local data**

Create `tsconfig.json` with `noEmit`, DOM/ES2023 libs, and only example source files; create `tsconfig.test.json` with `rootDir: "."`, `outDir: "../../.tmp/example-test-dist"`, and only `connection-form.ts`, `demo-style.ts`, and `main.test.ts`. Keep DOM construction/submit-option mapping in side-effect-free `connection-form.ts`; `main.ts` imports it and owns MapLibre/CSS/bootstrap, so the Node contract test never imports a CSS module or creates a Map. Both configs resolve package self-imports after `pnpm run build`. Create a Style version 8 document with a light neutral background, one inline RFC 7946 FeatureCollection named `places`, and circle/symbol-free layers that require no glyphs. Define three exported transactions: compose `['==', ['get', 'category'], 'park']` with `and`; duplicate the base circle layer as `places-highlight` with paint overrides; atomically add a second inline GeoJSON source/layer. Do not include root `glyphs`, `sprite`, `imports`, remote source `url`, source `tiles`, or string-valued GeoJSON `data`.

- [ ] **Step 5: Use MapLibre 6's documented default worker lifecycle**

```ts
import { Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const map = new Map({
  container: 'map',
  style: DEMO_STYLE,
  center: [0, 0],
  zoom: 1,
  attributionControl: false,
});
```

The standard ESM build manages and lazily initializes its worker itself; do not call `setWorkerUrl` and do not invent a distribution path such as `maplibre-gl-worker.mjs`. (A host enforcing strict CSP would deliberately use MapLibre's separate CSP build/worker contract, which is outside this self-contained example.) Put the normal Vite client reference in `vite-env.d.ts`. Configure Vite root to `examples/browser-bridge`, fixed development port 5173, and preview port 4173. Import the package through its real self-referencing exports with no source aliases; `example:dev`/`example:build` build `dist` first, so the example also verifies the published export map. Build output stays at `examples/browser-bridge/dist` and is not part of package `files`.

- [ ] **Step 6: Build the explicit connection and status UI**

The form contains map ID (default `demo-map`), WebSocket URL, and password-type token inputs. Lock the exact selectors `data-testid="bridge-map-id"`, `bridge-url`, `bridge-token`, and `bridge-connect`; the status surface uses `bridge-status`, `map-id`, `revision`, `style-hash`, and `last-operation`. `main.test.ts` verifies defaults and the submit wiring, not only demo transaction constants. Invoke `connectMapLibreBridge` only after the user submits and grant exactly `style.read`, `style.write`, `features.query`, and `runtime.state`; `allowedResourceOrigins` stays empty. Never place the token in page URL, local/session storage, status text, exceptions, or logs.

- [ ] **Step 7: Wire the three local demonstration buttons**

Each button calls `applyTransactionToMap(map, transaction, { timeoutMs: 10_000 })`, waits for `ok`, then reports filter composition, duplicated layer, or GeoJSON source/layer creation. Disable each action after it succeeds. These application-initiated edits intentionally exercise bridge external-change detection; they must not call private bridge runtime methods.

- [ ] **Step 8: Add a minimal responsive map layout**

Provide one full-height map pane and one 320px control pane with keyboard-labelled fields/buttons, readable status text, and a narrow-screen stacked layout. Do not add fonts, icon libraries, analytics, CDN assets, or image URLs.

- [ ] **Step 9: Run the example unit contract and production build**

Run: `rtk pnpm run example:typecheck && rtk pnpm run test:example:bridge && rtk pnpm run example:build`

Expected: PASS; the application `tsconfig.json` checks `main.ts` (Vite transpilation alone is not a typecheck), the compiled contract test runs, and Vite bundles the application and MapLibre locally with its default worker lifecycle and no unresolved subpath imports or remote worker request.

- [ ] **Step 10: Inspect the built HTML for remote assets**

Run: `rtk node --input-type=module --eval "import { spawnSync } from 'node:child_process'; const result=spawnSync('rg',['-n',\"(?:src|href)=['\\\"]https?://\",'examples/browser-bridge/dist/index.html'],{stdio:'inherit'}); if(result.status!==1) process.exit(result.status===0?1:(result.status??2));"`

Expected: wrapper exits 0 only when `rg.status === 1`, proving there is no remote script, stylesheet, font, or image reference in built HTML. A match or search error fails. Source map contents are disabled in the example Vite production config. Runtime request enforcement remains covered by Task 11 because bundled MapLibre code may legitimately contain inert URL strings.

- [ ] **Step 11: Commit the standalone example**

```bash
rtk git add package.json pnpm-lock.yaml examples/browser-bridge/index.html examples/browser-bridge/vite.config.ts examples/browser-bridge/tsconfig.json examples/browser-bridge/tsconfig.test.json examples/browser-bridge/src/main.ts examples/browser-bridge/src/connection-form.ts examples/browser-bridge/src/demo-style.ts examples/browser-bridge/src/style.css examples/browser-bridge/src/vite-env.d.ts examples/browser-bridge/src/main.test.ts
rtk git commit -m "feat: add standalone browser bridge example"
```

### Task 11: Playwright MCP-to-WebSocket-to-real-Map end-to-end test

**Files:**
- Create: `examples/browser-bridge/playwright.config.ts`
- Create: `examples/browser-bridge/tsconfig.e2e.json`
- Create: `examples/browser-bridge/e2e/live-map.spec.ts`
- Create: `examples/browser-bridge/e2e/mcp-harness.ts`
- Reuse unchanged: `src/mcp/output.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: built `dist/mcp/main.js`, official MCP SDK `Client`/`StdioClientTransport`/`StreamableHTTPClientTransport`, public `parseOfficialCallToolResult`, `parseMcpToolEnvelope`, `liveMapStyleDataSchema`, `liveTransactionDataSchema`, `liveFeatureQueryDataSchema`, Vite preview, the example's stable `data-testid` UI, and Playwright Chromium with WebGL2.
- Produces: root script `test:e2e:bridge`, an end-to-end proof that a structured MCP transaction changes a real MapLibre 6 map and advances its revision, an HTTP-mode proof that the actual MCP endpoint is discovered only from the combined startup record, and a real-browser proof that post-connect `<base>` mutation cannot redirect a newly introduced relative Style resource.

- [ ] **Step 1: Add Playwright and the E2E script**

Run: `rtk pnpm add -D @playwright/test@^1.62.1`

Expected: Playwright 1.62.x is locked as a dev dependency.

Add:

```json
"pretest:e2e:bridge": "node --input-type=module --eval \"import { rmSync } from 'node:fs'; for (const path of ['.tmp/playwright-output/browser-bridge', '.tmp/playwright-report/browser-bridge']) rmSync(path, { recursive: true, force: true });\"",
"typecheck:e2e:bridge": "tsc -p examples/browser-bridge/tsconfig.e2e.json",
"test:e2e:bridge": "pnpm run build && pnpm run build:example:bridge && pnpm run typecheck:e2e:bridge && playwright test --config examples/browser-bridge/playwright.config.ts"
```

- [ ] **Step 2: Write the failing real-map E2E scenario**

```ts
import { expect, parseHarnessCallResult, test } from './mcp-harness.js';

test('MCP mutates a real MapLibre map through the browser bridge', async ({ page, harness }) => {
  test.info().attach('bridge-url', { body: harness.connection.url, contentType: 'text/plain' });
  await page.goto('/');
  await page.getByTestId('bridge-url').fill(harness.connection.url);
  await page.getByTestId('bridge-token').fill(harness.connection.token);
  await page.getByTestId('bridge-map-id').fill('demo-map');
  await page.getByTestId('bridge-connect').click();
  await expect(page.getByTestId('bridge-status')).toHaveText('connected');

  const beforeEnvelope = await harness.call('map_get_style', { mapId: 'demo-map' });
  expect(beforeEnvelope.ok).toBe(true);
  if (!beforeEnvelope.ok) throw new Error(beforeEnvelope.error.code);
  const before = liveMapStyleDataSchema.parse(beforeEnvelope.data);
  expect(before.revision).toBe(0);
  const appliedEnvelope = await harness.call('map_apply_transaction', {
    mapId: 'demo-map',
    expectedRevision: before.revision,
    expectedStyleHash: before.styleHash,
    transaction: completeDemoTransaction,
  });
  expect(appliedEnvelope.ok).toBe(true);
  if (!appliedEnvelope.ok) throw new Error(appliedEnvelope.error.code);
  const applied = liveTransactionDataSchema.parse(appliedEnvelope.data);
  expect(applied.revision).toBe(1);
  const afterEnvelope = await harness.call('map_get_style', { mapId: 'demo-map' });
  expect(afterEnvelope.ok).toBe(true);
  if (!afterEnvelope.ok) throw new Error(afterEnvelope.error.code);
  const after = liveMapStyleDataSchema.parse(afterEnvelope.data);
  expect(after.style.layers.map((layer) => layer.id)).toContain('places-copy');
  expect(after.style.layers.map((layer) => layer.id)).toContain('events');
});

test('a later base mutation cannot redirect a new relative Style resource', async ({ page, harness }) => {
  const probeRequests: string[] = [];
  const capturedBaseRequest = 'http://127.0.0.1:4173/relative-probe.geojson';
  const mutatedBaseRequest = 'http://127.0.0.1:4174/evil/relative-probe.geojson';
  page.on('request', (request) => {
    if (request.url().includes('relative-probe.geojson')) probeRequests.push(request.url());
  });
  await page.goto('/');
  await page.getByTestId('bridge-url').fill(harness.connection.url);
  await page.getByTestId('bridge-token').fill(harness.connection.token);
  await page.getByTestId('bridge-map-id').fill('demo-map');
  await page.getByTestId('bridge-connect').click();
  await expect(page.getByTestId('bridge-status')).toHaveText('connected');
  const beforeEnvelope = await harness.call('map_get_style', { mapId: 'demo-map' });
  if (!beforeEnvelope.ok) throw new Error(beforeEnvelope.error.code);
  const before = liveMapStyleDataSchema.parse(beforeEnvelope.data);

  await page.evaluate(() => {
    const base = document.createElement('base');
    base.href = 'http://127.0.0.1:4174/evil/';
    document.head.prepend(base);
  });
  const rejected = await harness.call('map_apply_transaction', {
    mapId: 'demo-map', expectedRevision: before.revision, expectedStyleHash: before.styleHash,
    transaction: { operations: [{
      op: 'addGeoJsonLayer', sourceId: 'relative-probe', layerId: 'relative-probe',
      data: './relative-probe.geojson', type: 'circle',
    }] },
  });
  expect(rejected.ok).toBe(false);
  if (rejected.ok) throw new Error('expected relative Style rejection');
  expect(rejected.error.code).toBe('INVALID_INPUT');
  expect(rejected.error.details).toEqual({ reason: 'relative-style-url' });

  const afterEnvelope = await harness.call('map_get_style', { mapId: 'demo-map' });
  if (!afterEnvelope.ok) throw new Error(afterEnvelope.error.code);
  const after = liveMapStyleDataSchema.parse(afterEnvelope.data);
  expect(after.revision).toBe(before.revision);
  expect('relative-probe' in after.style.sources).toBe(false);
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
  expect(probeRequests).not.toContain(capturedBaseRequest);
  expect(probeRequests).not.toContain(mutatedBaseRequest);
  expect(probeRequests).toEqual([]);
});

test('a partial harness startup is cleaned before a successful retry', async ({ harnessFactory }) => {
  await expect(harnessFactory.start({ failAfterSpawnForTest: true })).rejects.toThrow(/injected setup failure/);
  expect(harnessFactory.activeChildCount()).toBe(0);
  const retry = await harnessFactory.start();
  await retry.close();
  expect(harnessFactory.activeChildCount()).toBe(0);
});

test('the committed preview launcher has no rtk runtime dependency', async () => {
  const result = await spawnPreviewHelpWithOnlyNodeAndPnpmOnPath();
  expect(result.exitCode).toBe(0);
  expect(result.pathContainsRtk).toBe(false);
});

test('the harness rejects an SDK compatibility wrapper before envelope access', () => {
  expect(() => parseHarnessCallResult({
    toolResult: { structuredContent: { ok: true, data: {} } },
  })).toThrow();
});

test('HTTP MCP and WebSocket endpoints come only from the combined startup handoff', async ({ page, httpHarness }) => {
  expect(httpHarness.handoff.mcpTransport).toBe('http');
  expect(httpHarness.handoff.mcpUrl).toBe(httpHarness.transportEndpoint);
  expect(httpHarness.connection.url).toBe(httpHarness.handoff.wsUrl);
  expect(httpHarness.usedHardCodedPortOrSideChannel).toBe(false);
  await page.goto('/');
  await page.getByTestId('bridge-url').fill(httpHarness.handoff.wsUrl);
  await page.getByTestId('bridge-token').fill(httpHarness.connection.token);
  await page.getByTestId('bridge-map-id').fill('demo-map');
  await page.getByTestId('bridge-connect').click();
  await expect(page.getByTestId('bridge-status')).toHaveText('connected');
  const listed = await httpHarness.call('map_list', {});
  expect(listed.ok).toBe(true);
});
```

Define the fixture with the exact operation fields exported by core:

```ts
const completeDemoTransaction: StyleTransaction = {
  operations: [
    {
      op: 'setLayerFilter', layerId: 'places', mode: 'and',
      filter: ['==', ['get', 'category'], 'park'],
    },
    {
      op: 'duplicateLayer', layerId: 'places', newLayerId: 'places-copy',
      overrides: { paint: { 'circle-color': '#ef4444', 'circle-radius': 9 } },
    },
    {
      op: 'addGeoJsonLayer', sourceId: 'events', layerId: 'events', type: 'circle',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature', geometry: { type: 'Point', coordinates: [10, 10] },
          properties: { category: 'festival' },
        }],
      },
      paint: { 'circle-color': '#2563eb', 'circle-radius': 7 },
    },
  ],
};
```

The inline data has one point feature and no URL fields.

- [ ] **Step 3: Run Playwright to verify the E2E test is red**

Run: `rtk pnpm run test:e2e:bridge`

Expected: FAIL because the harness/config is not implemented or the bridge does not yet connect under Chromium.

- [ ] **Step 4: Implement the MCP stdio harness and stderr handoff parser**

Import `parseOfficialCallToolResult` and `parseMcpToolEnvelope` from the built public `maplibre-style-tools/mcp` entry. Export the pure harness boundary below and make `call(name,args)` use it for every tool result:

```ts
export const parseHarnessCallResult = (value: unknown) => {
  const official = parseOfficialCallToolResult(value);
  return parseMcpToolEnvelope(official.structuredContent);
};

async function call(name: string, args: Record<string, unknown>) {
  return parseHarnessCallResult(await client.callTool({ name, arguments: args }));
}
```

Parse the one startup line through a strict discriminated `BridgeStartupHandoffSchema`: both branches require `{event:'bridge_listening',mcpTransport,wsUrl,allowedOrigins,token?}`; stdio rejects any `mcpUrl`, while HTTP requires one canonical loopback `mcpUrl`. The public harness maps `connection.url = handoff.wsUrl`; no test reads a legacy `url` field.

Construct `StdioClientTransport` for `process.execPath` with `dist/mcp/main.js`, `--bridge-host 127.0.0.1`, `--bridge-port 0`, and `--bridge-origin http://127.0.0.1:4173`, with stderr piped. The constructor does not spawn. Immediately attach the line parser/tracker to the transport's public stderr PassThrough, then call `const connectPromise = client.connect(transport)` and attach rejection handling in the same tick; SDK 1.30 `Client.connect` starts the transport, so never call `transport.start()` manually. Concurrently await `connectPromise` and exactly one strict stdio `bridge_listening` record under the same 10-second startup gate—never wait for stderr before initiating connect, or the child does not exist. If either side fails, consume the other promise and close every partially acquired client/transport/child. A startup-order test records `stderr-listener → client.connect → bridge-line/connect-settlement`, asserts zero manual `start` calls, and covers an early handoff line. The compatibility-wrapper rejection test locks the outer parser, and raw `structuredContent` never crosses the helper boundary. `close()` is idempotent: it closes the client/transport and waits for the process to exit, escalating from SIGTERM to SIGKILL only after 5 seconds.

The `httpHarness` fixture separately spawns the same built binary with `--http`, a known 32-byte bearer, loopback/ephemeral defaults, and the same bridge origin/options. Attach its stderr parser immediately, await the strict HTTP handoff, and construct `StreamableHTTPClientTransport` exclusively from `new URL(handoff.mcpUrl)` plus that known bearer; the fixture accepts no endpoint/port return value from the spawn helper and searches no logs or socket table. It uses `handoff.wsUrl`/generated token for the browser form. A real official-client `map_list` after browser registration proves both discovered endpoints belong to the same composite process. Cleanup tracks this direct child, HTTP client/transport, and browser bridge under the same failure-safe fixture gate.

In `mcp-harness.ts`, import base Playwright as `base`, create a tracker that records the child/transport immediately after each partial allocation (before waiting for stderr or SDK initialization), and export `expect` plus a custom `test = base.extend<{harness:McpHarness;httpHarness:HttpMcpHarness;harnessFactory:McpHarnessFactory}>({...})`. The lazy stdio/HTTP fixtures install tracker cleanup before calling start, then use `try/finally` around `await use(harness)`; the lazy factory fixture does the same for test-controlled failed startup/retry. `live-map.spec.ts` must import `test`/`expect` from this module and receive harnesses as fixture arguments—never call `startMcpHarness()` directly. The injected-failure test throws after child spawn and proves tracker count returns to zero before a second successful start. This covers navigation, authentication, assertions, HTTP endpoint discovery, and setup failure; no test owns cleanup only at its successful tail.

- [ ] **Step 5: Configure a local Vite preview and WebGL2 Chromium**

Create `tsconfig.e2e.json` with `noEmit:true`, ES2023/DOM libs, Node plus Playwright types, and includes limited to `playwright.config.ts` and `e2e/**/*.ts`. It resolves package self-imports through the built export map and is the required compile gate invoked by `test:e2e:bridge`; do not rely on Playwright/esbuild transpilation as type checking.

```ts
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  outputDir: path.join(repoRoot, '.tmp/playwright-output/browser-bridge'),
  reporter: [
    ['line'],
    ['html', { outputFolder: path.join(repoRoot, '.tmp/playwright-report/browser-bridge'), open: 'never' }],
  ],
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'pnpm exec vite preview --config examples/browser-bridge/vite.config.ts --host 127.0.0.1 --port 4173',
    cwd: repoRoot,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
```

Resolve the repository root from `import.meta.url` and use absolute root `.tmp` paths for both artifact settings; do not create default `test-results/`, `playwright-report/`, or root HTML report files. The `pretest:e2e:bridge` lifecycle hook removes both dedicated directories before every run, including the second consecutive run in Step 8. The committed `webServer.command` deliberately uses project `pnpm` directly—`rtk` remains only the outer plan-command wrapper. Add a spawn smoke that creates a temporary PATH containing only resolved `node` and `pnpm` launchers (and explicitly no `rtk`), runs `pnpm exec vite preview --help` from `repoRoot`, and requires exit 0. Collect page errors, console errors, failed requests, and all HTTP(S) request origins. Fail the test if a request leaves `127.0.0.1:4173` or if WebGL2 is unavailable. WebSocket traffic to the loopback bridge is expected.

- [ ] **Step 6: Add live query and external-change assertions**

After the MCP transaction, call `map_query_source_features` for the inline `events` source with `limit: 10` and property allowlist `['category']`; require the harness-parsed envelope's `ok:true`, then parse `data` with `liveFeatureQueryDataSchema` before asserting one feature, `returned <= 10`, and `serializedBytes <= 1 MiB`. Then click the example's filter demo button and poll `map_get_style` with a bounded 10-second expect loop; every poll crosses `parseOfficialCallToolResult` and `parseMcpToolEnvelope` inside the harness before the spec parses `liveMapStyleDataSchema`, until revision is 2 and the canonical hash differs. This is the public observable signal for the `externalStyleChange`; the test must not await an internal event that the harness does not expose. Confirm MCP was not asked to retry either mutation. Keep the request observer installed for the `<base>`-mutation case and prove both the original-base and mutated-base absolute probe URLs have zero requests; together with Task 5's zero `applyPreparedStyleToMap`/`Map#setStyle` assertions, this locks rejection before any Map/network side effect.

- [ ] **Step 7: Install Chromium if the local Playwright cache is absent**

Run: `rtk pnpm exec playwright install chromium`

Expected: Chromium required by Playwright 1.62.x is available. This changes only the local Playwright browser cache, not repository files.

- [ ] **Step 8: Run the E2E test twice to catch leaked ports/listeners**

Run: `rtk pnpm run test:e2e:bridge && rtk pnpm run test:e2e:bridge`

Expected: both self-contained runs PASS from a clean checkout; each invocation rebuilds the root package and example before typechecking/running Playwright, so deleting or poisoning either prior `dist` tree cannot make the test consume stale output. The lifecycle hook clears the dedicated root `.tmp` Playwright output/report directories before each run, each run gets fresh bridge/MCP ports and token, discovers the HTTP MCP URL and WebSocket URL only from the strict combined handoff, has no external requests, parses every official tool result before structured-content access, performs the MCP mutation/query, observes the external application mutation, rejects the post-connect `<base>` relative-resource probe with unchanged revision and zero request to either base, and exits without an open-handle warning. No `test-results/` or `playwright-report/` appears at repository root.

- [ ] **Step 9: Commit the real-browser acceptance test**

```bash
rtk git add package.json pnpm-lock.yaml examples/browser-bridge/playwright.config.ts examples/browser-bridge/tsconfig.e2e.json examples/browser-bridge/e2e/live-map.spec.ts examples/browser-bridge/e2e/mcp-harness.ts
rtk git commit -m "test: cover MCP browser bridge end to end"
```

### Task 12: Documentation, final smoke tests, and package boundary verification

**Files:**
- Modify: `README.md`
- Modify: `scripts/check-package.mjs`

**Interfaces:**
- Consumes: all bridge, MCP, CLI, core, adapter, and example entry points.
- Produces: user-facing bridge setup/security documentation and a verified npm tarball that contains package `dist` only.

- [ ] **Step 1: Write the README bridge client example**

```ts
import { connectMapLibreBridge } from 'maplibre-style-tools/bridge';

const connection = connectMapLibreBridge(map, {
  mapId: 'demo-map',
  url: 'ws://127.0.0.1:7788',
  token: processSuppliedToken,
  capabilities: ['style.read', 'style.write', 'features.query', 'runtime.state'],
  allowedResourceOrigins: [],
});

await connection.whenReady();
```

Explain that the token belongs in the first WebSocket frame, never in a URL; the example's token input is explicit and ephemeral; `src/bridge/index.ts` is browser-only; and the Node bridge is hosted by `maplibre-style-mcp`. Document relative-resource semantics explicitly: unchanged baseline Style references may remain, but every newly introduced or changed relative Style URL is rejected before `Map#setStyle` regardless of `resourceBaseUrl`, the current `document.baseURI`, or later `<base>` mutation. The captured `resourceBaseUrl` is only for the separate runtime-image API, which resolves a relative input once and passes the exact authorized absolute URL to its loader. Workers therefore need an explicit runtime-image base but cannot use one to enable relative Style resources.

- [ ] **Step 2: Document binary flags, live resource URI builders, revision/hash usage, and stable errors**

Include one stdio launch command with `--bridge-host 127.0.0.1 --bridge-port 7788 --bridge-origin http://127.0.0.1:5173`, the one-line stderr connection record, and an MCP `map_apply_transaction` argument example containing both current revision and hash. Document the strict startup record: it always contains `event:'bridge_listening'`, `mcpTransport`, and `wsUrl`; stdio has no `mcpUrl`, while HTTP includes the actual bound `mcpUrl` used for discovery. Document fixed collection `maplibre-style://maps`, exact marked templates `maplibre-style://maps/~{mapId}` and `maplibre-style://maps/~{mapId}/style`, and public `buildLiveMapMetadataUri`/`buildLiveMapStyleUri`. Show callers passing a semantic map ID such as `a.b`, never a percent-encoded value; the builder adds the same-segment `~` marker and encodes once. Explain that the transport validates the original raw `resources/read` URI before SDK `new URL`, rejects normalization-changing dot prefixes, literal/encoded dot segments, encoded-unreserved aliases, double encoding, and legacy unmarked routes with zero resolver work, and only then lets the callback decode once. Document `REVISION_CONFLICT`, `BRIDGE_DISCONNECTED`, `CAPABILITY_DENIED`, `MAP_NOT_READY`, and `TIMEOUT`, and state that callers must read/resync and deliberately retry conflicts themselves.

```ts
import { buildLiveMapMetadataUri, buildLiveMapStyleUri } from 'maplibre-style-tools/mcp';

await client.readResource({ uri: buildLiveMapMetadataUri('a.b') });
await client.readResource({ uri: buildLiveMapStyleUri('a.b') });
```

- [ ] **Step 3: Document the complete resource policy and hard limits**

List root glyph/sprite/import fields; source `url`/`tiles`/`urls`; GeoJSON string `data`; image/video source URLs; runtime image URLs; `data:`; and custom protocols. State baseline path-plus-value retention, unconditional rejection of every new/changed relative Style URL before `network.load`, `network.load` plus exact origin/prefix rules for absolute values, protocol registration, runtime-image single resolution, redaction, 5 MiB messages/styles, 100 operations, 100 features/1 MiB queries, 64 KiB runtime state/list output, 3 MiB image bytes, and 10-second operations. Explain that the 5 MiB Style and frame limits are independent: runtime byte-checks initial/external/opaque-prepared-view Styles even for write-only connections; browser output measures the full envelope; optional Style/diff is omitted deterministically; mutation output may become a receipt; every correlated mutation failure with current authority—including ordinary `INTERNAL`/`IO_ERROR`, conflict, and post-deadline timeout—retains revision/hash while preserving its primary code; and only an indivisible oversized `getStyle` response becomes the stable size failure. Document that live MCP uses the factory's independent resolved `maxMessageBytes`: actual read results are finalized before cache/mirror/touch, writes expose only pre-proven fixed receipts, and mutation errors are projected to fixed metadata-only authentic failures so response budgeting never hides a committed revision/hash or leaks Style/secrets. Document `maxStyleBytes` as defaulting to `DEFAULT_MAX_STYLE_BYTES` and as an explicit lower/raise override.

Also document replacement recovery: a browser-generated `registrationAttemptId` is private, transient lost-ack replay is byte-identical within a finite 30-second client budget, the server retains its single per-map idempotency record for 60 seconds, and a replay generation stays server-side `MAP_NOT_READY` until its mandatory authoritative `mapSnapshot` confirmation is accepted. Old-generation active/queued work is rejected and never replayed.

- [ ] **Step 4: Run frozen install and static quality gates**

Run: `rtk pnpm install --frozen-lockfile && rtk pnpm run lint && rtk pnpm run typecheck && rtk node --test scripts/check-mcp-typegraph.test.mjs && rtk node scripts/check-mcp-typegraph.mjs && rtk pnpm run build`

Expected: all commands exit 0 with MapLibre GL JS 6.3.x, style-spec 26.2.x, MCP SDK 1.30.x, `ws` 8.21.x, Vite 8.2.x, and Playwright 1.62.x; the exact MCP `--listFiles` closure admits only the required bridge server modules plus neutral `style-hash.ts`, shared response/admission boundaries, and still excludes MapLibre/DOM runtime code.

- [ ] **Step 5: Run all unit, integration, example, and real-browser tests**

Run: `rtk pnpm test && rtk pnpm run example:typecheck && rtk pnpm run test:example:bridge && rtk pnpm run test:e2e:bridge && rtk pnpm run test:e2e:bridge`

Expected: every test exits 0, including opaque-layer compile integration, ordinary current-authority mutation failure mirror merge, unknown-authority recovery ordering, registration liveness/idempotent replay, raw URI admission, shared lowered-policy MCP response boundaries, the example application's own typecheck and compiled `main.test.ts`, real WebSocket security, and MCP-to-real-Map Playwright coverage. Each of the two consecutive public E2E invocations rebuilds root and example output itself, clears only its dedicated `.tmp` artifacts, discovers stdio/HTTP endpoints from the strict handoff, and cannot consume stale `dist`. Playwright output and HTML reports exist only below `.tmp/playwright-output/browser-bridge` and `.tmp/playwright-report/browser-bridge`; no repository-root `test-results/` or `playwright-report/` is created.

- [ ] **Step 6: Smoke-test all public ESM entries and binaries**

Run: `rtk node --input-type=module --eval "await Promise.all(['.','./core','./maplibre','./ai','./mcp','./bridge'].map(async p=>{const spec=p==='.'?'maplibre-style-tools':'maplibre-style-tools/'+p.slice(2);await import(spec)}))"`

Expected: exits 0; importing `core` or `bridge` does not start a server or require a DOM, and importing `bridge` does not load `ws`.

Run: `rtk node dist/cli/main.js --help && rtk node dist/mcp/main.js --help`

Expected: both exit 0; help text is written to the documented stream and no server remains running.

- [ ] **Step 7: Verify the real npm artifact and every package boundary**

Extend the existing checker so its final runtime matrix imports root, `/core`, `/maplibre`, `/ai`, `/mcp`, and `/bridge` from one freshly built real tarball in a temporary bare consumer, asserts the MCP entry's `buildLiveMapMetadataUri('a.b') === 'maplibre-style://maps/~a.b'` and matching style builder output, runs both installed bin `--help` contracts, and asserts the pack list contains `dist/bridge/index.js` plus `dist/bridge/index.d.ts`. In the same installed consumer, compile the four independent strict declaration programs: core NodeNext unchanged; maplibre-only ESNext/Bundler extended with browser `/bridge` values/types and negative Node globals; root Bundler unchanged except its prior owner; and MCP NodeNext extended with the synchronous live extension, fixed response schemas, and marked URI builders. All use `skipLibCheck:false`, and no root/bridge/MCP declaration is moved into the wrong program to mask contamination. Retain rejection of `src/`, `examples/`, tests, `.tmp/`, browser reports, test results, and stale artifacts. Never replace this with `npm pack --dry-run` or direct `dist` imports.

Run: `rtk pnpm run check:package`

Expected: exits 0 through the installed tarball's declared exports/bins and all four isolated declaration consumers; only `package.json`, README/license files already owned by the package, and production `dist/**` are packed.

- [ ] **Step 8: Confirm the browser entry has no Node-server export or import**

Run: `rtk node --test scripts/check-package.test.mjs && rtk node --input-type=module --eval "const b=await import('maplibre-style-tools/bridge');if('createBridgeServer' in b||'LiveMapRegistry' in b)process.exit(1)" && rtk node scripts/check-package.mjs --check-browser-closure dist/bridge/index.js`

Expected: all three assertions exit 0; the final assertion scans the complete reachable emitted browser closure, not a hand-maintained shallow file list.

- [ ] **Step 9: Review the final diff and commit documentation**

Run: `rtk git diff --check && rtk git status --short && rtk git diff -- README.md package.json scripts/check-package.mjs`

Expected: no whitespace errors; only intended bridge-plan implementation/docs changes remain.

```bash
rtk git add README.md scripts/check-package.mjs
rtk git commit -m "docs: document live MapLibre bridge"
```

- [ ] **Step 10: Verify the completed branch is clean**

Run: `rtk git status --short`

Expected: no output. Stop here; do not publish, push, tag, or modify `/Users/zhang/code/ai-style-editor`.
