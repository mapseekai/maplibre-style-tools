---
title: AI SDK
description: Five ready-made tools over an in-process map.
weight: 40
---

`/ai` turns the capability registry into an AI SDK 6 tool set over a map your application owns. One factory call gives the model five well-described tools, and map access stays behind a callback you control.

## Create and pass the tools

```ts
import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';
import { generateText } from 'ai';

const tools = createMapLibreStyleTools({ getMap: () => map });

const { text } = await generateText({
  model,
  prompt: 'Make the roads easier to see.',
  tools,
});
```

You get exactly `inspectStyle`, `applyStyleTransaction`, `applyStyleDocument`, `runMapCommand`, and `queryMapFeatures`, with names, descriptions, and schemas projected from the same registry the other interfaces use.

Choosing the model, approval flows, and when mutations are allowed is your application's policy. A tool definition is not an authorization policy.

## Calling a tool directly

No model is required. Every tool exposes `execute`:

```ts
const result = await tools.applyStyleTransaction.execute({
  transaction: {
    operations: [{
      op: 'setLayerProperties',
      layerId: 'roads',
      paint: { 'line-color': '#ffffff' },
    }],
  },
});
```

Inputs are native JSON values. Pass objects and arrays as themselves, never as JSON-encoded strings; validation runs at execution time either way.

## Map availability

`getMap` is evaluated when a tool executes. Return `null` while the page is loading or after teardown, and callers get a normal `MAP_NOT_READY` failure. This keeps tool availability tied to your application's lifecycle instead of a stale map reference.

## Handling results

A success carries `data`; a failure carries a package-created `StyleToolError`. Check `result.success` first, then read accordingly. Inspections return compact projections; when you actually need the full style document, read it through [`/core`](../core/) or the Map instance.

## Next

For a minimal end-to-end setup, see the [quick start](../../getting-started/ai-sdk-quick-start/). To expose tools without an AI SDK dependency, compare [WebMCP](../webmcp/) and [MCP](../mcp/).
