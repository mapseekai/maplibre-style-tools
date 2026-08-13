---
name: cluster-201
description: "Skill for the Cluster_201 area of maplibre-style-tools. 11 symbols across 1 files."
---

# Cluster_201

11 symbols | 1 files | Cohesion: 86%

## When to Use

- Working with code in `src/`
- Understanding how ownValue, appendOwn, childPath work
- Modifying cluster_201-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/geojson.ts` | ownValue, appendOwn, childPath, limitFailure, pushCoordinateChildren (+6) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `ownValue` | Function | `src/core/geojson.ts` | 77 |
| `appendOwn` | Function | `src/core/geojson.ts` | 81 |
| `childPath` | Function | `src/core/geojson.ts` | 90 |
| `limitFailure` | Function | `src/core/geojson.ts` | 124 |
| `pushCoordinateChildren` | Function | `src/core/geojson.ts` | 180 |
| `walkCoordinates` | Function | `src/core/geojson.ts` | 198 |
| `pushGeometryCoordinates` | Function | `src/core/geojson.ts` | 260 |
| `walkGeometry` | Function | `src/core/geojson.ts` | 281 |
| `pushPropertyChildren` | Function | `src/core/geojson.ts` | 321 |
| `walkProperties` | Function | `src/core/geojson.ts` | 341 |
| `countGeoJson` | Function | `src/core/geojson.ts` | 370 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `RuntimeGeoJsonDiffUpdateSchema → AppendOwn` | cross_community | 6 |
| `RuntimeGeoJsonDiffUpdateSchema → ChildPath` | cross_community | 6 |
| `RuntimeGeoJsonDiffUpdateSchema → OwnValue` | cross_community | 6 |
| `InspectStyle → AppendOwn` | cross_community | 5 |
| `CountGeoJson → EscapeJsonPointerToken` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_202 | 4 calls |
| Bridge | 1 calls |
| Maplibre | 1 calls |
| Operations | 1 calls |

## How to Explore

1. `context({name: "ownValue"})` — see callers and callees
2. `query({search_query: "cluster_201"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
