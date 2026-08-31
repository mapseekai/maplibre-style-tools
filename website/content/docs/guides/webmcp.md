---
title: WebMCP Site Tools
description: Register page-scoped browser tools with read-only defaults and explicit mutation opt-in.
weight: 60
---

Use `/webmcp` when a browser exposes `document.modelContext` to the page. WebMCP Site tools are JavaScript functions with descriptions and structured schemas that the browser makes discoverable and invocable by an agent working with that page. Registration is page-scoped and browser-only; it needs neither an MCP server process nor a browser bridge.

## When to use WebMCP {#when-to-use-webmcp}

WebMCP is for a live, in-page interaction where the page remains the authority for map access. The required browser surface is `document.modelContext`; support is detected at registration time. Use [MCP](../mcp/) when an external MCP host needs a wire-protocol server, and use the [Browser Bridge](../bridge/) only when that host must reach a browser map.

## Read-only registration {#read-only-registration}

```ts
import { registerMapLibreWebMcpTools } from 'maplibre-style-tools/webmcp';

const registration = await registerMapLibreWebMcpTools({
  getMap: () => map,
  signal: pageLifetime.signal,
});

if (!registration.supported) {
  console.info('This browser does not expose WebMCP Site tools.');
}
```

The default registration exposes only `inspectStyle` and `queryMapFeatures`. If `document.modelContext` is unavailable, registration resolves with `supported: false`; treat that as the expected feature-detection result, not as an error or permission to add another transport silently. WebMCP is still an evolving Community Group draft, so do not infer support from a pinned browser-version list: check the authoritative [WebMCP draft](https://webmachinelearning.github.io/webmcp/) and current [Web Platform Test results](https://wpt.fyi/results/webmcp).

## Mutation opt-in {#mutation-opt-in}

Set `allowMutations: true` only when the page intentionally exposes writes. It adds exactly three mutation-capable tools: `applyStyleTransaction`, `applyStyleDocument`, and `runMapCommand`. Pair this opt-in with suitable invocation authorization and resource policy; the flag alone is not an authorization boundary.

## Invocation authorization {#invocation-authorization}

Provide `authorizeInvocation` to make the page's decision for each invocation, and use `onInvocation` only for observation. A denied invocation returns the bounded capability result rather than bypassing page authority. Keep the registration tied to page lifetime with `signal`, and close it when the page no longer owns the map.

## How it differs from MCP {#how-it-differs-from-mcp}

WebMCP registers the applicable shared registry contracts as JavaScript tools in a supporting browser. `/mcp` is a server that speaks the MCP wire protocol over stdio or protected HTTP. WebMCP’s default is two read-only page tools while MCP exposes all five capability names and can also manage bounded offline sessions and registered live-map targets.
