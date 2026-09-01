---
title: 概览
description: 这个库为什么存在，应该怎么理解它。
weight: 10
---

`maplibre-style-tools` 的存在只有一个目的：让 AI Agent 能够读取和修改 MapLibre 样式，同时不把样式置于危险之中。这就是这个库的立意。Agent 是这里的第一调用方，从五个操作到错误信息的形状，一切都是围绕"AI 能被信任做什么、不能被信任做什么"来设计的。

## 没有它会出什么问题

假设你的应用里有一张 MapLibre 地图，需要让一个助手处理"把水系调蓝一点"、"隐藏 POI 标注"这类请求。最直接的做法是把地图对象交给模型，或允许它直接调用 `setStyle`。实际使用中会以可预见的方式失败：

- 模型编造了一个不存在的图层 ID。没有任何环节校验它，请求照常通过，样式悄悄错了。
- 它把过滤器编码成了 JSON 字符串，而不是表达式数组。之后一个解析错误出现在离真正错误很远的地方。
- 它的三个操作成功了两个、失败了一个。样式只改了一半，且无法确定是哪一半。
- 为了决定怎么改，模型请求"整个样式"，然后收到完整文档：所有源、所有图层，把上下文窗口塞满了它根本用不上的数据。
- 在模型推理期间，用户在另一个标签页修改了地图。这次编辑落在一个已经不存在的样式上。

这些都不是罕见情况，而是把概率性调用方接到命令式渲染 API 上时的预期失败方式。因此这个包不把地图暴露出去，而是把一个谨慎的操作员会遵循的工作流暴露出去：先检查，再做有把握的修改，然后核实实际改动了什么。

## 五个操作

其中三个作用于样式文档，两个需要实时地图：

| 能力 | 做什么 | 需要实时地图 |
| --- | --- | --- |
| `inspectStyle` | 读取样式的紧凑投影：图层、源、数量、上下文。也可以在不改动任何内容的前提下校验文档、事务或内联 GeoJSON。 | 否 |
| `applyStyleTransaction` | 应用一组结构化编辑，例如修改 paint 属性、设置过滤器、添加图层。整组原子生效：要么全部提交，要么全部不提交。 | 否 |
| `applyStyleDocument` | 整体替换样式文档。 | 否 |
| `runMapCommand` | 一组有边界的实时地图命令：要素状态、图像与 sprite 管理、增量 GeoJSON 更新、瓦片 LOD 参数。 | 是 |
| `queryMapFeatures` | 查询源要素或已渲染要素，返回量有硬性上限。 | 是 |

一次典型的 Agent 对话通常只涉及前两个。模型先调用 `inspectStyle` 查看样式的实际内容，得到的是有界投影而不是整个文档，因此结果可以放入上下文窗口。随后它把计划好的修改交给 `applyStyleTransaction`，得到一张回执：明确列出哪些图层和源发生了变化，并附一条可以呈现给用户的 RFC 6901 diff。如果事务中某个操作不合法，例如引用了不存在的图层 ID，则不会有任何内容被应用。失败结果带有 `NOT_FOUND` 这类错误码和指向问题值的 JSON 指针，模型可以据此修正并重试，样式也不会停留在被部分修改的状态。

严格的输入校验服务于同一目的。模型生成的 JSON 并不完美：字段被字符串化、混入未知键、数字以字符串形式出现。schema 会在请求到达你的地图之前把这些全部拒绝。一次格式错误的调用只会产生一条具体的 `INVALID_INPUT` 错误，而不是一个损坏的样式。

## 同样的五个操作，Agent 在哪里都一样

Agent 连接地图的方式不止一种，因此这套操作被投影成了几个接口。定义只有一份，都来自同一个注册表——同一个事务，不管从哪条传输进来，含义都相同：

| 接口 | 引入 | 适用场景 |
| --- | --- | --- |
| Core | `maplibre-style-tools/core` | 在 Node 或打包器里对样式文档做校验和事务，不涉及地图。 |
| MapLibre 适配器 | `maplibre-style-tools/maplibre` | 应用自己持有 `map`，在进程内把变更应用到地图。 |
| Capabilities | `maplibre-style-tools/capabilities` | 基于五个执行器与 schema 构建你自己的传输层。 |
| AI SDK | `maplibre-style-tools/ai` | 使用 AI SDK，获得五个现成工具，作用于进程内地图。 |
| WebMCP | `maplibre-style-tools/webmcp` | 页面向同一浏览器内的 AI Agent 暴露工具，无需服务器。 |
| MCP 服务器 | `maplibre-style-tools/mcp` | 让外部 MCP 宿主（桌面应用、IDE）处理离线样式会话，或访问实时地图。 |
| 浏览器桥接 | `maplibre-style-tools/bridge` | 页面把自己的地图接入上述 MCP 宿主。 |
| CLI | `maplibre-style` | 在脚本或终端中校验、检查、重写样式文件。 |

[指南](../../guides/)为每个库入口准备了一页；命令行见 [CLI 参考](../../reference/cli/)。

## 精确类型在哪里

本站用文字说明受支持的契约。需要字段级细节时，各参考页都链接了权威的 TypeScript 声明，例如[能力契约](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts)、[bridge 协议](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.ts)、[MCP/会话类型](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/types.ts)。

下一步：[架构](../architecture/)解释这个包是如何组织的；或继续阅读[安装](../../getting-started/installation/)。
