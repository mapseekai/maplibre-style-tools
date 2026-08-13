---
name: cluster-248
description: "Skill for the Cluster_248 area of maplibre-style-tools. 8 symbols across 1 files."
---

# Cluster_248

8 symbols | 1 files | Cohesion: 70%

## When to Use

- Working with code in `src/`
- Understanding how addSourceOperationSchema, duplicateSourceOperationSchema, renameSourceOperationSchema work
- Modifying cluster_248-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/schemas.ts` | validSourceId, fallbackSourceOperation, addSourceOperationSchema, duplicateSourceOperationSchema, renameSourceOperationSchema (+3) |

## Entry Points

Start here when exploring this area:

- **`addSourceOperationSchema`** (Function) — `src/core/schemas.ts:1860`
- **`duplicateSourceOperationSchema`** (Function) — `src/core/schemas.ts:1873`
- **`renameSourceOperationSchema`** (Function) — `src/core/schemas.ts:1885`
- **`removeSourceOperationSchema`** (Function) — `src/core/schemas.ts:1897`
- **`patchSourceOperationSchema`** (Function) — `src/core/schemas.ts:1909`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `addSourceOperationSchema` | Function | `src/core/schemas.ts` | 1860 |
| `duplicateSourceOperationSchema` | Function | `src/core/schemas.ts` | 1873 |
| `renameSourceOperationSchema` | Function | `src/core/schemas.ts` | 1885 |
| `removeSourceOperationSchema` | Function | `src/core/schemas.ts` | 1897 |
| `patchSourceOperationSchema` | Function | `src/core/schemas.ts` | 1909 |
| `setGeoJsonDataOperationSchema` | Function | `src/core/schemas.ts` | 1921 |
| `validSourceId` | Function | `src/core/schemas.ts` | 471 |
| `fallbackSourceOperation` | Function | `src/core/schemas.ts` | 479 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_246 | 3 calls |
| Cluster_243 | 1 calls |

## How to Explore

1. `context({name: "addSourceOperationSchema"})` — see callers and callees
2. `query({search_query: "cluster_248"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
