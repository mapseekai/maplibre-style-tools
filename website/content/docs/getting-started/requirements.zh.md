---
title: 环境要求
description: 安装前，你的运行环境需要满足什么。
weight: 10
---

安装前确认两件事：

- **Node.js 22.13 或更新。** 本包只提供 ESM。在受支持的 Node 版本上，CommonJS 项目可以直接 `require()` 加载。
- **`maplibre-gl` 6.3 或更新 —— 只在需要操作地图时。** 它是对等依赖，版本由你的应用决定，本包不会自带一份。

## 各接口的额外要求

| 你使用 | 还需要 |
| --- | --- |
| `/ai` | AI SDK 6 宿主（`ai` `^6.0.141`）和进程内的 `map` |
| `/webmcp` | 暴露 `document.modelContext` 的浏览器 |
| `/maplibre`、`/bridge` | 浏览器或 MapLibre 宿主环境 |
| `/mcp`、CLI | 只需要 Node.js |
| `/core`、`/capabilities` | 提供样式的宿主即可，无需地图 |

`document.modelContext` 在注册时做特性检测：浏览器不支持时，注册以 `supported: false` 正常结束，不会报错。WebMCP 仍是草案，请查看[规范草案](https://webmachinelearning.github.io/webmcp/)和 [Web Platform Tests 结果](https://wpt.fyi/results/webmcp)，不要依赖浏览器版本号判断。
