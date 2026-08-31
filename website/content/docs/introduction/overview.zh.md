---
title: 概览
description: 了解软件包的用途、支持环境以及如何选择接口。
weight: 10
---

`maplibre-style-tools` 用于帮助软件和 AI Agent 检查与编辑 MapLibre 样式。它提供传输无关的核心、五项共享能力，以及轻量的 AI SDK、MCP、WebMCP 和 CLI 接口。软件包仅提供 ESM，并要求 Node.js `>=22.13.0`。

## 软件包的用途 {#what-it-does}

使用核心可验证样式文档并应用结构化样式事务，无需绑定到某种传输方式或实时地图。能力层让所有接口共享相同的五项操作与严格输入验证。MapLibre 集成会在存在实时地图时提供相应支持。

核心验证和 CLI 验证不会发起网络请求。传给能力的 URL 由其 Authority 处理；基于文件的 CLI Authority 不接受样式 URL。

## 选择接口 {#choose-an-interface}

| 接口 | 运行环境 | 推荐用途 |
| --- | --- | --- |
| Core (`/core`) | 仅 ES | 在传输无关的集成中验证文档、检查数据并应用事务。 |
| MapLibre (`/maplibre`) | 浏览器或 MapLibre 宿主 | 将已准备好的操作应用到实时 MapLibre 地图，并使用有界的实时地图辅助功能。 |
| Capabilities (`/capabilities`) | 任意可提供 Authority 的宿主 | 在不同传输方式之间复用五个执行器、Schema、注册表和结果封装。 |
| AI SDK (`/ai`) | 支持 Node 的 AI SDK 6 宿主 | 将五项能力作为 AI SDK 6 工具暴露给进程内地图。 |
| WebMCP (`/webmcp`) | 浏览器 | 为浏览器内 MapLibre 地图注册页面作用域的 Site 工具。 |
| MCP (`/mcp`) | Node.js | 运行有界 MCP 服务、会话存储和可选实时桥接。 |
| Bridge (`/bridge`) | 浏览器 | 使用浏览器安全的协议支持，将浏览器 MapLibre 地图连接到远程 MCP 宿主。 |
| CLI (`maplibre-style`) | Node.js | 在脚本或终端中验证、检查并转换本地样式文件。 |

MapLibre 对等依赖为 `maplibre-gl` `^6.3.0`。当 AI SDK 6 工具消费者拥有地图时选择 AI SDK 接口；当工具协议承载对话时选择 MCP 或 WebMCP；处理本地文件时选择 CLI。

## 兼容性契约 {#compatibility-contracts}

软件包导出、能力 Schema、结果封装、桥接消息和公开 DTO 都是兼容性契约。输入必须是公开 Schema 接受的 JSON 形状数据；请以原生对象和数组传入结构化数据，而不是将其序列化为字符串。

如需先建立共同术语，请继续阅读[架构](../architecture/)和[能力](../capabilities/)。
