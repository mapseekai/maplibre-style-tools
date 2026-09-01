---
title: MCP 服务器
description: 通过 stdio 或受保护的 HTTP，提供有界的样式会话与实时地图。
weight: 50
---

`/mcp` 运行一个 MCP 服务器，供桌面应用、IDE 或你自己的 Agent 等外部宿主连接。它暴露五个能力外加会话管理，还能通过[桥接](../bridge/)操作实时浏览器地图。它不接受样式路径或 URL，也不发起任何网络请求。

## 传输方式

| 传输 | 适用 | 命令 |
| --- | --- | --- |
| stdio | 本地宿主直接拉起服务器 | `maplibre-style-mcp --stdio` |
| Streamable HTTP | 能保管 bearer 密钥的可信客户端 | `maplibre-style-mcp --http --bearer-token "$TOKEN"` |

两者执行同样的有界消息策略，返回同样的能力信封。

## stdio

```bash
maplibre-style-mcp --stdio
```

stdout 只承载换行分隔的协议消息，启动诊断走 stderr，宿主解析 stdout 时不用过滤日志。默认消息上限 5 MiB，可通过 `maxMessageBytes` 在 128 KiB 到 64 MiB 之间配置。

## Streamable HTTP

```bash
TOKEN='replace-with-a-random-secret'
maplibre-style-mcp --http --bearer-token "$TOKEN"
```

监听器默认绑定 `127.0.0.1` 的随机端口；绑定其他接口需要 `--allow-non-loopback`。每个请求必须携带 bearer token 和完全匹配的 `Host`；浏览器发来的 `Origin` 必须等于绑定源或命中显式白名单。这些检查在读取请求体、分配传输之前完成。

## 样式会话

把校验过的样式打开成会话，对着它做带 revision 的事务，用完关闭。会话有界、驻留内存，并与任何已连接的实时地图保持隔离。会话 ID 是应用数据，与 MCP 传输自身的会话 ID 是两回事。

## 经桥接接入实时地图

宿主带上桥接参数启动后，浏览器页面可以把自己的地图注册为实时目标，见[浏览器桥接指南](../bridge/)。只有注册过的浏览器地图才会成为实时目标；连接了的浏览器不会把离线会话变成实时地图。

## 下一步

字段级 DTO 形状见权威的 [MCP/会话类型](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/types.ts)；桥接配置见[浏览器桥接](../bridge/)。
