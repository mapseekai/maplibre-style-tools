---
title: 参与贡献
description: 做聚焦的改动，守住公开契约。
weight: 40
---

## 改动要外科手术式

每一行改动都应该服务于目标行为。保持现有架构与术语；共享语义放进能力契约，不要在接口里重新实现；不做无关清理，不加投机抽象。任何行为变化都配套新增或更新测试 —— 测试套件跑在 Node 内置的 `node:test` 上。

## 公开契约是兼容性承诺

公开导出、能力 schema、结果信封、bridge 协议消息和公开 DTO 都是兼容性敏感项。改动之前，先看权威声明及其测试：[能力契约](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts)与 [schema 测试](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/schemas.test.ts)、[bridge 协议](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.ts)与[协议测试](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.test.ts)、[MCP/会话类型](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/types.ts)。

## 动手之前

先看[issue 列表](https://github.com/mapseekai/maplibre-style-tools/issues)是否已有相关工作。发布流程要求时，把用户可见的变化记入 [CHANGELOG](https://github.com/mapseekai/maplibre-style-tools/blob/main/CHANGELOG.md)。
