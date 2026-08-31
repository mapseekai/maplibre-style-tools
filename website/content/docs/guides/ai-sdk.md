---
title: AI SDK
description: Expose the five shared capabilities as AI SDK tools over an in-process map.
weight: 40
---

Use `/ai` when the application owns a live MapLibre map and wants an AI SDK-compatible tool set in the same process. This facade wraps the shared [capability registry](../capabilities/); it does not create a network transport or select a map outside the accessor you provide.

## Create the tool set {#create-the-tool-set}

```ts
import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';

const tools = createMapLibreStyleTools({
  getMap: () => map,
});
```

The factory returns exactly five tools: `inspectStyle`, `applyStyleTransaction`, `applyStyleDocument`, `runMapCommand`, and `queryMapFeatures`. Their names, descriptions, model schemas, and execution semantics come from the same registry used by the other interfaces.

## Pass tools to a model {#pass-tools-to-a-model}

Pass the returned object as the AI SDK `tools` option. The model receives the bounded tool definitions; map access remains inside the `getMap` callback.

```ts
import { generateText } from 'ai';

const response = await generateText({
  model,
  prompt: 'Make roads easier to see.',
  tools,
});
```

Choose the model and any loop or approval policy in the host application. A tool definition is not an authorization policy for mutations.

## Execute directly {#execute-directly}

Use a tool's `execute` method when the application, rather than a model, supplies a validated intent.

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

Inputs are native JSON values, not JSON-encoded strings. Capability validation still runs at execution time.

## Map availability {#map-availability}

`getMap` is evaluated when a tool runs. It may return `null`, or safely fail while the page is changing; the tool then returns the normal `MAP_NOT_READY` failure envelope. Use this to keep tool availability aligned with the application lifecycle instead of retaining a stale map reference.

## Result handling {#result-handling}

Each tool returns the shared discriminated result envelope: a success has `data`, while a failure has a package-created `StyleToolError`. Check `success` before using `data`.

The AI facade never accepts `getState`, never returns arbitrary application state, and never returns a complete Style document or `data.style`. Read a full Style through the [core boundary](../core/) or the MapLibre map when the application genuinely needs it.
