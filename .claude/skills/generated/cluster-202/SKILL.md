---
name: cluster-202
description: "Skill for the Cluster_202 area of maplibre-style-tools. 6 symbols across 1 files."
---

# Cluster_202

6 symbols | 1 files | Cohesion: 48%

## When to Use

- Working with code in `src/`
- Understanding how validateInlineGeoJson work
- Modifying cluster_202-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/geojson.ts` | materializePath, invalidInput, schemaFailure, resolvedLimit, resolveLimits (+1) |

## Entry Points

Start here when exploring this area:

- **`validateInlineGeoJson`** (Function) — `src/core/geojson.ts:449`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `validateInlineGeoJson` | Function | `src/core/geojson.ts` | 449 |
| `materializePath` | Function | `src/core/geojson.ts` | 94 |
| `invalidInput` | Function | `src/core/geojson.ts` | 110 |
| `schemaFailure` | Function | `src/core/geojson.ts` | 114 |
| `resolvedLimit` | Function | `src/core/geojson.ts` | 150 |
| `resolveLimits` | Function | `src/core/geojson.ts` | 158 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `RuntimeGeoJsonDiffUpdateSchema → ResolvedLimit` | cross_community | 6 |
| `RuntimeGeoJsonDiffUpdateSchema → CreateStyleToolError` | cross_community | 6 |
| `RuntimeGeoJsonDiffUpdateSchema → MaterializePath` | cross_community | 6 |
| `RuntimeGeoJsonDiffUpdateSchema → AppendOwn` | cross_community | 6 |
| `RuntimeGeoJsonDiffUpdateSchema → ChildPath` | cross_community | 6 |
| `RuntimeGeoJsonDiffUpdateSchema → OwnValue` | cross_community | 6 |
| `InspectStyle → ResolvedLimit` | cross_community | 5 |
| `InspectStyle → MaterializePath` | cross_community | 5 |
| `InspectStyle → AppendOwn` | cross_community | 5 |
| `CountGeoJson → EscapeJsonPointerToken` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Bridge | 3 calls |
| Maplibre | 2 calls |
| Cluster_201 | 2 calls |
| Ai-sdk | 1 calls |

## How to Explore

1. `context({name: "validateInlineGeoJson"})` — see callers and callees
2. `query({search_query: "cluster_202"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
