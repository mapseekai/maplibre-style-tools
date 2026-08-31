---
title: 能力契约
description: 比较精选的输入/输出指南、Authority 要求与接口可用性。
weight: 30
---

五项公开能力共享同一个注册表、严格 Schema 与统一结果封装。本页是针对公开输入与成功数据类型的精选兼容性指南，并非穷尽所有字段的 API 参考。

## 能力矩阵 {#capability-matrix}

| Capability | Input type | Success data | Runtime | AI SDK | MCP | WebMCP | CLI |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `inspectStyle` | [`InspectStyleInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts#L21) | `InspectionProjection` | No | Yes | Yes | Default | `inspect`; `validate` covers validation actions |
| `applyStyleTransaction` | [`ApplyStyleTransactionInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `StyleMutationReceipt` | No | Yes | Yes | `allowMutations` | `apply` |
| `applyStyleDocument` | [`ApplyStyleDocumentInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `StyleMutationReceipt` | No | Yes | Yes | `allowMutations` | No |
| `runMapCommand` | [`RunMapCommandInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `MapCommandReceipt` | Yes | Yes | Yes | `allowMutations` | No |
| `queryMapFeatures` | [`QueryMapFeaturesInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `FeatureQueryProjection` | Yes | Yes | Yes | Default | No |

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

[`InspectStyleInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts#L21) 是规范且完整的 inspection-action union。`ApplyStyleTransactionInput` 携带事务以及可选的 `dryRun` 和 `diff`。`ApplyStyleDocumentInput` 选择内联 Style 或绝对 URL。运行时命令与要素查询输入分别由 `action` 或 `target` 区分。

每个完整字段与判别分支应以规范的[能力类型声明](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts)、[执行 Schema](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/schemas.ts)和 [Schema 测试](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/schemas.test.ts)为准。事务操作变体与 core result 形状定义在 [core types](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/core/types.ts)中，并由相邻的 core schema 与 operation tests 覆盖。

## `inspectStyle` action 目录 {#inspect-style-actions}

请使用与所需投影或验证相符的 action。`validateDocument`、`validateTransaction` 与 `analyzeGeoJson` 直接处理其输入，不解析 Authority；其他 action 会从选定的 Authority 读取当前 Style。

| Action | 用途 | 关键 selector 或必需输入 |
| --- | --- | --- |
| `listLayers` | 搜索或列出紧凑的 layer summary | 可选 `query`、`type`、`source`、`sourceLayer` 与 `limit` |
| `listSources` | 列出 source definition | 可选 `limit` |
| `getLayer` | 读取一个 layer projection | 必需 `layerId`；可选 `fields`，取值来自 `paint`、`layout`、`filter` 与 `zoom` |
| `getSource` | 读取一个 source definition | 必需 `sourceId` |
| `getRoot` | 读取不含 layer/source collection 的 Style root property | 无 selector |
| `getContext` | 构建紧凑 Style context，其中包含 Authority 提供的 selection context | 可选 `layerLimit` |
| `inspectLayers` | 读取选定 layer 或有界前导集合的详细 projection | 可选 `layerIds`、`fields` 与 `limit` |
| `getLayerCount` | 统计 layer 数量，不返回其 definition | 无 selector |
| `validateDocument` | 验证提供的 Style document | 必需 `style` |
| `validateCurrentMap` | 确认选定 Authority 当前公开有效 Style | 无额外输入；需要 ready Authority |
| `validateTransaction` | 验证非空 transaction，但不应用 | 必需 `transaction` |
| `analyzeGeoJson` | 分析提供的 inline GeoJSON；对于 remote URL，不获取并报告 unavailable | 必需 `data`；可选 `options` |
| `listSourceLayers` | 列出 source-layer usage，可选限定到一个 source | 可选 `sourceId` |

规范的 [`InspectStyleInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts#L21)、[执行 Schema](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/schemas.ts)与[执行器](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/inspect.ts)仍是精确字段类型和投影行为的权威来源。

## 接口可用性 {#interface-availability}

WebMCP 默认注册 `inspectStyle` 与 `queryMapFeatures`。它的变更工具是选择性启用的：只有 `allowMutations` 为 `true` 时，才会注册 `applyStyleTransaction`、`applyStyleDocument` 和 `runMapCommand`。CLI 有意保持面向文档，不公开整文档替换或实时运行时操作。
