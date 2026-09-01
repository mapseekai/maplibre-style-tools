---
title: Repository Structure
description: Where the core, the interfaces, and the supporting code live.
weight: 10
---

One rule organizes the tree: shared capability semantics live in one place, and every interface projects them.

| Path | What lives there |
| --- | --- |
| `src/core` | ES-only style inspection, validation, transactions, document operations |
| `src/capabilities` | Shared capability contracts, schemas, authorities, registry |
| `src/adapters/maplibre` | The live-map adapter |
| `src/ai` | The AI SDK facade |
| `src/mcp` | MCP server, sessions, tool presentation |
| `src/webmcp` | Browser WebMCP presentation |
| `src/bridge` | Browser bridge protocol and connection |
| `src/cli` | The document-oriented CLI |
| `examples` | Runnable AI chat, bridge, and WebMCP integrations |
| `scripts` | Build, package-contract, and test support |
| `website` | This documentation site |

When a change spans an interface and its behavior, put the semantics in the shared contract and keep the interface a projection of it.
