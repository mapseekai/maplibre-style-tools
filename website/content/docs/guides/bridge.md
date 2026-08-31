---
title: Browser Bridge
description: Connect a browser MapLibre map to the MCP live-map extension safely.
weight: 70
---

Use `/bridge` when an MCP live-map extension needs to act on a MapLibre map that already runs in a browser page. The browser client registers that one map with the bridge host; it is not a general browser-to-Node export.

## When to use the bridge {#when-to-use-the-bridge}

Use the bridge after an MCP host needs a connected live map. For page-scoped browser tools with no MCP host, use [WebMCP](../webmcp/) instead. Offline MCP Style sessions remain separate document workflows even while a bridge-connected map is available.

## Connect a map {#connect-a-map}

```ts
import { connectMapLibreBridge } from 'maplibre-style-tools/bridge';

const connection = connectMapLibreBridge(map, {
  mapId: 'demo-map',
  url: 'ws://127.0.0.1:7788',
  token: processSuppliedToken,
  capabilities: [
    'style.read', 'style.write', 'features.query', 'runtime.state',
    'assets.write', 'network.load',
  ],
  allowedResourceOrigins: [],
});

await connection.whenReady();
```

`whenReady()` resolves only after authentication and registration complete. The page supplies the map ID, connection token, capabilities, and resource policy; these are not inferred from model requests.

## Capabilities {#capabilities}

Grant the smallest capability set that supports the intended tools. Full live-map parity uses all six shown above: `style.read`, `style.write`, `features.query`, `runtime.state`, `assets.write`, and `network.load`. `allowedResourceOrigins` is a separate resource policy: an empty list does not grant cross-origin resource loading.

## Start the MCP bridge host {#start-the-mcp-bridge-host}

```bash
maplibre-style-mcp --stdio \
  --bridge-host 127.0.0.1 \
  --bridge-port 7788 \
  --bridge-origin http://127.0.0.1:5173
```

The MCP binary owns the loopback WebSocket server and live registry. Its bridge handoff is written to stderr, while stdio protocol traffic remains on stdout. Supply the exact page origin with `--bridge-origin` so the host can admit only that browser origin.

## Token and origin safety {#token-and-origin-safety}

The token is sent in the first WebSocket frame, never in the URL. Supply it to the page through a process-controlled channel and do not put it in page URLs, storage, logs, status text, or errors. Keep the bridge host on loopback and allow only explicit origins.

`/bridge` is browser-only and does not export the Node WebSocket server or live registry. The Node server is deliberately owned by the MCP binary, so importing `/bridge` in a page cannot create an unprotected server.
