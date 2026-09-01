---
title: Overview
description: Why this package exists, and how to think about it.
weight: 10
---

`maplibre-style-tools` exists so that an AI agent can read and change a MapLibre style without endangering it. That is the whole point of the library. Agents are the primary caller here, and everything in the package, from the five operations down to the shape of an error message, is designed around what an AI can and cannot be trusted to do.

## What goes wrong without it

Say your app has a MapLibre map, and you want an assistant to handle requests like "make the water bluer" or "hide the POI labels". The direct approach is to give the model access to the map object, or a raw `setStyle` escape hatch. That works until it doesn't:

- The model invents a layer ID. Nothing checks it, so the request goes through and the style is silently wrong.
- It sends a filter as a JSON-encoded string instead of an expression array. Much later, a parse error shows up somewhere far from the actual mistake.
- Two of its three operations succeed and one fails. The style is now half-changed, and nobody can say which half.
- To decide what to do, the model asks for "the style" and receives the entire document, every source and every layer, filling the context window with data it never needed.
- While the model was thinking, the user changed something in another tab. The edit lands on a style that no longer exists.

None of this is exotic. It is just what happens when you point a probabilistic caller at an imperative rendering API. So this package does not expose the map. It exposes the workflow you would want a careful human operator to follow, which is: look first, change deliberately, verify what actually changed.

## The five operations

Three of them work on the style document, and two need a live map:

| Capability | What it does | Live map |
| --- | --- | --- |
| `inspectStyle` | Read a compact projection of the style: layers, sources, counts, context. Can also validate a document, a transaction, or inline GeoJSON without touching anything. | No |
| `applyStyleTransaction` | Apply a list of structured edits, such as changing paint properties, setting a filter, or adding a layer. The list is applied atomically: all of it commits, or none of it does. | No |
| `applyStyleDocument` | Replace the whole style document. | No |
| `runMapCommand` | A bounded set of live-map commands: feature state, image and sprite management, incremental GeoJSON updates, tile LOD parameters. | Yes |
| `queryMapFeatures` | Query source or rendered features, with a hard cap on how much comes back. | Yes |

A typical agent exchange uses the first two. The model calls `inspectStyle` to see what the style actually contains. What it gets back is a bounded projection, not the whole document, so the answer fits in a context window. It then calls `applyStyleTransaction` with its planned edits and receives a receipt naming exactly which layers and sources changed, plus an RFC 6901 diff it can quote back to the user. If one operation in the transaction was invalid, say a layer ID that does not exist, nothing was applied at all. The failure comes back with a code like `NOT_FOUND` and a JSON pointer to the offending value, so the model can correct itself and try again, and the user's style was never in danger in the meantime.

The strict input validation serves the same purpose. Models emit JSON, and they emit it imperfectly: fields get stringified, unknown keys appear, numbers arrive as strings. The schemas reject all of that before the request reaches your map. A malformed call costs one fast, specific `INVALID_INPUT` error instead of a broken style.

## The same five operations, wherever your agent lives

Agents connect to a map in different ways, so the operations are projected into several interfaces. The definitions come from one registry, which means a transaction means the same thing over every transport:

| Interface | Import | Your situation |
| --- | --- | --- |
| Core | `maplibre-style-tools/core` | Validation and transactions on style documents in Node or a bundler, no map involved. |
| MapLibre adapter | `maplibre-style-tools/maplibre` | Your application owns a `map` and applies changes to it in-process. |
| Capabilities | `maplibre-style-tools/capabilities` | You build your own transport on top of the five executors and their schemas. |
| AI SDK | `maplibre-style-tools/ai` | You use the AI SDK and want five ready-made tools over an in-process map. |
| WebMCP | `maplibre-style-tools/webmcp` | Your page should expose tools to an AI agent working in the same browser, no server needed. |
| MCP server | `maplibre-style-tools/mcp` | An external MCP host, such as a desktop app or an IDE, should handle offline style sessions or reach a live map. |
| Browser bridge | `maplibre-style-tools/bridge` | Your page connects its map to that MCP host. |
| CLI | `maplibre-style` | You validate, inspect, or rewrite style files from scripts or the terminal. |

The [Guides](../../guides/) have a page for each library entry point; the [CLI reference](../../reference/cli/) covers the command line.

## Where the exact types live

This site explains the supported contracts in prose. When you need field-level detail, the reference pages link the canonical TypeScript declarations, such as the [capability contracts](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts), the [bridge protocol](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.ts), and the [MCP/session types](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/types.ts).

Next: [Architecture](../architecture/) explains how the package is organized, or skip ahead to [Installation](../../getting-started/installation/).
