---
title: 浏览器桥接
description: 让 MCP 实时地图扩展操作页面里运行中的地图。
weight: 70
---

桥接把浏览器页面里的 MapLibre 地图，经受保护的 loopback WebSocket 接到 `maplibre-style-mcp` 的实时地图扩展上。浏览器始终是权威：页面决定暴露什么、用 token 认证，每个新的网络资源都要过你的资源策略。

受支持的拓扑是浏览器和 MCP 进程在同一台机器上 —— 例如你的 dev server 在 `http://127.0.0.1:5173`，桥接在 `ws://127.0.0.1:7788`。如果 AI 工具本来就能和地图跑在同一个进程里，直接用 [`/ai`](../ai-sdk/) 更简单。

## 从页面连接

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

`whenReady()` 只在认证和注册都完成后才 resolve。连接的一切都来自你的显式配置，模型请求无法推断 —— 地图 ID、token、权限都由页面给出。

## 显式授予权限 {#capabilities}

`capabilities` 接受六种桥接权限；按最小够用原则授予：

| 权限 | 允许的操作 |
| --- | --- |
| `style.read` | `inspectStyle` 实时读取；`runMapCommand` 的 `listImages`/`listSprites`；结果中允许的样式快照 |
| `style.write` | `applyStyleTransaction`、`applyStyleDocument`、`runMapCommand` 的 `updateGeoJsonData` |
| `features.query` | `queryMapFeatures`（源要素与已渲染要素） |
| `runtime.state` | `runMapCommand` 状态操作：`setSourceTileLodParams`、`setFeatureState`、`removeFeatureState`、`setGlobalState` |
| `assets.write` | `runMapCommand` 图像与 sprite 操作：`addImageFromUrl`、`removeImage`、`addSprite`、`removeSprite` |
| `network.load` | 为新的 URL 资源（样式文档、图像、sprite）开放额外准入 —— 本身不授权任何操作，URL 还必须通过资源策略 |

`allowedResourceOrigins` 是另一层资源策略：空列表意味着阻止新的跨域资源加载。权威映射见[权限开关](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/capabilities.ts)与[资源策略](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/resource-policy.ts)。

## 启动 MCP 侧

```bash
maplibre-style-mcp --stdio \
  --bridge-host 127.0.0.1 \
  --bridge-port 7788 \
  --bridge-origin http://127.0.0.1:5173
```

MCP 可执行文件持有 loopback WebSocket 服务器和实时注册表。两个组件就绪后，stderr 恰好写出一条交接记录（`event: "bridge_listening"` 和实际绑定的 `wsUrl`）；stdout 始终只承载 MCP 协议流量。提供 `--bridge-origin`，宿主就只放行这个浏览器源。

## 把 token 当秘密对待

token 走第一个 WebSocket 帧 —— 永远不出现在 URL 里。通过你的进程可控渠道把它交给页面，别放进页面 URL、存储、日志、状态文案或错误信息。

`/bridge` 是浏览器侧入口，不导出任何服务器代码：在页面里引入它不可能开出 socket。Node 侧归 MCP 可执行文件所有。

## 下一步

实时失败码（`REVISION_CONFLICT`、`BRIDGE_DISCONNECTED` 等）见[结果与错误](../../reference/results-and-errors/)；消息与资源限制见[限制与安全](../../reference/limits-and-safety/)。
