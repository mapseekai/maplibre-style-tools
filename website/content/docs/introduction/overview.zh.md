---
title: 概览
description: 这个库为什么存在，应该怎么理解它。
weight: 10
---

`maplibre-style-tools` 的存在只有一个目的：让 AI Agent 能够读取和修改 MapLibre 样式，同时不把样式置于危险之中。这个库就是为此而写的。Agent 是这里的第一调用方，从五个操作到错误信息的形状，一切都是围绕"AI 能被信任做什么、不能被信任做什么"来设计的。

## 没有它会出什么问题

假设你的应用里有一张 MapLibre 地图，你想让一个助手处理"把水系调蓝一点"、"隐藏 POI 标注"这类请求。最直接的做法是把地图对象交给模型，或者给它一个裸的 `setStyle`。一开始能用，然后：

- 模型编造了一个不存在的图层 ID。没有任何东西校验它，请求照常通过，样式悄悄错了。
- 它把过滤器编码成了 JSON 字符串，而不是表达式数组。很久之后，一个解析错误出现在离真正错误很远的地方。
- 它的三个操作成功了两个、失败了一个。样式改了一半，没人说得清是哪一半。
- 为了决定怎么改，模型请求"整个样式"，然后收到了完整文档：所有源、所有图层，把上下文窗口塞满了它根本用不上的数据。
- 模型还在思考的时候，用户在另一个标签页改了地图。这次编辑落在一个已经不存在的样式上。

这些都不是罕见情况。把一个概率性的调用方接到命令式的渲染 API 上，就会出现这些事。所以这个包不把地图暴露出去，而是把一个谨慎的人类操作员会遵循的工作流暴露出去：先看清楚，再做有把握的修改，然后核实到底改了什么。

## 五个操作

其中三个作用于样式文档，两个需要实时地图：

| 能力 | 做什么 | 需要实时地图 |
| --- | --- | --- |
| `inspectStyle` | 读取样式的紧凑投影：图层、源、数量、上下文。也可以在不碰任何东西的前提下校验文档、事务或内联 GeoJSON。 | 否 |
| `applyStyleTransaction` | 应用一组结构化编辑，比如改 paint 属性、设过滤器、加图层。整组原子生效：要么全部提交，要么全部不提交。 | 否 |
| `applyStyleDocument` | 整体替换样式文档。 | 否 |
| `runMapCommand` | 一组有边界的实时地图命令：要素状态、图像与 sprite 管理、增量 GeoJSON 更新、瓦片 LOD 参数。 | 是 |
| `queryMapFeatures` | 查询源要素或已渲染要素，返回量有硬性上限。 | 是 |

一次典型的 Agent 对话用前两个就够。模型先调 `inspectStyle` 看清样式里到底有什么，拿回来的是有界的投影而不是整个文档，所以答案装得进上下文窗口。然后它把计划好的修改交给 `applyStyleTransaction`，拿回一张回执：明确列出哪些图层和源变了，附一条可以原样引用给用户的 RFC 6901 diff。如果事务里某个操作不合法，比如引用了不存在的图层 ID，那么什么都没有被应用。失败结果带着 `NOT_FOUND` 这样的错误码和一个指向问题值的 JSON 指针，模型可以自己修正再试，而这期间用户的样式从未处于危险之中。

严格的输入校验服务于同一个目的。模型生成的 JSON 并不完美：字段被字符串化、冒出未知键、数字以字符串形式出现。schema 会在请求碰到你的地图之前把这一切拒掉。一次坏调用的代价是一条具体、快速的 `INVALID_INPUT` 错误，而不是一个坏掉的样式。

## 同样的五个操作，Agent 在哪里都一样

Agent 连接地图的方式不止一种，所以这套操作被投影成了几个接口。定义只有一份，都来自同一个注册表 —— 同一个事务，不管从哪条传输进来，含义都相同：

| 接口 | 引入 | 适用场景 |
| --- | --- | --- |
| Core | `maplibre-style-tools/core` | 在 Node 或打包器里对样式文档做校验和事务，不涉及地图。 |
| MapLibre 适配器 | `maplibre-style-tools/maplibre` | 应用自己持有 `map`，在进程内把变更应用到地图。 |
| Capabilities | `maplibre-style-tools/capabilities` | 基于五个执行器与 schema 构建你自己的传输层。 |
| AI SDK | `maplibre-style-tools/ai` | 使用 AI SDK，想要五个现成工具，作用于进程内地图。 |
| WebMCP | `maplibre-style-tools/webmcp` | 页面要给同一个浏览器里的 AI Agent 暴露工具，不需要服务器。 |
| MCP 服务器 | `maplibre-style-tools/mcp` | 让外部 MCP 宿主（桌面应用、IDE）处理离线样式会话，或访问实时地图。 |
| 浏览器桥接 | `maplibre-style-tools/bridge` | 页面把自己的地图接入上述 MCP 宿主。 |
| CLI | `maplibre-style` | 在脚本或终端里校验、检查、重写样式文件。 |

[指南](../../guides/)为每个库入口准备了一页；命令行见 [CLI 参考](../../reference/cli/)。

## 精确类型在哪里

本站用文字说明受支持的契约。需要字段级细节时，各参考页都链接了权威的 TypeScript 声明，比如[能力契约](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts)、[bridge 协议](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.ts)、[MCP/会话类型](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/types.ts)。

下一步：[架构](../architecture/)解释这个包是如何组织的；也可以直接跳到[安装](../../getting-started/installation/)。
