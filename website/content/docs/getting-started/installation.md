---
title: Installation
description: Install the package from npm or a local checkout.
weight: 20
---

Install the package and its MapLibre peer dependency from npm:

```bash
npm install maplibre-style-tools maplibre-gl
```

## Install from a local checkout {#install-from-a-local-checkout}

Build a sibling checkout once, then add it to your project:

```bash
cd ../maplibre-style-tools
pnpm install
pnpm run build
cd ../your-project
pnpm add ../maplibre-style-tools
pnpm add maplibre-gl
```

## ESM and CommonJS {#esm-and-commonjs}

The published package is ESM-only. On supported Node.js versions, CommonJS code can load it with `require(esm)` through Node support, but no `.cjs` artifact is published.

Next, choose [AI SDK Quick Start](../ai-sdk-quick-start/) for a live map or [CLI Quick Start](../cli-quick-start/) for a Style file.
