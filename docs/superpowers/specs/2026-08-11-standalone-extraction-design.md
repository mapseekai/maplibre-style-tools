# Standalone MapLibre Style Tools Design

## Goal

Extract `packages/maplibre-style-tools` from `ai-style-editor` into a standalone, buildable, testable Git project at `/Users/zhang/code/maplibre-style-tools`, while leaving the original workspace package and its consumer unchanged.

## Approved Scope

- Preserve the package's existing Git history with a subtree split.
- Preserve all eight tracked package files, both public factories, all existing types, and all existing tests.
- Name both the new project and its npm package `maplibre-style-tools`.
- Keep the implementation source and public runtime behavior unchanged during extraction.
- Add standalone build, type-check, lint, test, packaging, documentation, ignore, and lockfile configuration.
- Do not modify `/Users/zhang/code/ai-style-editor`.
- Do not publish the package or add a remote repository.
- Do not add a license without an explicit license choice.

## Repository Extraction

Create the repository from a temporary clone of `ai-style-editor` and run a subtree split for `packages/maplibre-style-tools`. This rewrites the package directory as the repository root while retaining the commits that affected it. Rename the extracted branch to `main` and remove the temporary clone remote so the finished repository has no invalid origin.

The source monorepo remains byte-for-byte unchanged. Its existing workspace package continues to satisfy the single runtime consumer in `src/ChatInterface.tsx`.

## Project Structure

```text
maplibre-style-tools/
├── docs/superpowers/
│   ├── plans/
│   └── specs/
├── src/
│   ├── engine/
│   │   ├── style-context.test.ts
│   │   ├── style-context.ts
│   │   ├── style-operations.test.ts
│   │   └── style-operations.ts
│   ├── tools/
│   │   └── compact-tools.ts
│   ├── index.ts
│   └── types.ts
├── .gitignore
├── eslint.config.js
├── package.json
├── pnpm-lock.yaml
├── README.md
├── tsconfig.build.json
├── tsconfig.json
└── tsconfig.test.json
```

Generated `dist/`, `.tmp/`, `node_modules/`, and TypeScript build-info files are ignored and excluded from Git.

## Package Contract

The package remains ESM with `"type": "module"`. `package.json` exposes only the root entry point and points consumers at generated artifacts:

- JavaScript: `dist/index.js`
- Type declarations: `dist/index.d.ts`
- Published files: `dist/**` plus normal npm metadata such as `README.md` and `package.json`

The root module continues to export `createMapLibreStyleTools`, `createCompactMapLibreStyleTools`, and the currently exported public types. Internal engine functions and compact factory option types are not newly exposed, because extraction must not broaden or alter the public API.

## Dependencies

Retain these runtime dependencies at their existing compatible ranges:

- `@maplibre/maplibre-gl-style-spec`
- `ai`
- `zod`

Retain `maplibre-gl` as a peer dependency because consumers supply the map runtime. Also add it as a development dependency so standalone type generation does not depend on peer auto-install behavior.

Development dependencies provide TypeScript 5.9, Node types, ESLint, and TypeScript ESLint. The project pins its pnpm version through `packageManager` and generates a repository-local lockfile.

## Build and Type Checking

TypeScript uses `NodeNext` module and module resolution, matching the package's existing ESM `.js` relative import specifiers. Production compilation reads `src/`, excludes `*.test.ts`, writes JavaScript and declarations to `dist/`, and emits source maps and declaration maps.

`typecheck` performs strict no-emit checking. The cross-platform `clean` script uses Node's built-in `fs.rmSync` to remove all of `dist/` and the exact production TypeScript build-info file `.tmp/tsconfig.build.tsbuildinfo`. `prebuild` invokes `clean`, then `build` produces the distributable package. `prepack` invokes `build` (and therefore `prebuild`) so an npm tarball cannot contain stale artifacts, including outputs for removed or renamed source files.

## Testing and Linting

Continue using Node's built-in test runner. A dedicated test tsconfig compiles source and test files to `.tmp/test-dist`; the test script executes the two compiled engine test files. No new test framework is introduced.

The ESLint flat configuration applies only JavaScript and TypeScript library rules. React Hooks, React Refresh, Vite, Tailwind, and browser-application configuration are intentionally omitted.

The extraction is accepted only when all of the following pass:

1. dependency installation from the generated lockfile;
2. lint;
3. strict type checking;
4. production build and declaration generation;
5. existing unit tests;
6. a stale-output regression check showing that `pnpm run build` and `npm pack --dry-run --json` remove a deliberately created `dist/stale.js`, while the package listing contains `dist` entry points and no source-only or stale package entry;
7. a clean Git worktree after the intended project commit.

## Documentation

The standalone README describes installation, the full and compact factory entry points, peer requirements, development commands, and the fact that the package is currently unpublished. Examples import from `maplibre-style-tools`, matching the approved package name.

No repository URL, npm publication claim, or license identifier is invented.

## Known Risks and Mitigations

- The original package and standalone package use different npm names. The monorepo remains untouched, so this causes no immediate breakage; a later consumer migration must update imports deliberately.
- Generated declarations for the two inferred factory return types may be large. Build verification and tarball inspection must confirm that TypeScript emits valid, resolvable declarations.
- The existing four tests cover only the pure engine helpers. This extraction preserves them but does not claim comprehensive behavioral coverage of the 53 full tools or five compact tools.
- The current implementation contains duplicated validation behavior between full and compact tool paths. Refactoring that duplication is explicitly outside this extraction.

## Out of Scope

- Removing the workspace package from `ai-style-editor`.
- Switching the application consumer to the standalone package.
- Publishing to npm, creating a Git hosting repository, or configuring CI.
- Changing tool schemas, validation behavior, error messages, exports, or source implementation.
- Adding tests for previously untested behavior.
