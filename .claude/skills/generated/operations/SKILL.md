---
name: operations
description: "Skill for the Operations area of maplibre-style-tools. 94 symbols across 13 files."
---

# Operations

94 symbols | 13 files | Cohesion: 74%

## When to Use

- Working with code in `src/`
- Understanding how applyLayerOperation, resolveInsertionIndex, jsonValuesEqual work
- Modifying operations-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/operations/layers.ts` | layerNotFound, layerCollision, invalidInput, placementPath, placementError (+15) |
| `src/core/operations/sources.ts` | notFound, collision, invalidSourceId, defineSource, cloneAndPatchSource (+9) |
| `src/core/diff.ts` | jsonValuesEqual, isJsonObject, cloneContainer, cloneJsonValue, decodePointer (+6) |
| `src/core/operations/compatibility.ts` | applyValidatedCompatibilityEdit, isJsonObject, defineValue, deepMergeDefinition, defineSource (+5) |
| `src/core/operations/layers.test.ts` | assertAtomicFailure, assertReplay, issues, assertMatrix, firstIssue (+4) |
| `src/core/transaction.ts` | failureResult, issueDetails, schemaError, finalChangedIds, finalizeValidatedStyle (+3) |
| `src/core/operations/filters.ts` | applyFilter, applySetLayerFilter, applySetGeoJsonSourceFilter, classifyChildren, classifyFilter (+2) |
| `src/core/operations/shared.ts` | resolveInsertionIndex, cloneStrictJsonValue, isJsonObject, strictJsonSnapshot, applySanitizedMergePatch (+1) |
| `src/core/schemas.ts` | createSafeBoundary, sanitizeBefore, createStyleTransactionSchema |
| `src/core/operations/sources.test.ts` | assertAtomicFailure, assertReplay |

## Entry Points

Start here when exploring this area:

- **`applyLayerOperation`** (Function) — `src/core/operations/layers.ts:494`
- **`resolveInsertionIndex`** (Function) — `src/core/operations/shared.ts:68`
- **`jsonValuesEqual`** (Function) — `src/core/diff.ts:91`
- **`applySourceOperation`** (Function) — `src/core/operations/sources.ts:252`
- **`applyValidatedCompatibilityEdit`** (Function) — `src/core/operations/compatibility.ts:210`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `applyLayerOperation` | Function | `src/core/operations/layers.ts` | 494 |
| `resolveInsertionIndex` | Function | `src/core/operations/shared.ts` | 68 |
| `jsonValuesEqual` | Function | `src/core/diff.ts` | 91 |
| `applySourceOperation` | Function | `src/core/operations/sources.ts` | 252 |
| `applyValidatedCompatibilityEdit` | Function | `src/core/operations/compatibility.ts` | 210 |
| `createStyleTransactionSchema` | Function | `src/core/schemas.ts` | 2254 |
| `applyStyleTransaction` | Function | `src/core/transaction.ts` | 401 |
| `replayStyleDiff` | Function | `src/core/diff.ts` | 504 |
| `applyCompatibilityStyleOperation` | Function | `src/core/operations/compatibility.ts` | 145 |
| `cloneStrictJsonValue` | Function | `src/core/operations/shared.ts` | 9 |
| `applyRootOperation` | Function | `src/core/operations/root.ts` | 12 |
| `applyMergePatch` | Function | `src/core/operations/shared.ts` | 60 |
| `applySetLayerFilter` | Function | `src/core/operations/filters.ts` | 132 |
| `applySetGeoJsonSourceFilter` | Function | `src/core/operations/filters.ts` | 155 |
| `composeFilter` | Function | `src/core/operations/filters.ts` | 64 |
| `applySetLayerProperties` | Function | `src/core/operations/layers.ts` | 558 |
| `layerNotFound` | Function | `src/core/operations/layers.ts` | 31 |
| `layerCollision` | Function | `src/core/operations/layers.ts` | 46 |
| `invalidInput` | Function | `src/core/operations/layers.ts` | 58 |
| `placementPath` | Function | `src/core/operations/layers.ts` | 69 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `FallbackAddGeoJsonLayerFirstIssue → IsJsonObject` | cross_community | 5 |
| `ApplyOperation → CreateStyleToolError` | cross_community | 5 |
| `ApplyCompatibilityStyleOperation → CreateStyleToolError` | cross_community | 4 |
| `ApplyOperation → CloneStrictJsonValue` | cross_community | 4 |
| `ApplyOperation → IsJsonObject` | cross_community | 4 |
| `ApplyOperation → IsJsonObject` | cross_community | 4 |
| `ApplyLayerOperation → CreateStyleToolError` | cross_community | 4 |
| `ApplyLayerOperation → PlacementPath` | intra_community | 4 |
| `ApplySourceOperation → CreateStyleToolError` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Bridge | 29 calls |
| Maplibre | 2 calls |
| Ai-sdk | 2 calls |
| Cluster_202 | 2 calls |
| Cluster_246 | 1 calls |

## How to Explore

1. `context({name: "applyLayerOperation"})` — see callers and callees
2. `query({search_query: "operations"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
