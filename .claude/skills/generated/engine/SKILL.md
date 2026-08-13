---
name: engine
description: "Skill for the Engine area of maplibre-style-tools. 13 symbols across 1 files."
---

# Engine

13 symbols | 1 files | Cohesion: 79%

## When to Use

- Working with code in `src/`
- Understanding how applyStyleOperations work
- Modifying engine-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/engine/style-operations.ts` | legacyPropertyValidationMessage, toCoreOperation, toCoreFilterOperation, toCoreOperations, orderDiffSummary (+8) |

## Entry Points

Start here when exploring this area:

- **`applyStyleOperations`** (Function) — `src/engine/style-operations.ts:308`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `applyStyleOperations` | Function | `src/engine/style-operations.ts` | 308 |
| `legacyPropertyValidationMessage` | Function | `src/engine/style-operations.ts` | 25 |
| `toCoreOperation` | Function | `src/engine/style-operations.ts` | 79 |
| `toCoreFilterOperation` | Function | `src/engine/style-operations.ts` | 98 |
| `toCoreOperations` | Function | `src/engine/style-operations.ts` | 115 |
| `orderDiffSummary` | Function | `src/engine/style-operations.ts` | 194 |
| `failure` | Function | `src/engine/style-operations.ts` | 239 |
| `historyContext` | Function | `src/engine/style-operations.ts` | 258 |
| `reconstructLegacyOperationHistory` | Function | `src/engine/style-operations.ts` | 265 |
| `decodePointer` | Function | `src/engine/style-operations.ts` | 133 |
| `isObject` | Function | `src/engine/style-operations.ts` | 138 |
| `expandContainerDiff` | Function | `src/engine/style-operations.ts` | 141 |
| `toLegacyCoreDiff` | Function | `src/engine/style-operations.ts` | 158 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Operations | 2 calls |
| Ai-sdk | 1 calls |
| Maplibre | 1 calls |

## How to Explore

1. `context({name: "applyStyleOperations"})` — see callers and callees
2. `query({search_query: "engine"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
