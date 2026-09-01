---
title: 仓库结构
description: 核心、各接口与支撑代码分别在哪里。
weight: 10
---

整棵目录树只有一条组织规则：共享的能力语义放一处，每个接口只是它的投影。

| 路径 | 放什么 |
| --- | --- |
| `src/core` | 仅 ES 的样式检查、校验、事务与文档操作 |
| `src/capabilities` | 共享能力契约、schema、权威源与注册表 |
| `src/adapters/maplibre` | 实时地图适配器 |
| `src/ai` | AI SDK 门面 |
| `src/mcp` | MCP 服务器、会话与工具呈现 |
| `src/webmcp` | 浏览器 WebMCP 呈现 |
| `src/bridge` | 浏览器桥接协议与连接 |
| `src/cli` | 面向文档的 CLI |
| `examples` | 可运行的 AI 聊天、桥接与 WebMCP 集成 |
| `scripts` | 构建、包契约与测试支撑脚本 |
| `website` | 本文档站点 |

当改动同时涉及某个接口和它的行为时，把语义放进共享契约，让接口保持为契约的投影。
