---
title: Limits and Safety
description: The exact byte, count, depth, transport, and resource-policy boundaries.
weight: 50
---

Every boundary in this package is explicit and enforced — nothing oversized crosses it silently. The table below is the complete set of published values.

"Overrideable default" means a direct API option or a configured authority can replace the value with a positive safe integer. It never bypasses a stricter interface schema, a negotiated ceiling, or a fixed admission maximum. Byte limits measure UTF-8 data or UTF-8 JSON serialization at the named boundary.

## Default limits

| Boundary | Published value | Classification | Configuration and scope |
| --- | ---: | --- | --- |
| Style JSON | 5 MiB | Overrideable default; fixed CLI input cap | Direct core/MapLibre and MCP session options accept positive-safe `maxStyleBytes`; bridge peers negotiate against the server ceiling. CLI Style input remains capped at 5 MiB, and an interface may impose a lower effective limit. |
| Semantic diff | 1 MiB | Overrideable default; fixed CLI cap | Direct core/MapLibre and MCP session options accept positive-safe `maxDiffBytes`; bridge peers negotiate against the server ceiling. CLI and other unconfigured paths retain 1 MiB. |
| Operations per transaction | 100 | Overrideable core/Authority default; interface schema cap | Direct core/MapLibre, MCP session, and bridge effective limits may replace `maxOperations`. The default capability model schema and CLI admit at most 100 unless a configured Authority applies a lower limit. |
| Inline GeoJSON | 5 MiB | Overrideable standalone default; transaction interface cap | `validateInlineGeoJson` and `analyzeGeoJson` accept a positive-safe `maxBytes` override. Embedded transaction validation uses the published cap; runtime GeoJSON diffs instead use the separate 1 MiB diff-byte cap. |
| GeoJSON features | 100,000 | Overrideable standalone default; transaction/runtime interface cap | Standalone validation/analysis may replace positive-safe `maxFeatures`; embedded transaction and runtime-diff validation use 100,000. |
| Coordinate positions | 1,000,000 | Overrideable standalone default; transaction/runtime interface cap | Standalone validation/analysis may replace positive-safe `maxCoordinatePositions`; embedded transaction and runtime-diff validation use 1,000,000. |
| Geometry depth | 16 | Overrideable standalone default; transaction/runtime interface cap | Standalone validation/analysis may replace positive-safe `maxGeometryDepth`; embedded transaction and runtime-diff validation use 16. |
| Property depth | 32 | Overrideable standalone default; transaction/runtime interface cap | Standalone validation/analysis may replace positive-safe `maxPropertyDepth`; embedded transaction and runtime-diff validation use 32. |
| Feature query | 100 features and 1 MiB serialized | Direct-adapter default; capability/bridge maximum | A direct adapter may supply different positive-safe `FeatureQueryLimits`. Public capability input and bridge runtime cap requests at 100 and 1 MiB; `limit` and `maxSerializedBytes` may only lower them, and output truncates. |
| Runtime list | Direct adapter: 300 default, 500 maximum; shared `runMapCommand`: 100 default and maximum | Boundary-specific defaults and fixed request maxima | Direct MapLibre adapter `listImages`/`listSprites` use 300 when `limit` is omitted and accept 1–500. The shared capability used by AI SDK, MCP, and WebMCP supplies 100 when omitted and rejects requests above 100. |
| Bridge message | 5 MiB | Configurable negotiated default ceiling | The server publishes a positive-safe ceiling; the client may explicitly select a value at or below it, otherwise it uses the lower of 5 MiB and the server ceiling. Individual frame fields retain smaller fixed maxima where declared. |
| MCP message | 5 MiB default; 128 KiB–64 MiB configurable range | Configurable default with fixed range | `maxMessageBytes` may be configured from 128 KiB through the hard 64 MiB maximum; an envelope reserve reduces application-result bytes. |
| MCP request ID | 256 bytes | Fixed admission maximum | Measured as UTF-8 JSON bytes; not configurable. |
| MCP method | 128 bytes | Fixed admission maximum | Measured as UTF-8 bytes; not configurable. |
| MCP resource URI | 8 KiB | Fixed admission maximum | Measured as UTF-8 bytes before canonical-namespace admission; not configurable. |
| Style session ID | 512 bytes | Fixed admission maximum | The non-empty ID must contain no lone surrogate and remain within 512 UTF-8 bytes; its enclosing resource URI separately remains subject to the 8 KiB URI maximum. Not configurable. |
| HTTP bearer token | 4 KiB | Fixed admission maximum | A token must be non-empty, contain no ASCII whitespace/control characters, and remain at or below 4 KiB UTF-8; not configurable. |

The effective limit is always the strictest one that applies: the configured default, the interface cap, the negotiated ceiling, or the fixed maximum. Canonical sources: [core transaction limits](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/core/transaction.ts), [GeoJSON limits](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/core/geojson.ts), [feature-query schemas](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/adapters/maplibre/schemas.ts), [bridge negotiation](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/client.ts).

## Schema and projection safety

Public capability schemas use strict objects and native JSON values: unknown properties, non-finite numbers, malformed discriminators, and out-of-limit values are rejected before any authority runs.

Bounded outputs tell you when they trim. Inspection and feature-query projections report `returned` and `truncated`; mutation receipts and acknowledgement-form runtime receipts report `truncated`. Feature-query serialization stays within the value you allowed and the public maximum.

## Transaction and revision safety

Core transactions are atomic: a failed operation or a failed final validation returns the original style with no partial lists and no diff.

On live maps, application compares the prepared baseline with the map before committing; MCP sessions compare `expectedRevision` with the session revision. Either mismatch returns `REVISION_CONFLICT` instead of overwriting newer state.

## Transport admission

The bridge server and the Streamable HTTP MCP listener bind to loopback by default; leaving loopback requires explicit opt-in. HTTP MCP requires a bearer token, validates the request authority, and rejects a browser `Origin` unless it matches the bound origin or an explicit allowlist entry. Bridge connections authenticate the WebSocket endpoint and validate allowed origins the same way.

MCP additionally bounds request IDs, methods, resource URIs, session IDs, message counts, and response envelopes. Resource URI namespaces must be registered before the admission registry freezes, and every inbound URI must be canonical for its namespace.

## Resource policy

A bridge connection may load new network references only with the `network.load` permission, and the resolved URL must match your configured origin, prefix, data-URL, or registered custom-protocol policy. See the [permission mapping](../../guides/bridge/#capabilities) for what `network.load` does and does not admit. Relative style resource URLs and forbidden protocols are rejected, and resources inherited from the baseline gain no new network authority.

`analyzeGeoJson` never fetches. Given a URL, it returns `available: false` with reason `remote-url` and lets you decide whether — and through which boundary — fetching should happen.
