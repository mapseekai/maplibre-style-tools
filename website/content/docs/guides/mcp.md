---
title: MCP Server
description: Serve bounded Style sessions and live maps over stdio or protected HTTP.
weight: 50
---

Use `/mcp` for an MCP host that needs bounded offline Style sessions, or a connected browser map through the live-map extension. It exposes the five shared capabilities plus session-management tools; it does not accept a Style path or URL and does not fetch network input.

## Choose a transport {#choose-a-transport}

Use stdio for a local MCP host that launches the server. Use protected Streamable HTTP only for trusted clients that can keep a bearer secret. Both transports enforce the same bounded message policy and capability result envelopes.

## Stdio {#stdio}

```bash
maplibre-style-mcp --stdio
```

Stdout is reserved for newline-delimited protocol messages. Startup diagnostics go to stderr, so a host can parse stdout without log contamination. The default MCP message limit is 5 MiB; embedders may configure `maxMessageBytes` from 128 KiB through 64 MiB.

## Protected HTTP {#protected-http}

```bash
TOKEN='replace-with-a-random-secret'
maplibre-style-mcp --http --bearer-token "$TOKEN"
```

HTTP binds to loopback (`127.0.0.1`) by default. A non-loopback bind requires `--allow-non-loopback` and must retain bearer and origin checks. Every request needs the bearer token and exact bound `Host`; when a browser sends `Origin`, it must match the bound origin or an explicit allowed-origin entry. These headers are checked before the body is read or an MCP transport is allocated.

## Document sessions {#document-sessions}

Style sessions are bounded, in-memory document workflows. Open a validated Style into a session, operate on its revisioned document, and close it when finished. Session identifiers are application data, distinct from MCP transport-session identifiers. Session targets remain offline even when a browser map is also connected.

## Live-map extension {#live-map-extension}

The live-map extension lets MCP tools target a browser map connected through the [Browser Bridge](../bridge/). Start the MCP host with bridge options, then grant only the bridge capabilities and resource origins the page needs. The extension does not turn an offline session into a live map: a live target must be registered by a connected browser client.
