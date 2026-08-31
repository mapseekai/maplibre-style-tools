---
title: 能力
description: 了解五项共享操作、结果封装与运行时要求。
weight: 30
---

能力层定义同一组具名操作、严格 Schema 和有界结果。每个接口只公开适用于其宿主的子集。

这里的**有界**表示输入与输出受到显式 Schema 以及字节、数量、深度、超时和 Authority 限制的约束。根据具体边界，超限或未获授权的值会被拒绝，或者输出投影会被截断并明确标记。参见[限制与安全](../../reference/limits-and-safety/)。

## 共享注册表 {#shared-registry}

`capabilityRegistry` 是传输无关的事实来源，记录每项能力的描述、输入 Schema、模型输入 Schema、运行时要求和执行器。AI SDK、MCP、WebMCP 和 CLI 集成会将适用的注册表契约投影到各自传输方式中，而不会改变其语义。这表示语义一致，并不承诺每个接口都公开全部五个名称：CLI 面向文档，默认 WebMCP 只公开两个只读工具。

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
