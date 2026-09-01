---
title: Installation
description: Install from npm, or from a local checkout.
weight: 20
---

```bash
npm install maplibre-style-tools maplibre-gl
```

Installing the package provides:

- the eight library entry points: `maplibre-style-tools`, `/core`, `/maplibre`, `/capabilities`, `/ai`, `/webmcp`, `/mcp`, `/bridge`
- two executables on your `PATH`: `maplibre-style` for validating, inspecting, and transforming style files, and `maplibre-style-mcp` for the MCP server

`maplibre-gl` is a peer dependency and should be installed alongside for anything map-related.

## ESM and CommonJS

The package is published as ESM only; no `.cjs` artifacts are shipped. On Node 22.13 or newer, CommonJS code can load it directly through Node's `require(esm)` support.

## Install from a local checkout

To develop against the package locally, build it once and reference it from a sibling project:

```bash
cd ../maplibre-style-tools
pnpm install
pnpm run build
cd ../your-project
pnpm add ../maplibre-style-tools
pnpm add maplibre-gl
```

## Next

Follow the [AI SDK quick start](../ai-sdk-quick-start/) if your application owns a live map, or the [CLI quick start](../cli-quick-start/) if you work with style files.
