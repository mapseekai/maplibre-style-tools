---
title: WebMCP Site tools
description: 以只读默认值和显式写入授权注册页面级浏览器工具。
weight: 60
---

当浏览器向页面公开 `document.modelContext` 时，请使用 `/webmcp`。WebMCP Site tools 是带描述与结构化 Schema 的 JavaScript 函数；浏览器会让与该页面协作的 Agent 发现并调用它们。注册是页面级且仅限浏览器；它既不需要 MCP server 进程，也不需要浏览器桥接。

## 何时使用 WebMCP {#when-to-use-webmcp}

WebMCP 用于实时的页面内交互，其中页面仍是地图访问的 authority。所需的浏览器表面是 `document.modelContext`；支持情况在注册时进行 feature detection。当外部 MCP host 需要 wire-protocol server 时请使用 [MCP](../mcp/)；仅当该 host 必须访问浏览器地图时才使用[浏览器桥接](../bridge/)。

## 只读注册 {#read-only-registration}

```ts
import { registerMapLibreWebMcpTools } from 'maplibre-style-tools/webmcp';

const registration = await registerMapLibreWebMcpTools({
  getMap: () => map,
  signal: pageLifetime.signal,
});

if (!registration.supported) {
  console.info('This browser does not expose WebMCP Site tools.');
}
```

默认注册只公开 `inspectStyle` 和 `queryMapFeatures`。`document.modelContext` 不可用时，注册会以 `supported: false` 结束；应将其视为预期的 feature-detection 结果，而不是错误或默默添加另一种传输方式的许可。WebMCP 仍是演进中的 Community Group draft，因此不要从固定的浏览器版本列表推断支持情况；请查看权威的 [WebMCP draft](https://webmachinelearning.github.io/webmcp/)与当前 [Web Platform Test 结果](https://wpt.fyi/results/webmcp)。

## 显式写入授权 {#mutation-opt-in}

仅在页面有意公开写入功能时设置 `allowMutations: true`。它恰好添加三个支持变更的工具：`applyStyleTransaction`、`applyStyleDocument` 和 `runMapCommand`。请将此 opt-in 与适当的调用授权和资源策略配对；该 flag 本身不是授权边界。

## 调用授权 {#invocation-authorization}

提供 `authorizeInvocation` 以便页面为每一次调用作出决定，并仅使用 `onInvocation` 进行观察。被拒绝的调用会返回有边界的能力结果，而不会绕过页面 authority。使用 `signal` 将注册绑定到页面生命周期，并在页面不再拥有地图时关闭它。

## 与 MCP 的区别 {#how-it-differs-from-mcp}

WebMCP 会在支持该表面的浏览器中，把适用的共享注册表契约注册为 JavaScript 工具。`/mcp` 是通过 stdio 或受保护 HTTP 使用 MCP wire protocol 的 server。WebMCP 默认是两个只读页面工具；MCP 公开全部五个 capability 名称，还可以管理有边界的离线会话和已注册的实时地图目标。
