---
title: 能力契约
description: 每个能力接受什么、返回什么、在哪些接口可用。
weight: 30
---

五个能力共用一个注册表、严格的 schema 和同一个结果信封。本页告诉你每个能力接受和返回什么、在哪里可用；精确的字段类型见文末链接。

## 能力矩阵

| 能力 | 输入类型 | 成功数据 | 实时地图 | AI SDK | MCP | WebMCP | CLI |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `inspectStyle` | [`InspectStyleInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts#L21) | `InspectionProjection` | 否 | 是 | 是 | 默认 | `inspect`；`validate` 覆盖校验类操作 |
| `applyStyleTransaction` | [`ApplyStyleTransactionInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `StyleMutationReceipt` | 否 | 是 | 是 | `allowMutations` | `apply` |
| `applyStyleDocument` | [`ApplyStyleDocumentInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `StyleMutationReceipt` | 否 | 是 | 是 | `allowMutations` | 否 |
| `runMapCommand` | [`RunMapCommandInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `MapCommandReceipt` | 是 | 是 | 是 | `allowMutations` | 否 |
| `queryMapFeatures` | [`QueryMapFeaturesInput`](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) | `FeatureQueryProjection` | 是 | 是 | 是 | 默认 | 否 |

AI SDK 门面在进程内地图上提供全部五个工具；MCP 暴露全部五个能力名，另加会话管理。

## 每个能力需要你提供什么

| 能力 | 所需权威源 |
| --- | --- |
| `inspectStyle` | 一个 `StyleAuthority` —— 但 `validateDocument`、`validateTransaction`、`analyzeGeoJson` 直接作用于传入数据，无需权威源 |
| `applyStyleTransaction` | `StyleAuthority.applyTransaction()` |
| `applyStyleDocument` | `StyleAuthority.applyDocument()` |
| `runMapCommand` | `RuntimeAuthority.runtimeCommands()` |
| `queryMapFeatures` | `RuntimeAuthority.querySourceFeatures()` 或 `queryRenderedFeatures()` |

权威源延迟解析、可以返回 `null`；依赖权威源的调用此时以 `MAP_NOT_READY` 失败。

## 输入规则

schema 接受原生 JSON 值和严格对象 —— 未知字段会被拒绝，嵌套值不许编码成 JSON 字符串。`ApplyStyleTransactionInput` 携带事务和可选的 `dryRun`、`diff`；`ApplyStyleDocumentInput` 选择内联样式或绝对 URL；运行时命令与要素查询的输入由 `action` 或 `target` 判别。

## `inspectStyle` 操作一览

按需要的投影选择操作。`validateDocument`、`validateTransaction`、`analyzeGeoJson` 不需要权威源；其余都从选中的权威源读取当前样式。

| 操作 | 你得到 | 关键输入 |
| --- | --- | --- |
| `listLayers` | 紧凑的图层摘要 | 可选 `query`、`type`、`source`、`sourceLayer`、`limit` |
| `listSources` | 源定义 | 可选 `limit` |
| `getLayer` | 单个图层投影 | `layerId`；可选 `fields`（`paint`、`layout`、`filter`、`zoom`） |
| `getSource` | 单个源定义 | `sourceId` |
| `getRoot` | 根属性，不含图层/源集合 | — |
| `getContext` | 紧凑样式上下文，含权威源提供的选择上下文 | 可选 `layerLimit` |
| `inspectLayers` | 选中图层的详细投影，或有界的前缀集合 | 可选 `layerIds`、`fields`、`limit` |
| `getLayerCount` | 图层数量 | — |
| `validateDocument` | 校验传入的样式 | `style` |
| `validateCurrentMap` | 确认权威源当前暴露的样式合法 | 需要就绪的权威源 |
| `validateTransaction` | 校验非空事务，不应用 | `transaction` |
| `analyzeGeoJson` | 分析传入的内联 GeoJSON；URL 返回 `available: false`，不抓取 | `data`；可选 `options` |
| `listSourceLayers` | source-layer 使用情况，可限定单个源 | 可选 `sourceId` |

## 权威形状在哪里

完整的字段与判别类型见权威的[能力声明](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts)、[执行 schema](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/schemas.ts)和[核心类型](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/core/types.ts)。
