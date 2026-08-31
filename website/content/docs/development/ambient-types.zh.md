---
title: Ambient Type 边界
description: 保持 ES-only、DOM-capable 与 Node-capable 声明边界。
weight: 20
---

Ambient 类型是 package compatibility contract 的一部分。每个源码区域都应保持在其预期的宿主环境内。

## 边界表 {#boundary-table}

| Area | Allowed ambient types |
| --- | --- |
| `/core` | ES only; no DOM or Node |
| `/maplibre`, `/capabilities`, `/webmcp`, browser `/bridge` | DOM allowed; Node forbidden |
| `/mcp`, `/ai` | Node allowed where required |

## 声明闭包 {#declaration-closure}

公开声明闭包会被测试。通用重构不得让 ambient 类型跨越这些边界：ES-only consumer 不得获得 DOM 或 Node 声明，browser-facing 声明不得获得 Node 声明。`/capabilities` 有意位于 DOM-capable 行，因为其公开闭包暴露 `AbortSignal` 与 MapLibre-backed Authority 声明；它仍与 Node 无关。

应为宿主环境使用最窄的公开入口点，并将宿主专用 import 保持在相应边界之后。
