---
title: Capability Contracts
description: Compare curated input/output guidance, authority needs, and interface availability.
weight: 30
---

The five public capabilities share one registry, strict schemas, and a common result envelope. This page is a curated compatibility guide to their public input and success-data types; it is not an exhaustive field-level API reference.

## Capability matrix {#capability-matrix}

| Capability | Input type | Success data | Runtime | AI SDK | MCP | WebMCP | CLI |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `inspectStyle` | [`InspectStyleInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts#L21) | `InspectionProjection` | No | Yes | Yes | Default | `inspect`; `validate` covers validation actions |
| `applyStyleTransaction` | [`ApplyStyleTransactionInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `StyleMutationReceipt` | No | Yes | Yes | `allowMutations` | `apply` |
| `applyStyleDocument` | [`ApplyStyleDocumentInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `StyleMutationReceipt` | No | Yes | Yes | `allowMutations` | No |
| `runMapCommand` | [`RunMapCommandInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `MapCommandReceipt` | Yes | Yes | Yes | `allowMutations` | No |
| `queryMapFeatures` | [`QueryMapFeaturesInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `FeatureQueryProjection` | Yes | Yes | Yes | Default | No |

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

[`InspectStyleInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts#L21) is the canonical complete inspection-action union. `ApplyStyleTransactionInput` carries a transaction plus optional `dryRun` and `diff`. `ApplyStyleDocumentInput` selects an inline Style or absolute URL. Runtime command and feature-query inputs are discriminated by `action` or `target`.

For every complete field and discriminator, use the canonical [capability type declarations](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts), [execution schemas](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/schemas.ts), and [schema tests](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/schemas.test.ts). Transaction operation variants and core result shapes are defined in [core types](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/core/types.ts) and exercised by the adjacent core schema and operation tests.

## `inspectStyle` action catalogue {#inspect-style-actions}

Use the action that matches the projection or validation you need. `validateDocument`, `validateTransaction`, and `analyzeGeoJson` operate on their supplied input without resolving an Authority; the other actions read the current Style from the selected Authority.

| Action | Intent | Key selector or required input |
| --- | --- | --- |
| `listLayers` | Search or list compact layer summaries | Optional `query`, `type`, `source`, `sourceLayer`, and `limit` |
| `listSources` | List source definitions | Optional `limit` |
| `getLayer` | Read one layer projection | Required `layerId`; optional `fields` from `paint`, `layout`, `filter`, and `zoom` |
| `getSource` | Read one source definition | Required `sourceId` |
| `getRoot` | Read Style root properties without layer/source collections | No selector |
| `getContext` | Build a compact Style context, including Authority-provided selection context | Optional `layerLimit` |
| `inspectLayers` | Read detailed projections for selected layers, or the bounded leading set | Optional `layerIds`, `fields`, and `limit` |
| `getLayerCount` | Count layers without returning their definitions | No selector |
| `validateDocument` | Validate a supplied Style document | Required `style` |
| `validateCurrentMap` | Confirm that the selected Authority exposes a currently valid Style | No extra input; requires a ready Authority |
| `validateTransaction` | Validate a non-empty transaction without applying it | Required `transaction` |
| `analyzeGeoJson` | Analyze supplied inline GeoJSON, or report a remote URL as unavailable without fetching | Required `data`; optional `options` |
| `listSourceLayers` | List source-layer usage, optionally for one source | Optional `sourceId` |

The canonical [`InspectStyleInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts#L21), [execution schema](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/schemas.ts), and [executor](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/inspect.ts) remain authoritative for exact field types and projection behavior.

## Interface availability {#interface-availability}

WebMCP registers `inspectStyle` and `queryMapFeatures` by default. Its mutation tools are opt-in: `applyStyleTransaction`, `applyStyleDocument`, and `runMapCommand` are registered only when `allowMutations` is `true`. The CLI is intentionally document-oriented and does not expose whole-document replacement or live-runtime operations.
