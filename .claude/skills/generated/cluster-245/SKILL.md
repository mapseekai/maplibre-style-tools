---
name: cluster-245
description: "Skill for the Cluster_245 area of maplibre-style-tools. 11 symbols across 1 files."
---

# Cluster_245

11 symbols | 1 files | Cohesion: 85%

## When to Use

- Working with code in `src/`
- Understanding how check work
- Modifying cluster_245-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/schemas.ts` | materializePath, isNormalObjectPrototypeDescriptor, hasPollutedPrototype, safeFailure, fallbackSafeParse (+6) |

## Entry Points

Start here when exploring this area:

- **`check`** (Function) — `src/core/schemas.ts:2262`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `check` | Function | `src/core/schemas.ts` | 2262 |
| `materializePath` | Function | `src/core/schemas.ts` | 116 |
| `isNormalObjectPrototypeDescriptor` | Function | `src/core/schemas.ts` | 235 |
| `hasPollutedPrototype` | Function | `src/core/schemas.ts` | 254 |
| `safeFailure` | Function | `src/core/schemas.ts` | 1262 |
| `fallbackSafeParse` | Function | `src/core/schemas.ts` | 1280 |
| `safeParse` | Function | `src/core/schemas.ts` | 1293 |
| `parse` | Function | `src/core/schemas.ts` | 1298 |
| `safeParseAsync` | Function | `src/core/schemas.ts` | 1306 |
| `parseAsync` | Function | `src/core/schemas.ts` | 1311 |
| `schema` | Function | `src/core/schemas.ts` | 1335 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `FallbackAddGeoJsonLayerFirstIssue → MaterializePath` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_244 | 3 calls |
| Cluster_243 | 1 calls |

## How to Explore

1. `context({name: "check"})` — see callers and callees
2. `query({search_query: "cluster_245"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
