---
name: maplibre
description: "Skill for the Maplibre area of maplibre-style-tools. 207 symbols across 20 files."
---

# Maplibre

207 symbols | 20 files | Cohesion: 84%

## When to Use

- Working with code in `src/`
- Understanding how toMapLibreStyleSpecification, emit, installStyle work
- Modifying maplibre-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/adapters/maplibre/runtime-commands.ts` | parseInput, normalizeFailure, rollbackFailure, failure, acknowledgement (+47) |
| `src/adapters/maplibre/map-adapter.ts` | MapWaitFailure, clonePreparedJson, deepFreeze, frozenJson, cloneSuccessResult (+37) |
| `src/adapters/maplibre/geojson-diff.ts` | hasNonNullGeometry, decodePointerSegments, decodePointer, invalidInput, prefixedValidationError (+14) |
| `src/adapters/maplibre/runtime-commands.test.ts` | record, getSource, setSourceTileLodParams, setFeatureState, removeFeatureState (+10) |
| `src/core/diff.ts` | appendPath, pathFromTokens, tokensFromPath, requireCandidate, targetForPath (+9) |
| `src/adapters/maplibre/feature-query.ts` | schemaError, parseSourceQuery, parseRenderedQuery, ownDataValue, defineJsonValue (+8) |
| `src/adapters/maplibre/map-adapter.test.ts` | rawStyle, strictStyle, styleColor, isDeeplyFrozen, hashStyle (+8) |
| `src/adapters/maplibre/schemas.ts` | descriptorSanitized, featureProjectionSchema, createSourceFeatureQueryInputSchema, createRenderedFeatureQueryInputSchema, parseBoundedSourceFeatureQueryInput (+3) |
| `src/adapters/maplibre/types.ts` | setFeatureState, removeFeatureState, setGlobalState, listImages, addImageData (+2) |
| `src/adapters/maplibre/feature-query.test.ts` | FakeMap, asMap, rawFeature, rejectedResults, exactShapeFeature (+1) |

## Entry Points

Start here when exploring this area:

- **`toMapLibreStyleSpecification`** (Function) — `src/adapters/maplibre/map-adapter.ts:749`
- **`emit`** (Function) — `src/adapters/maplibre/map-adapter.ts:769`
- **`installStyle`** (Function) — `src/adapters/maplibre/map-adapter.ts:786`
- **`prepareTransactionForMap`** (Function) — `src/adapters/maplibre/map-adapter.ts:826`
- **`applyPreparedStyleToMap`** (Function) — `src/adapters/maplibre/map-adapter.ts:927`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `toMapLibreStyleSpecification` | Function | `src/adapters/maplibre/map-adapter.ts` | 749 |
| `emit` | Function | `src/adapters/maplibre/map-adapter.ts` | 769 |
| `installStyle` | Function | `src/adapters/maplibre/map-adapter.ts` | 786 |
| `prepareTransactionForMap` | Function | `src/adapters/maplibre/map-adapter.ts` | 826 |
| `applyPreparedStyleToMap` | Function | `src/adapters/maplibre/map-adapter.ts` | 927 |
| `applyTransactionToMap` | Function | `src/adapters/maplibre/map-adapter.ts` | 1083 |
| `applyStyleDocumentOrUrlToMap` | Function | `src/adapters/maplibre/map-adapter.ts` | 1107 |
| `canonicalizeJson` | Function | `src/core/canonical-json.ts` | 58 |
| `finalizeStyleReplacement` | Function | `src/core/transaction.ts` | 480 |
| `validateStyleDocument` | Function | `src/core/validation.ts` | 251 |
| `escapeJsonPointerToken` | Function | `src/core/json-pointer.ts` | 0 |
| `toJsonPointer` | Function | `src/core/json-pointer.ts` | 4 |
| `loading` | Function | `src/adapters/maplibre/runtime-commands.ts` | 767 |
| `sanitizeRuntimeGeoJsonSourceDiff` | Function | `src/adapters/maplibre/geojson-diff.ts` | 475 |
| `executeQueued` | Function | `src/bridge/browser-runtime.ts` | 637 |
| `parseBoundedSourceFeatureQueryInput` | Function | `src/adapters/maplibre/schemas.ts` | 285 |
| `parseBoundedRenderedFeatureQueryInput` | Function | `src/adapters/maplibre/schemas.ts` | 292 |
| `querySourceFeaturesBounded` | Function | `src/adapters/maplibre/feature-query.ts` | 270 |
| `queryRenderedFeaturesBounded` | Function | `src/adapters/maplibre/feature-query.ts` | 287 |
| `runtimeGeoJsonSourceDiffSchema` | Function | `src/adapters/maplibre/geojson-diff.ts` | 437 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `ApplyStyleDocumentOrUrlToMap → JsonStringByteLength` | cross_community | 8 |
| `ReconcileResult → JsonStringByteLength` | cross_community | 8 |
| `PrepareTransactionForMap → JsonStringByteLength` | cross_community | 8 |
| `Ready → JsonStringByteLength` | cross_community | 8 |
| `InstallStyle → JsonStringByteLength` | cross_community | 7 |
| `#validateSnapshot → JsonStringByteLength` | cross_community | 7 |
| `Observe → CreateStyleToolError` | cross_community | 7 |
| `Observe → ReadPositiveSafeIntegerOption` | cross_community | 7 |
| `Observe → Utf8ByteLength` | cross_community | 7 |
| `Execute → CreateStyleToolError` | cross_community | 6 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Bridge | 44 calls |
| Operations | 5 calls |
| Ai-sdk | 3 calls |
| Cluster_202 | 2 calls |
| Cluster_258 | 1 calls |

## How to Explore

1. `context({name: "toMapLibreStyleSpecification"})` — see callers and callees
2. `query({search_query: "maplibre"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
