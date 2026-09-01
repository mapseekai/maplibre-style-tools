---
title: Core Transactions
description: Validate and transform style documents in plain TypeScript — no browser, no map.
weight: 10
---

`/core` is the foundation the other entry points build on: strict validation, structured transactions, GeoJSON handling, and analysis on plain JSON style documents. If your tooling works on style files or documents, start here.

## Validate before you trust

`validateStyleDocument` checks a style against the MapLibre style spec. On success you get the normalized style back; on failure you get a bounded list of errors and warnings instead of an exception. Validation reads at most 5 MiB of UTF-8 JSON by default — pass `maxStyleBytes` only when your boundary needs a different cap.

## Apply a transaction

A transaction is one object with an `operations` array. Each operation carries an `op` discriminator. The whole thing is validated, applied to a candidate, and the candidate is re-validated before you see a result.

```ts
import { applyStyleTransaction } from 'maplibre-style-tools/core';

const result = applyStyleTransaction(style, {
  operations: [
    {
      op: 'setLayerFilter',
      layerId: 'roads',
      mode: 'and',
      filter: ['==', ['get', 'surface'], 'paved'],
    },
    {
      op: 'setLayerProperties',
      layerId: 'roads',
      paint: { 'line-color': '#4c78a8' },
    },
  ],
});
```

Successful results include replayable [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901) diffs and the exact changed layer and source IDs, so callers can record or replay what happened.

**Atomicity is the deal.** If any operation fails — or the final candidate fails validation — you get the original style back untouched, with empty changed-ID lists and an empty diff. There is no partial state to unwind.

Two details worth knowing: the core result uses `ok: false` for failure, which differs from the capability-level `success: false` envelope (see [core and capability failure layers](../../reference/results-and-errors/#core-capability-failures)); and the defaults are a 5 MiB style, a 1 MiB diff, and 100 operations per transaction, overridable through `StyleTransactionOptions` when you own the boundary.

## Filters are expressions, not strings

Filters use MapLibre expression syntax as native JSON values. Compose one with `composeFilter`, or make it part of an atomic change with the `setLayerFilter` and `setGeoJsonSourceFilter` operations — `replace`, `and`, `or`, and `clear` for layer filters; `replace` and `clear` for GeoJSON source filters.

`setStyleRootProperties` applies RFC 7396 merge-patch semantics to the allowed root fields: object keys merge, `null` deletes, arrays and scalars replace. It cannot touch `version`, `sources`, or `layers`.

## Inline GeoJSON, gated

`validateInlineGeoJson` checks an inline GeoJSON value before it enters a style — all RFC 7946 geometries, features, and collections, with defaults of 5 MiB serialized, 100,000 features, 1,000,000 coordinate positions, and depth caps of 16 (geometry) and 32 (properties). `analyzeGeoJson` adds counts, bounds, and property statistics; handed a URL, it reports `available: false` and never fetches.

For source-layer discovery without a network, `listSourceLayers` reads usage straight from style metadata and layer references. `duplicateLayer` and `addLayerFromSource` cover common layer surgery, and `addGeoJsonLayer` validates and adds its inline source and layer in one atomic step — both commit or neither does.

## Next

Have a live map? The [MapLibre adapter](../maplibre/) applies prepared transactions to it.
