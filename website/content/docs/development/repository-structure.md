---
title: Repository Structure
description: Understand the source areas, examples, scripts, and documentation site.
weight: 10
---

The repository separates reusable capability semantics from the interfaces that present them. Interfaces project shared capability contracts instead of reimplementing semantics.

## Source areas {#source-areas}

| Path | Purpose |
| --- | --- |
| `src/core` | ES-only style inspection, validation, transaction, and document operations. |
| `src/adapters/maplibre` | MapLibre-specific adapters for a live map. |
| `src/capabilities` | Shared capability contracts, schemas, authorities, and registry. |
| `src/ai` | AI SDK facade for the shared capabilities. |
| `src/mcp` | MCP server, sessions, and tool presentation. |
| `src/webmcp` | Browser WebMCP presentation of supported capabilities. |
| `src/bridge` | Browser bridge protocol and live-map connection. |
| `src/cli` | Document-oriented command-line interface. |

## Supporting areas {#supporting-areas}

| Path | Purpose |
| --- | --- |
| `examples` | Runnable AI chat, browser bridge, and WebMCP integrations. |
| `scripts` | Build, package-contract, and test support scripts. |
| `website` | The Hugo documentation site and its bilingual content. |

When a change spans an interface and its behavior, keep the semantics in the shared capability contract and let the interface remain a projection of that contract.
