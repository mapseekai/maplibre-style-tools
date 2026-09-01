---
title: 架构
description: 这个包是如何组织的，为什么这样组织。
weight: 20
---

这个包分三层。理解了分层，它的大部分行为就都能解释了。

```text
your code · an AI model · an MCP host
              |
              v
   AI SDK | MCP | WebMCP | CLI            thin interfaces
              |
              v
        capabilityRegistry                one source of truth:
              |                           names, schemas, executors
              v
  StyleAuthority + RuntimeAuthority       who owns the style or map?
              |
              v
 style document  |  live MapLibre map
```

## 能力注册表

五个操作中的每一个都只在 `capabilityRegistry` 里定义一次：名称、给模型看的描述、输入 schema、执行它的 executor。每个接口都只是把这份定义投影到自己的传输方式上。

这样做是为了防止漂移。如果每个接口各写一套工具描述和 schema，五个工具会慢慢走样，同一个过滤器在 MCP 上是一个意思，到 CLI 上成了另一个意思。只有一份注册表，你用两个接口操作同一个样式，得到的行为完全一致 —— 因为那就是同一份代码。

## 权威源

权威源回答的问题是"样式由谁持有"。同一次 `applyStyleTransaction` 调用，可以作用于本地文件（CLI）、内存中的文档会话（MCP）、你自己的地图对象（AI SDK），或桥接过来的浏览器地图，因为它们都实现了同一个小接口：读取样式、提供上下文、应用事务、应用文档。这个接口叫 `StyleAuthority`。

因此，新增一种集成很少需要碰样式语义：实现一个权威源，五个操作就能作用于它。

其中两个操作 `runMapCommand` 和 `queryMapFeatures` 还需要通过 `RuntimeAuthority` 挂上一个实时地图。没有地图时，它们返回 `MAP_NOT_READY` 失败，而不是装作能用。文档类工作从不需要地图，CLI 才能做到完全离线。

## 类型边界

每个入口都声明了自己可能暴露的 ambient 类型，构建测试强制执行：

- `/core` 是纯 ES：无 DOM，无 Node 类型。
- `/maplibre`、`/capabilities`、`/webmcp` 和浏览器端 `/bridge` 允许 DOM 类型，禁止 Node 类型。
- `/ai` 和 `/mcp` 按需使用 Node 类型。

只要引入适配宿主的最窄入口，错误的全局变量就进不了你的构建。

下一步：[能力](../capabilities/)。
