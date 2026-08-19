# Task 6 Report

## Status
Completed unified `/ai` factory composition without modifying legacy factory implementations or root exports.

## Changed files
- `src/ai-sdk/tools.ts` — composed the five focused constructors exactly once.
- `src/ai-sdk/tools.test.ts` — exact 53-full, 5-compact, 8-retained inventory with native-route execution matrix.
- `src/ai-sdk/index.ts` — exports only `createMapLibreStyleTools` and the §3.1 public types.
- `src/exports.test.ts` — verifies the exact compiled `/ai` runtime value surface.
- `src/public-api-compatibility.test.ts` — imports retained legacy schema fixtures directly so legacy root tests remain compilable after `/ai` schema export removal.

## Red / green evidence
- Red: `rtk pnpm exec tsc -p tsconfig.test.json` failed because `./tools.js` did not exist (TS2307), establishing the factory test before implementation.
- Green: `rtk pnpm exec tsc -p tsconfig.test.json` succeeded.
- Green: focused unified suite succeeded: 54 tests passed, 0 failed across boundary, schemas, inspect, mutate, runtime, tools, and exports tests.

## Matrix coverage
The factory has exactly `inspectStyle`, `applyStyleTransaction`, `applyStyleDocument`, `runMapCommand`, and `queryMapFeatures`; all executes are Promise-returning. The test asserts ordered 53/5/8 inventories and executes each migration row through its native unified route using a fresh MapLibre fixture.

## Impact / references
Staged `gitnexus_detect_changes` reported LOW risk, five changed files, and no affected processes.

## Legacy surface
Legacy `full-tools`, `compact-tools`, and root factory exports were not deleted or altered. `/ai` compatibility schema test imports were redirected locally only because `/ai` intentionally no longer exports those schemas.

## Commit
`3a2d89b feat(ai): compose five-tool AI SDK surface`

## Concerns
No known behavioral concerns.

## Fix round 1
Replaced slice-based success-only rows with explicit native inputs for every ordered 53/5/8 capability. Each row now validates its own unified action/operation result and relevant map mutation or runtime side effect. The split GeoJSON set-data/update-data and style-document/URL-document routes execute independently. The additional authority case verifies the authentic `MAP_NOT_READY` failure from the native transaction route.

Verification: `rtk pnpm exec tsc -p tsconfig.test.json` and the focused unified suite passed: 55 tests, 0 failures. Staged `gitnexus_detect_changes` found one test file, LOW risk, and no affected processes.

Fix commit: `28cbe21 test(ai): exercise migration routes behaviorally`.

## Fix round 2
Added direct native `setLayerFilter` replace/and/or/clear execution with exact resulting filter-tree assertions and verified exact runtime arguments for GeoJSON update and source tile LOD commands. Focused compile and unified suite passed: 57 tests, 0 failures. Staged `gitnexus_detect_changes`: LOW risk, one test file, no affected processes.

Fix commit: `c822a0e test(ai): cover filter migration branches`.

## Fix round 3
Replaced generic action echoes and nonempty-ID checks in the ordered 53/5/8 matrix with row-specific assertions over exact inspection projections, committed style/source/root mutations, layer ordering, feature projections, and adapter argument tuples. The native transaction unavailable authority case remains asserted as an authentic `MAP_NOT_READY` failure with no success result.

CodeGraph evidence: `codegraph_explore` traced `createInspectStyleTool` projections (`src/ai-sdk/inspect.ts:107`), unified document application and its pre-invoke/rollback path (`src/adapters/maplibre/map-adapter.ts:1108`), and the `MapStyleApplyResult` authority states (`src/adapters/maplibre/types.ts:85`).

Verification: `rtk pnpm exec tsc -p tsconfig.test.json` and `rtk node --test .tmp/test-dist/ai-sdk/tools.test.js` passed: 4 tests, 0 failures.

## Fix round 4 — CodeGraph-only evidence
CodeGraph traced `applyStyleDocumentOrUrlToMap` from its baseline read (`src/adapters/maplibre/map-adapter.ts:1118`) through the pre-invoke authority guard (`:1183`), confirming that `UnavailableDuringApplyMap(1)` makes the document route fail before `setStyle`. It also traced `guardBaselineBeforeInvoke` authority outcomes and `rollbackAfterFailure`, which records rollback failure after a mutation-started candidate failure. The unified matrix tests now assert direct transaction and document drift, unavailable-before-invoke, and candidate/rollback failure paths with deterministic read and `setStyle` event counts; failure results carry authentic rollback details and contain no success `data`.
