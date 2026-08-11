# MapLibre v6 Style Platform Design

**Date:** 2026-08-11

**Status:** Approved in conversation; pending written-spec review

**Project:** `maplibre-style-tools`

## Summary

Evolve the standalone `maplibre-style-tools` package into a layered style-editing platform while keeping it a single npm package. The project will upgrade to MapLibre GL JS 6.3.0 and MapLibre Style Spec 26.2.1, establish a transport-neutral Style JSON core, add safe high-level layer and data operations, converge the existing full and compact AI SDK tools on that core, and provide CLI, MCP, and browser-bridge entry points.

The pure core will be authoritative for document edits, validation, transactions, and diffs. Browser MapLibre integration, AI SDK tools, CLI commands, MCP tools/resources, and the live browser bridge will be adapters around that core. The existing `/Users/zhang/code/ai-style-editor` repository will not be modified; live-map behavior will be demonstrated in a standalone example in this repository.

## Context

The current package exports two AI SDK factories:

- `createMapLibreStyleTools`, which exposes 53 broad tools that mostly call a live `Map` directly.
- `createCompactMapLibreStyleTools`, which exposes 5 token-efficient tools and applies a small immutable `StyleOperation` model.

The full API already contains low-level tools for filters, layer creation and ordering, source management, GeoJSON updates, root style fields, feature state, images, sprites, and validation. The principal gaps are not raw MapLibre coverage. They are safe composition and discoverability:

- no atomic, lossless layer duplication;
- no safe source/source-layer or GeoJSON layer-creation workflow;
- no filter composition or clear distinction between layer filters and GeoJSON source filters;
- no data-property and source-layer discovery workflow;
- no common transaction, validation, diff, or result protocol between full and compact tools;
- no transport-neutral public core for CLI or MCP;
- no revision or concurrency model for remote/live edits;
- only four engine tests and no coverage of the full tools.

The npm registry reports `maplibre-gl` 6.3.0 and `@maplibre/maplibre-gl-style-spec` 26.2.1 as the latest stable releases on 2026-08-11. MapLibre GL JS v6 is ESM-only, targets ES2022, requires WebGL2, and strengthens several public TypeScript APIs. The package is already ESM and uses named/type imports, so it is structurally suited to the upgrade.

## Goals

1. Upgrade and test against:
   - `maplibre-gl ^6.3.0` as peer and development dependency;
   - `@maplibre/maplibre-gl-style-spec ^26.2.1` as a runtime dependency;
   - Node.js `>=22.13.0`.
2. Make pure Style JSON editing independent of DOM, `Map`, AI SDK, CLI, and MCP transports.
3. Support validated, immutable, all-or-nothing style transactions with stable errors and JSON Pointer diffs.
4. Add high-level filtering, layer duplication, source-based layer creation, GeoJSON analysis and creation, ordering, and source lifecycle operations.
5. Preserve existing public AI factory names and provide compatibility wrappers for existing string-encoded JSON inputs.
6. Provide a safe file-oriented CLI.
7. Provide document-session and live-map MCP capabilities.
8. Provide an authenticated browser bridge SDK and a standalone end-to-end example.
9. Keep the npm artifact clean and independently buildable and testable.

## Non-goals

- Modify or integrate `/Users/zhang/code/ai-style-editor`.
- Maintain MapLibre GL JS v5 compatibility in the new standalone project.
- Publish to npm, push a remote, add CI, or create a release in this work.
- Fetch remote styles, TileJSON, GeoJSON, tiles, sprites, glyphs, or images from the pure core.
- Simulate rendering or feature queries in a headless Style JSON session.
- Mirror all existing AI tools one-for-one in CLI or MCP.
- Build a browser extension or inject code into arbitrary pages.

## Package Architecture

The repository remains a single package. Internal modules have strict dependency direction and are exposed through subpath exports where they are useful independently.

```text
src/
  core/
    types.ts
    errors.ts
    schemas.ts
    validation.ts
    context.ts
    search.ts
    geojson-analysis.ts
    transaction.ts
    operations/
      layers.ts
      filters.ts
      sources.ts
  adapters/
    maplibre/
      map-adapter.ts
      runtime-commands.ts
      feature-query.ts
  ai-sdk/
    full-tools.ts
    compact-tools.ts
    compatibility.ts
    schemas.ts
  cli/
    main.ts
    io.ts
    output.ts
  mcp/
    server.ts
    tools.ts
    resources.ts
    session-store.ts
    transports.ts
  bridge/
    protocol.ts
    server.ts
    client.ts
    capabilities.ts
  index.ts
examples/
  browser-bridge/
```

Dependency direction:

```text
core
├── adapters/maplibre ── maplibre-gl + browser runtime
├── ai-sdk ───────────── core + adapter + AI SDK
├── cli ──────────────── core + Node I/O
├── mcp ──────────────── core + MCP SDK + session store
└── bridge ───────────── core protocol + map adapter + WebSocket
```

The core may depend on Zod for public runtime schemas and MapLibre Style Spec for canonical validation. It must not import `ai`, `maplibre-gl`, DOM types, Node filesystem APIs, MCP SDK, or WebSocket implementations.

### Public entry points

- `maplibre-style-tools`
  - keeps `createMapLibreStyleTools` and `createCompactMapLibreStyleTools`;
  - keeps currently exported public types;
  - may re-export commonly used core types.
- `maplibre-style-tools/core`
  - validation, analysis, search, operation schemas, and transactions.
- `maplibre-style-tools/maplibre`
  - live `Map` adapter and runtime commands.
- `maplibre-style-tools/ai`
  - explicit AI SDK factories.
- `maplibre-style-tools/mcp`
  - MCP server factory for embedding.
- `maplibre-style-tools/bridge`
  - browser bridge client and protocol types.
- `maplibre-style`
  - CLI binary.
- `maplibre-style-mcp`
  - MCP server binary.

Subpath modules must not rely on import-time DOM or server side effects. Importing `core` from Node must not load MapLibre or AI SDK code.

## Core Data Model

The core uses MapLibre Style Spec types where practical and retains structural extension points for valid future fields. Public input is validated through exported Zod schemas; TypeScript assertions alone are insufficient.

```ts
interface StyleTransaction {
  operations: StyleOperation[];
  validate?: boolean;
}

interface StyleTransactionResult {
  ok: boolean;
  style: StyleDocument;
  changedLayers: string[];
  changedSources: string[];
  diff: StyleDiffEntry[];
  warnings: StyleWarning[];
  error?: StyleToolError;
}

interface StyleDiffEntry {
  op: 'add' | 'remove' | 'replace' | 'move';
  path: string;
  from?: string;
  before?: unknown;
  after?: unknown;
}
```

Diff paths use RFC 6901 JSON Pointer syntax. Layer and source identifiers are located by stable semantic metadata in the result as well as by array/object paths, so identifiers containing dots or slashes remain unambiguous.

`applyStyleTransaction` deep-clones or copy-on-writes the input, validates the operation array, executes operations in order, validates the completed style, and returns either the completed result or the original style. It never partially mutates the caller's document. A failed transaction has empty change lists and diff.

The core uses stable error codes:

- `INVALID_INPUT`
- `STYLE_INVALID`
- `NOT_FOUND`
- `CONFLICT`
- `DEPENDENCY_CONFLICT`
- `UNSUPPORTED_SOURCE`
- `REVISION_CONFLICT`
- `MAP_NOT_READY`
- `BRIDGE_DISCONNECTED`
- `CAPABILITY_DENIED`
- `IO_ERROR`
- `TIMEOUT`
- `INTERNAL`

Errors carry a human-readable message, an optional JSON Pointer path, and structured details safe for machine clients.

## Style Operations

`StyleOperation` becomes a discriminated union with a required `op` field. The first complete surface includes:

- `setLayerProperties`
  - changes paint, layout, zoom range, and metadata;
  - a property value of `null` removes that property;
  - validates property names and values through the completed style.
- `setLayerFilter`
  - modes: `replace`, `and`, `or`, and `clear`;
  - combines with the existing filter without losing it;
  - rejects mixed legacy and expression filter syntax.
- `setGeoJsonSourceFilter`
  - changes the GeoJSON source-level preprocessing filter;
  - rejects non-GeoJSON sources.
- `duplicateLayer`
  - deep-copies the complete layer object, including unknown extension fields;
  - replaces only the ID before applying optional JSON Merge Patch-style overrides;
  - rejects an `id` field inside overrides; `newLayerId` is the sole authority for the copied layer ID;
  - defaults to insertion immediately above the original layer;
  - accepts at most one of `beforeId` and `afterId`.
- `addLayerFromSource`
  - creates a layer that references an existing source;
  - requires `source-layer` for vector sources;
  - rejects `source-layer` for GeoJSON and other incompatible sources;
  - supports paint, layout, filter, zoom, metadata, and placement.
- `addGeoJsonLayer`
  - atomically creates a GeoJSON source and its first layer;
  - accepts inline GeoJSON or a URL reference without fetching the URL;
  - validates inline data as RFC 7946 GeoJSON before changing the Style;
  - supports GeoJSON source options, layer fields, and placement.
- `moveLayer`
  - moves one layer before or after another layer.
- `reorderLayers`
  - moves an ordered list as one operation while preserving its relative order.
- `removeLayer`
  - removes one layer.
- `addSource`
- `duplicateSource`
- `renameSource`
  - renames the source and atomically rewrites all layer references;
  - never changes `source-layer` values.
- `removeSource`
  - refuses removal when dependent layers exist;
  - removes dependents only when `cascadeLayers: true` is explicit.
- `patchSource`
- `setGeoJsonData`

JSON Merge Patch semantics apply to definition overrides: `null` removes a field. Operations with inherently meaningful null behavior, such as clearing a filter, use explicit modes so intent is not ambiguous.

## Filtering and Data Discovery

Layer filters and GeoJSON source filters are separate operations because they execute at different stages. Layer filters control which source features a specific layer renders. GeoJSON source filters remove features before source processing and clustering.

Filter composition follows these rules:

- `replace` installs the supplied expression;
- `clear` removes the filter property;
- `and` creates `['all', existing, incoming]`, or uses the incoming filter if none exists;
- `or` creates `['any', existing, incoming]`, or uses the incoming filter if none exists;
- identical nested `all`/`any` groups may be flattened deterministically;
- no semantic simplifier rewrites arbitrary expressions;
- completed styles are validated against style-spec 26.2.1.

Data discovery includes:

- `analyzeGeoJson`
  - analyzes inline GeoJSON only; URL references are reported as unavailable without fetching;
  - geometry-type counts;
  - bounding box;
  - property names and inferred primitive types;
  - numeric min/max;
  - bounded top categorical values;
  - warnings for mixed or unsupported values.
- `listSourceLayers`
  - reports source-layer names referenced by the current style;
  - includes referencing layer IDs and types;
  - does not fetch remote TileJSON.
- live-map feature queries
  - call `querySourceFeatures` or `queryRenderedFeatures` through the adapter;
  - default to at most 100 features;
  - support a requested property allowlist;
  - enforce a serialized response-size limit.

The core does not choose subjective cartographic colors. It provides deterministic geometry and property analysis plus validated MapLibre expressions. AI tools or callers choose styling based on that information.

Inline GeoJSON accepted by `addGeoJsonLayer`, `setGeoJsonData`, or `analyzeGeoJson` must pass an RFC 7946 structural schema. Geometry coordinates must contain finite numeric positions, geometry collections may nest at most 16 levels, property values may nest at most 32 levels, and the default limits are 100,000 features and 1,000,000 coordinate positions in addition to the 5 MiB document limit. Null feature geometries remain valid. Limit violations return `INVALID_INPUT` with a path and do not partially analyze or modify the document.

## MapLibre Adapter and AI SDK Compatibility

Document operations run through the core and are applied to a live map with `map.setStyle(nextStyle, {diff: true})`. A transaction with an empty diff is a successful no-op: it does not call `setStyle` or advance revision. For a real change, the adapter snapshots the current style and installs completion and error listeners before calling `setStyle`, so synchronous events cannot be missed. Completion requires either the captured `style.load` event or a post-call `isStyleLoaded()` result together with the expected canonical style hash. The default timeout is 10 seconds. Synchronous exceptions remove the pending listeners. On asynchronous failure the adapter makes one best-effort attempt to restore the snapshot using a new, independent listener/timeout lifecycle and reports the rollback outcome. A successful adapter result means the expected style loaded, not merely that `setStyle` returned.

Runtime-only capabilities remain in the adapter:

- source/rendered feature queries;
- feature state and global state;
- image listing, addition, update, and removal;
- sprite operations that require the live Map;
- other runtime APIs that cannot be represented in Style JSON.

The full and compact AI factories become schema and presentation adapters over the shared core and MapLibre adapter.

- Existing factory names and tool names remain available.
- Existing JSON-string arguments remain as deprecated compatibility inputs.
- New structured tools accept actual objects and arrays.
- Both factories return a common structured result envelope.
- The compact factory gains data analysis, layer duplication, source-based creation, GeoJSON creation, and transaction tools.
- Validation tables and operation logic exist only in core.

## CLI

The `maplibre-style` binary provides:

```text
maplibre-style validate STYLE
maplibre-style inspect STYLE [filters]
maplibre-style apply STYLE --operations OPERATIONS [output options]
```

`STYLE` and `OPERATIONS` accept a file path or `-` for stdin, but both cannot consume stdin in the same invocation.

- `validate` parses JSON and performs full style-spec validation.
- `inspect` returns context, search results, a selected layer/source, source-layer usage, or GeoJSON analysis according to flags.
- `apply` accepts the native structured operation array, supports `--dry-run`, and returns the result envelope.
- The default never changes the input file.
- `--output FILE` writes a separate file.
- `--in-place` writes a same-directory temporary file, fsyncs as appropriate, and atomically renames it; `--backup` retains an explicit backup.
- `--backup` is valid only with `--in-place`; incompatible output options are rejected as argument errors.

Standard output contains JSON only. Diagnostics go to standard error. Exit codes are:

- `0`: success;
- `1`: valid invocation with a style or operation semantic failure;
- `2`: argument, JSON parsing, or input-read failure;
- `3`: internal or output-write failure.

The CLI does not fetch remote resources or instantiate a MapLibre renderer.

## MCP Document Sessions

The `maplibre-style-mcp` binary supports stdio by default and optional Streamable HTTP. Streamable HTTP requires a configured bearer token and listens on loopback unless the operator explicitly chooses another address. It exposes document tools:

- `style_session_open`
- `style_session_close`
- `style_validate`
- `style_inspect`
- `style_search_layers`
- `style_analyze_geojson`
- `style_apply_transaction`
- `style_export`

Resources use these templates:

- `maplibre-style://sessions/{sessionId}`
- `maplibre-style://sessions/{sessionId}/style`
- `maplibre-style://sessions/{sessionId}/context`
- `maplibre-style://sessions/{sessionId}/layers/{layerId}`
- `maplibre-style://sessions/{sessionId}/sources/{sourceId}`
- `maplibre-style://sessions/{sessionId}/revisions/{revision}/diff`

They expose session metadata, style, context, individual layers and sources, and bounded revision diffs.

Each session holds:

```ts
interface StyleSession {
  id: string;
  revision: number;
  style: StyleDocument;
  history: BoundedRevisionHistory;
  createdAt: number;
  lastAccessedAt: number;
}
```

Mutations include `expectedRevision`. A mismatch returns `REVISION_CONFLICT` without changing state. Mutations for one session are serialized. Dry runs do not increment the revision. Sessions are in-memory by default, scoped to the server instance, and subject to TTL, count, document-size, operation-count, history, and diff-size limits.

MCP does not read arbitrary paths. A future or embedded caller may enable file access only with explicit canonical allowlisted roots.

## Live Map MCP and Browser Bridge

The MCP server also exposes live-map tools:

- `map_list`
- `map_get_style`
- `map_apply_transaction`
- `map_query_source_features`
- `map_query_rendered_features`
- `map_set_feature_state`
- `map_remove_feature_state`
- `map_set_global_state`
- `map_list_images`
- `map_add_image`
- `map_remove_image`

Live resources use `maplibre-style://maps`, `maplibre-style://maps/{mapId}`, and `maplibre-style://maps/{mapId}/style` for discovery and read-only snapshots.

The browser client registers a real Map through:

```ts
connectMapLibreBridge(map, {
  mapId: 'demo-map',
  url: 'ws://127.0.0.1:PORT',
  token,
  capabilities: [
    'style.read',
    'style.write',
    'features.query',
    'runtime.state',
  ],
  allowedResourceOrigins: [],
});
```

The bridge protocol is versioned and uses structured request, response, event, and error messages. The browser initiates the WebSocket connection, sends the token in the first authentication frame rather than the URL, registers `mapId`, reports capabilities and the current style revision/hash, and resynchronizes after reconnect. The style hash is SHA-256 over canonical JSON with recursively sorted object keys and preserved array order. The client compares that hash after MapLibre style events; when application code changes the style outside an active bridge command, it advances the local revision and notifies the server before accepting another remote mutation.

`maplibre-style-mcp` accepts explicit bridge host, port, token, and allowed-origin options. When the token is omitted it generates one and prints the connection information once to standard error, keeping stdio protocol output clean.

For mutations:

1. MCP validates tool input, `expectedRevision`, and the server's mirrored style hash.
2. The bridge server sends a command containing both `expectedRevision` and `expectedStyleHash` to the registered browser map.
3. After the command reaches the front of the per-map queue, the browser recomputes its current revision/hash and rejects any mismatch before taking a mutation snapshot.
4. The client runs the requested core transaction locally and enforces the resource URL policy against the resulting Style.
5. The MapLibre adapter applies the new style and waits for completion or timeout.
6. The client returns the new revision, style hash, and bounded diff.
7. The server updates its mirror only after success. A client-side revision conflict causes an immediate full metadata resync and never retries the mutation automatically.

If the browser disconnects, live mutations fail with `BRIDGE_DISCONNECTED`; the server does not silently edit a stale mirror. One mutation per map executes at a time. Runtime queries execute in the browser and return bounded results.

## Security

- MCP HTTP and WebSocket servers listen on `127.0.0.1` by default.
- The bridge requires a random 32-byte bearer token and an explicit Origin allowlist for browser clients.
- Browser clients explicitly grant capabilities per map:
  - `style.read`
  - `style.write`
  - `features.query`
  - `runtime.state`
  - `images.write`
  - `network.load`
- Image writes are disabled unless `images.write` is granted.
- A bridge-sourced mutation may retain resource URLs already present in the registered baseline Style. Any newly introduced or changed URL-bearing field requires `network.load` plus an explicit allowed origin/URL pattern. This policy covers root glyph and sprite URLs; GeoJSON `data` URLs; vector, raster, raster-dem, and other source `url`/`tiles` fields; image/video source URLs; runtime image loads; and custom-protocol URLs. HTTP(S) origins are denied by default, `data:` values are size-limited, and other schemes are denied unless the host application explicitly registers and allows the protocol.
- The core and MCP server never execute JavaScript from style expressions; expressions remain JSON data.
- URL query strings and likely credentials are redacted from logs and errors.
- Default limits are 5 MiB per protocol message or Style document, 100 operations per transaction, 100 features and 1 MiB serialized data per query, 32 sessions, 20 retained revisions per session, 1 MiB per diff, a 30-minute idle session TTL, and 10 seconds per operation. Embedders may lower these values or raise them explicitly.
- Path access is disabled by default in MCP and is canonicalized against configured roots when enabled.
- The bridge rejects duplicate active map IDs unless an explicit replacement handshake succeeds.
- Protocol errors and capability denials do not leak style contents.

## Standalone Browser Example

`examples/browser-bridge` provides a small Vite application that:

- creates a MapLibre GL JS 6 map with an empty local style and inline GeoJSON;
- configures the v6 ESM worker correctly;
- connects to a locally started bridge with an explicit token;
- displays connection, map ID, revision, and last operation status;
- demonstrates filter composition, layer duplication, and GeoJSON layer creation;
- requires no external tile service.

The example is development-only and is not included in the npm tarball.

## Testing and Acceptance

### Core

- a dedicated core typecheck without DOM, Node, AI SDK, MapLibre runtime, MCP, or WebSocket ambient types;
- schema validation for every operation variant;
- input immutability and all-or-nothing failure;
- layer filter replace/and/or/clear and legacy/expression rejection;
- GeoJSON source filter behavior;
- full-field layer duplication and placement;
- existing-source layer creation rules;
- atomic GeoJSON source/layer creation;
- ordering and relative-order preservation;
- source duplication, rename/reference migration, dependency refusal, and explicit cascade;
- JSON Pointer diff correctness for unusual IDs;
- RFC 7946 rejection, feature/coordinate/nesting limits, and GeoJSON analysis mixed-property behavior;
- full style-spec validation against 26.2.1.

### Adapter and AI SDK

- MapLibre 6.3.0 compile coverage;
- fake-Map tests for no-op completion, listeners installed before `setStyle`, synchronous `style.load`, post-call loaded/hash completion, Map-not-ready, timeout, synchronous failure, and independent rollback reporting;
- runtime feature/state/image capability tests;
- compatibility tests for existing factory and tool names;
- structured full/compact results and schemas.

### CLI

- spawned-process tests for files and stdin;
- JSON-only stdout and diagnostic stderr;
- exit-code contract;
- dry run, separate output, atomic in-place output, and backup behavior;
- refusal when both inputs request stdin.

### MCP and bridge

- official MCP SDK client integration for tools, resources, session lifecycle, dry run, revision commits, and conflicts;
- real WebSocket integration for authentication, origin checks, capability denial, registration, reconnect, serialization, disconnect behavior, browser-side revision/hash recheck, external style changes, and server resync;
- resource URL policy tests for every URL-bearing style/source category, baseline retention, denied new origins, data-size limits, and explicitly allowed custom protocols;
- bridge request/response size and timeout limits;
- no mutation of a stale mirror.

### Browser example

- Vite production build;
- Playwright Chromium end-to-end test with inline GeoJSON and no external tiles;
- MCP-to-bridge-to-Map transaction changes the real map style and advances revision.

### Final package checks

- frozen dependency installation;
- lint;
- typecheck;
- build;
- all unit and integration tests;
- browser example build and end-to-end test;
- root and subpath ESM import smoke tests;
- CLI and MCP binary smoke tests;
- `npm pack --dry-run --json` with no `src`, examples, tests, caches, or stale artifacts.

## Delivery Sequence

The work is divided into five independently reviewable implementation subprojects:

1. **MapLibre v6 and core foundation**
   - dependency upgrade, public core entry, schemas, validation, errors, transaction result, and migration of existing context/search/property operations.
2. **Layer and data capabilities**
   - filters, data analysis, duplication, creation, ordering, source lifecycle, adapter convergence, and full/compact AI wrappers.
3. **CLI**
   - validate, inspect, apply, safe I/O, documentation, and process-level tests.
4. **MCP document sessions**
   - stdio/HTTP server, tools/resources, revision store, limits, and SDK integration tests.
5. **Live browser bridge**
   - authenticated WebSocket protocol, live MCP tools, browser client, example, and end-to-end validation.

Each subproject must leave lint, typecheck, build, and relevant tests passing before the next begins. Reviews occur at each boundary. The final repository remains local on `main`, with no remote push or publication.
