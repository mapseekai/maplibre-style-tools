---
title: WebMCP Site Tools
description: Expose the map tools to an AI agent working in the same browser page.
weight: 60
---

WebMCP Site tools are JavaScript functions that a supporting browser exposes to an AI agent working in the same page. `registerMapLibreWebMcpTools` adds the map tools to that surface. It is page-scoped and browser-only: no MCP server, no bridge.

## Register the tools

```ts
import { registerMapLibreWebMcpTools } from 'maplibre-style-tools/webmcp';

const registration = await registerMapLibreWebMcpTools({
  getMap: () => map,
  signal: pageLifetime.signal,
});

if (!registration.supported) {
  // This browser does not expose document.modelContext.
}
```

The default registration is read-only: it exposes `inspectStyle` and `queryMapFeatures` and nothing else.

## Feature detection

`supported: false` means this browser does not expose `document.modelContext`. Treat it as the feature-detection answer it is. WebMCP is still a Community Group draft, so check the [draft specification](https://webmachinelearning.github.io/webmcp/) and [Web Platform Test results](https://wpt.fyi/results/webmcp) rather than a browser-version list.

## Enabling mutations

```ts
await registerMapLibreWebMcpTools({
  getMap: () => map,
  signal: pageLifetime.signal,
  allowMutations: true,
});
```

Setting `allowMutations: true` adds exactly three tools: `applyStyleTransaction`, `applyStyleDocument`, and `runMapCommand`. Enable it only when the page intentionally exposes writes, and pair it with an `authorizeInvocation` callback so the page decides on every invocation. A denied call returns the normal bounded failure; it does not bypass the page. `onInvocation` is for observation only. Keep the registration tied to page lifetime with `signal`, and drop it when the page no longer owns the map.

## How this differs from MCP

WebMCP puts tools into the browser for an agent the user is already working with. [`/mcp`](../mcp/) is a wire-protocol server for an external host. WebMCP defaults to two read-only page tools; MCP exposes all five capabilities plus offline sessions and bridge-connected live maps.

## See it running

The [WebMCP example](https://github.com/mapseekai/maplibre-style-tools/blob/main/examples/webmcp/README.md) enables mutations and accepts native annotation comments from an agent.
