---
name: cluster-243
description: "Skill for the Cluster_243 area of maplibre-style-tools. 15 symbols across 1 files."
---

# Cluster_243

15 symbols | 1 files | Cohesion: 77%

## When to Use

- Working with code in `src/`
- Understanding how appendOwn, oneItem, issueItems work
- Modifying cluster_243-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/schemas.ts` | appendOwn, oneItem, issueItems, childPath, geoJsonIssue (+10) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `appendOwn` | Function | `src/core/schemas.ts` | 67 |
| `oneItem` | Function | `src/core/schemas.ts` | 76 |
| `issueItems` | Function | `src/core/schemas.ts` | 82 |
| `childPath` | Function | `src/core/schemas.ts` | 112 |
| `geoJsonIssue` | Function | `src/core/schemas.ts` | 1402 |
| `validateBbox` | Function | `src/core/schemas.ts` | 1409 |
| `pushStructuralObject` | Function | `src/core/schemas.ts` | 1428 |
| `pushCoordinates` | Function | `src/core/schemas.ts` | 1437 |
| `pushArrayCoordinateChildren` | Function | `src/core/schemas.ts` | 1446 |
| `checkCoordinateWork` | Function | `src/core/schemas.ts` | 1457 |
| `checkFeatureObject` | Function | `src/core/schemas.ts` | 1499 |
| `checkFeatureCollectionObject` | Function | `src/core/schemas.ts` | 1532 |
| `checkGeometryObject` | Function | `src/core/schemas.ts` | 1555 |
| `inlineGeoJsonIssue` | Function | `src/core/schemas.ts` | 1596 |
| `fallbackGeoJsonAnalysisInput` | Function | `src/core/schemas.ts` | 1701 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `FallbackAddGeoJsonLayerFirstIssue → AppendOwn` | cross_community | 5 |
| `FallbackAddGeoJsonLayerFirstIssue → MaterializePath` | cross_community | 5 |
| `FallbackAddGeoJsonLayerFirstIssue → IsJsonObject` | cross_community | 5 |
| `FallbackAddGeoJsonLayerFirstIssue → OwnValue` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_246 | 9 calls |
| Cluster_245 | 1 calls |
| Operations | 1 calls |

## How to Explore

1. `context({name: "appendOwn"})` — see callers and callees
2. `query({search_query: "cluster_243"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
