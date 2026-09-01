---
title: 包入口
description: 八个导入路径，各自提供什么。
weight: 10
---

包发布了八个导入路径。经验法则：选适配宿主的最窄入口 —— 不需要的全局变量和依赖就进不了你的构建。

| 路径 | 提供什么 |
| --- | --- |
| `maplibre-style-tools` | 根入口：核心类型加上 `applyStyleTransaction` 和 `validateStyleDocument` |
| `maplibre-style-tools/core` | 纯净的校验、事务、GeoJSON、分析与发现 |
| `maplibre-style-tools/maplibre` | 实时地图事务、运行时命令、有界要素查询 |
| `maplibre-style-tools/capabilities` | 五个执行器、schema、注册表、结果信封与权威源接口 |
| `maplibre-style-tools/ai` | 作用于进程内地图的 AI SDK 工具工厂 |
| `maplibre-style-tools/webmcp` | 浏览器页面作用域 Site tools |
| `maplibre-style-tools/mcp` | MCP 服务器、会话、传输、资源、实时扩展 |
| `maplibre-style-tools/bridge` | 浏览器侧桥接客户端、协议、哈希与资源策略 |

根入口刻意很小。任何接口相关的东西，都从对应的显式子路径引入。

## 各入口对宿主的要求

| 路径 | DOM 类型 | Node 类型 | 运行时需要 |
| --- | --- | --- | --- |
| 根入口 | 否 | 否 | 无 —— 纯核心 |
| `/core` | 否 | 否 | 无 |
| `/maplibre` | 是 | 否 | 一个 MapLibre 地图 |
| `/capabilities` | 是 | 否 | 你提供的权威源 |
| `/ai` | 经依赖引入 | 是 | AI SDK 6 和地图 |
| `/webmcp` | 是 | 否 | `document.modelContext` 和地图 |
| `/mcp` | 否 | 是 | Node.js |
| `/bridge` | 是 | 否 | 浏览器地图和桥接端点 |

"DOM 类型"/"Node 类型"指公开声明可能带出的 ambient 类型库 —— 不代表每次导入都会执行运行时工作。`/capabilities` 列 DOM 是因为它的公开闭包含 `AbortSignal` 和 MapLibre 权威源声明，即使你提供别的权威源也是如此；它永远不需要 Node 类型。

## 选择规则

在 Node 或打包器里处理样式文档：`/core`。代码已经持有 `Map`：`/maplibre`。基于自己的权威源构建自定义接口：`/capabilities`。其余按名字对号入座 —— `/ai`、`/webmcp`、`/mcp` —— 而 `/bridge` 是实时地图连接的浏览器侧，Node 侧服务器在 `/mcp` 里。
