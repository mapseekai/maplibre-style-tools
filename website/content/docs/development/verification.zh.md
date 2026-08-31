---
title: 验证
description: 运行仓库、示例、E2E、模块与文档检查。
weight: 30
---

应运行覆盖本次修改路径的检查。仓库命令覆盖类型边界、lint、测试、示例、package contract 与浏览器 E2E 流程。

## 仓库检查 {#repository-checks}

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run test:example:ai-chat
pnpm run test:example:bridge
pnpm run test:example:webmcp
pnpm run check:package
pnpm run verify:e2e
```

- `pnpm run typecheck` 验证 TypeScript project 及其 ambient-type 边界。
- `pnpm run lint` 检查仓库源码与文档格式规则。
- `pnpm run test` 编译并运行仓库测试套件。
- `pnpm run test:example:ai-chat`、`pnpm run test:example:bridge` 和 `pnpm run test:example:webmcp` 验证可运行集成。
- `pnpm run check:package` 验证构建输出与 package contract，包括公开声明闭包。
- `pnpm run verify:e2e` 运行 browser bridge 与 WebMCP 端到端套件。

## 网站检查 {#website-checks}

```bash
cd website
go mod verify
hugo --cleanDestinationDir --gc --minify --environment production --printPathWarnings --panicOnWarning
```

修改公开文档时应运行 Hugo 命令。将 warning 视为 failure，以保持生成站点的导航与链接安全。
