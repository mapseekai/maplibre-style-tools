---
title: AI SDK 快速上手
description: 为 AI 模型提供五个操作实时 MapLibre 地图的安全工具。
weight: 30
---

本节假设你的应用已经创建了 MapLibre `map` 实例。如果处理的是样式文件，请参阅 [CLI 快速上手](cli-quick-start/)。

## 1. 安装

```bash
npm install maplibre-style-tools maplibre-gl
```

## 2. 创建工具

```ts
import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';

const tools = createMapLibreStyleTools({ getMap: () => map });
```

工厂恰好返回五个工具：`inspectStyle`、`applyStyleTransaction`、`applyStyleDocument`、`runMapCommand`、`queryMapFeatures`。

## 3. 将工具传给模型

```ts
import { generateText } from 'ai';

const { text } = await generateText({
  model,
  prompt: '让道路更显眼一些。',
  tools,
});
```

模型看到五个工具定义，并自行决定何时调用。地图访问始终收在 `getMap` 回调之后，工具无法触及应用中的其他部分。

## 4. 直接调用工具

```ts
const result = await tools.inspectStyle.execute({ action: 'getLayerCount' });

if (result.success) {
  console.log(result.data);
} else {
  console.error(result.error.code, result.error.message);
}
```

所有工具返回同一个信封：先判断 `result.success`，再读取 `result.data` 或 `result.error`。当 `getMap()` 返回 `null` 时（例如页面仍在加载，或地图已销毁），调用产生正常的 `MAP_NOT_READY` 失败，而不是异常。

## 下一步

[AI SDK 指南](../../guides/ai-sdk/)深入讲解地图可用性、变更安全与结果处理。
