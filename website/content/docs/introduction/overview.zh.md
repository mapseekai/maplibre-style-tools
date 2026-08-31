---
title: 概览
description: 了解软件包的用途、支持环境以及如何选择接口。
weight: 10
---

`maplibre-style-tools` 用于帮助软件和 AI Agent 检查与编辑 MapLibre 样式。它提供传输无关的核心、五项共享能力，以及轻量的 AI SDK、MCP、WebMCP 和 CLI 接口。软件包仅提供 ESM，并要求 Node.js `>=22.13.0`。

## 软件包的用途 {#what-it-does}

使用核心可验证样式文档并应用结构化样式事务，无需绑定到某种传输方式或实时地图。能力层定义五项共享注册表契约与严格输入验证；每个接口只投影适用于其宿主的子集。MapLibre 集成会在存在实时地图时提供相应支持。

核心验证和 CLI 验证不会发起网络请求。传给能力的 URL 由其 Authority 处理；基于文件的 CLI Authority 不接受样式 URL。

## 选择接口 {#choose-an-interface}

| 接口 | 运行环境 | 推荐用途 |
| --- | --- | --- |
| Core (`/core`) | 仅 ES | 在传输无关的集成中验证文档、检查数据并应用事务。 |
| MapLibre (`/maplibre`) | 浏览器或 MapLibre 宿主 | 将已准备好的操作应用到实时 MapLibre 地图，并使用有界的实时地图辅助功能。 |
| Capabilities (`/capabilities`) | 支持 DOM 且可提供 Authority 的宿主 | 在不同传输方式之间复用五个执行器、Schema、注册表和结果封装；其公开声明闭包需要 DOM ambient 类型，但不需要 Node ambient 类型。 |
| AI SDK (`/ai`) | 支持 Node 的 AI SDK 6 宿主 | 将五项能力作为 AI SDK 6 工具暴露给进程内地图。 |
| WebMCP (`/webmcp`) | 提供 `document.modelContext` 的浏览器 | 为浏览器内 MapLibre 地图注册页面作用域的 WebMCP Site 工具。 |
| MCP (`/mcp`) | Node.js | 运行有界 MCP 服务、会话存储和可选实时桥接。 |
| Bridge (`/bridge`) | 浏览器 | 使用浏览器安全的协议支持，将浏览器 MapLibre 地图连接到受支持的 loopback MCP bridge host。 |
| CLI (`maplibre-style`) | Node.js | 在脚本或终端中验证、检查并转换本地样式文件。 |

MapLibre 对等依赖为 `maplibre-gl` `^6.3.0`。当宿主应用拥有地图，并希望向 AI SDK 6 消费者公开有界工具时，选择 `/ai`。当页面可以通过 `document.modelContext` 注册由浏览器中介的 Site tools 时，选择 `/webmcp`。只有在独立的 loopback MCP host 进程必须访问浏览器地图时才选择 `/bridge`。服务器或离线会话工作流使用 `/mcp`，本地文件使用 CLI。

## 兼容性契约 {#compatibility-contracts}

软件包导出、能力 Schema、结果封装、bridge message 与 public DTO 都是兼容性敏感项。本站提供经过筛选的受支持契约指南，而不是穷尽所有字段的参考。完整形状应以规范的[能力声明](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts)、[bridge protocol](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.ts)和 [MCP/session DTO](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/types.ts)及其相邻测试为准。输入必须是公开 Schema 接受的 JSON 形状数据；请以原生对象和数组传入结构化数据，而不是将其序列化为字符串。

如需先建立共同术语，请继续阅读[架构](../architecture/)和[能力](../capabilities/)。
