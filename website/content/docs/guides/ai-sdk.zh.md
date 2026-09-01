---
title: AI SDK
description: 进程内地图之上的五个现成工具。
weight: 40
---

`/ai` 把能力注册表变成 AI SDK 6 的工具集，作用在你应用持有的地图上。一次工厂调用，模型就拿到五个描述清晰的工具，而地图访问始终收在你控制的回调之后。

## 创建工具并交给模型

```ts
import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';
import { generateText } from 'ai';

const tools = createMapLibreStyleTools({ getMap: () => map });

const { text } = await generateText({
  model,
  prompt: '让道路更显眼一些。',
  tools,
});
```

你拿到的是 `inspectStyle`、`applyStyleTransaction`、`applyStyleDocument`、`runMapCommand`、`queryMapFeatures` 这五个，名称、描述、schema 都投影自其他接口共用的注册表。

选什么模型、要不要审批流、何时允许变更，这些是你应用的策略。工具定义本身不是授权策略。

## 直接调用工具

不需要模型。每个工具都有 `execute`：

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

输入是原生 JSON 值。对象和数组按原生值传入，不要编码成字符串；无论哪种方式，执行时校验照常进行。

## 地图可用性

`getMap` 在工具执行时求值。页面加载中或地图销毁后返回 `null`，调用方就会得到正常的 `MAP_NOT_READY` 失败。这样工具的可用性跟随应用生命周期，而不是过期引用。

## 处理结果

成功带 `data`；失败带包创建的 `StyleToolError`。先看 `result.success`，再各取所需。检查类操作返回紧凑投影；真正需要完整样式文档时，通过 [`/core`](../core/) 或 Map 实例读取。

## 下一步

最小端到端配置见[快速上手](../../getting-started/ai-sdk-quick-start/)。想不依赖 AI SDK 暴露工具，对比 [WebMCP](../webmcp/) 和 [MCP](../mcp/)。
