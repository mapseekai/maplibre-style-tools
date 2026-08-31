---
title: AI SDK 快速开始
description: 通过 AI SDK 接口检查实时 MapLibre 样式。
weight: 30
---

此路径适用于应用已经创建实时 MapLibre `map` 实例之后。工厂恰好返回五个工具：`inspectStyle`、`applyStyleTransaction`、`applyStyleDocument`、`runMapCommand` 和 `queryMapFeatures`。

## 创建工具 {#create-the-tools}

```ts
import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';

const tools = createMapLibreStyleTools({ getMap: () => map });
const result = await tools.inspectStyle.execute({ action: 'getLayerCount' });

if (!result.success) {
  console.error(result.error.code, result.error.message);
}
```

可将 `tools` 传给 AI SDK 工具集，也可像示例中一样调用单个工具的 `.execute(input)` 方法。

## 执行检查 {#execute-an-inspection}

`inspectStyle.execute({ action: 'getLayerCount' })` 会通过实时地图检查当前 Style，并返回共享结果封装。需要事务、文档替换、有界地图命令或要素查询时，请使用其余具名工具。

## 处理结果 {#handle-the-result}

始终根据 `result.success` 分支。如果 `getMap()` 返回 `null`，调用会产生正常的失败封装；它不会暴露任意应用程序状态。有关通用结果契约，请阅读[能力](../introduction/capabilities/)。
