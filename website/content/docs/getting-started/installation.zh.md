---
title: 安装
description: 从 npm 或本地检出安装软件包。
weight: 20
---

从 npm 安装软件包及其 MapLibre Peer Dependency：

```bash
npm install maplibre-style-tools maplibre-gl
```

## 从本地检出安装 {#install-from-a-local-checkout}

先构建一次相邻目录中的检出，再将它添加到项目：

```bash
cd ../maplibre-style-tools
pnpm install
pnpm run build
cd ../your-project
pnpm add ../maplibre-style-tools
pnpm add maplibre-gl
```

## ESM 与 CommonJS {#esm-and-commonjs}

发布的软件包仅提供 ESM。在受支持的 Node.js 版本中，CommonJS 代码可通过 Node 对 `require(esm)` 的支持加载它，但不会发布 `.cjs` 产物。

接下来，如果使用实时地图，请阅读 [AI SDK 快速开始](../ai-sdk-quick-start/)；如果使用 Style 文件，请阅读 [CLI 快速开始](../cli-quick-start/)。
