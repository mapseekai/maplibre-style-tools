---
title: MapLibre Adapter
description: Apply validated changes to a live map and query it safely.
weight: 20
---

`/maplibre` connects the document semantics of `/core` to a running MapLibre `Map`. Your application owns the map; the adapter makes sure every change is validated, applied against the revision it was prepared from, and confirmed before it reports success.

## Preview or one-step, your choice

`prepareTransactionForMap` validates the map's current style and computes an immutable prepared transaction — without calling `map.setStyle`. Inspect `prepared.view.transactionResult` first if you want to show a preview, then commit.

`applyTransactionToMap` does the same preparation and applies in one call. Its `diff` option passes through to MapLibre and defaults to `true`; `timeoutMs` defaults to 10,000 ms.

## The result tells you what is trustworthy

A completed apply reports which style authority it can vouch for:

- `current` — the live map's style, read after load/hash confirmation
- `pre-operation` — only the baseline you started from is reliable
- `unavailable` — no validated style can be supplied

Branch on it before treating the mutation as confirmed.

## Conflicts are detected, not overwritten

Preparation records a canonical baseline. If the live style changed between preparation and commit — another tab, another tool, the user — you get `REVISION_CONFLICT` instead of silently clobbering the newer state. A failed apply also attempts to restore the baseline; the result authority tells you which state is actually reportable.

## Feature queries that cannot run away

`querySourceFeaturesBounded` and `queryRenderedFeaturesBounded` project features into plain JSON snapshots and truncate at configured limits — telling you so with a `FEATURE_QUERY_TRUNCATED` warning. Use them, not MapLibre's raw queries, whenever results feed application logic or a model.

## Incremental GeoJSON updates, validated

For `GeoJSONSource.updateData`, validate the diff before calling MapLibre. The runtime schema accepts `removeAll`, `remove`, `add`, and `update` actions; IDs must be unique within `remove` and within `update`, property keys unique per update, and IDs may be reused across actions.

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

The schema checks shape; `updateData` stays your call against a compatible source. If the change is not an incremental source diff, apply a full [transaction](../core/) instead.

## Next

Exposing these operations to a model? The [AI SDK guide](../ai-sdk/) wraps them as five tools.
