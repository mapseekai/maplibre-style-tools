---
title: Browser Bridge
description: Connect a browser MapLibre map to the MCP live-map extension safely.
weight: 70
---

Use `/bridge` when an MCP live-map extension needs to act on a MapLibre map that already runs in a browser page. In the supported example and default topology, the browser client registers that one map with a separate MCP process on the same machine through a protected loopback WebSocket. It is not a general browser-to-Node export or a promise of arbitrary cross-machine access.

## When to use the bridge {#when-to-use-the-bridge}

Use the bridge after a loopback MCP host needs a connected live map. Use [`/ai`](../ai-sdk/) when the host application owns the map and the AI SDK tools run in the same process. For page-scoped browser tools with no MCP host, use [WebMCP](../webmcp/) instead. Offline MCP Style sessions remain separate document workflows even while a bridge-connected map is available.

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

`whenReady()` resolves only after authentication and registration complete. The page supplies the map ID, connection token, the API property named `capabilities`, and resource policy; these are not inferred from model requests. The six literal values in `capabilities` are bridge authorization permissions, not the five callable registry capabilities.

## Bridge permissions {#capabilities}

Grant the smallest permission set that supports the intended operations. The `capabilities` property accepts these six bridge permissions:

| Bridge permission | Registry capability or actions admitted |
| --- | --- |
| `style.read` | `inspectStyle` live-map reads; `runMapCommand` actions `listImages` and `listSprites`; Style snapshots in permitted bridge results |
| `style.write` | `applyStyleTransaction`, `applyStyleDocument`, and `runMapCommand` action `updateGeoJsonData` |
| `features.query` | `queryMapFeatures` source and rendered targets |
| `runtime.state` | `runMapCommand` actions `setSourceTileLodParams`, `setFeatureState`, `removeFeatureState`, and `setGlobalState` |
| `assets.write` | `runMapCommand` image and sprite mutation actions: `addImageFromUrl`, `removeImage`, `addSprite`, and `removeSprite` |
| `network.load` | Additional admission for new URL-backed Style documents/resources, images, or sprites; it never grants an operation by itself and the URL must also pass resource policy |

This mapping follows the canonical [command permission switch](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/capabilities.ts), [resource policy](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/resource-policy.ts), and [mapping tests](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/outbound.test.ts). `allowedResourceOrigins` is a separate resource policy: an empty list does not grant cross-origin resource loading. The complete bridge frame and command shapes live in the canonical [protocol declarations](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.ts) and [protocol tests](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.test.ts).

## Start the MCP bridge host {#start-the-mcp-bridge-host}

```bash
maplibre-style-mcp --stdio \
  --bridge-host 127.0.0.1 \
  --bridge-port 7788 \
  --bridge-origin http://127.0.0.1:5173
```

The MCP binary owns the loopback WebSocket server and live registry. Its bridge handoff is written to stderr, while stdio protocol traffic remains on stdout. Supply the exact page origin with `--bridge-origin` so the host can admit only that browser origin. This documented example keeps the browser and MCP bridge process on the same machine; it does not describe a non-loopback bridge deployment.

## Token and origin safety {#token-and-origin-safety}

The token is sent in the first WebSocket frame, never in the URL. Supply it to the page through a process-controlled channel and do not put it in page URLs, storage, logs, status text, or errors. Keep the bridge host on loopback and allow only explicit origins.

`/bridge` is browser-only and does not export the Node WebSocket server or live registry. The Node server is deliberately owned by the MCP binary, so importing `/bridge` in a page cannot create an unprotected server.
