---
title: 架构
description: 一个能力层，薄接口，以及持有样式的权威源。
weight: 20
---

这个包只有一条规则：五个能力只定义一次，AI SDK、MCP、WebMCP、CLI 都是对同一份定义的薄投影。没有任何接口各自实现一套样式语义。

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

## 组成部分

**能力注册表（capabilityRegistry）** 保存每个能力的名称、描述、输入 schema 和执行器。新接口接入时直接投影注册表，而不是另起炉灶 —— 所以同一个事务，无论来自 CLI 还是 AI SDK 工具调用，语义完全一致。

**样式权威源（StyleAuthority）决定样式在哪里。** 内置选项：进程内地图（AI SDK）、MCP 文档会话、桥接的浏览器地图、本地文件（CLI）。你也可以自己实现。

**运行时权威源（RuntimeAuthority）只在挂载了实时地图时存在。** 需要它的两个能力（`runMapCommand`、`queryMapFeatures`）在没有地图时返回 `MAP_NOT_READY`；文档类工作完全不受影响。

## 可以依赖的类型边界

每个入口声明了自己可能暴露的 ambient 类型，构建测试强制执行：

- `/core` —— 纯 ES，无 DOM、无 Node 类型。
- `/maplibre`、`/capabilities`、`/webmcp`、`/bridge`（浏览器端）—— 允许 DOM，禁止 Node。
- `/ai`、`/mcp` —— 按需允许 Node。

选择适配宿主的最窄入口，错误的全局变量就进不了你的构建。

下一步：[能力](../capabilities/)。
