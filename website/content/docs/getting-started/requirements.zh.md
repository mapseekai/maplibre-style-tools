---
title: 环境要求
description: 了解运行时、Peer Dependency 与各接口的具体要求。
weight: 10
---

请先了解这些要求，再选择接口。有关共享术语，请阅读[概览](../introduction/overview/)和[能力](../introduction/capabilities/)。

## 运行时 {#runtime}

`maplibre-style-tools` 仅提供 ESM，并要求 Node.js `>=22.13.0`。导入软件包时，请使用支持 ESM 的工具链。

## Peer Dependency {#peer-dependencies}

使用 MapLibre 集成的项目需要安装 `maplibre-gl` `^6.3.0`。软件包将它声明为 Peer Dependency，因此应用程序负责选择 MapLibre 运行时版本。

## 各接口的具体要求 {#interface-specific-requirements}

面向浏览器的 `/maplibre`、`/bridge` 和 `/webmcp` 入口应在浏览器或 MapLibre 宿主中使用。面向 Node 的 `/ai` 和 `/mcp` 入口可以使用 Node 类型；CLI 同样运行于 Node.js。AI SDK 接口需要支持 Node 的 AI SDK 6 宿主以及 AI SDK `^6.0.141`。

请选择与任务 Authority 相符的接口：AI SDK 工具使用进程内地图，CLI 使用本地 Style 文件。
