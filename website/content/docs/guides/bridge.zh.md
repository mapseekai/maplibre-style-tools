---
title: 浏览器桥接
description: 安全地将浏览器中的 MapLibre 地图连接到 MCP 实时地图扩展。
weight: 70
---

当 MCP 实时地图扩展需要操作已在浏览器页面中运行的 MapLibre 地图时，请使用 `/bridge`。在受支持的示例与默认拓扑中，browser client 通过受保护的 loopback WebSocket，把这一个地图注册到同一台机器上的独立 MCP 进程。它不是通用的 browser-to-Node export，也不承诺任意跨机器访问。

## 何时使用桥接 {#when-to-use-the-bridge}

在 loopback MCP host 需要已连接实时地图后使用 bridge。当宿主应用拥有地图，且 AI SDK 工具在同一进程运行时，请使用 [`/ai`](../ai-sdk/)。对于不需要 MCP host 的页面级浏览器工具，请使用 [WebMCP](../webmcp/)。即使 bridge-connected 地图可用，离线 MCP Style 会话仍是独立的文档工作流。

## 连接地图 {#connect-a-map}

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

`whenReady()` 仅在认证和注册完成后 resolve。页面提供 map ID、connection token、名为 `capabilities` 的 API property 与 resource policy；这些不会从 model request 中推断。`capabilities` 中的六个字面值是 bridge authorization permission，不是五项可调用 registry capability。

## Bridge 权限 {#capabilities}

授予满足预期操作所需的最小 permission 集。`capabilities` property 接受以下六项 bridge permission：

| Bridge permission | 允许的 registry capability 或 action |
| --- | --- |
| `style.read` | `inspectStyle` 实时地图读取；`runMapCommand` action `listImages` 与 `listSprites`；允许的 bridge result 中的 Style snapshot |
| `style.write` | `applyStyleTransaction`、`applyStyleDocument`，以及 `runMapCommand` action `updateGeoJsonData` |
| `features.query` | `queryMapFeatures` 的 source 与 rendered target |
| `runtime.state` | `runMapCommand` action `setSourceTileLodParams`、`setFeatureState`、`removeFeatureState` 与 `setGlobalState` |
| `assets.write` | `runMapCommand` 的 image 与 sprite mutation action：`addImageFromUrl`、`removeImage`、`addSprite` 与 `removeSprite` |
| `network.load` | 对新的 URL-backed Style document/resource、image 或 sprite 的附加入站许可；它本身不授予操作，且 URL 还必须通过 resource policy |

此映射以规范的[命令权限 switch](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/capabilities.ts)、[资源策略](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/resource-policy.ts)和[映射测试](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/outbound.test.ts)为准。`allowedResourceOrigins` 是独立的资源策略：空列表不会授予 cross-origin 资源加载。完整的 bridge frame 与 command 形状位于规范的[协议声明](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.ts)和[协议测试](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.test.ts)中。

## 启动 MCP bridge host {#start-the-mcp-bridge-host}

```bash
maplibre-style-mcp --stdio \
  --bridge-host 127.0.0.1 \
  --bridge-port 7788 \
  --bridge-origin http://127.0.0.1:5173
```

MCP binary 拥有 loopback WebSocket server 和 live registry。它的 bridge handoff 写入 stderr，而 stdio protocol traffic 仍在 stdout。使用 `--bridge-origin` 提供精确的页面 origin，使 host 仅接纳该 browser origin。此处记录的示例让 browser 与 MCP bridge 进程位于同一台机器上；它没有描述非 loopback bridge 部署。

## Token 与 origin 安全 {#token-and-origin-safety}

token 在第一个 WebSocket frame 中发送，绝不放入 URL。请通过 process-controlled channel 将其提供给页面，且不要写入 page URL、storage、log、status text 或 error。将 bridge host 保持在 loopback，并且只允许显式 origin。

`/bridge` 仅限浏览器，且不导出 Node WebSocket server 或 live registry。Node server 有意由 MCP binary 拥有，因此在页面中导入 `/bridge` 无法创建未受保护的 server。
