# maplibre-style-tools

AI SDK tools for inspecting and editing MapLibre GL styles.

The package exposes a compact tool set for token-efficient workflows and a full tool set for broad style editing. It is currently maintained as a standalone local project and has not been published to npm.

## Requirements

- Node.js 22.13 or newer
- `maplibre-gl` 6.3 or a compatible release
- An AI SDK 6 tool consumer

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

## Compact tools

```ts
import { createCompactMapLibreStyleTools } from 'maplibre-style-tools';

const tools = createCompactMapLibreStyleTools({
  getMap: () => map,
  getContext: () => ({
    activeSourceId: 'basemap',
    selectedLayerId: 'road-primary',
  }),
});
```

The compact factory provides style context, layer search and inspection, validated batch operations, and patch JSON validation.

## Full tools

```ts
import { createMapLibreStyleTools } from 'maplibre-style-tools';

const tools = createMapLibreStyleTools({
  getMap: () => map,
});
```

The full factory exposes detailed tools for layers, sources, paint and layout properties, filters, zoom ranges, metadata, camera, terrain, sprites, glyphs, images, and other MapLibre style features.

## Entry points

The package has four supported entry points:

- `maplibre-style-tools` is the compatibility facade and exports both factories plus the legacy root types.
- `maplibre-style-tools/core` is the transport-neutral transaction, validation, GeoJSON, analysis, and discovery API. It requires neither DOM nor Node ambient types.
- `maplibre-style-tools/maplibre` applies prepared transactions to MapLibre maps and exposes bounded live-map commands. It may use DOM types but does not load Node ambient types.
- `maplibre-style-tools/ai` exports both AI SDK factories, their strict input schemas, compatibility parsers, and the common result envelope.

Only the root and `/ai` declaration graphs intentionally load Node types required by the AI SDK. Import `/core` or `/maplibre` directly when that ambient dependency is undesirable.

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

The root `StyleOperation` API and compact `operationsJson` input remain
legacy-compatible. The `/core` API requires an operation discriminator and
returns RFC 6901 diffs. Its defaults are a 5 MiB Style, 1 MiB diff, and 100
operations; `StyleTransactionOptions` can override those limits explicitly.
Adapters should pass unknown transactions to this boundary rather than
pre-parsing them.

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

Layer filters support `replace`, `and`, `or`, and `clear`. GeoJSON source filters support `replace` and `clear`. Composition keeps legacy property filters and expression filters as distinct syntax families and rejects mixing them. A failed operation rolls back the entire candidate; successful results contain replayable RFC 6901 diffs and exact changed layer/source IDs.

`setStyleRootProperties` applies recursive RFC 7396 merge-patch behavior to allowed root fields: object keys merge, `null` deletes, and arrays/scalars replace. It cannot modify `version`, `sources`, or `layers`. This is intentionally different from legacy `setMapLight`, which performs a one-level patch: omitted light keys survive, a supplied nested object replaces that top-level setting wholesale, and `null` resets only that supplied setting.

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

### AI result and compatibility contracts

Structured and legacy tools return one discriminated envelope:

```ts
type CommonResultInput<TData, TStyle> =
  | { success: true; message: string; data?: TData; style?: TStyle }
  | {
      success: false;
      message: string;
      data?: TData;
      style?: TStyle;
      error: StyleToolError;
    };
```

On failure, `error` is an authentic package-created `StyleToolError`; it is absent from success. The legacy outer `style` remains the application state returned by `getState`, while live authoritative Map Style data is reported under the structured `data` result.

The six document source routes remain exact and non-overlapping:

- `addSource` → core `addSource`;
- `removeSource` → core `removeSource`;
- `updateGeoJsonSourceData` with `setData` → core `setGeoJsonData`;
- `setGeoJsonClusterOptions` → core `patchSource`;
- `patchSourceDefinition` → legacy recursive deep merge (where `null` is retained as a value);
- `replaceSourceDefinition` → whole source replacement.

`updateGeoJsonSourceData` with `updateData` and `setSourceTileLodParams` are runtime-only and never enter the document transaction dispatcher.

String-encoded JSON fields such as `operationsJson`, `filterJson`, and `sourceJson` remain supported for compatibility but are deprecated. Prefer the structured transaction and structured tool inputs: they preserve types, avoid double encoding, and fail unknown keys at the outer schema before a handler or Map is invoked.

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
including the `--help` envelope; diagnostics go to stderr. Exit codes are `0`
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
