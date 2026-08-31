---
title: AI SDK
description: 将五项共享能力作为 AI SDK 工具作用于进程内地图。
weight: 40
---

当应用拥有实时 MapLibre 地图，并希望在同一进程中使用兼容 AI SDK 的工具集时，请使用 `/ai`。此 facade 封装共享的[能力注册表](../capabilities/)；它不会创建网络传输，也不会在你提供的访问器之外选择地图。

## 创建工具集 {#create-the-tool-set}

```ts
import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';

const tools = createMapLibreStyleTools({
  getMap: () => map,
});
```

工厂恰好返回五个工具：`inspectStyle`、`applyStyleTransaction`、`applyStyleDocument`、`runMapCommand` 和 `queryMapFeatures`。它们的名称、描述、模型 Schema 和执行语义均来自其他接口使用的同一注册表。

## 将工具传给模型 {#pass-tools-to-a-model}

将返回对象作为 AI SDK 的 `tools` 选项传入。模型接收有边界的工具定义；地图访问仍限制在 `getMap` 回调中。

```ts
import { generateText } from 'ai';

const response = await generateText({
  model,
  prompt: 'Make roads easier to see.',
  tools,
});
```

在宿主应用中选择模型及循环或审批策略。工具定义本身不是变更操作的授权策略。

## 直接执行 {#execute-directly}

当应用而非模型提供已验证的意图时，使用工具的 `execute` 方法。

```ts
const result = await tools.applyStyleTransaction.execute({
  transaction: {
    operations: [{
      op: 'setLayerProperties',
      layerId: 'roads',
      paint: { 'line-color': '#ffffff' },
    }],
  },
});
```

输入必须是原生 JSON 值，而不是 JSON 编码的字符串。执行时仍会运行能力验证。

## 地图可用性 {#map-availability}

工具运行时才会调用 `getMap`。它可以返回 `null`，也可以在页面切换时安全地失败；工具随后会返回正常的 `MAP_NOT_READY` 失败封装。这样可以让工具可用性随应用生命周期变化，而不是保留过期的地图引用。

## 结果处理 {#result-handling}

每个工具都返回共享的可区分结果封装：成功结果含有 `data`，失败结果含有包创建的 `StyleToolError`。使用 `data` 前请检查 `success`。

AI facade 从不接受 `getState`，从不返回任意应用状态，也从不返回完整 Style 文档或 `data.style`。应用确实需要完整 Style 时，请通过 [core 边界](../core/) 或 MapLibre 地图读取。
