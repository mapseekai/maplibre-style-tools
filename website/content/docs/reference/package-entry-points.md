---
title: Package Entry Points
description: Choose among the eight supported import specifiers.
weight: 10
---

The package exposes eight supported import specifiers. Choose the narrowest entry point that owns the environment and authority your integration needs.

## Entry points {#entry-points}

| Specifier | Role |
| --- | --- |
| `maplibre-style-tools` | Non-AI convenience exports |
| `maplibre-style-tools/core` | Pure validation, transactions, GeoJSON, analysis, and discovery |
| `maplibre-style-tools/maplibre` | Live MapLibre mutation, runtime commands, and bounded feature queries |
| `maplibre-style-tools/capabilities` | Five executors, schemas, registry, result envelope, and authorities |
| `maplibre-style-tools/ai` | AI SDK tool factory over an in-process map |
| `maplibre-style-tools/webmcp` | Browser-native page-scoped Site tools |
| `maplibre-style-tools/mcp` | MCP server, sessions, transports, resources, and live extension |
| `maplibre-style-tools/bridge` | Browser-safe live map client, protocol, hashing, and resource policy |

The root entry is intentionally small: it re-exports core types plus `applyStyleTransaction` and `validateStyleDocument`. Import interface-specific factories and adapters from their explicit subpath.

## Ambient and runtime boundaries {#ambient-runtime-boundaries}

| Specifier | DOM ambient | Node ambient | Runtime dependency |
| --- | ---: | ---: | --- |
| root | No | No | Pure core only |
| `/core` | No | No | None |
| `/maplibre` | Yes | No | In-process MapLibre map |
| `/capabilities` | Yes | No | Caller-provided authorities |
| `/ai` | Through dependencies | Yes | AI SDK and in-process map |
| `/webmcp` | Yes | No | Browser `document.modelContext` and in-process map |
| `/mcp` | No | Yes | Node MCP host and optional bridge server |
| `/bridge` | Yes | No | Browser map and protected WebSocket endpoint |

“Ambient” describes the TypeScript global libraries visible through the public declaration boundary. It does not mean every import immediately performs runtime work. The `/capabilities` declarations expose `AbortSignal` and export `MapStyleAuthority`, whose declaration imports MapLibre types, so consumers need DOM ambient types even when they provide a different authority; the boundary does not require Node ambient types.

## Selection rules {#selection-rules}

Use `/core` for transport-neutral Style documents, `/maplibre` when application code already owns a `Map`, and `/capabilities` when building a custom interface over caller-provided authorities. Use `/ai`, `/webmcp`, or `/mcp` for their named integration. Use `/bridge` only for the browser side of a protected live-map connection; the Node bridge server is exported by `/mcp`.
