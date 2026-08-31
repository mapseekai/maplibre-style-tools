---
title: 限制与安全
description: 查询字节、数量、深度、传输和资源策略边界。
weight: 50
---

下列数值是公开兼容性边界。字节限制在对应边界处按 UTF-8 数据或 UTF-8 JSON 序列化计算。“可覆盖默认值”表示直接 API 或已配置 Authority 可以用正安全整数替换该值；它不会绕过更严格的接口 Schema、协商 ceiling 或固定入站最大值。

## 默认限制 {#default-limits}

| Boundary | Published value | Classification | Configuration and scope |
| --- | ---: | --- | --- |
| Style JSON | 5 MiB | 可覆盖默认值；固定 CLI 输入 cap | 直接 core/MapLibre 与 MCP session option 接受正安全整数 `maxStyleBytes`；bridge peer 根据 server ceiling 协商。CLI Style 输入仍限制为 5 MiB，接口还可施加更低的有效限制。 |
| Semantic diff | 1 MiB | 可覆盖默认值；固定 CLI cap | 直接 core/MapLibre 与 MCP session option 接受正安全整数 `maxDiffBytes`；bridge peer 根据 server ceiling 协商。CLI 与其他未配置路径保持 1 MiB。 |
| Operations per transaction | 100 | 可覆盖的 core/Authority 默认值；接口 Schema cap | 直接 core/MapLibre、MCP session 与 bridge 有效限制可以替换 `maxOperations`。默认 capability model Schema 与 CLI 最多接纳 100 项，除非已配置 Authority 应用更低限制。 |
| Inline GeoJSON | 5 MiB | 可覆盖的 standalone 默认值；transaction 接口 cap | `validateInlineGeoJson` 与 `analyzeGeoJson` 接受正安全整数 `maxBytes` override。嵌入 transaction 的验证使用该公开 cap；runtime GeoJSON diff 改用独立的 1 MiB diff-byte cap。 |
| GeoJSON features | 100,000 | 可覆盖的 standalone 默认值；transaction/runtime 接口 cap | Standalone 验证/分析可替换正安全整数 `maxFeatures`；嵌入 transaction 与 runtime-diff 的验证使用 100,000。 |
| Coordinate positions | 1,000,000 | 可覆盖的 standalone 默认值；transaction/runtime 接口 cap | Standalone 验证/分析可替换正安全整数 `maxCoordinatePositions`；嵌入 transaction 与 runtime-diff 的验证使用 1,000,000。 |
| Geometry depth | 16 | 可覆盖的 standalone 默认值；transaction/runtime 接口 cap | Standalone 验证/分析可替换正安全整数 `maxGeometryDepth`；嵌入 transaction 与 runtime-diff 的验证使用 16。 |
| Property depth | 32 | 可覆盖的 standalone 默认值；transaction/runtime 接口 cap | Standalone 验证/分析可替换正安全整数 `maxPropertyDepth`；嵌入 transaction 与 runtime-diff 的验证使用 32。 |
| Feature query | 100 features and 1 MiB serialized | Direct-adapter 默认值；capability/bridge 最大值 | 直接 adapter 可以提供不同的正安全整数 `FeatureQueryLimits`。公开 capability input 与 bridge runtime 将请求限制在 100 和 1 MiB；`limit` 与 `maxSerializedBytes` 只能降低这些值，输出会被截断。 |
| Runtime list | 直接 adapter：300 default、500 maximum；共享 `runMapCommand`：100 default and maximum | 特定于边界的默认值与固定请求最大值 | 直接 MapLibre adapter 的 `listImages`/`listSprites` 在省略 `limit` 时使用 300，并接受 1–500。AI SDK、MCP 与 WebMCP 使用的共享 capability 在省略时提供 100，并拒绝高于 100 的请求。 |
| Bridge message | 5 MiB | 可配置且协商的默认 ceiling | Server 公开一个正安全整数 ceiling；client 可以显式选择不超过它的数值，否则使用 5 MiB 与 server ceiling 中较低者。单独 frame field 在声明处仍保留更小的固定最大值。 |
| MCP message | 5 MiB default; 128 KiB–64 MiB configurable range | 具有固定范围的可配置默认值 | `maxMessageBytes` 可配置为 128 KiB 至硬性 64 MiB 最大值；envelope reserve 会减少 application-result bytes。 |
| MCP request ID | 256 bytes | 固定入站最大值 | 按 UTF-8 JSON bytes 计量；不可配置。 |
| MCP method | 128 bytes | 固定入站最大值 | 按 UTF-8 bytes 计量；不可配置。 |
| MCP resource URI | 8 KiB | 固定入站最大值 | 在 canonical-namespace admission 前按 UTF-8 bytes 计量；不可配置。 |
| Style session ID | 512 bytes | 固定入站最大值 | 非空 ID 不得包含 lone surrogate，且必须保持在 512 UTF-8 bytes 以内；其外层 resource URI 另受 8 KiB URI 最大值约束。不可配置。 |
| HTTP bearer token | 4 KiB | 固定入站最大值 | Token 必须非空、不含 ASCII whitespace/control character，并保持在 4 KiB UTF-8 以内；不可配置。 |

Style、diff、事务、GeoJSON、要素查询与传输限制会在超限值跨越对应边界前执行。有效限制取适用的已配置默认值、接口 cap、协商 ceiling 或固定最大值中最严格者。以上分类以规范的 [core transaction limits](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/core/transaction.ts)、[GeoJSON limits](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/core/geojson.ts)、[feature-query Schema](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/adapters/maplibre/schemas.ts)、[bridge negotiation](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/client.ts)、[MCP message policy](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/message-boundary.ts)、[session limits](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/session-store.ts)和 [HTTP admission](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/http.ts)为准。

## Schema 与投影安全 {#schema-and-projection-safety}

公开能力 Schema 使用严格对象与原生 JSON 值。未知属性、非有限数值、格式错误的判别字段以及超过声明限制的值，会在 Authority 执行前被拒绝。

检查投影与要素查询投影同时报告 `returned` 和 `truncated`。列表形式的运行时命令结果在嵌套的 `BoundedCollection` 上公开这两个字段。变更回执与 `acknowledgement` 形式的运行时命令回执公开 `truncated`，但没有 `returned`。这些有界输出会保留有界 warnings，并让要素查询序列化保持在调用方允许值和公开最大值以内。

## 事务与修订安全 {#transaction-and-revision-safety}

Core Style 事务在文档边界上是原子的。如果某项操作或最终验证失败，失败结果会保留原始 Style，并且不公开部分 changed-object 列表或语义 diff。

实时地图应用会比较准备阶段的 baseline 与当前地图；MCP session 会比较 `expectedRevision` 与当前 session revision。baseline 已变化时会产生 `REVISION_CONFLICT`，而不会覆盖更新状态。

## 传输入站许可 {#transport-admission}

Bridge server 与 Streamable HTTP MCP 默认绑定 loopback。非 loopback HTTP 绑定需要显式选择。HTTP MCP 要求 bearer token，在不泄露 token 内容的情况下进行比较，验证请求 authority，并拒绝不是绑定 origin 或未列入显式允许的精确 HTTP(S) origin。Bridge 连接同样会验证受保护 WebSocket endpoint 的身份与允许 origin。

MCP 会验证有界 request ID、method、resource URI、session ID、完整 message 与 response envelope。Resource URI namespace 必须在 admission registry 冻结前注册，且每个入站 URI 都必须是其已注册 namespace 的规范形式。

## 资源策略 {#resource-policy}

只有连接具备附加的 `network.load` permission，且解析后的 URL 符合配置的 origin、prefix、data URL 或已注册自定义协议策略时，bridge resource policy 才允许新的网络引用。`network.load` 本身不授权任何可调用操作；参见 [bridge permission-to-operation 映射](../../guides/bridge/#capabilities)。相对 Style 资源 URL 与禁用协议会被拒绝；保留的 baseline 引用不会获得新的网络 Authority。

`analyzeGeoJson` 不会获取远程 GeoJSON。对于 URL 输入，它会返回成功的分析结果，其中 `available: false`、reason 为 `remote-url`，由调用方决定是否以及在何处授权获取。
