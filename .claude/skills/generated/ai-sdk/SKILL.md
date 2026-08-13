---
name: ai-sdk
description: "Skill for the Ai-sdk area of maplibre-style-tools. 108 symbols across 16 files."
---

# Ai-sdk

108 symbols | 16 files | Cohesion: 74%

## When to Use

- Working with code in `src/`
- Understanding how createMapLibreStyleTools, state, ready work
- Modifying ai-sdk-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/ai-sdk/compact-tools.ts` | mapReadyError, failure, inspectLayer, summarizeLayerIds, decodePointer (+25) |
| `src/ai-sdk/full-tools.ts` | applicationState, failure, legacyFailure, success, readStyle (+17) |
| `src/ai-sdk/full-tools.test.ts` | FakeMap, asMap, AuthorityFailureMap, UnavailableDuringApplyMap, getMap (+10) |
| `src/ai-sdk/compact-tools.test.ts` | FakeMap, emit, install, automaticallyInstall, asMap (+5) |
| `src/ai-sdk/compatibility.ts` | safeLabel, invalidInput, validateText, snapshotParsedJson, parseStrictJson (+4) |
| `src/adapters/maplibre/types.ts` | updateGeoJsonDataRuntime, setSourceTileLodParams, listSprites, addSprite, removeSprite |
| `src/core/utf8.ts` | jsonStringByteLength, primitiveJsonByteLength, iterativeJsonByteLength, jsonUtf8ByteLength |
| `src/ai-sdk/schemas.ts` | legacyOperationsAreValid, descriptorSafeInputSchema, fullSchema |
| `src/adapters/maplibre/map-adapter.ts` | hasStyleLifecycle, createLegacyMapLifecycleFacade |
| `src/bridge/registry.ts` | asJsonObject, #validateSuccessResult |

## Entry Points

Start here when exploring this area:

- **`createMapLibreStyleTools`** (Function) — `src/ai-sdk/full-tools.ts:307`
- **`state`** (Function) — `src/ai-sdk/full-tools.ts:313`
- **`ready`** (Function) — `src/ai-sdk/full-tools.ts:315`
- **`runtimeReady`** (Function) — `src/ai-sdk/full-tools.ts:333`
- **`applyOperations`** (Function) — `src/ai-sdk/full-tools.ts:349`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `createMapLibreStyleTools` | Function | `src/ai-sdk/full-tools.ts` | 307 |
| `state` | Function | `src/ai-sdk/full-tools.ts` | 313 |
| `ready` | Function | `src/ai-sdk/full-tools.ts` | 315 |
| `runtimeReady` | Function | `src/ai-sdk/full-tools.ts` | 333 |
| `applyOperations` | Function | `src/ai-sdk/full-tools.ts` | 349 |
| `runRuntime` | Function | `src/ai-sdk/full-tools.ts` | 375 |
| `register` | Function | `src/ai-sdk/full-tools.ts` | 393 |
| `execute` | Function | `src/ai-sdk/full-tools.ts` | 402 |
| `createLegacyMapLifecycleFacade` | Function | `src/adapters/maplibre/map-adapter.ts` | 764 |
| `execute` | Function | `src/ai-sdk/compact-tools.ts` | 628 |
| `toAiToolResult` | Function | `src/ai-sdk/result.ts` | 19 |
| `jsonUtf8ByteLength` | Function | `src/core/utf8.ts` | 137 |
| `createCompactMapLibreStyleTools` | Function | `src/ai-sdk/compact-tools.ts` | 592 |
| `state` | Function | `src/ai-sdk/compact-tools.ts` | 597 |
| `runStructuredTransaction` | Function | `src/ai-sdk/compact-tools.ts` | 599 |
| `parseStrictJson` | Function | `src/ai-sdk/compatibility.ts` | 44 |
| `parseJsonOrRawString` | Function | `src/ai-sdk/compatibility.ts` | 55 |
| `diffStyleDocuments` | Function | `src/core/diff.ts` | 418 |
| `normalizeLegacyOperations` | Function | `src/ai-sdk/compatibility.ts` | 102 |
| `updateGeoJsonDataRuntime` | Method | `src/adapters/maplibre/types.ts` | 251 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `ApplyStyleDocumentOrUrlToMap → JsonStringByteLength` | cross_community | 8 |
| `ReconcileResult → JsonStringByteLength` | cross_community | 8 |
| `PrepareTransactionForMap → JsonStringByteLength` | cross_community | 8 |
| `Ready → JsonStringByteLength` | cross_community | 8 |
| `InstallStyle → JsonStringByteLength` | cross_community | 7 |
| `#validateSnapshot → JsonStringByteLength` | cross_community | 7 |
| `Observe → Utf8ByteLength` | cross_community | 7 |
| `Execute → CreateStyleToolError` | cross_community | 6 |
| `Execute → ReadPositiveSafeIntegerOption` | cross_community | 6 |
| `Execute → Utf8ByteLength` | cross_community | 6 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Bridge | 17 calls |
| Maplibre | 16 calls |
| Operations | 4 calls |
| Mcp | 2 calls |
| Cli | 2 calls |
| Cluster_191 | 1 calls |

## How to Explore

1. `context({name: "createMapLibreStyleTools"})` — see callers and callees
2. `query({search_query: "ai-sdk"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
