# MapLibre Layer and Data Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the complete layer, filter, GeoJSON, source, live-map, and AI SDK capability surface from subproject 2 while preserving every existing full and compact tool contract.

**Architecture:** Extend the transport-neutral core with a schema-validated discriminated `StyleOperation` union and focused filter/layer/source handlers. Cross-cutting GeoJSON validation, search, transaction dispatch, MapLibre completion/rollback, bounded runtime queries, and AI compatibility remain separate modules with one-way dependencies from core to adapters to AI SDK. Existing factories and string-encoded inputs remain compatibility facades while new structured tools share the same core operations and result envelope.

**Tech Stack:** TypeScript 5.9, Node.js `node:test`, Zod 4, MapLibre GL JS 6.3.0, MapLibre Style Spec 26.2.1, AI SDK 6, ESM/NodeNext.

## Global Constraints

- Execute after standalone extraction and the v6/core foundation. The fixed dependency DAG is `standalone extraction → core foundation → layer/data → CLI → MCP → live bridge`; CLI and MCP consume APIs created here, and live bridge consumes both this adapter and MCP.
- Use `maplibre-gl ^6.3.0` as peer and development dependency, `@maplibre/maplibre-gl-style-spec ^26.2.1` as runtime dependency, and Node.js `>=22.13.0`.
- The core may import Zod and MapLibre Style Spec, but must not import `ai`, `maplibre-gl`, DOM types, Node filesystem APIs, MCP SDK, or WebSocket implementations.
- All public input passes exported Zod schemas; TypeScript assertions alone are not validation.
- Public operation fields are `JsonValue`/`JsonObject`, never `Record<string, unknown>`. Reject cyclic/exotic values and own keys named `__proto__`, `prototype`, or `constructor` before cloning, merge-patching, hashing, or mutation; Merge Patch iterates own keys only.
- Every transaction is immutable and all-or-nothing. Failure returns the original style reference/value, empty `changedLayers`, empty `changedSources`, and empty `diff`.
- The foundation transaction resolves `Partial<CoreExecutionLimits>` exactly once, creates one `OperationContext` whose `readonly limits` contains the three required resolved positive-safe-integer values, and passes that same context to every handler. Every handler returns `changed:boolean`, marks only structurally changed candidate layer/source IDs, and the coordinator alone computes the final replayable before/after diff. A successful mutation may not produce an empty diff, and a final empty diff must produce empty changed-ID lists.
- Diff paths use RFC 6901 JSON Pointer escaping. IDs containing `/` and `~` must remain unambiguous.
- Inline GeoJSON is RFC 7946 structured data with finite coordinate positions, geometry nesting at most 16, property nesting at most 32, at most 100,000 features, at most 1,000,000 coordinate positions, and a standalone default 5 MiB document limit. Null feature geometries are valid. `inlineGeoJsonSchema` is the descriptor-sanitized structural boundary and must not bake in an aggregate byte/count default; `validateInlineGeoJson` owns those configurable aggregate limits. Inside a transaction, `setGeoJsonData` and `addGeoJsonLayer` override only `GeoJsonLimits.maxBytes` with the already resolved `context.limits.maxStyleBytes`; they never silently reapply the 5 MiB default after a caller lowers or raises the transaction limit.
- Reuse the foundation `jsonUtf8ByteLength(value: JsonValue)` implementation and `DEFAULT_MAX_STYLE_BYTES`/`DEFAULT_MAX_DIFF_BYTES` constants for all serialized-byte limits; this subproject must not create a second UTF-8 counter or duplicate those byte constants.
- Pure core functions never fetch Style JSON, TileJSON, GeoJSON, tiles, sprites, glyphs, or images.
- A transaction contains at most 100 operations by default; explicit positive-safe-integer core/adaptor configuration may lower or raise that bound. Live feature queries return at most 100 features and at most 1 MiB serialized data by default. Live style application times out after 10 seconds by default.
- Existing `createMapLibreStyleTools` and `createCompactMapLibreStyleTools` factory names, all existing 53 full tool names, all existing 5 compact tool names, and existing JSON-string arguments remain available.
- Preserve the legacy `diff` flag exactly. Its default remains `true`; `diff:false` is forwarded to the completion-aware adapter for the candidate apply and any rollback, still waits for confirmed completion, and never disables the core semantic diff returned to the caller. It is not a dry run. A structural no-op still skips `Map#setStyle` for either value.
- The full and compact factories return one common structured AI result envelope. Existing `success`, `message`, and full-tool `style` fields are preserved.
- Runtime-only feature state, global state, image, sprite, and feature-query behavior stays in the MapLibre adapter; document edits go through the core transaction.
- `setStyleRootProperties` is a pure core operation. It rejects `version`, `sources`, and `layers`, applies JSON Merge Patch semantics, and deletes root fields whose patch value is `null`.
- Legacy `setMapLight` does not reuse that recursive Merge Patch operation: its dedicated compatibility variant shallowly replaces only supplied top-level light keys, removes a supplied null key to reset it, and preserves omitted top-level light keys.
- Work only in `/Users/zhang/code/maplibre-style-tools`. Do not modify `/Users/zhang/code/ai-style-editor`.
- Before Task 1, record `rtk git rev-parse HEAD`, `rtk git status --short`, and `rtk git -C /Users/zhang/code/ai-style-editor status --short` verbatim in the execution report; Task 17 compares against this scope baseline.
- Run every shell command with the `rtk` prefix.

---

## Foundation Contract Expected from Subproject 1

This plan starts after the MapLibre v6/core-foundation subproject is green. The following interfaces are consumed unchanged:

```ts
export type StyleToolError = {
  code: StyleToolErrorCode;
  message: string;
  path?: string;
  details?: JsonObject;
};

type StyleTransactionResultFields = {
  style: StyleDocument;
  changedLayers: string[];
  changedSources: string[];
  diff: StyleDiffEntry[];
  warnings: StyleWarning[];
};
export type StyleTransactionResult =
  | (StyleTransactionResultFields & { ok: true })
  | (StyleTransactionResultFields & { ok: false; error: StyleToolError });

export type StyleTransaction = {
  operations: StyleOperation[];
  validate?: boolean;
};

export function validateStyleDocument(
  style: unknown,
  options?: StyleValidationOptions
): StyleValidationResult;

export function applyStyleTransaction(
  style: StyleDocument,
  transaction: unknown,
  options?: StyleTransactionOptions
): StyleTransactionResult;

export interface CoreExecutionLimits {
  maxStyleBytes: number;
  maxDiffBytes: number;
  maxOperations: number;
}
export type StyleTransactionOptions = Partial<CoreExecutionLimits>;
export type StyleReplacementOptions = Partial<Pick<
  CoreExecutionLimits,
  'maxStyleBytes' | 'maxDiffBytes'
>>;

export function finalizeStyleReplacement(
  original: StyleDocument,
  replacement: unknown,
  options?: StyleReplacementOptions
): StyleTransactionResult;

export interface OperationContext {
  readonly limits: Readonly<CoreExecutionLimits>;
  changedLayerIds: Set<string>;
  changedSourceIds: Set<string>;
  warnings: StyleWarning[];
}

export type OperationApplyResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: StyleToolError };

export const DEFAULT_MAX_STYLE_BYTES: number;
export const DEFAULT_MAX_DIFF_BYTES: number;
export const DEFAULT_MAX_OPERATIONS: number;
export function jsonUtf8ByteLength(value: JsonValue): number;
```

Subproject 1 also supplies `setLayerProperties`, canonical full-style validation, JSON Pointer diff generation, stable errors, immutable rollback, `buildStyleContext`, and `searchLayers`. When a path below already exists from subproject 1, extend it in place rather than creating a parallel implementation.

## Operation Module Dependency Order

```text
core/types.ts + core/errors.ts
          ↓
core/schemas.ts
          ↓
core/operations/shared.ts + core/geojson.ts
          ↓
filters.ts       sources.ts       layers.ts
      \              |              /
       \----- transaction.ts -------/
                      ↓
       search.ts + geojson-analysis.ts
                      ↓
 adapters/maplibre/map-adapter.ts + feature-query.ts + runtime-commands.ts
                      ↓
 ai-sdk/compatibility.ts + ai-sdk/schemas.ts
                      ↓
 ai-sdk/full-tools.ts + ai-sdk/compact-tools.ts
```

`core/schemas.ts` must not import operation handlers. Handler modules type-import the union and never import `transaction.ts`. `transaction.ts` owns the exhaustive `switch (operation.op)` and an `assertNever` default, so a schema variant cannot be accepted without a compiled handler.

Every checkbox below is one 2–5 minute action. Keep the red/green order within a task, and do not combine commits from adjacent tasks. For every new mutation variant, its focused test must run through `applyStyleTransaction` and assert the exact final `diff`, `target`, `changedLayers`, and `changedSources` alongside rollback/no-op behavior; a handler-only assertion is insufficient.

### Task 1: Freeze the 53+5 Compatibility Surface

**Files:**
- Create: `src/ai-sdk/compatibility.test.ts`
- Create: `src/ai-sdk/tool-contracts.ts`
- Modify: `src/index.ts`
- Modify: `src/tools/compact-tools.ts`

**Interfaces:**
- Consumes: existing `createMapLibreStyleTools(options)` and `createCompactMapLibreStyleTools(options)`.
- Produces: `FULL_LEGACY_TOOL_NAMES` as a readonly 53-name tuple and `COMPACT_LEGACY_TOOL_NAMES` as a readonly 5-name tuple; no behavior change.

- [ ] **Step 1: Write the failing exact-name contract test**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createCompactMapLibreStyleTools,
  createMapLibreStyleTools,
} from '../index.js';
import {
  COMPACT_LEGACY_TOOL_NAMES,
  FULL_LEGACY_TOOL_NAMES,
} from './tool-contracts.js';

const noMap = () => null;

describe('legacy AI tool contracts', () => {
  it('preserves all 53 full tool names', () => {
    const tools = createMapLibreStyleTools({ getMap: noMap });
    assert.deepEqual(Object.keys(tools).filter((name) => FULL_LEGACY_TOOL_NAMES.includes(name as never)), [...FULL_LEGACY_TOOL_NAMES]);
    assert.equal(FULL_LEGACY_TOOL_NAMES.length, 53);
  });

  it('preserves all 5 compact tool names', () => {
    const tools = createCompactMapLibreStyleTools({ getMap: noMap });
    assert.deepEqual(Object.keys(tools).filter((name) => COMPACT_LEGACY_TOOL_NAMES.includes(name as never)), [...COMPACT_LEGACY_TOOL_NAMES]);
    assert.equal(COMPACT_LEGACY_TOOL_NAMES.length, 5);
  });
});
```

- [ ] **Step 2: Compile the test and verify the missing module failure**

Run: `rtk pnpm exec tsc -p tsconfig.test.json`

Expected: FAIL because `src/ai-sdk/tool-contracts.ts` does not exist.

- [ ] **Step 3: Add the two exact readonly tuples**

Create `src/ai-sdk/tool-contracts.ts` with the current object order; do not sort either tuple:

```ts
export const FULL_LEGACY_TOOL_NAMES = [
  'listAllLayers',
  'listAllSources',
  'inspectLayerStyle',
  'inspectSource',
  'setLayerPaintProperty',
  'setLayerLayoutProperty',
  'setLayerPaintPropertySmart',
  'setLayerLayoutPropertySmart',
  'batchSetLayerPaintPropertiesSmart',
  'batchSetLayerLayoutPropertiesSmart',
  'batchSetLayerPaintProperties',
  'batchSetLayerLayoutProperties',
  'clearLayerPaintProperty',
  'clearLayerLayoutProperty',
  'setLayerFilter',
  'setLayerZoomRange',
  'setLayerVisibility',
  'addLayer',
  'moveLayer',
  'removeLayer',
  'patchLayerDefinition',
  'replaceLayerDefinition',
  'addSource',
  'removeSource',
  'updateGeoJsonSourceData',
  'setGeoJsonClusterOptions',
  'setSourceTileLodParams',
  'patchSourceDefinition',
  'replaceSourceDefinition',
  'setStyleJsonOrUrl',
  'inspectRootStyle',
  'setStyleName',
  'setStyleMetadata',
  'setStyleTransition',
  'setStyleCameraDefaults',
  'validateStyleJson',
  'validateCurrentMapStyle',
  'setMapLight',
  'setMapSky',
  'setMapProjection',
  'setMapTerrain',
  'setMapGlyphs',
  'setMapSprite',
  'listSprites',
  'addSprite',
  'removeSprite',
  'setFeatureState',
  'removeFeatureState',
  'setGlobalStateProperty',
  'listImages',
  'addImageFromUrl',
  'removeImage',
  'getLayerCount',
] as const;

export const COMPACT_LEGACY_TOOL_NAMES = [
  'getStyleContext',
  'searchLayers',
  'inspectLayersCompact',
  'applyStyleOperations',
  'validateStylePatchJson',
] as const;
```

Re-export the tuples from the existing modules so the test resolves through stable ESM paths.

- [ ] **Step 4: Run the focused compatibility test**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/ai-sdk/compatibility.test.js`

Expected: PASS with 53 full and 5 compact names.

- [ ] **Step 5: Commit the compatibility lock**

```bash
rtk git add src/ai-sdk/tool-contracts.ts src/ai-sdk/compatibility.test.ts src/index.ts src/tools/compact-tools.ts
rtk git commit -m "test: freeze AI tool compatibility surface"
```

### Task 2: Add Shared Merge-Patch, Placement, and Root-Style Operation

**Files:**
- Create: `src/core/operations/shared.ts`
- Create: `src/core/operations/root.ts`
- Create: `src/core/operations/root.test.ts`
- Create: `src/core/style-operation-json-contract.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/schemas.ts`
- Modify: `src/core/transaction.ts`
- Modify: `src/core/index.ts`

**Interfaces:**
- Consumes: foundation `StyleDocument`, `StyleOperation`, `StyleTransactionResult`, validation, and diff builder.
- Produces:

```ts
export type Placement = {
  beforeId?: string;
  afterId?: string;
};

export type SetStyleRootPropertiesOperation = {
  op: 'setStyleRootProperties';
  properties: JsonObject;
};

export function applyMergePatch(target: JsonValue, patch: JsonValue): JsonValue;
export function resolveInsertionIndex(layers: StyleLayer[], placement: Placement, defaultIndex: number): number;
export function applyRootOperation(style: StyleDocument, operation: SetStyleRootPropertiesOperation, context: OperationContext): OperationApplyResult;
```

- [ ] **Step 1: Write failing root-operation tests**

```ts
it('merge-patches allowed root fields and removes null fields', () => {
  const style = makeStyle({
    name: 'Before',
    metadata: { owner: 'team', obsolete: true },
    glyphs: 'https://example.com/{fontstack}/{range}.pbf',
  });
  const result = applyStyleTransaction(style, {
    operations: [{
      op: 'setStyleRootProperties',
      properties: {
        name: 'After',
        metadata: { obsolete: null, reviewed: true },
        glyphs: null,
      },
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.style.name, 'After');
  assert.deepEqual(result.style.metadata, { owner: 'team', reviewed: true });
  assert.equal('glyphs' in result.style, false);
  assert.equal(style.name, 'Before');
});

for (const forbidden of ['version', 'sources', 'layers'] as const) {
  it(`rejects protected root key ${forbidden}`, () => {
    const style = makeStyle();
    const result = applyStyleTransaction(style, {
      operations: [{ op: 'setStyleRootProperties', properties: { [forbidden]: null } }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, 'INVALID_INPUT');
    assert.strictEqual(result.style, style);
    assert.deepEqual(result.diff, []);
  });
}
```

Create the permanent compile contract in `src/core/style-operation-json-contract.test.ts`:

```ts
import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { JsonObject, StyleOperation } from './types.js';

type AssertTrue<T extends true> = T;
type StyleOperationIsJsonObject = AssertTrue<
  StyleOperation extends JsonObject ? true : false
>;

it('keeps every StyleOperation variant JSON-backed', () => {
  const compiled: StyleOperationIsJsonObject = true;
  assert.equal(compiled, true);
});
```

- [ ] **Step 2: Run the focused test and verify schema rejection**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/operations/root.test.js .tmp/test-dist/core/style-operation-json-contract.test.js`

Expected: FAIL because `setStyleRootProperties` is absent from the operation union and the operation contract cannot compile while any variant remains an interface without JSON-object assignability.

- [ ] **Step 3: Implement shared JSON Merge Patch and placement validation**

Implement RFC 7396 object behavior in `shared.ts`: a non-object patch replaces the value, object keys recurse, and `null` deletes the key. Iterate own keys only and reject `__proto__`, `prototype`, and `constructor` at the schema boundary and defensively inside this helper. Tests must cover a `JSON.parse`-created dangerous key, a cyclic patch, class/Date values, and prove `Object.prototype` is unchanged. `resolveInsertionIndex` rejects simultaneous `beforeId`/`afterId`, rejects missing anchors, and converts `afterId` to `anchorIndex + 1`.

- [ ] **Step 4: Add the strict root schema and exhaustive transaction branch**

The root schema must be `.strict()`, consume the foundation JSON-safe object schema, and refine `Object.keys(properties)` against `new Set(['version', 'sources', 'layers'])`. Define `Placement` and `SetStyleRootPropertiesOperation` as the closed type aliases shown above, with no open index signature. Add `case 'setStyleRootProperties': result = applyRootOperation(nextStyle, operation, context); break;` before the transaction's `assertNever` branch. The handler returns `changed:false` for a structural no-op; the coordinator generates the root `{kind:'style'}` diff after all operations. Keep `StyleOperationIsJsonObject` compiling after the union expansion.

- [ ] **Step 5: Run focused and transaction tests**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/operations/root.test.js .tmp/test-dist/core/style-operation-json-contract.test.js .tmp/test-dist/core/transaction.test.js`

Expected: PASS; the diff contains `/name`, `/metadata/obsolete`, `/metadata/reviewed`, and `/glyphs` entries, `target:{kind:'style'}`, and both changed-ID arrays remain empty.

- [ ] **Step 6: Commit the root operation**

```bash
rtk git add src/core/operations/shared.ts src/core/operations/root.ts src/core/operations/root.test.ts src/core/style-operation-json-contract.test.ts src/core/types.ts src/core/schemas.ts src/core/transaction.ts src/core/index.ts
rtk git commit -m "feat: add JSON-backed root style operation"
```

### Task 3: Implement Layer and GeoJSON Source Filters

**Files:**
- Create: `src/core/operations/filters.ts`
- Create: `src/core/operations/filters.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/schemas.ts`
- Modify: `src/core/transaction.ts`
- Modify: `src/core/index.ts`
- Modify: `src/core/style-operation-json-contract.test.ts`
- Modify: `src/engine/style-operations.ts`

**Interfaces:**
- Consumes: shared lookup/error helpers, canonical completed-style validation, transaction rollback.
- Produces:

```ts
export type SetLayerFilterOperation =
  | { op: 'setLayerFilter'; layerId: string; mode: 'replace' | 'and' | 'or'; filter: JsonValue[] }
  | { op: 'setLayerFilter'; layerId: string; mode: 'clear' };

export type SetGeoJsonSourceFilterOperation =
  | { op: 'setGeoJsonSourceFilter'; sourceId: string; mode: 'replace'; filter: JsonValue[] }
  | { op: 'setGeoJsonSourceFilter'; sourceId: string; mode: 'clear' };

export function composeFilter(existing: JsonValue[] | undefined, incoming: JsonValue[], mode: 'replace' | 'and' | 'or'): JsonValue[];
```

- [ ] **Step 1: Write failing filter-composition tests**

Add table-driven assertions for replace, clear, and/or with no existing filter, and/or with an existing filter, flattening nested matching `all`/`any`, and preserving opposite groups. Include a transaction containing a valid first operation followed by a mixed legacy/expression filter and assert complete rollback.

```ts
assert.deepEqual(composeFilter(['all', ['==', ['get', 'class'], 'road']], ['==', ['get', 'rank'], 1], 'and'), [
  'all',
  ['==', ['get', 'class'], 'road'],
  ['==', ['get', 'rank'], 1],
]);
```

In `style-operation-json-contract.test.ts`, add this value, then retain the whole-union assertion `StyleOperation extends JsonObject ? true : false`:

```ts
const setLayerFilterJsonContract = {
  op: 'setLayerFilter',
  layerId: 'roads',
  mode: 'clear',
} satisfies StyleOperation;
```

- [ ] **Step 2: Add failing GeoJSON source-filter tests**

Test replacement and clearing on `{type:'geojson'}`, rejection on vector/raster sources with `UNSUPPORTED_SOURCE`, missing source with `NOT_FOUND`, and proof that layer filters remain unchanged. For every success, assert the correct candidate ID is marked and the public transaction result has an exact source/layer semantic target, changed-ID list, and non-empty replayable diff.

- [ ] **Step 3: Run the focused test and confirm unknown-op failures**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/operations/filters.test.js .tmp/test-dist/core/style-operation-json-contract.test.js`

Expected: FAIL because both filter variants and `composeFilter` are missing.

- [ ] **Step 4: Implement deterministic composition and syntax-family detection**

Treat legacy property operands such as `['==', 'class', 'road']` and expression operands such as `['==', ['get', 'class'], 'road']` as separate families. Reject a composed pair when exactly one side is legacy. Flatten only when the outer operator and nested first element are both `all` or both `any`; do not simplify any other expression. Each handler compares before/after structurally, returns `changed`, and marks exactly one layer or source candidate in the shared context only on change.

- [ ] **Step 5: Register schemas and run filter plus transaction tests**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/operations/filters.test.js .tmp/test-dist/core/style-operation-json-contract.test.js .tmp/test-dist/core/transaction.test.js`

Expected: PASS with immutable rollback, canonical style validation, exact changed IDs, and replayable filter diffs. In the same step, replace the foundation's temporary legacy-filter shim with normalization to `setLayerFilter`; delete all direct filter mutation from `src/engine/style-operations.ts` and keep its legacy envelope mapping only.

- [ ] **Step 6: Commit filters**

```bash
rtk git add src/core/operations/filters.ts src/core/operations/filters.test.ts src/core/style-operation-json-contract.test.ts src/core/types.ts src/core/schemas.ts src/core/transaction.ts src/core/index.ts src/engine/style-operations.ts
rtk git commit -m "feat: add JSON-backed filter operations"
```

### Task 4: Validate Bounded RFC 7946 GeoJSON

**Files:**
- Create: `src/core/geojson.ts`
- Create: `src/core/geojson.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/schemas.ts`
- Modify: `src/core/index.ts`

**Interfaces:**
- Consumes: foundation `jsonValueSchema` descriptor sanitizer, `jsonValuesEqual`, `jsonUtf8ByteLength`, `DEFAULT_MAX_STYLE_BYTES`, `StyleToolError`, and stable `INVALID_INPUT` creation. `src/core/utf8.ts` remains foundation-owned and is neither recreated nor modified here.
- Produces:

```ts
export type GeoJsonPosition = [number, number, ...number[]];
export type GeoJsonBbox2D = [number, number, number, number];
export type GeoJsonBbox3D = [number, number, number, number, number, number];
export type GeoJsonBbox = GeoJsonBbox2D | GeoJsonBbox3D;
export type GeoJsonLineCoordinates = [GeoJsonPosition, GeoJsonPosition, ...GeoJsonPosition[]];
export type GeoJsonLinearRing = [
  GeoJsonPosition,
  GeoJsonPosition,
  GeoJsonPosition,
  GeoJsonPosition,
  ...GeoJsonPosition[],
];
export type GeoJsonPolygonCoordinates = GeoJsonLinearRing[];

export type GeoJsonPoint = JsonObject & {
  type: 'Point';
  coordinates: GeoJsonPosition;
  bbox?: GeoJsonBbox;
};
export type GeoJsonMultiPoint = JsonObject & {
  type: 'MultiPoint';
  coordinates: GeoJsonPosition[];
  bbox?: GeoJsonBbox;
};
export type GeoJsonLineString = JsonObject & {
  type: 'LineString';
  coordinates: GeoJsonLineCoordinates;
  bbox?: GeoJsonBbox;
};
export type GeoJsonMultiLineString = JsonObject & {
  type: 'MultiLineString';
  coordinates: GeoJsonLineCoordinates[];
  bbox?: GeoJsonBbox;
};
export type GeoJsonPolygon = JsonObject & {
  type: 'Polygon';
  coordinates: GeoJsonPolygonCoordinates;
  bbox?: GeoJsonBbox;
};
export type GeoJsonMultiPolygon = JsonObject & {
  type: 'MultiPolygon';
  coordinates: GeoJsonPolygonCoordinates[];
  bbox?: GeoJsonBbox;
};
export type GeoJsonGeometryCollection = JsonObject & {
  type: 'GeometryCollection';
  geometries: GeoJsonGeometry[];
  bbox?: GeoJsonBbox;
};
export type GeoJsonGeometry =
  | GeoJsonPoint
  | GeoJsonMultiPoint
  | GeoJsonLineString
  | GeoJsonMultiLineString
  | GeoJsonPolygon
  | GeoJsonMultiPolygon
  | GeoJsonGeometryCollection;

export type GeoJsonFeatureId = string | number;
export type GeoJsonFeature<G extends GeoJsonGeometry | null = GeoJsonGeometry | null> = JsonObject & {
  type: 'Feature';
  id?: GeoJsonFeatureId;
  geometry: G;
  properties: JsonObject | null;
  bbox?: GeoJsonBbox;
};
export type GeoJsonFeatureCollection = JsonObject & {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
  bbox?: GeoJsonBbox;
};

export interface GeoJsonLimits {
  maxBytes: number;
  maxFeatures: number;
  maxCoordinatePositions: number;
  maxGeometryDepth: number;
  maxPropertyDepth: number;
}

export const DEFAULT_GEOJSON_LIMITS: GeoJsonLimits;
export type InlineGeoJson = GeoJsonFeature | GeoJsonFeatureCollection | GeoJsonGeometry;
export const geoJsonLimitsSchema: z.ZodType<Partial<GeoJsonLimits>>;
export const inlineGeoJsonSchema: z.ZodType<InlineGeoJson>;
export type InlineGeoJsonValidationResult =
  | { ok: true; value: InlineGeoJson; featureCount: number; coordinatePositionCount: number }
  | { ok: false; error: StyleToolError };
export function validateInlineGeoJson(value: unknown, limits?: Partial<GeoJsonLimits>):
  InlineGeoJsonValidationResult;
```

- [ ] **Step 1: Write structural, UTF-8-size, and finite-coordinate failure tests**

Cover every geometry type, Feature, FeatureCollection, GeometryCollection, null Feature geometry, geometry-specific coordinate nesting, malformed coordinates, `NaN`, `Infinity`, invalid or missing `properties`, and error JSON Pointer paths. Assert LineStrings have at least two positions; every Polygon/MultiPolygon linear ring has at least four positions and its last position is structurally identical to its first (including any altitude components); winding order is not rewritten. Include third-or-later position components that are non-numeric, `NaN`, or infinite, proving every component is checked rather than only longitude/latitude. Verify `id` accepts only a finite number or string. Verify every `bbox` is exactly the MapLibre/@types GeoJSON-compatible four-number 2D tuple or six-number 3D tuple and every element is finite; reject nested arrays, lengths 0–3, 5, and 7+, non-numbers, and non-finite components at the exact `/bbox` or `/bbox/{index}` path. GeoJSON objects deliberately permit RFC 7946 foreign members, but the known members above retain their exact required shapes.

Add adversarial values independently in `properties`, `bbox`, `id`, and a foreign member: an accessor/toJSON function, `Date`, hidden property, `undefined`, non-finite number, alias, cycle, revoked Proxy, and a transparent Proxy with a throwing `get` trap. Assert `inlineGeoJsonSchema.safeParse` and `validateInlineGeoJson` reject invalid values without invoking code, accept the transparent descriptor-safe Proxy into a newly allocated plain snapshot with zero `get` calls, and every later discriminator/geometry/property/limit walk reads only that snapshot. Add integration byte-boundary cases containing ASCII, BMP, astral code points, quotes, backslashes, control characters, and unpaired surrogates; expected values include JSON quoting/escaping and are compared against the foundation `jsonUtf8ByteLength`, never a local counter, DOM `TextEncoder`, or Node `Buffer`.

- [ ] **Step 2: Write exact-limit boundary tests**

Use lowered per-test limits to assert success exactly at and failure one above feature count, coordinate positions, geometry depth, property depth, and serialized bytes. Define geometry depth as `1` for a root/Feature geometry and increment it only when entering a `GeometryCollection` child. Define property depth as `0` at the Feature `properties` object and increment it when entering each nested object/array value. Assert invalid limit overrides, unknown limit keys, zero, negative, fractional, non-finite, and accessor-bearing limit objects fail before GeoJSON traversal. This exercises the production counting algorithm without allocating million-item fixtures.

- [ ] **Step 3: Run the focused test and verify the missing validator failure**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/geojson.test.js`

Expected: FAIL because `validateInlineGeoJson` is undefined.

- [ ] **Step 4: Sanitize first, then add the GeoJSON discriminator and object-shape checks**

Before reading `type` or any other member, make exported `inlineGeoJsonSchema` pass the complete unknown input through foundation `jsonValueSchema.safeParse`, normalize failure paths into the stable `INVALID_INPUT` envelope, and then perform the RFC shape checks over that plain result. Retain only its newly allocated plain JSON output; never inspect, serialize, or return the caller's original graph. This single front door covers required fields, `bbox`, feature `id`, and every RFC 7946 foreign member, not just coordinates/properties. Implement accepted top-level `Feature`, `FeatureCollection`, and seven geometry discriminators; enforce required Feature `geometry`/`properties`, FeatureCollection `features`, geometry `coordinates`/`geometries`, string-or-number IDs, and the exact finite 4-or-6-element `bbox` union. Foreign members remain allowed only because RFC 7946 explicitly permits them, but they are still JSON-sanitized. Return `INVALID_INPUT` with `/type`, `/features`, `/geometry`, `/properties`, `/id`, `/bbox`, or `/coordinates` as soon as a known member has the wrong shape. Keep this exported schema structural: it may share the safe RFC walker, but it must not capture `DEFAULT_GEOJSON_LIMITS` or reject an otherwise valid document merely because it crosses a configurable aggregate byte/feature/coordinate/depth budget. Those budgets are applied only by `validateInlineGeoJson(value, limits)` after its limits argument is parsed.

Build `geoJsonLimitsSchema` as a descriptor-sanitized `.strict().partial()` object whose supplied values are positive safe integers, parse it before parsing the document, and merge it over `DEFAULT_GEOJSON_LIMITS`. Define `DEFAULT_GEOJSON_LIMITS.maxBytes` by reference to `DEFAULT_MAX_STYLE_BYTES`, not a repeated numeric literal. Both public schemas and all DTO/result types above are exported through `src/core/index.ts`.

- [ ] **Step 5: Add iterative geometry and coordinate counting**

Use an explicit stack carrying `{value, path, geometryDepth, coordinateRole}` and the exact coordinate nesting required by Point, MultiPoint/LineString, MultiLineString/Polygon, and MultiPolygon. A terminal position has length at least two and every component is a finite number; reject any non-numeric or non-finite third-or-later component as well as a tuple/array at the wrong nesting level. Enforce the two-position LineString and four-position closed-linear-ring rules before pushing positions; compare ring endpoints with foundation `jsonValuesEqual` and never auto-close or mutate a ring. Count accepted positions, count Feature objects once, start each root/Feature geometry at depth `1`, and push GeometryCollection children with depth plus one. Do not recursively call Zod for nested GeometryCollections, because the configured depth limit must be checked without risking the JavaScript call stack.

- [ ] **Step 6: Add iterative property-depth validation**

Traverse sanitized feature properties with a second stack carrying `{value, path, propertyDepth}`. Start each Feature `properties` object at depth `0`; an immediate primitive property remains at `0`, while entering an object/array value increases depth to `1`, and each nested container increases it once more. Permit JSON primitives, arrays, and objects and fail before pushing children when the configured depth is exceeded. JSON-value rejection belongs solely to the already-run sanitizer; this walk must never call getters or `toJSON`. `bbox`, `id`, and foreign members are covered by the whole-tree sanitizer and byte limit but do not consume the feature-property nesting budget.

- [ ] **Step 7: Add pure UTF-8 byte and aggregate limit checks**

Call foundation `jsonUtf8ByteLength(sanitizedSnapshot)` exactly once and compare that serialized JSON byte count, plus the feature, coordinate, geometry-depth, and property-depth counters, to the merged limits. Do not stringify again and do not introduce another Unicode walker, `TextEncoder`, `Buffer`, Blob, DOM, or Node API. A defensive unexpected helper exception is normalized without exposing input. JSON serialization is never an input validator: values it could drop or coerce were already rejected by the descriptor sanitizer. Return no DTO or counters on failure. Lock an oversized byte failure as `INVALID_INPUT` at root pointer `''` with JSON-safe `details:{reason:'maxBytes',maxBytes,actualBytes}`; a handler validating an operation field must rebase `''` to `/data` and any nested pointer to `/data${pointer}` by calling `createStyleToolError` again, preserving provenance and details rather than mutating/copy-spreading the registered error.

- [ ] **Step 8: Run focused tests and core-only typecheck**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/geojson.test.js && rtk pnpm run typecheck:core`

Expected: PASS and no DOM, Node, AI SDK, or MapLibre runtime ambient dependency in core.

- [ ] **Step 9: Commit GeoJSON validation**

```bash
rtk git add src/core/geojson.ts src/core/geojson.test.ts src/core/types.ts src/core/schemas.ts src/core/index.ts
rtk git commit -m "feat: validate bounded RFC 7946 GeoJSON"
```

### Task 5: Analyze Inline GeoJSON Deterministically

**Files:**
- Create: `src/core/geojson-analysis.ts`
- Create: `src/core/geojson-analysis.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/schemas.ts`
- Modify: `src/core/index.ts`

**Interfaces:**
- Consumes: `inlineGeoJsonSchema`, `validateInlineGeoJson`, and `GeoJsonLimits`.
- Produces:

```ts
export type GeoJsonGeometryType =
  | 'Point'
  | 'MultiPoint'
  | 'LineString'
  | 'MultiLineString'
  | 'Polygon'
  | 'MultiPolygon'
  | 'GeometryCollection';
export type GeoJsonPropertyType = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';
export type GeoJsonGeometryCounts = Partial<Record<GeoJsonGeometryType, number>>;

export interface GeoJsonPropertyAnalysis {
  name: string;
  types: GeoJsonPropertyType[];
  numericRange?: { min: number; max: number };
  topValues?: Array<{ value: string | number | boolean | null; count: number }>;
}

export interface GeoJsonAnalysisOptions {
  topValueLimit?: number;
  limits?: Partial<GeoJsonLimits>;
}
export type GeoJsonAnalysisInput = InlineGeoJson | string;
export type GeoJsonAnalysisUnavailable = {
  available: false;
  reason: 'remote-url';
  warnings: StyleWarning[];
};
export type GeoJsonAnalysisAvailable = {
  available: true;
  featureCount: number;
  geometryTypes: GeoJsonGeometryCounts;
  bbox?: [number, number, number, number];
  properties: GeoJsonPropertyAnalysis[];
  warnings: StyleWarning[];
};
export type GeoJsonAnalysis = GeoJsonAnalysisUnavailable | GeoJsonAnalysisAvailable;

export type GeoJsonAnalysisResult =
  | { ok: true; analysis: GeoJsonAnalysis }
  | { ok: false; error: StyleToolError };

export const geoJsonAnalysisInputSchema: z.ZodType<GeoJsonAnalysisInput>;
export const geoJsonAnalysisOptionsSchema: z.ZodType<GeoJsonAnalysisOptions>;
export function analyzeGeoJson(
  input: unknown,
  options?: GeoJsonAnalysisOptions
): GeoJsonAnalysisResult;
```

- [ ] **Step 1: Write failing geometry, bbox, and property tests**

Use a FeatureCollection containing Point, LineString, Polygon, GeometryCollection, null geometry, repeated categories, numeric values, booleans, nulls, arrays, and objects. Assert exact counts with keys drawn only from `GeoJsonGeometryType`, two-dimensional `[west,south,east,north]` bbox accumulation from the first two components of every position, alphabetical property order, numeric min/max, count-descending/value-ascending top values, and mixed/unsupported warnings. Add compile-time assignments for every exported DTO plus narrowing cases that make `reason` legal only when `available:false` and `featureCount` legal only when `available:true`.

- [ ] **Step 2: Write URL and invalid-input tests**

Assert a non-empty string returns exactly `{ok:true, analysis:{available:false,reason:'remote-url',warnings:[...]}}` with no count/property fields and no network call. Assert empty/whitespace strings, invalid/over-limit inline data, invalid `topValueLimit`, unknown option keys, and invalid nested limit overrides return `INVALID_INPUT` with no partial `analysis`. Assert both exported schemas reject accessor-bearing, cyclic, aliased, exotic, and dangerous-key values without invoking getters, and return newly allocated plain snapshots for descriptor-safe transparent proxies.

- [ ] **Step 3: Run the focused test and confirm missing export**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/geojson-analysis.test.js`

Expected: FAIL because `analyzeGeoJson` is missing.

- [ ] **Step 4: Implement URL-unavailable and validation branches**

Parse `options` through exported descriptor-sanitized `geoJsonAnalysisOptionsSchema` first; it is `.strict()`, accepts `topValueLimit` as a positive safe integer no greater than 100, defaults it to 10, and reuses `geoJsonLimitsSchema` for nested overrides. Parse input through exported `geoJsonAnalysisInputSchema`, which accepts a non-empty string without transforming it or the plain DTO emitted by `inlineGeoJsonSchema`. Return the unavailable analysis immediately for string input. For inline input, call `validateInlineGeoJson` before creating any accumulator and forward its path-specific error unchanged. No public analysis path may read the original unknown object or rely on a TypeScript assertion.

- [ ] **Step 5: Add geometry counts and bbox accumulation**

Walk validated geometries, ignore null geometry for counts/bbox, increment each concrete geometry type, and update `[west,south,east,north]` from every finite coordinate position.

- [ ] **Step 6: Add property inference and deterministic summaries**

Collect each property's type set, numeric range, and primitive frequency map. Sort property names alphabetically, types by the public union order, and top values by descending count then stable string representation. Cap `topValues` at `topValueLimit`.

- [ ] **Step 7: Add mixed and unsupported warnings**

Emit one warning per mixed-type property and one warning per property containing arrays or objects. Never choose colors, widths, icons, or other subjective styling.

- [ ] **Step 8: Run analysis and validator tests**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/geojson.test.js .tmp/test-dist/core/geojson-analysis.test.js`

Expected: PASS with deterministic serialized output.

- [ ] **Step 9: Commit GeoJSON analysis**

```bash
rtk git add src/core/geojson-analysis.ts src/core/geojson-analysis.test.ts src/core/types.ts src/core/schemas.ts src/core/index.ts
rtk git commit -m "feat: analyze inline GeoJSON data"
```

### Task 6: Discover Referenced Source Layers

**Files:**
- Modify: `src/core/search.ts`
- Modify: `src/core/search.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/schemas.ts`
- Modify: `src/core/index.ts`

**Interfaces:**
- Consumes: foundation `StyleDocument` and layer summaries.
- Produces:

```ts
export interface SourceLayerUsage {
  sourceId: string;
  sourceLayer: string;
  layers: Array<{ id: string; type: string }>;
}

export interface ListSourceLayersOptions { sourceId?: string }
export const listSourceLayersOptionsSchema: z.ZodType<ListSourceLayersOptions>;
export function listSourceLayers(
  style: StyleDocument,
  options?: ListSourceLayersOptions
): SourceLayerUsage[];
```

- [ ] **Step 1: Write failing source-layer aggregation tests**

Assert duplicate references collapse into one `(sourceId, sourceLayer)` entry, referencing layers retain style order, result groups sort by source ID then source-layer, optional `sourceId` filters results, GeoJSON layers without `source-layer` are excluded, and unreferenced vector metadata is not invented. Assert exported `listSourceLayersOptionsSchema` is descriptor-sanitized and `.strict()`, accepts only a non-empty `sourceId`, rejects unknown/dangerous/accessor-bearing keys without executing code, and the public function parses `{}` when options are omitted before doing any discovery.

- [ ] **Step 2: Run the focused test and verify missing export**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/search.test.js`

Expected: FAIL because `listSourceLayers` is missing.

- [ ] **Step 3: Implement a pure single-pass aggregation**

Parse the complete options envelope through `listSourceLayersOptionsSchema` before reading `sourceId`. Use a `Map<string, SourceLayerUsage>` keyed by `JSON.stringify([sourceId, sourceLayer])`; do not split or concatenate IDs with punctuation and do not inspect URLs or fetch TileJSON. Export the option type/schema through `src/core/index.ts` so CLI, MCP, and AI tools reuse this exact boundary.

- [ ] **Step 4: Run search tests**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/search.test.js`

Expected: PASS.

- [ ] **Step 5: Commit discovery**

```bash
rtk git add src/core/search.ts src/core/search.test.ts src/core/types.ts src/core/schemas.ts src/core/index.ts
rtk git commit -m "feat: list referenced vector source layers"
```

### Task 7: Implement Source Lifecycle Operations

**Files:**
- Create: `src/core/operations/sources.ts`
- Create: `src/core/operations/sources.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/schemas.ts`
- Modify: `src/core/transaction.ts`
- Modify: `src/core/index.ts`
- Modify: `src/core/style-operation-json-contract.test.ts`

**Interfaces:**
- Consumes: `applyMergePatch`, `validateInlineGeoJson`, the foundation-resolved `OperationContext.limits`, and foundation validation/diff/rollback.
- Produces these operation variants:

```ts
type SourceOperation =
  | { op: 'addSource'; sourceId: string; source: JsonObject }
  | { op: 'duplicateSource'; sourceId: string; newSourceId: string; overrides?: JsonObject }
  | { op: 'renameSource'; sourceId: string; newSourceId: string }
  | { op: 'removeSource'; sourceId: string; cascadeLayers?: boolean }
  | { op: 'patchSource'; sourceId: string; patch: JsonObject }
  | { op: 'setGeoJsonData'; sourceId: string; data: InlineGeoJson | string };

export function applySourceOperation(style: StyleDocument, operation: SourceOperation, context: OperationContext): OperationApplyResult;
```

- [ ] **Step 1: Write failing add/duplicate/patch tests**

Assert collision and missing errors, lossless duplication of JSON extension fields, deep-copy isolation, Merge Patch null deletion, rejection of cycles/exotic/dangerous-key objects, and canonical validation rollback after an invalid source type or patch. Every successful case also asserts exact source/layer candidate marking, semantic targets, changed IDs, and final diff.

In `style-operation-json-contract.test.ts`, add this value, then retain the whole-union assertion `StyleOperation extends JsonObject ? true : false`:

```ts
const addSourceJsonContract = {
  op: 'addSource',
  sourceId: 'incidents',
  source: {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  },
} satisfies StyleOperation;
```

- [ ] **Step 2: Write failing rename/remove tests**

Assert rename atomically rewrites every exact `layer.source`, leaves `source-layer` unchanged, and rejects destination collision. Assert remove refuses dependencies with `DEPENDENCY_CONFLICT` details, while `cascadeLayers:true` removes dependent layers and reports both changed sources and layers.

- [ ] **Step 3: Write failing setGeoJsonData tests**

Assert valid inline and string URL data, RFC/limit failures, rejection of non-GeoJSON source with `UNSUPPORTED_SOURCE`, and original-style identity on failure. Add a direct-core limit matrix using one descriptor-safe inline FeatureCollection whose `jsonUtf8ByteLength(data)` is strictly greater than `DEFAULT_MAX_STYLE_BYTES` while the baseline Style remains smaller than every supplied positive limit. Precompute the exact expected completed Style and semantic diff, then assert: omitted options fail at exact path `/data` with `details.reason:'maxBytes'` and `details.maxBytes:DEFAULT_MAX_STYLE_BYTES`; `maxStyleBytes:dataBytes - 1` also fails there even when `maxDiffBytes` is already high enough; and `maxStyleBytes:jsonUtf8ByteLength(expectedStyle)` plus `maxDiffBytes:jsonUtf8ByteLength(expectedDiff)` succeeds, preserves the sanitized inline snapshot, and returns the exact source-target diff. The two failures retain the original Style identity and empty changed lists/diff. This matrix proves both lowering and raising reach the handler's resolved context rather than being replaced by the standalone 5 MiB GeoJSON default. A string URL bypasses inline GeoJSON byte validation but remains subject to final completed-Style validation.

- [ ] **Step 4: Run the focused test and confirm unknown variants**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/operations/sources.test.js .tmp/test-dist/core/style-operation-json-contract.test.js`

Expected: FAIL because source variants are absent.

- [ ] **Step 5: Add strict source schemas and dispatcher cases**

Add all six source variants to the Zod discriminated union and exhaustive transaction switch. Keep every variant a closed JSON-backed type alias and keep the compile contract `StyleOperation extends JsonObject ? true : false` green after expansion. The `setGeoJsonData` schema composes the structural `inlineGeoJsonSchema` or a non-empty string; it must not call `validateInlineGeoJson` with defaults during transaction parsing, because the handler is the only place with the resolved `OperationContext`. Keep source IDs as object keys and never add an internal `id` property.

- [ ] **Step 6: Implement add, duplicate, and patch source branches**

Use the foundation validated JSON clone for lossless duplication, reject destination collision before mutation, and call the own-key-safe `applyMergePatch` for overrides/patches. Each branch computes `changed` structurally and marks only the affected candidate IDs in the shared context; the transaction coordinator remains the sole diff producer.

- [ ] **Step 7: Implement atomic source rename**

Insert the new source key, delete the old key, and rewrite every layer whose `source` equals the old ID. Do not inspect or alter `source-layer`. Mark both source IDs plus every rewritten layer ID in the shared context; assert final source-key and layer-reference diffs carry the corresponding semantic targets.

- [ ] **Step 8: Implement dependency-aware source removal**

Collect dependent layer IDs before mutation. Return `DEPENDENCY_CONFLICT` unless `cascadeLayers` is true; on cascade, delete layers from highest index to lowest before deleting the source. Mark the removed source and cascaded layer IDs only after mutation succeeds, and assert the transaction's changed lists and diff contain all and only those IDs.

- [ ] **Step 9: Implement bounded GeoJSON data replacement**

Require `source.type === 'geojson'`. For inline input, call exactly `validateInlineGeoJson(operation.data, {maxBytes: context.limits.maxStyleBytes})`, retain and assign only its sanitized success value, and never call the validator without that override or substitute `DEFAULT_GEOJSON_LIMITS.maxBytes`. On failure, recreate the registered error through `createStyleToolError` with root `/data` or `/data${nestedPointer}` and the original JSON-safe details; do not mutate or spread it. `maxFeatures`, `maxCoordinatePositions`, `maxGeometryDepth`, and `maxPropertyDepth` continue to come from `DEFAULT_GEOJSON_LIMITS` because `CoreExecutionLimits` shares only the serialized Style-byte budget with this validator. Accept string data without fetching or inline validation, and assign only after every check passes; the coordinator's completed-Style/diff gates still consume the same resolved context limits. A structurally equal replacement is `changed:false`; otherwise mark the source ID and assert an exact `/sources/{escapedId}/data` semantic-target diff.

- [ ] **Step 10: Run source, GeoJSON, and transaction tests**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/operations/sources.test.js .tmp/test-dist/core/style-operation-json-contract.test.js .tmp/test-dist/core/geojson.test.js .tmp/test-dist/core/transaction.test.js`

Expected: PASS.

- [ ] **Step 11: Commit source lifecycle**

```bash
rtk git add src/core/operations/sources.ts src/core/operations/sources.test.ts src/core/style-operation-json-contract.test.ts src/core/types.ts src/core/schemas.ts src/core/transaction.ts src/core/index.ts
rtk git commit -m "feat: add JSON-backed source lifecycle operations"
```

### Task 8: Duplicate, Move, Reorder, and Remove Layers

**Files:**
- Modify: `src/core/operations/layers.ts`
- Modify: `src/core/operations/layers.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/schemas.ts`
- Modify: `src/core/transaction.ts`
- Modify: `src/core/index.ts`
- Modify: `src/core/style-operation-json-contract.test.ts`

**Interfaces:**
- Consumes: `applyMergePatch`, `resolveInsertionIndex`, foundation validation/diff/rollback.
- Produces:

```ts
type LayerLifecycleOperation =
  | { op: 'duplicateLayer'; layerId: string; newLayerId: string; overrides?: JsonObject; beforeId?: string; afterId?: string }
  | { op: 'moveLayer'; layerId: string; beforeId?: string; afterId?: string }
  | { op: 'reorderLayers'; layerIds: string[]; beforeId?: string; afterId?: string }
  | { op: 'removeLayer'; layerId: string };

export function applyLayerOperation(style: StyleDocument, operation: LayerLifecycleOperation, context: OperationContext): OperationApplyResult;
```

- [ ] **Step 1: Write failing duplication tests**

Assert every JSON extension field and nested value survives a deep copy, only the ID changes, `overrides.id` is schema-invalid, null override fields are deleted, cycles/exotic/dangerous keys are rejected, duplicate target IDs fail, and the default insertion index is immediately after the original layer. Assert exact changed layer IDs and replayable semantic-target diffs.

In `style-operation-json-contract.test.ts`, add this value, then retain the whole-union assertion `StyleOperation extends JsonObject ? true : false`:

```ts
const duplicateLayerJsonContract = {
  op: 'duplicateLayer',
  layerId: 'roads',
  newLayerId: 'roads-copy',
  beforeId: 'labels',
} satisfies StyleOperation;
```

- [ ] **Step 2: Write failing placement and reorder tests**

Assert before/after placement, missing anchors, self anchors, simultaneous anchors, no-op moves, duplicate `layerIds`, anchor inside the moving set, and relative-order preservation when moving a non-contiguous list.

- [ ] **Step 3: Write failing removal and unusual-ID diff tests**

Use layer ID `roads/main~casing` and assert the actual JSON Pointer remains array-based (for example `/layers/0`) while `target` is `{kind:'layer', id:'roads/main~casing'}`. Add a source ID containing `/` and `~` and assert its object-key path contains `~1` and `~0`. Assert removing a missing layer returns `NOT_FOUND` and leaves the original style/diff unchanged.

- [ ] **Step 4: Run the focused test and confirm unknown variants**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/operations/layers.test.js .tmp/test-dist/core/style-operation-json-contract.test.js`

Expected: FAIL because the layer lifecycle variants are absent.

- [ ] **Step 5: Add strict schemas and transaction branches**

Register the four layer lifecycle variants as closed type aliases, enforce unique IDs and exclusive placement in Zod, add exhaustive dispatcher cases before `assertNever`, and keep `StyleOperation extends JsonObject ? true : false` compiling.

- [ ] **Step 6: Implement lossless layer duplication**

Deep-clone the complete source layer, apply Merge Patch overrides after rejecting an `id` key, overwrite the clone ID with `newLayerId`, and insert at the resolved/default index. Mark only `newLayerId`; assert the coordinator produces a container-level layer add and the same changed-layer list.

- [ ] **Step 7: Implement single-layer movement and removal**

Remove the moving layer before resolving its destination against the reduced array; return a no-op with no candidate mark when the resolved final index equals the original. Remove by exact ID and return `NOT_FOUND` before mutation when absent. Successful moves/removals mark that layer ID and assert exact `move`/`remove` array paths and semantic targets.

- [ ] **Step 8: Implement ordered multi-layer movement**

Collect layer objects in requested order, remove them by descending original index, calculate the anchor in the reduced array, then splice the collected list once. Mark each actually moved layer candidate in `layerIds` order; the coordinator emits replayable `move` entries with array-index `from/path` and semantic targets in that stable order.

- [ ] **Step 9: Run layer and transaction tests**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/operations/layers.test.js .tmp/test-dist/core/style-operation-json-contract.test.js .tmp/test-dist/core/transaction.test.js`

Expected: PASS.

- [ ] **Step 10: Commit layer lifecycle**

```bash
rtk git add src/core/operations/layers.ts src/core/operations/layers.test.ts src/core/style-operation-json-contract.test.ts src/core/types.ts src/core/schemas.ts src/core/transaction.ts src/core/index.ts
rtk git commit -m "feat: add JSON-backed layer lifecycle operations"
```

### Task 9: Add Layers from Existing Sources

**Files:**
- Modify: `src/core/operations/layers.ts`
- Modify: `src/core/operations/layers.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/schemas.ts`
- Modify: `src/core/transaction.ts`
- Modify: `src/core/index.ts`
- Modify: `src/core/style-operation-json-contract.test.ts`

**Interfaces:**
- Consumes: source lookup/type helpers and layer placement from Tasks 7–8.
- Produces:

```ts
export type AddLayerFromSourceOperation = Placement & {
  op: 'addLayerFromSource';
  layerId: string;
  sourceId: string;
  sourceLayer?: string;
  type: string;
  paint?: JsonObject;
  layout?: JsonObject;
  filter?: JsonValue[];
  minzoom?: number;
  maxzoom?: number;
  metadata?: JsonObject;
};
```

- [ ] **Step 1: Write failing source-compatibility tests**

Assert vector sources require `sourceLayer`; GeoJSON, raster, raster-dem, image, and video reject `sourceLayer`; missing source and duplicate layer ID return stable errors. Include valid vector, GeoJSON, raster, and hillshade examples whose completed styles pass style-spec validation.

In `style-operation-json-contract.test.ts`, add this closed value and retain the whole-union assertion `StyleOperation extends JsonObject ? true : false`:

```ts
const addLayerFromSourceJsonContract = {
  op: 'addLayerFromSource',
  layerId: 'roads',
  sourceId: 'basemap',
  sourceLayer: 'transportation',
  type: 'line',
  beforeId: 'labels',
} satisfies StyleOperation;
```

- [ ] **Step 2: Write failing field and placement tests**

Assert paint/layout/filter/zoom/metadata survive exactly, before/after ordering works, invalid paint or layer/source combinations roll back, and public input cannot override `id` or `source` through an extension object.

- [ ] **Step 3: Run the focused test and verify schema failure**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/operations/layers.test.js .tmp/test-dist/core/style-operation-json-contract.test.js`

Expected: FAIL on `addLayerFromSource` parsing.

- [ ] **Step 4: Implement source-type preconditions and creation**

Perform explicit vector/GeoJSON `sourceLayer` checks for actionable `INVALID_INPUT` errors, then rely on canonical completed-style validation for the full layer-type/source-type matrix. Define `AddLayerFromSourceOperation` exactly as the closed `Placement & { ... }` type alias above; do not add an index signature or convert it to an interface. Construct the layer from whitelisted JSON-safe fields so `layerId` and `sourceId` are sole authorities. Mark only the created layer and assert a container add diff plus exact changed lists. Explicitly type-export `AddLayerFromSourceOperation` from `src/core/index.ts` alongside the expanded `StyleOperation` union, and keep the whole-union JSON compile contract green.

- [ ] **Step 5: Run focused and full core operation tests**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/operations/layers.test.js .tmp/test-dist/core/style-operation-json-contract.test.js .tmp/test-dist/core/operations/sources.test.js .tmp/test-dist/core/transaction.test.js`

Expected: PASS.

- [ ] **Step 6: Commit source-based layer creation**

```bash
rtk git add src/core/operations/layers.ts src/core/operations/layers.test.ts src/core/style-operation-json-contract.test.ts src/core/types.ts src/core/schemas.ts src/core/transaction.ts src/core/index.ts
rtk git commit -m "feat: add JSON-backed source layer creation"
```

### Task 10: Atomically Create a GeoJSON Source and Layer

**Files:**
- Modify: `src/core/operations/layers.ts`
- Modify: `src/core/operations/layers.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/schemas.ts`
- Modify: `src/core/transaction.ts`
- Modify: `src/core/index.ts`
- Modify: `src/core/style-operation-json-contract.test.ts`

**Interfaces:**
- Consumes: `validateInlineGeoJson`, the foundation-resolved `OperationContext.limits`, source creation rules, layer creation/placement, and transaction rollback.
- Produces:

```ts
export type AddGeoJsonLayerOperation = Placement & {
  op: 'addGeoJsonLayer';
  sourceId: string;
  layerId: string;
  data: InlineGeoJson | string;
  sourceOptions?: JsonObject;
  type: 'fill' | 'line' | 'symbol' | 'circle' | 'heatmap' | 'fill-extrusion';
  paint?: JsonObject;
  layout?: JsonObject;
  filter?: JsonValue[];
  minzoom?: number;
  maxzoom?: number;
  metadata?: JsonObject;
};
```

- [ ] **Step 1: Write failing atomic success tests**

Assert inline FeatureCollection and URL data both create `{type:'geojson', data}` plus the first layer in one transaction; assert source options such as clustering and `promoteId` survive and placement is correct.

In `style-operation-json-contract.test.ts`, add this closed value and retain the whole-union assertion `StyleOperation extends JsonObject ? true : false`:

```ts
const addGeoJsonLayerJsonContract = {
  op: 'addGeoJsonLayer',
  sourceId: 'incidents',
  layerId: 'incidents-circle',
  data: { type: 'FeatureCollection', features: [] },
  type: 'circle',
  afterId: 'roads',
} satisfies StyleOperation;
```

- [ ] **Step 2: Write failing authority and rollback tests**

Reject `sourceOptions.type`, `sourceOptions.data`, any `source-layer`, source/layer ID collisions, invalid GeoJSON, invalid layer fields, and missing placement anchors. For each failure assert the original style object, sources, layers, changed lists, and diff are unchanged.

Add the same direct-core lower/default/raise matrix as Task 7 for `addGeoJsonLayer`, using inline data strictly larger than `DEFAULT_MAX_STYLE_BYTES`. Measure the sanitized data, exact expected completed Style, and exact two-entry source/layer diff with foundation `jsonUtf8ByteLength`. Omitted options and a positive `maxStyleBytes:dataBytes - 1` (with the diff budget already raised) must reject at exact path `/data` before either source or layer is added and retain original identity; passing `maxStyleBytes:jsonUtf8ByteLength(expectedStyle)` and `maxDiffBytes:jsonUtf8ByteLength(expectedDiff)` must succeed exactly at both final boundaries with `changedSources:[sourceId]` and `changedLayers:[layerId]`. This test must fail if the layer handler uses the standalone 5 MiB GeoJSON default instead of the resolved transaction limit.

- [ ] **Step 3: Run the focused test and verify schema failure**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/operations/layers.test.js .tmp/test-dist/core/style-operation-json-contract.test.js`

Expected: FAIL because `addGeoJsonLayer` is absent.

- [ ] **Step 4: Implement composite mutation within the transaction clone**

Make the strict `addGeoJsonLayer` Zod variant compose structural `inlineGeoJsonSchema` or a non-empty URL string without running default aggregate validation during transaction parsing. Define `AddGeoJsonLayerOperation` exactly as the closed `Placement & { ... }` type alias above; do not add an index signature or convert it to an interface. Validate inline data before adding either object by calling exactly `validateInlineGeoJson(operation.data, {maxBytes: context.limits.maxStyleBytes})` and retaining only its sanitized success value. On failure, recreate the provenance-registered error through `createStyleToolError` at `/data` or `/data${nestedPointer}` with unchanged JSON-safe details before returning. Never omit the limit override, clamp it to `DEFAULT_GEOJSON_LIMITS.maxBytes`, mutate/copy-spread the original error, or reinterpret `maxDiffBytes`/`maxOperations` as GeoJSON shape limits; the remaining GeoJSON-specific limits retain their validator defaults. URL strings bypass inline validation. Build the source with `{...sourceOptions, type:'geojson', data:sanitizedDataOrUrl}` only after authority-key rejection, build the layer with `source:sourceId`, and let final Style validation decide expression/property correctness under the same resolved execution limits. On success mark both created IDs, assert one source add plus one layer add with semantic targets, and assert `changedSources:[sourceId]`/`changedLayers:[layerId]`; no intermediate state may escape on failure. Explicitly type-export `AddGeoJsonLayerOperation` from `src/core/index.ts` and keep the whole-union JSON compile contract green.

- [ ] **Step 5: Run all core capability tests**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/style-operation-json-contract.test.js .tmp/test-dist/core/geojson.test.js .tmp/test-dist/core/geojson-analysis.test.js .tmp/test-dist/core/operations/filters.test.js .tmp/test-dist/core/operations/sources.test.js .tmp/test-dist/core/operations/layers.test.js .tmp/test-dist/core/transaction.test.js`

Expected: PASS.

- [ ] **Step 6: Commit atomic GeoJSON layer creation**

```bash
rtk git add src/core/operations/layers.ts src/core/operations/layers.test.ts src/core/style-operation-json-contract.test.ts src/core/types.ts src/core/schemas.ts src/core/transaction.ts src/core/index.ts
rtk git commit -m "feat: add JSON-backed atomic GeoJSON layer creation"
```

### Task 11: Apply Transactions to a Live Map with Completion and Rollback

**Files:**
- Create: `src/core/canonical-json.ts`
- Create: `src/core/canonical-json.test.ts`
- Create: `src/adapters/maplibre/map-adapter.ts`
- Create: `src/adapters/maplibre/map-adapter.test.ts`
- Create: `src/adapters/maplibre/style-hash.ts`
- Create: `src/adapters/maplibre/types.ts`
- Create: `src/adapters/maplibre/index.ts`
- Modify: `src/core/index.ts`

**Interfaces:**
- Consumes: `validateStyleDocument`, `applyStyleTransaction`, core-owned `finalizeStyleReplacement`, `CoreExecutionLimits`/`StyleReplacementOptions`, foundation `jsonValueSchema` sanitizer, canonical `hashStyle`, core result/error types, MapLibre `Map` type. The adapter never casts MapLibre `StyleSpecification` to `StyleDocument`, imports internal diff machinery, duplicates core operation/Style/diff limits, or synthesizes transaction envelopes.
- Produces:

```ts
export interface MapOperationDeadline {
  expiresAt: number;
  signal?: AbortSignal;
  now?: () => number;
}

export interface ApplyTransactionToMapOptions extends StyleTransactionOptions {
  diff?: boolean;
  timeoutMs?: number;
  deadline?: MapOperationDeadline;
  hashStyle?: (style: StyleDocument) => Promise<string>;
}

export interface WholeStyleApplyOptions extends StyleReplacementOptions {
  diff?: boolean;
  timeoutMs?: number;
  deadline?: MapOperationDeadline;
  hashStyle?: (style: StyleDocument) => Promise<string>;
}

export type PreparedStyleApplyOptions = Pick<
  ApplyTransactionToMapOptions,
  'diff' | 'deadline' | 'hashStyle'
>;

export type MapStyleCurrentResult = StyleTransactionResult & {
  styleAuthority: 'current';
  applied: boolean;
  rolledBack?: boolean;
  rollbackError?: StyleToolError;
};
export type MapStylePreOperationResult = Extract<StyleTransactionResult, {ok: false}> & {
  styleAuthority: 'pre-operation';
  applied: false;
  rolledBack?: false;
  rollbackError?: StyleToolError;
};
export type MapStyleUnavailableResult = {
  ok: false;
  styleAuthority: 'unavailable';
  applied: false;
  changedLayers: [];
  changedSources: [];
  diff: [];
  warnings: StyleWarning[];
  error: StyleToolError;
  rolledBack?: false;
  rollbackError?: StyleToolError;
};
export type MapStyleApplyResult =
  | MapStyleCurrentResult
  | MapStylePreOperationResult
  | MapStyleUnavailableResult;

type DeepReadonlyPrepared<T> =
  T extends readonly (infer U)[]
    ? readonly DeepReadonlyPrepared<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonlyPrepared<T[K]> }
      : T;

// Module-private to map-adapter.ts: neither symbol is exported from any barrel.
const preparedMapStyleTransactionBrand: unique symbol = Symbol('PreparedMapStyleTransaction');
type PreparedMapStyleTransactionAuthority = DeepReadonlyPrepared<{
  baselineStyle: StyleDocument;
  candidateStyle: StyleDocument;
  baselineCanonical: string;
  candidateCanonical: string;
  baselineHash: string;
  transactionResult: Extract<StyleTransactionResult, {ok: true}>;
  limitOptions: StyleTransactionOptions;
}>;

export type PreparedMapStyleTransactionView = DeepReadonlyPrepared<{
  baselineHash: string;
  transactionResult: Extract<StyleTransactionResult, {ok: true}>;
  limitOptions: StyleTransactionOptions;
}>;
export type PreparedMapStyleTransaction = Readonly<{
  view: PreparedMapStyleTransactionView;
  readonly [preparedMapStyleTransactionBrand]: true;
}>;

// Module-private runtime provenance/authority; the public view is never read as apply authority.
const preparedMapStyleTransactionHandles = new WeakSet<object>();
const preparedMapStyleTransactionAuthorities =
  new WeakMap<object, PreparedMapStyleTransactionAuthority>();

export async function prepareTransactionForMap(
  map: Map,
  transaction: unknown,
  options?: Pick<
    ApplyTransactionToMapOptions,
    'hashStyle' | 'deadline' | 'maxStyleBytes' | 'maxDiffBytes' | 'maxOperations'
  >
): Promise<PreparedMapStyleTransaction | MapStyleApplyResult>;

export async function applyPreparedStyleToMap(
  map: Map,
  prepared: PreparedMapStyleTransaction,
  options?: PreparedStyleApplyOptions
): Promise<MapStyleApplyResult>;

export async function applyTransactionToMap(
  map: Map,
  transaction: unknown,
  options?: ApplyTransactionToMapOptions
): Promise<MapStyleApplyResult>;

export type WholeStyleInput = StyleDocument | string;
export async function applyStyleDocumentOrUrlToMap(
  map: Map,
  input: WholeStyleInput,
  options?: WholeStyleApplyOptions
): Promise<MapStyleApplyResult>;

export function canonicalizeJson(value: unknown): string;
export function sha256CanonicalJson(value: unknown): Promise<string>;
export function hashStyle(style: StyleDocument): Promise<string>;

// Exported from map-adapter.ts only as a focused test seam; not from the public barrel.
export function toMapLibreStyleSpecification(style: StyleDocument): StyleSpecification;
```

These are type-alias intersections/discriminated unions, never interfaces extending `StyleTransactionResult` (which is itself a union). `MapStyleCurrentResult` preserves both core `ok` branches exactly: the success branch has no `error` member at all, while the failure branch has one required authentic `StyleToolError`. `MapStylePreOperationResult` can only contain the extracted core failure branch, and `MapStyleUnavailableResult` is its own required-error failure with no `style` member. Adapter-created failures must use the core error factory/provenance path rather than constructing a structurally similar plain object. `PreparedMapStyleTransaction` is a nominal, opaque provenance handle: its unique-symbol brand, factory, `WeakSet`, `WeakMap`, and authority record stay module-private in `map-adapter.ts`; no public constructor, brand, registry, authority accessor, deserializer, or structural fallback exists. Its deeply readonly `view` is an independently cloned inspection snapshot for resource-policy authorization only and is never sufficient to apply a Style.

- [ ] **Step 1: Build a fake Map and lock every result branch**

The fake records `on`, `off`, `setStyle`, `getStyle`, and `isStyleLoaded` calls. Its `getStyle` return type remains MapLibre `StyleSpecification`; tests forbid every raw-Map `as StyleDocument` conversion and every `as unknown` escape in adapter source. Assert the initial read uses the private preparation authority's copied `maxStyleBytes`, while the immediate pre-apply re-read, every completion/hash re-read, rollback confirmation read, and last-state fallback read use that same private value; whole-document/URL reads use that orchestration's same replacement limit. Every raw read must call `validateStyleDocument(raw,{maxStyleBytes})` before canonicalization, hashing, finalization, or result exposure. Initial thrown/invalid/exotic/accessor-bearing Styles produce `MapStyleUnavailableResult` with no `style`; once a valid baseline exists, a later unreadable/invalid current Style may expose only that old snapshot as `pre-operation`. Add compile-time narrowing tests proving `style` is inaccessible on `unavailable`, present on the other branches, and only `current` is accepted by a helper typed to consume authoritative live state. Within `current`, `if (result.ok)` must make any `result.error` access a `// @ts-expect-error` because the member is absent, while its false branch requires an authentic `StyleToolError`; `pre-operation` and `unavailable` always expose a required authentic error. Add `// @ts-expect-error` constructions for an `ok:false` core/Map result without `error`, an `ok:true` result carrying one, and direct success-branch property access.

Assert empty diff never calls `setStyle`; real changes install both completion/error listeners before `setStyle`; synchronous `style.load` emitted inside `setStyle` is observed. Run successful, asynchronous-failure-plus-rollback, synchronous-failure, and no-op cases with omitted `diff`, `diff:true`, and `diff:false`: omission and `true` pass `{diff:true}`, `false` passes `{diff:false}` to both candidate and rollback calls, all non-no-op cases await the same completion/hash checks, and every result retains the identical core semantic `diff`/changed IDs regardless of that MapLibre rendering option. `diff:false` is never treated as dry-run. Cover `applyStyleDocumentOrUrlToMap` with a validated document, invalid document, non-empty raw URL, URL load failure, and successful URL load whose resulting `map.getStyle()` is validated and structurally diffed against the baseline. A URL load must observe a post-`setStyle` completion signal and may not accept the baseline's pre-call loaded state. Add a fake-clock case where apply consumes part of one `MapOperationDeadline` and rollback receives only the exact remaining milliseconds; it may never restart `timeoutMs`. Lock these public semantics in a table:

| Branch | `ok` | `styleAuthority` / `style` | `applied` | changes/diff | rollback fields |
|---|---:|---|---:|---|---|
| initial `getStyle` throws or fails core validation | false | `unavailable`; no `style` field | false | empty | omitted |
| core/schema failure before live mutation | false | `current`; validated current baseline | false | empty | omitted |
| structural no-op | true | `current`; validated current baseline | false | empty | omitted |
| candidate load confirmed and re-read validates | true | `current`; validated candidate | true | core changed IDs/diff | omitted |
| apply fails, rollback confirmed and re-read validates | false | `current`; restored validated baseline | false | empty | `rolledBack:true` |
| apply/rollback fails, last `getStyle` validates | false | `current`; newly read validated last Style | false | empty | `rolledBack:false`, `rollbackError` set |
| apply/rollback fails and current Style is unreadable/invalid | false | `pre-operation`; saved validated old baseline only | false | empty | `rolledBack:false`, `rollbackError` set |

`current` means `result.style` was validated from the Map state known to be current for that branch. `pre-operation` means `result.style` is only the saved validated snapshot from before mutation and says nothing about the current Map. `unavailable` means no validated Style exists and the `style` field is absent. The primary `error` is never replaced by `rollbackError`, and a failed live commit never reports candidate changed IDs/diff as committed. Later bridge code may update its authoritative mirror only from `styleAuthority:'current'`; it must reject/ignore `pre-operation` and `unavailable` as resynchronization inputs.

- [ ] **Step 2: Write canonical hash, prepared-baseline, timeout, and synchronous-failure tests**

Assert recursively reordered object keys produce the same canonical JSON/SHA-256 while array order remains significant. Pass accessor/toJSON/hidden/cyclic/aliased/hostile-Proxy input directly to `canonicalizeJson` and prove it delegates to the foundation descriptor sanitizer, never invokes getters, throws one stable JSON-value error on invalid input, and canonicalizes only a plain sanitized snapshot for a transparent `get`-trap Proxy. Assert `prepareTransactionForMap` runs the core transaction once and calls one module-private factory that builds and recursively freezes two disjoint object graphs: the private `PreparedMapStyleTransactionAuthority` stored only in the `WeakMap`, and the public inspection `view`. JSON-backed baseline/candidate/result graphs are independently descriptor-sanitized and deep-cloned; each limits object is separately constructed from the three already copied optional primitives so all three own keys remain present even when `undefined`, without sending that non-JSON option envelope through `jsonValueSchema`. The private record owns immutable baseline/candidate Styles, both canonical strings, baseline hash, successful core result, and limits; the view owns independent clones of only baseline hash, successful result, and limits. No nested object/array identity is shared between caller inputs, private authority, and public view. Mutating the caller's original Style/transaction/options or the object graph returned by core after preparation therefore cannot change either snapshot. A prepared result is statically a core success. Add compile tests proving the handle/view and every nested field are readonly, the unique-symbol key cannot be named or imported by a consumer, and second-phase `max*` fields/`timeoutMs` are rejected with `// @ts-expect-error`.

Lock provenance before any Map access: a plain structural lookalike, a spread/`structuredClone` copy, a Proxy around a genuine handle, a cast object, a handle-shaped object with an altered view, and a previously valid handle whose public graph fails the factory's frozen/integrity checks each return a stable core-created `INVALID_INPUT`, `styleAuthority:'unavailable'`, and zero calls to `getStyle`, `isStyleLoaded`, listeners, hashing, or `setStyle`. The implementation must require both private `WeakSet` membership and the exact `WeakMap` authority record; it may never recover/fallback from `view`, discover/copy a brand symbol, or register a foreign object. Direct `Reflect.set`/`Reflect.defineProperty` attempts against the recursively frozen genuine handle/view fail without changing it. After authorization, mutate the original transaction, its candidate Style, and caller options, and also attempt public-view mutation through unsafe casts: applying the still-genuine handle must pass the exact private frozen candidate snapshot to `toMapLibreStyleSpecification`/`setStyle`, byte-for-byte equal to the pre-mutation authorized candidate and unequal by identity to every caller/public-view object.

Mutate the fake Map between prepare and apply and assert `applyPreparedStyleToMap` returns `REVISION_CONFLICT` without calling `setStyle`; the adapter validates the fresh raw Style with the private authority's `limitOptions.maxStyleBytes` and compares `canonicalizeJson(validation.style)` with its private `baselineCanonical` immediately before mutation. Assert post-call `isStyleLoaded()===true` succeeds only when a freshly validated Style under that same private limit has the expected hash; mismatched hash times out; synchronous `setStyle` errors remove listeners and return `INTERNAL` according to the branch table. For whole-Style documents, assert validation occurs before `setStyle`, structural no-op skips the call, and the confirmed result preserves replayable diff plus exact layer/source semantic targets. For URL input, assert the adapter passes the string to `setStyle` exactly once, waits for a fresh completion, validates the resolved Style, and rolls back if loading or validation fails.

Add the one reverse checked-conversion test. Obtain a strict `StyleDocument` only from `validateStyleDocument(...).style` or a successful core finalizer, pass it to adapter-local `toMapLibreStyleSpecification`, and assert runtime object identity (`strictEqual`) with no clone/loss of extension fields. Add `// @ts-expect-error` calls for `unknown`, an unvalidated `map.getStyle()` variable, and an invalid plain object so the helper's input remains statically restricted to the core DTO. Because the JSON-backed `StyleDocument` deliberately is not structurally assignable to MapLibre's recursive `StyleSpecification`, inspect adapter production source to require exactly one localized direct assertion—the helper body `return style as StyleSpecification;`—and forbid any second `as StyleSpecification`, every `as StyleDocument`, `as unknown`, and `as never`. A call-site table/source inspection must prove every helper invocation receives only `validation.style`, a successful `StyleTransactionResult.style`, or a successful `finalizeStyleReplacement(...).style`; raw `map.getStyle()` output can never reach it. The fake Map asserts every object candidate and rollback supplied to `setStyle` is exactly the object returned by this helper; raw URL strings remain strings and bypass it. This creates exactly two checked directions: raw MapLibre Style→`validateStyleDocument`→`StyleDocument`, and core-validated `StyleDocument`→the one localized adapter assertion→MapLibre.

Add a fake-clock slow-hash matrix. Pass one `MapOperationDeadline` to `prepareTransactionForMap`, make injected `hashStyle` remain pending past `expiresAt`, and assert preparation settles at the absolute deadline with `TIMEOUT`, `applied:false`, `styleAuthority:'current'`, the validated baseline, empty changes/diff, no `setStyle`, and no restarted timer. Resolve and reject separate late hash promises afterward; both late outcomes are observed/discarded without changing the settled result or causing `unhandledRejection`. Abort the shared signal while hashing and assert the same bounded settlement with JSON-safe `details.reason:'aborted'`. In `applyTransactionToMap`, let baseline preparation consume a known portion of the budget, then prove candidate hashing/apply/rollback receive only `expiresAt - now()` and never a fresh `timeoutMs`; expiry between synchronous canonicalization/core work and its following deadline check must also prevent live mutation.

Add explicit limit-forwarding tests for prepared transactions, direct transactions, object replacement, and URL-resolved replacement. For known transaction/object candidates, lowered `maxOperations`, `maxStyleBytes`, or `maxDiffBytes` return the exact core `INVALID_INPUT` path/details and never call `setStyle`; fixtures above each core default succeed when the corresponding option is raised sufficiently; invalid zero/fractional limits return core's canonical error. For URL input, an invalid replacement limit must fail before the URL is passed to `setStyle`; a syntactically valid limit exceeded only by the remotely resolved Style is detected by the post-load core finalizer and follows the rollback result table. Spy on the injected core seam or compare exact results to prove each supplied value is passed unchanged to `applyStyleTransaction`/`finalizeStyleReplacement`. The adapter must not count operations, call `jsonUtf8ByteLength`, compare byte counts, clamp a raised value back to the default, or construct a parallel limit error.

Within that test, table-drive both `setGeoJsonData` and `addGeoJsonLayer` through `applyTransactionToMap` using the Tasks 7/10 inline fixture whose sanitized byte size exceeds `DEFAULT_MAX_STYLE_BYTES`. Keep the fake Map baseline below the lowered limit. With options omitted, and again with a positive `maxStyleBytes` between baseline bytes and inline-data bytes while `maxDiffBytes` is sufficiently raised, assert the exact core `INVALID_INPUT` at `/data` with `details.reason:'maxBytes'`, `styleAuthority:'current'`, `applied:false`, empty changes/diff, and zero `setStyle` calls. With `maxStyleBytes` raised to the exact expected completed-Style byte count and `maxDiffBytes` raised to the exact expected semantic-diff byte count, assert success, the operation-specific exact changed IDs/diff, and exactly one `setStyle` call receiving the sanitized candidate. This is an end-to-end proof that adapter options reach foundation resolution and then `context.limits.maxStyleBytes` in each handler; the adapter itself must neither invoke `validateInlineGeoJson` nor resolve/clamp those values.

Repeat the raised `setGeoJsonData` case across the split API: call `prepareTransactionForMap` with the exact raised Style/diff limits, assert `prepared.view.limitOptions` is a recursively frozen inspection copy, mutate the original caller options down to values below 5 MiB, and then call `applyPreparedStyleToMap(map, prepared)` with its third argument omitted. The apply and every confirmation/rollback read must still validate under the separate private authority's raised `maxStyleBytes` and succeed with one `setStyle`; a hidden fallback to defaults, caller options, or the public view must fail this test. Mutate the view-shaped data before applying a forged clone and assert zero Map calls; attempted mutation of the genuine frozen view must leave it unchanged and the exact private authorized candidate must apply. The compile-only conflicting-limit calls above prove there is no supported way to lower or raise limits during phase two.

- [ ] **Step 3: Write independent rollback tests**

Assert asynchronous error/timeout starts a fresh listener/timer lifecycle for the snapshot, reports `rolledBack:true` on success, and reports both primary and rollback errors when restoration fails.

- [ ] **Step 4: Run the focused adapter test and verify missing implementation**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/adapters/maplibre/map-adapter.test.js`

Expected: FAIL because the transaction/whole-Style functions and opaque prepared-handle provenance factory/registries are missing.

- [ ] **Step 5: Implement canonical SHA-256 and one reusable `waitForStyle` lifecycle**

In the DOM-free `src/core/canonical-json.ts`, first parse unknown input through foundation `jsonValueSchema` so canonicalization receives its descriptor-sanitized plain snapshot rather than reading the caller object. Normalize sanitizer failure to one stable exception that contains no input value. Recursively sort snapshot object keys, preserve array order, and serialize deterministically; do not maintain a second unsafe JSON walker. In `style-hash.ts`, import that function and hash its UTF-8 bytes with `globalThis.crypto.subtle.digest('SHA-256', ...)`; keep all work inside exported functions so importing the adapter has no side effect. Allow tests/embedders to inject `hashStyle`.

In `map-adapter.ts`, import MapLibre `StyleSpecification` as a type and implement the complete helper body exactly as `return style as StyleSpecification;`. This is the adapter's sole direct assertion: the public parameter accepts only the descriptor-sanitized core `StyleDocument`, the helper returns that identical object, and every call site must originate from core validation/transaction/finalization. Do not widen through `unknown`, accept raw `StyleSpecification`, clone, or add any other assertion. It is the only object-valued argument boundary for candidate/rollback `Map#setStyle`; keep it out of `adapters/maplibre/index.ts` because callers must enter through validation/transactions, not use the conversion seam directly.

Resolve `timeoutMs` into one absolute `MapOperationDeadline` exactly once at each public orchestration entry when no deadline was supplied; a standalone `prepareTransactionForMap` without one stamps its own 10-second preparation budget, while the composed API always supplies its already-stamped object. Implement one internal `raceWithMapDeadline<T>(work:Promise<T>, deadline:MapOperationDeadline):Promise<T>` used by every asynchronous hash and wait: check expiry/abort before subscribing, arm a timer for `max(0, expiresAt - now())`, attach both fulfillment and rejection handlers to `work`, settle once, remove timer/abort listener, and ignore every late fulfillment/rejection after timeout so no unhandled rejection escapes. Expiration becomes stable `TIMEOUT`; signal abortion uses the same code with `details:{reason:'aborted'}`. Initial validation finishes first so every later failure can carry either an explicit validated authority or the separate `unavailable` branch; after that safety boundary, canonicalization/transaction phases are checked immediately before and after execution. They cannot be preempted, but an expired result is discarded before any `Map#setStyle` call. Every nested phase computes only remaining time from the same object and never creates a fresh full-duration timer. Create MapLibre completion/error listeners and the remaining-budget timer before invoking the supplied callback, settle exactly once, and always remove both listeners and the timer. Each apparent completion validates a fresh raw `map.getStyle()` before hashing it; an invalid read is an apply failure, never a cast. Accept captured `style.load` or post-call loaded state only after validated expected-hash comparison. The later bridge must pass its wire deadline through this contract and reuse these exports rather than create a second canonicalization algorithm.

- [ ] **Step 6: Add prepare/apply, no-op, and successful branches**

`prepareTransactionForMap` uses the caller's shared `deadline`, or stamps its one standalone preparation deadline when omitted. At entry, read the three optional limit fields once into a new object with all three own keys: `{maxStyleBytes:options?.maxStyleBytes,maxDiffBytes:options?.maxDiffBytes,maxOperations:options?.maxOperations}`. This copies primitives only, retains explicit/absent `undefined`, and never preserves the mutable caller options reference. Do not validate, default, clamp, or otherwise resolve it in the adapter; the core calls below remain authoritative. A module-private `createPreparedMapStyleTransaction` is the only handle factory. It descriptor-sanitizes/deep-clones each JSON-backed Style/result graph, separately copies the optional primitive limits (preserving own `undefined` keys), recursively freezes every private/public container, creates a public-view clone with no shared nested references, installs the non-enumerable module-private unique-symbol brand, freezes the handle, and atomically records it in both the module-private provenance `WeakSet` and authority `WeakMap`. Neither the factory nor either registry is exported.

Read `rawBaseline = map.getStyle()` inside `try/catch`, then pass that value directly to `validateStyleDocument(rawBaseline,{maxStyleBytes:limitOptions.maxStyleBytes})`; never pass it as `finalizeStyleReplacement`'s typed first parameter and never cast it. A thrown read, failed validation, or missing narrowed Style returns `MapStyleUnavailableResult` with the first normalized core error (or one safe `INTERNAL` fallback), `styleAuthority:'unavailable'`, no `style`, and empty changes/diff. On validation success, retain only `validation.style` as `baseline:StyleDocument`, then call `finalizeStyleReplacement(baseline, baseline, {maxStyleBytes:limitOptions.maxStyleBytes,maxDiffBytes:limitOptions.maxDiffBytes})` as the core-owned no-op check for replacement/diff limits. A failure here is `styleAuthority:'current'` because no live mutation occurred and the baseline was just validated from the Map.

After that authority boundary, evaluate deadline/abort; on expiry return the stable live failure with `styleAuthority:'current'`, the validated baseline, and no candidate data. Otherwise compute canonical baseline synchronously, check the deadline again, await injected/default baseline hashing only through `raceWithMapDeadline`, and call `applyStyleTransaction(baseline, transaction, limitOptions)` exactly once. This passes the copied optional primitives unchanged, including values above defaults, and lets core resolve/validate them once into `OperationContext`; a core transaction failure is `current` because the Map was not touched. Check the same deadline immediately before and after the core call and before returning a prepared candidate. Only a narrowed `transactionResult.ok:true` may enter the private factory. The authority record captures independent deep immutable snapshots of validated baseline, exact candidate, baseline/candidate canonical strings, baseline hash, successful result, and limits; its public view is a different deep immutable copy containing only safe inspection fields. The adapter never parses/counts the unknown transaction, measures Style/diff bytes itself, or allows a late async result to escape.

`applyPreparedStyleToMap` never re-runs that transaction and cannot accept execution limits. Before reading options or touching the Map, it requires exact genuine-handle identity in the private `WeakSet`, an authority record in the private `WeakMap`, the expected private brand/own-property descriptors, and intact recursively frozen handle/view integrity. Any forged, cloned, proxied, structurally similar, deserialized, or mutated handle returns a core-factory `INVALID_INPUT` unavailable result with zero Map/hash/listener calls; there is no structural fallback and public `view` is never read to reconstruct authority. For a genuine handle, every remaining step reads only the private authority. It uses the supplied shared deadline for candidate hashing, baseline recheck, live wait, and rollback; when invoked as a standalone public entry without a deadline it may stamp one default apply-phase deadline, but the composed path always supplies its existing object. Immediately before mutation, read raw current Style and validate it with the private `limitOptions.maxStyleBytes`; if validation fails, return the private saved baseline only as `pre-operation`. Every completion, rollback, and fallback read uses that same private value. If the immediate read validates but its canonical form differs from the private baseline canonical string, return `REVISION_CONFLICT` with that newly validated Style and `styleAuthority:'current'`. Return a structural no-op as `current`; otherwise pass only the private frozen candidate snapshot through `toMapLibreStyleSpecification` and call `waitForStyle` with `map.setStyle(compatibleCandidate,{diff:options?.diff ?? true})`. Never use or share caller/public-view objects. Every completion candidate is re-read and validated before hash comparison.

`applyTransactionToMap` is the convenience composition: at entry it resolves `options.deadline` or stamps `expiresAt = now() + (timeoutMs ?? 10_000)` once. It constructs an explicit preparation options object containing only `deadline`, `hashStyle`, and the three copied optional core limits, then an explicit `PreparedStyleApplyOptions` object containing only that identical deadline, `hashStyle`, and `diff`; never spread the full caller options into phase two. Pass the same deadline object—not a copy or rebased value—to both phases. The same resolved diff boolean and deadline are used by the one best-effort rollback; they change only MapLibre's application behavior, never the core transaction/result diff or budget origin. This split is the only path the later browser bridge may use after candidate URL authorization, preventing transaction/authorization TOCTOU.

`applyStyleDocumentOrUrlToMap` is the explicit compatibility boundary for full-Style replacement used by `setStyleJsonOrUrl`; full AI tools must not call `Map#setStyle` themselves. At entry, resolve one absolute deadline exactly as `applyTransactionToMap` does and retain it through baseline validation, limit preflight, candidate hashing or URL load, resolved-style finalization, confirmation, and rollback. Obtain the baseline with the exact raw-read→`validateStyleDocument` narrowing above; initial failure returns `unavailable`. Only then call `finalizeStyleReplacement(baseline,baseline,{maxStyleBytes,maxDiffBytes})`; its failure is `current`. For object input, call core `finalizeStyleReplacement(baseline, candidate, {maxStyleBytes, maxDiffBytes})` before live mutation, skip its no-op, pass only `finalizerResult.style` through `toMapLibreStyleSpecification`, and give that identical compatible object to `setStyle`; confirm the expected hash through the same deadline-aware lifecycle. For a non-empty URL string, invoke `setStyle(url, {diff: options.diff ?? true})` exactly once after that preflight and require a fresh completion event within the same budget. Read the raw resolved Style, validate it with `validateStyleDocument(rawResolved,{maxStyleBytes})`, and only then call `finalizeStyleReplacement(baseline, resolvedValidation.style, {maxStyleBytes, maxDiffBytes})`; a thrown/invalid resolved read is an apply failure followed by rollback, never a typed assertion. Preserve absent limit options as `undefined`; never resolve, clamp, or recalculate them in the adapter. A URL that resolves to the same validated Style may report `applied:true` with an empty diff because a live reload occurred. Invalid input, loading failure, invalid resolved Style, or finalizer failure uses the same resolved diff boolean, absolute deadline, and rollback result table.

Every prepared rollback completion and fallback state read follows raw-read→`validateStyleDocument(raw,{maxStyleBytes:privateAuthority.limitOptions.maxStyleBytes})`; whole-document/URL rollback reads use their orchestration's same replacement limit. Confirmed validated restoration and a validated last-state fallback return `current`; if rollback/current re-read throws or fails validation, return the private saved validated baseline only as `pre-operation` and mark `rolledBack:false`. The adapter may not call `finalizeStyleReplacement` with raw `StyleSpecification`, import `diffStyleDocuments`, derive semantic IDs, count operations, measure bytes, resolve defaults, or cast/construct a fake current Style. This trusted application adapter does not authorize network URLs; the later bridge must perform its complete resource-policy authorization before any live mutation and must keep using the prepared JSON transaction path for bridge transactions.

- [ ] **Step 7: Add independent rollback reporting**

On asynchronous apply failure, convert the validated pre-operation snapshot through `toMapLibreStyleSpecification` and call a new `waitForStyle` invocation with that identical object using the same absolute deadline and AbortSignal. A rollback event counts as confirmed only after a fresh raw `getStyle` passes `validateStyleDocument` and its hash matches the snapshot; that result is `current`. Record `rolledBack` and `rollbackError` without replacing the primary apply error. If no budget remains or the current read is invalid, do not claim rollback success: return the saved snapshot as `pre-operation` (never current) with `TIMEOUT`/state-unknown details and let the browser runtime hold its queue until a later validated resynchronization. If a failure path has no validated baseline at all, return `unavailable` with no `style` field.

- [ ] **Step 8: Run adapter and core tests**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/canonical-json.test.js .tmp/test-dist/adapters/maplibre/map-adapter.test.js .tmp/test-dist/core/transaction.test.js`

Expected: PASS.

- [ ] **Step 9: Commit the live style adapter**

```bash
rtk git add src/core/canonical-json.ts src/core/canonical-json.test.ts src/core/index.ts src/adapters/maplibre/map-adapter.ts src/adapters/maplibre/map-adapter.test.ts src/adapters/maplibre/style-hash.ts src/adapters/maplibre/types.ts src/adapters/maplibre/index.ts
rtk git commit -m "feat: apply live transactions with opaque prepared handles"
```

### Task 12: Bound Live Feature Queries

**Files:**
- Create: `src/adapters/maplibre/feature-query.ts`
- Create: `src/adapters/maplibre/feature-query.test.ts`
- Create: `src/adapters/maplibre/schemas.ts`
- Create: `src/adapters/maplibre/schemas.test.ts`
- Modify: `src/adapters/maplibre/types.ts`
- Modify: `src/adapters/maplibre/index.ts`

**Interfaces:**
- Consumes: MapLibre `querySourceFeatures`/`queryRenderedFeatures` and foundation `jsonUtf8ByteLength`.
- Produces:

```ts
export interface FeatureQueryLimits {
  maxFeatures: number;
  maxSerializedBytes: number;
}

export type ScreenPoint = [number, number];
export type ScreenBounds = [ScreenPoint, ScreenPoint];
export interface FeatureProjectionInput {
  propertyAllowlist?: string[];
  limit?: number;
  maxSerializedBytes?: number;
}
export interface SourceFeatureQueryInput extends FeatureProjectionInput {
  sourceId: string;
  sourceLayer?: string;
  filter?: JsonValue[];
}
export type RenderedFeatureQueryGeometry =
  | { kind: 'viewport' }
  | { kind: 'point'; point: ScreenPoint }
  | { kind: 'bounds'; bounds: ScreenBounds };
export type RenderedFeatureQueryInput = FeatureProjectionInput & {
  geometry?: RenderedFeatureQueryGeometry;
  layerIds?: string[];
  filter?: JsonValue[];
};

export interface BoundedFeatureQueryResult {
  ok: boolean;
  features: JsonObject[];
  returned: number;
  truncated: boolean;
  serializedBytes: number;
  warnings: StyleWarning[];
  error?: StyleToolError;
}

export const DEFAULT_FEATURE_QUERY_LIMITS: FeatureQueryLimits;
export const featureQueryLimitsSchema: z.ZodType<FeatureQueryLimits>;
export const sourceFeatureQueryInputSchema: z.ZodType<SourceFeatureQueryInput>;
export const renderedFeatureQueryInputSchema: z.ZodType<RenderedFeatureQueryInput>;

export function querySourceFeaturesBounded(
  map: Map,
  input: SourceFeatureQueryInput,
  limits?: FeatureQueryLimits
): BoundedFeatureQueryResult;
export function queryRenderedFeaturesBounded(
  map: Map,
  input: RenderedFeatureQueryInput,
  limits?: FeatureQueryLimits
): BoundedFeatureQueryResult;
```

- [ ] **Step 1: Write failing source/rendered parameter tests**

Define the complete shapes above in `types.ts`. `DEFAULT_FEATURE_QUERY_LIMITS` is exactly `{maxFeatures:100,maxSerializedBytes:1024*1024}`. `featureQueryLimitsSchema` is descriptor-sanitized and `.strict()`, requires positive safe integers, and is parsed before either input or any Map access. Two module-private schema factories accept only already parsed limits and build descriptor-sanitized schemas that are `.strict()` at every wrapper/discriminated object: source ID/source-layer are non-empty; filter is a JSON-safe array; `geometry` defaults to `{kind:'viewport'}` and is exactly viewport, finite point, or finite two-corner bounds; layer IDs/property allowlists contain unique non-empty strings; and requested `limit`/`maxSerializedBytes` are positive safe integers no greater than those configured maxima. The two named exported schema constants are the default instances returned with `DEFAULT_FEATURE_QUERY_LIMITS`. Assert unknown keys, malformed coordinates/bounds, non-JSON filters, duplicate/empty names, invalid configured limits, and requested limits outside configured maxima fail before a Map call. Assert valid options are translated once to MapLibre's documented query arguments (`undefined`, point, or bounds geometry; `layers`, `filter`, and `sourceLayer`) without forwarding projection-only fields, and Map exceptions become structured errors.

- [ ] **Step 2: Write failing count/allowlist/byte tests**

Assert default 100-feature truncation, lower requested limit, rejection above configured maximum, property allowlist projection without mutating MapLibre features, 1 MiB truncation, and exclusion of a first feature that alone exceeds the byte budget. Include a MapLibre feature carrying class methods/accessors/cyclic runtime metadata and prove only the explicitly projected plain JSON DTO is returned and accepted by the core JSON gate. Add exact byte-boundary cases proving an empty result costs two UTF-8 bytes for `[]`, the first feature adds its JSON bytes, and each subsequent feature adds one comma byte.

- [ ] **Step 3: Run the focused test and verify missing implementation**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/adapters/maplibre/schemas.test.js .tmp/test-dist/adapters/maplibre/feature-query.test.js`

Expected: FAIL because bounded query helpers are absent.

- [ ] **Step 4: Implement incremental serialized-size accounting**

Parse the optional configured limits through `featureQueryLimitsSchema` (using the exported default when omitted), instantiate the corresponding module-private schema factory with those parsed maxima, then parse the complete public input before touching the Map. Project each feature into a newly allocated `JsonObject` DTO containing only approved JSON feature/metadata fields, apply the property allowlist, and pass the projection through the core JSON-tree gate; never return the MapLibre feature instance, methods, accessors, or shared runtime objects. Initialize serialized size to the two UTF-8 bytes for `[]`, then call foundation `jsonUtf8ByteLength(projectedFeature)` once per candidate and add one comma byte after the first accepted feature. Stop before either limit is exceeded. Return `truncated:true` and a warning; do not create another byte counter or use Node `Buffer` in this browser adapter, and do not deduplicate features because MapLibre may return tile-boundary duplicates.

- [ ] **Step 5: Run feature-query tests**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/adapters/maplibre/schemas.test.js .tmp/test-dist/adapters/maplibre/feature-query.test.js`

Expected: PASS.

- [ ] **Step 6: Commit bounded queries**

```bash
rtk git add src/adapters/maplibre/feature-query.ts src/adapters/maplibre/feature-query.test.ts src/adapters/maplibre/schemas.ts src/adapters/maplibre/schemas.test.ts src/adapters/maplibre/types.ts src/adapters/maplibre/index.ts
rtk git commit -m "feat: bound live map feature queries"
```

### Task 13: Isolate Runtime State and Image Commands

**Files:**
- Create: `src/adapters/maplibre/geojson-diff.ts`
- Create: `src/adapters/maplibre/geojson-diff.test.ts`
- Create: `src/adapters/maplibre/runtime-commands.ts`
- Create: `src/adapters/maplibre/runtime-commands.test.ts`
- Modify: `src/adapters/maplibre/types.ts`
- Modify: `src/adapters/maplibre/schemas.ts`
- Modify: `src/adapters/maplibre/index.ts`

**Interfaces:**
- Consumes: MapLibre feature-state, global-state, incremental GeoJSON `updateData`, source-tile LOD, sprite, and image APIs; core GeoJSON DTO/validation, `DEFAULT_GEOJSON_LIMITS`, `jsonValueSchema`, `jsonUtf8ByteLength`, and `DEFAULT_MAX_DIFF_BYTES`. Full GeoJSON `setData` remains a document mutation through core `setGeoJsonData`; this runtime boundary must not create a second authoritative path for it. MapLibre's upstream `GeoJSONSourceDiff` is type-only evidence at the final call, never this package's public runtime input because its nested `addOrUpdateProperties[].value` is `any`.
- Produces:

```ts
export type RuntimeCommandResult<T extends JsonValue = JsonValue> =
  | { ok: true; data: T }
  | { ok: false; error: StyleToolError };
export type RuntimeListData<T extends JsonValue> = JsonObject & {
  items: T[];
  returned: number;
  truncated: boolean;
};

export interface FeatureTargetInput {
  source: string;
  sourceLayer?: string;
  id: string | number;
}
export interface FeatureStateInput { target: FeatureTargetInput; state: JsonObject }
export interface RemoveFeatureStateInput { target: FeatureTargetInput; key?: string }
export interface GlobalStateInput { propertyName: string; value: JsonValue }
export interface ImageOptionsInput {
  pixelRatio?: number;
  sdf?: boolean;
  content?: [number, number, number, number];
  stretchX?: Array<[number, number]>;
  stretchY?: Array<[number, number]>;
}
export interface ImageDataLike {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}
export interface AddImageDataInput { imageId: string; image: ImageDataLike; options?: ImageOptionsInput; overwrite?: boolean }
export interface AddImageFromUrlInput { imageId: string; url: string; options?: ImageOptionsInput; overwrite?: boolean }
export interface AddSpriteInput { spriteId: string; url: string; overwrite?: boolean }
export interface RuntimeListInput { limit?: number }
export interface RemoveImageInput { imageId: string }
export interface RemoveSpriteInput { spriteId: string }
export interface RuntimeCommandExecution { signal?: AbortSignal }

export type RuntimeGeoJsonFeatureId = string | number;
export type RuntimeGeoJsonAddFeature = GeoJsonFeature<GeoJsonGeometry>;
export type RuntimeGeoJsonPropertyPatch = {
  key: string;
  value: JsonValue;
};
export type RuntimeGeoJsonFeaturePatch = {
  id: RuntimeGeoJsonFeatureId;
  newGeometry?: GeoJsonGeometry;
  removeAllProperties?: boolean;
  removeProperties?: string[];
  addOrUpdateProperties?: RuntimeGeoJsonPropertyPatch[];
};
export type RuntimeGeoJsonSourceDiff = {
  removeAll?: boolean;
  remove?: RuntimeGeoJsonFeatureId[];
  add?: RuntimeGeoJsonAddFeature[];
  update?: RuntimeGeoJsonFeaturePatch[];
};
export type RuntimeGeoJsonSourceDiffValidationResult =
  | { ok: true; value: RuntimeGeoJsonSourceDiff }
  | { ok: false; error: StyleToolError };

export const runtimeGeoJsonSourceDiffSchema: z.ZodType<RuntimeGeoJsonSourceDiff>;
export function sanitizeRuntimeGeoJsonSourceDiff(value: unknown): RuntimeGeoJsonSourceDiffValidationResult;

export interface MapRuntimeCommands {
  updateGeoJsonDataRuntime(input: RuntimeGeoJsonDiffUpdate): Promise<RuntimeCommandResult>;
  setSourceTileLodParams(input: SourceTileLodParamsInput): RuntimeCommandResult;
  setFeatureState(input: FeatureStateInput): RuntimeCommandResult;
  removeFeatureState(input: RemoveFeatureStateInput): RuntimeCommandResult;
  setGlobalState(input: GlobalStateInput): RuntimeCommandResult;
  listImages(input?: RuntimeListInput): RuntimeCommandResult<RuntimeListData<string>>;
  addImageData(input: AddImageDataInput): RuntimeCommandResult;
  addImageFromUrl(input: AddImageFromUrlInput, execution?: RuntimeCommandExecution): Promise<RuntimeCommandResult>;
  removeImage(input: RemoveImageInput): RuntimeCommandResult;
  listSprites(input?: RuntimeListInput): RuntimeCommandResult<RuntimeListData<JsonObject>>;
  addSprite(input: AddSpriteInput): RuntimeCommandResult;
  removeSprite(input: RemoveSpriteInput): RuntimeCommandResult;
}

export type RuntimeGeoJsonDiffUpdate = {
  sourceId: string;
  diff: RuntimeGeoJsonSourceDiff;
};

export interface SourceTileLodParamsInput {
  maxZoomLevelsOnScreen: number;
  tileCountMaxMinRatio: number;
  sourceId?: string;
}

export interface RuntimeImageLoader {
  load(url: string, options: { signal: AbortSignal }): Promise<ImageDataLike>;
}

export const runtimeGeoJsonDiffUpdateSchema: z.ZodType<RuntimeGeoJsonDiffUpdate>;
export const sourceTileLodParamsInputSchema: z.ZodType<SourceTileLodParamsInput>;
export const featureStateInputSchema: z.ZodType<FeatureStateInput>;
export const removeFeatureStateInputSchema: z.ZodType<RemoveFeatureStateInput>;
export const globalStateInputSchema: z.ZodType<GlobalStateInput>;
export const imageOptionsInputSchema: z.ZodType<ImageOptionsInput>;
export const addImageDataInputSchema: z.ZodType<AddImageDataInput>;
export const addImageFromUrlInputSchema: z.ZodType<AddImageFromUrlInput>;
export const addSpriteInputSchema: z.ZodType<AddSpriteInput>;
export const runtimeListInputSchema: z.ZodType<RuntimeListInput>;
export const removeImageInputSchema: z.ZodType<RemoveImageInput>;
export const removeSpriteInputSchema: z.ZodType<RemoveSpriteInput>;

export function createMapRuntimeCommands(
  map: Map,
  options?: { imageLoader?: RuntimeImageLoader }
): MapRuntimeCommands;
```

- [ ] **Step 1: Write failing strict GeoJSON diff and runtime command tests**

In `geojson-diff.test.ts`, lock the complete package-owned diff grammar: `.strict()` top-level `removeAll`/`remove`/`add`/`update`; string-or-finite-number IDs; RFC-valid added Features with non-null geometry (matching MapLibre's exported `GeoJSONSourceDiff` contract); and `.strict()` update/property-patch objects containing required `id`/`key` plus at least one effective update action: present `newGeometry`, `removeAllProperties:true`, non-empty `removeProperties`, or non-empty `addOrUpdateProperties`. Optional arrays, when present, are non-empty; `removeAllProperties:false` alone is rejected; remove/update IDs and property names are unique within their arrays; property keys are non-empty; `addOrUpdateProperties[].value` is `JsonValue`; and the whole diff must perform at least one action (`removeAll:false` alone is not one). Verify valid combinations retain MapLibre's documented remove→add→update ordering rather than rejecting cross-list ID reuse. Null Feature geometry remains valid for full inline GeoJSON in core, but is deliberately rejected only at this narrower upstream diff boundary. `RuntimeGeoJsonSourceDiff`, `RuntimeGeoJsonFeaturePatch`, `RuntimeGeoJsonPropertyPatch`, and their `RuntimeGeoJsonDiffUpdate` command envelope are closed object type aliases—never `interface` and never `JsonObject & {...}`. Add `AssertTrue<T extends true>` compile contracts proving the first three each extend `JsonObject`, plus `// @ts-expect-error` object literals proving an extra key is rejected independently at the diff, update-item, and property-item levels. Mirror those exact three excess-key cases at runtime and assert each strict Zod error path. RFC 7946 Feature/Geometry DTOs alone may retain their existing open `JsonObject &` foreign-member shape because the RFC explicitly permits foreign members; that exception does not widen the command/diff envelopes.

Assert every added Feature known member, `bbox`, `id`, properties, foreign member, every replacement geometry/coordinate, and every property patch value passes through the foundation descriptor sanitizer into one plain snapshot. Reject unknown wrapper/update keys, malformed Features/geometries/bboxes, null `newGeometry`, non-finite coordinates, dangerous keys, functions, `undefined`, `Date`, symbols, hidden/accessor properties, aliases, cycles, revoked Proxies, and over-limit diff bytes/feature changes/coordinate positions/property depth without invoking a getter. Include exactly-at/one-over `DEFAULT_MAX_DIFF_BYTES` cases using `jsonUtf8ByteLength`, and aggregated add-plus-update coordinate/count cases. `sanitizeRuntimeGeoJsonSourceDiff` must return no partial value on failure. Add a compile-time assignment from its success value to MapLibre's imported `GeoJSONSourceDiff` with no `any`, `unknown`, or assertion cast; do not export the upstream type as an accepted input.

In `runtime-commands.test.ts`, cover every other exported strict input schema, including list/remove inputs, and assert unknown-key and invalid-value rejection before any Map call, unsupported non-GeoJSON sources, awaited Promise completion, feature-state target/key forwarding, global-state forwarding, image collision/overwrite/raw-data/protocol-aware-load/update/add/remove, sprite list/add/overwrite/remove, list limits, abort propagation, and Map exceptions. Assert image and sprite lists both enforce configured maxima before allocating output and return `{items,returned,truncated}`. Assert every returned `data` is JSON-safe and contains no `ImageDataLike` bytes. Treat `ImageDataLike` as the one explicit trusted binary boundary: its schema accepts only positive integer dimensions and `Uint8Array`/`Uint8ClampedArray` with exact `width*height*4` length, while all surrounding IDs/options remain strict JSON. Type the fake GeoJSON source method as `(diff: GeoJSONSourceDiff) => Promise<void>`, assert it records exactly one argument, receives the exact plain object emitted by `runtimeGeoJsonDiffUpdateSchema`, and remains pending until its deferred Promise settles. Add compile-only checks that `Parameters<GeoJSONSource['updateData']>` is the one-element tuple `[diff: GeoJSONSourceDiff]`, `ReturnType<GeoJSONSource['updateData']>` is `Promise<void>`, and a two-argument call is a `// @ts-expect-error`; this locks the shipped MapLibre 6.3 contract. Assert source-tile LOD calls `map.setSourceTileLodParams(maxZoomLevelsOnScreen, tileCountMaxMinRatio, sourceId)` and omission of `sourceId` is preserved to mean all sources.

- [ ] **Step 2: Run the focused test and verify missing factory**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/adapters/maplibre/geojson-diff.test.js .tmp/test-dist/adapters/maplibre/runtime-commands.test.js`

Expected: FAIL because the closed diff/update/property DTO schemas, one-argument Promise-aware `updateData` path, sanitizer, and runtime-command factory are missing.

- [ ] **Step 3: Implement the package-owned GeoJSON diff sanitizer, then move update/state commands**

Implement `runtimeGeoJsonSourceDiffSchema` in `geojson-diff.ts` as a transforming boundary whose very first stage is the foundation descriptor sanitizer over the complete unknown diff. The later strict shape stage reads only that plain snapshot. Reuse core `inlineGeoJsonSchema`/`validateInlineGeoJson` without a second GeoJSON walker as follows: validate the complete `add` array once inside a newly allocated `{type:'FeatureCollection',features:add}`; validate each `update[].newGeometry` directly so it begins at geometry depth `1`; and validate each update's property patch values inside a newly allocated `{type:'Feature',geometry:null,properties}` whose properties object is built from its already uniqueness-checked `addOrUpdateProperties` entries. Translate synthetic wrapper paths back to the original `/add/{i}` and `/update/{i}/...` paths before returning an error. Sum coordinate counts from the addition collection and every replacement geometry, and enforce `remove.length + add.length + update.length <= DEFAULT_GEOJSON_LIMITS.maxFeatures` plus the shared coordinate limit. The sanitizer's initial whole-graph pass has already rejected cross-entry aliases/cycles.

Finally call `jsonUtf8ByteLength(plainDiff)` once for the complete diff and compare it with `DEFAULT_MAX_DIFF_BYTES`; the fragment validators' own shared byte checks are defensive and do not replace this wire-size limit. Normalize every failure as path-specific `INVALID_INPUT`. `sanitizeRuntimeGeoJsonSourceDiff` is the stable non-throwing wrapper over that schema. Do not copy MapLibre's upstream `any`, use recursive Zod geometry definitions, or maintain another coordinate/bbox/property-depth walker.

Build `runtimeGeoJsonDiffUpdateSchema` as a descriptor-sanitized `.strict()` wrapper around a non-empty `sourceId` and the package-owned `.strict()` diff/update/property schemas; inferred output must remain exactly consistent with the four closed public type aliases. Export the named property/update/diff/envelope aliases, both diff schemas, sanitizer, and all remaining schemas from the adapter barrel. Retain open `JsonObject &` only inside the already defined RFC 7946 foreign-member Feature/Geometry DTOs, never on incremental command inputs. Every public runtime method parses its entire structured input before `getSource`, image loading, or any Map call; the optional list envelope defaults to `{}` and is still parsed by `runtimeListInputSchema`. `updateGeoJsonDataRuntime` consumes only `runtimeGeoJsonDiffUpdateSchema` output. Assign `parsed.diff` directly to an internal `GeoJSONSourceDiff` variable as the no-cast compile-time compatibility check, then execute exactly `await source.updateData(parsed.diff)`. The MapLibre 6.3 method takes one argument and already returns `Promise<void>`; do not pass a boolean, feature flag, compatibility sentinel, or overload probe. No handler may accept, cast, spread, or forward the caller's original diff.

Validate both LOD numbers as positive and forward an optional source ID without synthesizing one; return `NOT_FOUND` only when an explicit source ID is absent from the live map. Forward state commands exactly to `map.setFeatureState(input.target, input.state)`, `map.removeFeatureState(input.target, input.key)`, and `map.setGlobalStateProperty(input.propertyName, input.value)` after validation; normalize synchronous/async errors. Do not expose runtime `setData`: the full tool's `setData` mode must route through the atomic core `setGeoJsonData` transaction.

- [ ] **Step 4: Move image commands**

Port list/raw-data/load/add/update/remove behavior. `addImageData` accepts already decoded MapLibre-compatible image data. `addImageFromUrl` delegates to an injected `RuntimeImageLoader` that receives an `AbortSignal`; the default may wrap `map.loadImage`, while browser-bridge callers can inject a loader that understands registered/custom MapLibre protocols. Never hard-code `fetch` as the only loader. Preserve overwrite checks and cap list output before constructing the result.

- [ ] **Step 5: Move sprite commands**

Port list/add/overwrite/remove behavior using `getSprite`, `addSprite`, and `removeSprite`; preserve existing IDs and URLs in the structured result.

- [ ] **Step 6: Run runtime and adapter tests**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/adapters/maplibre/geojson-diff.test.js .tmp/test-dist/adapters/maplibre/runtime-commands.test.js .tmp/test-dist/adapters/maplibre/map-adapter.test.js .tmp/test-dist/adapters/maplibre/feature-query.test.js`

Expected: PASS.

- [ ] **Step 7: Commit runtime commands**

```bash
rtk git add src/adapters/maplibre/geojson-diff.ts src/adapters/maplibre/geojson-diff.test.ts src/adapters/maplibre/runtime-commands.ts src/adapters/maplibre/runtime-commands.test.ts src/adapters/maplibre/types.ts src/adapters/maplibre/schemas.ts src/adapters/maplibre/index.ts
rtk git commit -m "feat: add closed MapLibre v6 runtime command DTOs"
```

### Task 14: Define Unified AI Schemas, Parsing, and Results

**Files:**
- Create: `src/ai-sdk/schemas.ts`
- Create: `src/ai-sdk/schemas.test.ts`
- Create: `src/ai-sdk/compatibility.ts`
- Create: `src/ai-sdk/result.ts`
- Modify: `src/ai-sdk/compatibility.test.ts`
- Create: `src/ai-sdk/index.ts`

**Interfaces:**
- Consumes: exported core operation/transaction schemas and adapter result types.
- Produces:

```ts
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StyleToolError };

export type CommonResultFields<TData, TStyle> = {
  message: string;
  data?: TData;
  style?: TStyle;
};
export type CommonResultInput<TData = unknown, TStyle = unknown> =
  | (CommonResultFields<TData, TStyle> & { success: true })
  | (CommonResultFields<TData, TStyle> & { success: false; error: StyleToolError });
export type AiStyleToolResult<TData = unknown, TStyle = unknown> = CommonResultInput<TData, TStyle>;

export function parseStrictJson(raw: string, label: string): ParseResult<JsonValue>;
export function parseJsonOrRawString(raw: string, label: string): ParseResult<JsonValue>;
export function normalizeLegacyOperations(raw: string): ParseResult<StyleTransaction>;
export function toAiToolResult<TData, TStyle>(input: CommonResultInput<TData, TStyle>): AiStyleToolResult<TData, TStyle>;
export const strictJsonTextSchema: z.ZodType<string>;
export const jsonOrRawStringTextSchema: z.ZodType<string>;
export const legacyOperationsTextSchema: z.ZodType<string>;
export const filterTextSchema: z.ZodType<string>;
export const styleJsonOrUrlTextSchema: z.ZodType<string>;
```

- [ ] **Step 1: Extend compatibility tests with parsing and envelope failures**

In `schemas.test.ts`, assert the exported reusable text schemas are bounded and select the required parser family: operations/filter/batch/Style-document fields require strict JSON; legacy scalar values and `setStyleJsonOrUrl` use JSON-or-raw-string parsing while rejecting malformed object/array-looking text. In compatibility tests, assert valid object/array/scalar strict JSON, malformed JSON with `INVALID_INPUT`, and JSON-or-raw parsing for bare colors such as `#ff0000`, font names, and bare `https://…` values. Assert old compact operation objects normalize to `setLayerProperties`, full-tool `filterJson` and compact filter fields normalize `null` to clear/non-null to replace, and `success/message/style` remain preserved. Add compile-time and runtime narrowing tests for `ParseResult`, `CommonResultInput`, and `AiStyleToolResult`: `.value` exists only when `ok:true`, a failed AI result requires an authentic `error`, and a successful AI result has no `error` member (`// @ts-expect-error` on both construction and property access).

- [ ] **Step 2: Run the focused test and verify missing modules**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/ai-sdk/schemas.test.js .tmp/test-dist/ai-sdk/compatibility.test.js`

Expected: FAIL because parsing/result helpers are absent.

- [ ] **Step 3: Implement one parsing boundary**

All legacy string decoding must occur in `compatibility.ts`; full/compact tool modules receive normalized structured values. Define the three discriminated result types exactly as shown above in `result.ts`/`compatibility.ts` before any helper signature uses them; do not leave local aliases or implicit inferred object unions in the tool files. Implement the exported bounded reusable Zod text schemas in `schemas.ts` and have them delegate to the designated parser rather than reimplement JSON logic. Every actual AI tool receives a `.strict()` exported object schema in Tasks 15–16; the scalar text schemas here validate only the designated legacy field after that outer object boundary. `parseStrictJson` is mandatory for fields documented as JSON (`operationsJson`, filter JSON, batch objects, Style documents). `parseJsonOrRawString` first parses valid JSON and otherwise returns the original non-empty string for legacy scalar/URL fields such as `valueJson` and `setStyleJsonOrUrl`; it must never turn malformed object/array-looking text into a raw string. Use `jsonUtf8ByteLength` for the conservative text-size gate and core exported schemas after parsing, returning a `ParseResult` error without throwing JSON exceptions through AI SDK.

- [ ] **Step 4: Implement one result constructor**

`toAiToolResult` accepts only the discriminated `CommonResultInput` above, always emits `success` and `message`, emits `data/style` only when defined, emits `error` exactly on the failure branch, and does not serialize the whole Style into `data` unless the caller explicitly requested it. This constructor receives only library-built result objects; it is not registered as an AI tool or re-exported as a user-input boundary. Its tests still pass frozen inputs and prove it never mutates `data` or the legacy generic `style` value.

- [ ] **Step 5: Run compatibility tests**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/ai-sdk/schemas.test.js .tmp/test-dist/ai-sdk/compatibility.test.js`

Expected: PASS.

- [ ] **Step 6: Commit AI compatibility infrastructure**

```bash
rtk git add src/ai-sdk/schemas.ts src/ai-sdk/schemas.test.ts src/ai-sdk/compatibility.ts src/ai-sdk/result.ts src/ai-sdk/compatibility.test.ts src/ai-sdk/index.ts
rtk git commit -m "feat: unify AI tool schemas and results"
```

### Task 15: Converge and Extend the Compact Factory

**Files:**
- Create: `src/ai-sdk/compact-tools.ts`
- Create: `src/ai-sdk/compact-tools.test.ts`
- Modify: `src/ai-sdk/schemas.ts`
- Modify: `src/tools/compact-tools.ts`
- Modify: `src/ai-sdk/index.ts`
- Modify: `src/index.ts`
- Modify: `src/public-api-compatibility.test.ts`

**Interfaces:**
- Consumes: core context/search/analysis/transactions, MapLibre adapter, AI schemas/compatibility/results.
- Produces: existing five compact tools plus structured `analyzeGeoJson`, `listSourceLayers`, `duplicateLayer`, `addLayerFromSource`, `addGeoJsonLayer`, and `applyStyleTransaction` tools.

- [ ] **Step 1: Write failing compact compatibility tests**

Assert the original five names remain in original order as a stable prefix, `operationsJson` accepts the old compact array and delegates to one core transaction, dry run does not call `setStyle`, Map-not-ready uses the common envelope, and invalid JSON returns `INVALID_INPUT`. Feed `current`, `pre-operation`, and `unavailable` Map adapter results through the compact wrapper: only `current` may expose its `data.style` as live authority; `pre-operation` is labelled stale/baseline-only; `unavailable` is serialized without reading or inventing `style`. The legacy generic outer `style` value, when present, still comes only from the factory's application state contract and is never confused with adapter authority. For legacy `applyStyleOperations`, lock `diff` defaulting to `true`; with `dryRun:false`, `diff:false` still applies and awaits the live map but passes `{diff:false}`, while the common result retains the same core semantic diff as `diff:true`; with `dryRun:true`, neither value calls the Map. Update `public-api-compatibility.test.ts` so it no longer asserts an exact total of five: assert the frozen legacy tuple and each explicitly approved structured name separately, making both accidental removal and accidental unnamed growth visible.

- [ ] **Step 2: Write failing structured-tool tests**

Execute each new tool against a fake Map. Assert actual object/array inputs rather than encoded JSON, compact bounded data, common envelopes, changed layer/source IDs, diff, and analysis/source-layer results.

- [ ] **Step 3: Run the focused test and verify missing new tools**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/ai-sdk/compact-tools.test.js`

Expected: FAIL because the new module/tools are absent.

- [ ] **Step 4: Move the existing five compact tools**

Move the five definitions into `src/ai-sdk/compact-tools.ts`; replace inline parsing and old engine calls with Tasks 11 and 14 while retaining names, descriptions, defaults, and output fields.

- [ ] **Step 5: Add compact analysis and discovery tools**

Add structured `analyzeGeoJson` and `listSourceLayers` using core schemas and compact bounded summaries.

- [ ] **Step 6: Add compact mutation tools**

Add structured `duplicateLayer`, `addLayerFromSource`, `addGeoJsonLayer`, and `applyStyleTransaction`; route all four through `applyTransactionToMap` except dry runs, which call synchronous core only. The structured transaction schema owns optional `diff:z.boolean().default(true)` independently of the transaction payload and forwards that resolved value only as the adapter option; it never inserts `diff` into `StyleTransaction` or suppresses the semantic result diff. Extend `ai-sdk/schemas.ts` with each compact tool's named exported `.strict()` input schema and assert unknown keys/over-limit arrays are rejected before any Map access.

- [ ] **Step 7: Replace the old path with a re-export shim**

`src/tools/compact-tools.ts` must contain only exports from `../ai-sdk/compact-tools.js` and exported compatibility types. Keep the root factory export unchanged.

- [ ] **Step 8: Run compact, compatibility, adapter, and core tests**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/public-api-compatibility.test.js .tmp/test-dist/ai-sdk/schemas.test.js .tmp/test-dist/ai-sdk/compact-tools.test.js .tmp/test-dist/ai-sdk/compatibility.test.js .tmp/test-dist/adapters/maplibre/map-adapter.test.js .tmp/test-dist/core/transaction.test.js`

Expected: PASS.

- [ ] **Step 9: Commit compact convergence**

```bash
rtk git add src/ai-sdk/compact-tools.ts src/ai-sdk/compact-tools.test.ts src/ai-sdk/schemas.ts src/tools/compact-tools.ts src/ai-sdk/index.ts src/index.ts src/public-api-compatibility.test.ts
rtk git commit -m "feat: converge compact AI style tools"
```

### Task 16: Converge the Full Factory Without Removing Legacy Tools

**Files:**
- Create: `src/core/operations/compatibility.ts`
- Create: `src/core/operations/compatibility.test.ts`
- Create: `src/ai-sdk/full-tools.ts`
- Create: `src/ai-sdk/full-tools.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/schemas.ts`
- Modify: `src/core/transaction.ts`
- Modify: `src/core/index.ts`
- Modify: `src/core/style-operation-json-contract.test.ts`
- Modify: `src/ai-sdk/schemas.ts`
- Modify: `src/index.ts`
- Modify: `src/ai-sdk/index.ts`
- Modify: `src/public-api-compatibility.test.ts`
- Delete: `src/tools/legacy-property-adapter.ts`
- Delete: `src/tools/legacy-property-adapter.test.ts`

**Interfaces:**
- Consumes: Tasks 11–14 plus `FULL_LEGACY_TOOL_NAMES`.
- Produces: all existing 53 full tools plus the same high-level structured document tools and bounded query tools as the compact/runtime surfaces. Raw legacy definition edits become real variants of the one `StyleOperation` union and one exhaustive transaction dispatcher:

```ts
export type CompatibilityStyleOperation =
  | { op: 'addLayerDefinition'; layer: JsonObject; beforeId?: string }
  | { op: 'deepMergeLayerDefinition'; layerId: string; patch: JsonObject }
  | { op: 'replaceLayerDefinition'; layerId: string; layer: JsonObject }
  | { op: 'deepMergeSourceDefinition'; sourceId: string; patch: JsonObject }
  | { op: 'replaceSourceDefinition'; sourceId: string; source: JsonObject }
  | { op: 'replaceRootProperty'; property: 'metadata' | 'transition' | 'sky' | 'projection' | 'terrain'; value: JsonObject | null }
  | { op: 'shallowPatchRootProperty'; property: 'light'; patch: JsonObject };

export function applyCompatibilityStyleOperation(
  style: StyleDocument,
  operation: CompatibilityStyleOperation,
  context: OperationContext
): OperationApplyResult;

export function applyValidatedCompatibilityEdit(
  style: StyleDocument,
  operation: CompatibilityStyleOperation
): StyleTransactionResult;
```

The migration is complete only when this exact 53-row routing matrix is represented in a table-driven test that invokes every name and spies on the stated boundary:

The same characterization table has a dedicated `diff` submatrix for the nine full legacy tools that expose the flag: `patchLayerDefinition`, `replaceLayerDefinition`, `patchSourceDefinition`, `replaceSourceDefinition`, `setStyleJsonOrUrl`, `setStyleName`, `setStyleMetadata`, `setStyleTransition`, and `setStyleCameraDefaults`. For each, omission resolves to `true`; explicit `false` reaches `applyTransactionToMap`/`applyStyleDocumentOrUrlToMap` unchanged, performs and awaits the mutation, is reused by rollback, and leaves returned core diff/changed IDs intact. The only compact legacy flag is covered separately on `applyStyleOperations` in Task 15. No other legacy tool gains a new `diff` field.

| # | Legacy full tool | Required route |
|---:|---|---|
| 1 | `listAllLayers` | validated snapshot → core context/discovery |
| 2 | `listAllSources` | validated snapshot → core document discovery |
| 3 | `inspectLayerStyle` | validated snapshot → core layer inspection |
| 4 | `inspectSource` | validated snapshot → core source inspection |
| 5 | `setLayerPaintProperty` | core `setLayerProperties` transaction |
| 6 | `setLayerLayoutProperty` | core `setLayerProperties` transaction |
| 7 | `setLayerPaintPropertySmart` | core `setLayerProperties` transaction |
| 8 | `setLayerLayoutPropertySmart` | core `setLayerProperties` transaction |
| 9 | `batchSetLayerPaintPropertiesSmart` | one atomic core transaction |
| 10 | `batchSetLayerLayoutPropertiesSmart` | one atomic core transaction |
| 11 | `batchSetLayerPaintProperties` | one atomic core transaction |
| 12 | `batchSetLayerLayoutProperties` | one atomic core transaction |
| 13 | `clearLayerPaintProperty` | core `setLayerProperties` null patch |
| 14 | `clearLayerLayoutProperty` | core `setLayerProperties` null patch |
| 15 | `setLayerFilter` | core `setLayerFilter` transaction |
| 16 | `setLayerZoomRange` | core `setLayerProperties` transaction |
| 17 | `setLayerVisibility` | core `setLayerProperties` transaction |
| 18 | `addLayer` | core `addLayerDefinition` compatibility operation |
| 19 | `moveLayer` | core `moveLayer` transaction |
| 20 | `removeLayer` | core `removeLayer` transaction |
| 21 | `patchLayerDefinition` | core `deepMergeLayerDefinition` compatibility operation (legacy null values are retained) |
| 22 | `replaceLayerDefinition` | core `replaceLayerDefinition` compatibility operation |
| 23 | `addSource` | core `addSource` transaction |
| 24 | `removeSource` | core `removeSource` transaction |
| 25 | `updateGeoJsonSourceData` | core `setGeoJsonData` transaction for `setData`; `MapRuntimeCommands.updateGeoJsonDataRuntime` with package-owned strict diff DTO for `updateData` |
| 26 | `setGeoJsonClusterOptions` | core `patchSource` transaction |
| 27 | `setSourceTileLodParams` | `MapRuntimeCommands.setSourceTileLodParams` (optional source ID means all sources) |
| 28 | `patchSourceDefinition` | core `deepMergeSourceDefinition` compatibility operation (legacy null values are retained) |
| 29 | `replaceSourceDefinition` | core `replaceSourceDefinition` compatibility operation |
| 30 | `setStyleJsonOrUrl` | strict document validation or raw URL parsing → `applyStyleDocumentOrUrlToMap` (never direct `Map#setStyle`) |
| 31 | `inspectRootStyle` | validated snapshot → core root inspection |
| 32 | `setStyleName` | core `setStyleRootProperties` transaction |
| 33 | `setStyleMetadata` | core `replaceRootProperty` compatibility operation (whole-field replace/clear) |
| 34 | `setStyleTransition` | core `replaceRootProperty` compatibility operation (whole-field replace/clear) |
| 35 | `setStyleCameraDefaults` | core `setStyleRootProperties` transaction |
| 36 | `validateStyleJson` | core `validateStyleDocument` |
| 37 | `validateCurrentMapStyle` | validated snapshot → core `validateStyleDocument` |
| 38 | `setMapLight` | core `shallowPatchRootProperty('light')` compatibility operation (legacy shallow per-key update/reset; never recursive RFC 7396) |
| 39 | `setMapSky` | core `replaceRootProperty` compatibility operation |
| 40 | `setMapProjection` | core `replaceRootProperty` compatibility operation |
| 41 | `setMapTerrain` | core `replaceRootProperty` compatibility operation |
| 42 | `setMapGlyphs` | core `setStyleRootProperties` transaction |
| 43 | `setMapSprite` | core `setStyleRootProperties` transaction |
| 44 | `listSprites` | bounded MapLibre runtime command |
| 45 | `addSprite` | MapLibre runtime command |
| 46 | `removeSprite` | MapLibre runtime command |
| 47 | `setFeatureState` | MapLibre runtime command |
| 48 | `removeFeatureState` | MapLibre runtime command |
| 49 | `setGlobalStateProperty` | MapLibre runtime command |
| 50 | `listImages` | bounded MapLibre runtime command |
| 51 | `addImageFromUrl` | injected-loader MapLibre runtime command |
| 52 | `removeImage` | MapLibre runtime command |
| 53 | `getLayerCount` | validated snapshot → core context count |

The same test verifies every result uses `toAiToolResult`, every public input is parsed by the designated strict/raw-string schema, and none of the 53 handlers writes directly to the Map outside the live adapter/runtime boundaries.

- [ ] **Step 1: Write failing full-factory characterization tests**

Assert the frozen 53-name tuple remains present in original order and representative old inputs/results for paint/layout batch and clear, filter null/replace, add/move/remove layer, add/remove/patch source, both `updateGeoJsonSourceData` methods, root style tools, feature/global state, images, sprites, and validation. For every style-applying family, table-test all three adapter authority branches and prove the handler narrows `styleAuthority` before touching `result.style`: `current` is live data, `pre-operation` remains explicitly baseline-only, and `unavailable` has no style. Preserve `getState<TStyle>()` independently as the legacy outer `style`. Add the exact nine-tool `diff` submatrix above with omitted/true/false, successful and rollback paths; assert `false` changes only the MapLibre `setStyle` option and status message suffix, not execution, validation, waiting, semantic diff, changed IDs, or common-envelope shape. Update `public-api-compatibility.test.ts` to stop asserting an exact total of 53 and instead assert the frozen tuple plus every explicitly approved new structured/query name; retain a duplicate-name rejection.

- [ ] **Step 2: Write failing core-backed migration tests**

Assert paint/layout/filter/zoom/visibility call one transaction; the six source routes are exact and non-overlapping: legacy `addSource`→core `addSource`, `removeSource`→core `removeSource`, `updateGeoJsonSourceData(setData)`→core `setGeoJsonData`, `setGeoJsonClusterOptions`→core `patchSource`, `patchSourceDefinition`→compatibility `deepMergeSourceDefinition`, and `replaceSourceDefinition`→compatibility `replaceSourceDefinition`. Runtime-only `updateGeoJsonSourceData(updateData)` and `setSourceTileLodParams` must not enter the document transaction dispatcher. Assert no-op skips `setStyle` and batch failure is atomic. Characterize the four intentionally distinct patch families: legacy layer/source deep merge recursively merges and retains `null` as a value; structured `setStyleRootProperties` uses recursive RFC 7396 deletion; metadata/transition compatibility tools replace the whole root field; and legacy `setMapLight` performs a one-level light patch only. Preserve legacy layer-ID edits: both deep-merge and replacement may change `layerId` to an unoccupied ID, must reject collisions atomically, and on success report old/new IDs plus replayable remove/add semantic targets. Preserve the legacy generic contract exactly: the full-tool `style` field continues to contain `getState<TStyle>()`, while the authoritative post-transaction Map Style and its changed IDs/diff live under structured `data`. Add a regression where those two values intentionally differ so they cannot be accidentally conflated.

In `style-operation-json-contract.test.ts`, add this value, then retain the whole-union assertion `StyleOperation extends JsonObject ? true : false` so all seven compatibility variants must remain JSON-backed closed type aliases:

```ts
const addLayerDefinitionJsonContract = {
  op: 'addLayerDefinition',
  layer: { id: 'background', type: 'background' },
} satisfies StyleOperation;
```

- [ ] **Step 3: Write failing root-tool migration tests**

Assert `setStyleName`, `setStyleCameraDefaults`, `setMapGlyphs`, and document-representable sprite changes normalize to structured `setStyleRootProperties`; assert `setStyleMetadata`, `setStyleTransition`, `setMapSky`, `setMapProjection`, and `setMapTerrain` normalize to `replaceRootProperty` and replace rather than merge; assert `setMapLight` alone normalizes to `shallowPatchRootProperty('light')`. Start with existing replacement objects containing extra keys and prove omitted keys disappear; cover `null` clearing for every legacy tool that accepts it.

Lock the legacy light semantics with an exact completed-Style/diff regression: begin with `light:{anchor:'map',intensity:0.4,'color-transition':{duration:300,delay:50}}`, apply `patch:{'color-transition':{duration:120}}`, and assert the complete transition value becomes `{duration:120}` (the nested `delay` is removed) while omitted top-level `anchor` and `intensity` remain unchanged. Table-test a `null` base property and a `null` `*-transition` property: each supplied key is removed from the serialized light object so MapLibre resets that one setting to its default, while every omitted top-level key remains; a resulting empty light is `{}`, not deletion of the entire `light` root. This must fail under recursive RFC 7396 (which would retain nested `delay`) and under whole-field replacement (which would drop omitted top-level light keys). Assert exact style-target JSON Pointer diffs, empty layer/source changed lists, descriptor/dangerous-key rejection, canonical-validation rollback, and that none of these root operations can alter `version`, `sources`, or `layers` through compatibility input.

- [ ] **Step 4: Write failing new-tool and runtime tests**

Assert structured transaction/analysis/discovery/creation tools match compact envelopes; query source/rendered tools are bounded; feature state/global state/images and incremental `updateData` use runtime commands rather than core document operations.

- [ ] **Step 5: Run the focused test and verify missing full module**

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/core/style-operation-json-contract.test.js .tmp/test-dist/ai-sdk/full-tools.test.js`

Expected: FAIL because the full factory has not moved/converged.

- [ ] **Step 6: Move the full factory without semantic edits**

Create `src/ai-sdk/full-tools.ts` from the current root implementation, update relative imports, and keep `src/index.ts` re-exporting it so the 53-name test remains green. Move or define all 53 named exported `.strict()` input object schemas in `ai-sdk/schemas.ts`; compose their legacy string fields from Task 14's text schemas and their structured values from core/adapter schemas. The 53-row test must prove each registered tool uses its designated schema, defaults legacy `diff` only at that boundary, and rejects unknown keys before its handler runs. Do not export an untyped schema dictionary or use one permissive catch-all schema.

- [ ] **Step 7: Replace property and filter families**

Normalize paint/layout single, smart, batch, clear, zoom, visibility, and filter legacy inputs into `setLayerProperties`/`setLayerFilter` transactions. Remove both duplicated property-prefix tables.

- [ ] **Step 8: Add compatibility variants to the single core operation boundary**

Route legacy `moveLayer`/`removeLayer`, `addSource`/`removeSource`, and `setGeoJsonClusterOptions` through their native core variants; route only legacy raw layer/source definition add/deep-merge/replace, the specified whole-root replacement fields, and light's shallow patch through the seven compatibility variants above. In particular, `patchSourceDefinition` must never route to RFC 7396 `patchSource`, `setGeoJsonClusterOptions` must never route to legacy deep merge, and `setMapLight` must never route to structured `setStyleRootProperties`. Add all seven closed `CompatibilityStyleOperation` type-alias variants directly to `StyleOperation`, the exported discriminated Zod union, and the exhaustive `transaction.ts` switch; do not add an open index signature, and keep `StyleOperation extends JsonObject ? true : false` compiling after expansion. Implement their shared `OperationApplyResult` handler in `src/core/operations/compatibility.ts`. `applyValidatedCompatibilityEdit` is only a public convenience wrapper over `applyStyleTransaction(style, {operations:[operation]})`, never a second schema, clone, dispatcher, diff, or validation engine. Implement an own-key-safe legacy deep merge for the two deep-merge variants that recursively merges plain objects but retains `null` as a value; do not reuse RFC 7396 for these legacy routes. For `deepMergeLayerDefinition` and `replaceLayerDefinition`, validate any resulting new ID, reject an occupied destination before mutation, and mark both the selected old ID and resulting new ID so the ID-keyed layer diff emits exact remove/add targets and `changedLayers` contains both in stable order. `replaceRootProperty` performs exact whole-field assignment or deletion on `null` for metadata, transition, sky, projection, and terrain.

Implement `shallowPatchRootProperty` only for `property:'light'`: start from a validated clone of the existing light object or `{}`; iterate own patch keys once; delete a supplied key whose value is `null` to reproduce MapLibre's per-property clear/default reset; otherwise replace that entire top-level value with its sanitized JSON value. Never recurse into a supplied object, so a new `color-transition` object replaces the old transition object rather than retaining omitted nested members. Preserve all omitted top-level light keys and retain `{}` when the last key is cleared. Mark no layer/source candidates and rely on completed-Style validation/diff for atomicity. Tests cover all seven variants, dangerous keys/cycles/accessors, collision/missing cases, successful layer rename plus rollback, invalid completed Style, all three distinct patch/null semantics, omitted-old-key removal, exact diff/changed lists, and prove the wrapper and direct transaction return identical results.

- [ ] **Step 9: Replace root style families**

Normalize name, camera defaults, glyphs, and document-representable sprite changes into `setStyleRootProperties`. Route metadata, transition, sky, projection, and terrain through `replaceRootProperty` so existing whole-field replace/clear behavior is preserved. Route only legacy light JSON through `shallowPatchRootProperty('light')`, preserving its top-level incremental/reset behavior without inheriting structured RFC 7396 recursion.

- [ ] **Step 10: Replace runtime-only families**

Route `updateGeoJsonSourceData(method:'updateData')` exclusively through `createMapRuntimeCommands().updateGeoJsonDataRuntime` and its package-owned strict diff schema; route its `method:'setData'` branch exclusively through the core `setGeoJsonData` transaction. Route source-tile LOD, feature/global state, list/add/remove images, and runtime sprite commands through their named `MapRuntimeCommands`; add bounded source/rendered feature query tools. The routing test rejects any invocation of the wrong boundary for every branch.

- [ ] **Step 11: Remove the provisional synchronous Map writer and make `src/index.ts` a facade**

Delete `src/tools/legacy-property-adapter.ts` and its test after every former caller is routed through `applyTransactionToMap`/`applyStyleDocumentOrUrlToMap` or the bounded runtime commands. No compiled or source path may synchronously call `Map#setStyle` outside the completion-aware MapLibre adapter. `src/index.ts` must re-export the factory/types; it must not retain duplicated validation tables or tool logic.

Run: `rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/public-api-compatibility.test.js .tmp/test-dist/core/style-operation-json-contract.test.js .tmp/test-dist/core/operations/compatibility.test.js .tmp/test-dist/ai-sdk/schemas.test.js .tmp/test-dist/ai-sdk/full-tools.test.js .tmp/test-dist/ai-sdk/compact-tools.test.js .tmp/test-dist/ai-sdk/compatibility.test.js`

Expected: PASS with at least the frozen 53+5 names and the new structured tools.

Run:

```bash
rtk node --input-type=module --eval "import {spawnSync} from 'node:child_process'; const r=spawnSync('rtk',['rg','-n','-F','.setStyle(','src','--glob','!src/adapters/maplibre/map-adapter.ts','--glob','!**/*.test.ts'],{stdio:'inherit'}); if(r.error) throw r.error; process.exit(r.status===1?0:r.status===0?1:2)"
```

Expected: exit 0 because inner `rg` returned 1 (no writer outside the adapter). An inner 0 (forbidden match) or >1/null (scan failure) makes the wrapper fail; do not replace this with `|| true`.

- [ ] **Step 12: Commit full convergence**

```bash
rtk git add src/core/operations/compatibility.ts src/core/operations/compatibility.test.ts src/core/style-operation-json-contract.test.ts src/core/types.ts src/core/schemas.ts src/core/transaction.ts src/core/index.ts src/ai-sdk/schemas.ts src/ai-sdk/full-tools.ts src/ai-sdk/full-tools.test.ts src/index.ts src/ai-sdk/index.ts src/public-api-compatibility.test.ts
rtk git rm src/tools/legacy-property-adapter.ts src/tools/legacy-property-adapter.test.ts
rtk git commit -m "feat: converge full AI tools on JSON operations"
```

### Task 17: Finalize Facades, Exports, Documentation, and Verification

**Files:**
- Modify: `src/index.ts`
- Modify: `src/core/index.ts`
- Modify: `src/ai-sdk/index.ts`
- Modify: `src/adapters/maplibre/index.ts`
- Modify: `src/types.ts`
- Modify: `src/engine/style-context.ts`
- Modify: `src/engine/style-operations.ts`
- Modify: `src/tools/compact-tools.ts`
- Modify: `package.json`
- Modify: `tsconfig.test.json`
- Modify: `scripts/check-package.mjs`
- Modify: `README.md`
- Create: `src/exports.test.ts`

**Interfaces:**
- Consumes: every public core, adapter, and AI SDK export built in Tasks 1–16, plus the foundation package checker's one real installed tarball, exact ESM package boundary, `core-consumer.ts`/strict NodeNext config, and `root-consumer.ts`/strict ESNext-Bundler config.
- Produces: stable root facade, `maplibre-style-tools/core`, `maplibre-style-tools/maplibre`, and `maplibre-style-tools/ai` subpaths; legacy internal paths remain thin shims.

- [ ] **Step 1: Write failing export smoke tests**

```ts
it('loads transport-neutral core without MapLibre or AI SDK side effects', async () => {
  const core = await import('maplibre-style-tools/core');
  assert.equal(typeof core.applyStyleTransaction, 'function');
  assert.equal(typeof core.finalizeStyleReplacement, 'function');
  assert.equal(typeof core.analyzeGeoJson, 'function');
  assert.equal(typeof core.inlineGeoJsonSchema?.safeParse, 'function');
  assert.equal(typeof core.geoJsonAnalysisInputSchema?.safeParse, 'function');
  assert.equal(typeof core.listSourceLayers, 'function');
});

it('loads explicit AI and MapLibre entry points', async () => {
  const ai = await import('maplibre-style-tools/ai');
  const maplibre = await import('maplibre-style-tools/maplibre');
  assert.equal(typeof ai.createMapLibreStyleTools, 'function');
  assert.equal(typeof ai.createCompactMapLibreStyleTools, 'function');
  assert.equal(typeof maplibre.applyTransactionToMap, 'function');
  assert.equal(typeof maplibre.runtimeGeoJsonSourceDiffSchema?.safeParse, 'function');
  assert.equal(typeof maplibre.sanitizeRuntimeGeoJsonSourceDiff, 'function');
});
```

In the same source file, add static package-self-reference `import type` assignments for every GeoJSON geometry/Feature/FeatureCollection DTO, both `available` analysis branches and their narrowing, `RuntimeGeoJsonSourceDiff`, `RuntimeGeoJsonFeaturePatch`, `RuntimeGeoJsonPropertyPatch`, `PreparedMapStyleTransaction`, `PreparedMapStyleTransactionView`, `PreparedStyleApplyOptions`, `MapStyleCurrentResult`, `MapStylePreOperationResult`, `MapStyleUnavailableResult`, `MapStyleApplyResult`, `ParseResult`, and `CommonResultInput`. The test compilation must prove these names come from `/core`, `/maplibre`, and `/ai` declarations rather than internal source paths; assign a validated `RuntimeGeoJsonSourceDiff` directly to MapLibre's `GeoJSONSourceDiff` with no assertion cast. Add `AssertTrue<T extends true>` checks that the three incremental DTO aliases extend `JsonObject`, and separate `// @ts-expect-error` object literals for excess diff/update/property keys so declarations cannot silently regain `JsonObject &` openness; runtime package tests repeat those cases against the strict schemas. Lock `Parameters<GeoJSONSource['updateData']>` to one `GeoJSONSourceDiff` argument, `ReturnType` to `Promise<void>`, and reject a two-argument call. Assert the prepared handle is opaque, exposes only its deep-readonly inspection view, cannot be structurally constructed from an object literal because its brand cannot be named/imported, and rejects every execution-limit key in `PreparedStyleApplyOptions`; neither the unique-symbol brand nor private authority/registries/factory may appear as a public value or named export. Do not write a compile-time `@ts-expect-error` for `structuredClone(prepared)`, `{...prepared}`, or an explicit cast: TypeScript's generic clone signature and structural spread retain the unique-symbol property in their static result even though the Task 11 `WeakSet`/`WeakMap` runtime provenance gate correctly rejects those foreign identities. Add an exhaustive `switch(result.styleAuthority)` where `current` and `pre-operation` can access `style`, `unavailable` has a `// @ts-expect-error` style access, and only `current` is accepted by a typed authoritative-map consumer. Within the `current` arm, branch again on literal `ok` and make `result.error` a `// @ts-expect-error` in success while failure requires an authentic `StyleToolError`; prove the `pre-operation`/`unavailable` arms are failures with required authentic errors. Package declarations fail the test if they widen `ok` to boolean, add an optional error to success, make failure error optional, expose the prepared brand/private authority, or model Map results as an interface extending the core union.

- [ ] **Step 2: Run the export test and verify missing subpath exports**

Run: `rtk pnpm run build && rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/exports.test.js`

Expected: FAIL until package self-reference exports and their built declarations/JavaScript are complete; relative source/dist imports are intentionally forbidden in this smoke test.

- [ ] **Step 3: Finish compatibility shims and package exports**

Make `src/types.ts`, both `src/engine/*` files, and `src/tools/compact-tools.ts` re-export or normalize into the new modules only. Add these exact entries beside the existing root export; do not expose source files:

```json
{
  "./core": {
    "types": "./dist/core/index.d.ts",
    "import": "./dist/core/index.js",
    "default": "./dist/core/index.js"
  },
  "./maplibre": {
    "types": "./dist/adapters/maplibre/index.d.ts",
    "import": "./dist/adapters/maplibre/index.js",
    "default": "./dist/adapters/maplibre/index.js"
  },
  "./ai": {
    "types": "./dist/ai-sdk/index.d.ts",
    "import": "./dist/ai-sdk/index.js",
    "default": "./dist/ai-sdk/index.js"
  }
}
```

Because consumers may import `/ai` without ever loading the root declaration, put this preserved reference at the first line of `src/ai-sdk/index.ts`; it is backed by the foundation's regular `@types/node@^22.20.1` dependency and must survive into packed `dist/ai-sdk/index.d.ts`:

```ts
/// <reference types="node" preserve="true" />
```

Do not add that reference to `src/adapters/maplibre/index.ts`, any other adapter declaration, or any `src/core/` file. Direct `/maplibre` and `/core` consumers remain Node-free; `/ai` and the root facade are the only entry points in this subproject that may load the Node ambient declarations required by their public AI SDK type graph.

- [ ] **Step 4: Verify the recursive test runner executes every compiled test**

Keep the foundation runner contract:

```json
{
  "posttest": "node scripts/run-tests.mjs"
}
```

Do not use a quoted glob or `node --test .tmp/test-dist`; neither recursively discovers this tree. Compile once and confirm the runner output contains core operation, adapter, AI SDK, and export tests.

- [ ] **Step 5: Update README contracts and examples**

Document structured transaction input, filter modes, complete inline GeoJSON DTO/analysis/limits, the package-owned strict incremental diff DTO and why it replaces upstream nested `any`, source-layer discovery, duplication/source-based/GeoJSON creation, live query bounds, structured root RFC 7396 restrictions, the distinct legacy shallow `setMapLight` per-key replacement/reset behavior, common AI discriminated envelope, exact legacy source routing, `diff:false` apply semantics, and deprecation of string-encoded JSON inputs. Keep the two existing factory examples working.

- [ ] **Step 6: Run the complete verification ladder**

```bash
rtk pnpm run lint
rtk pnpm run typecheck:core
rtk pnpm run typecheck
rtk pnpm run clean
rtk pnpm run build
rtk pnpm test
rtk node --input-type=module --eval "await import('maplibre-style-tools'); await import('maplibre-style-tools/core'); await import('maplibre-style-tools/maplibre'); await import('maplibre-style-tools/ai')"
rtk node scripts/check-package.mjs
rtk npm pack --dry-run --json
```

Expected: every command exits 0. Extend—do not replace—the foundation `scripts/check-package.mjs` contract. Validate the actual packlist (not a source-tree guess), assert the tarball includes built root/core/maplibre/ai declarations and JavaScript—including `geojson`, `geojson-analysis`, and `geojson-diff` declarations—reject `src`, tests, `.tmp`, examples, caches, and stale build files, and create exactly one real `.tgz` plus the same temporary bare consumer outside the workspace. Inspect the packed declaration text before compilation: `dist/ai-sdk/index.d.ts` must preserve its root-level `node` reference, while the foundation's negative scan over `dist/core/**/*.d.ts` remains unchanged. Parse every packed `dist/adapters/maplibre/**/*.d.ts` with the repository-pinned TypeScript API; for every static/dynamic import type, import, export, or external-module reference, reject the specifier when Node's `node:module.isBuiltin(specifier)` returns true and unconditionally reject any `node:` prefix. Also reject a Node triple-slash reference or `@types/node` dependency. Do not substitute `builtinModules`—Node 22 has prefix-only builtins such as `node:test`, `node:sqlite`, and `node:sea` that `isBuiltin` recognizes but that array omits—or rely on a short hand-written subset/comment-sensitive substring scan. The isolated compiler below proves that unresolved Node globals such as `Buffer` or `NodeJS.*` do not leak through the declaration graph. Install that exact artifact once with no separately installed declaration dependencies, preserve the nearest `{private:true,type:'module'}` boundary, then import `maplibre-style-tools`, `/core`, `/maplibre`, and `/ai` by package specifier; assert both root factories, `finalizeStyleReplacement`/`inlineGeoJsonSchema` from `/core`, `applyTransactionToMap`/`runtimeGeoJsonSourceDiffSchema`/`sanitizeRuntimeGeoJsonSourceDiff` from `/maplibre`, and both AI factories from `/ai` are callable.

Inherit both foundation compile smokes unchanged rather than recreating the old single-consumer NodeNext gate. Extend `core-consumer.ts` only with the transport-neutral `/core` GeoJSON geometry/Feature/FeatureCollection DTOs, both `available` analysis branches and narrowing, core `JsonObject`, and their JSON-backed compile contracts. Compile it with the existing `tsconfig.core-consumer.json`: NodeNext, `lib:["ES2023"]`, `types:[]`, `skipLibCheck:false`, and no root, `/maplibre`, `/ai`, DOM, or Node declaration import.

Add a third, isolation-only `maplibre-consumer.ts` in the same temporary directory. It imports representative values/types from `/maplibre`, `GeoJSONSource`/`GeoJSONSourceDiff` from the installed `maplibre-gl` peer, and only the `/core` `JsonObject` type needed for cross-entry-point assertions; it must never import the root or `/ai`. Put the runtime diff/update/property assignability and excess-key checks, exact one-argument/`Promise<void>` `updateData` contract, prepared handle/view/options checks, and all three Map Style authority branches here. Add `// @ts-expect-error` probes for both global `Buffer` and `NodeJS.Process`; if either directive is unused, some part of the direct `/maplibre` graph loaded Node ambient declarations and the smoke must fail. Compile it with this exact additional config so no root or `/ai` Node reference can contaminate the program:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "types": [],
    "skipLibCheck": false,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force"
  },
  "include": ["maplibre-consumer.ts"]
}
```

The `maplibre-consumer.ts` compile contract must use targeted `@ts-expect-error` assertions to reject an object-literal construction of `PreparedMapStyleTransaction`, assignment to any readonly view field, import/naming of the brand, and execution-limit keys in `PreparedStyleApplyOptions`. It must not expect `structuredClone(prepared)`, `{...prepared}`, or a cast to fail at compile time: TypeScript preserves that static branded shape. Task 11's runtime forged/spread/clone/Proxy cases remain the sole proof that private provenance rejects different object identities before any Map call.

Extend `root-consumer.ts` with root and `/ai` declarations plus the `/maplibre` result types required to prove the AI envelope cross-entry-point mapping and AI discriminants. Compile it with the existing `tsconfig.root-consumer.json`: ESNext plus Bundler resolution, DOM libs, `types:[]`, and `skipLibCheck:false`. Its Node ambient is intentional and supplied only by the packed root and `/ai` preserved references; it is never used as evidence that `/maplibre` is Node-free.

Using the repository's already-installed TypeScript executable—not a workspace import, global compiler, or network install—invoke pinned `tsc --noEmit` separately for `tsconfig.core-consumer.json`, `tsconfig.maplibre-consumer.json`, and `tsconfig.root-consumer.json`, and fail if any process is nonzero. Add `type IsAny<T> = 0 extends (1 & T) ? true : false`, `type AssertFalse<T extends false> = T`, and compile `AssertFalse<IsAny<NonNullable<NonNullable<RuntimeGeoJsonFeaturePatch['addOrUpdateProperties']>[number]>['value']>>` in `maplibre-consumer.ts`; this makes an upstream `any` leak fail rather than silently satisfy assignability. Fail the package check on any missing declaration, `any` leak, exported prepared brand/private authority/factory/registry, two-argument `updateData` compatibility shim, internal-path dependency, collapsed/isolation-polluted consumer config, `skipLibCheck:true`, or consumer-installed declaration package. Keep the foundation manifest/reference assertions for direct `@types/node`/`@types/geojson` and the explicit absence of Node references under packed `dist/core`. Clean all three consumer sources/configs and the tarball in the existing `finally`. Never substitute an extracted working-tree directory, direct `dist/*` import, workspace resolution, or source declaration for this boundary.

- [ ] **Step 7: Inspect the final diff scope**

Run:

```bash
rtk git log --oneline --reverse HEAD~16..HEAD
rtk git diff --stat HEAD~16..HEAD
rtk git diff --stat
rtk git status --short
rtk git -C /Users/zhang/code/ai-style-editor diff --quiet
rtk git -C /Users/zhang/code/ai-style-editor diff --cached --quiet
rtk git -C /Users/zhang/code/ai-style-editor status --short
```

Expected: the log contains exactly the 16 prior task commits, their cumulative diff contains only subproject 2 core/adapter/AI/facade/test/package files, and the remaining worktree diff is only Task 17 files. Both original-repository diff commands exit 0, and its status output is byte-for-byte unchanged from the pre-execution snapshot (including any pre-existing untracked files); this plan has created nothing there.

- [ ] **Step 8: Commit the public surface and documentation**

```bash
rtk git add src/index.ts src/core/index.ts src/ai-sdk/index.ts src/adapters/maplibre/index.ts src/types.ts src/engine/style-context.ts src/engine/style-operations.ts src/tools/compact-tools.ts src/exports.test.ts scripts/check-package.mjs package.json tsconfig.test.json README.md
rtk git commit -m "docs: finalize layer and data capability surface"
```

## Completion Checklist

- Every operation variant is accepted by exactly one exported Zod discriminated union and handled by the exhaustive transaction dispatcher.
- Partial core execution options are resolved once into a required readonly `OperationContext.limits`; both inline GeoJSON mutation handlers use its `maxStyleBytes`, and direct-core plus Map-adapter tests prove lowering and raising beyond the standalone 5 MiB default without adapter-side revalidation/clamping. Prepared Map transactions are opaque provenance handles backed by module-private `WeakSet`/`WeakMap` authority and disjoint deep immutable private/public snapshots; forged/cloned/mutated handles make zero Map calls, post-authorization caller mutation cannot alter the exact applied candidate, and phase two cannot accept conflicting limits or reconstruct authority from the view.
- `setStyleRootProperties` cannot mutate `version`, `sources`, or `layers`; null deletes allowed root fields.
- Legacy `setMapLight` uses its dedicated one-level compatibility patch: omitted light keys survive, supplied nested objects replace wholesale, and supplied null keys reset/delete only that setting; it never enters recursive RFC 7396.
- Filter composition, GeoJSON validation/analysis, source-layer discovery, source/layer lifecycle, and atomic GeoJSON creation are pure and network-free.
- GeoJSON public DTOs cover every RFC geometry, Feature/FeatureCollection, bbox, ID, properties, and foreign members; analysis is a named `available` discriminated union and all walks consume descriptor-sanitized plain snapshots.
- Incremental `updateData` accepts only package-owned closed `RuntimeGeoJsonSourceDiff`/update/property aliases and their strict schemas/sanitizer; all three extend `JsonObject` while rejecting excess command keys, MapLibre's nested upstream `any` never becomes a public validation boundary, and the MapLibre 6.3 call is exactly awaited as `source.updateData(parsed.diff)` with one argument returning `Promise<void>`.
- Live style success means the expected style hash loaded; timeout/error rollback uses an independent lifecycle.
- Every raw `Map#getStyle()` value is narrowed through core validation; live results explicitly distinguish `current`, saved `pre-operation`, and style-less `unavailable`, and only `current` may update an authoritative bridge mirror.
- Core and live-map results retain literal `ok` narrowing exactly: success has no `error` member, failure requires an authentic core `StyleToolError`, and Map result types compose that union without interface extension; the only reverse MapLibre conversion is one identity-preserving assertion over a core-validated `StyleDocument`.
- Feature queries, runtime state, and images are adapter-only and bounded where data leaves the map.
- All frozen 53 full and 5 compact names remain, old JSON strings still parse, new structured tools use the common result envelope, and validation tables exist only in core.
- Legacy `diff:false` remains a real awaited apply option and does not remove the returned semantic diff; every legacy source tool follows the exact routing matrix.
- Root and subpath imports, README examples, build, tests, and package contents pass the final verification ladder. The real installed tarball passes the inherited `/core` no-DOM NodeNext gate, an isolated `/maplibre`-only ESNext/Bundler gate with no root/AI Node ambient, and the root/AI cross-entry-point ESNext/Bundler gate; all retain `types:[]`, `skipLibCheck:false`, and the repository-pinned compiler. Packed `/ai` preserves its own root-level Node reference, while packed `/core` and `/maplibre` declarations pass complete Node-builtin/reference scans; explicit negative `Buffer`/`NodeJS` probes prove the isolated `/core` and `/maplibre` programs did not load Node globals. Opaque clone/spread rejection remains a runtime provenance contract rather than an impossible TypeScript `@ts-expect-error` assertion.
