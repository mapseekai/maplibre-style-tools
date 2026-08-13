---
name: cluster-258
description: "Skill for the Cluster_258 area of maplibre-style-tools. 6 symbols across 1 files."
---

# Cluster_258

6 symbols | 1 files | Cohesion: 67%

## When to Use

- Working with code in `src/`
- Understanding how validateStyleDocumentWith work
- Modifying cluster_258-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/validation.ts` | toJsonPointer, readPositiveSafeIntegerOption, validateOptions, runMapLibreValidator, validateStyleDocumentWithValidator (+1) |

## Entry Points

Start here when exploring this area:

- **`validateStyleDocumentWith`** (Function) — `src/core/validation.ts:258`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `validateStyleDocumentWith` | Function | `src/core/validation.ts` | 258 |
| `toJsonPointer` | Function | `src/core/validation.ts` | 39 |
| `readPositiveSafeIntegerOption` | Function | `src/core/validation.ts` | 48 |
| `validateOptions` | Function | `src/core/validation.ts` | 67 |
| `runMapLibreValidator` | Function | `src/core/validation.ts` | 167 |
| `validateStyleDocumentWithValidator` | Function | `src/core/validation.ts` | 174 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `ApplyStyleDocumentOrUrlToMap → JsonStringByteLength` | cross_community | 8 |
| `ReconcileResult → JsonStringByteLength` | cross_community | 8 |
| `PrepareTransactionForMap → JsonStringByteLength` | cross_community | 8 |
| `Ready → JsonStringByteLength` | cross_community | 8 |
| `InstallStyle → JsonStringByteLength` | cross_community | 7 |
| `#validateSnapshot → JsonStringByteLength` | cross_community | 7 |
| `Observe → CreateStyleToolError` | cross_community | 7 |
| `Observe → ReadPositiveSafeIntegerOption` | cross_community | 7 |
| `Observe → Utf8ByteLength` | cross_community | 7 |
| `Execute → CreateStyleToolError` | cross_community | 6 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Bridge | 2 calls |
| Ai-sdk | 1 calls |
| Cluster_259 | 1 calls |

## How to Explore

1. `context({name: "validateStyleDocumentWith"})` — see callers and callees
2. `query({search_query: "cluster_258"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
