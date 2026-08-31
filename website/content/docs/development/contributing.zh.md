---
title: 贡献指南
description: 在不破坏公开契约的前提下进行聚焦修改。
weight: 40
---

贡献应保持外科手术式的精确：每一处修改都应服务于所请求的行为，不进行无关清理或推测性的抽象。

## 聚焦修改 {#focused-changes}

保留既有架构与术语。将共享能力语义保留在其契约中，避免在接口中重新实现。行为变更应添加或更新聚焦测试；仓库使用现有的 Node.js `node:test` infrastructure。

## 兼容性承诺 {#compatibility-commitments}

公开 exports、capability schemas、result envelopes、bridge protocol messages 与 public DTOs 都是兼容性敏感项。应谨慎对待它们的变更。本站总结受支持契约；修改字段级形状前，请审阅规范的[能力声明与 DTO](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts)、[能力 Schema 测试](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/schemas.test.ts)、[bridge protocol 声明](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.ts)、[bridge protocol 测试](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.test.ts)、[MCP/session DTO](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/types.ts)与 [MCP contract tests](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/contract.test.ts)。除非修改明确要求迁移，否则保留 ESM-only `tsc -b` build、package formats、runtime requirements 与 testing frameworks。

在创建或选择工作前，请查看 [issue tracker](https://github.com/mapseekai/maplibre-style-tools/issues)。当仓库的 release process 要求时，请将用户可见变更记录到 [CHANGELOG](https://github.com/mapseekai/maplibre-style-tools/blob/main/CHANGELOG.md)。
