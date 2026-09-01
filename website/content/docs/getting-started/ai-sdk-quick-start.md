---
title: AI SDK Quick Start
description: Give an AI model five safe tools over your live MapLibre map.
weight: 30
---

This quick start assumes your application already creates a MapLibre `map` instance. If you work with style files instead, see the [CLI quick start](cli-quick-start/).

## 1. Install

```bash
npm install maplibre-style-tools maplibre-gl
```

## 2. Create the tools

```ts
import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';

const tools = createMapLibreStyleTools({ getMap: () => map });
```

That is the whole setup. You get exactly five tools: `inspectStyle`, `applyStyleTransaction`, `applyStyleDocument`, `runMapCommand`, and `queryMapFeatures`.

## 3. Let the model use them

```ts
import { generateText } from 'ai';

const { text } = await generateText({
  model,
  prompt: 'Make the roads stand out more.',
  tools,
});
```

The model sees the five tool definitions and decides when to call them. Map access stays behind your `getMap` callback — the tools can never reach anything else in your application.

## 4. Or call a tool yourself

```ts
const result = await tools.inspectStyle.execute({ action: 'getLayerCount' });

if (result.success) {
  console.log(result.data);
} else {
  console.error(result.error.code, result.error.message);
}
```

Every tool resolves to the same envelope: branch on `result.success`, then read `result.data` or `result.error`. If `getMap()` returns `null` — the page is still loading, the map was disposed — you get a normal `MAP_NOT_READY` failure, not an exception.

## Next

The [AI SDK guide](../../guides/ai-sdk/) covers map availability, mutation safety, and result handling in depth.
