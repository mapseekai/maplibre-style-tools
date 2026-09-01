---
title: 限制与安全
description: 每条边界上强制执行的字节、数量、深度、传输与资源策略上限。
weight: 50
---

这个包的每条边界都是显式且被强制执行的 —— 超限的值不会悄无声息地穿过。下表是全部已发布的数值。

"可覆盖默认值"指直接 API 选项或配置的权威源可以用正安全整数替换该值，但永远不会绕过更严格的接口 schema、协商上限或固定准入最大值。字节限制按命名边界上的 UTF-8 数据或 UTF-8 JSON 序列化计算。

## 默认限制

| 边界 | 公布值 | 分类 | 配置与适用范围 |
| --- | ---: | --- | --- |
| 样式 JSON | 5 MiB | 可覆盖默认；CLI 固定上限 | 核心/MapLibre 直连与 MCP 会话选项接受正安全 `maxStyleBytes`；bridge 双端向服务器上限协商。CLI 样式输入固定 5 MiB，接口可施加更低的实际限制。 |
| 语义 diff | 1 MiB | 可覆盖默认；CLI 固定上限 | 核心/MapLibre 直连与 MCP 会话选项接受正安全 `maxDiffBytes`；bridge 双端向服务器上限协商。CLI 与未配置路径保持 1 MiB。 |
| 每事务操作数 | 100 | 核心/权威源可覆盖默认；接口 schema 上限 | 核心/MapLibre 直连、MCP 会话与 bridge 的实际限制可替换 `maxOperations`。默认能力模型 schema 和 CLI 最多接受 100，除非配置的权威源设了更低的限制。 |
| 内联 GeoJSON | 5 MiB | 独立可覆盖默认；事务接口上限 | `validateInlineGeoJson` 和 `analyzeGeoJson` 接受正安全 `maxBytes` 覆盖。嵌入事务的校验使用公布上限；运行时 GeoJSON diff 单独适用 1 MiB diff 上限。 |
| GeoJSON feature 数 | 100,000 | 独立可覆盖默认；事务/运行时接口上限 | 独立校验/分析可替换正安全 `maxFeatures`；嵌入事务与运行时 diff 校验使用 100,000。 |
| 坐标位置数 | 1,000,000 | 独立可覆盖默认；事务/运行时接口上限 | 独立校验/分析可替换正安全 `maxCoordinatePositions`；嵌入事务与运行时 diff 校验使用 1,000,000。 |
| 几何深度 | 16 | 独立可覆盖默认；事务/运行时接口上限 | 独立校验/分析可替换正安全 `maxGeometryDepth`；嵌入事务与运行时 diff 校验使用 16。 |
| 属性深度 | 32 | 独立可覆盖默认；事务/运行时接口上限 | 独立校验/分析可替换正安全 `maxPropertyDepth`；嵌入事务与运行时 diff 校验使用 32。 |
| 要素查询 | 100 个要素且序列化 1 MiB | 直连适配器默认；能力/bridge 最大值 | 直连适配器可提供不同的正安全 `FeatureQueryLimits`。公开能力输入和 bridge 运行时把请求上限锁在 100 与 1 MiB；`limit` 和 `maxSerializedBytes` 只能调低，输出会截断。 |
| 运行时列表 | 直连适配器：默认 300、最大 500；共享 `runMapCommand`：默认即最大 100 | 边界各自默认；请求固定上限 | 直连 MapLibre 适配器的 `listImages`/`listSprites` 省略 `limit` 时用 300，接受 1–500。AI SDK、MCP、WebMCP 共用的能力省略时给 100，超过 100 直接拒绝。 |
| Bridge 消息 | 5 MiB | 可配置的协商默认上限 | 服务器公布正安全上限；客户端可以显式选择不高于它的值，否则取 5 MiB 与服务器上限的较小者。个别帧字段在声明处保留更小的固定上限。 |
| MCP 消息 | 默认 5 MiB；可配置 128 KiB–64 MiB | 可配置默认，固定区间 | `maxMessageBytes` 可在 128 KiB 到硬性 64 MiB 上限之间配置；信封预留会减少应用结果的可用字节。 |
| MCP 请求 ID | 256 字节 | 固定准入上限 | 按 UTF-8 JSON 字节计；不可配置。 |
| MCP 方法名 | 128 字节 | 固定准入上限 | 按 UTF-8 字节计；不可配置。 |
| MCP 资源 URI | 8 KiB | 固定准入上限 | 按规范命名空间准入前的 UTF-8 字节计；不可配置。 |
| 样式会话 ID | 512 字节 | 固定准入上限 | 非空、不含孤立代理对、不超过 512 UTF-8 字节；外层资源 URI 另受 8 KiB 上限约束。不可配置。 |
| HTTP bearer token | 4 KiB | 固定准入上限 | 非空、不含 ASCII 空白/控制字符、不超过 4 KiB UTF-8；不可配置。 |

实际生效的永远是其中最严格的一个：配置的默认值、接口上限、协商上限或固定最大值。权威来源：[核心事务限制](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/core/transaction.ts)、[GeoJSON 限制](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/core/geojson.ts)、[要素查询 schema](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/adapters/maplibre/schemas.ts)、[bridge 协商](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/client.ts)。

## Schema 与投影安全

公开能力 schema 使用严格对象和原生 JSON 值：未知属性、非有限数字、畸形判别字段和超限值，都会在权威源执行之前被拒绝。

有界输出会告诉你它截断了：检查与要素查询投影带 `returned` 和 `truncated`；变更回执与确认型运行时回执带 `truncated`。要素查询的序列化始终在你允许的值与公开上限之内。

## 事务与 revision 安全

核心事务是原子的：操作失败或最终校验失败，返回原始样式，没有部分变更列表，也没有 diff。

实时地图在提交前比较制备基线与当前地图；MCP 会话比较 `expectedRevision` 与会话 revision。任一不匹配都返回 `REVISION_CONFLICT`，绝不覆盖更新的状态。

## 传输准入

bridge 服务器与 Streamable HTTP MCP 监听器默认绑定 loopback；离开 loopback 需要显式开启。HTTP MCP 要求 bearer token、校验请求 authority，浏览器 `Origin` 只有等于绑定源或命中显式白名单才放行。bridge 连接以同样方式认证 WebSocket 端点并校验允许来源。

MCP 还对请求 ID、方法名、资源 URI、会话 ID、消息总数和响应信封做有界校验。资源 URI 命名空间必须在准入注册表冻结之前注册，每个入站 URI 必须是其命名空间的规范形式。

## 资源策略

bridge 连接只有在具备 `network.load` 权限时才能加载新的网络资源，且解析后的 URL 必须匹配你配置的来源、前缀、data-URL 或已注册的自定义协议策略。`network.load` 允许与不允许什么，见[权限映射](../../guides/bridge/#capabilities)。相对样式资源 URL 和被禁止的协议会被拒绝；继承自基线的资源不会获得新的网络权限。

`analyzeGeoJson` 从不抓取网络数据。传入 URL 时返回 `available: false`、原因 `remote-url`，由你决定是否、以及经由哪个边界去抓取。
