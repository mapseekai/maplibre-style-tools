---
title: Package Entry Points
description: The eight import specifiers and what each one gives you.
weight: 10
---

The package publishes eight import specifiers. Rule of thumb: import the narrowest one that fits your host — that keeps unneeded globals and dependencies out of your build.

| Specifier | What you get |
| --- | --- |
| `maplibre-style-tools` | The root entry: core types plus `applyStyleTransaction` and `validateStyleDocument` |
| `maplibre-style-tools/core` | Pure validation, transactions, GeoJSON, analysis, and discovery |
| `maplibre-style-tools/maplibre` | Live-map transactions, runtime commands, bounded feature queries |
| `maplibre-style-tools/capabilities` | The five executors, schemas, registry, result envelope, and authority interfaces |
| `maplibre-style-tools/ai` | AI SDK tool factory over an in-process map |
| `maplibre-style-tools/webmcp` | Browser page-scoped Site tools |
| `maplibre-style-tools/mcp` | MCP server, sessions, transports, resources, live extension |
| `maplibre-style-tools/bridge` | Browser-side bridge client, protocol, hashing, resource policy |

The root entry is deliberately small. For anything interface-specific, import the explicit subpath.

## What each entry needs from its host

| Specifier | DOM types | Node types | Needs at runtime |
| --- | --- | --- | --- |
| root | No | No | Nothing — pure core |
| `/core` | No | No | Nothing |
| `/maplibre` | Yes | No | A MapLibre map |
| `/capabilities` | Yes | No | Authorities you provide |
| `/ai` | Via dependencies | Yes | AI SDK 6 and a map |
| `/webmcp` | Yes | No | `document.modelContext` and a map |
| `/mcp` | No | Yes | Node.js |
| `/bridge` | Yes | No | A browser map and the bridge endpoint |

"DOM types" and "Node types" mean which ambient type libraries can surface through the public declarations — not that every import performs runtime work. `/capabilities` lists DOM because its public closure includes `AbortSignal` and MapLibre-backed authority declarations, even when you supply a different authority; it never needs Node types.

## Selection rules

Style documents in Node or a bundler: `/core`. Your code already owns a `Map`: `/maplibre`. Building a custom interface over your own authorities: `/capabilities`. Otherwise the named integration does what it says — `/ai`, `/webmcp`, `/mcp` — and `/bridge` is the browser side of the live-map connection whose server lives in `/mcp`.
