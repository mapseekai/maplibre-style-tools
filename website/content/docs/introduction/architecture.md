---
title: Architecture
description: How the package is organized, and why.
weight: 20
---

The package has three layers, and understanding the layering explains most of its behavior.

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

## The capability registry

Each of the five operations is defined exactly once, in `capabilityRegistry`: its name, its description for the model, its input schema, and the executor that runs it. Every interface is a projection of that definition into its own transport.

The reason is drift. If each interface wrote its own tool descriptions and schemas, the five tools would slowly diverge, and a filter would end up meaning one thing over MCP and another over the CLI. With a single registry, using two interfaces against the same style gives you the same behavior, because it is the same code.

## Authorities

An authority answers the question "who owns the style?" The same `applyStyleTransaction` call works against a local file (the CLI), an in-memory document session (MCP), your own map object (the AI SDK), or a bridged browser map, because each of those implements the same small interface: read the style, supply context, apply a transaction, apply a document. That interface is `StyleAuthority`.

Adding a new integration therefore rarely touches style semantics. Implement the authority, and the five operations work against it.

Two capabilities, `runMapCommand` and `queryMapFeatures`, additionally need a live map through `RuntimeAuthority`. When there is none, they fail with `MAP_NOT_READY` instead of pretending. Document work never needs a map, which is why the CLI can do everything it does offline.

## Type boundaries

Each entry point declares which ambient types it may surface, and the build tests enforce it:

- `/core` is pure ES: no DOM, no Node types.
- `/maplibre`, `/capabilities`, `/webmcp`, and browser `/bridge` allow DOM types but never Node types.
- `/ai` and `/mcp` may use Node types where they need them.

If you import the narrowest entry point that fits your host, the wrong globals cannot leak into your build.

Next: [Capabilities](../capabilities/).
