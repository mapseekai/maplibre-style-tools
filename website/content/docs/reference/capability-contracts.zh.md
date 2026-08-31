---
title: 能力契约
description: 比较输入、输出、Authority 要求与接口可用性。
weight: 30
---

五项公开能力共享同一个注册表、严格 Schema 与统一结果封装。下表是公开输入类型与成功数据类型的兼容性矩阵。

## 能力矩阵 {#capability-matrix}

| Capability | Input type | Success data | Runtime | AI SDK | MCP | WebMCP | CLI |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `inspectStyle` | `InspectStyleInput` | `InspectionProjection` | No | Yes | Yes | Default | `inspect`; `validate` covers validation actions |
| `applyStyleTransaction` | `ApplyStyleTransactionInput` | `StyleMutationReceipt` | No | Yes | Yes | `allowMutations` | `apply` |
| `applyStyleDocument` | `ApplyStyleDocumentInput` | `StyleMutationReceipt` | No | Yes | Yes | `allowMutations` | No |
| `runMapCommand` | `RunMapCommandInput` | `MapCommandReceipt` | Yes | Yes | Yes | `allowMutations` | No |
| `queryMapFeatures` | `QueryMapFeaturesInput` | `FeatureQueryProjection` | Yes | Yes | Yes | Default | No |

“Runtime” 表示需要实时 MapLibre 地图。AI SDK facade 在进程内地图上提供全部五项工具。MCP 公开全部五个能力名称，并额外公开 session 管理。

## Authority 要求 {#authority-requirements}

| Capability | Required authority |
| --- | --- |
| `inspectStyle` | `StyleAuthority`; authority-free for document and transaction validation or GeoJSON analysis |
| `applyStyleTransaction` | `StyleAuthority.applyTransaction()` |
| `applyStyleDocument` | `StyleAuthority.applyDocument()` |
| `runMapCommand` | `RuntimeAuthority.runtimeCommands()` |
| `queryMapFeatures` | `RuntimeAuthority.querySourceFeatures()` or `RuntimeAuthority.queryRenderedFeatures()` |

`AuthoritySource` 会延迟解析，并可返回 `null`；依赖 Authority 的执行随后返回 `MAP_NOT_READY`。MCP 可以选择 Style session Authority 或实时 bridge map Authority。仅运行时能力要求 map target。

## 输入 Schema {#input-schemas}

能力 Schema 接受原生 JSON 值并使用严格对象，因此未知字段会被拒绝。`capabilityRegistry` 同时提供执行 `inputSchema` 与面向模型的 `modelInputSchema`；执行时始终会在能力边界再次验证。

`InspectStyleInput` 选择一个检查动作。`ApplyStyleTransactionInput` 携带事务以及可选的 `dryRun` 和 `diff`。`ApplyStyleDocumentInput` 选择内联 Style 或绝对 URL。运行时命令与要素查询输入分别由 `action` 或 `target` 区分。

## 接口可用性 {#interface-availability}

WebMCP 默认注册 `inspectStyle` 与 `queryMapFeatures`。它的变更工具是选择性启用的：只有 `allowMutations` 为 `true` 时，才会注册 `applyStyleTransaction`、`applyStyleDocument` 和 `runMapCommand`。CLI 有意保持面向文档，不公开整文档替换或实时运行时操作。
