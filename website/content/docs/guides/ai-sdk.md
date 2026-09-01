---
title: AI SDK
description: Five ready-made tools over an in-process map.
weight: 40
---

`/ai` turns the capability registry into an AI SDK 6 tool set over a map your application owns. One factory call: the model gets five well-described tools, and your map stays behind a callback you control.

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

You get exactly `inspectStyle`, `applyStyleTransaction`, `applyStyleDocument`, `runMapCommand`, and `queryMapFeatures` — names, descriptions, and schemas projected from the same registry the other interfaces use.

Choosing the model, approval flows, and when mutations are allowed is your application's policy. A tool definition is not an authorization policy.

## Call tools directly when the intent is already validated

No model required — every tool exposes `execute`:

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

Inputs are native JSON values — pass objects and arrays as themselves, never as JSON-encoded strings. Validation still runs at execution time.

## Map availability follows your application's lifecycle

`getMap` runs when a tool executes. Return `null` while the page loads or after teardown, and callers get the normal `MAP_NOT_READY` failure — no stale map references, no crashes.

## Results need one pattern

Success has `data`; failure has a package-created `StyleToolError`. Check `result.success`, then read accordingly. Inspections return compact projections — read a full style document through [`/core`](../core/) or the Map instance when you actually need it.

## Next

For a minimal end-to-end setup, see the [quick start](../../getting-started/ai-sdk-quick-start/). To expose tools without an AI SDK dependency, compare [WebMCP](../webmcp/) and [MCP](../mcp/).
