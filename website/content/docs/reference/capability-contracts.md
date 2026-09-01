---
title: Capability Contracts
description: What each capability accepts, returns, and where it is available.
weight: 30
---

The five capabilities share one registry, strict schemas, and one result envelope. This page tells you what each one accepts and returns and where it is available; exact field types are linked at the bottom.

## Capability matrix

| Capability | Input type | Success data | Live map | AI SDK | MCP | WebMCP | CLI |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `inspectStyle` | [`InspectStyleInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts#L21) | `InspectionProjection` | No | Yes | Yes | Default | `inspect`; `validate` covers validation actions |
| `applyStyleTransaction` | [`ApplyStyleTransactionInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `StyleMutationReceipt` | No | Yes | Yes | `allowMutations` | `apply` |
| `applyStyleDocument` | [`ApplyStyleDocumentInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `StyleMutationReceipt` | No | Yes | Yes | `allowMutations` | No |
| `runMapCommand` | [`RunMapCommandInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `MapCommandReceipt` | Yes | Yes | Yes | `allowMutations` | No |
| `queryMapFeatures` | [`QueryMapFeaturesInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `FeatureQueryProjection` | Yes | Yes | Yes | Default | No |

The AI SDK facade supplies all five tools over an in-process map. MCP exposes all five names and adds session management.

## What each capability needs from you

| Capability | Required authority |
| --- | --- |
| `inspectStyle` | A `StyleAuthority` — except `validateDocument`, `validateTransaction`, and `analyzeGeoJson`, which work on their supplied input |
| `applyStyleTransaction` | `StyleAuthority.applyTransaction()` |
| `applyStyleDocument` | `StyleAuthority.applyDocument()` |
| `runMapCommand` | `RuntimeAuthority.runtimeCommands()` |
| `queryMapFeatures` | `RuntimeAuthority.querySourceFeatures()` or `queryRenderedFeatures()` |

Authorities resolve lazily and may return `null`; authority-dependent calls then fail with `MAP_NOT_READY`.

## Input rules

Schemas accept native JSON values and strict objects — unknown fields are rejected, and nested values must not be JSON-encoded strings. `ApplyStyleTransactionInput` carries a transaction plus optional `dryRun` and `diff`; `ApplyStyleDocumentInput` selects an inline style or an absolute URL; runtime command and feature-query inputs are discriminated by `action` or `target`.

## `inspectStyle` actions

Pick the action that matches the projection you need. `validateDocument`, `validateTransaction`, and `analyzeGeoJson` run without an authority; the rest read the current style from the selected authority.

| Action | What you get | Key input |
| --- | --- | --- |
| `listLayers` | Compact layer summaries | Optional `query`, `type`, `source`, `sourceLayer`, `limit` |
| `listSources` | Source definitions | Optional `limit` |
| `getLayer` | One layer projection | `layerId`; optional `fields` from `paint`, `layout`, `filter`, `zoom` |
| `getSource` | One source definition | `sourceId` |
| `getRoot` | Root properties without layer/source collections | — |
| `getContext` | Compact style context, including authority-provided selection context | Optional `layerLimit` |
| `inspectLayers` | Detailed projections for selected layers, or the bounded leading set | Optional `layerIds`, `fields`, `limit` |
| `getLayerCount` | The number of layers | — |
| `validateDocument` | Validation of a supplied style | `style` |
| `validateCurrentMap` | Confirmation that the authority exposes a currently valid style | Requires a ready authority |
| `validateTransaction` | Validation of a non-empty transaction, without applying it | `transaction` |
| `analyzeGeoJson` | Analysis of supplied inline GeoJSON; URLs report `available: false` without fetching | `data`; optional `options` |
| `listSourceLayers` | Source-layer usage, optionally for one source | Optional `sourceId` |

## Where the exact shapes live

Complete field and discriminator types: the canonical [capability declarations](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts), [execution schemas](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/schemas.ts), and [core types](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/core/types.ts).
