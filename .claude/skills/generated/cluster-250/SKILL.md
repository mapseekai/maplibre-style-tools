---
name: cluster-250
description: "Skill for the Cluster_250 area of maplibre-style-tools. 12 symbols across 1 files."
---

# Cluster_250

12 symbols | 1 files | Cohesion: 54%

## When to Use

- Working with code in `src/`
- Understanding how nonEmptyStringIssue, receivedType, invalidTypeIssue work
- Modifying cluster_250-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/schemas.ts` | nonEmptyStringIssue, receivedType, invalidTypeIssue, minLengthStringIssue, requiredMinLengthStringIssue (+7) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `nonEmptyStringIssue` | Function | `src/core/schemas.ts` | 640 |
| `receivedType` | Function | `src/core/schemas.ts` | 644 |
| `invalidTypeIssue` | Function | `src/core/schemas.ts` | 651 |
| `minLengthStringIssue` | Function | `src/core/schemas.ts` | 671 |
| `requiredMinLengthStringIssue` | Function | `src/core/schemas.ts` | 678 |
| `unrecognizedKeysIssue` | Function | `src/core/schemas.ts` | 687 |
| `requiredNonEmptyStringIssue` | Function | `src/core/schemas.ts` | 704 |
| `optionalNonEmptyStringIssue` | Function | `src/core/schemas.ts` | 713 |
| `fallbackAddLayerFromSourceIssue` | Function | `src/core/schemas.ts` | 755 |
| `fallbackGeoJsonLayerDataIssue` | Function | `src/core/schemas.ts` | 807 |
| `fallbackSourceOperationIssue` | Function | `src/core/schemas.ts` | 1043 |
| `fallbackFilterOperationIssue` | Function | `src/core/schemas.ts` | 1092 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `FallbackAddGeoJsonLayerFirstIssue → AppendOwn` | cross_community | 5 |
| `FallbackAddGeoJsonLayerFirstIssue → MaterializePath` | cross_community | 5 |
| `FallbackAddGeoJsonLayerFirstIssue → IsJsonObject` | cross_community | 5 |
| `FallbackAddGeoJsonLayerFirstIssue → ReceivedType` | cross_community | 4 |
| `FallbackAddGeoJsonLayerFirstIssue → OwnValue` | cross_community | 4 |
| `FallbackAddGeoJsonLayerFirstIssue → ValidLayerLifecycleId` | cross_community | 3 |
| `FallbackAddGeoJsonLayerFirstIssue → NonEmptyStringIssue` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_246 | 10 calls |
| Cluster_249 | 2 calls |
| Cluster_243 | 1 calls |

## How to Explore

1. `context({name: "nonEmptyStringIssue"})` — see callers and callees
2. `query({search_query: "cluster_250"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
