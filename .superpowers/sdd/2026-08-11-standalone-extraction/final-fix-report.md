# Final Packaging Cleanup Fix Report

## Status

Complete. The package build now removes the complete distributable output before compilation, preventing removed or renamed source files from surviving into the `dist`-only tarball.

## Changes

- Added a cross-platform `clean` script that uses Node built-in `fs.rmSync` to recursively remove `dist/` and remove only `.tmp/tsconfig.build.tsbuildinfo`.
- Changed `prebuild` to `pnpm run clean`; kept `build` as `tsc -b tsconfig.build.json` and `prepack` as `pnpm run build`.
- Updated the README, design specification, and implementation plan to describe explicit stale-output removal and its regression checks.

## Commands and Results

| Command | Result |
| --- | --- |
| `node --input-type=module --eval "...writeFileSync('dist/stale.js', ...)"; pnpm run build` before this change | Reproduced the defect: the old `tsc -b tsconfig.build.json --clean` prebuild left `dist/stale.js` present. |
| `node --input-type=module --eval "...writeFileSync('dist/stale.js', ...)"; pnpm run build` after this change | Passed: `dist/stale.js` was absent after the build. |
| `node --input-type=module --eval "...writeFileSync('dist/stale.js', ...)"; npm pack --dry-run --json` | Passed: lifecycle output showed `pnpm run clean` before `tsc`; `dist/stale.js` was absent afterward. |
| `pnpm install --frozen-lockfile` | Passed (exit 0; lockfile unchanged). |
| `pnpm run lint` | Passed (exit 0). |
| `pnpm run typecheck` | Passed (exit 0). |
| `pnpm test` | Passed: 4 tests passed, 0 failed. |
| `node --input-type=module --eval "...import('./dist/index.js')"` | Passed: both public factory exports are functions. |
| `git diff --quiet -- src` | Passed (exit 0). |
| `git diff --check` | Passed (exit 0). |
| GitNexus `detect_changes({ scope: 'all' })` | Not available: this standalone repository is not in the configured GitNexus index. The Git checks above cover the changed-file and whitespace scope. |

The first sandboxed `pnpm test` invocation was blocked while deleting ignored `.tmp/test-dist` output (`EPERM`); the identical command outside that sandbox passed. This matches the earlier sandbox restriction on writing ignored build artifacts and is not a package failure.

## Stale-Output and Pack Regression

The initial red check deliberately created `dist/stale.js`, ran the old build, and confirmed that the sentinel remained. The green check repeated the sentinel setup after the change, ran `pnpm run build`, and confirmed it was removed.

For packaging, a fresh `dist/stale.js` was created before `npm pack --dry-run --json`. The prepack lifecycle ran the new clean and build, removed the sentinel from disk, and produced a 22-file manifest containing only `README.md`, `package.json`, and current `dist/**` artifacts. The JSON contained neither `dist/stale.js` nor `src/**` files.

## Self-Review

- The cleanup has no new dependency and is cross-platform because Node executes the removal.
- It deletes only the complete production output tree and the exact production build-info file; test output remains managed by its existing `pretest` hook.
- `prepack` still calls `build`, which invokes `prebuild` automatically; no shell `&&` chain is used.
- No `src/**` file or lockfile was changed.

## Commit

`fix: clean build output before packaging` (this report is included in that commit).

## Concerns

None for the package. Local sandbox restrictions can prevent deletion of ignored generated files; the requested build, test, and pack checks passed outside that restriction.
