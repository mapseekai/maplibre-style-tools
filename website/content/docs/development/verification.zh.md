---
title: 验证
description: 验证类型、lint、测试、示例、契约与 E2E 的命令。
weight: 30
---

改动覆盖到哪，就跑哪部分检查：

```bash
pnpm run typecheck             # TypeScript 工程与 ambient 类型边界
pnpm run lint                  # 对手写 JS/TS 跑 ESLint
pnpm run test                  # 编译并运行完整测试套件
pnpm run test:example:ai-chat  # 可运行的 AI 聊天示例
pnpm run test:example:bridge   # 可运行的桥接示例
pnpm run test:example:webmcp   # 可运行的 WebMCP 示例
pnpm run check:package         # 构建产物与包契约，含声明闭包
pnpm run verify:e2e            # 浏览器桥接与 WebMCP 端到端套件
```

## 网站也要验证

文档改动之后，站点必须保持无警告构建：

```bash
cd website
go mod verify
hugo --cleanDestinationDir --gc --minify --environment production --printPathWarnings --panicOnWarning
```

Hugo 警告被有意当作失败处理：导航和链接必须始终完好。
