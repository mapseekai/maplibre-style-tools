---
title: Overview
description: What the package does and which interface fits your project.
weight: 10
---

`maplibre-style-tools` lets your application — and the AI agents inside it — inspect and edit MapLibre GL styles through five well-defined operations. Instead of exposing raw `map.setStyle()` to a model, you hand it tools with strict input validation, atomic edits, and results you can reason about.

## What you can do

- **Inspect styles** — list and search layers, read a single layer or source, count layers, analyze inline GeoJSON. Pure reads; nothing renders.
- **Edit styles safely** — describe changes as a transaction (`setLayerProperties`, `setLayerFilter`, `addGeoJsonLayer`, …). Each transaction is validated, applied atomically, and returns an RFC 6901 diff plus the exact layer and source IDs that changed.
- **Work with live maps** — run bounded map commands and query source or rendered features, with explicit truncation instead of unbounded results.

Inspection and validation never touch the network. When a style references a URL, the authority you chose decides what happens — the CLI, for example, reads only local files.

## Which interface should I use?

All interfaces run the same five capabilities. Pick by where your code runs:

| Interface | Import | Your situation |
| --- | --- | --- |
| Core | `maplibre-style-tools/core` | You want validation and transactions on style documents, in Node or a bundler, with no map. |
| MapLibre adapter | `maplibre-style-tools/maplibre` | Your application owns a `map` and applies changes to it in-process. |
| Capabilities | `maplibre-style-tools/capabilities` | You build your own transport on top of the five executors and their schemas. |
| AI SDK | `maplibre-style-tools/ai` | You use the AI SDK and want five ready-made tools over an in-process map. |
| WebMCP | `maplibre-style-tools/webmcp` | You want an in-page AI agent in a supporting browser to drive the page's own map — no server involved. |
| MCP server | `maplibre-style-tools/mcp` | An external MCP host should handle offline style sessions, or reach a live map through the bridge. |
| Browser bridge | `maplibre-style-tools/bridge` | Your page connects its map to that MCP host. |
| CLI | `maplibre-style` | You validate, inspect, or rewrite style files from scripts or the terminal. |

The [Guides](../../guides/) have a page for each library entry point; the [CLI reference](../../reference/cli/) covers the command line.

## Where the exact types live

This site explains the supported contracts in prose. For exact field-level shapes, the reference pages link the canonical TypeScript declarations — the [capability contracts](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts), the [bridge protocol](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.ts), and the [MCP/session types](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/types.ts) — so you never have to guess.

Next: [Architecture](../architecture/) for the big picture, or jump straight to [Installation](../../getting-started/installation/).
