---
title: 限制与安全
description: 查询字节、数量、深度、传输和资源策略边界。
weight: 50
---

下列默认值与最大值是公开兼容性边界。字节限制在对应边界处按 UTF-8 数据或 UTF-8 JSON 序列化计算。

## 默认限制 {#default-limits}

| Boundary | Default or maximum |
| --- | ---: |
| Style JSON | 5 MiB |
| Semantic diff | 1 MiB |
| Operations per transaction | 100 |
| Inline GeoJSON | 5 MiB |
| GeoJSON features | 100,000 |
| Coordinate positions | 1,000,000 |
| Geometry depth | 16 |
| Property depth | 32 |
| Feature query | 100 features and 1 MiB serialized |
| Runtime list | 300 default, 500 maximum |
| Bridge message | 5 MiB |
| MCP message | 5 MiB default, 64 MiB configurable maximum |
| MCP request ID | 256 bytes |
| MCP method | 128 bytes |
| MCP resource URI | 8 KiB |
| Style session ID | 512 bytes |
| HTTP bearer token | 4 KiB |

Style、diff、事务、GeoJSON、要素查询与传输限制会在超限值跨越对应边界前执行。部分 core 与传输默认值可通过其文档化选项降低或配置；标为最大值的边界不可超过。

## Schema 与投影安全 {#schema-and-projection-safety}

公开能力 Schema 使用严格对象与原生 JSON 值。未知属性、非有限数值、格式错误的判别字段以及超过声明限制的值，会在 Authority 执行前被拒绝。

检查、变更、运行时列表与要素查询结果都是有界投影，而不是完整且无界的运行时状态。结果会报告 `returned` 与 `truncated`，保留有界 warnings，并让要素查询序列化保持在调用方允许值和公开最大值以内。

## 事务与修订安全 {#transaction-and-revision-safety}

Core Style 事务在文档边界上是原子的。如果某项操作或最终验证失败，失败结果会保留原始 Style，并且不公开部分 changed-object 列表或语义 diff。

实时地图应用会比较准备阶段的 baseline 与当前地图；MCP session 会比较 `expectedRevision` 与当前 session revision。baseline 已变化时会产生 `REVISION_CONFLICT`，而不会覆盖更新状态。

## 传输入站许可 {#transport-admission}

Bridge server 与 Streamable HTTP MCP 默认绑定 loopback。非 loopback HTTP 绑定需要显式选择。HTTP MCP 要求 bearer token，在不泄露 token 内容的情况下进行比较，验证请求 authority，并拒绝不是绑定 origin 或未列入显式允许的精确 HTTP(S) origin。Bridge 连接同样会验证受保护 WebSocket endpoint 的身份与允许 origin。

MCP 会验证有界 request ID、method、resource URI、session ID、完整 message 与 response envelope。Resource URI namespace 必须在 admission registry 冻结前注册，且每个入站 URI 都必须是其已注册 namespace 的规范形式。

## 资源策略 {#resource-policy}

只有连接具备 `network.load`，且解析后的 URL 符合配置的 origin、prefix、data URL 或已注册自定义协议策略时，bridge resource policy 才允许新的网络引用。相对 Style 资源 URL 与禁用协议会被拒绝；保留的 baseline 引用不会获得新的网络 Authority。

`analyzeGeoJson` 不会获取远程 GeoJSON。对于 URL 输入，它会返回成功的分析结果，其中 `available: false`、reason 为 `remote-url`，由调用方决定是否以及在何处授权获取。
