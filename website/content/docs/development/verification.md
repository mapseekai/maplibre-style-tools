---
title: Verification
description: The commands that verify types, lint, tests, examples, contracts, and E2E.
weight: 30
---

Run the checks that cover what you changed:

```bash
pnpm run typecheck             # TypeScript projects and their ambient-type boundaries
pnpm run lint                  # ESLint over authored JS/TS
pnpm run test                  # compile plus the full test suite
pnpm run test:example:ai-chat  # runnable AI chat example
pnpm run test:example:bridge   # runnable bridge example
pnpm run test:example:webmcp   # runnable WebMCP example
pnpm run check:package         # build output and package contracts, incl. declaration closure
pnpm run verify:e2e            # browser bridge and WebMCP end-to-end suites
```

## Website checks

Documentation changes must leave the site building warning-free:

```bash
cd website
go mod verify
hugo --cleanDestinationDir --gc --minify --environment production --printPathWarnings --panicOnWarning
```

Hugo warnings are treated as failures on purpose: navigation and links have to stay intact.
