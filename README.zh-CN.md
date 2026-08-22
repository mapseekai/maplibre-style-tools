# maplibre-style-tools

[English](README.md) | **简体中文** | [更新日志](CHANGELOG.md)

用于检查和编辑 MapLibre GL 样式的 AI 驱动工具集。

一个与传输层无关的能力层(`/capabilities`)定义了五个样式能力 ——
`inspectStyle`、`applyStyleTransaction`、`applyStyleDocument`、
`runMapCommand`、`queryMapFeatures` —— 包括它们严格的输入 schema、描述和有界
的结果信封。三个薄接口对外暴露同一组能力:AI SDK 工具工厂(`/ai`)、MCP
服务器(`/mcp`)以及 `maplibre-style` CLI。每个接口提供自己的样式权威源
(进程内地图、有界文档会话、桥接的实时地图或样式文件);能力语义只在核心中
定义一次。本项目目前作为独立本地项目维护,尚未发布到 npm。

## 环境要求

- Node.js 22.13 或更新版本
- `maplibre-gl` 6.3 或兼容版本
- 一个 AI SDK 6 工具消费方

## 本地安装

先构建一次本包,然后从兄弟项目引用:

```bash
cd ../maplibre-style-tools
pnpm install
pnpm run build
cd ../your-project
pnpm add ../maplibre-style-tools
pnpm add maplibre-gl
```

## AI 工具

```ts
import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';

const { applyStyleTransaction } = createMapLibreStyleTools({ getMap: () => map });
const result = await applyStyleTransaction.execute({
  transaction: {
    operations: [{
      op: 'setLayerProperties',
      layerId: 'roads',
      paint: { 'line-color': '#fff' },
    }],
  },
});
```

`createMapLibreStyleTools` 恰好返回五个 AI SDK 工具:`inspectStyle`、
`applyStyleTransaction`、`applyStyleDocument`、`runMapCommand` 和
`queryMapFeatures`。可以把返回对象传给 AI SDK 的 `tools` 集合,也可以直接调用
每个工具的 `.execute(input)` 方法。

## 入口

本包有七个受支持的入口:

- `maplibre-style-tools` 包含非 AI 的包导出。
- `maplibre-style-tools/core` 是与传输层无关的事务、校验、GeoJSON、分析与发现 API。它既不需要 DOM 也不需要 Node 环境类型。
- `maplibre-style-tools/maplibre` 把已制备的事务应用到 MapLibre 地图上,并暴露有界的实时地图命令。它可以使用 DOM 类型,但不加载 Node 环境类型。
- `maplibre-style-tools/capabilities` 是与传输层无关的能力层:五个能力执行器、严格的输入 schema、能力注册表、结果信封,以及各接口实现的 `StyleAuthority`/`RuntimeAuthority` 接口。它还导出 `createOpenAiFunctionTools` 和 `createAnthropicTools`,用于把注册表投影成 OpenAI function-calling 与 Anthropic Messages 的工具 schema,便于直接集成 LLM API。
- `maplibre-style-tools/ai` 是 AI SDK 接口:`createMapLibreStyleTools` 把能力注册表包装成作用于进程内地图的五个 AI SDK 工具。
- `maplibre-style-tools/mcp` 是 MCP 接口:有界服务器工厂、传输运行器、会话存储、实时桥接扩展与 URI 辅助函数。它暴露同样的五个能力,外加会话管理工具。
- `maplibre-style-tools/bridge` 是浏览器安全的实时 MapLibre 客户端、协议、能力、哈希与资源策略 API。它不导出任何 Node WebSocket 服务器状态。

`/ai` 与 `/mcp` 的声明图会有意加载它们所需的 Node 类型。如果不希望引入这层
环境依赖,请直接引入 `/core`、`/maplibre`、`/capabilities` 或 `/bridge`。

## 纯核心

当适配器需要校验并应用一次样式事务、又不希望加载浏览器或 AI 门面时,使用
严格的、与传输层无关的核心边界:

```ts
import { applyStyleTransaction } from 'maplibre-style-tools/core';

const result = applyStyleTransaction(
  { version: 8, sources: {}, layers: [] },
  {
    operations: [{
      op: 'setLayerProperties',
      layerId: 'roads',
      paint: { 'line-color': '#ffffff' },
    }],
  },
);
```

`/core` API 要求操作携带判别字段,并返回 RFC 6901 diff。默认限制为样式 5 MiB、
diff 1 MiB、100 个操作;`StyleTransactionOptions` 可以显式覆盖这些上限。适配器
应把未知事务交给该边界,而不是自行预解析。

### 结构化事务与过滤器

每个核心变更都是带 `op` 判别字段的对象。事务是一个封闭对象,包含一个有界的
`operations` 数组和可选的最终校验:

```ts
import { applyStyleTransaction } from 'maplibre-style-tools/core';

const result = applyStyleTransaction(style, {
  operations: [
    {
      op: 'setLayerFilter',
      layerId: 'roads',
      mode: 'and',
      filter: ['==', ['get', 'surface'], 'paved'],
    },
    {
      op: 'setLayerProperties',
      layerId: 'roads',
      paint: { 'line-color': '#4c78a8' },
    },
  ],
});
```

图层过滤器支持 `replace`、`and`、`or` 和 `clear`。GeoJSON 源过滤器支持
`replace` 和 `clear`。过滤器只使用表达式语法。任一操作失败都会回滚整个候选
样式;成功结果包含可重放的 RFC 6901 diff 和精确的变更图层/源 ID。

`setStyleRootProperties` 对允许的根字段执行递归的 RFC 7396 merge-patch 语义:
对象键合并,`null` 删除,数组/标量替换。它不能修改 `version`、`sources` 或
`layers`。

### 内联 GeoJSON

`/core` 声明覆盖了所有 RFC 7946 几何体(`Point`、`MultiPoint`、`LineString`、
`MultiLineString`、`Polygon`、`MultiPolygon` 和 `GeometryCollection`)、
Feature、FeatureCollection、2D/3D 包围盒、字符串/数字 ID、可空 properties 以及
JSON 外来成员。`validateInlineGeoJson` 返回经描述符净化的纯快照,并强制执行以下
默认限制:

- 序列化字节:5 MiB;
- feature 数:100,000;
- 坐标位置数:1,000,000;
- 几何嵌套深度:16;
- 属性嵌套深度:32。

当受信调用方需要不同上限时,传入 `GeoJsonLimits` 覆盖。`analyzeGeoJson` 返回名为
`available` 的判别联合:内联数据报告几何计数、范围、属性类型/取值范围/高频值
和警告;远程 URL 报告 `{available:false, reason:'remote-url'}`,不发起网络请求。

使用 `listSourceLayers` 可以从样式元数据和图层引用中做无网络的 source-layer
发现。结构化工厂还暴露 `duplicateLayer`、`addLayerFromSource` 和原子性的
`addGeoJsonLayer`;最后一个操作把内联源和图层一起校验、一起添加,要么同时提交,
要么都不提交。

### MapLibre 适配器与实时数据

```ts
import {
  applyTransactionToMap,
  runtimeGeoJsonSourceDiffSchema,
} from 'maplibre-style-tools/maplibre';

const parsed = runtimeGeoJsonSourceDiffSchema.safeParse({
  update: [{
    id: 'station-1',
    addOrUpdateProperties: [{ key: 'status', value: 'open' }],
  }],
});

if (parsed.success) {
  await source.updateData(parsed.data);
}
```

`RuntimeGeoJsonSourceDiff`、`RuntimeGeoJsonFeaturePatch` 和
`RuntimeGeoJsonPropertyPatch` 是本包自有的封闭 JSON DTO。它们的严格 schema 在
唯一一次受等待的 `GeoJSONSource.updateData(diff)` 调用之前净化输入。该边界刻意
用 `JsonValue` 取代 MapLibre 上游嵌套的 `any` 属性值,使未校验的宿主值和多余
命令键无法通过公开的增量更新 API 进入。

`applyTransactionToMap` 校验当前地图样式、制备不透明的不可变事务句柄、检测
revision 冲突、等待样式加载/哈希确认,并报告返回的样式是权威 `current`、已保存
的 `pre-operation`,还是 `unavailable`。MapLibre 的 `diff` 选项默认为 `true`;
显式传 `diff:false` 仍会执行并等待真实的应用(以及任何回滚)。它只改变
MapLibre 的渲染行为 —— 语义核心 diff 和变更 ID 仍保留在结果中。

渲染/源要素查询仅由适配器提供,并同时受要素数量和序列化字节约束。返回的要素
对象被投影为 JSON 快照,可选属性白名单;截断是显式的,而不是返回无界的
MapLibre 对象图。

### 能力结果契约

每个能力都返回同一个判别信封,在 AI SDK、MCP 和 CLI 接口间完全一致:

```ts
type CapabilityResult<TData> =
  | { success: true; message: string; data: TData }
  | { success: false; message: string; error: StyleToolError };
```

(`/ai` 以 `AiStyleToolResult` 别名导出该形状。)

成功结果包含 `data`;失败结果包含真实的、由本包创建的 `StyleToolError`。统一后
的 AI 接口不接受 `getState`,不返回任意应用状态,也绝不返回完整的样式文档或
`data.style`。需要完整文档时,通过 `/core` 或你的 MapLibre Map 实例读取。

AI 输入是严格的原生 JSON 结构。不要把嵌套对象或数组编码成字符串;非法输入会
在触及处理器或地图之前,以 `INVALID_INPUT` 被拒绝。

GeoJSON 源更新:在 `applyStyleTransaction` 中用 `setGeoJsonData` 做原生整体替换
(`setData`);用 `runMapCommand` 的 `action: 'updateGeoJsonData'` 做原生增量
diff(`updateData`)。

## 命令行界面

安装后的包提供 `maplibre-style` 二进制。它无需网络即可校验和检查样式,并应用
与库相同的严格核心事务:

```bash
maplibre-style --help
maplibre-style validate style.json
maplibre-style inspect style.json --query road
maplibre-style inspect style.json --type line --source basemap --source-layer transportation
maplibre-style inspect style.json --layer road-primary
maplibre-style inspect style.json --source-id basemap
maplibre-style inspect style.json --source-layers
maplibre-style inspect style.json --analyze-geojson points
maplibre-style apply style.json --operations operations.json --dry-run
maplibre-style apply style.json --operations operations.json --output next-style.json
maplibre-style apply style.json --operations operations.json --in-place --backup
```

用 `-` 代替样式路径或操作路径,即可从 stdin 读取该输入。单次调用不能同时从
stdin 读取两个输入。stdout 在流可写期间恰好包含一个 JSON 值,包括 `--help`
信封;诊断信息走 stderr。命令结果是共享的能力信封
(`{ "success", "message", "data" | "error" }`)。退出码:`0` 成功;`1` 请求合法但
被样式或事务语义拒绝;`2` 参数/输入/JSON 错误;`3` 输出或内部故障。

apply 不会修改输入,除非显式给出 `--in-place`。`--dry-run` 只报告候选结果;
`--output` 以排他方式创建新文件 —— 不会覆盖已有路径。就地写入使用同目录排他
临时文件,先 sync,再 rename 覆盖输入,然后 sync 目录。`--backup` 创建不覆盖的
`<STYLE>.bak`;已存在的备份绝不会被替换或删除。

`--output` 和安装后的就地候选都是紧凑的 `JSON.stringify(style)` 字节,没有末尾
换行。因此,恰好处于 5 MiB 边界、被核心接受的样式仍能被 CLI 读取。备份保留来自
描述符的、精确的原始有界输入字节;既不重新序列化,也不通过可能产生竞态的路径名
重新读取。

就地身份校验在替换前比对原始描述符与路径。它们在最后的 `lstat`-到-`rename`
区间是尽力而为的。提交前失败会删除本次调用创建的备份,以便重试不被阻塞;而
调用之前就存在的备份绝不会被删除。

| 状态 | 文件字节 | Stdout | Stderr | 退出码 |
| --- | --- | --- | --- | ---: |
| 提交前文件系统失败 | 原始/无新输出 | 未动 | 普通输出错误;无 `File committed` | 3 |
| rename 后目录持久化失败 | 新 | 可写时为已提交状态 JSON;否则不可信 | 持久化诊断,stdout 失败时给出明确的已提交回退说明 | 3 |
| 文件完全提交后 stdout 结果失败 | 新 | 不可信;绝不重试 | `File committed` 诊断 | 3 |

包含 `{"committed":true,"durable":false,...}` 的已提交状态 JSON 结果表示新样式已
安装,但目录 sync 失败。如果该确认无法写出且 stderr 可写,stderr 会明确报告
"已提交、持久性不确定"的状态。同样,如果 `--output` 或 `--in-place` 已提交、只有
之后的结果写出失败,文件保持已变更状态,stderr 会报告它已提交。在这两个已提交
分支中,退出码 `3` 都不能证明文件未写入;调用方必须检查目标位置,不得盲目重试。

stdout 传输失败可能使 stdout 为空或只写了一部分,因而无法解析;此时 stderr 是
唯一可能的报告通道。每次写操作都拥有自己的临时 Writable `error` 监听器。
EPIPE 和已关闭的流选择退出码 `3`;stderr 报告是尽力而为的:如果 stderr 也已关闭,
CLI 保留选定的退出码,且不抛出未捕获错误。

## MCP 服务器

普通 MCP 宿主使用安装后的 stdio 服务器:

```bash
maplibre-style-mcp --stdio
```

stdout 专用于换行分隔的协议消息;启动诊断只走 stderr。默认 `maxMessageBytes`
为 5 MiB,嵌入方可以在 128 KiB 到 64 MiB 之间配置。`runStdioMcp` 接受
`startupDiagnosticLine`:省略时写默认 ready 行;传字符串则写该确切单行诊断;传
`null` 则抑制。组合宿主应传 `null`,然后在所有组件就绪后自行发出并等待自己的
交接诊断。

可选的受保护 Streamable HTTP 监听器供受信客户端使用:

```bash
TOKEN='replace-with-a-random-secret'
maplibre-style-mcp --http --bearer-token "$TOKEN"
```

默认绑定 `127.0.0.1` 的随机端口。指定其他网络接口需要 `--allow-non-loopback`。
每个请求都必须提供 bearer token 和精确的绑定 `Host`;存在浏览器 `Origin` 时,
必须等于绑定源或显式白名单条目。监听器在读取请求体或分配 MCP 传输之前就校验
这些头。它有意禁用重放和 JSON 批量聚合:Streamable HTTP 使用不可重放的 SSE,
批量中的每个响应都独立限界。应用层样式会话 ID 与 SDK 传输会话 ID 是不同的。

两种传输都不接受路径或 URL 作为样式输入,也都不发起网络请求。包派生的服务器
版本在构建期生成。

## 实时 MapLibre 浏览器桥接

浏览器桥接把现有 MapLibre 地图连接到由 `maplibre-style-mcp` 托管的实时地图
扩展。从 MCP 工具调用到实时地图的端到端运行路径,见
[MCP 如何访问运行中的 MapLibre 地图](docs/mcp-live-map-access.md)(英文)。

页面通过 `connectMapLibreBridge` 连接它的地图:

```ts
import { connectMapLibreBridge } from 'maplibre-style-tools/bridge';

const connection = connectMapLibreBridge(map, {
  mapId: 'demo-map',
  url: 'ws://127.0.0.1:7788',
  token: processSuppliedToken,
  capabilities: [
    'style.read', 'style.write', 'features.query', 'runtime.state',
    'assets.write', 'network.load',
  ],
  allowedResourceOrigins: [],
});

await connection.whenReady();
```

完整的 MCP 实时地图能力对等需要授予全部六项能力:`style.read`、`style.write`、
`features.query`、`runtime.state`、`assets.write` 和 `network.load`。这些能力作用
于已连接的实时地图目标;MCP 会话目标仍是离线文档工作流。

token 在 WebSocket 首帧中发送,绝不出现在 URL 里。独立示例用显式的密码输入框
索取 token,只为这次临时连接保留;它不会进入页面 URL、存储、状态文本、日志或
错误信息。`/bridge` 入口(本仓库的 `src/bridge/index.ts`)仅限浏览器。它不导出
`createBridgeServer` 或 `LiveMapRegistry`;Node WebSocket 桥接归 MCP 二进制所有。

同时启动 stdio MCP 服务器和它的回环 WebSocket 桥接:

```bash
maplibre-style-mcp --stdio \
  --bridge-host 127.0.0.1 \
  --bridge-port 7788 \
  --bridge-origin http://127.0.0.1:5173
```

两个组件就绪后,stderr 恰好包含一条严格的交接记录。生成 token 的 stdio 记录
形如;stdout 仍专用于 MCP 帧:

```json
{"event":"bridge_listening","mcpTransport":"stdio","wsUrl":"ws://127.0.0.1:7788","allowedOrigins":["http://127.0.0.1:5173"],"token":"GENERATED_SECRET"}
```

每次交接都有 `event: "bridge_listening"`、`mcpTransport` 和实际绑定的 `wsUrl`。
stdio 记录不得包含 `mcpUrl`。HTTP 记录包含实际绑定的 `mcpUrl`,客户端必须用它
做端点发现。调用方提供的桥接 token 会有意不出现在 stderr;生成的 token 只报告
一次,供浏览器连接。

实时变更通过能力信封作用到已连接的地图。桥接权威源在提交前一刻读取地图的当前
revision 和样式哈希,因此调用方不必提供乐观并发状态:

```json
{"name":"applyStyleTransaction","arguments":{"target":{"kind":"map","mapId":"demo-map"},"input":{"transaction":{"operations":[{"op":"setLayerProperties","layerId":"roads","paint":{"line-color":"#4c78a8"}}]}}}}
```

如果地图在读取与提交之间发生变化,桥接拒绝该变更,调用方收到
`REVISION_CONFLICT` 失败;调用方必须读取当前地图状态、重新对齐意图,并审慎地
提交新请求。MCP 和浏览器客户端都不重试变更。其他稳定的实时错误包括
`BRIDGE_DISCONNECTED`、`CAPABILITY_DENIED`、`MAP_NOT_READY` 和 `TIMEOUT`。

### 实时资源与规范地图 ID

固定的地图集合是 `maplibre-style://maps`。它通告的两个模板恰好是:

- `maplibre-style://maps/~{mapId}`
- `maplibre-style://maps/~{mapId}/style`

请使用公开构建器并传入语义 ID,而不是预编码的值:

```ts
import {
  buildLiveMapMetadataUri,
  buildLiveMapStyleUri,
} from 'maplibre-style-tools/mcp';

await client.readResource({ uri: buildLiveMapMetadataUri('a.b') });
await client.readResource({ uri: buildLiveMapStyleUri('a.b') });
```

构建器添加同段的 `~` 标记,并且对 ID 恰好编码一次。传输层在 SDK 构造 `URL`
之前校验原始的 `resources/read` URI。会改变归一化结果的点前缀、字面或编码的
点段、未保留字符的编码别名、双重编码以及未带标记的地图路由,都会在零解析工作
量下被拒绝。只有规范的原始 URI 能到达资源回调,在那里语义 ID 被解码一次。

### 资源授权

样式资源检查覆盖根 `glyphs`、`sprite` 与 import URL;源的 `url`、`tiles` 和
`urls`;字符串形式的 GeoJSON `data`;image/video 源 URL;运行时图片 URL;
`data:` URL;以及自定义协议。未发生变化的基线"路径加取值"对可以保留在候选中。
任何新引入或变化的相对样式 URL 都会在 `Map#setStyle` 之前被拒绝,无论
`resourceBaseUrl`、当前 `document.baseURI` 或之后的 `<base>` 变更如何。

新引入或变化的绝对网络资源需要 `network.load` 能力,并且必须满足精确配置的源
与 URL 前缀规则。`data:` 是单独的显式选项;自定义协议必须被显式允许并注册。
资源取值会从公开失败信息中抹除。

`resourceBaseUrl` 只有一个更窄的用途:独立的运行时图片 API 会把相对图片输入
对照连接创建时捕获的 base 解析一次,授权后把该确切绝对 URL 交给加载器。因此
没有 document 的 worker 需要显式的运行时图片 base,但任何 base 都无法启用相对
样式资源。

### 实时限制与响应权威

实时桥接暴露的默认值与固定上限:

- 每个 WebSocket 消息和每个受校验样式:5 MiB;
- 每个事务 100 个操作;
- 100 个返回要素,要素查询序列化输出 1 MiB;
- 运行时状态与图片列表输出 64 KiB;
- 解码后的运行时图片 3 MiB;
- 单次操作 10 秒。

5 MiB 的帧检查和样式检查相互独立。即使对只写连接,运行时代码也会对初始样式、
外部改动的样式和不透明的已制备视图样式做字节检查。浏览器输出按完整结果信封
计量。需要时,可选的样式和 diff 字段被确定性地省略,成功的变更可以缩减为其
固定回执。每一个仍持有当前权威的关联变更失败 —— 包括普通的 `INTERNAL` 或
`IO_ERROR`、冲突以及超过截止时间的 `TIMEOUT` —— 都保留当前 revision 和哈希,
同时保留其主错误码。只有不可分割的超大 `getStyle` 结果才会变成稳定的尺寸失败。

实时 MCP 扩展使用工厂独立解析的 `maxMessageBytes`。读结果在触碰缓存、镜像或
TTL 之前按该预算定稿;写操作只暴露尺寸事先证明过的固定回执。变更错误被投影为
固定的、仅含元数据的真实失败,因此预算机制既不会隐藏已提交的 revision/哈希,
也不会泄漏样式、URL、token 或其他机密。`maxStyleBytes` 默认为
`DEFAULT_MAX_STYLE_BYTES`,可独立于消息上限显式调低或调高。

### 替换与重连恢复

浏览器生成的 `registrationAttemptId` 是私有的。如果注册确认丢失,浏览器在
30 秒的有限客户端预算内重放字节完全相同的注册;服务器为每个地图保留一份 60 秒
的幂等记录。被重放的代数在其强制的权威 `mapSnapshot` 确认被接受之前,在服务器
侧保持 `MAP_NOT_READY`。旧代数拥有的活动和排队工作被拒绝,并且绝不会在替换
连接上重放。

### 工具与生命周期

服务器暴露五个共享能力加三个会话管理工具。能力工具接受严格的
`{ "target", "input" }` 对象:`input` 走共享的能力校验路径(与 `/ai` 和 CLI
相同),`target` 路由样式权威源:

- `{ "kind": "session", "sessionId": "...", "expectedRevision": 0 }` 作用于有界
  内存文档会话,提交时做 revision 检查。
- `{ "kind": "map", "mapId": "..." }` 作用于通过桥接扩展连接的实时浏览器地图。
  `runMapCommand` 和 `queryMapFeatures` 要求地图目标。
- `inspectStyle` 的 `validateDocument`、`validateTransaction` 和
  `analyzeGeoJson` 动作不需要权威源;这些动作可以省略 `target`。

Bridge v2 为实时地图目标暴露完整的五工具能力面。每个工具都返回通用的
`{ success, message, data | error }` 信封;最后一列给出成功时 `data` 的形状。

| 工具 | 描述 | 所需实时桥接能力 | URL 策略 | 结果类型 |
| --- | --- | --- | --- | --- |
| `inspectStyle` | 检查样式、其受校验结构和 GeoJSON 输入,不做变更。 | 实时地图读取需要 `style.read`;无权威源的校验动作不需要目标。 | 无。 | `InspectionProjection` |
| `applyStyleTransaction` | 对会话或实时地图应用一次严格的原子样式事务。 | `style.read` + `style.write` | 无。 | `StyleMutationReceipt` |
| `applyStyleDocument` | 应用内联样式文档或绝对样式 URL。会话使用 revision 检查;实时地图通过 bridge v2 应用整个文档。 | `style.read` + `style.write`;URL 源还需要 `network.load`。 | 新引入或变化的绝对资源必须匹配配置的源/前缀策略;相对样式资源被拒绝。 | `StyleMutationReceipt` |
| `runMapCommand` | 在实时地图上运行全部有界 SDK 运行时动作:GeoJSON 增量更新、源 LOD、要素/全局状态、图片和雪碧图。 | 按动作:`updateGeoJsonData` → `style.write`;源 LOD/要素/全局状态 → `runtime.state`;图片/雪碧图列举 → `style.read`;图片/雪碧图变更 → `assets.write`;URL 添加还需要 `network.load`。 | `addImageFromUrl` 和 `addSprite` 要求已准入的绝对 URL;`data:` 和自定义协议要求各自的显式选项。 | `MapCommandReceipt` |
| `queryMapFeatures` | 从实时地图目标查询有界的源要素或渲染要素。 | `features.query` | 无。 | `FeatureQueryProjection` |
| `openStyleSession` | 从内联样式 JSON 打开一个有界内存会话。 | 非实时桥接工具。 | 无。 | 会话元数据 |
| `closeStyleSession` | 关闭一个内存样式会话。 | 非实时桥接工具。 | 无。 | 关闭确认 |
| `exportStyleSession` | 导出会话当前或某个保留的 revision。 | 非实时桥接工具。 | 无。 | 样式文档加 revision |

打开会话后,只针对期望的 revision 提交,并导出同一个或保留的 revision:

```json
{"name":"openStyleSession","arguments":{"style":{"version":8,"sources":{},"layers":[]}}}
```

```json
{"name":"applyStyleTransaction","arguments":{"target":{"kind":"session","sessionId":"SESSION","expectedRevision":0},"input":{"dryRun":true,"transaction":{"operations":[{"op":"setStyleRootProperties","properties":{"metadata":{"owner":"maps"}}}]}}}}
```

```json
{"name":"exportStyleSession","arguments":{"sessionId":"SESSION","revision":0}}
```

dry run 返回语义 diff,但不推进 revision 或历史。提交是原子的,要求精确的当前
revision,推进一次,最多保留 20 条历史。成功的会话变更在 `data` 中包含新的
`revision`。默认限制为 32 个会话、样式 5 MiB、100 个操作、diff 1 MiB、30 分钟
空闲 TTL;生成的会话 ID 限制在 512 UTF-8 字节。

无需任何权威源即可检查会话图层或校验内联 JSON:

```json
{"name":"inspectStyle","arguments":{"target":{"kind":"session","sessionId":"SESSION"},"input":{"action":"getLayer","layerId":"roads"}}}
```

```json
{"name":"inspectStyle","arguments":{"input":{"action":"validateDocument","style":{"version":8,"sources":{},"layers":[]}}}}
```

所有工具结果使用共享能力信封
`{ "success": true, "message": ..., "data": ... }` 或
`{ "success": false, "message": ..., "error": { ... } }`,在 MCP、AI SDK 和 CLI
接口间完全一致。成功的工具结果保持其 JSON 文本内容与 `structuredContent` 相等。

### 资源与规范标识符

通告的六个资源模板是:

- `maplibre-style://sessions/~{sessionId}`
- `maplibre-style://sessions/~{sessionId}/style`
- `maplibre-style://sessions/~{sessionId}/context`
- `maplibre-style://sessions/~{sessionId}/layers/~{layerId}`
- `maplibre-style://sessions/~{sessionId}/sources/~{sourceId}`
- `maplibre-style://sessions/~{sessionId}/revisions/~{revision}/diff`

字面 `~` 标记属于每个语义变量。通用客户端按 RFC6570 提供每个原始语义 ID ——
模板恰好执行一次编码。不要预加标记、双重编码或自行归一化。`makeSessionUri`、
`makeStyleUri`、`makeContextUri`、`makeLayerUri`、`makeSourceUri` 和
`makeDiffUri` 等导出辅助函数保留包括 `.`、`..`、`~`、`%` 和 `/` 在内的标识符,
不产生别名或双重解码。

### 嵌入

```ts
import {
  createMapLibreStyleMcpServer,
  createStyleSessionStore,
} from 'maplibre-style-tools/mcp';

const store = createStyleSessionStore();
const created = createMapLibreStyleMcpServer({ store });
await created.connect(transport);
```

注入的 store 必须是 `createStyleSessionStore` 返回的、带确切品牌的对象;结构化
仿冒和代理会被拒绝。扩展严格同步,并显式返回 `undefined`。每个资源扩展在组合
冻结之前,通过共享上下文注册一个不相交的 `ResourceUriAdmission`(含 `scheme`、
`authority` 和 `assertCanonical`);注册和扩展组合保持同步。

公开工厂的 `connect` 和 `close` 方法本身已有界且有状态。不要持有或调用 SDK 底层
的原始 connect/close 方法。`maxMessageBytes` 把超大的应用结果原子地替换为固定的
`responseTooLarge` 信封:投影工作不会重跑,也不会发出部分结果。其入站边界按
精确的原始字节计数,出站边界对最终序列化的 JSON-RPC 消息把关。只有 stdio 和
HTTP 运行器选择预限界输入模式;直接的工厂连接自行做规范的入站字节校验。

### 只读 MCP Builder 评估

构建仓库后,启动确定性的、仅评估用的夹具服务器:

```bash
node evals/maplibre-style-mcp-fixture-server.mjs
```

它预置 `evals/maplibre-style-mcp.xml` 描述的十个独立会话,然后使用与安装版
服务器相同的公开有界 stdio 运行器、工具、资源和服务器元数据。该夹具仅存在于
仓库中,不随打包发布。默认的 `maplibre-style-mcp` 二进制既不包含也不发现这些
评估会话。

## 示例

两个 Vite 示例针对浏览器内的实时地图演练本包。先执行 `pnpm run build` 构建本包。

- `examples/browser-bridge` 把 MapLibre 地图连接到 MCP 实时桥接,并显示连接
  状态。运行 `pnpm run example:dev` 后打开 `http://127.0.0.1:5173/`。
- `examples/ai-chat` 是一个中文聊天助手,通过覆盖五个能力的 LLM 工具调用循环
  驱动实时地图。它同时支持 OpenAI 兼容(`/chat/completions`)和 Anthropic
  Messages(`/messages`)两类 provider,工具 schema 由 `/capabilities` 的
  `createOpenAiFunctionTools`/`createAnthropicTools` 生成。运行
  `pnpm run example:dev:ai-chat` 后打开 `http://127.0.0.1:5174/`,粘贴 API Key,
  然后用中文提问,例如「把海洋换成淡蓝色」。

## 开发

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run clean
pnpm run build
pnpm test
npm pack --dry-run
```

构建输出写入 `dist/`。测试使用 Node 内置测试运行器,编译到 `.tmp/test-dist/`。
