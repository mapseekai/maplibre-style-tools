---
title: Ambient Type Boundaries
description: The ES-only, DOM-capable, and Node-capable lines every change must respect.
weight: 20
---

Ambient types are part of the public contract: the declarations an entry point exposes must not drag in globals its consumers never signed up for. Tests enforce these rows.

| Area | Ambient types allowed |
| --- | --- |
| `/core` | None — pure ES |
| `/maplibre`, `/capabilities`, `/webmcp`, browser `/bridge` | DOM, never Node |
| `/mcp`, `/ai` | Node where needed |

`/capabilities` sits in the DOM row by design: its public closure exposes `AbortSignal` and MapLibre-backed authority declarations. It stays Node-independent.

When you refactor, keep each area inside its row — an ES-only consumer must never acquire DOM or Node declarations, and browser-facing declarations must never acquire Node ones.
