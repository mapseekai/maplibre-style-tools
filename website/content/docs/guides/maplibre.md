---
title: MapLibre Adapter
description: Apply validated changes to a live map and query it safely.
weight: 20
---

`/maplibre` connects the document semantics of `/core` to a running MapLibre `Map`. Your application owns the map; the adapter makes sure each change is validated, applied against the revision it was prepared from, and confirmed before it reports success.

## Prepare, then apply

`prepareTransactionForMap` validates the map's current style and computes an immutable prepared transaction, without calling `map.setStyle`. If you want to show a preview before committing, inspect `prepared.view.transactionResult` first.

`applyTransactionToMap` does the same preparation and applies in one call. Its `diff` option passes through to MapLibre and defaults to `true`; `timeoutMs` defaults to 10,000 ms.

## Reading the result

A completed apply reports which style authority it can vouch for:

- `current` — the live map's style, read after load and hash confirmation
- `pre-operation` — only the baseline you prepared from is reliable
- `unavailable` — no validated style can be supplied

Check this field before treating a mutation as confirmed.

## Revision conflicts

Preparation records a canonical baseline. If the live style changes between preparation and commit, because of another tab, another tool, or the user, you get `REVISION_CONFLICT` instead of silently overwriting the newer state. A failed apply also attempts to restore the baseline, and the result authority tells you which state is actually reportable.

## Feature queries

`querySourceFeaturesBounded` and `queryRenderedFeaturesBounded` project features into plain JSON snapshots and truncate at configured limits, reporting `FEATURE_QUERY_TRUNCATED` when they do. Use these instead of MapLibre's raw queries whenever the results feed application logic or a model context; a raw query can return an unbounded object graph.

## Incremental GeoJSON updates

Before calling `GeoJSONSource.updateData`, validate the diff with the runtime schema. It accepts `removeAll`, `remove`, `add`, and `update` actions. IDs must be unique within `remove` and within `update`, and property keys must be unique per update; IDs may be reused across actions.

```ts
import { runtimeGeoJsonSourceDiffSchema } from 'maplibre-style-tools/maplibre';

const parsed = runtimeGeoJsonSourceDiffSchema.safeParse({
  update: [{
    id: 'station-1',
    addOrUpdateProperties: [{ key: 'status', value: 'open' }],
  }],
});

if (parsed.success) {
  await source.updateData(parsed.data);
}
```

The schema validates shape only; `updateData` remains your call against a compatible source. If the change is not an incremental source diff, apply a full [transaction](../core/) instead.

## Next

To expose these operations to a model, the [AI SDK guide](../ai-sdk/) wraps them as five tools.
