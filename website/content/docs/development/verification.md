---
title: Verification
description: Run repository, example, E2E, module, and documentation checks.
weight: 30
---

Run the checks that cover the paths affected by a change. The repository commands cover type boundaries, lint, tests, examples, package contracts, and browser E2E flows.

## Repository checks {#repository-checks}

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run test:example:ai-chat
pnpm run test:example:bridge
pnpm run test:example:webmcp
pnpm run check:package
pnpm run verify:e2e
```

- `pnpm run typecheck` verifies the TypeScript projects and their ambient-type boundaries.
- `pnpm run lint` checks repository source and documentation formatting rules.
- `pnpm run test` compiles and runs the repository test suite.
- `pnpm run test:example:ai-chat`, `pnpm run test:example:bridge`, and `pnpm run test:example:webmcp` verify the runnable integrations.
- `pnpm run check:package` verifies build output and package contracts, including public declaration closure.
- `pnpm run verify:e2e` runs the browser bridge and WebMCP end-to-end suites.

## Website checks {#website-checks}

```bash
cd website
go mod verify
hugo --cleanDestinationDir --gc --minify --environment production --printPathWarnings --panicOnWarning
```

Run the Hugo commands when changing public documentation. Treat warnings as failures so the generated site remains navigation- and link-safe.
