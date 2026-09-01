---
title: MCP Server
description: Bounded style sessions and live maps over stdio or protected HTTP.
weight: 50
---

`/mcp` runs an MCP server for external hosts such as a desktop app, an IDE, or your own agent. It exposes the five capabilities plus session management, and it can act on a live browser map through the [bridge](../bridge/). It accepts no style paths or URLs and performs no network fetches.

## Transports

| Transport | For | Command |
| --- | --- | --- |
| stdio | A local host that launches the server | `maplibre-style-mcp --stdio` |
| Streamable HTTP | Trusted clients that can protect a bearer token | `maplibre-style-mcp --http --bearer-token "$TOKEN"` |

Both enforce the same bounded message policy and return the same capability envelopes.

## stdio

```bash
maplibre-style-mcp --stdio
```

Stdout carries only newline-delimited protocol messages, and startup diagnostics go to stderr, so a host can parse stdout without filtering log lines. The default message ceiling is 5 MiB, configurable from 128 KiB through 64 MiB via `maxMessageBytes`.

## Streamable HTTP

```bash
TOKEN='replace-with-a-random-secret'
maplibre-style-mcp --http --bearer-token "$TOKEN"
```

The listener binds `127.0.0.1` on a random port; other interfaces require `--allow-non-loopback`. Every request must carry the bearer token and the exact bound `Host`, and a browser `Origin` must equal the bound origin or an explicit allowlist entry. These checks run before the body is read or a transport is allocated.

## Style sessions

Open a validated style into a session, apply revisioned transactions against it, and close it when done. Sessions are bounded and in-memory, and they stay separate from any connected live map. Session IDs are application data, distinct from the MCP transport's own session IDs.

## Live maps through the bridge

Start the host with bridge options, and a browser page can register its map as a live target. See the [Browser Bridge guide](../bridge/). Only a registered browser map becomes a live target; a connected browser never turns an offline session into a live map.

## Next

Field-level DTO shapes are in the canonical [MCP/session types](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/types.ts). Bridge setup is in [Browser Bridge](../bridge/).
