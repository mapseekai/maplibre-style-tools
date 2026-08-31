---
title: Limits and Safety
description: Look up byte, count, depth, transport, and resource-policy boundaries.
weight: 50
---

The defaults and maxima below are public compatibility boundaries. Byte limits measure UTF-8 data or UTF-8 JSON serialization at the named boundary.

## Default limits {#default-limits}

| Boundary | Default or maximum |
| --- | ---: |
| Style JSON | 5 MiB |
| Semantic diff | 1 MiB |
| Operations per transaction | 100 |
| Inline GeoJSON | 5 MiB |
| GeoJSON features | 100,000 |
| Coordinate positions | 1,000,000 |
| Geometry depth | 16 |
| Property depth | 32 |
| Feature query | 100 features and 1 MiB serialized |
| Runtime list | 300 default, 500 maximum |
| Bridge message | 5 MiB |
| MCP message | 5 MiB default, 64 MiB configurable maximum |
| MCP request ID | 256 bytes |
| MCP method | 128 bytes |
| MCP resource URI | 8 KiB |
| Style session ID | 512 bytes |
| HTTP bearer token | 4 KiB |

Style, diff, transaction, GeoJSON, feature-query, and transport limits are enforced before an oversized value crosses its boundary. Some core and transport defaults can be lowered or configured through their documented options; named maxima cannot be exceeded.

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
