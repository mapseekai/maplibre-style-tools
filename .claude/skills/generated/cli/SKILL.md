---
name: cli
description: "Skill for the Cli area of maplibre-style-tools. 67 symbols across 12 files."
---

# Cli

67 symbols | 12 files | Cohesion: 88%

## When to Use

- Working with code in `src/`
- Understanding how serializeStyleFile, writeNewOutputFile, temporaryStylePath work
- Modifying cli-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/cli/file-output.ts` | CliOutputError, messageOf, captureCreatedArtifactIdentity, outputErrorDetails, serializeStyleFile (+8) |
| `src/cli/run.test.ts` | BufferWriter, makeIo, acceptsJsonValue, closeWriter, invoke (+4) |
| `src/cli/output.ts` | writeText, cleanup, scheduleCleanup, fail, succeed (+3) |
| `src/cli/input.ts` | CliInputError, messageOf, tooLarge, decodeAndParse, readStdinBytes (+2) |
| `src/cli/inspect.ts` | mapStyleContext, mapLayerSearch, mapGeoJsonAnalysis, missing, inspectStyle |
| `src/core/search.ts` | includesText, summarizeLayer, searchLayers, compareCodeUnits, listSourceLayers |
| `src/cli/run.ts` | runCli, messageOf, writeDiagnosticBestEffort, writeResult, runCliWithDependencies |
| `src/cli/file-output.test.ts` | sink, readFileSource, tempArtifacts, afterTempSync |
| `src/cli/args.ts` | messageOf, rejectDisallowedOptions, requireStylePositionals, parseCliArgs |
| `src/cli/spawn-cli.test.ts` | spawnProcess, spawnCli, spawnCliWithClosedStdout, spawnEval |

## Entry Points

Start here when exploring this area:

- **`serializeStyleFile`** (Function) — `src/cli/file-output.ts:69`
- **`writeNewOutputFile`** (Function) — `src/cli/file-output.ts:82`
- **`temporaryStylePath`** (Function) — `src/cli/file-output.ts:133`
- **`replaceStyleFileAtomically`** (Function) — `src/cli/file-output.ts:279`
- **`inspectStyle`** (Function) — `src/cli/inspect.ts:170`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `CliOutputError` | Class | `src/cli/file-output.ts` | 26 |
| `CliInputError` | Class | `src/cli/input.ts` | 5 |
| `CliArgumentError` | Class | `src/cli/types.ts` | 36 |
| `serializeStyleFile` | Function | `src/cli/file-output.ts` | 69 |
| `writeNewOutputFile` | Function | `src/cli/file-output.ts` | 82 |
| `temporaryStylePath` | Function | `src/cli/file-output.ts` | 133 |
| `replaceStyleFileAtomically` | Function | `src/cli/file-output.ts` | 279 |
| `inspectStyle` | Function | `src/cli/inspect.ts` | 170 |
| `searchLayers` | Function | `src/core/search.ts` | 34 |
| `listSourceLayers` | Function | `src/core/search.ts` | 72 |
| `readJsonInput` | Function | `src/cli/input.ts` | 125 |
| `writeDiagnostic` | Function | `src/cli/output.ts` | 51 |
| `runCli` | Function | `src/cli/run.ts` | 241 |
| `parseCliArgs` | Function | `src/cli/args.ts` | 65 |
| `writeJson` | Function | `src/cli/output.ts` | 45 |
| `runCliWithDependencies` | Function | `src/cli/run.ts` | 58 |
| `BufferWriter` | Class | `src/cli/run.test.ts` | 21 |
| `messageOf` | Function | `src/cli/file-output.ts` | 38 |
| `captureCreatedArtifactIdentity` | Function | `src/cli/file-output.ts` | 52 |
| `outputErrorDetails` | Function | `src/cli/file-output.ts` | 63 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `RunCliWithDependencies → ScheduleCleanup` | cross_community | 7 |
| `RunCliWithDependencies → Cleanup` | cross_community | 7 |
| `InspectStyle → CreateStyleToolError` | cross_community | 5 |
| `InspectStyle → ResolvedLimit` | cross_community | 5 |
| `InspectStyle → MaterializePath` | cross_community | 5 |
| `InspectStyle → AppendOwn` | cross_community | 5 |
| `ReplaceStyleFileAtomically → ErrorCode` | intra_community | 4 |
| `InspectStyle → CompareCodeUnits` | cross_community | 4 |
| `RunCliWithDependencies → CliArgumentError` | cross_community | 4 |
| `ReplaceStyleFileAtomically → CliOutputError` | intra_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Bridge | 2 calls |
| Maplibre | 1 calls |
| Operations | 1 calls |
| Cluster_191 | 1 calls |
| Mcp | 1 calls |

## How to Explore

1. `context({name: "serializeStyleFile"})` — see callers and callees
2. `query({search_query: "cli"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
