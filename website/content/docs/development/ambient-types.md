---
title: Ambient Type Boundaries
description: Preserve ES-only, DOM-capable, and Node-capable declaration boundaries.
weight: 20
---

Ambient types are part of the package compatibility contract. Keep each source area within its intended host environment.

## Boundary table {#boundary-table}

| Area | Allowed ambient types |
| --- | --- |
| `/core` | ES only; no DOM or Node |
| `/maplibre`, `/webmcp`, browser `/bridge` | DOM allowed; Node forbidden |
| `/mcp`, `/ai` | Node allowed where required |

## Declaration closure {#declaration-closure}

Public declaration closure is tested. Generic refactors must not leak ambient types across these boundaries: an ES-only consumer must not acquire DOM or Node declarations, and browser-facing declarations must not acquire Node declarations.

Use the narrowest public entry point for the host environment, and keep host-specific imports behind the corresponding boundary.
