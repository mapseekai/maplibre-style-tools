---
title: 软件包入口
description: 在八个受支持的导入入口之间做出选择。
weight: 10
---

软件包公开八个受支持的导入入口。请选择能够覆盖集成所需环境与 Authority 的最窄入口。

## 入口 {#entry-points}

| Specifier | Role |
| --- | --- |
| `maplibre-style-tools` | Non-AI convenience exports |
| `maplibre-style-tools/core` | Pure validation, transactions, GeoJSON, analysis, and discovery |
| `maplibre-style-tools/maplibre` | Live MapLibre mutation, runtime commands, and bounded feature queries |
| `maplibre-style-tools/capabilities` | Five executors, schemas, registry, result envelope, and authorities |
| `maplibre-style-tools/ai` | AI SDK tool factory over an in-process map |
| `maplibre-style-tools/webmcp` | Browser-native page-scoped Site tools |
| `maplibre-style-tools/mcp` | MCP server, sessions, transports, resources, and live extension |
| `maplibre-style-tools/bridge` | Browser-safe live map client, protocol, hashing, and resource policy |

根入口有意保持精简：它重新导出 core 类型以及 `applyStyleTransaction` 和 `validateStyleDocument`。接口专用工厂与适配器应从对应的显式子路径导入。

## Ambient 与运行时边界 {#ambient-runtime-boundaries}

| Specifier | DOM ambient | Node ambient | Runtime dependency |
| --- | ---: | ---: | --- |
| root | No | No | Pure core only |
| `/core` | No | No | None |
| `/maplibre` | Yes | No | In-process MapLibre map |
| `/capabilities` | No | No | Caller-provided authorities |
| `/ai` | Through dependencies | Yes | AI SDK and in-process map |
| `/webmcp` | Yes | No | Browser `document.modelContext` and in-process map |
| `/mcp` | No | Yes | Node MCP host and optional bridge server |
| `/bridge` | Yes | No | Browser map and protected WebSocket endpoint |

“Ambient” 描述通过公开声明边界可见的 TypeScript 全局库，并不表示每次导入都会立即执行运行时工作。

## 选择规则 {#selection-rules}

面向传输无关的 Style 文档时使用 `/core`；应用代码已持有 `Map` 时使用 `/maplibre`；为调用方提供的 Authority 构建自定义接口时使用 `/capabilities`。需要对应集成时使用 `/ai`、`/webmcp` 或 `/mcp`。`/bridge` 只用于受保护实时地图连接的浏览器端；Node bridge server 由 `/mcp` 导出。
