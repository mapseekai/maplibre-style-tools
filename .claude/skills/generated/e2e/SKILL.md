---
name: e2e
description: "Skill for the E2e area of maplibre-style-tools. 35 symbols across 1 files."
---

# E2e

35 symbols | 1 files | Cohesion: 92%

## When to Use

- Working with code in `examples/`
- Understanding how spawnPreviewHelpWithOnlyNodeAndPnpmOnPath, harnessFactory, parseHarnessCallResult work
- Modifying e2e-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `examples/browser-bridge/e2e/mcp-harness.ts` | delay, childIsActive, pidIsActive, waitForPidExit, stopChild (+30) |

## Entry Points

Start here when exploring this area:

- **`spawnPreviewHelpWithOnlyNodeAndPnpmOnPath`** (Function) — `examples/browser-bridge/e2e/mcp-harness.ts:447`
- **`harnessFactory`** (Function) — `examples/browser-bridge/e2e/mcp-harness.ts:545`
- **`parseHarnessCallResult`** (Function) — `examples/browser-bridge/e2e/mcp-harness.ts:70`
- **`page`** (Function) — `examples/browser-bridge/e2e/mcp-harness.ts:544`
- **`call`** (Method) — `examples/browser-bridge/e2e/mcp-harness.ts:236`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `spawnPreviewHelpWithOnlyNodeAndPnpmOnPath` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 447 |
| `harnessFactory` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 545 |
| `parseHarnessCallResult` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 70 |
| `page` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 544 |
| `McpHarnessFactory` | Interface | `examples/browser-bridge/e2e/mcp-harness.ts` | 253 |
| `call` | Method | `examples/browser-bridge/e2e/mcp-harness.ts` | 236 |
| `HarnessTracker` | Class | `examples/browser-bridge/e2e/mcp-harness.ts` | 202 |
| `McpHarnessFactoryImpl` | Class | `examples/browser-bridge/e2e/mcp-harness.ts` | 258 |
| `delay` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 75 |
| `childIsActive` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 160 |
| `pidIsActive` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 163 |
| `waitForPidExit` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 173 |
| `stopChild` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 186 |
| `withTimeout` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 79 |
| `listenForHandoff` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 96 |
| `requireHandoffToken` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 226 |
| `resolveExecutable` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 433 |
| `dispose` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 110 |
| `settleError` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 115 |
| `parseLine` | Function | `examples/browser-bridge/e2e/mcp-harness.ts` | 121 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `HarnessFactory → CloseAll` | intra_community | 3 |

## How to Explore

1. `context({name: "spawnPreviewHelpWithOnlyNodeAndPnpmOnPath"})` — see callers and callees
2. `query({search_query: "e2e"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
