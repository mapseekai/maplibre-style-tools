---
name: cluster-249
description: "Skill for the Cluster_249 area of maplibre-style-tools. 11 symbols across 1 files."
---

# Cluster_249

11 symbols | 1 files | Cohesion: 63%

## When to Use

- Working with code in `src/`
- Understanding how duplicateLayerOperationSchema, moveLayerOperationSchema, reorderLayersOperationSchema work
- Modifying cluster_249-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/schemas.ts` | validLayerLifecycleId, validPlacement, fallbackLayerLifecycleOperation, literalIssue, fallbackLayerLifecycleOperationIssue (+6) |

## Entry Points

Start here when exploring this area:

- **`duplicateLayerOperationSchema`** (Function) — `src/core/schemas.ts:1948`
- **`moveLayerOperationSchema`** (Function) — `src/core/schemas.ts:1981`
- **`reorderLayersOperationSchema`** (Function) — `src/core/schemas.ts:2025`
- **`removeLayerOperationSchema`** (Function) — `src/core/schemas.ts:2037`
- **`addLayerFromSourceOperationSchema`** (Function) — `src/core/schemas.ts:2074`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `duplicateLayerOperationSchema` | Function | `src/core/schemas.ts` | 1948 |
| `moveLayerOperationSchema` | Function | `src/core/schemas.ts` | 1981 |
| `reorderLayersOperationSchema` | Function | `src/core/schemas.ts` | 2025 |
| `removeLayerOperationSchema` | Function | `src/core/schemas.ts` | 2037 |
| `addLayerFromSourceOperationSchema` | Function | `src/core/schemas.ts` | 2074 |
| `addGeoJsonLayerOperationSchema` | Function | `src/core/schemas.ts` | 2126 |
| `validLayerLifecycleId` | Function | `src/core/schemas.ts` | 475 |
| `validPlacement` | Function | `src/core/schemas.ts` | 525 |
| `fallbackLayerLifecycleOperation` | Function | `src/core/schemas.ts` | 534 |
| `literalIssue` | Function | `src/core/schemas.ts` | 664 |
| `fallbackLayerLifecycleOperationIssue` | Function | `src/core/schemas.ts` | 980 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `FallbackAddGeoJsonLayerFirstIssue → ValidLayerLifecycleId` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_246 | 8 calls |
| Cluster_250 | 6 calls |
| Cluster_243 | 1 calls |

## How to Explore

1. `context({name: "duplicateLayerOperationSchema"})` — see callers and callees
2. `query({search_query: "cluster_249"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
