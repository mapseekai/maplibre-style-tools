---
title: 能力
description: 了解五项共享操作、结果封装与运行时要求。
weight: 30
---

能力层为所有接口提供同一组具名操作、严格 Schema 和有界结果。

## 共享注册表 {#shared-registry}

`capabilityRegistry` 是传输无关的事实来源，记录每项能力的描述、输入 Schema、模型输入 Schema、运行时要求和执行器。AI SDK、MCP、WebMCP 和 CLI 集成会将此注册表投影到各自传输方式中，而不会改变其语义。

## 五项能力 {#five-capabilities}

| 能力 | `requiresRuntime` | 用途 |
| --- | ---: | --- |
| `inspectStyle` | `false` | 检查或验证面向样式的文档，并生成有界投影。 |
| `applyStyleTransaction` | `false` | 通过样式 Authority 应用结构化的原子样式事务。 |
| `applyStyleDocument` | `false` | 通过样式 Authority 替换样式文档。 |
| `runMapCommand` | `true` | 对实时地图运行有界命令。 |
| `queryMapFeatures` | `true` | 从实时地图查询有界的源要素或已渲染要素。 |

前三项能力使用 `StyleAuthority`。`runMapCommand` 和 `queryMapFeatures` 还需要实时地图 `RuntimeAuthority`；地图尚未就绪时，它们无法运行。

## 结果封装 {#result-envelope}

每项能力都返回相同的公开结果契约：

```ts
type CapabilityResult<TData> =
  | { success: true; message: string; data: TData }
  | { success: false; message: string; error: StyleToolError };
```

成功结果包含 `data`。失败结果包含由软件包创建的 `StyleToolError`，因此调用方可以在各接口之间以一致方式处理成功与失败。

## 运行时要求 {#runtime-requirements}

输入必须是严格的原生 JSON。嵌套值不得是 JSON 编码字符串：对象、数组、布尔值、数字和 `null` 都应以原生 JSON 值传入。无效输入会在调用能力处理器或地图之前被拒绝。

对文档导向的工作使用 `inspectStyle`、`applyStyleTransaction` 和 `applyStyleDocument`；仅在存在实时 MapLibre 运行时时使用 `runMapCommand` 和 `queryMapFeatures`。
