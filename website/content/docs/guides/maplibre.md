---
title: MapLibre Adapter
description: Apply prepared changes and run bounded operations against a live map.
weight: 20
---

The `/maplibre` entry point connects the document semantics from `/core` to a live MapLibre `Map`. It is the in-process adapter: use it when your application owns the map instance and needs to apply a Style transaction, issue a bounded runtime operation, or query map features. Review [requirements](../../getting-started/requirements/) before choosing a browser-facing entry point.

## Prepare before mutation {#prepare-before-mutation}

`prepareTransactionForMap` reads and validates the current Style, computes an immutable prepared transaction, and records the baseline needed for a later apply. It does not call `map.setStyle`. This lets an application inspect `prepared.view.transactionResult` before choosing to mutate. `applyTransactionToMap` performs the same preparation for a one-step flow.

## Apply and await {#apply-and-await}

`applyTransactionToMap` validates the current Style, prepares an immutable transaction, detects revision conflicts, calls MapLibre only when the baseline is still current, and waits for Style confirmation before reporting success. Its `diff` option is passed to MapLibre style application and defaults to `true`; `timeoutMs` defaults to 10,000 ms.

The result reports what Style authority is available: `current` when it can return the current Style, `pre-operation` when only the baseline is reliable, or `unavailable` when no validated Style can be supplied. Always branch on the result before treating a mutation as confirmed.

## Revision conflicts {#revision-conflicts}

Preparation records a canonical baseline. If the live map changes between preparation and mutation, the adapter returns `REVISION_CONFLICT` instead of applying the candidate to a different revision. A failed apply also attempts to restore the baseline; the result authority communicates whether the current map Style, the pre-operation Style, or neither can be reported safely.

## Bounded feature queries {#bounded-feature-queries}

Use `querySourceFeaturesBounded` or `queryRenderedFeaturesBounded` for feature results. They project and truncate results according to configured limits, and return a `FEATURE_QUERY_TRUNCATED` warning when a limit is reached. Do not use an unbounded feature query as an application data export.

## Incremental GeoJSON {#incremental-geojson}

Validate incremental GeoJSON source changes with the runtime schema before calling MapLibre's `updateData`. The schema accepts one or more effective `removeAll`, `remove`, `add`, or `update` actions and rejects duplicate feature or property identifiers.

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

The schema validates data shape; `updateData` remains a MapLibre call against a compatible GeoJSON source. Use full Style replacement when the intended change is not an incremental source diff.
