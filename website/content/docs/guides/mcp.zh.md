---
title: MCP 服务器
description: 通过 stdio 或受保护的 HTTP 提供有边界的样式会话与实时地图。
weight: 50
---

当 MCP host 需要有边界的离线 Style 会话，或通过实时地图扩展使用已连接浏览器地图时，请使用 `/mcp`。它公开五项共享能力和会话管理工具；不接受 Style 路径或 URL，也不会获取网络输入。

## 选择传输方式 {#choose-a-transport}

对于启动服务器的本地 MCP host，请使用 stdio。仅在可信客户端能够持有 bearer secret 时使用受保护的 Streamable HTTP。两种传输都执行相同的有边界消息策略和能力结果封装。

## Stdio {#stdio}

```bash
maplibre-style-mcp --stdio
```

stdout 仅用于换行分隔的协议消息。启动诊断信息写入 stderr，因此 host 可以在没有日志污染的情况下解析 stdout。默认 MCP 消息限制为 5 MiB；嵌入方可以将 `maxMessageBytes` 配置为 128 KiB 至 64 MiB。

## 受保护的 HTTP {#protected-http}

```bash
TOKEN='replace-with-a-random-secret'
maplibre-style-mcp --http --bearer-token "$TOKEN"
```

HTTP 默认绑定到 loopback（`127.0.0.1`）。非 loopback 绑定需要 `--allow-non-loopback`，并且必须保留 bearer 与 origin 检查。每个请求都需要 bearer token 和精确的绑定 `Host`；浏览器发送 `Origin` 时，它必须匹配绑定 origin 或显式 allowed-origin 条目。服务器会在读取 body 或分配 MCP transport 前检查这些 header。

## 文档会话 {#document-sessions}

Style 会话是有边界的内存文档工作流。将已验证的 Style 打开为会话，在带 revision 的文档上操作，并在结束时关闭它。会话标识符属于应用数据，与 MCP transport-session 标识符不同。即使同时连接了浏览器地图，会话目标仍保持离线。

## 实时地图扩展 {#live-map-extension}

实时地图扩展让 MCP 工具可以定位到通过[浏览器桥接](../bridge/)连接的浏览器地图。使用 bridge 选项启动 MCP host，然后仅授予页面所需的 bridge capability 与资源 origin。该扩展不会把离线会话变成实时地图：实时目标必须由已连接的浏览器客户端注册。
