---
title: Ambient 类型边界
description: 每次改动都必须遵守的 ES-only、DOM、Node 分界线。
weight: 20
---

Ambient 类型是公开契约的一部分：每个入口暴露的声明，不能带出消费者从未同意的全局类型。测试强制执行下表。

| 区域 | 允许的 ambient 类型 |
| --- | --- |
| `/core` | 无 —— 纯 ES |
| `/maplibre`、`/capabilities`、`/webmcp`、浏览器端 `/bridge` | 允许 DOM，禁止 Node |
| `/mcp`、`/ai` | 按需允许 Node |

`/capabilities` 划在 DOM 行是设计使然：它的公开闭包含 `AbortSignal` 和 MapLibre 权威源声明，同时保持不依赖 Node。

重构时让每个区域留在自己的行内 —— 纯 ES 消费者绝不能带进 DOM 或 Node 声明，面向浏览器的声明绝不能带进 Node 声明。
