---
title: WebMCP Site tools
description: 以只读默认值和显式写入授权注册页面级浏览器工具。
weight: 60
---

当兼容浏览器将 Site tools 暴露给与同一页面及其 MapLibre 地图协作的 AI agent 时，请使用 `/webmcp`。注册是页面级且仅限浏览器；它既不需要 MCP server 进程，也不需要浏览器桥接。

## 何时使用 WebMCP {#when-to-use-webmcp}

WebMCP 用于实时的页面内交互，其中页面仍是地图访问的 authority。当外部 MCP host 需要 wire-protocol server 时请使用 [MCP](../mcp/)；仅当该 host 必须访问浏览器地图时才使用[浏览器桥接](../bridge/)。

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

默认注册只公开 `inspectStyle` 和 `queryMapFeatures`。浏览器未提供 WebMCP Site tools 时，注册会以 `supported: false` 结束；应将其视为 feature-detection 结果，而不是默默添加另一种传输方式的许可。

## 显式写入授权 {#mutation-opt-in}

仅在页面有意公开写入功能时设置 `allowMutations: true`。它恰好添加三个支持变更的工具：`applyStyleTransaction`、`applyStyleDocument` 和 `runMapCommand`。请将此 opt-in 与适当的调用授权和资源策略配对；该 flag 本身不是授权边界。

## 调用授权 {#invocation-authorization}

提供 `authorizeInvocation` 以便页面为每一次调用作出决定，并仅使用 `onInvocation` 进行观察。被拒绝的调用会返回有边界的能力结果，而不会绕过页面 authority。使用 `signal` 将注册绑定到页面生命周期，并在页面不再拥有地图时关闭它。

## 与 MCP 的区别 {#how-it-differs-from-mcp}

WebMCP 在兼容浏览器中注册 JavaScript 工具。`/mcp` 是通过 stdio 或受保护 HTTP 使用 MCP wire protocol 的 server。两者都投影共享能力，但 WebMCP 默认是两个只读页面工具，而 MCP 还可以管理有边界的离线会话和已注册的实时地图目标。
