# MapLibre v6 Style Platform Design

**Date:** 2026-08-11

**Status:** Approved for implementation planning

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

The npm registry reports `maplibre-gl` 6.3.0, `@maplibre/maplibre-gl-style-spec` 26.2.1, and `@types/geojson` 7946.0.16 as the latest stable releases on 2026-08-12; `@types/node` 22.20.1 is the latest release on the Node 22 declaration line matching the package's minimum supported runtime. MapLibre GL JS v6 is ESM-only, targets ES2022, requires WebGL2, and strengthens several public TypeScript APIs. The package is already ESM and uses named/type imports, so it is structurally suited to the upgrade.

## Goals

1. Upgrade and test against:
   - `maplibre-gl ^6.3.0` as peer and development dependency;
   - `@maplibre/maplibre-gl-style-spec ^26.2.1` as a runtime dependency;
   - `@types/geojson ^7946.0.16` as a runtime declaration dependency while the public declaration graph references Style Spec's ambient `GeoJSON` namespace;
   - `@types/node ^22.20.1` as a root-only runtime declaration dependency while the AI SDK-facing root declaration graph references Node modules or globals; the pure `/core` declarations must not load it;
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
    args.ts
    input.ts
    file-output.ts
    run.ts
    output.ts
  mcp/
    types.ts
    output.ts
    document-handlers.ts
    resources.ts
    session-store.ts
    server-extension.ts
    create-server.ts
    stdio.ts
    http.ts
    main.ts
    live-extension.ts
  bridge/
    protocol.ts
    codec.ts
    resource-policy.ts
    registry.ts
    server.ts
    browser-runtime.ts
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

interface StyleTransactionResultFields {
  style: StyleDocument;
  changedLayers: string[];
  changedSources: string[];
  diff: StyleDiffEntry[];
  warnings: StyleWarning[];
}

type StyleTransactionResult =
  | (StyleTransactionResultFields & { ok: true })
  | (StyleTransactionResultFields & { ok: false; error: StyleToolError });

interface StyleDiffEntry {
  op: 'add' | 'remove' | 'replace' | 'move';
  path: string;
  from?: string;
  before?: JsonValue;
  after?: JsonValue;
  target:
    | { kind: 'style' }
    | { kind: 'layer'; id: string }
    | { kind: 'source'; id: string };
}
```

Diff paths use RFC 6901 JSON Pointer syntax and always address the actual Style JSON document: layers use array indexes and sources use escaped object keys. Every entry carries a semantic `target` identifying the affected style, layer ID, or source ID, so identifiers remain stable and unambiguous even when layer indexes move or IDs contain dots, slashes, or tildes. Diffs are computed structurally from the validated transaction baseline and final document, not assignment attempts: creating or removing a container emits a replayable container-level entry, ordinary arrays replace atomically, the root layer array is reconciled by ID with candidate-aware moves, object keys use a canonical UTF-16 code-unit order, and structurally equal arrays/objects are no-ops. Semantic ownership is derived from the documents rather than guessed from candidates; any layer/source diff whose ID was not marked in the shared operation context is an internal invariant failure, never a silent downgrade to a style target.

`StyleDocument`, operations, errors, and diffs contain JSON values only. Before any Zod property access, an exception-safe descriptor-based full-tree sanitizer rejects non-finite numbers, `undefined`, functions, bigint/symbols, exotic prototypes, hidden properties, sparse/extra-key arrays, accessors, dangerous keys, every repeated object identity (cycle or alias), and reflective Proxy failures. It never invokes getters: it copies descriptor values into a fresh plain JSON tree, and every later schema, clone, hash, diff, and serializer consumes only that sanitized snapshot, so even an otherwise transparent Proxy cannot trigger a `get` trap later. Invalid input returns a stable validation issue rather than throwing. `applyStyleTransaction(style, unknownInput)` is the sole transaction parse/result boundary: it validates the operation array, passes one shared operation context through the exhaustive dispatcher, validates the completed style, and returns either the completed result or the original style. It never partially mutates the caller's document. A failed transaction has empty change lists and diff; a successful final empty diff has empty changed IDs. Whole-document live replacements use a core-owned `finalizeStyleReplacement` so adapters cannot duplicate validation, diff, changed-ID, or error semantics.

The public `StyleDocument` type preserves MapLibre's known Style Specification fields while remaining assignable to the package's recursive JSON-object contract; it must not be expressed as an intersection that makes valid MapLibre properties incompatible with a string index signature. The same exported UTF-8 byte counter and core execution-limit options enforce the default 5 MiB sanitized Style limit, 1 MiB structural-diff limit, and 100-operation transaction limit. CLI, MCP, and live adapters pass explicit lower or higher limits into that one core boundary; they do not reparse transactions, reimplement byte accounting, or admit a document the core rejects.

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
- `setStyleRootProperties`
  - updates optional root style fields such as name, metadata, transition, camera defaults, sprite, glyphs, projection, terrain, light, and sky;
  - rejects `version`, `sources`, and `layers`, which remain transaction-owned structural fields;
  - uses JSON Merge Patch semantics, so `null` removes an optional root field.

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

Inline GeoJSON accepted by `addGeoJsonLayer`, `setGeoJsonData`, or `analyzeGeoJson` first passes the same descriptor-based JSON sanitizer as every other core input, then an RFC 7946 structural schema over that plain snapshot. This covers 2D/3D `bbox` values as exact four- or six-number tuples, feature IDs, properties, and foreign members as well as geometry fields; neither getters nor `toJSON` run. Geometry coordinates must contain finite numeric positions, geometry collections may nest at most 16 levels, property values may nest at most 32 levels, and the default limits are 100,000 features and 1,000,000 coordinate positions in addition to the 5 MiB document limit. Null feature geometries remain valid. Limit violations return `INVALID_INPUT` with a path and do not partially analyze or modify the document.

## MapLibre Adapter and AI SDK Compatibility

Document operations run through the core and are applied to a live map with `map.setStyle(nextStyle, {diff: true})`. The adapter exposes prepare/apply phases: preparation validates and canonicalizes the live baseline, then executes the core transaction once; it returns an opaque, provenance-checked handle backed by private deep-immutable baseline and candidate snapshots rather than a forgeable public object. Prepared application synchronously rechecks that baseline immediately before `setStyle`, consumes only those private snapshots, and never reruns the transaction. Forged, cloned, or caller-mutated handles fail before any Map call. This lets the bridge authorize the exact prepared candidate without a time-of-check/time-of-use gap. A transaction with an empty diff is a successful no-op: it does not call `setStyle` or advance revision. For a real change, the adapter installs completion and error listeners before calling `setStyle`, so synchronous events cannot be missed. Completion requires either the captured `style.load` event or a post-call `isStyleLoaded()` result together with the expected canonical style hash. The default timeout is 10 seconds. Synchronous exceptions remove the pending listeners. On asynchronous failure the adapter makes one best-effort attempt to restore the snapshot using a new, independent listener/timeout lifecycle and reports the rollback outcome. Results explicitly distinguish a confirmed current Style, a pre-operation baseline retained while current state is unknown, and an unavailable Style; live mirrors may adopt only the confirmed-current branch. A successful adapter result means the expected style loaded, not merely that `setStyle` returned.

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

For `--in-place`, the input is read through an opened file descriptor whose device/inode identity is carried to the final pre-rename check; symbolic links and a detected pathname replacement are rejected. Creating a complete separate output or renaming an in-place replacement is a commit point: failures before it preserve the original target state, while a directory-fsync or result-output failure after it exits with a deterministic diagnostic stating that the file was already committed. If stdout itself fails, stderr is the authoritative acknowledgement. The final identity check narrows but cannot eliminate the operating-system race between that check and `rename`.

Standard output contains JSON only. Diagnostics go to standard error. Exit codes are:

- `0`: success;
- `1`: valid invocation with a style or operation semantic failure;
- `2`: argument, JSON parsing, or input-read failure;
- `3`: internal or output-write failure.

`--help` is also a JSON-only success envelope on standard output; the CLI never emits unstructured usage text there.

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

- `maplibre-style://sessions/~{sessionId}`
- `maplibre-style://sessions/~{sessionId}/style`
- `maplibre-style://sessions/~{sessionId}/context`
- `maplibre-style://sessions/~{sessionId}/layers/~{layerId}`
- `maplibre-style://sessions/~{sessionId}/sources/~{sourceId}`
- `maplibre-style://sessions/~{sessionId}/revisions/~{revision}/diff`

They expose session metadata, style, context, individual layers and sources, and bounded revision diffs.

Each advertised RFC 6570 template includes a literal `~` marker immediately before every dynamic path variable. Clients expand the raw semantic value normally; canonical builders perform the same once-encoding. Resolvers split the raw path first, require and remove exactly that literal marker, then decode the remainder once. This preserves valid IDs such as `.`, `..`, `/`, `%`, and `~` without a nonstandard client workaround, URL dot-segment normalization, or a second decode changing routing.

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

Mutations include `expectedRevision`. A mismatch returns `REVISION_CONFLICT` without changing state. Mutations for one session are serialized. Dry runs do not increment the revision. Sessions are in-memory by default, scoped to the server instance, and subject to TTL, count, document-size, operation-count, history, and diff-size limits. The 30-minute TTL is idle time: every successful read, export, or apply refreshes `lastAccessedAt`; failed operations do not. Opening a session sweeps every expired entry before enforcing the session-count limit.

Each document tool publishes one strict root-object Zod input schema and registers that complete schema with the MCP SDK; cross-field rules such as exactly-one-of inputs remain part of the advertised schema rather than being lost by passing only a raw shape. SDK-level schema rejection is a protocol validation response. Once a handler is invoked, all known domain/store failures are converted to the stable tool envelope and unknown failures are redacted to `INTERNAL`; business failures never escape for the SDK to reshape into a generic error.

MCP protocol input is bounded independently of application-session data. Stdio configures the SDK transport's input buffer to the shared 5 MiB message limit, and Streamable HTTP reads and parses every POST through the same bounded UTF-8 body gate before dispatching a parsed request to the SDK. Oversized or malformed requests do not invoke a handler and cannot allocate or strand a provisional transport session.

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

Live resources use `maplibre-style://maps`, `maplibre-style://maps/~{mapId}`, and `maplibre-style://maps/~{mapId}/style` for discovery and read-only snapshots. The literal marker keeps RFC 6570 clients on semantic map IDs. A shared raw resource-URI admission registry runs on the original `resources/read` string in the bounded transport before the MCP SDK constructs a `URL`; document and live extensions register their canonical marked routes there, so literal/encoded dot segments, normalization-changing paths, legacy unmarked routes, and double encoding are rejected before resolver or store access.

Document and live-map MCP extensions receive the same resolved message policy and response boundary from the server factory. No extension may bypass or recreate it. Live read/resource results are budgeted before observable cache/access effects, and every write command proves its fixed bounded receipt fits before browser dispatch; an oversized result therefore cannot hide a committed live mutation behind a transport-level replacement error.

MCP extension registration is synchronous and returns exactly `undefined`. The factory rejects and safely consumes any forged thenable before freezing URI admissions or exposing a connect handle, so an async extension cannot register routes after startup, race the transport boundary, or create an unhandled rejection.

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

The bridge protocol is versioned and uses structured request, response, event, and error messages. Every command frame carries one absolute deadline and has exactly one allowed success-result discriminant; both client and browser runtime reject deadlines that are expired or more than 10 seconds in the future, and correlation validation checks both ID and expected result type before state changes. The browser initiates the WebSocket connection, sends the token in the first authentication frame rather than the URL, registers `mapId`, reports capabilities and the current style revision/hash, and resynchronizes after reconnect. The style hash is SHA-256 over canonical JSON with recursively sorted object keys and preserved array order. The client compares that hash after MapLibre style events; when application code changes the style outside an active bridge command, it advances the local revision and notifies the server before accepting another remote mutation. Resynchronization never accepts a caller-supplied Style: it always reads `Map#getStyle()`, validates the raw value, then hashes the normalized snapshot.

`maplibre-style-mcp` accepts explicit bridge host, port, token, and allowed-origin options. When the token is omitted it generates one and prints the connection information once to standard error, keeping stdio protocol output clean. That single JSON record always identifies `mcpTransport` and the WebSocket URL; HTTP mode also includes the actual bound `mcpUrl`, while stdio mode never invents one.

For mutations:

1. MCP validates tool input; when the request enters the bridge server's per-map queue, the registry stamps one absolute deadline, so queue wait consumes it.
2. When a write reaches the queue head, the registry compares `expectedRevision` and `expectedStyleHash` with its mirror, rejects stale/expired input without sending a frame, or sends the unchanged deadline and preconditions to the registered browser map.
3. After the command reaches the front of the per-map queue, the browser recomputes its current revision/hash and rejects any mismatch before taking a mutation snapshot.
4. The client prepares the requested core transaction exactly once and enforces the resource URL policy against that exact candidate.
5. The MapLibre adapter rechecks the prepared baseline immediately before applying the same candidate, then consumes the remaining shared deadline across completion and rollback; it never starts another full timeout.
6. After the underlying Map operation is settled, the client returns the new revision and style hash. With `style.read` it may include the bounded diff; a write-only client receives only a transaction receipt with revision/hash/applied/no-op fields.
7. The server updates its mirror only from a successful result or a separately validated authoritative snapshot after the underlying Map work settles. A correlated `applyTransaction` failure may retain any sanitized primary error code while carrying a confirmed-current snapshot—for example, when rollback fails and the Map remains on a changed Style. The registry validates correlation, capability, hash, and monotonic revision, merges that authoritative snapshot first, then rejects the caller with the original error. Non-mutation failures may not carry snapshots. The server never applies speculative state; a client-side revision conflict resynchronizes metadata and never retries the mutation automatically.

When an adapter settles with only a pre-operation baseline or no readable Style, the browser marks the map `unknown` before waiting. A separate single-flight recovery lane—independent of the blocked mutation queue—may validate and hash one fresh `Map#getStyle()` snapshot even while the original command remains active. It sends `mapStatus`, then an authoritative `mapSnapshot`, before settling the original correlated failure and releasing either queue. Recovery is coalesced, capability-projected, and cancelled on disconnect; it cannot be implemented by waiting for an external-style callback that the active mutation suppresses.

The 5 MiB Style limit and 5 MiB wire-frame limit are independent. Outbound encoding therefore applies a deterministic, schema-preserving projection before sending: optional Style snapshots and full diff details are removed first, while mutation results degrade to an explicit transaction receipt. Registration, conflict, external-change, post-deadline timeout, and authoritative mutation-failure messages must still fit a metadata-only snapshot containing revision and hash; they are never replaced by a generic size error that would lose mirror reconciliation. A `getStyle` response that cannot carry the requested Style fails with a bounded stable size error and does not change mirror state.

If the browser disconnects, live mutations fail with `BRIDGE_DISCONNECTED`; the server does not silently edit a stale mirror. Caller timeout does not release an unabortable `setStyle`: the browser map queue remains occupied until authoritative settlement/resync, and transport-grace expiry closes the peer and requires a fresh registration. One mutation per map executes at a time. Runtime queries execute in the browser and return bounded results.

## Security

- MCP HTTP and WebSocket servers listen on `127.0.0.1` by default.
- The bridge requires a random 32-byte bearer token (custom tokens must contain 32–256 UTF-8 bytes) and an explicit Origin allowlist for browser clients.
- Browser clients explicitly grant capabilities per map:
  - `style.read`
  - `style.write`
  - `features.query`
  - `runtime.state`
  - `images.write`
  - `network.load`
- Image writes are disabled unless `images.write` is granted.
- `style.write` never implies `style.read`: registration, conflicts, results, and events omit Style contents unless read capability is present. Write-only transaction receipts also omit changed IDs, diff paths, and `before`/`after` values, so a mutation cannot be used to read hidden Style data.
- Capability enforcement is defense in depth: the registry authorizes every command before dispatch and validates every inbound success variant against the capabilities recorded at registration. A write-only peer may return only a receipt for a style mutation; a peer that forges a full result or unauthorized Style snapshot is disconnected before any caller settles or mirror state changes.
- Runtime image URLs resolve against the fixed connection-time `resourceBaseUrl`, and the exact normalized URL approved by policy is the one passed to the loader. Newly introduced or changed relative Style URLs are rejected unconditionally: MapLibre can resolve them lazily after `document.baseURI` changes, so a connection-time origin check cannot safely authorize the eventual request. Existing unchanged baseline values remain eligible for retention. Custom-protocol images require both policy registration and an injected abortable protocol-aware loader.
- A bridge-sourced mutation may retain resource URLs already present in the registered baseline Style. Any newly introduced or changed URL-bearing field requires `network.load` plus an explicit allowed origin/URL pattern. This policy covers root glyph and sprite URLs; GeoJSON `data` URLs; vector, raster, raster-dem, and other source `url`/`tiles` fields; image/video source URLs; runtime image loads; and custom-protocol URLs. HTTP(S) origins are denied by default, `data:` values are size-limited, and other schemes are denied unless the host application explicitly registers and allows the protocol.
- The core and MCP server never execute JavaScript from style expressions; expressions remain JSON data.
- URL query strings and likely credentials are redacted from logs and errors.
- Browser coverage changes the page `<base>` after bridge connection and proves a relative glyph/source mutation is rejected before MapLibre can request either the old or new origin.
- Default limits are 5 MiB per inbound or fully serialized outbound protocol message and 5 MiB per Style document, 100 operations per transaction, 100 features and 1 MiB serialized data per query, 32 sessions, 20 retained revisions per session, 1 MiB per diff, a 30-minute idle session TTL, and 10 seconds per operation. Embedders may lower these values or raise them explicitly. Tool/resource output is budgeted before return and checked again at the transport's final JSON-RPC serialization boundary; a result that cannot fit becomes one bounded, data-free `responseTooLarge` failure without re-executing work or refreshing session state.
- The server factory installs the bounded transport decorator on both the high-level `McpServer.connect` path and its public low-level `McpServer.server.connect` delegate before any extension runs; embedders cannot bypass framing, raw URI admission, or outbound limits by choosing a different SDK connect spelling.
- Streamable HTTP keeps SDK JSON aggregation and event replay disabled; batch responses are emitted as individually bounded SSE messages through the shared decorator, so several legal responses cannot combine into one over-limit JSON body behind the final-size gate.
- Path access is disabled by default in MCP and is canonicalized against configured roots when enabled.
- The bridge rejects duplicate active map IDs unless an explicit replacement handshake succeeds. Each registration carries a persistent random `registrationAttemptId`: replaying the same attempt after a lost success acknowledgement returns the same rotated lease without evicting twice, while a new attempt performs the full replacement checks. Async registration also carries an unforgeable socket-generation liveness token that is rechecked inside the per-map critical section immediately before any lease rotation, old-owner close, or mapping install, so a closed socket cannot become a ghost owner.
- Protocol errors and capability denials do not leak style contents.

## Standalone Browser Example

`examples/browser-bridge` provides a small Vite application that:

- creates a MapLibre GL JS 6 map with an empty local style and inline GeoJSON;
- uses the v6 ESM build's documented default lazy worker lifecycle without a remote or invented worker path;
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
- MCP stdio and Streamable HTTP reject protocol messages above 5 MiB before handler or session allocation;
- near-limit registration, conflict, external-change, and post-deadline timeout frames retain authoritative revision/hash metadata after deterministic projection;
- no mutation of a stale mirror.

### Browser example

- Vite production build;
- a public Playwright script that builds both the package and Vite example itself before each run, then executes Chromium end-to-end with inline GeoJSON and no external tiles; running it twice from a clean checkout cannot consume stale `dist` output;
- MCP-to-bridge-to-Map transaction changes the real map style and advances revision.

### Final package checks

- frozen dependency installation;
- lint;
- typecheck;
- build;
- all unit and integration tests;
- browser example build and end-to-end test;
- root and subpath ESM import smoke tests;
- strict real-tarball declaration smokes in isolated consumers: `/core` under NodeNext without DOM/Node globals, root/AI under Bundler with explicit Node declarations, `/maplibre` and `/bridge` under a Node-free browser Bundler program, and `/mcp` under its own NodeNext program; all keep `skipLibCheck:false`;
- CLI and MCP binary smoke tests;
- a real `npm pack --json` artifact with no `src`, examples, tests, caches, or stale artifacts, installed into a temporary bare consumer that exercises every public subpath and binary (with an additional dry-run listing allowed as a diagnostic).

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
