---
name: bridge
description: "Skill for the Bridge area of maplibre-style-tools. 276 symbols across 26 files."
---

# Bridge

276 symbols | 26 files | Cohesion: 68%

## When to Use

- Working with code in `src/`
- Understanding how encodeBridgeFrame, buildLiveMapMetadataUri, buildLiveMapStyleUri work
- Modifying bridge-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/bridge/client.ts` | mapNotReadyError, randomBase64Url, snapshotForEvent, sendEvent, scheduleRecovery (+44) |
| `src/bridge/registry.ts` | positiveSafeInteger, cloneJson, deepFreeze, randomBase64Url, disconnectedError (+34) |
| `src/bridge/browser-runtime.ts` | ownData, firstValidationError, readValidatedMapStyle, validateImageData, readBoundedResponse (+33) |
| `src/bridge/outbound.ts` | publicBridgeErrorMessage, hasCapability, isRfc6901Pointer, ownDataValue, isRecord (+24) |
| `src/bridge/resource-policy.ts` | isRecord, ownDataValue, addString, addStringArray, collectSprite (+21) |
| `src/bridge/server.ts` | positiveSafeInteger, resolveLimitCeilings, limitsEqual, tokenMatches, writeUpgradeRejection (+14) |
| `src/bridge/client.test.ts` | open, receive, parsed, waitForSent, authenticate (+10) |
| `src/mcp/live-resources.ts` | buildLiveMapMetadataUri, buildLiveMapStyleUri, publicMetadata, jsonResource, disconnected (+4) |
| `src/bridge/browser-runtime.test.ts` | hasCode, recordSynchronousCall, querySourceFeatures, queryRenderedFeatures, setGlobalStateProperty (+4) |
| `src/bridge/registry.test.ts` | failure, hasCode, live, attemptId, registration (+3) |

## Entry Points

Start here when exploring this area:

- **`encodeBridgeFrame`** (Function) — `src/bridge/codec.ts:15`
- **`buildLiveMapMetadataUri`** (Function) — `src/mcp/live-resources.ts:56`
- **`buildLiveMapStyleUri`** (Function) — `src/mcp/live-resources.ts:61`
- **`registerLiveMapResources`** (Function) — `src/mcp/live-resources.ts:141`
- **`createStyleToolError`** (Function) — `src/core/errors.ts:22`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `LiveMapRegistry` | Class | `src/bridge/registry.ts` | 268 |
| `encodeBridgeFrame` | Function | `src/bridge/codec.ts` | 15 |
| `buildLiveMapMetadataUri` | Function | `src/mcp/live-resources.ts` | 56 |
| `buildLiveMapStyleUri` | Function | `src/mcp/live-resources.ts` | 61 |
| `registerLiveMapResources` | Function | `src/mcp/live-resources.ts` | 141 |
| `createStyleToolError` | Function | `src/core/errors.ts` | 22 |
| `publicBridgeErrorMessage` | Function | `src/bridge/outbound.ts` | 36 |
| `assertInboundResultAllowed` | Function | `src/bridge/outbound.ts` | 543 |
| `assertInboundEventAllowed` | Function | `src/bridge/outbound.ts` | 575 |
| `sendEvent` | Function | `src/bridge/client.ts` | 402 |
| `scheduleRecovery` | Function | `src/bridge/client.ts` | 414 |
| `observeExternal` | Function | `src/bridge/client.ts` | 458 |
| `onMapStyleEvent` | Function | `src/bridge/client.ts` | 479 |
| `makeAttempt` | Function | `src/bridge/client.ts` | 501 |
| `finishRegistration` | Function | `src/bridge/client.ts` | 530 |
| `onSyncStateChange` | Function | `src/bridge/client.ts` | 605 |
| `observe` | Function | `src/bridge/browser-runtime.ts` | 543 |
| `isStyleToolError` | Function | `src/core/errors.ts` | 39 |
| `prepareOutboundBridgeFrame` | Function | `src/bridge/outbound.ts` | 415 |
| `closeGeneration` | Function | `src/bridge/client.ts` | 393 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `ReconcileResult → JsonStringByteLength` | cross_community | 8 |
| `#validateSnapshot → JsonStringByteLength` | cross_community | 7 |
| `MakePair → CreateStyleToolError` | cross_community | 7 |
| `Observe → CreateStyleToolError` | cross_community | 7 |
| `Observe → ReadPositiveSafeIntegerOption` | cross_community | 7 |
| `Observe → Utf8ByteLength` | cross_community | 7 |
| `Execute → CreateStyleToolError` | cross_community | 6 |
| `Execute → Utf8ByteLength` | cross_community | 6 |
| `#pump → DeepFreeze` | cross_community | 6 |
| `#pump → CloneJson` | cross_community | 6 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Maplibre | 7 calls |
| Mcp | 5 calls |
| Ai-sdk | 3 calls |

## How to Explore

1. `context({name: "encodeBridgeFrame"})` — see callers and callees
2. `query({search_query: "bridge"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
