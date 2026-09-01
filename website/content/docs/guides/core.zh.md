---
title: Core 事务
description: 在纯 TypeScript 里校验和转换样式文档 —— 不用浏览器，不用地图。
weight: 10
---

`/core` 是其他入口共同的地基：严格的校验、结构化的事务、GeoJSON 处理与分析，全部作用于纯 JSON 样式文档。如果你的工具面向样式文件或文档，从这里开始。

## 先校验，再信任

`validateStyleDocument` 按样式规范检查文档。成功返回规范化后的样式；失败返回一个有界的错误与警告列表，而不是抛异常。默认最多读取 5 MiB UTF-8 JSON —— 只有你的边界需要不同上限时才传 `maxStyleBytes`。

## 应用事务

事务是一个带 `operations` 数组的对象，每个操作携带 `op` 判别字段。整体先校验，再应用到候选样式，候选样式再校验一次，然后你才拿到结果。

```ts
import { applyStyleTransaction } from 'maplibre-style-tools/core';

const result = applyStyleTransaction(style, {
  operations: [
    {
      op: 'setLayerFilter',
      layerId: 'roads',
      mode: 'and',
      filter: ['==', ['get', 'surface'], 'paved'],
    },
    {
      op: 'setLayerProperties',
      layerId: 'roads',
      paint: { 'line-color': '#4c78a8' },
    },
  ],
});
```

成功结果包含可重放的 [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901) diff 和精确的变更图层/源 ID，调用方可以记录或重放发生了什么。

**原子性是核心承诺。** 任何一个操作失败 —— 或最终候选样式校验失败 —— 你拿回的是原封不动的原始样式、空的变更 ID 列表和空 diff。不存在需要回滚的中间状态。

两个细节值得知道：核心层失败用 `ok: false` 表示，与能力层的 `success: false` 信封不同（见[核心层与能力层的失败](../../reference/results-and-errors/#core-capability-failures)）；默认上限为样式 5 MiB、diff 1 MiB、每事务 100 个操作，你可以通过 `StyleTransactionOptions` 覆盖 —— 前提是你拥有这个边界。

## 过滤器是表达式，不是字符串

过滤器使用 MapLibre 表达式语法，按原生 JSON 传值。用 `composeFilter` 组装一个；或作为原子变更的一部分，使用 `setLayerFilter` 与 `setGeoJsonSourceFilter` 操作 —— 图层过滤器支持 `replace`、`and`、`or`、`clear`，GeoJSON 源过滤器支持 `replace` 和 `clear`。

`setStyleRootProperties` 对允许的根字段执行 RFC 7396 merge-patch 语义：对象键合并、`null` 删除、数组和标量整体替换。它改不了 `version`、`sources` 和 `layers`。

## 内联 GeoJSON，先过闸门

`validateInlineGeoJson` 在内联 GeoJSON 进入样式之前做检查 —— 覆盖全部 RFC 7946 几何、Feature 与集合，默认上限：序列化 5 MiB、100,000 个 feature、1,000,000 个坐标位置、几何深度 16、属性深度 32。`analyzeGeoJson` 在此之上给出数量、范围和属性统计；传入 URL 时返回 `available: false`，绝不发起请求。

无需联网的 source-layer 发现用 `listSourceLayers`，它直接读样式元数据和图层引用。`duplicateLayer` 和 `addLayerFromSource` 覆盖常见的图层操作；`addGeoJsonLayer` 把内联源和图层放在一个原子步骤里校验并添加 —— 要么都提交，要么都不提交。

## 下一步

手上有实时地图？[MapLibre 适配器](../maplibre/)把制备好的事务应用到地图上。
