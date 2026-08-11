# MapLibre v6 and Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the package to MapLibre GL JS 6.3.0 and Style Spec 26.2.1, then expose a pure, synchronously validated `/core` API with immutable `setLayerProperties` transactions while preserving the existing root AI factories and legacy operation types.

**Architecture:** Add a dependency-inverted `src/core/` layer that statically imports only Zod and MapLibre Style Spec, never MapLibre GL JS, AI SDK, DOM, Node, MCP, or WebSocket APIs. The root package keeps its existing permissive types and tool schemas as compatibility facades, while `maplibre-style-tools/core` exports strict schemas, strict discriminated operations, normalized validation, RFC 6901 diffs, context/search functions, and atomic transactions.

**Tech Stack:** TypeScript 5.9 in strict NodeNext ESM mode, Node.js 22.13+, pnpm 10.10, MapLibre GL JS 6.3.0, `@maplibre/maplibre-gl-style-spec` 26.2.1, Zod 4, AI SDK 6, Node's built-in test runner, ESLint 9.

## Global Constraints

- Work only in `/Users/zhang/code/maplibre-style-tools`; do not modify `/Users/zhang/code/ai-style-editor`.
- Prerequisite gate: the standalone extraction must already include commit `fb81f42` (clean build/package output). Before Task 1, run `rtk git merge-base --is-ancestor fb81f42 HEAD`, `rtk pnpm run lint`, `rtk pnpm run typecheck`, `rtk pnpm test`, and `rtk pnpm run build`; every command must PASS on the extracted package before this plan changes dependencies.
- Keep the repository on local `main`; do not push, publish, create a release, or add CI.
- Preserve unrelated worktree changes, especially the approved design document status edit.
- Every shell command in this plan starts with `rtk`.
- Set both the peer and development dependency for `maplibre-gl` to exactly `^6.3.0`.
- Set the runtime dependency for `@maplibre/maplibre-gl-style-spec` to exactly `^26.2.1`.
- Move `@types/node` out of `devDependencies` and into regular `dependencies` at exactly `^22.20.1`; the root declaration graph references it explicitly, while `/core` remains Node-free.
- Keep `engines.node` at `>=22.13.0` and `packageManager` at `pnpm@10.10.0`.
- Keep the package ESM-only with `"type": "module"`, NodeNext resolution, and explicit `.js` relative specifiers.
- The pure core may import only Zod and MapLibre Style Spec; it must not import `ai`, `maplibre-gl`, DOM types, Node APIs, MCP, or WebSocket code.
- `validateStyleDocument`, `applyStyleTransaction`, `buildStyleContext`, and `searchLayers` are synchronous pure functions.
- Style Spec is a static ESM import; normalize both returned validation issues and thrown validator failures.
- Pure core is the single authority for `DEFAULT_MAX_STYLE_BYTES = 5 * 1024 * 1024`, `DEFAULT_MAX_DIFF_BYTES = 1 * 1024 * 1024`, `DEFAULT_MAX_OPERATIONS = 100`, and JSON UTF-8 byte measurement; CLI, MCP, layer/data, and bridge code import these exports rather than defining competing constants, byte counters, or transaction pre-parsers.
- Transactions are immutable and all-or-nothing. Failure returns the original style object, empty change lists, and an empty diff.
- Diff paths use RFC 6901 JSON Pointer syntax, including `~0` and `~1` escaping.
- `/core` exports a strict discriminated `StyleOperation`; the root entry keeps the existing non-discriminated `StyleOperation` as the legacy compatibility type.
- Preserve `createMapLibreStyleTools`, `createCompactMapLibreStyleTools`, all 53 full tool names, all five compact tool names, and existing string-encoded JSON inputs.
- Do not use default imports from `maplibre-gl`; MapLibre GL JS v6 is ESM-only.
- Each task follows red-green-refactor, leaves all relevant checks green, and ends with one independent local commit.

---

### Task 1: Upgrade MapLibre and Install a Recursive Test Runner

**Files:**
- Create: `scripts/run-tests.mjs`
- Create: `src/testing/nested/recursive-runner.test.ts`
- Create: `src/type-tests/maplibre-v6.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: existing `pnpm test`, `tsconfig.test.json`, and `Map` exported by `maplibre-gl`.
- Produces: `scripts/run-tests.mjs`, which recursively discovers sorted `.test.js` files below `.tmp/test-dist`; a lockfile with `maplibre-gl@6.3.x` and Style Spec `26.2.x`; compile coverage for the v6 `Map` surface used by later adapters.

- [ ] **Step 1: Add a nested smoke test that the current hard-coded runner cannot discover**

```ts
// src/testing/nested/recursive-runner.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('recursive test runner discovers nested tests', () => {
  assert.equal(6, 6);
});
```

- [ ] **Step 2: Compile and prove the current runner omits the nested test**

Run: `rtk pnpm test`

Expected: PASS, but output does not contain `recursive test runner discovers nested tests`, proving the current `posttest` only executes the two hard-coded engine test files.

- [ ] **Step 3: Add the recursive runner and point `posttest` at it**

```js
// scripts/run-tests.mjs
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const collect = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(path)));
    if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(path);
  }
  return files;
};

const tests = (await collect('.tmp/test-dist')).sort();
if (tests.length === 0) throw new Error('No compiled test files found.');
const nodeTestOptions = process.argv.slice(2);
const result = spawnSync(process.execPath, ['--test', ...nodeTestOptions, ...tests], { stdio: 'inherit' });
process.exit(result.status ?? 1);
```

Treat every forwarded argument as a Node test-runner option, not a test path; this supports focused commands such as `rtk node scripts/run-tests.mjs --test-name-pattern="session"` while preserving recursive discovery.

Set `posttest` in `package.json` to `node scripts/run-tests.mjs`. Keep `pretest` and the TypeScript compilation in `test` unchanged.

- [ ] **Step 4: Run the suite and verify recursive discovery**

Run: `rtk pnpm test`

Expected: PASS and output contains `recursive test runner discovers nested tests` plus the four existing engine tests.

- [ ] **Step 5: Write the v6 compile contract before changing dependencies**

```ts
// src/type-tests/maplibre-v6.test.ts
import type { Map, StyleSpecification } from 'maplibre-gl';

type SetStyleInput = Parameters<Map['setStyle']>[0];
type SetStyleOptions = Parameters<Map['setStyle']>[1];

const style = {
  version: 8,
  sources: {},
  layers: [],
} satisfies StyleSpecification;

const styleInput: SetStyleInput = style;
const styleOptions: SetStyleOptions = { diff: true };
void styleInput;
void styleOptions;
```

- [ ] **Step 6: Prove the dependency versions are still wrong**

Run: `rtk node --input-type=module --eval "import rootPkg from './package.json' with {type:'json'}; import mapPkg from './node_modules/maplibre-gl/package.json' with {type:'json'}; import specPkg from './node_modules/@maplibre/maplibre-gl-style-spec/package.json' with {type:'json'}; if(rootPkg.peerDependencies?.['maplibre-gl']!=='^6.3.0'||rootPkg.devDependencies?.['maplibre-gl']!=='^6.3.0'||rootPkg.dependencies?.['@maplibre/maplibre-gl-style-spec']!=='^26.2.1'||!mapPkg.version.startsWith('6.3.')||!specPkg.version.startsWith('26.2.')) process.exit(1)"`

Expected: FAIL with exit code 1 because the installed versions are MapLibre 5.24.0 and Style Spec 24.10.0.

- [ ] **Step 7: Upgrade package ranges and regenerate the lockfile**

Edit `package.json` so peer/dev `maplibre-gl` are `^6.3.0` and runtime Style Spec is `^26.2.1`, then run: `rtk pnpm install`

Expected: installation succeeds and `pnpm-lock.yaml` records MapLibre 6.3.x and Style Spec 26.2.x without retaining the old direct importer versions.

- [ ] **Step 8: Verify dependency, type, test, and lint baselines**

Run: `rtk node --input-type=module --eval "import rootPkg from './package.json' with {type:'json'}; import mapPkg from './node_modules/maplibre-gl/package.json' with {type:'json'}; import specPkg from './node_modules/@maplibre/maplibre-gl-style-spec/package.json' with {type:'json'}; if(rootPkg.peerDependencies?.['maplibre-gl']!=='^6.3.0'||rootPkg.devDependencies?.['maplibre-gl']!=='^6.3.0'||rootPkg.dependencies?.['@maplibre/maplibre-gl-style-spec']!=='^26.2.1'||!mapPkg.version.startsWith('6.3.')||!specPkg.version.startsWith('26.2.')) process.exit(1)"`

Expected: PASS and prove the installed direct versions are MapLibre 6.3.x and Style Spec 26.2.x.

Run: `rtk pnpm run typecheck`

Expected: PASS, including `src/type-tests/maplibre-v6.test.ts`.

Run: `rtk pnpm test`

Expected: PASS with recursive discovery.

Run: `rtk pnpm run lint`

Expected: PASS.

- [ ] **Step 9: Commit the dependency and runner foundation**

```bash
rtk git add package.json pnpm-lock.yaml scripts/run-tests.mjs src/testing/nested/recursive-runner.test.ts src/type-tests/maplibre-v6.test.ts
rtk git commit -m "build: upgrade to MapLibre v6"
```

### Task 2: Establish Core-Only Type Checking and Stable Data Types

**Files:**
- Create: `tsconfig.core.json`
- Create: `src/core/types.ts`
- Create: `src/core/errors.ts`
- Create: `src/core/utf8.ts`
- Create: `src/core/index.ts`
- Create: `src/core/types.test.ts`
- Create: `src/core/errors.test.ts`
- Create: `src/core/utf8.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `StyleSpecification`, `LayerSpecification`, and `SourceSpecification` type exports from Style Spec 26.2.1.
- Produces: compile-proven JSON-backed `StyleDocument`/`StyleLayer`/`StyleSource` DTOs that retain MapLibre's known keys and JSON-compatible scalar/tuple/discriminant types while safely projecting recursive values, `StyleOperation`, `SetLayerPropertiesOperation`, `StyleTransaction`, `CoreExecutionLimits`, `StyleTransactionOptions`, `StyleReplacementOptions`, JSON-backed `StyleDiffEntry`/`StyleWarning`/`StyleToolError`, `OperationContext` with required readonly resolved limits, `OperationApplyResult`, discriminated `StyleTransactionResult`, the single-authority `StyleToolErrorCode`, `STYLE_TOOL_ERROR_CODES`, `createStyleToolError`, provenance-safe `isStyleToolError`, `DEFAULT_MAX_STYLE_BYTES`, `DEFAULT_MAX_DIFF_BYTES`, `DEFAULT_MAX_OPERATIONS`, `utf8ByteLength`, and `jsonUtf8ByteLength` from `src/core/index.ts`.

- [ ] **Step 1: Write failing JSON-type, stable-error, operation, and UTF-8-limit tests**

```ts
// src/core/errors.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createStyleToolError, isStyleToolError, STYLE_TOOL_ERROR_CODES,
} from './errors.js';

test('creates a serializable stable error', () => {
  assert.equal(STYLE_TOOL_ERROR_CODES.includes('STYLE_INVALID'), true);
  const error = createStyleToolError('NOT_FOUND', 'missing', '/layers/0');
  assert.deepEqual(error, {
    code: 'NOT_FOUND', message: 'missing', path: '/layers/0',
  });
  assert.equal(isStyleToolError(error), true);
  assert.equal(isStyleToolError({ code: 'NOT_FOUND', message: 'forged' }), false);
});

test('checks error provenance without invoking hostile values', () => {
  let getCalls = 0;
  const hostile = new Proxy({}, {
    get() { getCalls += 1; throw new Error('must not run'); },
  });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.doesNotThrow(() => isStyleToolError(hostile));
  assert.doesNotThrow(() => isStyleToolError(revoked.proxy));
  assert.equal(isStyleToolError(hostile), false);
  assert.equal(isStyleToolError(revoked.proxy), false);
  assert.equal(getCalls, 0);
});
```

```ts
// src/core/types.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  LayerSpecification, SourceSpecification, StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import {
  DEFAULT_MAX_DIFF_BYTES, DEFAULT_MAX_OPERATIONS, DEFAULT_MAX_STYLE_BYTES,
  jsonUtf8ByteLength,
} from './utf8.js';
import type {
  CoreExecutionLimits, JsonObject, JsonValue, OperationContext, StyleDiffEntry,
  StyleDocument, StyleLayer, StyleOperation, StyleSource, StyleToolError,
  StyleTransaction, StyleTransactionResult,
} from './types.js';

type Extends<Actual, Expected> = [Actual] extends [Expected] ? true : false;
type Equal<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends
  (<T>() => T extends Right ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type _StyleIsJsonValue = Assert<Extends<StyleDocument, JsonValue>>;
type _LayerIsJsonObject = Assert<Extends<StyleLayer, JsonObject>>;
type _SourceIsJsonObject = Assert<Extends<StyleSource, JsonObject>>;
type _OperationIsJsonObject = Assert<Extends<StyleOperation, JsonObject>>;
type _TransactionIsJsonObject = Assert<Extends<StyleTransaction, JsonObject>>;
type _DiffIsJsonObject = Assert<Extends<StyleDiffEntry, JsonObject>>;
type _ErrorIsJsonObject = Assert<Extends<StyleToolError, JsonObject>>;
type _ResultIsJsonObject = Assert<Extends<StyleTransactionResult, JsonObject>>;
type _VersionMatchesMapLibre = Assert<Equal<
  StyleDocument['version'], StyleSpecification['version']
>>;
type _CenterMatchesMapLibre = Assert<Equal<
  StyleDocument['center'], StyleSpecification['center']
>>;
type _LayerTypeMatchesMapLibre = Assert<Equal<
  StyleLayer['type'], LayerSpecification['type']
>>;
type _SourceTypeMatchesMapLibre = Assert<Equal<
  StyleSource['type'], SourceSpecification['type']
>>;
const compileAssertions: [
  _StyleIsJsonValue, _LayerIsJsonObject, _SourceIsJsonObject,
  _OperationIsJsonObject, _TransactionIsJsonObject, _DiffIsJsonObject,
  _ErrorIsJsonObject, _ResultIsJsonObject,
  _VersionMatchesMapLibre, _CenterMatchesMapLibre,
  _LayerTypeMatchesMapLibre, _SourceTypeMatchesMapLibre,
] = [true, true, true, true, true, true, true, true, true, true, true, true];

test('strict core operations carry an op discriminator', () => {
  const operation: StyleOperation = {
    op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#fff' },
  };
  // @ts-expect-error -- strict operation types do not expose extension fields.
  const invalid: StyleOperation = { ...operation, surprise: true };
  const transaction: StyleTransaction = { operations: [operation], validate: true };
  assert.equal(transaction.operations[0]?.op, 'setLayerProperties');
  void invalid;
});

test('OperationContext requires one readonly resolved limit object', () => {
  const limits: CoreExecutionLimits = {
    maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
    maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
    maxOperations: DEFAULT_MAX_OPERATIONS,
  };
  const context: OperationContext = {
    limits, changedLayerIds: new Set(), changedSourceIds: new Set(), warnings: [],
  };
  const exactLimits: Readonly<CoreExecutionLimits> = context.limits;
  assert.strictEqual(exactLimits, limits);
  if (false) {
    // @ts-expect-error -- every handler context requires all three resolved limits.
    const missingLimits: OperationContext = {
      changedLayerIds: new Set(), changedSourceIds: new Set(), warnings: [],
    };
    // @ts-expect-error -- handlers may read but never replace coordinator limits.
    context.limits = limits;
    // @ts-expect-error -- resolved limit fields are readonly inside handlers.
    context.limits.maxStyleBytes = 1;
    void missingLimits;
  }
});

test('StyleTransactionResult narrows failure to one required stable error', () => {
  const requireStableFailure = (result: StyleTransactionResult): StyleToolError | undefined => {
    if (!result.ok) {
      const error: StyleToolError = result.error;
      return error;
    }
    return undefined;
  };
  const success: StyleTransactionResult = {
    ok: true,
    style: { version: 8, sources: {}, layers: [] },
    changedLayers: [], changedSources: [], diff: [], warnings: [],
  };
  assert.equal(requireStableFailure(success), undefined);
  assert.equal(Object.hasOwn(success, 'error'), false);
  if (false) {
    if (success.ok) {
      // @ts-expect-error -- the success branch does not declare an error member.
      void success.error;
    }
    // @ts-expect-error -- a failed result cannot omit its stable error.
    const invalidFailure: StyleTransactionResult = {
      ok: false,
      style: { version: 8, sources: {}, layers: [] },
      changedLayers: [], changedSources: [], diff: [], warnings: [],
    };
    void invalidFailure;
  }
});

test('StyleDocument keeps MapLibre access while remaining a JSON value', () => {
  const style: StyleDocument = {
    version: 8,
    metadata: { owner: 'maps' },
    state: { selected: { default: { id: 1 } } },
    sources: {
      base: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] },
    },
    layers: [{
      id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads',
      paint: { 'line-color': '#000' },
    }],
  };
  const json: JsonValue = style;
  const layerId: string | undefined = style.layers[0]?.id;
  const sourceType: string | undefined = style.sources.base?.type;
  const paint: JsonObject | undefined = style.layers[0]?.paint;
  const replacement = structuredClone(style);
  replacement.layers[0]!.paint!['line-color'] = '#fff';
  assert.equal(layerId, 'roads');
  assert.equal(sourceType, 'vector');
  assert.equal(paint?.['line-color'], '#000');
  assert.equal(replacement.layers[0]?.paint?.['line-color'], '#fff');
  assert.equal(jsonUtf8ByteLength(json) > 0, true);
  assert.deepEqual(compileAssertions, [
    true, true, true, true, true, true, true, true, true, true, true, true,
  ]);
});
```

```ts
// src/core/utf8.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_MAX_DIFF_BYTES, DEFAULT_MAX_OPERATIONS, DEFAULT_MAX_STYLE_BYTES,
  jsonUtf8ByteLength, utf8ByteLength,
} from './utf8.js';

test('counts UTF-8 without DOM or Node encoders', () => {
  assert.equal(utf8ByteLength('abc'), 3);
  assert.equal(utf8ByteLength('界'), 3);
  assert.equal(utf8ByteLength('😀'), 4);
  assert.equal(utf8ByteLength('\uD800'), 3);
  assert.equal(utf8ByteLength('\uDC00'), 3);
  assert.equal(jsonUtf8ByteLength('界'), 5);
});

test('exports the one authoritative default limits', () => {
  assert.equal(DEFAULT_MAX_STYLE_BYTES, 5 * 1024 * 1024);
  assert.equal(DEFAULT_MAX_DIFF_BYTES, 1 * 1024 * 1024);
  assert.equal(DEFAULT_MAX_OPERATIONS, 100);
});
```

- [ ] **Step 2: Run the new tests and verify missing modules fail compilation**

Run: `rtk pnpm test`

Expected: FAIL with TypeScript module-not-found errors for `./types.js`, `./errors.js`, and `./utf8.js`.

- [ ] **Step 3: Define the exact core contracts**

Implement `src/core/types.ts` with these public signatures:

```ts
import type {
  LayerSpecification, SourceSpecification, StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { StyleToolErrorCode } from './errors.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

type IsAny<T> = 0 extends (1 & T) ? true : false;
type JsonKnownValue<T> = IsAny<T> extends true ? JsonValue
  : T extends undefined ? never
    : T extends JsonPrimitive ? T
      : T extends readonly JsonPrimitive[] ? T
        : T extends readonly unknown[] ? JsonValue[]
          : T extends object ? JsonObject
            : JsonValue;
type JsonKnownObject<T extends object> = T extends unknown
  ? JsonObject & { [K in keyof T]: JsonKnownValue<T[K]> }
  : never;

export type StyleLayer = JsonKnownObject<LayerSpecification>;
export type StyleSource = JsonKnownObject<SourceSpecification>;
export type StyleDocument = JsonKnownObject<
  Omit<StyleSpecification, 'sources' | 'layers'>
> & {
  sources: Record<string, StyleSource>;
  layers: StyleLayer[];
};

export type SetLayerPropertiesOperation = {
  op: 'setLayerProperties';
  layerId: string;
  paint?: Record<string, JsonValue | null>;
  layout?: Record<string, JsonValue | null>;
  metadata?: Record<string, JsonValue | null> | null;
  minzoom?: number | null;
  maxzoom?: number | null;
};
export type StyleOperation = SetLayerPropertiesOperation;
export type StyleTransaction = {
  operations: StyleOperation[];
  validate?: boolean;
};
export interface CoreExecutionLimits {
  maxStyleBytes: number;
  maxDiffBytes: number;
  maxOperations: number;
}
export type StyleTransactionOptions = Partial<CoreExecutionLimits>;
export type StyleReplacementOptions = Partial<Pick<
  CoreExecutionLimits, 'maxStyleBytes' | 'maxDiffBytes'
>>;
export type StyleDiffTarget =
  | { kind: 'style' }
  | { kind: 'layer'; id: string }
  | { kind: 'source'; id: string };
export type StyleDiffEntry = {
  op: 'add' | 'remove' | 'replace' | 'move';
  path: string;
  from?: string;
  before?: JsonValue;
  after?: JsonValue;
  target: StyleDiffTarget;
};
export type StyleWarning = {
  code: string; message: string; path?: string;
};
export type StyleToolError = {
  code: StyleToolErrorCode; message: string; path?: string;
  details?: JsonObject;
};
export interface OperationContext {
  readonly limits: Readonly<CoreExecutionLimits>;
  changedLayerIds: Set<string>;
  changedSourceIds: Set<string>;
  warnings: StyleWarning[];
}
export type OperationApplyResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: StyleToolError };
type StyleTransactionResultFields = {
  style: StyleDocument; changedLayers: string[]; changedSources: string[];
  diff: StyleDiffEntry[]; warnings: StyleWarning[];
};
export type StyleTransactionResult =
  | (StyleTransactionResultFields & { ok: true })
  | (StyleTransactionResultFields & { ok: false; error: StyleToolError });
```

This is a distributive JSON-backed projection, never a raw intersection between an upstream Style/Layer/Source type and the package JSON index signature. `JsonKnownValue` preserves MapLibre literal/scalar fields and primitive arrays/tuples (including `version`, camera fields, and layer/source discriminants), converts every `unknown`/`any` to `JsonValue`, converts complex arrays/expressions to `JsonValue[]`, and converts complex objects to `JsonObject`; therefore every known property is compatible with the JSON index signature before intersection. Distribution over the upstream layer/source unions preserves required keys and discriminant narrowing without recursively expanding MapLibre's expression graph. Do not introduce a recursive `JsonSafe<T>` mapper: it reaches TS2589 on those recursive expression unions.

Operations, transactions, errors, warnings, diffs, and results remain closed type aliases rather than being intersected with an open `JsonObject`, so TypeScript excess-property checks continue to complement strict Zod schemas. Because every declared member is recursively JSON-safe, these type aliases are implicitly assignable to `JsonObject`; the compile assertions above lock that property. `StyleTransactionResult` is specifically discriminated by literal `ok`: the success branch does not declare or serialize an `error` member, while failure requires one `StyleToolError`, so `if (!result.ok) throw result.error` narrows safely for MCP without a non-null assertion. Do not add an optional `error` member to success: under strict TypeScript its implicit `undefined` breaks `StyleTransactionResult extends JsonObject` and contradicts the runtime omission contract. Do not convert these aliases to interfaces (which lose implicit index compatibility) or add an open index signature to make an assertion pass.

`OperationContext` is internal execution state rather than a JSON result. Its required `readonly limits: Readonly<CoreExecutionLimits>` contains all three already-resolved values; every operation handler reads limits from that object and must never substitute module defaults or re-read public options. The compile test above rejects an incomplete context, replacement of its resolved limits reference, and mutation of an individual limit.

Task 3's validator is still the runtime authority, but it does not compensate for an unsafe static type. The compile assertions above are mandatory gates: `StyleDocument` must extend `JsonValue`; layer/source values must extend `JsonObject`; `version`, `center`, and layer/source discriminants must equal the corresponding MapLibre indexed-access types; direct Task 5/7 reads and writes must compile without `as`; and `jsonUtf8ByteLength(style)` must type-check. The adapter boundary may pass a successfully validated `StyleDocument` to MapLibre with one localized checked conversion because the JSON-safe public DTO intentionally narrows complex upstream objects rather than pretending to be the entire recursive `StyleSpecification`.

- [ ] **Step 4: Implement the complete stable error-code union, factory, and provenance guard**

In `src/core/errors.ts`, export all approved codes in this order: `INVALID_INPUT`, `STYLE_INVALID`, `NOT_FOUND`, `CONFLICT`, `DEPENDENCY_CONFLICT`, `UNSUPPORTED_SOURCE`, `REVISION_CONFLICT`, `MAP_NOT_READY`, `BRIDGE_DISCONNECTED`, `CAPABILITY_DENIED`, `IO_ERROR`, `TIMEOUT`, `INTERNAL`. Derive and export `StyleToolErrorCode` only from that readonly tuple. Make `createStyleToolError(code, message, path?, details?)` omit undefined optional fields and register each returned plain JSON object in a module-private `WeakSet<object>`. Export `isStyleToolError(value: unknown): value is StyleToolError` as a provenance check implemented only as the non-null object guard plus `WeakSet.has`; it must not inspect properties, invoke Proxy traps, or accept a forged lookalike. All core/MCP paths that throw a known stable error must create it through this factory. `src/core/types.ts` must type-import the derived code type; never hand-maintain a second union. The barrel exports the type only once, from `errors.ts`, and exports both value functions from `errors.ts`, so there is one authority and no conflicting star export.

- [ ] **Step 5: Implement the core-owned UTF-8 and execution-limit primitives**

Create `src/core/utf8.ts` with exactly:

```ts
import type { JsonValue } from './types.js';

export const DEFAULT_MAX_STYLE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_DIFF_BYTES = 1 * 1024 * 1024;
export const DEFAULT_MAX_OPERATIONS = 100;
export function utf8ByteLength(value: string): number;
export function jsonUtf8ByteLength(value: JsonValue): number;
```

Implement `utf8ByteLength` by walking UTF-16 code units: ASCII costs one byte, values through `0x7ff` cost two, other BMP values cost three, a valid surrogate pair costs four and advances twice, and an unpaired surrogate costs three to match UTF-8 replacement encoding. Do not use `Buffer`, `TextEncoder`, `Blob`, DOM, or Node APIs. `jsonUtf8ByteLength` must call `JSON.stringify` exactly once on an already descriptor-sanitized `JsonValue`, reject the impossible `undefined` return as an internal invariant failure, and count that serialized string; it is a measurement helper, never an input validator. Make the exact `src/core/utf8.test.ts` cases from Step 1 pass. This module is the only owner of these defaults; later plans must consume it instead of creating another `src/core/utf8.ts`, using `Buffer.byteLength` for JSON limits, or hard-coding an operation count.

- [ ] **Step 6: Add the core barrel and no-DOM compiler configuration**

Create `src/core/index.ts` with explicit type/value exports from `types.js`, `errors.js`, and `utf8.js`. Create `tsconfig.core.json` extending `tsconfig.json` but overriding `lib` to `["ES2023"]`, `types` to `[]`, `noEmit` to `true`, and including only `src/core/**/*.ts` while excluding `src/core/**/*.test.ts`.

Add `"typecheck:core": "tsc -p tsconfig.core.json"` and make `typecheck` run `pnpm run typecheck:core` before the existing full-project TypeScript command.

- [ ] **Step 7: Run core-only and regular verification**

Run: `rtk pnpm run typecheck:core`

Expected: PASS without DOM or Node ambient types.

Run: `rtk pnpm test`

Expected: PASS, including JSON type contracts, readonly required context limits, transaction-result narrowing, error provenance, and UTF-8/limit tests.

Run: `rtk pnpm run lint`

Expected: PASS.

- [ ] **Step 8: Commit the core type boundary**

```bash
rtk git add package.json tsconfig.core.json src/core/types.ts src/core/errors.ts src/core/utf8.ts src/core/index.ts src/core/types.test.ts src/core/errors.test.ts src/core/utf8.test.ts
rtk git commit -m "feat: define core style contracts"
```

### Task 3: Add Exported Zod Schemas for Strict Core Input

**Files:**
- Create: `src/core/schemas.ts`
- Create: `src/core/schemas.test.ts`
- Modify: `src/core/index.ts`

**Interfaces:**
- Consumes: `JsonValue`, `SetLayerPropertiesOperation`, `StyleOperation`, `StyleTransaction`, and `StyleDocument` from `src/core/types.ts`, plus `DEFAULT_MAX_OPERATIONS` from `src/core/utf8.ts`.
- Produces: `jsonValueSchema`, `styleDocumentSchema`, `setLayerPropertiesOperationSchema`, `styleOperationSchema`, default `styleTransactionSchema`, and `createStyleTransactionSchema(maxOperations)` as exported Zod schemas/factory so the one unknown-input boundary can enforce a configured operation limit without adapter pre-parsing.

- [ ] **Step 1: Write schema tests for accepted and rejected inputs**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createStyleTransactionSchema, styleDocumentSchema, styleTransactionSchema,
} from './schemas.js';

test('accepts a strict setLayerProperties transaction', () => {
  const parsed = styleTransactionSchema.parse({ operations: [{
    op: 'setLayerProperties', layerId: 'roads',
    paint: { 'line-color': '#fff', 'line-width': null },
  }] });
  assert.equal(parsed.validate, true);
});

test('rejects a legacy operation without op', () => {
  assert.equal(styleTransactionSchema.safeParse({
    operations: [{ layerId: 'roads', paint: {} }],
  }).success, false);
});

test('rejects empty transactions, unknown fields, and non-JSON input', () => {
  assert.equal(styleTransactionSchema.safeParse({ operations: [] }).success, false);
  assert.equal(styleTransactionSchema.safeParse({
    operations: [{ op: 'setLayerProperties', layerId: 'roads', surprise: true }],
  }).success, false);
  assert.equal(styleTransactionSchema.safeParse({ operations: [{
    op: 'setLayerProperties', layerId: 'roads', paint: { value: undefined },
  }] }).success, false);
});

test('applies the default 100-operation limit at the schema boundary', () => {
  const operation = (index: number) => ({
    op: 'setLayerProperties' as const,
    layerId: `roads-${index}`,
    paint: { 'line-width': index },
  });
  assert.equal(styleTransactionSchema.safeParse({
    operations: Array.from({ length: 100 }, (_, index) => operation(index)),
  }).success, true);
  assert.equal(styleTransactionSchema.safeParse({
    operations: Array.from({ length: 101 }, (_, index) => operation(index)),
  }).success, false);
  assert.equal(createStyleTransactionSchema(101).safeParse({
    operations: Array.from({ length: 101 }, (_, index) => operation(index)),
  }).success, true);
});

test('rejects cyclic, exotic, and prototype-sensitive style values safely', () => {
  const cyclic: Record<string, unknown> = { version: 8, sources: {}, layers: [] };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => styleDocumentSchema.safeParse(cyclic));
  assert.equal(styleDocumentSchema.safeParse(cyclic).success, false);
  assert.equal(styleDocumentSchema.safeParse({
    version: 8, sources: {}, layers: [], metadata: new Date(),
  }).success, false);
  const dangerous = JSON.parse('{"version":8,"sources":{},"layers":[],"metadata":{"__proto__":{}}}');
  assert.equal(styleDocumentSchema.safeParse(dangerous).success, false);
});

test('rejects accessors, symbols, and exotic array keys without invoking getters', () => {
  let getterCalls = 0;
  const accessor = { version: 8, sources: {}, layers: [] } as Record<PropertyKey, unknown>;
  Object.defineProperty(accessor, 'metadata', { enumerable: true, get() { getterCalls += 1; throw new Error('must not run'); } });
  assert.equal(styleDocumentSchema.safeParse(accessor).success, false);
  assert.equal(getterCalls, 0);
  const nestedPaint: Record<PropertyKey, unknown> = {};
  Object.defineProperty(nestedPaint, 'line-color', {
    enumerable: true, get() { getterCalls += 1; throw new Error('must not run'); },
  });
  assert.equal(styleTransactionSchema.safeParse({ operations: [{
    op: 'setLayerProperties', layerId: 'roads', paint: nestedPaint,
  }] }).success, false);
  assert.equal(getterCalls, 0);
  const symbolKeyed = { operations: [{ op: 'setLayerProperties', layerId: 'roads', paint: {} }] } as Record<PropertyKey, unknown>;
  symbolKeyed[Symbol('hidden')] = true;
  assert.equal(styleTransactionSchema.safeParse(symbolKeyed).success, false);
  const operations = [{ op: 'setLayerProperties', layerId: 'roads', paint: {} }];
  Object.defineProperty(operations, 'extra', { value: true, enumerable: true });
  assert.equal(styleTransactionSchema.safeParse({ operations }).success, false);
  const sharedPaint = { 'line-color': '#000' };
  const aliased = {
    version: 8, sources: {}, layers: [
      { id: 'a', type: 'line', paint: sharedPaint },
      { id: 'b', type: 'line', paint: sharedPaint },
    ],
  };
  assert.equal(styleDocumentSchema.safeParse(aliased).success, false);
  const revoked = Proxy.revocable({ version: 8, sources: {}, layers: [] }, {});
  revoked.revoke();
  assert.doesNotThrow(() => styleDocumentSchema.safeParse(revoked.proxy));
  assert.equal(styleDocumentSchema.safeParse(revoked.proxy).success, false);
});

test('sanitizes transparent proxies before Zod or structuredClone can invoke get traps', () => {
  let getCalls = 0;
  const proxied = new Proxy({ version: 8, sources: {}, layers: [] }, {
    get() { getCalls += 1; throw new Error('must not run'); },
  });
  const parsed = styleDocumentSchema.safeParse(proxied);
  assert.equal(parsed.success, true);
  assert.equal(getCalls, 0);
  assert.doesNotThrow(() => structuredClone(parsed.data));
  assert.equal(Object.getPrototypeOf(parsed.data), Object.prototype);
});

test('rejects hidden own data properties on ordinary objects', () => {
  const style = { version: 8, sources: {}, layers: [] };
  Object.defineProperty(style, 'hidden', { value: true, enumerable: false });
  assert.equal(styleDocumentSchema.safeParse(style).success, false);
});
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run: `rtk pnpm test`

Expected: FAIL because `src/core/schemas.ts` does not exist.

- [ ] **Step 3: Implement recursive JSON, style-envelope, operation, and transaction schemas**

Implement one iterative, cycle-safe, descriptor-based JSON-tree sanitizer and use it as a transforming pipeline stage before any Zod object/array schema may read a property. Walk only `Reflect.ownKeys` plus `Object.getOwnPropertyDescriptors`; copy descriptor `value` fields into a newly allocated plain object/array tree, and pass that sanitized snapshot—not the caller's original object—to every later Zod stage and caller. Reject every accessor descriptor without invoking it, every own symbol, every non-enumerable own property except an array's standard `length`, every unexpected array key or hole, and every array key other than canonical indexes/`length`. Reject `undefined`, functions, symbol values, bigint, non-finite numbers, `Date`/class instances/non-plain prototypes, any repeated object identity (both cycles and acyclic aliases), and own string keys named `__proto__`, `prototype`, or `constructor`. Wrap all reflection (`getPrototypeOf`, `ownKeys`, descriptors) so a revoked/hostile Proxy or throwing trap becomes one stable failed refinement and never escapes `safeParse`. A transparent Proxy whose descriptor view is a valid JSON tree may be accepted, but its `get` trap is never used: all subsequent parsing, cloning, hashing, diffing, and serialization operate only on the sanitized plain snapshot. Requiring a true JSON tree prevents one layer mutation from changing another layer through shared paint/layout/metadata identity while only one candidate ID is marked. Apply this front-door sanitizer to standalone `jsonValueSchema`, `styleDocumentSchema`, every operation schema, `styleOperationSchema`, and every complete transaction schema produced by `createStyleTransactionSchema`; a malicious getter must remain at zero calls even when nested inside an operation. Only after that stage succeeds may the style envelope require `version: z.literal(8)`, JSON-safe source objects, and a JSON-safe `layers` array whose entries require non-empty `id` and `type` while allowing valid Style Spec extension fields.

Make `setLayerPropertiesOperationSchema` strict, require `op: z.literal('setLayerProperties')`, use non-empty `layerId`, accept nullable property values, accept nullable whole metadata, constrain zooms to finite `0..24`, and refine so `minzoom <= maxzoom` when both are numeric. Implement `createStyleTransactionSchema(maxOperations = DEFAULT_MAX_OPERATIONS)` by validating its limit as a positive safe integer, composing the same strict/sanitizing operation-array schema, accepting `1..maxOperations` operations, and defaulting `validate` to `true`. A too-large array must add one deterministic issue at `['operations']` whose JSON-safe params contain `reason:'maxOperations'`, `maxOperations`, and `actualOperations`; this lets `applyStyleTransaction` normalize the stable error without reading the raw input or parsing twice. Export `styleTransactionSchema` as the single default instance created with `DEFAULT_MAX_OPERATIONS`. Do not place a second manual length check in MCP, CLI, or bridge handlers.

- [ ] **Step 4: Export schemas and verify inferred types remain assignable**

Add explicit schema exports to `src/core/index.ts`, then run: `rtk pnpm run typecheck:core`

Expected: PASS; schema output is a structurally checked input envelope, and `validateStyleDocument` performs the single checked narrowing to strict `StyleDocument` after Style Spec validation.

- [ ] **Step 5: Run tests and lint**

Run: `rtk pnpm test`

Expected: PASS for accepted, missing-discriminator, empty-list, unknown-field, default 100-operation, and configured 101-operation cases.

Run: `rtk pnpm run lint`

Expected: PASS.

- [ ] **Step 6: Commit the public schemas**

```bash
rtk git add src/core/schemas.ts src/core/schemas.test.ts src/core/index.ts
rtk git commit -m "feat: add core input schemas"
```

### Task 4: Normalize Style Spec Validation Without DOM or Throws

**Files:**
- Create: `src/core/validation.ts`
- Create: `src/core/validation.test.ts`
- Modify: `src/core/index.ts`

**Interfaces:**
- Consumes: `styleDocumentSchema`, `StyleDocument`, `StyleToolError`, `StyleWarning`, `createStyleToolError`, core-owned `DEFAULT_MAX_STYLE_BYTES`/`jsonUtf8ByteLength`, and statically imported `validateStyleMin`/`ValidationError` from Style Spec 26.2.1.
- Produces: `StyleValidationOptions`, `StyleValidationResult`, and synchronous `validateStyleDocument(style: unknown, options?: StyleValidationOptions): StyleValidationResult`.

- [ ] **Step 1: Write valid, invalid, and thrown-validator regression tests**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_MAX_STYLE_BYTES, jsonUtf8ByteLength } from './utf8.js';
import { validateStyleDocument } from './validation.js';

const makeStyleAtBytes = (bytes: number) => {
  const empty = {
    version: 8, sources: {}, layers: [], metadata: { padding: '' },
  };
  const padding = 'a'.repeat(bytes - jsonUtf8ByteLength(empty));
  return { ...empty, metadata: { padding } };
};

test('validates an empty MapLibre style', () => {
  assert.deepEqual(validateStyleDocument({ version: 8, sources: {}, layers: [] }), {
    ok: true, style: { version: 8, sources: {}, layers: [] }, errors: [], warnings: [],
  });
});

test('normalizes envelope failures as INVALID_INPUT', () => {
  const result = validateStyleDocument({ version: 7, sources: {}, layers: [] });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0]?.code, 'INVALID_INPUT');
  assert.equal(result.errors[0]?.path, '/version');
});

test('normalizes Style Spec failures as STYLE_INVALID without throwing', () => {
  const result = validateStyleDocument({
    version: 8, sources: {},
    layers: [{ id: 'bad', type: 'line', paint: { 'fill-color': '#fff' } }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'STYLE_INVALID'), true);
});

test('accepts exactly 5 MiB and rejects the next UTF-8 byte stably', () => {
  const exact = makeStyleAtBytes(DEFAULT_MAX_STYLE_BYTES);
  assert.equal(jsonUtf8ByteLength(exact), DEFAULT_MAX_STYLE_BYTES);
  assert.equal(validateStyleDocument(exact).ok, true);

  const oversized = makeStyleAtBytes(DEFAULT_MAX_STYLE_BYTES + 1);
  const result = validateStyleDocument(oversized);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors[0], {
    code: 'INVALID_INPUT',
    message: 'Style exceeds the configured UTF-8 JSON size limit.',
    path: '',
    details: {
      reason: 'maxStyleBytes',
      maxBytes: DEFAULT_MAX_STYLE_BYTES,
      actualBytes: DEFAULT_MAX_STYLE_BYTES + 1,
    },
  });
});

test('allows an embedder to override the style byte limit explicitly', () => {
  const style = makeStyleAtBytes(256);
  assert.equal(validateStyleDocument(style, { maxStyleBytes: 255 }).ok, false);
  assert.equal(validateStyleDocument(style, { maxStyleBytes: 256 }).ok, true);
});
```

- [ ] **Step 2: Run the validation test and verify it fails**

Run: `rtk pnpm test`

Expected: FAIL because `validateStyleDocument` is not implemented.

- [ ] **Step 3: Implement the synchronous validation envelope**

Define:

```ts
export type StyleValidationOptions = Partial<
  Pick<CoreExecutionLimits, 'maxStyleBytes'>
> & {
  maxIssues?: number;
};
export type StyleValidationResult =
  | { ok: true; style: StyleDocument; errors: []; warnings: StyleWarning[] }
  | { ok: false; style?: never; errors: StyleToolError[]; warnings: StyleWarning[] };
export function validateStyleDocument(
  style: unknown,
  options: StyleValidationOptions = {}
): StyleValidationResult;
```

First validate `maxIssues` and `maxStyleBytes` as positive safe integers when supplied; normalize invalid options as `INVALID_INPUT` without reading the Style. Then call `styleDocumentSchema.safeParse`. Convert each Zod issue path to RFC 6901 and cap normalized issues at `maxIssues ?? 100`. Only after the descriptor sanitizer has returned its fresh plain snapshot, call `jsonUtf8ByteLength` exactly once and compare it with `maxStyleBytes ?? DEFAULT_MAX_STYLE_BYTES`; never serialize the caller's original value. An oversized document returns the exact stable `INVALID_INPUT` error asserted above, with root JSON Pointer `''` and JSON-number details.

On envelope and size success, call the statically imported `validateStyleMin` in `try/catch` through one private `runMapLibreValidator(style: StyleDocument)` adapter. That adapter contains the only pre-validation `style as unknown as StyleSpecification` conversion required by Style Spec's overly recursive input declaration; no operation/context/diff module may repeat it. The conversion is safe to execute because the descriptor sanitizer has already proved a plain JSON Style envelope, while `validateStyleMin` itself supplies the semantic proof. Return the normalized `StyleDocument` only after the validator returns no errors, in the discriminated `ok:true` branch, so consumers can narrow without any cast. Treat the Style Spec 26.2.1 public validation shape as `{message, identifier?, line?}` only: every returned Style Spec issue becomes `STYLE_INVALID`, and `identifier`/`line` may be copied into JSON-safe `details`. Do not read undocumented `severity` or `key` fields and do not infer warnings from returned validator objects. `warnings` is reserved for explicit warnings emitted by this package. A thrown validator value always produces one `STYLE_INVALID` because validation did not complete; preserve only a safe string message and JSON primitives that the injected seam deliberately supplies. Never let Style Spec v25+ legacy-expression throws escape. A serialization failure after successful sanitization is an `INTERNAL` invariant error and never leaks the value.

- [ ] **Step 4: Add an explicit injected-validator seam for deterministic throw coverage**

Keep the public barrel signature fixed. Export `validateStyleDocumentWith(style, options, validator)` only from `validation.ts` as a test seam and have the public function pass `validateStyleMin`; do not re-export the seam from `core/index.ts`.

Add this deterministic regression test:

```ts
import { validateStyleDocumentWith } from './validation.js';

test('normalizes a thrown Style Spec validator failure', () => {
  const style = { version: 8, sources: {}, layers: [] };
  const result = validateStyleDocumentWith(style, {}, () => {
    throw new Error('legacy expression rejected');
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0]?.code, 'STYLE_INVALID');
  assert.deepEqual(result.warnings, []);
  assert.match(result.errors[0]?.message ?? '', /legacy expression rejected/);
});
```

- [ ] **Step 5: Export the public validation API and run core-only typecheck**

Run: `rtk pnpm run typecheck:core`

Expected: PASS, proving the static Style Spec import does not require DOM or Node ambient types.

- [ ] **Step 6: Run focused and full verification**

Run: `rtk pnpm test`

Expected: PASS for valid, envelope-invalid, Style-Spec-invalid, thrown-validator, exact 5 MiB, one-byte-over, and overridden-limit cases.

Run: `rtk pnpm run lint`

Expected: PASS.

- [ ] **Step 7: Commit normalized validation**

```bash
rtk git add src/core/validation.ts src/core/validation.test.ts src/core/index.ts
rtk git commit -m "feat: validate styles in pure core"
```

### Task 5: Migrate Style Context and Search Into Core

**Files:**
- Create: `src/core/context.ts`
- Create: `src/core/context.test.ts`
- Create: `src/core/search.ts`
- Create: `src/core/search.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/types.test.ts`
- Modify: `src/core/index.ts`
- Modify: `src/types.ts`
- Modify: `src/engine/style-context.ts`
- Modify: `src/engine/style-context.test.ts`
- Modify: `src/tools/compact-tools.ts`

**Interfaces:**
- Consumes: strict `StyleDocument`/`StyleLayer` and the existing root shapes `LayerSummary`, `StyleContextOptions`, `StyleContext`, `LayerSearchQuery`, `LayerSearchResult`.
- Produces: synchronous `buildStyleContext(style: StyleDocument, options?: StyleContextOptions): StyleContext` and `searchLayers(style: StyleDocument, query?: LayerSearchQuery): LayerSearchResult`; closed JSON-backed `LayerSummary`, `StyleContext`, and `LayerSearchResult` output DTOs; `src/engine/style-context.ts` becomes a compatibility re-export.

- [ ] **Step 1: Copy the existing behavior tests to core and add missing limit/semantic cases**

Create `src/core/context.test.ts` with an explicit strict fixture:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStyleContext } from './context.js';
import type { JsonObject, JsonValue, StyleDocument } from './types.js';

const style: StyleDocument = {
  version: 8,
  sources: { basemap: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] } },
  layers: [
    { id: 'background', type: 'background', layout: { visibility: 'none' },
      paint: { 'background-color': '#000' } },
    { id: 'road-primary', type: 'line', source: 'basemap', 'source-layer': 'transportation' },
    { id: 'road-label', type: 'symbol', source: 'basemap', 'source-layer': 'transportation_name' },
    { id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water' },
  ],
};

test('buildStyleContext omits complete layer definitions', () => {
  const result = buildStyleContext(style, { selectedLayerId: 'road-primary' });
  assert.equal(result.layerCount, 4);
  assert.equal(result.sourceCount, 1);
  assert.equal(result.selectedLayerId, 'road-primary');
  assert.equal('paint' in result.layers[0]!, false);
  const first = result.layers[0];
  assert.ok(first);
  const visibility: JsonValue | undefined = first.visibility;
  const summaryObject: JsonObject = first;
  const summaryValue: JsonValue = first;
  const contextObject: JsonObject = result;
  assert.equal(visibility, 'none');
  assert.equal(Object.hasOwn(summaryObject, 'source'), false);
  assert.equal(Object.hasOwn(contextObject, 'activeSourceId'), false);
  void summaryValue;
});

test('buildStyleContext reports counts before applying layerLimit', () => {
  const result = buildStyleContext(style, { layerLimit: 1 });
  assert.equal(result.layerCount, 4);
  assert.equal(result.layers.length, 1);
  assert.deepEqual(result.layerTypes, { background: 1, line: 1, symbol: 1, fill: 1 });
});
```

Create `src/core/search.test.ts` with its own two-layer strict fixture and these assertions:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchLayers } from './search.js';
import type { JsonObject, JsonValue, StyleDocument } from './types.js';

const style: StyleDocument = {
  version: 8,
  sources: { basemap: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] } },
  layers: [
    { id: 'road-primary', type: 'line', source: 'basemap', 'source-layer': 'Transportation' },
    { id: 'road-label', type: 'symbol', source: 'basemap', 'source-layer': 'transportation_name' },
  ],
};

test('searchLayers matches id type source and source-layer case-insensitively', () => {
  const result = searchLayers(style, { query: 'ROAD' });
  const resultObject: JsonObject = result;
  const resultValue: JsonValue = result;
  assert.deepEqual(result.layers.map(({ id }) => id), ['road-primary', 'road-label']);
  assert.deepEqual(searchLayers(style, { sourceLayer: 'transportation' }).layers.map(({ id }) => id),
    ['road-primary', 'road-label']);
  assert.equal(searchLayers(style, { type: 'line', source: 'basemap' }).total, 1);
  const first = result.layers[0];
  assert.ok(first);
  assert.equal(Object.hasOwn(first, 'minzoom'), false);
  void resultValue;
});

test('searchLayers reports total before applying limit', () => {
  const result = searchLayers(style, { query: 'road', limit: 1 });
  assert.equal(result.total, 2);
  assert.deepEqual(result.layers.map(({ id }) => id), ['road-primary']);
});
```

Also add `LayerSummary`, `StyleContext`, and `LayerSearchResult` to the existing type-only import in `src/core/types.test.ts`, then append this compile-and-runtime contract. `JsonObject` and `JsonValue` are already imported. It deliberately mirrors the assignments that `context.ts` and `search.ts` will use rather than relying only on an abstract assignability assertion:

```ts
type _LayerSummaryIsJsonObject = Assert<Extends<LayerSummary, JsonObject>>;
type _StyleContextIsJsonObject = Assert<Extends<StyleContext, JsonObject>>;
type _LayerSearchResultIsJsonObject = Assert<Extends<LayerSearchResult, JsonObject>>;
const task5JsonAssertions: [
  _LayerSummaryIsJsonObject, _StyleContextIsJsonObject, _LayerSearchResultIsJsonObject,
] = [true, true, true];

const summarizeLayerForTask5 = (layer: StyleLayer): LayerSummary => {
  const source: LayerSummary['source'] =
    typeof layer.source === 'string' ? layer.source : undefined;
  const sourceLayer: LayerSummary['sourceLayer'] =
    typeof layer['source-layer'] === 'string' ? layer['source-layer'] : undefined;
  const visibility: JsonValue | undefined = layer.layout?.visibility;
  return {
    id: layer.id,
    type: layer.type,
    ...(source === undefined ? {} : { source }),
    ...(sourceLayer === undefined ? {} : { sourceLayer }),
    ...(layer.minzoom === undefined ? {} : { minzoom: layer.minzoom }),
    ...(layer.maxzoom === undefined ? {} : { maxzoom: layer.maxzoom }),
    ...(visibility === undefined ? {} : { visibility }),
  };
};

test('Task 5 summary assignments narrow JSON-backed source fields exactly', () => {
  const layer: StyleLayer = {
    id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads',
    minzoom: 3, maxzoom: 17, layout: { visibility: 'visible' },
  };
  const summary: LayerSummary = summarizeLayerForTask5(layer);
  const source: string | undefined = summary.source;
  const sourceLayer: string | undefined = summary.sourceLayer;
  const visibility: JsonValue | undefined = summary.visibility;
  const summaryObject: JsonObject = summary;
  const summaryValue: JsonValue = summary;
  assert.deepEqual(
    { source, sourceLayer, minzoom: summary.minzoom, maxzoom: summary.maxzoom,
      visibility },
    { source: 'base', sourceLayer: 'roads', minzoom: 3, maxzoom: 17,
      visibility: 'visible' },
  );
  assert.deepEqual(task5JsonAssertions, [true, true, true]);
  void summaryValue;

  const background = summarizeLayerForTask5({ id: 'background', type: 'background' });
  assert.equal(Object.hasOwn(background, 'source'), false);
  assert.equal(Object.hasOwn(background, 'sourceLayer'), false);
  assert.equal(Object.hasOwn(background, 'visibility'), false);
});
```

- [ ] **Step 2: Run tests and verify the new core imports fail**

Run: `rtk pnpm test`

Expected: FAIL because `src/core/context.ts` and `src/core/search.ts` do not exist and `LayerSummary` has not yet moved into core.

- [ ] **Step 3: Move the summary types and minimal context implementation into core**

Move the existing input interfaces `StyleContextOptions` and `LayerSearchQuery` into `src/core/types.ts` with the same fields. Define the three public output DTOs as closed type aliases, not interfaces, so their declared JSON-safe fields make them statically assignable to `JsonObject` without an index signature:

```ts
export type LayerSummary = {
  id: string;
  type: string;
  source?: string;
  sourceLayer?: string;
  minzoom?: number;
  maxzoom?: number;
  visibility?: JsonValue;
};
export type StyleContext = {
  activeSourceId?: string | null;
  selectedLayerId?: string | null;
  layerCount: number;
  sourceCount: number;
  layerTypes: Record<string, number>;
  layers: LayerSummary[];
};
export type LayerSearchResult = {
  layers: LayerSummary[];
  total: number;
};
```

In `src/types.ts`, replace their former declarations with explicit type-only re-exports from `./core/types.js`; this preserves every existing root type import and avoids independently maintained shapes. The only intentional tightening is `LayerSummary.visibility?: JsonValue` instead of `unknown`. The type assertions in Step 1 audit every other `StyleContext`/`LayerSearchResult` output field as recursively JSON-safe. Implement `buildStyleContext` with default limit 120, stable source/layer counts, type counts, original layer order, and summaries containing only `id`, `type`, `source`, `sourceLayer`, zooms, and visibility.

The open JSON index on each JSON-backed layer means an `in` check still leaves these two variant-only values as `JsonValue`; it is not a sufficient narrowing. Use the exact assignments compiled in `types.test.ts`:

```ts
const source: LayerSummary['source'] =
  typeof layer.source === 'string' ? layer.source : undefined;
const sourceLayer: LayerSummary['sourceLayer'] =
  typeof layer['source-layer'] === 'string' ? layer['source-layer'] : undefined;
const visibility: JsonValue | undefined = layer.layout?.visibility;
const summary: LayerSummary = {
  id: layer.id,
  type: layer.type,
  ...(source === undefined ? {} : { source }),
  ...(sourceLayer === undefined ? {} : { sourceLayer }),
  ...(layer.minzoom === undefined ? {} : { minzoom: layer.minzoom }),
  ...(layer.maxzoom === undefined ? {} : { maxzoom: layer.maxzoom }),
  ...(visibility === undefined ? {} : { visibility }),
};
```

Use that construction for every context summary. Omit every optional key whose value is `undefined`; likewise conditionally include `activeSourceId` and `selectedLayerId` in the outer `StyleContext`, preserving explicit `null`. This makes the runtime object match its JSON-backed static type instead of relying on `JSON.stringify` to discard invalid values. It must pass `typecheck:core` without `as`, non-null assertions, a sanitizing walker, or widening `StyleLayer`. Core context/search already return fresh DTO objects and arrays, so CLI may make its normal fresh copy but must not cast or re-sanitize these outputs.

- [ ] **Step 4: Implement search as a separate pure module**

Implement `searchLayers` with exact-match filters for `type` and `source`, case-insensitive substring matching for free text and `sourceLayer`, default limit 120, original layer order, and `total` computed before slicing. At the start of each layer predicate, derive `source` and `sourceLayer` with the same two `typeof ... === 'string'` expressions above; use only those narrowed variables for source filters, free-text matching, and the returned summary. Do not use `in`, casts, or a widened `StyleLayer` to make these reads convenient.

- [ ] **Step 5: Replace the engine implementation with compatibility re-exports**

Make `src/engine/style-context.ts` contain only:

```ts
export { buildStyleContext } from '../core/context.js';
export { searchLayers } from '../core/search.js';
```

Update the existing engine test fixture/import types only as required; do not delete or weaken its original assertions.

Update `getStyleDocument` in `src/tools/compact-tools.ts` to call `validateStyleDocument(map.getStyle())` and return its strict `StyleDocument` on success. Convert the first normalized validation error to the existing compact failure message; do not retain the current `as unknown as StyleDocument` cast.

- [ ] **Step 6: Export core context/search and run verification**

Add `LayerSummary`, `StyleContextOptions`, `StyleContext`, `LayerSearchQuery`, and `LayerSearchResult` to the explicit type exports in `src/core/index.ts`; export `buildStyleContext` and `searchLayers` as values. Keep the root type-only re-exports from Step 3 pointed at these same definitions.

Run: `rtk pnpm run typecheck:core`

Expected: PASS.

Run: `rtk pnpm test`

Expected: PASS for the old engine regressions, exact `typeof` source narrowing, JSON-backed summary/context/search-result assignments, runtime omission of undefined optional keys, and the new core behavior tests.

Run: `rtk pnpm run lint`

Expected: PASS.

- [ ] **Step 7: Commit context and search migration**

```bash
rtk git add src/core/types.ts src/core/types.test.ts src/core/context.ts src/core/context.test.ts src/core/search.ts src/core/search.test.ts src/core/index.ts src/types.ts src/engine/style-context.ts src/engine/style-context.test.ts src/tools/compact-tools.ts
rtk git commit -m "refactor: move style discovery into core"
```

### Task 6: Implement RFC 6901 Paths and Replayable Structural Diffs

**Files:**
- Create: `src/core/json-pointer.ts`
- Create: `src/core/json-pointer.test.ts`
- Create: `src/core/diff.ts`
- Create: `src/core/diff.test.ts`

**Interfaces:**
- Consumes: `StyleDiffEntry` and the required-limit `OperationContext` from `src/core/types.ts`.
- Produces: `escapeJsonPointerToken(token: string): string`, `toJsonPointer(tokens: readonly (string | number)[]): string`, `jsonValuesEqual(left: JsonValue, right: JsonValue): boolean`, and internal `diffStyleDocuments(before, after, context): StyleDiffEntry[]` for Task 7 and every later operation family.

- [ ] **Step 1: Write JSON Pointer escaping and diff classification tests**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toJsonPointer } from './json-pointer.js';
import { diffStyleDocuments, jsonValuesEqual, replayStyleDiff } from './diff.js';
import {
  DEFAULT_MAX_DIFF_BYTES, DEFAULT_MAX_OPERATIONS, DEFAULT_MAX_STYLE_BYTES,
} from './utf8.js';
import type { CoreExecutionLimits, OperationContext, StyleDocument } from './types.js';

const DEFAULT_TEST_LIMITS: Readonly<CoreExecutionLimits> = {
  maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
  maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
  maxOperations: DEFAULT_MAX_OPERATIONS,
};

const styleWithLayers = (ids: string[]): StyleDocument => ({
  version: 8,
  sources: {},
  layers: ids.map((id) => ({ id, type: 'background' })),
});

test('escapes slash and tilde using RFC 6901', () => {
  assert.equal(toJsonPointer(['sources', 'a/b~c', 'tiles', 0]), '/sources/a~1b~0c/tiles/0');
});

test('uses structural JSON equality rather than object identity', () => {
  assert.equal(jsonValuesEqual(['get', 'class'], ['get', 'class']), true);
  assert.equal(jsonValuesEqual({ owner: 'maps' }, { owner: 'maps' }), true);
  assert.equal(jsonValuesEqual({ a: 1, z: 2 }, { z: 2, a: 1 }), true);
  assert.equal(jsonValuesEqual({ owner: 'maps' }, { owner: 'other' }), false);
});

test('emits replayable container changes and semantic targets', () => {
  const before: StyleDocument = {
    version: 8, sources: {}, layers: [{ id: 'roads', type: 'line' }],
  };
  const after = structuredClone(before);
  after.layers[0]!.layout = { visibility: 'none' };
  const context: OperationContext = {
    limits: DEFAULT_TEST_LIMITS,
    changedLayerIds: new Set(['roads']), changedSourceIds: new Set(), warnings: [],
  };
  assert.deepEqual(diffStyleDocuments(before, after, context), [{
    op: 'add', path: '/layers/0/layout', after: { visibility: 'none' },
    target: { kind: 'layer', id: 'roads' },
  }]);
  assert.deepEqual(diffStyleDocuments(after, before, context), [{
    op: 'remove', path: '/layers/0/layout', before: { visibility: 'none' },
    target: { kind: 'layer', id: 'roads' },
  }]);
});

test('reconciles the Style layer array by id with replayable add/remove/move entries', () => {
  const before = styleWithLayers(['a', 'b', 'c']);
  const after = styleWithLayers(['c', 'b', 'd']);
  const context: OperationContext = {
    limits: DEFAULT_TEST_LIMITS,
    changedLayerIds: new Set(['a', 'b', 'c', 'd']), changedSourceIds: new Set(), warnings: [],
  };
  const entries = diffStyleDocuments(before, after, context);
  assert.deepEqual(entries.map(({ op, target }) => ({ op, target })), [
    { op: 'remove', target: { kind: 'layer', id: 'a' } },
    { op: 'move', target: { kind: 'layer', id: 'c' } },
    { op: 'add', target: { kind: 'layer', id: 'd' } },
  ]);
  assert.deepEqual(replayStyleDiff(before, entries), after);
});

test('moves the candidate layer instead of unchanged bystanders', () => {
  const before = styleWithLayers(['a', 'b', 'c']);
  const after = styleWithLayers(['b', 'c', 'a']);
  const context: OperationContext = {
    limits: DEFAULT_TEST_LIMITS,
    changedLayerIds: new Set(['a']), changedSourceIds: new Set(), warnings: [],
  };
  const entries = diffStyleDocuments(before, after, context);
  assert.deepEqual(entries.map(({ op, from, path, target }) => ({ op, from, path, target })), [{
    op: 'move', from: '/layers/0', path: '/layers/2', target: { kind: 'layer', id: 'a' },
  }]);
  assert.deepEqual(replayStyleDiff(before, entries), after);
});

test('replaces ordinary arrays atomically with a style target', () => {
  const before: StyleDocument = {
    version: 8, sources: {}, layers: [], metadata: { tags: ['a', 'b'] },
  };
  const after: StyleDocument = { ...before, metadata: { tags: ['a'] } };
  const context: OperationContext = {
    limits: DEFAULT_TEST_LIMITS,
    changedLayerIds: new Set(), changedSourceIds: new Set(), warnings: [],
  };
  const entries = diffStyleDocuments(before, after, context);
  assert.deepEqual(entries, [{
    op: 'replace', path: '/metadata/tags', before: ['a', 'b'], after: ['a'], target: { kind: 'style' },
  }]);
  assert.deepEqual(replayStyleDiff(before, entries), after);
});

test('emits object changes in canonical key order regardless of insertion history', () => {
  const beforeA: StyleDocument = { version: 8, sources: {}, layers: [], metadata: { z: 0, a: 0 } };
  const afterA: StyleDocument = { version: 8, sources: {}, layers: [], metadata: { z: 1, a: 1, m: 1 } };
  const beforeB: StyleDocument = { version: 8, sources: {}, layers: [], metadata: { a: 0, z: 0 } };
  const afterB: StyleDocument = { version: 8, sources: {}, layers: [], metadata: { m: 1, a: 1, z: 1 } };
  const context: OperationContext = {
    limits: DEFAULT_TEST_LIMITS,
    changedLayerIds: new Set(), changedSourceIds: new Set(), warnings: [],
  };
  assert.deepEqual(diffStyleDocuments(beforeA, afterA, context), diffStyleDocuments(beforeB, afterB, context));
});

test('canonical ordering is UTF-16 code-unit ordering, not code-point ordering', () => {
  const before: StyleDocument = { version: 8, sources: {}, layers: [], metadata: {} };
  const after: StyleDocument = {
    version: 8, sources: {}, layers: [], metadata: { '\uE000': 1, '😀': 1 },
  };
  const context: OperationContext = {
    limits: DEFAULT_TEST_LIMITS,
    changedLayerIds: new Set(), changedSourceIds: new Set(), warnings: [],
  };
  assert.deepEqual(
    diffStyleDocuments(before, after, context).map(({ path }) => path),
    ['/metadata/😀', '/metadata/\uE000'],
  );
});

test('never degrades an unmarked semantic change to a style target', () => {
  const before = styleWithLayers(['roads']);
  const after = structuredClone(before);
  after.layers[0]!.layout = { visibility: 'none' };
  const context: OperationContext = {
    limits: DEFAULT_TEST_LIMITS,
    changedLayerIds: new Set(), changedSourceIds: new Set(), warnings: [],
  };
  assert.throws(() => diffStyleDocuments(before, after, context), /candidate.*roads/i);
});
```

- [ ] **Step 2: Run tests and verify missing modules fail**

Run: `rtk pnpm test`

Expected: FAIL because the pointer and diff modules do not exist.

- [ ] **Step 3: Implement pointer escaping and construction**

Replace `~` with `~0` before replacing `/` with `~1`. Return the empty string for an empty token list; otherwise join escaped tokens with `/` and prefix one `/`.

- [ ] **Step 4: Implement deterministic structural diffing**

Implement deep JSON equality over the already validated acyclic tree; never use `Object.is` for arrays or objects, and compare object key sets independently of insertion order. Build the diff from the transaction's validated `before` and `after` documents, not from assignment attempts. An absent-to-present object or array is one container-level `add`, and present-to-absent is one container-level `remove`; recurse only when both containers already exist. When diffing ordinary object keys, process removals, shared-key recursion, and additions as three groups, sorting each group with JavaScript's default UTF-16 code-unit ordering; insertion history must never affect equality or output. When both values are ordinary arrays, emit one atomic `replace` rather than index edits; only the root `layers` array has collection semantics. This makes creation of `layout` replay as `/layers/{index}/layout`, removal of its last member replay as removal of that parent container, and arbitrary array shortening/reordering replay without index drift.

Treat the root `layers` array specially as an ID-keyed ordered collection: emit removals from highest current index, then candidate-aware moves against the evolving array, then additions at final indexes, and only then recurse into surviving layer definitions. Prefer moving IDs present in `context.changedLayerIds`; never describe unchanged bystanders as moved when the target order is reachable by moving the actual candidate (for example `[a,b,c] → [b,c,a]` with candidate `a`). If the non-candidate relative order itself changed, fail the internal invariant rather than invent candidate history. Each `move` has actual current `from` and destination `path`, so sequential RFC 6901 replay exactly produces the target order. Source object keys use ordinary escaped object paths.

Classify semantic ownership from the document structure, independently of the candidate sets: every entry below a concrete layer definition, layer add/remove/move, or source definition must carry that layer/source ID. Require that ID to be present in the corresponding `OperationContext` candidate set; a missing candidate is an internal invariant failure and must never silently degrade to `{kind:'style'}`. Candidate IDs with no final diff are harmless and disappear from the result. Only genuinely root/style-owned paths receive `{kind:'style'}`. `finalizeStyleReplacement` can satisfy this invariant by seeding the union of all before/after layer and source IDs. Omit `before` from adds and `after` from removes; include both for replacements. Keep `path` as an actual array-index RFC 6901 pointer. Export a test-only replay helper from `diff.ts` (not the public barrel) and prove all fixtures round-trip. The output must be stable, directly replayable in order, and empty exactly when the final documents are structurally equal.

- [ ] **Step 5: Run tests, core typecheck, and lint**

Run: `rtk pnpm test`

Expected: PASS for escaping, structural equality, container add/remove, semantic targets, replay, and no-op cases.

Run: `rtk pnpm run typecheck:core`

Expected: PASS.

Run: `rtk pnpm run lint`

Expected: PASS.

- [ ] **Step 6: Commit RFC 6901 diff primitives**

```bash
rtk git add src/core/json-pointer.ts src/core/json-pointer.test.ts src/core/diff.ts src/core/diff.test.ts
rtk git commit -m "feat: add RFC 6901 style diffs"
```

### Task 7: Apply Immutable setLayerProperties Transactions

**Files:**
- Create: `src/core/operations/layers.ts`
- Create: `src/core/operations/layers.test.ts`
- Create: `src/core/transaction.ts`
- Create: `src/core/transaction.test.ts`
- Modify: `src/core/index.ts`

**Interfaces:**
- Consumes: `createStyleTransactionSchema`, `validateStyleDocument`, `diffStyleDocuments`, `jsonValuesEqual`, core-owned `DEFAULT_MAX_STYLE_BYTES`/`DEFAULT_MAX_DIFF_BYTES`/`DEFAULT_MAX_OPERATIONS`/`jsonUtf8ByteLength`, `OperationContext` with its required readonly resolved limits, `OperationApplyResult`, and all transaction types from prior tasks.
- Produces: internal `applySetLayerProperties(style: StyleDocument, operation: SetLayerPropertiesOperation, context: OperationContext): OperationApplyResult`; public synchronous `applyStyleTransaction(style: StyleDocument, transaction: unknown, options?: StyleTransactionOptions): StyleTransactionResult` as the sole runtime parse boundary; and public synchronous `finalizeStyleReplacement(original: StyleDocument, replacement: unknown, options?: StyleReplacementOptions): StyleTransactionResult` for trusted adapters that replace an entire document without reimplementing validation/diff/limit semantics. Both public functions return the discriminated success/failure result from Task 2.

- [ ] **Step 1: Write focused layer-operation tests**

Create `src/core/operations/layers.test.ts` with a valid line-layer fixture and concrete assertions:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySetLayerProperties } from './layers.js';
import {
  DEFAULT_MAX_DIFF_BYTES, DEFAULT_MAX_OPERATIONS, DEFAULT_MAX_STYLE_BYTES,
} from '../utf8.js';
import type {
  CoreExecutionLimits, OperationContext, StyleDocument,
} from '../types.js';

const DEFAULT_TEST_LIMITS: Readonly<CoreExecutionLimits> = {
  maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
  maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
  maxOperations: DEFAULT_MAX_OPERATIONS,
};

const original: StyleDocument = {
  version: 8,
  sources: { base: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] } },
  layers: [{ id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads',
    paint: { 'line-color': '#000', 'line-width': 2 }, metadata: { owner: 'maps' } }],
};

test('setLayerProperties replaces and adds properties with RFC 6901 paths', () => {
  const working = structuredClone(original);
  const context: OperationContext = {
    limits: DEFAULT_TEST_LIMITS,
    changedLayerIds: new Set(), changedSourceIds: new Set(), warnings: [],
  };
  const result = applySetLayerProperties(working, {
    op: 'setLayerProperties', layerId: 'roads',
    paint: { 'line-color': '#fff' }, layout: { visibility: 'none' }, minzoom: 4,
  }, context);
  assert.deepEqual(result, { ok: true, changed: true });
  assert.equal(working.layers[0]?.paint?.['line-color'], '#fff');
  assert.equal(working.layers[0]?.layout?.visibility, 'none');
  assert.deepEqual([...context.changedLayerIds], ['roads']);
  assert.deepEqual([...context.changedSourceIds], []);
  assert.strictEqual(context.limits, DEFAULT_TEST_LIMITS);
  assert.equal(original.layers[0]?.paint?.['line-color'], '#000');
});

test('setLayerProperties null removes properties and whole metadata', () => {
  const working = structuredClone(original);
  const context: OperationContext = {
    limits: DEFAULT_TEST_LIMITS,
    changedLayerIds: new Set(), changedSourceIds: new Set(), warnings: [],
  };
  applySetLayerProperties(working, {
    op: 'setLayerProperties', layerId: 'roads',
    paint: { 'line-width': null }, metadata: null,
  }, context);
  assert.equal('line-width' in (working.layers[0]?.paint ?? {}), false);
  assert.equal('metadata' in working.layers[0]!, false);
  assert.deepEqual([...context.changedLayerIds], ['roads']);
});

test('setLayerProperties returns NOT_FOUND for an unknown layer', () => {
  const result = applySetLayerProperties(structuredClone(original), {
    op: 'setLayerProperties', layerId: 'missing', paint: { 'line-color': '#fff' },
  }, {
    limits: DEFAULT_TEST_LIMITS,
    changedLayerIds: new Set(), changedSourceIds: new Set(), warnings: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'NOT_FOUND');
});
```

- [ ] **Step 2: Write atomic transaction tests**

Create `src/core/transaction.test.ts` with a fresh strict fixture per test:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStyleToolError } from './errors.js';
import { applyStyleTransaction, finalizeStyleReplacement } from './transaction.js';
import {
  DEFAULT_MAX_DIFF_BYTES, DEFAULT_MAX_OPERATIONS, DEFAULT_MAX_STYLE_BYTES,
} from './utf8.js';
import type {
  StyleDocument, StyleToolError, StyleTransaction, StyleTransactionOptions,
} from './types.js';

const makeStyle = (): StyleDocument => ({
  version: 8,
  sources: { base: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] } },
  layers: [{ id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads',
    paint: { 'line-color': '#000' } }],
});

test('applyStyleTransaction is immutable and applies operations in order', () => {
  const style = makeStyle();
  const result = applyStyleTransaction(style, { operations: [
    { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#f00' } },
    { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#00f' } },
  ] });
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, 'error'), false);
  assert.equal(result.style.layers[0]?.paint?.['line-color'], '#00f');
  assert.equal(style.layers[0]?.paint?.['line-color'], '#000');
  assert.deepEqual(result.changedLayers, ['roads']);
  assert.deepEqual(result.diff.map(({ op, path, target }) => ({ op, path, target })), [{
    op: 'replace', path: '/layers/0/paint/line-color',
    target: { kind: 'layer', id: 'roads' },
  }]);
});

test('finalizeStyleReplacement owns whole-document validation and diff semantics', () => {
  const style = makeStyle();
  const replacement = structuredClone(style);
  replacement.layers[0]!.paint!['line-color'] = '#fff';
  const result = finalizeStyleReplacement(style, replacement);
  assert.equal(result.ok, true);
  assert.deepEqual(result.changedLayers, ['roads']);
  assert.deepEqual(result.diff[0]?.target, { kind: 'layer', id: 'roads' });
  const invalid = finalizeStyleReplacement(style, { version: 7, sources: {}, layers: [] });
  assert.equal(invalid.ok, false);
  assert.strictEqual(invalid.style, style);
  assert.deepEqual(invalid.diff, []);
});

test('applyStyleTransaction emits parent-container diffs that replay exactly', () => {
  const style = makeStyle();
  const added = applyStyleTransaction(style, { operations: [{
    op: 'setLayerProperties', layerId: 'roads', layout: { visibility: 'none' },
  }] });
  assert.deepEqual(added.diff, [{
    op: 'add', path: '/layers/0/layout', after: { visibility: 'none' },
    target: { kind: 'layer', id: 'roads' },
  }]);
  const removed = applyStyleTransaction(added.style, { operations: [{
    op: 'setLayerProperties', layerId: 'roads', layout: { visibility: null },
  }] });
  assert.equal(removed.diff[0]?.path, '/layers/0/layout');
  assert.equal(removed.diff[0]?.op, 'remove');
});

test('applyStyleTransaction rolls back after a later operation fails', () => {
  const style = makeStyle();
  const result = applyStyleTransaction(style, { operations: [
    { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#fff' } },
    { op: 'setLayerProperties', layerId: 'missing', paint: { 'line-color': '#000' } },
  ] });
  assert.equal(result.ok, false);
  assert.equal(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, []);
  if (result.ok) assert.fail('expected transaction failure');
  assert.equal(Object.hasOwn(result, 'error'), true);
  const error: StyleToolError = result.error;
  assert.equal(error.code, 'NOT_FOUND');
  assert.equal(isStyleToolError(error), true);
});

test('applyStyleTransaction rolls back on final style validation failure', () => {
  const style = makeStyle();
  const result = applyStyleTransaction(style, { operations: [{
    op: 'setLayerProperties', layerId: 'roads', paint: { 'fill-color': '#fff' },
  }] });
  assert.equal(result.ok, false);
  assert.equal(result.style, style);
  assert.equal(result.error?.code, 'STYLE_INVALID');
  assert.deepEqual(result.diff, []);
});

test('applyStyleTransaction reports a successful no-op with empty changes', () => {
  const style = makeStyle();
  const result = applyStyleTransaction(style, { operations: [{
    op: 'setLayerProperties', layerId: 'roads', paint: { 'line-color': '#000' },
  }] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, []);
});

test('structurally equal expression and metadata replacements are no-ops', () => {
  const style = makeStyle();
  style.layers[0]!.paint!['line-pattern'] = ['get', 'pattern'];
  style.layers[0]!.metadata = { owner: 'maps' };
  const result = applyStyleTransaction(style, { operations: [{
    op: 'setLayerProperties', layerId: 'roads',
    paint: { 'line-pattern': ['get', 'pattern'] }, metadata: { owner: 'maps' },
  }] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.diff, []);
});

test('applyStyleTransaction rejects a legacy operation as INVALID_INPUT', () => {
  const style = makeStyle();
  const legacy = { operations: [{ layerId: 'roads', paint: {} }] } as unknown as StyleTransaction;
  const result = applyStyleTransaction(style, legacy);
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'INVALID_INPUT');
  assert.equal(result.style, style);
});

test('the sole transaction boundary enforces default and overridden operation limits', () => {
  const style = makeStyle();
  const operations = Array.from({ length: DEFAULT_MAX_OPERATIONS + 1 }, (_, index) => ({
    op: 'setLayerProperties' as const,
    layerId: 'roads',
    paint: { 'line-width': index + 1 },
  }));
  const rejected = applyStyleTransaction(style, { operations });
  assert.equal(rejected.ok, false);
  assert.strictEqual(rejected.style, style);
  assert.deepEqual(rejected.diff, []);
  assert.equal(rejected.error?.code, 'INVALID_INPUT');
  assert.equal(rejected.error?.path, '/operations');
  assert.deepEqual(rejected.error?.details, {
    reason: 'maxOperations',
    maxOperations: DEFAULT_MAX_OPERATIONS,
    actualOperations: DEFAULT_MAX_OPERATIONS + 1,
  });

  const accepted = applyStyleTransaction(style, { operations }, {
    maxOperations: DEFAULT_MAX_OPERATIONS + 1,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.style.layers[0]?.paint?.['line-width'], DEFAULT_MAX_OPERATIONS + 1);
});

test('resolves each transaction option once before dispatch', () => {
  const reads = { maxStyleBytes: 0, maxDiffBytes: 0, maxOperations: 0 };
  const options = Object.defineProperties({}, {
    maxStyleBytes: { get: () => { reads.maxStyleBytes += 1; return DEFAULT_MAX_STYLE_BYTES; } },
    maxDiffBytes: { get: () => { reads.maxDiffBytes += 1; return DEFAULT_MAX_DIFF_BYTES; } },
    maxOperations: { get: () => { reads.maxOperations += 1; return 2; } },
  }) as StyleTransactionOptions;
  const result = applyStyleTransaction(makeStyle(), { operations: [
    { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 1 } },
    { op: 'setLayerProperties', layerId: 'roads', paint: { 'line-width': 2 } },
  ] }, options);
  assert.equal(result.ok, true);
  assert.deepEqual(reads, { maxStyleBytes: 1, maxDiffBytes: 1, maxOperations: 1 });
});

test('candidate Style size is enforced even when Style Spec validation is disabled', () => {
  const style = makeStyle();
  const result = applyStyleTransaction(style, {
    validate: false,
    operations: [{
      op: 'setLayerProperties', layerId: 'roads',
      metadata: { padding: 'a'.repeat(DEFAULT_MAX_STYLE_BYTES) },
    }],
  });
  assert.equal(result.ok, false);
  assert.strictEqual(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.diff, []);
  assert.equal(result.error?.code, 'INVALID_INPUT');
  assert.equal(result.error?.path, '');
  assert.equal(result.error?.details?.reason, 'maxStyleBytes');
  assert.equal(result.error?.details?.maxBytes, DEFAULT_MAX_STYLE_BYTES);
});

test('oversized deterministic diff rolls back with a stable maxDiffBytes error', () => {
  const style = makeStyle();
  const result = applyStyleTransaction(style, { operations: [{
    op: 'setLayerProperties', layerId: 'roads',
    metadata: { padding: 'a'.repeat(DEFAULT_MAX_DIFF_BYTES) },
  }] });
  assert.equal(result.ok, false);
  assert.strictEqual(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.changedSources, []);
  assert.deepEqual(result.diff, []);
  assert.equal(result.error?.code, 'INVALID_INPUT');
  assert.equal(result.error?.path, '/diff');
  assert.equal(result.error?.details?.reason, 'maxDiffBytes');
  assert.equal(result.error?.details?.maxBytes, DEFAULT_MAX_DIFF_BYTES);
  assert.equal(Number(result.error?.details?.actualBytes) > DEFAULT_MAX_DIFF_BYTES, true);
});

test('whole-document finalization shares the same overridable diff limit', () => {
  const style = makeStyle();
  const replacement = structuredClone(style);
  replacement.layers[0]!.metadata = { owner: 'maps' };
  const rejected = finalizeStyleReplacement(style, replacement, { maxDiffBytes: 1 });
  assert.equal(rejected.ok, false);
  assert.strictEqual(rejected.style, style);
  assert.equal(rejected.error?.details?.reason, 'maxDiffBytes');
  assert.deepEqual(rejected.diff, []);
  const accepted = finalizeStyleReplacement(style, replacement, { maxDiffBytes: 1024 });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.changedLayers, ['roads']);
});
```

- [ ] **Step 3: Run tests and verify transaction modules are missing**

Run: `rtk pnpm test`

Expected: FAIL because `operations/layers.ts` and `transaction.ts` do not exist.

- [ ] **Step 4: Implement the minimal layer mutation primitive**

Locate the layer by array index. Snapshot only that validated JSON layer and compare it structurally after applying the patch. For `paint`, `layout`, and metadata entries, use own-property checks; delete on null and otherwise assign. Delete empty paint/layout objects after their final property is removed. Treat `metadata: null` as removal of the whole metadata field. Add/replace/remove `minzoom` and `maxzoom` using null as removal. Mark `operation.layerId` in `context.changedLayerIds` only when the before/after layer differs by `jsonValuesEqual`; never mark a structural no-op. Return `NOT_FOUND` information without throwing. Diff generation is deliberately centralized in the coordinator. This handler does not currently need a byte limit, but its test must receive `DEFAULT_TEST_LIMITS` through `context`; later GeoJSON/layer handlers read `context.limits` and never import a default as a fallback.

- [ ] **Step 5: Implement the transaction coordinator**

Implement exactly:

```ts
export function applyStyleTransaction(
  style: StyleDocument,
  transaction: unknown,
  options: StyleTransactionOptions = {}
): StyleTransactionResult;

export function finalizeStyleReplacement(
  original: StyleDocument,
  replacement: unknown,
  options: StyleReplacementOptions = {}
): StyleTransactionResult;
```

Treat `applyStyleTransaction` itself as the sole runtime transaction parse/result boundary: its public second parameter is `unknown`. Read each of `options.maxStyleBytes`, `options.maxDiffBytes`, and `options.maxOperations` exactly once, validate each supplied override as a positive safe integer, and materialize one `Readonly<CoreExecutionLimits>` object with absent values replaced by the three exported defaults; invalid limits return the same canonical `INVALID_INPUT` result. Construct `createStyleTransactionSchema(resolvedLimits.maxOperations)` and call that schema exactly once before any transaction property access or mutation. The getter-count test above locks the one-read resolution boundary. Normalize its deterministic operation-count issue to the exact `/operations` error asserted above. Adapters—including MCP—must pass unknown transaction input and options here; they must not parse the transaction, count operations, resolve a second set of defaults, or reconstruct this envelope themselves. Any schema failure returns canonical `INVALID_INPUT` with the original `style`, empty changed-ID/diff arrays, and normalized RFC 6901 path/details.

Validate/clone the input Style as JSON with `resolvedLimits.maxStyleBytes`, then create exactly one context as `{limits: resolvedLimits, changedLayerIds: new Set(), changedSourceIds: new Set(), warnings: []}`. Pass that same context reference to every dispatched handler in order. A handler may consume any of the three already-resolved values from `context.limits`; it must never read public options or fall back to `DEFAULT_MAX_*`, which is essential for later GeoJSON payload handlers to honor caller overrides. Dispatch with an exhaustive `switch (operation.op)` and an `assertNever(operation)` default; every later plan that adds a `StyleOperation` variant must add its handler and switch arm in the same task. After all operations, enforce the resolved serialized Style limit on the sanitized working document even when `validate === false`; Style Spec validation alone is conditional. Then call one shared internal finalizer that invokes `diffStyleDocuments(original, working, context)` exactly once, calls `jsonUtf8ByteLength(diff)` exactly once, and rejects a diff above `context.limits.maxDiffBytes` as `INVALID_INPUT` at `/diff` with `details:{reason:'maxDiffBytes',maxBytes,actualBytes}`. Candidate Style overflow uses root path `''` and the same `maxStyleBytes` detail contract as validation. Neither limit failure exposes a partial diff or candidate.

Derive stable first-seen `changedLayers` and `changedSources` exactly from layer/source semantic targets present in the accepted final diff, using the context sets only as candidate IDs. An empty diff always has empty changed-ID arrays; a non-empty style-only diff may legitimately have empty changed-ID arrays. Operations that cancel each other therefore become a true no-op. On any error, return the `ok:false` union branch with the original `style`, empty changes/diff, preserved validation/package warnings, and the exact object returned by `createStyleToolError`; never spread, clone, serialize, or reconstruct that error, because its WeakSet identity is the provenance contract. The transaction test must prove `isStyleToolError(result.error)` after narrowing. Success and no-op return the `ok:true` branch without an `error`; a no-op has an empty diff and no changed IDs.

`finalizeStyleReplacement` accepts only `StyleReplacementOptions` (`maxStyleBytes` and `maxDiffBytes`), reads/resolves those two values once, validates/clones both inputs with the resolved Style limit, and seeds candidate layer/source IDs from the union of the two documents. Its internal `OperationContext` receives those resolved Style/diff values plus `maxOperations: DEFAULT_MAX_OPERATIONS` solely to satisfy the shared required three-field context; no operation schema runs, the value has no replacement behavior, and `StyleReplacementOptions` must not gain `maxOperations`. Call the same size-enforcing finalizer. This remains the only public core path for turning a whole-document replacement into `StyleTransactionResult`; adapters may wait for MapLibre and then call it, but may not call `diffStyleDocuments`, measure diffs, or reconstruct changed-ID/error semantics themselves. The optional limits exist so an embedder can explicitly lower or raise the design defaults; MCP/store/bridge adapters must pass their resolved configuration instead of preflighting with competing byte logic.

- [ ] **Step 6: Verify the complete transaction behavior**

Run: `rtk pnpm test`

Expected: PASS for property changes, null removal, paths, ordering, rollback, final validation, no-op, de-duplication, strict operation rejection, required handler context limits, one-read option resolution, the default/overridden 100-operation schema boundary, default 5 MiB Style enforcement, default 1 MiB diff enforcement, `validate:false` enforcement, and explicit limit overrides.

Run: `rtk pnpm run typecheck:core`

Expected: PASS.

Run: `rtk pnpm run lint`

Expected: PASS.

- [ ] **Step 7: Export the transaction API and commit**

Add both `applyStyleTransaction` and `finalizeStyleReplacement` to `src/core/index.ts`, keep the focused replacement test above, then run: `rtk pnpm run typecheck`

Expected: PASS.

```bash
rtk git add src/core/operations/layers.ts src/core/operations/layers.test.ts src/core/transaction.ts src/core/transaction.test.ts src/core/index.ts
rtk git commit -m "feat: apply atomic layer property transactions"
```

### Task 8: Preserve the Legacy Root Operation API Through a Shim

**Files:**
- Modify: `src/types.ts`
- Modify: `src/engine/style-operations.ts`
- Modify: `src/engine/style-operations.test.ts`
- Modify: `src/tools/compact-tools.ts`
- Modify: `src/index.ts`
- Create: `src/engine/style-operations-compatibility.test.ts`

**Interfaces:**
- Consumes: strict core `SetLayerPropertiesOperation`, `StyleTransactionResult`, `applyStyleTransaction`, and `validateStyleDocument`.
- Produces: unchanged root legacy `StyleOperation` and `StyleOperationResult`; unchanged `applyStyleOperations(style, operations)` engine signature; root aliases `CoreStyleOperation`, `CoreStyleDiffEntry`, and `CoreStyleTransactionResult` plus non-conflicting core execution option types; unchanged compact `operationsJson` input.

- [ ] **Step 1: Lock the legacy type and result contract with Style-Spec-valid fixtures**

Keep the original `src/engine/style-operations.test.ts` public-envelope and dotted-path assertions, including `layers.road-primary.paint.line-color`. Update any vector-layer fixture that lacks `source-layer` so it remains valid under final Style Spec validation; fixture repair is not a public behavior change. Record the old invalid-paint message and explicitly map the first normalized core error back to that approved legacy message shape rather than assuming Style Spec 26.2.1 will emit identical text. Create `src/engine/style-operations-compatibility.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStyleOperations } from './style-operations.js';
import type { StyleDocument } from '../types.js';

const makeStyle = (): StyleDocument => ({
  version: 8,
  sources: { base: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] } },
  layers: [{ id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads',
    paint: { 'line-color': '#000' } }],
});

test('legacy operations without op still apply through the shim', () => {
  const result = applyStyleOperations(makeStyle(), [{
    layerId: 'roads', paint: { 'line-color': '#fff' },
  }]);
  assert.equal(result.success, true);
  assert.equal(result.style.layers[0]?.paint?.['line-color'], '#fff');
  assert.deepEqual(result.diffSummary[0], {
    path: 'layers.roads.paint.line-color', before: '#000', after: '#fff',
  });
});

test('legacy filter remains supported without entering strict core StyleOperation', () => {
  const filtered = applyStyleOperations(makeStyle(), [{
    layerId: 'roads', filter: ['==', ['get', 'class'], 'primary'],
  }]);
  assert.equal(filtered.success, true);
  assert.deepEqual(filtered.style.layers[0]?.filter, ['==', ['get', 'class'], 'primary']);
  const cleared = applyStyleOperations(filtered.style, [{ layerId: 'roads', filter: null }]);
  assert.equal(cleared.success, true);
  assert.equal('filter' in cleared.style.layers[0]!, false);
});

test('legacy failure returns success false and the original style', () => {
  const style = makeStyle();
  const result = applyStyleOperations(style, [{
    layerId: 'missing', paint: { 'line-color': '#fff' },
  }]);
  assert.equal(result.success, false);
  assert.equal(result.style, style);
  assert.deepEqual(result.changedLayers, []);
  assert.deepEqual(result.diffSummary, []);
});
```

- [ ] **Step 2: Run the compatibility tests against the current engine**

Run: `rtk pnpm test`

Expected: FAIL in `legacy filter remains supported without entering strict core StyleOperation` because the current engine stores `filter: null` instead of deleting the property. The original dotted-diff tests remain green and therefore lock the shim's output contract.

- [ ] **Step 3: Implement explicit legacy-to-core conversion**

Keep the existing root interface exactly:

```ts
export interface StyleOperation {
  layerId: string;
  paint?: JsonObject;
  layout?: JsonObject;
  filter?: unknown;
  minzoom?: number;
  maxzoom?: number;
}
```

In `src/engine/style-operations.ts`, convert paint/layout/zoom fields to `{op:'setLayerProperties', ...}`. Preserve legacy filter input in the shim on the same cloned working document, treating `filter: null` as deletion so the completed style remains valid; then run final `validateStyleDocument` and roll back the whole legacy batch on filter or validation failure. This is a named, temporary compatibility exception only for the interval between this foundation plan and Layer/Data Task 3. Layer/Data Task 3 must convert legacy filters to the strict core `setLayerFilter` operation and delete this local mutation; no final architecture may retain operation logic outside core.

- [ ] **Step 4: Map core results back to the exact legacy envelope**

Return `{success,message,style,changedLayers,diffSummary}`. Translate core paths for layer property changes back to `layers.${layerId}.${section}.${property}` and retain `before`/`after`, so the old public type and old tests remain unchanged. Keep core RFC 6901 entries available only through `/core`.

- [ ] **Step 5: Point compact tools at the shim and preserve five tool schemas**

Keep `getStyleContext`, `searchLayers`, `inspectLayersCompact`, `applyStyleOperations`, and `validateStylePatchJson`. Keep `applyStyleOperations` input exactly `{operationsJson: string, dryRun: boolean, diff: boolean}` and its result exactly `{success,message,data?}`. Continue accepting the old JSON array shape without `op`.

- [ ] **Step 6: Add non-conflicting strict aliases to the root entry**

Keep the existing root exports from `src/types.ts`. Additionally export:

```ts
export type {
  CoreExecutionLimits,
  StyleOperation as CoreStyleOperation,
  StyleDiffEntry as CoreStyleDiffEntry,
  StyleReplacementOptions,
  StyleTransaction,
  StyleTransactionOptions,
  StyleTransactionResult as CoreStyleTransactionResult,
  StyleToolError,
  StyleWarning,
} from './core/index.js';
export { applyStyleTransaction, validateStyleDocument } from './core/index.js';
```

Do not re-export the strict core `StyleOperation` under the unqualified root name.

- [ ] **Step 7: Run compatibility and full verification**

Run: `rtk pnpm test`

Expected: PASS for all original engine tests, the new filter compatibility tests, and strict core tests.

Run: `rtk pnpm run typecheck`

Expected: PASS with both legacy and strict type names available.

Run: `rtk pnpm run lint`

Expected: PASS.

- [ ] **Step 8: Commit the legacy shim**

```bash
rtk git add src/types.ts src/engine/style-operations.ts src/engine/style-operations.test.ts src/engine/style-operations-compatibility.test.ts src/tools/compact-tools.ts src/index.ts
rtk git commit -m "refactor: adapt legacy tools to core transactions"
```

### Task 9: Delegate Existing Full Property and Validation Tools to Core

**Files:**
- Create: `src/tools/legacy-property-adapter.ts`
- Create: `src/tools/legacy-property-adapter.test.ts`
- Create: `src/public-api-compatibility.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `Map` from MapLibre GL JS v6, root legacy `StyleOperation`, `applyStyleOperations`, and core `validateStyleDocument`.
- Produces: internal `applyLegacyPropertyOperationToMap(map: Map, operation: StyleOperation, diff = true): StyleOperationResult`; unchanged full tool names/input schemas/result envelope for paint, layout, filter, zoom, visibility, and validation tools.

- [ ] **Step 1: Write a fake-Map adapter test before creating the adapter**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyLegacyPropertyOperationToMap } from './legacy-property-adapter.js';
import type { Map } from 'maplibre-gl';
import type { StyleDocument } from '../types.js';

const style: StyleDocument = {
  version: 8,
  sources: { base: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] } },
  layers: [{ id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads',
    paint: { 'line-color': '#000' } }],
};

test('property adapter applies one validated style diff', () => {
  const calls: unknown[][] = [];
  const map = {
    getStyle: () => structuredClone(style),
    setStyle: (...args: unknown[]) => { calls.push(args); },
  } as unknown as Map;
  const result = applyLegacyPropertyOperationToMap(map, {
    layerId: 'roads', paint: { 'line-color': '#fff' },
  });
  assert.equal(result.success, true);
  assert.equal(result.style.layers[0]?.paint?.['line-color'], '#fff');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.[1], { diff: true });
});

test('property adapter does not call setStyle after validation failure', () => {
  let calls = 0;
  const map = {
    getStyle: () => structuredClone(style),
    setStyle: () => { calls += 1; },
  } as unknown as Map;
  const result = applyLegacyPropertyOperationToMap(map, {
    layerId: 'roads', paint: { 'fill-color': '#fff' },
  });
  assert.equal(result.success, false);
  assert.equal(calls, 0);
});

test('property adapter honors an explicit diff false option', () => {
  const calls: unknown[][] = [];
  const map = {
    getStyle: () => structuredClone(style),
    setStyle: (...args: unknown[]) => { calls.push(args); },
  } as unknown as Map;
  applyLegacyPropertyOperationToMap(map, {
    layerId: 'roads', paint: { 'line-color': '#fff' },
  }, false);
  assert.deepEqual(calls[0]?.[1], { diff: false });
});
```

- [ ] **Step 2: Run the adapter test and verify the module is missing**

Run: `rtk pnpm test`

Expected: FAIL because `legacy-property-adapter.ts` does not exist.

- [ ] **Step 3: Implement the minimal live-map compatibility adapter**

Read `map.getStyle()`, normalize it through the legacy/core shim, and call `map.setStyle(result.style as StyleSpecification, {diff})` only when the result succeeds and contains a non-empty diff. The function parameter is explicitly `diff = true`; test both the default and an explicit `false`. Return a successful no-op without calling `setStyle`. Convert missing/invalid map styles and synchronous `setStyle` exceptions into the existing `StyleOperationResult` failure envelope; completion waiting belongs to the later MapLibre adapter plan.

- [ ] **Step 4: Rewire the thirteen existing full property tools without renaming them**

In `src/index.ts`, route these tools through `applyLegacyPropertyOperationToMap`: `setLayerPaintProperty`, `setLayerLayoutProperty`, `setLayerPaintPropertySmart`, `setLayerLayoutPropertySmart`, `batchSetLayerPaintPropertiesSmart`, `batchSetLayerLayoutPropertiesSmart`, `batchSetLayerPaintProperties`, `batchSetLayerLayoutProperties`, `clearLayerPaintProperty`, `clearLayerLayoutProperty`, `setLayerFilter`, `setLayerZoomRange`, and `setLayerVisibility`.

Keep each existing Zod input schema and user-facing `ToolCallResult<TStyle>` message. Build one legacy operation from the parsed values; map clear calls to null patches and filter null to the shim's delete behavior.

- [ ] **Step 5: Remove duplicated prefix validation after all callers move**

Delete `layerTypePropertyPrefixes`, `getLayerType`, `getAllowedPrefixes`, and `isPropertyAllowedForLayerType` from `src/index.ts`. Smart tools now report normalized full Style Spec failures rather than consulting a stale hard-coded prefix table.

- [ ] **Step 6: Delegate both full validation tools to the synchronous core validator**

Delete `summarizeValidationErrors` and the dynamic-import `validateStyleObject` helper. Make `validateStyleJson` and `validateCurrentMapStyle` call `validateStyleDocument`, preserving their names, input schemas, success booleans, and human-readable messages. Include at most the first 20 normalized errors in the compatibility message while the structured core result retains its full configured limit.

- [ ] **Step 7: Verify full-tool compilation and adapter behavior**

Before running the gate, create `src/public-api-compatibility.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCompactMapLibreStyleTools, createMapLibreStyleTools } from './index.js';

test('keeps the existing full and compact tool-name surfaces', () => {
  const full = createMapLibreStyleTools({ getMap: () => null });
  assert.equal(Object.keys(full).length, 53);
  for (const name of [
    'setLayerPaintProperty', 'setLayerLayoutProperty',
    'setLayerPaintPropertySmart', 'setLayerLayoutPropertySmart',
    'batchSetLayerPaintPropertiesSmart', 'batchSetLayerLayoutPropertiesSmart',
    'batchSetLayerPaintProperties', 'batchSetLayerLayoutProperties',
    'clearLayerPaintProperty', 'clearLayerLayoutProperty', 'setLayerFilter',
    'setLayerZoomRange', 'setLayerVisibility', 'validateStyleJson',
    'validateCurrentMapStyle',
  ]) assert.equal(name in full, true, name);

  const compact = createCompactMapLibreStyleTools({ getMap: () => null });
  assert.deepEqual(Object.keys(compact), [
    'getStyleContext', 'searchLayers', 'inspectLayersCompact',
    'applyStyleOperations', 'validateStylePatchJson',
  ]);
});
```

Run: `rtk pnpm test`

Expected: PASS for adapter success, validation refusal, all legacy shim tests, and all core tests.

Run: `rtk pnpm run typecheck`

Expected: PASS against MapLibre GL JS 6.3.x with no property-prefix helpers remaining.

Run: `rtk pnpm run lint`

Expected: PASS.

- [ ] **Step 8: Commit full-tool delegation**

```bash
rtk git add src/tools/legacy-property-adapter.ts src/tools/legacy-property-adapter.test.ts src/public-api-compatibility.test.ts src/index.ts
rtk git commit -m "refactor: delegate property tools to core"
```

### Task 10: Publish the Pure Core Subpath and Verify the Tarball Declaration Graph

**Files:**
- Create: `scripts/check-package.mjs`
- Create: `src/core/public-api.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tsconfig.build.json`
- Modify: `README.md`
- Modify: `src/index.ts`
- Modify: `src/core/types.ts`

**Interfaces:**
- Consumes: built `dist/index.js`, `dist/index.d.ts`, `dist/core/index.js`, and `dist/core/index.d.ts`; the repository-pinned TypeScript compiler; a real npm tarball installed into an otherwise bare temporary consumer.
- Produces: package export `maplibre-style-tools/core`; `check:package` build/import/pack/runtime/declaration-graph verification through separate root and pure-core consumers; explicit legal `Node` and `GeoJSON` ambient-type dependencies for the public declaration graphs that require them; documented root legacy versus strict core usage.

- [ ] **Step 1: Write a source-level public barrel test**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyStyleTransaction, finalizeStyleReplacement,
  styleTransactionSchema, validateStyleDocument,
} from './index.js';
import type { StyleDocument } from './index.js';

test('core barrel exposes the pure foundation', () => {
  assert.equal(typeof applyStyleTransaction, 'function');
  assert.equal(typeof finalizeStyleReplacement, 'function');
  assert.equal(typeof validateStyleDocument, 'function');
  assert.equal(styleTransactionSchema.safeParse({ operations: [] }).success, false);
  const original: StyleDocument = { version: 8, sources: {}, layers: [] };
  const replacement: StyleDocument = {
    version: 8, sources: {}, layers: [], metadata: { owner: 'maps' },
  };
  const finalized = finalizeStyleReplacement(original, replacement);
  assert.equal(finalized.ok, true);
  assert.deepEqual(finalized.diff.map(({ op, path }) => ({ op, path })), [{
    op: 'add', path: '/metadata',
  }]);
});
```

- [ ] **Step 2: Add the package checker before adding the subpath export**

Create `scripts/check-package.mjs` to use a temporary directory with `try/finally` cleanup and:

1. dynamically import the workspace self-reference `maplibre-style-tools` and assert both existing factory exports are functions;
2. dynamically import the workspace self-reference `maplibre-style-tools/core`, assert `applyStyleTransaction`, `finalizeStyleReplacement`, `validateStyleDocument`, and `jsonUtf8ByteLength` are functions, assert the three default limit constants equal 5 MiB, 1 MiB, and 100, and call `finalizeStyleReplacement` on a valid metadata-only replacement to prove the built barrel returns one `/metadata` diff;
3. run a real `npm pack --json --pack-destination <temp>` with `spawnSync` and fail on nonzero status or malformed JSON;
4. require `dist/index.js`, `dist/index.d.ts`, `dist/core/index.js`, `dist/core/index.d.ts`, and the re-exported `dist/core/types.d.ts` declaration dependency in the returned file list, while rejecting entries starting with `src/`, `.tmp/`, or `examples/`, entries containing `.test.`, and entries containing `stale`. Read the packed declarations themselves: `dist/index.d.ts` must preserve root `node` then `geojson` references, and `dist/core/types.d.ts` must preserve `geojson`. Parse every packed `dist/core/**/*.d.ts` with the repository-pinned TypeScript API; for every static/dynamic import type, import, export, or external-module reference, reject the specifier when Node's `node:module.isBuiltin(specifier)` returns true and unconditionally reject any `node:` prefix. Also reject a Node triple-slash reference or `@types/node` dependency. Do not substitute `builtinModules`: Node 22 has prefix-only builtins such as `node:test`, `node:sqlite`, and `node:sea` that are recognized by `isBuiltin` but absent from that array. This AST/content assertion prevents the direct root dependency from masking an accidental Node leak into `/core` without relying on a short hand-written module subset or comment-sensitive substring scan;
5. create a bare temporary consumer outside the repository and write exactly this nearest package boundary before creating any TypeScript source:

```json
{
  "private": true,
  "type": "module"
}
```

Install only the exact `.tgz` into that directory with npm's `--no-save`, `--package-lock=false`, scripts/audit/funding disabled, and no separately installed declaration dependencies, so these two package fields remain unchanged. Normal dependencies and the declared MapLibre peer may be resolved from the packed manifest, but the consumer itself must not add a workspace/file dependency other than the installed tarball. The literal `"type":"module"` boundary is mandatory for the NodeNext core smoke and the runtime import smoke; without it, NodeNext plus `verbatimModuleSyntax` classifies a temporary `.ts` source as CommonJS and produces TS1287/TS1295 before the package declarations are tested;
6. write `core-consumer.ts` in that consumer. It imports only representative `/core` values (`applyStyleTransaction`, `validateStyleDocument`, and the three default limit constants) and `/core` types (`StyleDocument`, `StyleTransaction`, `StyleTransactionResult`), constructs a valid Style and typed transaction/result, and never imports the root, AI SDK, or MapLibre GL JS declaration graph. Add negative `@ts-expect-error` probes for both global `Buffer` and `NodeJS.Process`; either directive becoming unused means `/core` loaded Node ambient declarations and fails the check. This is the permanent proof that transport-neutral `/core` works under strict NodeNext with no DOM or Node ambient types;
7. write a separate `root-consumer.ts` in the same consumer. It imports representative root values (`createMapLibreStyleTools`, `createCompactMapLibreStyleTools`) and root types (`CreateMapLibreStyleToolsOptions`, legacy `StyleOperation`), constructs the legacy value and compile-time factory/options references, and never imports `/core` merely to make the root graph look healthy. Add a positive `Buffer` type reference so the smoke proves the packed root's preserved Node reference resolves from its own regular dependency. The root is a browser/AI facade whose declared third-party MapLibre dependencies publish extensionless ESM declaration imports, so this smoke intentionally uses strict TypeScript Bundler resolution rather than claiming that an upstream declaration graph is NodeNext-clean;
8. write two independent configs next to those sources and do not merge either with a repository config. `tsconfig.core-consumer.json` is exactly the strict NodeNext, no-DOM/no-Node boundary:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "types": [],
    "skipLibCheck": false,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force"
  },
  "include": ["core-consumer.ts"]
}
```

`tsconfig.root-consumer.json` keeps the same strictness and empty implicit-type list, while using the supported browser/bundler declaration-resolution mode for the root facade:

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
  "include": ["root-consumer.ts"]
}
```

The generated `core-consumer.ts` must be equivalent in coverage to:

```ts
import {
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
  applyStyleTransaction,
  validateStyleDocument,
} from 'maplibre-style-tools/core';
import type {
  StyleDocument,
  StyleTransaction,
  StyleTransactionResult,
} from 'maplibre-style-tools/core';

const style: StyleDocument = { version: 8, sources: {}, layers: [] };
const transaction: StyleTransaction = {
  operations: [{
    op: 'setLayerProperties',
    layerId: 'roads',
    paint: { 'line-color': '#ffffff' },
  }],
};
const result: StyleTransactionResult = applyStyleTransaction(style, transaction);
// @ts-expect-error /core must not load the Node Buffer global.
void Buffer;
// @ts-expect-error /core must not load the NodeJS namespace.
type CoreMustNotLoadNode = NodeJS.Process;
void result;
void validateStyleDocument(style);
void DEFAULT_MAX_STYLE_BYTES;
void DEFAULT_MAX_DIFF_BYTES;
void DEFAULT_MAX_OPERATIONS;
```

The generated `root-consumer.ts` must be equivalent in coverage to:

```ts
import {
  createCompactMapLibreStyleTools,
  createMapLibreStyleTools,
} from 'maplibre-style-tools';
import type {
  CreateMapLibreStyleToolsOptions,
  StyleOperation as LegacyStyleOperation,
} from 'maplibre-style-tools';

const legacy: LegacyStyleOperation = { layerId: 'roads', paint: {} };
type RootOptions = CreateMapLibreStyleToolsOptions;
type RootNodeAmbient = Buffer;
declare const rootOptions: RootOptions;
declare const rootNodeAmbient: RootNodeAmbient;

void createMapLibreStyleTools;
void createCompactMapLibreStyleTools;
void rootOptions;
void rootNodeAmbient;
void legacy;
```

9. resolve the repository-pinned `typescript/bin/tsc` from `scripts/check-package.mjs`, invoke it through `process.execPath` once with `-p <tsconfig.core-consumer.json> --noEmit` and once with `-p <tsconfig.root-consumer.json> --noEmit`, and fail with captured stdout/stderr if either process is nonzero. Do not install TypeScript in the consumer, call a globally resolved `tsc`, set `skipLibCheck:true`, or add `node`/`geojson` to either consumer's `types` list. The package's own manifest plus preserved declaration references must supply those legal ambient dependencies. Layer/Data Task 17 inherits both files and both configs: extend `core-consumer.ts` only with `/core` GeoJSON/analysis declarations that remain valid under the unchanged no-DOM NodeNext config; extend `root-consumer.ts` and its unchanged Bundler config with `/maplibre`, `/ai`, runtime DTO, prepared-handle, authority-union, and cross-entry-point assertions. It must not move MapLibre/AI declarations into the NodeNext core smoke, collapse the two configs, or weaken either strictness setting;
10. read the installed `maplibre-style-tools/package.json` and assert `dependencies['@types/geojson']` is exactly `^7946.0.16` and `dependencies['@types/node']` is exactly `^22.20.1`, with no second `devDependencies['@types/node']` range. Then execute an ESM runtime file that imports both package specifiers, asserts the two root factories, all four core functions above, and the three exact default limit values exist, and calls installed `finalizeStyleReplacement` with the same valid metadata replacement to assert its successful RFC 6901 diff. Never satisfy either compile smoke or the runtime smoke through a relative `dist/*` import, a repository path, workspace dependency resolution, or a separately installed declaration package.

Add `"check:package": "pnpm run build && node scripts/check-package.mjs"` to `package.json`.

- [ ] **Step 3: Run the checker and verify the missing subpath failure**

Run: `rtk pnpm run check:package`

Expected: FAIL with `ERR_PACKAGE_PATH_NOT_EXPORTED` for `maplibre-style-tools/core`.

- [ ] **Step 4: Add the exact `/core` export map and make both declaration graphs legal**

Keep the existing root export and add:

```json
"./core": {
  "types": "./dist/core/index.d.ts",
  "import": "./dist/core/index.js",
  "default": "./dist/core/index.js"
}
```

Do not route `/core` through `dist/index.js`; importing core must not load AI SDK or MapLibre GL JS.

The Task 2 DTO declarations intentionally derive known keys from `StyleSpecification`, `LayerSpecification`, and `SourceSpecification`. MapLibre Style Spec's published declarations use the ambient `GeoJSON` namespace, so the package—not either temporary consumer—must own that declaration dependency. Add `@types/geojson` at `^7946.0.16` to regular `dependencies` (not `devDependencies`, `peerDependencies`, or `optionalDependencies`). Add this preserved declaration reference as the first line of `src/core/types.ts`; `/core` must have no `node` reference or Node declaration dependency of its own:

```ts
/// <reference types="geojson" preserve="true" />
```

The root facade's emitted declarations expose the AI SDK tool types, whose legal public graph references Node built-ins and `Buffer`. Move the existing `@types/node` entry out of `devDependencies` into regular `dependencies` at exactly `^22.20.1`; do not leave a duplicate or different development range. Put these two preserved references, in this order, at the start of `src/index.ts` so `root-consumer.ts` succeeds with `types:[]` without a consumer-installed workaround:

```ts
/// <reference types="node" preserve="true" />
/// <reference types="geojson" preserve="true" />
```

Regenerate `pnpm-lock.yaml`. The root Bundler-resolution smoke is deliberate: even with its Node/GeoJSON ambient dependencies made explicit, MapLibre GL JS 6.3's published ESM declaration dependencies contain extensionless relative imports that TypeScript correctly rejects under NodeNext. Do not hide that upstream incompatibility with `skipLibCheck:true`, force the browser/AI facade into the pure-core NodeNext smoke, or add a `node` reference anywhere under `src/core/`.

Run: `rtk pnpm install`

Expected: PASS with `package.json` and `pnpm-lock.yaml` recording both direct declaration dependencies and no `devDependencies['@types/node']`. These are explicit public declaration contracts, not test-only workarounds. If implementation instead removes every upstream Style Spec type from the emitted `StyleDocument`/layer/source declaration graph, prove that the built `/core` declaration has no `@maplibre/maplibre-gl-style-spec` or ambient `GeoJSON` reference before removing the core reference/dependency; the root MapLibre/AI declaration contract must still remain legal. Never silence either graph with `skipLibCheck`, a consumer-only `types` entry, or an undeclared transitive dependency.

- [ ] **Step 5: Verify build inclusion and clean stale-output behavior**

Confirm `tsconfig.build.json` includes `src/core/**/*.ts` through its existing `src/**/*.ts` include and excludes every `*.test.ts`. Do not add DOM-free overrides to the production build config; `tsconfig.core.json` owns that invariant.

Run: `rtk pnpm run build`

Expected: PASS and emit both root and core JavaScript/declarations.

Run: `rtk node --input-type=module --eval "import {writeFileSync,existsSync} from 'node:fs'; writeFileSync('dist/stale.js','stale'); if (!existsSync('dist/stale.js')) process.exit(1)"`

Expected: PASS and create only the deliberate disposable stale artifact.

Run: `rtk pnpm run build`

Expected: PASS and `prebuild` removes `dist/stale.js` before recompilation.

- [ ] **Step 6: Run the package checker and import smoke tests**

Run: `rtk pnpm run check:package`

Expected: PASS; the real tarball has root/core entry points and declarations, contains no source, tests, cache, examples, or stale output, and works from a bare installed consumer through package exports.

The same PASS must include both temporary-consumer compiles. `core-consumer.ts` runs under strict NodeNext with `lib:["ES2023"]`, `types:[]`, and `skipLibCheck:false`; its nearest `package.json` keeps `type:'module'`, so it is checked as ESM without TS1287/TS1295 and proves `/core` has no DOM/Node dependency. `root-consumer.ts` runs separately under strict ESNext/Bundler with DOM libs, `types:[]`, and `skipLibCheck:false`, exercising the real root AI/MapLibre declaration graph without misclassifying upstream extensionless ESM declarations as NodeNext-compatible. Both resolve only package specifiers and use the repository-pinned compiler. The consumer installs only the packed tarball; its manifest and preserved root/core references—not a consumer install or `types` override—supply the legal Node and GeoJSON ambient declarations.

Run: `rtk node --input-type=module --eval "const core=await import('maplibre-style-tools/core'); const result=core.validateStyleDocument({version:8,sources:{},layers:[]}); const finalized=core.finalizeStyleReplacement({version:8,sources:{},layers:[]},{version:8,sources:{},layers:[],metadata:{owner:'maps'}}); if(!result.ok||!finalized.ok||finalized.diff[0]?.path!=='/metadata') process.exit(1)"`

Expected: PASS without creating a DOM or importing the root AI entry.

- [ ] **Step 7: Update README with v6 and strict-core usage**

Change the requirement to MapLibre GL JS 6.3 or compatible. Add a `Pure core` example importing `applyStyleTransaction` from `maplibre-style-tools/core` and using `{op:'setLayerProperties'}`. State that root `StyleOperation` and compact `operationsJson` remain legacy-compatible, while `/core` requires the discriminator and returns RFC 6901 diffs. Document the core-owned defaults (5 MiB Style, 1 MiB diff, 100 operations), the optional `StyleTransactionOptions` overrides, and that adapters must pass unknown transactions to this boundary instead of pre-parsing them. Note that the root facade owns its required Node/GeoJSON declaration dependencies, while `/core` remains usable under no-DOM/no-Node NodeNext type checking.

- [ ] **Step 8: Run the final foundation gate**

Run: `rtk pnpm install --frozen-lockfile`

Expected: PASS without modifying `pnpm-lock.yaml`.

Run: `rtk node --input-type=module --eval "import rootPkg from './package.json' with {type:'json'}; import mapPkg from './node_modules/maplibre-gl/package.json' with {type:'json'}; import specPkg from './node_modules/@maplibre/maplibre-gl-style-spec/package.json' with {type:'json'}; if(rootPkg.peerDependencies?.['maplibre-gl']!=='^6.3.0'||rootPkg.devDependencies?.['maplibre-gl']!=='^6.3.0'||rootPkg.dependencies?.['@maplibre/maplibre-gl-style-spec']!=='^26.2.1'||rootPkg.dependencies?.['@types/geojson']!=='^7946.0.16'||rootPkg.dependencies?.['@types/node']!=='^22.20.1'||rootPkg.devDependencies?.['@types/node']!==undefined||!mapPkg.version.startsWith('6.3.')||!specPkg.version.startsWith('26.2.')) process.exit(1)"`

Expected: PASS against the frozen installation.

Run: `rtk pnpm run lint`

Expected: PASS.

Run: `rtk pnpm run typecheck`

Expected: PASS, including core no-DOM and MapLibre v6 contracts.

Run: `rtk pnpm test`

Expected: PASS with recursively discovered tests.

Run: `rtk pnpm run check:package`

Expected: PASS, including runtime imports, the strict no-DOM NodeNext `/core` compile, and the separate strict ESNext/Bundler root-facade compile from the same real installed tarball. Both use `types:[]`/`skipLibCheck:false`; no TS1287/TS1295 fallback-to-CommonJS diagnostic, missing Node/GeoJSON ambient, or hidden declaration error is permitted.

- [ ] **Step 9: Commit exports and package verification**

```bash
rtk git add package.json pnpm-lock.yaml tsconfig.build.json README.md scripts/check-package.mjs src/index.ts src/core/types.ts src/core/public-api.test.ts
rtk git commit -m "feat: publish the verified pure style core"
```

## Completion Criteria

- `maplibre-gl` resolves to 6.3.x and direct Style Spec resolves to 26.2.x from a frozen install.
- All tests are discovered recursively rather than by a hard-coded file list.
- `rtk pnpm run typecheck:core` passes with no DOM or Node ambient types.
- `/core` contains no imports from `ai` or `maplibre-gl` and has no import-time side effects.
- `StyleDocument`, layer/source DTOs, operations, errors, diffs, and transaction results are statically JSON-backed without raw upstream-type/index-signature intersections; compile tests preserve MapLibre keys/discriminants, construct the real Task 5 `LayerSummary` with `typeof layer.source === 'string'` and `typeof layer['source-layer'] === 'string'`, and exercise Task 7 access without casts.
- `/core` alone owns and exports `DEFAULT_MAX_STYLE_BYTES` (5 MiB), `DEFAULT_MAX_DIFF_BYTES` (1 MiB), `DEFAULT_MAX_OPERATIONS` (100), `utf8ByteLength`, and `jsonUtf8ByteLength`.
- Every `OperationContext` requires `readonly limits: Readonly<CoreExecutionLimits>` with all three resolved values; the coordinator creates one context and passes the same reference to every handler, so future GeoJSON/layer handlers never silently fall back to 5 MiB or another module default.
- `isStyleToolError` recognizes only factory-created errors through trap-free provenance checking, so MCP guards can distinguish stable errors from forged/unknown throws.
- `StyleTransactionResult` is a JSON-backed discriminated union: `ok:true` has no declared or serialized `error` member, while `ok:false` requires an authentic factory-created `StyleToolError` and narrows without assertions in MCP guards.
- Validation is synchronous, uses a static Style Spec import, and converts both returned and thrown issues into stable results.
- Context/search behavior remains compatible with the existing engine tests; `LayerSummary.visibility` is `JsonValue`, all three public output DTOs extend `JsonObject`, and implementations omit undefined optional keys so CLI consumers need only a fresh copy—never a cast or sanitizing walker.
- `applyStyleTransaction` is immutable, ordered, validated, all-or-nothing, and emits RFC 6901 diffs.
- `applyStyleTransaction` reads each option once, materializes one three-field limit object, parses unknown input once with its resolved operation limit, passes those exact limits through the handler context, and enforces candidate Style/diff bytes; `finalizeStyleReplacement` shares Style/diff enforcement without accepting an irrelevant operation-limit option.
- Strict `/core` operations require `op: 'setLayerProperties'`; the root legacy `StyleOperation` keeps its existing shape.
- Existing full/compact factory and tool names remain present; legacy JSON strings remain accepted.
- Root and `/core` ESM/type entry points import from the built package, and `finalizeStyleReplacement` is callable through the source barrel, built self-reference, and bare installed tarball.
- The real-tarball checker creates one isolated consumer with the exact `private:true`/`type:'module'` boundary and two independent strict configs: `core-consumer.ts` compiles only `/core` under NodeNext with no DOM and uses negative `Buffer`/`NodeJS` probes, while `root-consumer.ts` compiles the browser/AI facade under ESNext/Bundler with DOM libs and positively resolves `Buffer` from the packed root reference. Both keep `types:[]` and `skipLibCheck:false`, import only package specifiers, and pass the repository-pinned `tsc --noEmit`; packed-declaration inspection also rejects any Node reference/import under `dist/core`. Layer/Data Task 17 inherits and extends both without merging them or moving MapLibre/AI declarations into the pure-core gate.
- Any public declaration that relies on Style Spec's ambient `GeoJSON` namespace has an explicit preserved reference backed by direct `@types/geojson`; the root AI declaration graph likewise has a root-only preserved Node reference backed by direct `@types/node@^22.20.1`, with no duplicate dev range and no Node reference under `/core`. No consumer-only install, transitive-dependency accident, `types` override, or `skipLibCheck` masks either contract.
- A real `npm pack --json` artifact contains only intended distributable output and npm metadata, and a bare temporary consumer loads root and `/core` through package exports at runtime and compile time.
