---
title: Core Transactions
description: Validate and transform Style documents without a browser or transport.
weight: 10
---

The `/core` entry point is the ES-only foundation for Style-document work. It validates strict JSON inputs, transforms a document in memory, and returns a structured result; it does not need a browser, a MapLibre map, or a transport. Start with the [architecture](../../introduction/architecture/) when you need to choose an integration boundary.

## Validate a document {#validate-a-document}

Use `validateStyleDocument` before storing or handing a Style document to another boundary. It returns a normalized, validated Style on success and a bounded list of errors and warnings on failure. The default maximum Style size is 5 MiB of UTF-8 JSON; pass a positive `maxStyleBytes` option only when your boundary needs a different limit.

## Apply a transaction {#apply-a-transaction}

`applyStyleTransaction` validates the input Style, validates the transaction, applies its operations to an in-memory candidate, and validates the completed candidate before it returns success.

```ts
import { applyStyleTransaction } from 'maplibre-style-tools/core';

const result = applyStyleTransaction(
  { version: 8, sources: {}, layers: [] },
  {
    operations: [{
      op: 'setLayerProperties',
      layerId: 'roads',
      paint: { 'line-color': '#ffffff' },
    }],
  },
);
```

Every operation needs its `op` discriminator. The default limits are a 5 MiB Style, a 1 MiB diff, and 100 operations. Successful diffs use [RFC 6901 JSON Pointers](https://www.rfc-editor.org/rfc/rfc6901) so a caller can locate each changed value.

## Filter composition {#filter-composition}

Use `composeFilter` when building a combined MapLibre expression filter, or use the `setLayerFilter` and `setGeoJsonSourceFilter` transaction operations when the filter is part of an atomic change. Filters are JSON values, not JSON-encoded strings; pass expressions such as `['==', ['get', 'kind'], 'road']` directly.

## Inline GeoJSON {#inline-geojson}

`validateInlineGeoJson` validates an inline GeoJSON value before it is embedded in a Style operation. It applies the package's GeoJSON safety limits and returns the validated value or a structured error. Use it for application-provided features; it is not a network fetcher or a replacement for your source-data pipeline.

## Atomic failure {#atomic-failure}

Transactions are atomic at the document boundary. If any operation fails, or the final candidate fails Style validation, `applyStyleTransaction` returns `ok: false` with the original Style, empty changed-layer/source lists, and an empty diff. No partially transformed candidate is returned. For a live-map mutation after a successful preparation, use the [MapLibre adapter](../maplibre/).
