---
title: 能力注册表
description: 使用传输无关的执行器、Schema 与 Authority 接口。
weight: 30
---

`/capabilities` 入口提供各接口专用软件包背后的传输无关层。当集成需要相同的命名操作与结果语义，而不采用 AI SDK、MCP、WebMCP 或 CLI 的呈现细节时，它很有用。共享结果封装请参阅[能力概览](../../introduction/capabilities/)。

## 注册表存在的原因 {#why-the-registry-exists}

`capabilityRegistry` 是能力名称、描述、Schema、运行时要求和执行的单一来源。集成会将此注册表投影到自己的传输层，而不会重新定义这五项操作。

| Capability | `requiresRuntime` | Mutation behavior | Authority member |
| --- | ---: | --- | --- |
| `inspectStyle` | `false` | Read-only | `readStyle()` and `context()` |
| `applyStyleTransaction` | `false` | Mutates atomically | `applyTransaction()` |
| `applyStyleDocument` | `false` | Replaces the Style | `applyDocument()` |
| `runMapCommand` | `true` | Mixed read/write commands | `runtimeCommands()` |
| `queryMapFeatures` | `true` | Read-only bounded query | `querySourceFeatures()` or `queryRenderedFeatures()` |

## Authority 接口 {#authority-interfaces}

为面向文档的能力提供 `StyleAuthority`。它读取已验证的样式、提供上下文、应用事务并应用完整样式文档。仅为实时地图命令和要素查询添加 `RuntimeAuthority`。`AuthoritySource` 可以返回 `null`；此时能力执行会返回正常的 `MAP_NOT_READY` 失败，而不会替调用方选择样式 Authority。

## 严格的模型 Schema {#strict-model-schemas}

每个注册表项目都带有执行用的 `inputSchema` 和面向模型的 `modelInputSchema`。模型 Schema 会为模型工具定义投影输入形状，而执行 Schema 仍然是严格验证边界。应将已公布的 Schema 视为生成指导，而不是跳过能力验证的许可。

## 直接 OpenAI Schema {#direct-openai-schemas}

`createOpenAiFunctionTools()` 会将注册表投影为不可变的 OpenAI 函数工具定义。它提供能力名称、描述和 JSON Schema 参数，但不会替调用方选择样式 Authority。请将这些定义与 Authority 配对，并在自己的传输处理程序中调用相应的注册表执行器。

## 直接 Anthropic Schema {#direct-anthropic-schemas}

`createAnthropicTools()` 会将同一定义投影为带有 `name`、`description` 和 `input_schema` 的 Anthropic 工具对象。和 OpenAI 帮助函数一样，它仅是定义投影：不会附加地图、选择 Authority 或执行能力。
