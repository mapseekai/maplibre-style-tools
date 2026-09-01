---
title: Browser Bridge
description: Let the MCP live-map extension act on a map running in your page.
weight: 70
---

The bridge connects a MapLibre map in a browser page to the live-map extension of `maplibre-style-mcp` over a protected loopback WebSocket. The browser stays the authority: the page decides what to expose, authenticates with a token, and every new network resource passes your resource policy.

The supported topology is a browser and the MCP process on the same machine, for example a dev server on `http://127.0.0.1:5173` and the bridge on `ws://127.0.0.1:7788`. If the AI tools can run in the same process as the map, [`/ai`](../ai-sdk/) is the simpler choice.

## Connect from the page

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

`whenReady()` resolves only after authentication and registration succeed. The connection is never inferred from model requests: the page names the map, supplies the token, and picks the permissions.

## Bridge permissions {#capabilities}

The `capabilities` property takes six bridge permissions. Grant the smallest set the use case needs:

| Permission | Admits |
| --- | --- |
| `style.read` | `inspectStyle` live reads; `runMapCommand` `listImages`/`listSprites`; style snapshots in permitted results |
| `style.write` | `applyStyleTransaction`, `applyStyleDocument`, and `runMapCommand` `updateGeoJsonData` |
| `features.query` | `queryMapFeatures` (source and rendered targets) |
| `runtime.state` | `runMapCommand` state actions: `setSourceTileLodParams`, `setFeatureState`, `removeFeatureState`, `setGlobalState` |
| `assets.write` | `runMapCommand` image and sprite actions: `addImageFromUrl`, `removeImage`, `addSprite`, `removeSprite` |
| `network.load` | Extra admission for new URL-backed style documents, images, and sprites. Never an operation by itself; URLs must also pass resource policy |

`allowedResourceOrigins` is a separate resource policy: an empty list blocks new cross-origin resource loading. The canonical mapping lives in the [permission switch](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/capabilities.ts) and [resource policy](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/resource-policy.ts).

## Start the MCP side

```bash
maplibre-style-mcp --stdio \
  --bridge-host 127.0.0.1 \
  --bridge-port 7788 \
  --bridge-origin http://127.0.0.1:5173
```

The MCP binary owns the loopback WebSocket server and the live registry. Once both components are ready, stderr carries exactly one handoff record (`event: "bridge_listening"` with the bound `wsUrl`); stdout stays reserved for MCP protocol traffic. Supply `--bridge-origin` so the host admits only that browser origin.

## Token handling

The token travels in the first WebSocket frame, never in the URL. Hand it to the page through a channel your process controls, and keep it out of page URLs, storage, logs, status text, and errors.

`/bridge` is browser-only and exports no server, so importing it in a page cannot open a socket. The Node side belongs to the MCP binary.

## Next

Live failure codes (`REVISION_CONFLICT`, `BRIDGE_DISCONNECTED`, and friends) are in [Results and errors](../../reference/results-and-errors/). Message and resource limits are in [Limits and safety](../../reference/limits-and-safety/).
