---
title: 安装
description: 从 npm 安装，或从本地仓库安装。
weight: 20
---

```bash
npm install maplibre-style-tools maplibre-gl
```

一次安装，你会得到：

- 八个库入口 —— `maplibre-style-tools`、`/core`、`/maplibre`、`/capabilities`、`/ai`、`/webmcp`、`/mcp`、`/bridge`
- 两个可执行文件：`maplibre-style`（校验、检查、转换样式文件）和 `maplibre-style-mcp`（MCP 服务器）

`maplibre-gl` 是对等依赖，凡是涉及地图都要一并安装。

## ESM 与 CommonJS

包只发布 ESM，没有 `.cjs` 产物。Node 22.13 及以上，CommonJS 代码可以直接通过 Node 的 `require(esm)` 支持加载。

## 从本地仓库安装

要改这个包本身？先构建一次，再从兄弟项目引用：

```bash
cd ../maplibre-style-tools
pnpm install
pnpm run build
cd ../your-project
pnpm add ../maplibre-style-tools
pnpm add maplibre-gl
```

## 下一步

应用自带实时地图，看 [AI SDK 快速上手](../ai-sdk-quick-start/)；处理样式文件，看 [CLI 快速上手](../cli-quick-start/)。
