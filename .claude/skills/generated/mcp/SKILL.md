---
name: mcp
description: "Skill for the Mcp area of maplibre-style-tools. 283 symbols across 25 files."
---

# Mcp

283 symbols | 25 files | Cohesion: 77%

## When to Use

- Working with code in `src/`
- Understanding how removeGeneration, isExpired, sweepExpired work
- Modifying mcp-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/mcp/message-boundary.ts` | invalidInput, assertSafeMessageLimit, resolveMcpMessagePolicy, assertAdmissionNamespace, parseRawNamespace (+39) |
| `src/mcp/session-store.ts` | sessionError, containsLoneSurrogate, assertValidSessionId, cloneProjectionResult, isThenable (+37) |
| `src/mcp/http.ts` | singleHeader, assertRequestAllowed, parseDeclaredLength, readBoundedJsonBody, httpErrorBody (+35) |
| `src/mcp/stdio.ts` | consumeTerminal, signal, fail, accept, transform (+23) |
| `src/mcp/resources.ts` | encodeDynamicSegment, makeUri, makeSessionUri, makeStyleUri, makeContextUri (+19) |
| `src/mcp/create-server.ts` | factoryError, close, rejectClosedTransport, connect, bounded (+15) |
| `src/mcp/live-tools.ts` | requireSdkAdvertisableInputSchema, commandWithoutMapId, transactionReceipt, mutationReceipt, preflightMutation (+7) |
| `src/mcp/document-handlers.ts` | missingLayer, missingSource, requireLayer, requireSource, analyzeSessionSource (+5) |
| `src/mcp/integration.test.ts` | requireJsonRecord, requireJsonString, solveEvaluation, withIndependentEvaluationSession, requireText (+3) |
| `src/mcp/output.ts` | compatibilityWrapperError, parseOfficialCallToolResult, parseStyleToolErrorShape, toMcpResult, toolSuccess (+2) |

## Entry Points

Start here when exploring this area:

- **`removeGeneration`** (Function) — `src/mcp/session-store.ts:342`
- **`isExpired`** (Function) — `src/mcp/session-store.ts:347`
- **`sweepExpired`** (Function) — `src/mcp/session-store.ts:349`
- **`missingSession`** (Function) — `src/mcp/session-store.ts:355`
- **`captureSession`** (Function) — `src/mcp/session-store.ts:359`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `removeGeneration` | Function | `src/mcp/session-store.ts` | 342 |
| `isExpired` | Function | `src/mcp/session-store.ts` | 347 |
| `sweepExpired` | Function | `src/mcp/session-store.ts` | 349 |
| `missingSession` | Function | `src/mcp/session-store.ts` | 355 |
| `captureSession` | Function | `src/mcp/session-store.ts` | 359 |
| `assertRunnable` | Function | `src/mcp/session-store.ts` | 366 |
| `enqueue` | Function | `src/mcp/session-store.ts` | 374 |
| `touch` | Function | `src/mcp/session-store.ts` | 388 |
| `selectRevision` | Function | `src/mcp/session-store.ts` | 394 |
| `withStyle` | Function | `src/mcp/session-store.ts` | 424 |
| `project` | Function | `src/mcp/session-store.ts` | 450 |
| `projectRevision` | Function | `src/mcp/session-store.ts` | 467 |
| `open` | Function | `src/mcp/session-store.ts` | 486 |
| `read` | Function | `src/mcp/session-store.ts` | 535 |
| `readRevision` | Function | `src/mcp/session-store.ts` | 547 |
| `exportStyle` | Function | `src/mcp/session-store.ts` | 562 |
| `applyFinalized` | Function | `src/mcp/session-store.ts` | 581 |
| `apply` | Function | `src/mcp/session-store.ts` | 649 |
| `close` | Function | `src/mcp/session-store.ts` | 658 |
| `parseOfficialCallToolResult` | Function | `src/mcp/output.ts` | 77 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `MakePair → CreateStyleToolError` | cross_community | 7 |
| `InstalledOnMessage → CreateStyleToolError` | cross_community | 6 |
| `Send → RestoreOne` | cross_community | 6 |
| `OnSignal → CreateStyleToolError` | cross_community | 6 |
| `MakePair → DisposeOwnedStore` | cross_community | 6 |
| `RunStdioMcp → CreateStyleToolError` | cross_community | 6 |
| `ProjectRevision → CreateStyleToolError` | cross_community | 5 |
| `Project → CreateStyleToolError` | cross_community | 5 |
| `Project → DeepFreeze` | cross_community | 5 |
| `ReadRevision → CreateStyleToolError` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Bridge | 41 calls |
| Cluster_191 | 2 calls |
| Cli | 2 calls |
| Maplibre | 1 calls |

## How to Explore

1. `context({name: "removeGeneration"})` — see callers and callees
2. `query({search_query: "mcp"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
