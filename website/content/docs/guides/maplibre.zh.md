---
title: MapLibre 适配器
description: 把校验过的变更应用到实时地图，并安全地查询地图。
weight: 20
---

`/maplibre` 把 `/core` 的文档语义接到运行中的 MapLibre `Map` 上。地图由你的应用持有；适配器保证每次变更都经过校验、基于制备时的 revision 应用、并在确认之后才报告成功。

## 要预览还是要一步，自己选

`prepareTransactionForMap` 校验地图当前样式并计算一个不可变的事务句柄 —— 不调用 `map.setStyle`。想先展示预览，就检查 `prepared.view.transactionResult`，然后再提交。

`applyTransactionToMap` 做同样的制备并一步应用。`diff` 选项透传给 MapLibre，默认 `true`；`timeoutMs` 默认 10,000 毫秒。

## 结果会告诉你什么是可信的

应用完成后，结果报告它可以担保哪种样式来源：

- `current` —— 确认之后读到的地图当前样式
- `pre-operation` —— 只有制备时的基线可信
- `unavailable` —— 无法提供任何经过校验的样式

把它当作判断依据，再确认变更是否生效。

## 冲突会被检测，而不是被覆盖

制备时会记录一个规范基线。如果在制备和提交之间地图变了 —— 另一个标签页、另一个工具、用户本人 —— 你会得到 `REVISION_CONFLICT`，而不是悄悄覆盖更新的状态。失败的 apply 还会尝试恢复基线；结果中的 authority 字段告诉你哪种状态实际可信。

## 不会失控的要素查询

`querySourceFeaturesBounded` 和 `queryRenderedFeaturesBounded` 把要素投影成纯 JSON 快照，达到配置上限就截断 —— 并用 `FEATURE_QUERY_TRUNCATED` 警告告诉你。只要结果要喂给应用逻辑或模型，就用它们，别用 MapLibre 的原始查询。

## 增量 GeoJSON 更新，先校验

调用 `GeoJSONSource.updateData` 之前，先校验 diff。运行时 schema 接受 `removeAll`、`remove`、`add`、`update` 四种操作；ID 在 `remove` 内、`update` 内各自必须唯一，每次 update 内属性键必须唯一，ID 可以跨操作复用。

```ts
import { runtimeGeoJsonSourceDiffSchema } from 'maplibre-style-tools/maplibre';

const parsed = runtimeGeoJsonSourceDiffSchema.safeParse({
  update: [{
    id: 'station-1',
    addOrUpdateProperties: [{ key: 'status', value: 'open' }],
  }],
});

if (parsed.success) {
  await source.updateData(parsed.data);
}
```

schema 只负责校验形状；`updateData` 仍是你对兼容 GeoJSON 源的调用。如果改动不是增量源 diff，就改用完整[事务](../core/)。

## 下一步

要把这些操作暴露给模型？[AI SDK 指南](../ai-sdk/)把它们包装成五个工具。
