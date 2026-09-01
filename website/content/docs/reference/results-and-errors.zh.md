---
title: 结果与错误
description: 读懂结果信封、按错误码分支、正确理解失败。
weight: 40
---

能力调用对预期内的问题不抛异常。校验失败、图层不存在、revision 冲突、策略拒绝，全部作为普通结果返回 —— 分支一次就能继续。

## 信封

```ts
type CapabilityResult<TData> =
  | { success: true; message: string; data: TData }
  | { success: false; message: string; error: StyleToolError };
```

先看 `result.success`。成功时 `data` 是该能力的投影或回执；失败时 `error` 是包创建的 `StyleToolError`，顶层的 `message` 是给人看的摘要。

## 两层失败，两个判别字段 {#core-capability-failures}

直接调用 `/core` 和调用能力接口的失败形状不同 —— 它们是不同的层：

| 层 | 失败的样子 | 返回什么 |
| --- | --- | --- |
| 直接的 `/core` 事务 | `ok: false` | 原始样式、空变更列表、空 diff、警告，以及一个 `error` |
| 能力接口（AI SDK、MCP、WebMCP、CLI） | `success: false` | 共享信封：公开的 `message` 和 `error`，没有 `data` |

你调的是哪层 API，就分支哪个字段。适配器绝不会把失败的核心结果包装成成功的能力数据。

## 错误字段

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `code` | `StyleToolErrorCode` | 分支判断 —— 稳定的机器可读类别 |
| `message` | `string` | 给人看的说明；不要当程序判别用 |
| `path` | `string`（可选） | 用 RFC 6901 JSON Pointer 定位被拒绝的值 |
| `details` | `JsonObject`（可选） | 补充的 JSON 诊断信息 |

## 错误码

| 错误码 | 含义 |
| --- | --- |
| `INVALID_INPUT` | 输入形状、取值或配置边界非法 |
| `STYLE_INVALID` | 样式未通过规范校验 |
| `NOT_FOUND` | 请求的图层、源、会话、地图等资源不存在 |
| `CONFLICT` | 请求的变更与当前状态冲突 |
| `DEPENDENCY_CONFLICT` | 有依赖的样式对象阻止了该变更 |
| `UNSUPPORTED_SOURCE` | 该源类型无法执行请求的操作 |
| `REVISION_CONFLICT` | 样式或地图在你的基线之后被改过 —— 重新读取再提交 |
| `MAP_NOT_READY` | 所需的实时地图当前不可用 |
| `BRIDGE_DISCONNECTED` | 实时桥接未连接 |
| `CAPABILITY_DENIED` | 权威源或资源策略拒绝了该操作 |
| `IO_ERROR` | 文件系统或传输 I/O 失败 |
| `TIMEOUT` | 有界操作超出时限 |
| `INTERNAL` | 未预期的实现错误 |

## 什么抛异常，什么不抛

样式和输入问题从不抛异常 —— 它们是 `success: false` 的结果，CLI 对应退出码 `1`。I/O 和环境问题同样以 `StyleToolError` 失败的形式出现，CLI 用退出码 `2` 表示参数/输入错误、`3` 表示输出或内部故障。只有未预期的编程或宿主错误才可能在信封之外抛出。
