---
name: cluster-246
description: "Skill for the Cluster_246 area of maplibre-style-tools. 25 symbols across 1 files."
---

# Cluster_246

25 symbols | 1 files | Cohesion: 69%

## When to Use

- Working with code in `src/`
- Understanding how setLayerFilterOperationSchema, setGeoJsonSourceFilterOperationSchema work
- Modifying cluster_246-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/schemas.ts` | ownValue, isJsonObject, hasOnlyKeys, validZoom, fallbackStyleDocument (+20) |

## Entry Points

Start here when exploring this area:

- **`setLayerFilterOperationSchema`** (Function) — `src/core/schemas.ts:1827`
- **`setGeoJsonSourceFilterOperationSchema`** (Function) — `src/core/schemas.ts:1847`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `setLayerFilterOperationSchema` | Function | `src/core/schemas.ts` | 1827 |
| `setGeoJsonSourceFilterOperationSchema` | Function | `src/core/schemas.ts` | 1847 |
| `ownValue` | Function | `src/core/schemas.ts` | 282 |
| `isJsonObject` | Function | `src/core/schemas.ts` | 286 |
| `hasOnlyKeys` | Function | `src/core/schemas.ts` | 290 |
| `validZoom` | Function | `src/core/schemas.ts` | 294 |
| `fallbackStyleDocument` | Function | `src/core/schemas.ts` | 299 |
| `fallbackStyleDocumentIssue` | Function | `src/core/schemas.ts` | 319 |
| `fallbackSetLayerOperation` | Function | `src/core/schemas.ts` | 422 |
| `fallbackRootOperation` | Function | `src/core/schemas.ts` | 440 |
| `fallbackFilterOperation` | Function | `src/core/schemas.ts` | 449 |
| `optionalObjectIssue` | Function | `src/core/schemas.ts` | 723 |
| `optionalZoomIssue` | Function | `src/core/schemas.ts` | 733 |
| `geoJsonLayerTypeIssue` | Function | `src/core/schemas.ts` | 797 |
| `fallbackAddGeoJsonLayerIssue` | Function | `src/core/schemas.ts` | 828 |
| `fallbackAddGeoJsonLayerFirstIssue` | Function | `src/core/schemas.ts` | 929 |
| `fallbackOperation` | Function | `src/core/schemas.ts` | 1117 |
| `fallbackSetLayerOperationIssue` | Function | `src/core/schemas.ts` | 1127 |
| `fallbackOperationIssue` | Function | `src/core/schemas.ts` | 1147 |
| `fallbackOperationIssues` | Function | `src/core/schemas.ts` | 1187 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `FallbackAddGeoJsonLayerFirstIssue → AppendOwn` | cross_community | 5 |
| `FallbackAddGeoJsonLayerFirstIssue → MaterializePath` | cross_community | 5 |
| `FallbackAddGeoJsonLayerFirstIssue → IsJsonObject` | cross_community | 5 |
| `FallbackAddGeoJsonLayerFirstIssue → ReceivedType` | cross_community | 4 |
| `FallbackAddGeoJsonLayerFirstIssue → OwnValue` | cross_community | 4 |
| `FallbackTransactionIssue → IsJsonObject` | intra_community | 4 |
| `FallbackTransactionIssue → HasOnlyKeys` | intra_community | 4 |
| `FallbackTransactionIssue → OwnValue` | intra_community | 4 |
| `FallbackTransactionIssue → ValidZoom` | intra_community | 4 |
| `FallbackAddGeoJsonLayerFirstIssue → ValidLayerLifecycleId` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_250 | 14 calls |
| Cluster_243 | 3 calls |
| Cluster_249 | 2 calls |
| Cluster_248 | 1 calls |
| Cluster_247 | 1 calls |

## How to Explore

1. `context({name: "setLayerFilterOperationSchema"})` — see callers and callees
2. `query({search_query: "cluster_246"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
