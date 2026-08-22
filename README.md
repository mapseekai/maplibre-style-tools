# maplibre-style-tools

**English** | [简体中文](README.zh-CN.md) | [Changelog](CHANGELOG.md)

AI-driven tools for inspecting and editing MapLibre GL styles.

One transport-neutral capability layer (`/capabilities`) defines the five style
capabilities — `inspectStyle`, `applyStyleTransaction`, `applyStyleDocument`,
`runMapCommand`, `queryMapFeatures` — including their strict input schemas,
descriptions, and bounded result envelopes. Three thin interfaces expose the
same capabilities: an AI SDK tool factory (`/ai`), an MCP server (`/mcp`), and
the `maplibre-style` CLI. Each interface supplies its own style authority
(in-process map, bounded document session, bridged live map, or style file);
capability semantics are defined once in the core.

## Requirements

- Node.js 22.13 or newer
- `maplibre-gl` 6.3 or a compatible release
- An AI SDK 6 tool consumer

## Installation

```bash
npm install maplibre-style-tools maplibre-gl
```

This package is ESM-only and requires Node.js 22.13 or newer. CommonJS projects on that version or newer can load it directly with `require()` through Node's `require(esm)` support; no `.cjs` artifacts are published.

## Local installation

Build the package once, then add it from a sibling project:

```bash
cd ../maplibre-style-tools
pnpm install
pnpm run build
cd ../your-project
pnpm add ../maplibre-style-tools
pnpm add maplibre-gl
```

## AI tools

```ts
import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';

const { applyStyleTransaction } = createMapLibreStyleTools({ getMap: () => map });
const result = await applyStyleTransaction.execute({
  transaction: {
    operations: [{
      op: 'setLayerProperties',
      layerId: 'roads',
      paint: { 'line-color': '#fff' },
    }],
  },
});
```

`createMapLibreStyleTools` returns exactly five AI SDK tools: `inspectStyle`,
`applyStyleTransaction`, `applyStyleDocument`, `runMapCommand`, and
`queryMapFeatures`. Pass the returned object to an AI SDK `tools` set, or call
each tool's `.execute(input)` method directly.

## Entry points

The package has seven supported entry points:

- `maplibre-style-tools` contains the non-AI package exports.
- `maplibre-style-tools/core` is the transport-neutral transaction, validation, GeoJSON, analysis, and discovery API. It requires neither DOM nor Node ambient types.
- `maplibre-style-tools/maplibre` applies prepared transactions to MapLibre maps and exposes bounded live-map commands. It may use DOM types but does not load Node ambient types.
- `maplibre-style-tools/capabilities` is the transport-neutral capability layer: the five capability executors, their strict input schemas, the capability registry, the result envelope, and the `StyleAuthority`/`RuntimeAuthority` interfaces each interface implements. It also exports `createOpenAiFunctionTools` and `createAnthropicTools`, which project the registry into OpenAI function-calling and Anthropic Messages tool schemas for direct LLM API integrations.
- `maplibre-style-tools/ai` is the AI SDK interface: `createMapLibreStyleTools` wraps the capability registry as five AI SDK tools over an in-process map.
- `maplibre-style-tools/mcp` is the MCP interface: the bounded server factory, transport runners, session store, live-bridge extension, and URI helpers. It exposes the same five capabilities plus session-management tools.
- `maplibre-style-tools/bridge` is the browser-safe live MapLibre client, protocol, capability, hashing, and resource-policy API. It exports no Node WebSocket server state.

The `/ai` and `/mcp` declaration graphs intentionally load their required Node types. Import the root entry, `/core`, `/maplibre`, `/capabilities`, or `/bridge` directly when that ambient dependency is undesirable.

## Pure core

Use the strict, transport-neutral core boundary when an adapter needs to validate
and apply a style transaction without loading the browser or AI facade:

```ts
import { applyStyleTransaction } from 'maplibre-style-tools/core';

const result = applyStyleTransaction(
  { version: 8, sources: {}, layers: [] },
  {
    operations: [{
      op: 'setLayerProperties',
      layerId: 'roads',
      paint: { 'line-color': '#ffffff' },
    }],
  },
);
```

The `/core` API requires an operation discriminator and returns RFC 6901 diffs.
Its defaults are a 5 MiB Style, 1 MiB diff, and 100 operations;
`StyleTransactionOptions` can override those limits explicitly. Adapters should
pass unknown transactions to this boundary rather than pre-parsing them.

### Structured transactions and filters

Every core mutation is an object with an `op` discriminator. A transaction is a closed object containing a bounded `operations` array and optional final validation:

```ts
import { applyStyleTransaction } from 'maplibre-style-tools/core';

const result = applyStyleTransaction(style, {
  operations: [
    {
      op: 'setLayerFilter',
      layerId: 'roads',
      mode: 'and',
      filter: ['==', ['get', 'surface'], 'paved'],
    },
    {
      op: 'setLayerProperties',
      layerId: 'roads',
      paint: { 'line-color': '#4c78a8' },
    },
  ],
});
```

Layer filters support `replace`, `and`, `or`, and `clear`. GeoJSON source filters support `replace` and `clear`. Filters use expression syntax exclusively. A failed operation rolls back the entire candidate; successful results contain replayable RFC 6901 diffs and exact changed layer/source IDs.

`setStyleRootProperties` applies recursive RFC 7396 merge-patch behavior to allowed root fields: object keys merge, `null` deletes, and arrays/scalars replace. It cannot modify `version`, `sources`, or `layers`.

### Inline GeoJSON

The `/core` declarations model every RFC 7946 geometry (`Point`, `MultiPoint`, `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon`, and `GeometryCollection`), Features, FeatureCollections, 2D/3D bounding boxes, string/number IDs, nullable properties, and JSON foreign members. `validateInlineGeoJson` returns a descriptor-sanitized plain snapshot and enforces these defaults:

- serialized bytes: 5 MiB;
- features: 100,000;
- coordinate positions: 1,000,000;
- geometry nesting depth: 16;
- property nesting depth: 32.

Pass `GeoJsonLimits` overrides when a trusted caller needs different bounds. `analyzeGeoJson` returns a named `available` discriminated union: inline data reports geometry counts, bounds, property types/ranges/top values, and warnings; a remote URL reports `{available:false, reason:'remote-url'}` without fetching the network.

Use `listSourceLayers` for network-free source-layer discovery from Style metadata and layer references. The structured factories also expose `duplicateLayer`, `addLayerFromSource`, and atomic `addGeoJsonLayer`; the last operation validates and adds its inline source and layer together, so either both commit or neither does.

### MapLibre adapter and live data

```ts
import {
  applyTransactionToMap,
  runtimeGeoJsonSourceDiffSchema,
} from 'maplibre-style-tools/maplibre';

const parsed = runtimeGeoJsonSourceDiffSchema.safeParse({
  update: [{
    id: 'station-1',
    addOrUpdateProperties: [{ key: 'status', value: 'open' }],
  }],
});

if (parsed.success) {
  await source.updateData(parsed.data);
}
```

`RuntimeGeoJsonSourceDiff`, `RuntimeGeoJsonFeaturePatch`, and `RuntimeGeoJsonPropertyPatch` are package-owned, closed JSON DTOs. Their strict schemas sanitize input before the single awaited `GeoJSONSource.updateData(diff)` call. This boundary deliberately replaces MapLibre's nested upstream `any` property value with `JsonValue`, so unvalidated host values and excess command keys cannot enter through the public incremental-update API.

`applyTransactionToMap` validates the current Map Style, prepares an opaque immutable transaction handle, detects revision conflicts, awaits style load/hash confirmation, and reports whether the returned Style is authoritative `current`, saved `pre-operation`, or `unavailable`. MapLibre's `diff` option defaults to `true`; explicitly passing `diff:false` still performs and awaits the real apply (and any rollback). It changes MapLibre rendering behavior only—the semantic core diff and changed IDs remain in the result.

Rendered/source feature queries are adapter-only and bounded by both feature count and serialized bytes. Returned feature objects are projected into JSON snapshots with an optional property allowlist; truncation is explicit rather than returning an unbounded MapLibre object graph.

### Capability result contract

Every capability returns one discriminated envelope, identical across the AI
SDK, MCP, and CLI interfaces:

```ts
type CapabilityResult<TData> =
  | { success: true; message: string; data: TData }
  | { success: false; message: string; error: StyleToolError };
```

(`/ai` exports this shape under the `AiStyleToolResult` alias.)

Successful results contain `data`; failures contain an authentic
package-created `StyleToolError`. The unified AI surface does not accept
`getState`, does not return arbitrary application state, and never returns a
complete Style document or `data.style`. Read a complete document through
`/core` or your MapLibre Map instance when it is needed.

AI inputs are strict native JSON structures. Do not encode nested objects or
arrays as strings; invalid input is rejected as `INVALID_INPUT` before a
handler or Map is invoked.

For GeoJSON source updates, use `setGeoJsonData` in
`applyStyleTransaction` for a native replacement (`setData`), and use
`runMapCommand` with `action: 'updateGeoJsonData'` for a native incremental
diff (`updateData`).

## Command-line interface

The installed package provides the `maplibre-style` binary. It validates and
inspects styles without network access and applies the same strict core
transactions used by the library:

```bash
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

Use `-` in place of either the Style path or the operations path to read that
input from stdin. A single invocation cannot read both inputs from stdin.
Stdout contains exactly one JSON value while the stream remains writable,
including the `--help` envelope; diagnostics go to stderr. Command results are
the shared capability envelope (`{ "success", "message", "data" | "error" }`).
Exit codes are `0`
for success, `1` for a valid request rejected by Style or transaction
semantics, `2` for arguments/input/JSON errors, and `3` for output or internal
failures.

Apply does not mutate the input unless `--in-place` is explicit. `--dry-run`
only reports the candidate, and `--output` creates a new file exclusively—it
will not overwrite an existing path. In-place writes use an exclusive
same-directory temporary file, sync it, rename it over the input, then sync the
directory. `--backup` creates non-overwriting `<STYLE>.bak`; a pre-existing
backup is never replaced or removed.

Both `--output` and the installed in-place candidate are compact
`JSON.stringify(style)` bytes with no trailing newline. Consequently, a Style
accepted by core at the exact 5 MiB boundary remains readable by the CLI. A
backup preserves the exact original bounded input bytes from the descriptor
that supplied the parsed Style; it is neither reserialized nor reread through
a pathname that might have raced.

In-place identity checks compare that original descriptor with the path before
replacement. They are best-effort across the final `lstat`-to-`rename`
interval. An invocation-created backup is removed after a pre-commit failure so
a retry is not blocked, while a backup that existed before the invocation is
never removed.

| State | File bytes | Stdout | Stderr | Exit |
| --- | --- | --- | --- | ---: |
| Pre-commit filesystem failure | Original/no new output | Untouched | Ordinary output error; no `File committed` | 3 |
| Post-rename directory durability failure | New | Committed-state JSON if writable; otherwise untrusted | Durability diagnostic, with explicit committed fallback if stdout failed | 3 |
| Fully committed file, then stdout result failure | New | Untrusted; never retried | `File committed` diagnostic | 3 |

A committed-state JSON result containing
`{"committed":true,"durable":false,...}` means the new Style is installed but
directory sync failed. If that acknowledgement cannot be written and stderr is
writable, stderr explicitly reports the committed, durability-uncertain state.
Likewise, if either `--output` or `--in-place` commits and only the later result
write fails, the file remains changed and stderr reports that it was committed.
In either committed branch, exit `3` is not proof that no file was written;
callers must inspect the destination and must not blindly retry.

A stdout transport failure may leave stdout empty or partially written and
therefore unparseable; stderr is the only possible reporting channel in that
branch. Each write owns a temporary Writable `error` listener. EPIPE and
already-closed streams select exit `3`, and stderr reporting is best-effort: if
stderr is closed too, the CLI preserves the selected exit code without an
uncaught error.

## MCP server

Use the installed stdio server for ordinary MCP hosts:

```bash
maplibre-style-mcp --stdio
```

Stdout is reserved exclusively for newline-delimited protocol messages; startup
diagnostics go only to stderr. The default `maxMessageBytes` is 5 MiB. Embedders
can configure it from 128 KiB through 64 MiB. `runStdioMcp` accepts a
`startupDiagnosticLine`: omitted writes the default ready line, a string writes
that exact one-line diagnostic, and `null` suppresses it. A composite host should
pass `null`, then emit and await its own handoff diagnostic after all components
are ready.

An optional protected Streamable HTTP listener is available for trusted clients:

```bash
TOKEN='replace-with-a-random-secret'
maplibre-style-mcp --http --bearer-token "$TOKEN"
```

It binds `127.0.0.1` on a random port by default. Supplying another interface
requires `--allow-non-loopback`. Every request must provide the bearer token and
the exact bound `Host`; a present browser `Origin` must equal the bound origin or
an explicit allowlist entry. The listener validates these headers before reading
the body or allocating an MCP transport. It intentionally disables replay and
JSON batch aggregation: Streamable HTTP uses non-replay SSE, and each response in
a batch is independently bounded. Application style-session IDs are distinct
from SDK transport-session IDs.

Neither transport accepts a path or URL as Style input, and neither performs a
network fetch. The package-derived server version is generated at build time.

## Live MapLibre browser bridge

The browser bridge connects an existing MapLibre map to the live-map extension
hosted by `maplibre-style-mcp`. For the end-to-end runtime path from an MCP
tool call to the live map, see
[How MCP Accesses a Running MapLibre Map](docs/mcp-live-map-access.md).

A page connects its map with `connectMapLibreBridge`:

```ts
import { connectMapLibreBridge } from 'maplibre-style-tools/bridge';

const connection = connectMapLibreBridge(map, {
  mapId: 'demo-map',
  url: 'ws://127.0.0.1:7788',
  token: processSuppliedToken,
  capabilities: [
    'style.read', 'style.write', 'features.query', 'runtime.state',
    'assets.write', 'network.load',
  ],
  allowedResourceOrigins: [],
});

await connection.whenReady();
```

Full MCP live-map parity requires granting all six capabilities: `style.read`,
`style.write`, `features.query`, `runtime.state`, `assets.write`, and
`network.load`. These capabilities apply to connected live map targets; MCP
session targets remain offline document workflows.

The token is sent in the first WebSocket frame, never in the URL. The standalone
example asks for it in an explicit password input and keeps it only for that
ephemeral connection; it is not placed in page URLs, storage, status text, logs,
or errors. The `/bridge` entry (`src/bridge/index.ts` in this repository) is
browser-only. It does not export `createBridgeServer` or `LiveMapRegistry`; the
Node WebSocket bridge is owned by the MCP binary.

Start a stdio MCP server and its loopback WebSocket bridge together:

```bash
maplibre-style-mcp --stdio \
  --bridge-host 127.0.0.1 \
  --bridge-port 7788 \
  --bridge-origin http://127.0.0.1:5173
```

After both components are ready, stderr contains exactly one strict handoff
record. A generated-token stdio record looks like this; stdout remains reserved
for MCP framing:

```json
{"event":"bridge_listening","mcpTransport":"stdio","wsUrl":"ws://127.0.0.1:7788","allowedOrigins":["http://127.0.0.1:5173"],"token":"GENERATED_SECRET"}
```

Every handoff has `event: "bridge_listening"`, `mcpTransport`, and the actual
bound `wsUrl`. A stdio record must not contain `mcpUrl`. An HTTP record contains
the actual bound `mcpUrl`, which clients must use for endpoint discovery. A
caller-supplied bridge token is intentionally omitted from stderr; a generated
token is reported once so the browser can connect.

Live mutations target a connected map through the capability envelope. The
bridge authority reads the map's current revision and style hash immediately
before committing, so callers do not supply optimistic-concurrency state:

```json
{"name":"applyStyleTransaction","arguments":{"target":{"kind":"map","mapId":"demo-map"},"input":{"transaction":{"operations":[{"op":"setLayerProperties","layerId":"roads","paint":{"line-color":"#4c78a8"}}]}}}}
```

If the map changed between that read and the commit, the bridge rejects the
mutation and the caller receives a `REVISION_CONFLICT` failure; it must read
the current map state, resync its intent, and deliberately submit a new
request. Neither MCP nor the browser client retries mutations. Other stable
live errors include `BRIDGE_DISCONNECTED`, `CAPABILITY_DENIED`, `MAP_NOT_READY`,
and `TIMEOUT`.

### Live resources and canonical map IDs

The fixed map collection is `maplibre-style://maps`. Its two advertised
templates are exactly:

- `maplibre-style://maps/~{mapId}`
- `maplibre-style://maps/~{mapId}/style`

Use the public builders with a semantic ID, not a pre-encoded value:

```ts
import {
  buildLiveMapMetadataUri,
  buildLiveMapStyleUri,
} from 'maplibre-style-tools/mcp';

await client.readResource({ uri: buildLiveMapMetadataUri('a.b') });
await client.readResource({ uri: buildLiveMapStyleUri('a.b') });
```

The builder adds the same-segment `~` marker and encodes the ID exactly once.
The transport validates the original raw `resources/read` URI before the SDK
constructs a `URL`. Normalization-changing dot prefixes, literal or encoded dot
segments, encoded-unreserved aliases, double encoding, and unmarked map
routes are rejected with zero resolver work. Only a canonical raw URI reaches
the resource callback, where the semantic ID is decoded once.

### Resource authorization

Style resource inspection covers root `glyphs`, `sprite`, and import URLs;
source `url`, `tiles`, and `urls`; string GeoJSON `data`; image/video source
URLs; runtime image URLs; `data:` URLs; and custom protocols. An unchanged
baseline path-plus-value pair may remain in a candidate. Every newly introduced
or changed relative Style URL is rejected before `Map#setStyle`, regardless of
`resourceBaseUrl`, the current `document.baseURI`, or a later `<base>` mutation.

New or changed absolute network resources require the `network.load` capability
and must satisfy the exact configured origin and URL-prefix rules. `data:` is a
separate opt-in, and a custom protocol must be explicitly allowed and registered.
Resource values are redacted from public failures.

`resourceBaseUrl` has one narrower purpose: the separate runtime-image API
resolves a relative image input once against the base captured at connection
creation, authorizes it, then gives the loader that exact absolute URL. A worker
without a document therefore needs an explicit runtime-image base, but no base
can enable relative Style resources.

### Live limits and response authority

The defaults and fixed ceilings exposed by the live bridge are:

- 5 MiB for each WebSocket message and each validated Style;
- 100 operations per transaction;
- 100 returned features and 1 MiB of serialized feature-query output;
- 64 KiB for runtime state and image-list output;
- 3 MiB of decoded runtime image bytes;
- 10 seconds for an operation.

The 5 MiB frame and Style checks are independent. Runtime code byte-checks
initial, externally changed, and opaque prepared-view Styles even for write-only
connections. Browser output measures the complete result envelope. When needed,
optional Style and diff fields are omitted deterministically, and a successful
mutation can be reduced to its fixed receipt. Every correlated mutation failure
that still has current authority—including ordinary `INTERNAL` or `IO_ERROR`, a
conflict, and a post-deadline `TIMEOUT`—retains the current revision and hash
while preserving its primary error code. Only an indivisible oversized
`getStyle` result becomes the stable size failure.

The live MCP extension uses the factory's independently resolved
`maxMessageBytes`. Read results are finalized against that budget before a
cache, mirror, or TTL touch; writes expose only fixed receipts whose size was
proven in advance. Mutation errors are projected as fixed, metadata-only,
authentic failures, so budgeting cannot hide a committed revision/hash or leak a
Style, URL, token, or other secret. `maxStyleBytes` defaults to
`DEFAULT_MAX_STYLE_BYTES` and may be explicitly lowered or raised independently
of the message limit.

### Replacement and reconnect recovery

The browser-generated `registrationAttemptId` is private. If a registration
acknowledgement is lost, the browser replays the byte-identical registration
within a finite 30-second client budget; the server retains one per-map
idempotency record for 60 seconds. A replayed generation remains server-side
`MAP_NOT_READY` until its mandatory authoritative `mapSnapshot` confirmation is
accepted. Active and queued work owned by the old generation is rejected and is
never replayed on the replacement connection.

### Tools and lifecycle

The server exposes the five shared capabilities plus three session-management
tools. Capability tools take a strict `{ "target", "input" }` object: `input`
uses the shared capability validation path (the same one used by `/ai` and the
CLI), and `target` routes the style authority:

- `{ "kind": "session", "sessionId": "...", "expectedRevision": 0 }` operates
  on a bounded in-memory document session with revision-checked commits.
- `{ "kind": "map", "mapId": "..." }` operates on a live browser map connected
  through the bridge extension. `runMapCommand` and `queryMapFeatures` require
  a map target.
- `inspectStyle` actions `validateDocument`, `validateTransaction`, and
  `analyzeGeoJson` are authority-free; `target` may be omitted for them.

Bridge v2 exposes the complete five-tool capability surface for live map targets.
Every tool returns the common `{ success, message, data | error }` envelope; the
last column names the successful `data` shape.

| Tool | Description | Required live-bridge capability | URL policy | Result type |
| --- | --- | --- | --- | --- |
| `inspectStyle` | Inspect a style, its validated structure, and GeoJSON inputs without mutation. | `style.read` for live-map reads; authority-free validation actions need no target. | None. | `InspectionProjection` |
| `applyStyleTransaction` | Apply one strict, atomic style transaction to a session or live map. | `style.read` + `style.write` | None. | `StyleMutationReceipt` |
| `applyStyleDocument` | Apply an inline Style document or an absolute Style URL. Sessions use revision checks; live maps apply the whole document through bridge v2. | `style.read` + `style.write`; URL sources additionally need `network.load`. | New or changed absolute resources must match the configured origin/prefix policy; relative Style resources are rejected. | `StyleMutationReceipt` |
| `runMapCommand` | Run every bounded SDK runtime action on a live map: GeoJSON incremental update, source LOD, feature/global state, images, and sprites. | By action: `updateGeoJsonData` → `style.write`; source LOD/feature/global state → `runtime.state`; image/sprite listing → `style.read`; image/sprite mutation → `assets.write`; URL additions also need `network.load`. | `addImageFromUrl` and `addSprite` require an admitted absolute URL; `data:` and custom protocols require their explicit opt-ins. | `MapCommandReceipt` |
| `queryMapFeatures` | Query bounded source or rendered features from a live map target. | `features.query` | None. | `FeatureQueryProjection` |
| `openStyleSession` | Open one bounded in-memory style session from inline Style JSON. | Not a live-bridge tool. | None. | Session metadata |
| `closeStyleSession` | Close one in-memory style session. | Not a live-bridge tool. | None. | Close acknowledgement |
| `exportStyleSession` | Export the current or one retained revision of a session. | Not a live-bridge tool. | None. | Style document plus revision |

Open a session, commit only against the expected revision, and export the same
or a retained revision:

```json
{"name":"openStyleSession","arguments":{"style":{"version":8,"sources":{},"layers":[]}}}
```

```json
{"name":"applyStyleTransaction","arguments":{"target":{"kind":"session","sessionId":"SESSION","expectedRevision":0},"input":{"dryRun":true,"transaction":{"operations":[{"op":"setStyleRootProperties","properties":{"metadata":{"owner":"maps"}}}]}}}}
```

```json
{"name":"exportStyleSession","arguments":{"sessionId":"SESSION","revision":0}}
```

A dry run returns the semantic diff but does not advance revision or history. A
commit is atomic, requires the exact current revision, advances it once, and
retains at most 20 history entries. Successful session mutations include the
new `revision` in `data`. Defaults are 32 sessions, a 5 MiB Style, 100
operations, a 1 MiB diff, and a 30-minute idle TTL; generated session IDs are
limited to 512 UTF-8 bytes.

Inspect a session layer or validate inline JSON without any authority:

```json
{"name":"inspectStyle","arguments":{"target":{"kind":"session","sessionId":"SESSION"},"input":{"action":"getLayer","layerId":"roads"}}}
```

```json
{"name":"inspectStyle","arguments":{"input":{"action":"validateDocument","style":{"version":8,"sources":{},"layers":[]}}}}
```

All tool results use the shared capability envelope
`{ "success": true, "message": ..., "data": ... }` or
`{ "success": false, "message": ..., "error": { ... } }`, identical across the
MCP, AI SDK, and CLI interfaces. Successful tool results keep their JSON text
content equal to `structuredContent`.

### Resources and canonical identifiers

The six advertised resource templates are:

- `maplibre-style://sessions/~{sessionId}`
- `maplibre-style://sessions/~{sessionId}/style`
- `maplibre-style://sessions/~{sessionId}/context`
- `maplibre-style://sessions/~{sessionId}/layers/~{layerId}`
- `maplibre-style://sessions/~{sessionId}/sources/~{sourceId}`
- `maplibre-style://sessions/~{sessionId}/revisions/~{revision}/diff`

The literal `~` marker belongs to every semantic variable. A generic client
supplies each raw semantic ID under RFC6570—the template performs exactly one encoding
step. Do not pre-mark, double encode, or normalize it. Exported helpers such as
`makeSessionUri`, `makeStyleUri`, `makeContextUri`, `makeLayerUri`, `makeSourceUri`,
and `makeDiffUri` preserve identifiers including `.`, `..`, `~`, `%`, and `/`
without aliases or double decoding.

### Embedding

```ts
import {
  createMapLibreStyleMcpServer,
  createStyleSessionStore,
} from 'maplibre-style-tools/mcp';

const store = createStyleSessionStore();
const created = createMapLibreStyleMcpServer({ store });
await created.connect(transport);
```

An injected store must be the exact branded object returned by
`createStyleSessionStore`; structural fakes and proxies are rejected. Extensions
are strictly synchronous and explicitly return `undefined`. Each resource
extension registers one disjoint `ResourceUriAdmission` with `scheme`,
`authority`, and `assertCanonical` through the shared context before composition
freezes; registration and extension composition remain synchronous.

The public factory's `connect` and `close` methods are already bounded and
stateful. Do not retain or invoke raw SDK low-level connect/close methods.
`maxMessageBytes` replaces oversized application results atomically with the
fixed `responseTooLarge` envelope: projection work is not rerun and no partial
result is emitted. Its inbound boundary counts exact raw bytes, and its outbound
boundary gates the final serialized JSON-RPC message. Only the stdio and HTTP runners select prebounded-input mode;
direct factory connections perform canonical inbound byte validation themselves.

### Read-only MCP Builder evaluation

After building the repository, start the deterministic evaluation-only fixture
server with:

```bash
node evals/maplibre-style-mcp-fixture-server.mjs
```

It pre-seeds the ten independent sessions described by
`evals/maplibre-style-mcp.xml` and then uses the same public bounded stdio
runner, tools, resources, and server metadata as the installed server. The
fixture is repository-only and is excluded from the packed package. The default
`maplibre-style-mcp` binary never contains or discovers these evaluation
sessions.

## Examples

Two Vite examples exercise the package against a live in-browser map. Build the
package first with `pnpm run build`.

- `examples/browser-bridge` connects a MapLibre map to the MCP live bridge and
  shows connection status. Run `pnpm run example:dev` and open
  `http://127.0.0.1:5173/`.
- `examples/ai-chat` is a Chinese-language chat assistant that drives the live
  map through an LLM tool-calling loop over the five capabilities. It supports
  both OpenAI-compatible (`/chat/completions`) and Anthropic Messages
  (`/messages`) providers, with tool schemas generated by
  `createOpenAiFunctionTools`/`createAnthropicTools` from `/capabilities`.
  Run `pnpm run example:dev:ai-chat` and open `http://127.0.0.1:5174/`, then
  paste an API key and ask in Chinese, for example "把海洋换成淡蓝色".

## Development

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run clean
pnpm run build
pnpm test
npm pack --dry-run
```

Build output is written to `dist/`. Tests use Node's built-in test runner and compile into `.tmp/test-dist/`.
