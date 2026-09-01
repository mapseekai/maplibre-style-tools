---
title: MCP Server
description: Bounded style sessions and live maps over stdio or protected HTTP.
weight: 50
---

`/mcp` runs an MCP server that external hosts — Claude Desktop, an IDE, your own agent — connect to. It exposes the five capabilities plus session management, and can additionally act on a live browser map through the [bridge](../bridge/). It accepts no style paths or URLs and performs no network fetches.

## Pick a transport

| Transport | For | Command |
| --- | --- | --- |
| stdio | A local host that launches the server | `maplibre-style-mcp --stdio` |
| Streamable HTTP | Trusted clients that can keep a bearer secret | `maplibre-style-mcp --http --bearer-token "$TOKEN"` |

Both enforce the same bounded message policy and return the same capability envelopes.

## stdio keeps stdout clean

```bash
maplibre-style-mcp --stdio
```

Stdout carries only newline-delimited protocol messages; startup diagnostics go to stderr, so your host can parse stdout without filtering log lines. The default message ceiling is 5 MiB, configurable from 128 KiB through 64 MiB via `maxMessageBytes`.

## HTTP is protected by default

```bash
TOKEN='replace-with-a-random-secret'
maplibre-style-mcp --http --bearer-token "$TOKEN"
```

The listener binds `127.0.0.1` on a random port; other interfaces require `--allow-non-loopback`. Every request must carry the bearer token and the exact bound `Host`, and a browser `Origin` must equal the bound origin or an explicit allowlist entry. These checks run before the body is read or a transport is allocated.

## Document sessions: offline style workflows

Open a validated style into a session, apply revisioned transactions against it, close it when done. Sessions are bounded, in-memory, and fully separate from any connected live map. Session IDs are application data, distinct from the MCP transport's own session IDs.

## Live maps arrive through the bridge

Start the host with bridge options and a browser page can register its map as a live target — see the [Browser Bridge guide](../bridge/). Only then do live-map capabilities operate on it; a connected browser never turns an offline session into a live map.

## Next

Field-level DTO shapes: the canonical [MCP/session types](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/types.ts). Bridge setup: [Browser Bridge](../bridge/).
