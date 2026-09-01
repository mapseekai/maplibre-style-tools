---
title: Requirements
description: What your runtime needs before you install.
weight: 10
---

Two things to check before you install:

- **Node.js 22.13 or newer.** The package is ESM-only. CommonJS projects on a supported Node version can still load it directly with `require()`.
- **`maplibre-gl` 6.3 or newer — only if you touch a map.** It is a peer dependency, so your application picks the version and the package never bundles its own copy.

## Per-interface extras

| If you use | You also need |
| --- | --- |
| `/ai` | An AI SDK 6 host (`ai` `^6.0.141`) and an in-process `map` |
| `/webmcp` | A browser that exposes `document.modelContext` |
| `/maplibre`, `/bridge` | A browser or MapLibre host environment |
| `/mcp`, the CLI | Node.js only |
| `/core`, `/capabilities` | Whatever host provides your styles; no map required |

`document.modelContext` support is detected at registration time: on a browser without it, registration resolves with `supported: false` instead of failing. WebMCP is still a draft, so check the [specification](https://webmachinelearning.github.io/webmcp/) and [Web Platform Test results](https://wpt.fyi/results/webmcp) rather than a browser-version list.
