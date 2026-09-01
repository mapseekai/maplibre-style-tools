---
title: Architecture
description: One capability layer, thin interfaces, and the authority that owns the style.
weight: 20
---

The package has one rule: the five capabilities are defined once, and every interface — AI SDK, MCP, WebMCP, CLI — is a thin projection of that same definition. Nothing re-implements style semantics per interface.

```text
your code · an AI model · an MCP host
              |
              v
   AI SDK | MCP | WebMCP | CLI            thin interfaces
              |
              v
        capabilityRegistry                one source of truth:
              |                           names, schemas, executors
              v
  StyleAuthority + RuntimeAuthority       who owns the style or map?
              |
              v
 style document  |  live MapLibre map
```

## The pieces

**The capability registry** holds each capability's name, description, input schema, and executor. When a new interface appears, it projects the registry instead of inventing new operations — which is why a transaction means the same thing whether it arrives from the CLI or from an AI SDK tool call.

**A StyleAuthority decides where the style lives.** The built-in choices are an in-process map (AI SDK), an MCP document session, a bridged browser map, or a local file (CLI). You can implement your own.

**A RuntimeAuthority exists only while a live map is attached.** The two capabilities that need one (`runMapCommand`, `queryMapFeatures`) report `MAP_NOT_READY` when there is none; document work keeps working without a map.

## Type boundaries you can rely on

Each entry point declares which ambient types it may surface, and the build tests enforce it:

- `/core` — pure ES. No DOM, no Node types.
- `/maplibre`, `/capabilities`, `/webmcp`, `/bridge` — DOM types allowed, Node types never.
- `/ai`, `/mcp` — Node types where needed.

Import the narrowest entry point that fits your host, and the wrong globals can never leak into your build.

Next: [Capabilities](../capabilities/).
