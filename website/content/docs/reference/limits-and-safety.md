---
title: Limits and Safety
description: Look up byte, count, depth, transport, and resource-policy boundaries.
weight: 50
---

The values below are public compatibility boundaries. Byte limits measure UTF-8 data or UTF-8 JSON serialization at the named boundary. “Overrideable default” means a direct API or configured Authority may replace the value with a positive safe integer; it does not bypass a stricter interface schema, negotiated ceiling, or fixed admission maximum.

## Default limits {#default-limits}

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
| Runtime list | 300 default, 500 maximum | Default plus fixed per-request maximum | Omitting `limit` uses 300; a request may select 1–500 and cannot raise the maximum. |
| Bridge message | 5 MiB | Configurable negotiated default ceiling | The server publishes a positive-safe ceiling; the client may explicitly select a value at or below it, otherwise it uses the lower of 5 MiB and the server ceiling. Individual frame fields retain smaller fixed maxima where declared. |
| MCP message | 5 MiB default; 128 KiB–64 MiB configurable range | Configurable default with fixed range | `maxMessageBytes` may be configured from 128 KiB through the hard 64 MiB maximum; an envelope reserve reduces application-result bytes. |
| MCP request ID | 256 bytes | Fixed admission maximum | Measured as UTF-8 JSON bytes; not configurable. |
| MCP method | 128 bytes | Fixed admission maximum | Measured as UTF-8 bytes; not configurable. |
| MCP resource URI | 8 KiB | Fixed admission maximum | Measured as UTF-8 bytes before canonical-namespace admission; not configurable. |
| Style session ID | 512 bytes | Fixed admission maximum | The non-empty ID must contain no lone surrogate and remain within 512 UTF-8 bytes; its enclosing resource URI separately remains subject to the 8 KiB URI maximum. Not configurable. |
| HTTP bearer token | 4 KiB | Fixed admission maximum | A token must be non-empty, contain no ASCII whitespace/control characters, and remain at or below 4 KiB UTF-8; not configurable. |

Style, diff, transaction, GeoJSON, feature-query, and transport limits are enforced before an oversized value crosses its boundary. The effective limit is the strictest applicable configured default, interface cap, negotiated ceiling, or fixed maximum. The classifications above follow the canonical [core transaction limits](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/core/transaction.ts), [GeoJSON limits](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/core/geojson.ts), [feature-query schemas](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/adapters/maplibre/schemas.ts), [bridge negotiation](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/client.ts), [MCP message policy](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/message-boundary.ts), [session limits](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/session-store.ts), and [HTTP admission](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/http.ts).

## Schema and projection safety {#schema-and-projection-safety}

Public capability schemas use strict objects and native JSON values. Unknown properties, non-finite numbers, malformed discriminators, and values above declared limits are rejected before authority execution.

Inspection projections and feature-query projections report both `returned` and `truncated`. List-form runtime command results expose those fields on their nested `BoundedCollection`. Mutation receipts and `acknowledgement`-form runtime command receipts expose `truncated` but no `returned`. These bounded outputs preserve bounded warnings and keep feature-query serialization within the caller's allowed value and the public maximum.

## Transaction and revision safety {#transaction-and-revision-safety}

Core Style transactions are atomic at the document boundary. If an operation or final validation fails, the failure retains the original Style and exposes no partial changed-object lists or semantic diff.

Live-map application compares the prepared baseline with the current map, and MCP sessions compare `expectedRevision` with the current session revision. A changed baseline produces `REVISION_CONFLICT` instead of overwriting newer state.

## Transport admission {#transport-admission}

The bridge server and Streamable HTTP MCP bind to loopback by default. Non-loopback HTTP binding requires explicit opt-in. HTTP MCP requires a bearer token, compares it without leaking token contents, validates the request authority, and rejects an Origin unless it is the bound origin or an explicitly allowed exact HTTP(S) origin. Bridge connections likewise authenticate a protected WebSocket endpoint and validate allowed origins.

MCP validates bounded request IDs, methods, resource URIs, session IDs, total messages, and response envelopes. Resource URI namespaces must be registered before the admission registry freezes, and every inbound URI must be canonical for its registered namespace.

## Resource policy {#resource-policy}

Bridge resource policy admits new network references only when the connection has the additional `network.load` permission and the resolved URL matches the configured origin, prefix, data-URL, or registered custom-protocol policy. `network.load` does not authorize a callable operation by itself; see the [bridge permission-to-operation mapping](../../guides/bridge/#capabilities). Relative Style resource URLs and forbidden protocols are rejected; retained baseline references do not gain new network authority.

`analyzeGeoJson` does not fetch remote GeoJSON. For a URL input it returns a successful analysis result with `available: false` and reason `remote-url`, allowing the caller to decide whether and where fetching is authorized.
