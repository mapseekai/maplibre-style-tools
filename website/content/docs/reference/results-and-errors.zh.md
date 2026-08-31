---
title: 结果与错误
description: 理解成功封装、失败、错误码、路径与详细信息。
weight: 40
---

对于预期的验证、语义、可用性与策略失败，能力会返回可区分结果，而不是抛出异常。

## 结果封装 {#result-envelope}

```ts
type CapabilityResult<TData> =
  | { success: true; message: string; data: TData }
  | { success: false; message: string; error: StyleToolError };
```

读取 `data` 或 `error` 前应先检查 `success`。成功结果包含能力专用的投影或回执。失败结果包含软件包创建的 `StyleToolError`；顶层 `message` 是该失败的公开摘要。

## Core 与 capability 失败层 {#core-capability-failures}

Core 文档函数与 capability interface 使用不同判别字段，因为它们属于不同层：

| Layer | Failure discriminator | Meaning |
| --- | --- | --- |
| 直接 `/core` 事务 | `ok: false` | Core transaction result 保留原始 Style、空的 changed-object list、空 diff、warnings 与其 `error`。 |
| Capability 与 interface | `success: false` | Capability 边界把预期的 core 或 Authority failure 投影为共享 `CapabilityResult`，其中包含公开 `message` 与 `error`，且不存在成功 `data`。 |

应根据所调用的 API 选择判别字段。Interface adapter 不会把失败的 core result 变成成功的 capability data。规范形状位于 [core types](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/core/types.ts)与[能力契约](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts)中。

## 错误字段 {#error-fields}

| Field | Type | Meaning |
| --- | --- | --- |
| `code` | `StyleToolErrorCode` | Stable machine-readable category |
| `message` | `string` | Public human-readable explanation |
| `path` | `string` (optional) | RFC 6901 JSON Pointer to the rejected value |
| `details` | `JsonObject` (optional) | JSON metadata for bounded diagnostics |

应将 `message` 视为解释性文本，而不是程序分支标识。请按 `code` 分支；用 `path` 定位输入或文档数据；仅将 `details` 用作补充 JSON 元数据。

## 错误码 {#error-codes}

```text
INVALID_INPUT
STYLE_INVALID
NOT_FOUND
CONFLICT
DEPENDENCY_CONFLICT
UNSUPPORTED_SOURCE
REVISION_CONFLICT
MAP_NOT_READY
BRIDGE_DISCONNECTED
CAPABILITY_DENIED
IO_ERROR
TIMEOUT
INTERNAL
```

| Code | Typical interpretation |
| --- | --- |
| `INVALID_INPUT` | Input shape, value, or configured boundary is invalid |
| `STYLE_INVALID` | Style specification validation failed |
| `NOT_FOUND` | Requested layer, source, session, map, or other resource is absent |
| `CONFLICT` | The requested semantic change conflicts with current state |
| `DEPENDENCY_CONFLICT` | A dependent Style object prevents the change |
| `UNSUPPORTED_SOURCE` | The source type cannot perform the requested operation |
| `REVISION_CONFLICT` | The Style or map changed after the caller's baseline |
| `MAP_NOT_READY` | A required live-map authority is unavailable |
| `BRIDGE_DISCONNECTED` | The live bridge is not connected |
| `CAPABILITY_DENIED` | Authority or resource policy denied the operation |
| `IO_ERROR` | A filesystem or transport I/O operation failed |
| `TIMEOUT` | The bounded operation exceeded its deadline |
| `INTERNAL` | An unexpected implementation failure occurred |

## 失败类别 {#failure-classes}

验证与语义失败是正常的 `CapabilityResult` 失败：能力输入格式错误、Style 无效、对象缺失、依赖冲突、源不受支持、修订冲突以及能力被拒绝，都不要求用异常处理。

I/O 与运行失败描述的是环境而非 Style 语义。MCP 与能力适配器仍会通过 `StyleToolError` 投影预期失败；CLI 则另外使用退出码 `2` 表示参数、输入或 JSON 错误，使用退出码 `3` 表示输出或内部失败。能力封装之外，意外的程序或宿主失败仍可能抛出异常。
