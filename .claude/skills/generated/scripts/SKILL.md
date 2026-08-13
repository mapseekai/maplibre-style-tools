---
name: scripts
description: "Skill for the Scripts area of maplibre-style-tools. 22 symbols across 2 files."
---

# Scripts

22 symbols | 2 files | Cohesion: 88%

## When to Use

- Working with code in `scripts/`
- Understanding how forbiddenProjectPathReason, assertMcpTypeGraphFiles, runMcpTypegraphCheck work
- Modifying scripts-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `scripts/check-package.mjs` | source, declarationSpecifier, assertCoreDeclarationIsTransportNeutral, visit, assertCoreDeclarationsAreTransportNeutral (+8) |
| `scripts/check-mcp-typegraph.mjs` | normalize, relativeToRoot, sourceFilesBelow, staticModuleSpecifier, checkApprovedSdkSpecifiers (+4) |

## Entry Points

Start here when exploring this area:

- **`forbiddenProjectPathReason`** (Function) — `scripts/check-mcp-typegraph.mjs:90`
- **`assertMcpTypeGraphFiles`** (Function) — `scripts/check-mcp-typegraph.mjs:122`
- **`runMcpTypegraphCheck`** (Function) — `scripts/check-mcp-typegraph.mjs:137`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `forbiddenProjectPathReason` | Function | `scripts/check-mcp-typegraph.mjs` | 90 |
| `assertMcpTypeGraphFiles` | Function | `scripts/check-mcp-typegraph.mjs` | 122 |
| `runMcpTypegraphCheck` | Function | `scripts/check-mcp-typegraph.mjs` | 137 |
| `normalize` | Function | `scripts/check-mcp-typegraph.mjs` | 11 |
| `relativeToRoot` | Function | `scripts/check-mcp-typegraph.mjs` | 12 |
| `sourceFilesBelow` | Function | `scripts/check-mcp-typegraph.mjs` | 25 |
| `staticModuleSpecifier` | Function | `scripts/check-mcp-typegraph.mjs` | 32 |
| `checkApprovedSdkSpecifiers` | Function | `scripts/check-mcp-typegraph.mjs` | 56 |
| `visit` | Function | `scripts/check-mcp-typegraph.mjs` | 65 |
| `source` | Function | `scripts/check-package.mjs` | 28 |
| `declarationSpecifier` | Function | `scripts/check-package.mjs` | 162 |
| `assertCoreDeclarationIsTransportNeutral` | Function | `scripts/check-package.mjs` | 186 |
| `visit` | Function | `scripts/check-package.mjs` | 197 |
| `assertCoreDeclarationsAreTransportNeutral` | Function | `scripts/check-package.mjs` | 214 |
| `assertMapLibreDeclarationIsNodeFree` | Function | `scripts/check-package.mjs` | 222 |
| `assertMapLibreDeclarationsAreNodeFree` | Function | `scripts/check-package.mjs` | 244 |
| `assertion` | Function | `scripts/check-package.mjs` | 27 |
| `isInside` | Function | `scripts/check-package.mjs` | 46 |
| `assertBrowserClosure` | Function | `scripts/check-package.mjs` | 51 |
| `visitFile` | Function | `scripts/check-package.mjs` | 62 |

## How to Explore

1. `context({name: "forbiddenProjectPathReason"})` — see callers and callees
2. `query({search_query: "scripts"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
