---
title: MapLibre 适配器
description: 对实时地图应用已准备的修改并执行有边界的操作。
weight: 20
---

`/maplibre` 入口将 `/core` 的文档语义连接到实时 MapLibre `Map`。它是进程内适配器：当应用程序拥有地图实例，并需要应用样式事务、发出有界的运行时操作或查询地图要素时使用它。选择面向浏览器的入口前，请阅读[环境要求](../../getting-started/requirements/)。

## 变更前先准备 {#prepare-before-mutation}

`prepareTransactionForMap` 会读取并验证当前样式，计算不可变的已准备事务，并记录稍后应用所需的基线。它不会调用 `map.setStyle`。这样应用程序可以在决定修改前检查 `prepared.view.transactionResult`。`applyTransactionToMap` 为单步流程完成同样的准备。

## 应用并等待 {#apply-and-await}

`applyTransactionToMap` 会验证当前样式、准备不可变事务、检测版本冲突，并且仅在基线仍为当前版本时调用 MapLibre；它会等待样式确认后才报告成功。其 `diff` 选项会传给 MapLibre 样式应用，默认值为 `true`；`timeoutMs` 默认值为 10,000 ms。

结果会报告可用的样式 Authority：可以返回当前样式时为 `current`；只有基线可靠时为 `pre-operation`；无法提供已验证样式时为 `unavailable`。在将修改视为已确认前，始终先分支处理结果。

## 版本冲突 {#revision-conflicts}

准备会记录规范化基线。如果实时地图在准备与修改之间发生变化，适配器会返回 `REVISION_CONFLICT`，而不是将候选文档应用到不同版本。应用失败时也会尝试恢复基线；结果 Authority 会说明当前地图样式、操作前样式或两者皆不可用时，哪一种可以安全报告。

## 有界要素查询 {#bounded-feature-queries}

使用 `querySourceFeaturesBounded` 或 `queryRenderedFeaturesBounded` 获取要素结果。它们会根据配置限制投影并截断结果，并在达到限制时返回 `FEATURE_QUERY_TRUNCATED` 警告。不要将无界要素查询作为应用程序的数据导出。

## 增量 GeoJSON {#incremental-geojson}

在调用 MapLibre 的 `updateData` 前，使用运行时 Schema 验证增量 GeoJSON 源变更。Schema 接受一个或多个有效的 `removeAll`、`remove`、`add` 或 `update` 操作，并拒绝重复的要素或属性标识符。

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

该 Schema 验证数据形状；`updateData` 仍是针对兼容 GeoJSON 源的 MapLibre 调用。当预期修改不是增量源 diff 时，请使用完整样式替换。
