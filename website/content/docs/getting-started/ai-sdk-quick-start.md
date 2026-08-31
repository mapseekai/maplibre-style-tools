---
title: AI SDK Quick Start
description: Inspect a live MapLibre Style through the AI SDK interface.
weight: 30
---

Use this path after your application has created a live MapLibre `map` instance. The factory returns exactly five tools: `inspectStyle`, `applyStyleTransaction`, `applyStyleDocument`, `runMapCommand`, and `queryMapFeatures`.

## Create the tools {#create-the-tools}

```ts
import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';

const tools = createMapLibreStyleTools({ getMap: () => map });
const result = await tools.inspectStyle.execute({ action: 'getLayerCount' });

if (!result.success) {
  console.error(result.error.code, result.error.message);
}
```

Pass `tools` to an AI SDK tools set, or call an individual tool’s `.execute(input)` method as shown.

## Execute an inspection {#execute-an-inspection}

`inspectStyle.execute({ action: 'getLayerCount' })` inspects the current Style through the live map and returns the shared result envelope. Use the other named tools when you need a transaction, document replacement, bounded map command, or feature query.

## Handle the result {#handle-the-result}

Always branch on `result.success`. If `getMap()` returns `null`, the call produces a normal failure envelope; it does not expose arbitrary application state. See [Capabilities](../introduction/capabilities/) for the common result contract.
