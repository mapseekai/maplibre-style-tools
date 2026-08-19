# Task 7 Cutover Report

## Changed and deleted

- Deleted legacy AI modules and tests: `compatibility`, `compact-tools`, `full-tools`, and `tool-contracts`.
- Deleted the obsolete `src/tools/compact-tools.ts` re-export and the Map adapter lifecycle facade plus its minimal-facade tests.
- Removed legacy parser/schema paths, root AI exports, and the result converter; `result.ts` is now a one-line `AiStyleToolResult` type re-export.
- Added negative type/runtime surface checks. `/ai` exports only `createMapLibreStyleTools`; root no longer exposes either AI factory.
- Updated direct filter, package smoke, and exact packed-module assertions. Retained `/core`, `/maplibre`, `/mcp`, and `/bridge` package checks and real Map lifecycle coverage.

## Red/green evidence

- Red: `rtk pnpm exec tsc -p tsconfig.test.json` failed with unused `@ts-expect-error` directives while legacy root exports still existed; `rtk node --test .tmp/test-dist/public-api-compatibility.test.js .tmp/test-dist/exports.test.js` failed because `createMapLibreStyleTools` remained on root.
- Green: `rtk pnpm exec tsc -p tsconfig.test.json` completed with exit 0.
- Green: prescribed cutover test command completed: 43 passed, 0 failed, 2 package-smoke tests intentionally skipped by their environment gate.
- Green: `rtk pnpm run check:package` completed with exit 0.

## CodeGraph evidence

- Before deletion, CodeGraph found 46 symbols across six files; it identified `createLegacyMapLifecycleFacade` as having four callers in `src/ai-sdk/compact-tools.ts`, and legacy factory/name/parser blast radius through `src/index.ts`, `src/ai-sdk/index.ts`, and legacy tests.
- Before facade deletion, the Task 7-specific CodeGraph trace showed the facade implementation and legacy AI callers; the implementation and minimal-facade tests were then removed.
- After source edits, CodeGraph returned internally inconsistent stale references to deleted files while its returned current `map-adapter.ts` source showed the facade absent. This was reported via `xd://report_issue`; the fresh TypeScript compile, runtime removal tests, and package pack check are the authoritative post-cutover validation.

## Concern

CodeGraph's post-edit reference index was stale/internally inconsistent; no product concern remains under the exercised TypeScript, runtime, and packed-package surfaces.
