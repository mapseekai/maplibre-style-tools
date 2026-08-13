---
name: cluster-247
description: "Skill for the Cluster_247 area of maplibre-style-tools. 8 symbols across 1 files."
---

# Cluster_247

8 symbols | 1 files | Cohesion: 70%

## When to Use

- Working with code in `src/`
- Understanding how addLayerDefinitionOperationSchema, deepMergeLayerDefinitionOperationSchema, replaceLayerDefinitionOperationSchema work
- Modifying cluster_247-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/schemas.ts` | fallbackCompatibilityOperation, addLayerDefinitionOperationSchema, deepMergeLayerDefinitionOperationSchema, replaceLayerDefinitionOperationSchema, deepMergeSourceDefinitionOperationSchema (+3) |

## Entry Points

Start here when exploring this area:

- **`addLayerDefinitionOperationSchema`** (Function) — `src/core/schemas.ts:2139`
- **`deepMergeLayerDefinitionOperationSchema`** (Function) — `src/core/schemas.ts:2151`
- **`replaceLayerDefinitionOperationSchema`** (Function) — `src/core/schemas.ts:2163`
- **`deepMergeSourceDefinitionOperationSchema`** (Function) — `src/core/schemas.ts:2175`
- **`replaceSourceDefinitionOperationSchema`** (Function) — `src/core/schemas.ts:2187`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `addLayerDefinitionOperationSchema` | Function | `src/core/schemas.ts` | 2139 |
| `deepMergeLayerDefinitionOperationSchema` | Function | `src/core/schemas.ts` | 2151 |
| `replaceLayerDefinitionOperationSchema` | Function | `src/core/schemas.ts` | 2163 |
| `deepMergeSourceDefinitionOperationSchema` | Function | `src/core/schemas.ts` | 2175 |
| `replaceSourceDefinitionOperationSchema` | Function | `src/core/schemas.ts` | 2187 |
| `replaceRootPropertyOperationSchema` | Function | `src/core/schemas.ts` | 2199 |
| `shallowPatchRootPropertyOperationSchema` | Function | `src/core/schemas.ts` | 2211 |
| `fallbackCompatibilityOperation` | Function | `src/core/schemas.ts` | 377 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_246 | 3 calls |
| Cluster_249 | 1 calls |
| Cluster_248 | 1 calls |

## How to Explore

1. `context({name: "addLayerDefinitionOperationSchema"})` — see callers and callees
2. `query({search_query: "cluster_247"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
