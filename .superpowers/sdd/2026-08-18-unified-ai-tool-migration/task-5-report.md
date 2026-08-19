# Task 5 Report: Runtime-command and feature-query tools

## Scope completed

- Added `createRunMapCommandTool` as a closed action switch over the eleven `RunMapCommandInput` actions.
- Each action constructs the exact adapter input (without the AI-tool discriminator) and invokes only its corresponding `createMapRuntimeCommands` authority.
- Lists project as bounded `kind: 'list'` receipts; mutations project as acknowledgement receipts. Adapter failures are passed directly to the AI boundary without catch-and-rewrite behavior.
- Added `createQueryMapFeaturesTool` as a closed source/rendered target switch. It strips the target discriminator before calling the bounded adapter, preserves source-ID preflight by using the strict tool schema before `getMap`, and does not read `getContext` or infer a source ID.
- Query projections preserve adapter features, warnings, and truncation through the requested complete-envelope bound; adapter byte truncation warnings are retained, and the outer boundary never raises a requested cap above the 1 MiB global maximum.
- Added direct focused tests for all runtime actions, their success/error routes, source/rendered query routes, viewport/point/bounds geometry, validation-before-map access, 100-item cap, adapter byte cap, projection, and source query ordering.

## Red evidence

Initial focused compile/test command:

```sh
rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test .tmp/test-dist/ai-sdk/runtime.test.js
```

Compilation passed, but the runtime suite failed 3 of 5 subtests. The direct tests exposed that discriminators were being forwarded into strict adapter schemas:

- runtime action result: `INVALID_INPUT: Unrecognized key: "action"`
- query result: `INVALID_INPUT: Unrecognized key: "target"`
- a 100-byte feature request also raised `RangeError: AI result mandatory envelope exceeds output limit` when incorrectly used as the outer-envelope cap.

## Green evidence

After correcting the exact adapter input projections and retaining the complete outer envelope cap, the required focused command passed:

```sh
rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test \
  .tmp/test-dist/ai-sdk/runtime.test.js \
  .tmp/test-dist/adapters/maplibre/runtime-commands.test.js \
  .tmp/test-dist/adapters/maplibre/feature-query.test.js
```

Result: 45 tests passed, 0 failed (41 top-level subtests/suites).

## GitNexus outcomes

- `detect_changes` initially required the explicit repository because multiple repositories were indexed. Retried with `repo: "maplibre-style-tools"` and this linked worktree. It returned `changed_files: 1`, `changed_count: 0`, `affected_count: 0`, risk `low`; this is inconsistent with the three changed task files and is recorded rather than treated as evidence of no changes.
- Required boundary helper impact checks were unavailable in the fresh worktree index:
  - `boundMapCommandReceipt`: target not found; `risk: UNKNOWN`.
  - `boundFeatureQueryProjection`: target not found; `risk: UNKNOWN`.
- LSP/reference resolution for the new fresh-worktree symbols remained unavailable as specified.

## Concerns

No implementation concern remains from the focused tests. GitNexus has not indexed the fresh-worktree boundary helpers, so its impact result cannot establish their call-site coverage; the direct runtime tests and existing boundary tests provide the executed coverage for this task.

## Fix round 1

### Findings addressed

- `createAiTool` now forwards the SDK execution abort signal to its callback while preserving all existing one-input callbacks. `runMapCommand` passes that signal only to `addImageFromUrl`; an already-aborted SDK call fails before loader or image mutation.
- `queryMapFeatures` passes `maxSerializedBytes` to both the bounded adapter and `boundFeatureQueryProjection`, so the serialized success envelope is capped by the requested value.
- `boundFeatureQueryProjection` admits adapter warnings before folding incoming adapter truncation into the output-truncated state, preserving `FEATURE_QUERY_TRUNCATED`.

### Round 1 red/green evidence

New direct regression tests initially failed:

- adapter truncation warning was replaced by `COMPACT_OUTPUT_TRUNCATED`;
- aborted URL image commands still succeeded because the SDK signal was discarded;
- the complete-envelope query-cap test was added to prevent adapter-only bounding.

The focused verification then passed:

```sh
rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test \
  .tmp/test-dist/ai-sdk/runtime.test.js \
  .tmp/test-dist/ai-sdk/boundary.test.js \
  .tmp/test-dist/adapters/maplibre/runtime-commands.test.js \
  .tmp/test-dist/adapters/maplibre/feature-query.test.js
```

Result: 57 tests passed, 0 failed (42 top-level subtests/suites).

`detect_changes` was rerun with the linked worktree and explicit repository. It reported `changed_files: 4`, `changed_count: 0`, `affected_count: 0`, risk `low`; the count mismatch remains an index limitation, not an absence-of-change claim.

## Fix round 2

The documented positive `ByteLimit` range remains unchanged. A valid requested feature-query cap too small for the mandatory successful envelope now produces a fixed, ordinary global-envelope `INVALID_INPUT` result at `/maxSerializedBytes`, rather than throwing. The direct regression exercises `maxSerializedBytes: 1`; the existing 512-byte serialized-success regression remains green.

Red evidence: the new 1-byte test initially threw `RangeError: AI result mandatory envelope exceeds output limit`.

Green evidence:

```sh
rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test \
  .tmp/test-dist/ai-sdk/runtime.test.js \
  .tmp/test-dist/ai-sdk/boundary.test.js \
  .tmp/test-dist/adapters/maplibre/runtime-commands.test.js \
  .tmp/test-dist/adapters/maplibre/feature-query.test.js
```

Result: 58 tests passed, 0 failed (42 top-level subtests/suites).

The requested `boundFeatureQueryProjection` impact check remains unavailable in GitNexus (`UNKNOWN`); LSP reference resolution is unresolved in this fresh worktree. `detect_changes` reported `changed_files: 2`, `changed_count: 0`, `affected_count: 0`, risk `low`; the mismatch is recorded as an index limitation.

## Recovery and commit

The recovery audit found the Task 5 implementation already committed across the initial route and two focused correction commits, with no remaining uncommitted source/test changes. It was consolidated as `23ec22c feat(ai): add runtime command and feature query tools`.

Recovery verification reran the focused TypeScript compile plus runtime, boundary, runtime-command adapter, and feature-query adapter suites. Result: 58 tests passed, 0 failed (42 top-level subtests/suites).

No implementation concern remains. GitNexus still has no fresh-worktree index entries for the two changed boundary helpers; its recorded `UNKNOWN` impact result therefore cannot establish call-site coverage.

## Review fix round 1

Root cause: the runtime route inferred list truncation from a nonexistent `total` field instead of forwarding the adapter's `RuntimeListData.truncated` value. The route now passes that adapter flag directly into `boundMapCommandReceipt`.

Red evidence: the new over-limit image-list regression failed with the receipt's top-level `truncated` value false.

Green evidence:

```sh
rtk pnpm exec tsc -p tsconfig.test.json && rtk node --test \
  .tmp/test-dist/ai-sdk/runtime.test.js \
  .tmp/test-dist/ai-sdk/boundary.test.js \
  .tmp/test-dist/adapters/maplibre/runtime-commands.test.js \
  .tmp/test-dist/adapters/maplibre/feature-query.test.js
```

Result: 59 tests passed, 0 failed (42 top-level subtests/suites). The regression confirms both the outer receipt and nested list are truncated and retain `COMPACT_OUTPUT_TRUNCATED`.
