---
title: AI SDK 快速上手
description: 把五个安全的工具交给 AI 模型，操作你的实时 MapLibre 地图。
weight: 30
---

本页假设你的应用已经创建了 MapLibre `map` 实例。如果你处理的是样式文件，看 [CLI 快速上手](cli-quick-start/)。

## 1. 安装

```bash
npm install maplibre-style-tools maplibre-gl
```

## 2. 创建工具

```ts
import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';

const tools = createMapLibreStyleTools({ getMap: () => map });
```

就这一步。你会拿到五个工具：`inspectStyle`、`applyStyleTransaction`、`applyStyleDocument`、`runMapCommand`、`queryMapFeatures`。

## 3. 交给模型

```ts
import { generateText } from 'ai';

const { text } = await generateText({
  model,
  prompt: '让道路更显眼一些。',
  tools,
});
```

模型看到五个工具定义，自行决定何时调用。地图访问始终收在你提供的 `getMap` 回调之后 —— 工具碰不到应用里的其他东西。

## 4. 也可以直接调用

```ts
const result = await tools.inspectStyle.execute({ action: 'getLayerCount' });

if (result.success) {
  console.log(result.data);
} else {
  console.error(result.error.code, result.error.message);
}
```

所有工具返回同一个信封：先看 `result.success`，再读 `result.data` 或 `result.error`。`getMap()` 返回 `null` 时 —— 页面还在加载、地图已销毁 —— 你会得到正常的 `MAP_NOT_READY` 失败，而不是异常。

## 下一步

[AI SDK 指南](../../guides/ai-sdk/)深入讲解地图可用性、变更安全与结果处理。
