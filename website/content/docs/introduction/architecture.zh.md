---
title: 架构
description: 理解核心、能力注册表、Authority 与各接口如何协作。
weight: 20
---

该架构将能力语义、呈现能力的接口，以及拥有样式或地图的位置分离开来。

## 系统地图 {#system-map}

```text
AI SDK | MCP | WebMCP | CLI
              |
              v
      capabilityRegistry
              |
              v
 StyleAuthority + RuntimeAuthority
              |
              v
 Core document | live MapLibre map | browser bridge
```

`capabilityRegistry` 是共享目录，包含描述、严格输入 Schema、运行时要求和执行器。轻量接口把该目录中适用的子集投影为各自的工具格式，而不是定义彼此不同的操作；CLI 与默认 WebMCP 表面有意只公开子集。

## 样式 Authority {#style-authorities}

`StyleAuthority` 负责样式级工作：读取已验证的样式、提供上下文中的选中数据、应用事务，以及应用完整样式文档。其实现可以是进程内 MapLibre 地图、MCP 会话存储、桥接的实时地图或本地 CLI 样式文件。

这个边界让核心保持一致的样式语义，同时让每个接口决定当前样式存放的位置及其应用方式。

## 运行时 Authority {#runtime-authorities}

`RuntimeAuthority` 仅在存在实时地图时可用。它提供运行时地图命令，以及有界的源要素和已渲染要素查询。注册表会标记需要它的能力，因此面向文档的环境无需附加地图也能使用前三项操作。

## Ambient 类型边界 {#ambient-type-boundaries}

- `/core` 仅限 ES。
- `/maplibre`、`/capabilities`、`/webmcp` 和浏览器 `/bridge` 支持 DOM，但不包含 Node ambient 类型。
- `/mcp` 与 `/ai` 在需要时支持 Node。

这些边界是公开集成契约的一部分：应导入与宿主环境匹配的最窄入口点。`/capabilities` 公开 `AbortSignal` 与 MapLibre-backed Authority 声明，因此即使调用方提供其他 Authority，其公开声明闭包仍需要 DOM 类型。

接下来请阅读[共享能力模型](../capabilities/)。
