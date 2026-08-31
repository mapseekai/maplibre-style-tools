---
title: Requirements
description: Runtime, peer dependency, and interface-specific requirements.
weight: 10
---

Review these requirements before choosing an interface. For the shared vocabulary, see the [Overview](../introduction/overview/) and [Capabilities](../introduction/capabilities/).

## Runtime {#runtime}

`maplibre-style-tools` is ESM-only and requires Node.js `>=22.13.0`. Use an ESM-aware toolchain when importing the package.

## Peer dependencies {#peer-dependencies}

Install `maplibre-gl` `^6.3.0` in projects that use the MapLibre integration. The package declares it as a peer dependency so your application owns the MapLibre runtime version.

## Interface-specific requirements {#interface-specific-requirements}

The browser-oriented `/maplibre`, `/bridge`, and `/webmcp` entry points belong in a browser or MapLibre host. `/webmcp` additionally requires the evolving `document.modelContext` browser surface; registration returns `supported: false` when it is unavailable. See the [WebMCP guide](../../guides/webmcp/), authoritative [draft](https://webmachinelearning.github.io/webmcp/), and current [Web Platform Test results](https://wpt.fyi/results/webmcp) rather than relying on a pinned browser-version list. The Node-oriented `/ai` and `/mcp` entry points may use Node types; the CLI also runs on Node.js. The AI SDK interface needs a Node-capable AI SDK 6 host and AI SDK `^6.0.141`.

Choose the interface whose authority matches your task: `/ai` when the host application owns an in-process map, `/webmcp` for browser-mediated page tools, `/bridge` when a separate loopback MCP host must reach that browser map, or the CLI for a local Style file.
