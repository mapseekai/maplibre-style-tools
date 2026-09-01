---
title: 概览
description: 这个包做什么，哪个接口适合你。
weight: 10
---

`maplibre-style-tools` 让你的应用 —— 以及应用里的 AI Agent —— 通过五个定义清晰的操作检查和编辑 MapLibre GL 样式。不必把裸的 `map.setStyle()` 暴露给模型，而是给它五个输入严格校验、编辑原子化、结果可预期的工具。

## 你能用它做什么

- **检查样式** —— 列出并搜索图层、读取单个图层或源、统计图层数、分析内联 GeoJSON。纯读取，不触发渲染。
- **安全地修改样式** —— 把改动描述成一个事务（`setLayerProperties`、`setLayerFilter`、`addGeoJsonLayer` 等）。事务整体校验、原子应用，返回 RFC 6901 diff 和精确的变更图层/源 ID。
- **操作实时地图** —— 执行有边界的地图命令，查询源要素或已渲染要素；超出限制会显式截断，而不是返回无界结果。

检查与校验完全不联网。样式里出现 URL 时，由你选择的权威源决定如何处理 —— 比如 CLI 只读本地文件。

## 我该用哪个接口？ {#which-interface-should-i-use}

所有接口运行同一套能力，按你的代码在哪里运行来选：

| 接口 | 引入 | 适用场景 |
| --- | --- | --- |
| Core | `maplibre-style-tools/core` | 在 Node 或打包器里校验、事务处理样式文档，不需要地图。 |
| MapLibre 适配器 | `maplibre-style-tools/maplibre` | 应用自己持有 `map`，在进程内把变更应用到地图。 |
| Capabilities | `maplibre-style-tools/capabilities` | 基于五个执行器与 schema 构建你自己的传输层。 |
| AI SDK | `maplibre-style-tools/ai` | 使用 AI SDK，想要五个开箱即用的工具，作用于进程内地图。 |
| WebMCP | `maplibre-style-tools/webmcp` | 让页面内的 AI Agent（在支持的浏览器里）驱动页面自己的地图 —— 无需服务器。 |
| MCP 服务器 | `maplibre-style-tools/mcp` | 让外部 MCP 宿主处理离线样式会话，或经 Bridge 访问实时地图。 |
| 浏览器桥接 | `maplibre-style-tools/bridge` | 页面把自己的地图接入上述 MCP 宿主。 |
| CLI | `maplibre-style` | 在脚本或终端里校验、检查、重写样式文件。 |

[指南](../../guides/)为每个库入口准备了一页；命令行见 [CLI 参考](../../reference/cli/)。

## 精确类型在哪里

本站用文字说明受支持的契约。需要字段级的精确类型时，各参考页都链接了权威的 TypeScript 声明 —— [能力契约](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts)、[bridge 协议](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.ts)、[MCP/会话类型](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/types.ts) —— 不用靠猜。

下一步：看[架构](../architecture/)了解全貌，或直接[安装](../../getting-started/installation/)。
