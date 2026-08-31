---
title: 仓库结构
description: 理解源码区域、示例、脚本与文档站。
weight: 10
---

仓库将可复用的能力语义与呈现它们的接口分离。接口应投影共享能力契约，而不是重新实现语义。

## 源码区域 {#source-areas}

| 路径 | 用途 |
| --- | --- |
| `src/core` | 仅限 ES 的样式检查、验证、事务与文档操作。 |
| `src/adapters/maplibre` | 面向实时地图的 MapLibre 专用适配器。 |
| `src/capabilities` | 共享能力契约、Schema、Authority 与注册表。 |
| `src/ai` | 共享能力的 AI SDK facade。 |
| `src/mcp` | MCP server、session 与工具呈现。 |
| `src/webmcp` | 浏览器 WebMCP 中受支持能力的呈现。 |
| `src/bridge` | 浏览器 bridge protocol 与实时地图连接。 |
| `src/cli` | 面向文档的命令行接口。 |

## 支持区域 {#supporting-areas}

| 路径 | 用途 |
| --- | --- |
| `examples` | 可运行的 AI chat、browser bridge 与 WebMCP 集成。 |
| `scripts` | 构建、package-contract 与测试支持脚本。 |
| `website` | Hugo 文档站及其双语内容。 |

当一次修改跨越接口及其行为时，应将语义保留在共享能力契约中，并让接口保持为该契约的投影。
