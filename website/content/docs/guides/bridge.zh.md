---
title: 浏览器桥接
description: 安全地将浏览器中的 MapLibre 地图连接到 MCP 实时地图扩展。
weight: 70
---

当 MCP 实时地图扩展需要操作已在浏览器页面中运行的 MapLibre 地图时，请使用 `/bridge`。浏览器 client 会把这一个地图注册到 bridge host；它不是通用的 browser-to-Node export。

## 何时使用桥接 {#when-to-use-the-bridge}

在 MCP host 需要已连接实时地图后使用 bridge。对于不需要 MCP host 的页面级浏览器工具，请使用 [WebMCP](../webmcp/)。即使 bridge-connected 地图可用，离线 MCP Style 会话仍是独立的文档工作流。

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

`whenReady()` 仅在认证和注册完成后 resolve。页面提供 map ID、connection token、capability 和 resource policy；这些不会从 model request 中推断。

## 能力 {#capabilities}

授予满足预期工具所需的最小 capability 集。完整实时地图 parity 使用以上六项：`style.read`、`style.write`、`features.query`、`runtime.state`、`assets.write` 和 `network.load`。`allowedResourceOrigins` 是独立的资源策略：空列表不会授予 cross-origin 资源加载。

## 启动 MCP bridge host {#start-the-mcp-bridge-host}

```bash
maplibre-style-mcp --stdio \
  --bridge-host 127.0.0.1 \
  --bridge-port 7788 \
  --bridge-origin http://127.0.0.1:5173
```

MCP binary 拥有 loopback WebSocket server 和 live registry。它的 bridge handoff 写入 stderr，而 stdio protocol traffic 仍在 stdout。使用 `--bridge-origin` 提供精确的页面 origin，使 host 仅接纳该 browser origin。

## Token 与 origin 安全 {#token-and-origin-safety}

token 在第一个 WebSocket frame 中发送，绝不放入 URL。请通过 process-controlled channel 将其提供给页面，且不要写入 page URL、storage、log、status text 或 error。将 bridge host 保持在 loopback，并且只允许显式 origin。

`/bridge` 仅限浏览器，且不导出 Node WebSocket server 或 live registry。Node server 有意由 MCP binary 拥有，因此在页面中导入 `/bridge` 无法创建未受保护的 server。
