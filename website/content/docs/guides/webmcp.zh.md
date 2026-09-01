---
title: WebMCP Site Tools
description: 把地图工具暴露给同一个浏览器页面里的 AI Agent。
weight: 60
---

WebMCP Site tools 是浏览器暴露给同一页面内 AI Agent 的 JavaScript 函数。`registerMapLibreWebMcpTools` 把地图工具加到这个入口上。它是页面作用域、纯浏览器的方案：不需要 MCP 服务器，也不需要桥接。

## 注册工具

```ts
import { registerMapLibreWebMcpTools } from 'maplibre-style-tools/webmcp';

const registration = await registerMapLibreWebMcpTools({
  getMap: () => map,
  signal: pageLifetime.signal,
});

if (!registration.supported) {
  // 此浏览器未暴露 document.modelContext。
}
```

默认注册是只读的：只暴露 `inspectStyle` 和 `queryMapFeatures`，仅此而已。

## 特性检测

`supported: false` 表示这个浏览器没有暴露 `document.modelContext`，按特性检测的结果对待即可。WebMCP 仍是 Community Group 草案，请查看[草案规范](https://webmachinelearning.github.io/webmcp/)和 [Web Platform Tests 结果](https://wpt.fyi/results/webmcp)，不要依赖浏览器版本号。

## 开启变更能力

```ts
await registerMapLibreWebMcpTools({
  getMap: () => map,
  signal: pageLifetime.signal,
  allowMutations: true,
});
```

设置 `allowMutations: true` 会恰好增加三个工具：`applyStyleTransaction`、`applyStyleDocument`、`runMapCommand`。只在页面有意开放写入时开启，并配合 `authorizeInvocation` 回调，让页面对每次调用做决定。被拒绝的调用返回普通的有界失败，不会绕过页面。`onInvocation` 只用于观察。用 `signal` 把注册绑定到页面生命周期，页面不再持有地图时及时注销。

## 与 MCP 的区别

WebMCP 把工具放进浏览器，服务的是正在和用户一起操作的页面内 Agent。[`/mcp`](../mcp/) 是给外部宿主的线协议服务器。WebMCP 默认只有两个只读页面工具；MCP 暴露全部五个能力，外加离线会话和桥接实时地图。

## 看它跑起来

[WebMCP 示例](https://github.com/mapseekai/maplibre-style-tools/blob/main/examples/webmcp/README.md)开启了变更能力，并接受 Agent 的原生批注。
