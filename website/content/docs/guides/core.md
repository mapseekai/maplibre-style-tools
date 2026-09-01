---
title: Core Transactions
description: Validate and transform style documents in plain TypeScript, with no browser and no map.
weight: 10
---

`/core` is the foundation the other entry points build on. It validates styles, applies structured transactions, and handles inline GeoJSON, all on plain JSON documents. If your tooling works on style files rather than live maps, and especially if a model is producing the edits, this is the entry point for you.

## Validate a style

`validateStyleDocument` checks a style against the MapLibre style spec. On success it returns the normalized style. On failure it returns a bounded list of errors and warnings rather than throwing. Validation reads at most 5 MiB of UTF-8 JSON by default; pass `maxStyleBytes` only if your boundary needs a different cap.

## Apply a transaction

A transaction is one object with an `operations` array, where every operation carries an `op` discriminator. The transaction is validated, applied to a candidate document, and the candidate is validated again before you get a result.

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

A successful result includes a replayable [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901) diff and the exact changed layer and source IDs, so whatever drove the transaction can be audited or replayed later.

Transactions are atomic. If any operation fails, or the final candidate fails validation, you get the original style back untouched, with empty changed-ID lists and an empty diff. There is no half-applied state to clean up, which matters most when the caller is a model that will just try again.

Two details worth knowing: the core result uses `ok: false` for failure, which differs from the capability-level `success: false` envelope (see [core and capability failure layers](../../reference/results-and-errors/#core-capability-failures)). And the defaults are a 5 MiB style, a 1 MiB diff, and 100 operations per transaction, all overridable through `StyleTransactionOptions` when you own the boundary.

## Filters

Filters use MapLibre expression syntax as native JSON values. Compose one with `composeFilter`, or make it part of an atomic change with the `setLayerFilter` and `setGeoJsonSourceFilter` operations. Layer filters support `replace`, `and`, `or`, and `clear`; GeoJSON source filters support `replace` and `clear`.

`setStyleRootProperties` applies RFC 7396 merge-patch semantics to the allowed root fields: object keys merge, `null` deletes, arrays and scalars replace. It cannot modify `version`, `sources`, or `layers`.

## Inline GeoJSON

`validateInlineGeoJson` checks an inline GeoJSON value before it enters a style. It accepts all RFC 7946 geometries, features, and collections, with defaults of 5 MiB serialized, 100,000 features, 1,000,000 coordinate positions, and depth caps of 16 for geometry and 32 for properties. `analyzeGeoJson` adds counts, bounds, and property statistics; given a URL, it reports `available: false` and never fetches.

For source-layer discovery without a network, `listSourceLayers` reads usage from style metadata and layer references. `duplicateLayer` and `addLayerFromSource` cover common layer surgery, and `addGeoJsonLayer` validates and adds its inline source and layer in one atomic step: both commit, or neither does.

## Next

Have a live map? The [MapLibre adapter](../maplibre/) applies prepared transactions to it.
