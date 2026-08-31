---
title: Core 事务
description: 在不依赖浏览器或传输层的情况下验证和转换样式文档。
weight: 10
---

`/core` 入口是处理样式文档的 ES-only 基础层。它验证严格的 JSON 输入，在内存中转换文档，并返回结构化结果；不需要浏览器、MapLibre 地图或传输层。若需要选择集成边界，请先阅读[架构](../../introduction/architecture/)。

## 验证文档 {#validate-a-document}

在存储样式文档或将其交给另一个边界前，请使用 `validateStyleDocument`。成功时它返回规范化且已验证的样式；失败时返回有界的错误与警告列表。默认样式大小上限为 5 MiB UTF-8 JSON；只有当边界需要不同上限时，才传入正数的 `maxStyleBytes` 选项。

## 应用事务 {#apply-a-transaction}

`applyStyleTransaction` 会验证输入样式、验证事务、将操作应用到内存中的候选文档，并在成功返回前验证完整候选文档。

```ts
import { applyStyleTransaction } from 'maplibre-style-tools/core';

const result = applyStyleTransaction(
  { version: 8, sources: {}, layers: [] },
  {
    operations: [{
      op: 'setLayerProperties',
      layerId: 'roads',
      paint: { 'line-color': '#ffffff' },
    }],
  },
);
```

每项操作都需要 `op` 判别字段。默认限制为 5 MiB 样式、1 MiB diff 和 100 项操作。成功的 diff 使用 [RFC 6901 JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901)，因此调用方可以定位每个已变更的值。

## 过滤器组合 {#filter-composition}

构建组合的 MapLibre 表达式过滤器时使用 `composeFilter`；当过滤器应成为原子修改的一部分时，使用 `setLayerFilter` 和 `setGeoJsonSourceFilter` 事务操作。过滤器是 JSON 值，而不是 JSON 编码的字符串；请直接传入如 `['==', ['get', 'kind'], 'road']` 的表达式。

## 内联 GeoJSON {#inline-geojson}

`validateInlineGeoJson` 会在内联 GeoJSON 值嵌入样式操作前验证它。它应用软件包的 GeoJSON 安全限制，并返回已验证的值或结构化错误。请将其用于应用程序提供的要素；它不是网络获取器，也不能替代你的源数据管道。

## 原子失败 {#atomic-failure}

事务在文档边界上是原子的。任何操作失败，或最终候选文档未通过样式验证时，`applyStyleTransaction` 都会以原始样式、空的变更图层/源列表和空 diff 返回 `ok: false`。不会返回部分转换的候选文档。这个直接 core 判别字段与 capability 层的 `success: false` 封装不同；参见 [Core 与 capability 失败层](../../reference/results-and-errors/#core-capability-failures)。成功准备后如需修改实时地图，请使用 [MapLibre 适配器](../maplibre/)。
