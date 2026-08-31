---
title: WebMCP Site Tools
description: Register page-scoped browser tools with read-only defaults and explicit mutation opt-in.
weight: 60
---

Use `/webmcp` when a compatible browser exposes Site tools to an AI agent working with the same page and its MapLibre map. Registration is page-scoped and browser-only; it needs neither an MCP server process nor a browser bridge.

## When to use WebMCP {#when-to-use-webmcp}

WebMCP is for a live, in-page interaction where the page remains the authority for map access. Use [MCP](../mcp/) when an external MCP host needs a wire-protocol server, and use the [Browser Bridge](../bridge/) only when that host must reach a browser map.

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

The default registration exposes only `inspectStyle` and `queryMapFeatures`. If the browser does not provide WebMCP Site tools, registration resolves with `supported: false`; treat that as a feature-detection result, not as permission to add another transport silently.

## Mutation opt-in {#mutation-opt-in}

Set `allowMutations: true` only when the page intentionally exposes writes. It adds exactly three mutation-capable tools: `applyStyleTransaction`, `applyStyleDocument`, and `runMapCommand`. Pair this opt-in with suitable invocation authorization and resource policy; the flag alone is not an authorization boundary.

## Invocation authorization {#invocation-authorization}

Provide `authorizeInvocation` to make the page's decision for each invocation, and use `onInvocation` only for observation. A denied invocation returns the bounded capability result rather than bypassing page authority. Keep the registration tied to page lifetime with `signal`, and close it when the page no longer owns the map.

## How it differs from MCP {#how-it-differs-from-mcp}

WebMCP registers JavaScript tools in a compatible browser. `/mcp` is a server that speaks the MCP wire protocol over stdio or protected HTTP. Both project the shared capabilities, but WebMCP’s default is two read-only page tools while MCP can also manage bounded offline sessions and registered live-map targets.
