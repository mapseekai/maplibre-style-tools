---
name: cluster-194
description: "Skill for the Cluster_194 area of maplibre-style-tools. 12 symbols across 1 files."
---

# Cluster_194

12 symbols | 1 files | Cohesion: 93%

## When to Use

- Working with code in `src/`
- Understanding how appendPosition, appendGeometryCoordinates, appendGeometries work
- Modifying cluster_194-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/geojson-analysis.ts` | appendPosition, appendGeometryCoordinates, appendGeometries, propertyType, appendProperty (+7) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `appendPosition` | Function | `src/core/geojson-analysis.ts` | 106 |
| `appendGeometryCoordinates` | Function | `src/core/geojson-analysis.ts` | 122 |
| `appendGeometries` | Function | `src/core/geojson-analysis.ts` | 152 |
| `propertyType` | Function | `src/core/geojson-analysis.ts` | 175 |
| `appendProperty` | Function | `src/core/geojson-analysis.ts` | 184 |
| `appendFeature` | Function | `src/core/geojson-analysis.ts` | 217 |
| `stablePrimitive` | Function | `src/core/geojson-analysis.ts` | 231 |
| `compareCodeUnits` | Function | `src/core/geojson-analysis.ts` | 235 |
| `summarizeProperty` | Function | `src/core/geojson-analysis.ts` | 239 |
| `propertyWarnings` | Function | `src/core/geojson-analysis.ts` | 269 |
| `geometryCounts` | Function | `src/core/geojson-analysis.ts` | 293 |
| `analyzeValidated` | Function | `src/core/geojson-analysis.ts` | 304 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `InspectStyle → CompareCodeUnits` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Maplibre | 1 calls |

## How to Explore

1. `context({name: "appendPosition"})` — see callers and callees
2. `query({search_query: "cluster_194"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
