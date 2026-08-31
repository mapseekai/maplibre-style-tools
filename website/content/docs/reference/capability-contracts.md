---
title: Capability Contracts
description: Compare inputs, outputs, authority needs, and interface availability.
weight: 30
---

The five public capabilities share one registry, strict schemas, and a common result envelope. The table is the compatibility matrix for their public input and success-data types.

## Capability matrix {#capability-matrix}

| Capability | Input type | Success data | Runtime | AI SDK | MCP | WebMCP | CLI |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `inspectStyle` | `InspectStyleInput` | `InspectionProjection` | No | Yes | Yes | Default | `inspect`; `validate` covers validation actions |
| `applyStyleTransaction` | `ApplyStyleTransactionInput` | `StyleMutationReceipt` | No | Yes | Yes | `allowMutations` | `apply` |
| `applyStyleDocument` | `ApplyStyleDocumentInput` | `StyleMutationReceipt` | No | Yes | Yes | `allowMutations` | No |
| `runMapCommand` | `RunMapCommandInput` | `MapCommandReceipt` | Yes | Yes | Yes | `allowMutations` | No |
| `queryMapFeatures` | `QueryMapFeaturesInput` | `FeatureQueryProjection` | Yes | Yes | Yes | Default | No |

“Runtime” means a live MapLibre map is required. The AI SDK facade supplies all five tools over an in-process map. MCP exposes all five capability names and additionally exposes session management.

## Authority requirements {#authority-requirements}

| Capability | Required authority |
| --- | --- |
| `inspectStyle` | `StyleAuthority`; authority-free for document and transaction validation or GeoJSON analysis |
| `applyStyleTransaction` | `StyleAuthority.applyTransaction()` |
| `applyStyleDocument` | `StyleAuthority.applyDocument()` |
| `runMapCommand` | `RuntimeAuthority.runtimeCommands()` |
| `queryMapFeatures` | `RuntimeAuthority.querySourceFeatures()` or `RuntimeAuthority.queryRenderedFeatures()` |

An `AuthoritySource` resolves lazily and may return `null`; authority-dependent execution then returns `MAP_NOT_READY`. MCP may select either a Style session authority or a live bridged map authority. Runtime-only capabilities require a map target.

## Input schemas {#input-schemas}

Capability schemas accept native JSON values and use strict objects, so unknown fields are rejected. `capabilityRegistry` provides both the execution `inputSchema` and a model-facing `modelInputSchema`; execution always validates again at the capability boundary.

`InspectStyleInput` selects one inspection action. `ApplyStyleTransactionInput` carries a transaction plus optional `dryRun` and `diff`. `ApplyStyleDocumentInput` selects an inline Style or absolute URL. Runtime command and feature-query inputs are discriminated by `action` or `target`.

## Interface availability {#interface-availability}

WebMCP registers `inspectStyle` and `queryMapFeatures` by default. Its mutation tools are opt-in: `applyStyleTransaction`, `applyStyleDocument`, and `runMapCommand` are registered only when `allowMutations` is `true`. The CLI is intentionally document-oriented and does not expose whole-document replacement or live-runtime operations.
