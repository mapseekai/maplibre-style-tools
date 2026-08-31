---
title: Architecture
description: How the core, capability registry, authorities, and interfaces fit together.
weight: 20
---

The architecture separates capability semantics from the interface that presents them and from the place that owns a style or map.

## System map {#system-map}

```text
AI SDK | MCP | WebMCP | CLI
              |
              v
      capabilityRegistry
              |
              v
 StyleAuthority + RuntimeAuthority
              |
              v
 Core document | live MapLibre map | browser bridge
```

The `capabilityRegistry` is the shared catalogue of descriptions, strict input schemas, runtime requirements, and executors. Thin interfaces project that catalogue into their own tool format instead of defining divergent operations.

## Style authorities {#style-authorities}

A `StyleAuthority` owns style-level work: it reads a validated style, supplies contextual selection data, applies a transaction, and applies a complete style document. Implementations can be an in-process MapLibre map, an MCP session store, a bridged live map, or a local CLI style file.

This boundary lets the core keep style semantics consistent while each interface decides where the current style lives and how it is applied.

## Runtime authorities {#runtime-authorities}

A `RuntimeAuthority` is available only when a live map exists. It supplies runtime map commands plus bounded source and rendered feature queries. The registry marks capabilities that require it, so document-oriented environments can still use the first three operations without attaching a map.

## Ambient type boundaries {#ambient-type-boundaries}

- `/core` is ES-only.
- `/maplibre`, `/webmcp`, and browser `/bridge` are DOM-capable without Node ambient types.
- `/mcp` and `/ai` are Node-capable where required.

These boundaries are part of the public integration contract: import the narrowest entry point that fits the host environment.

Next, see the [shared capability model](../capabilities/).
