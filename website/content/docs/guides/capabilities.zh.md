---
title: 能力注册表
description: 在五个执行器、schema 和权威源接口之上，构建你自己的传输层。
weight: 30
---

`/capabilities` 面向这样的集成：需要五个操作及其精确语义，但不想绑定 AI SDK、MCP、WebMCP 或 CLI 的现成外壳。你提供权威源，注册表负责其余部分。

## 注册表就是契约

`capabilityRegistry` 保存每个能力的名称、描述、执行 schema、面向模型的 schema、运行时要求和执行器：

| 能力 | 变更行为 | 权威源成员 |
| --- | --- | --- |
| `inspectStyle` | 只读 | `readStyle()` / `context()` |
| `applyStyleTransaction` | 原子变更 | `applyTransaction()` |
| `applyStyleDocument` | 整体替换 | `applyDocument()` |
| `runMapCommand` | 混合读写命令 | `runtimeCommands()` |
| `queryMapFeatures` | 只读有界查询 | `querySourceFeatures()` / `queryRenderedFeatures()` |

把注册表投影进你的传输层 —— OpenAI 工具、内部 RPC，随你 —— 语义都和官方接口完全一致。

## 提供权威源，而不是地图

文档类能力需要 `StyleAuthority`；实时地图类能力还需要 `RuntimeAuthority`。你的 `AuthoritySource` 可以返回 `null` —— 此时执行返回普通的 `MAP_NOT_READY` 失败，不会替调用方挑选权威源。

## 每个能力两个 schema，各司其职

`inputSchema` 是执行器校验的严格边界；`modelInputSchema` 是模型工具定义对外公布的形状。模型 schema 引导生成 —— 执行时依然会重新校验 —— 所以模型再怎么"有创意"，也无法靠编造字段绕过边界。

## OpenAI 与 Anthropic 的纯 schema 投影

`createOpenAiFunctionTools()` 和 `createAnthropicTools()` 把注册表投影成 OpenAI function-tool 与 Anthropic 工具定义，适合直接集成 LLM API。它们只负责定义工具：不挂地图、不执行任何东西。把定义和权威源配对，在你的处理器里调用对应的注册表执行器。

## 下一步

结果信封见[能力概览](../../introduction/capabilities/)；失败处理见[结果与错误](../../reference/results-and-errors/)。
