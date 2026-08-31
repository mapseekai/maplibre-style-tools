---
title: Results and Errors
description: Interpret success envelopes, failures, error codes, paths, and details.
weight: 40
---

Capabilities return a discriminated result instead of throwing for expected validation, semantic, availability, and policy failures.

## Result envelope {#result-envelope}

```ts
type CapabilityResult<TData> =
  | { success: true; message: string; data: TData }
  | { success: false; message: string; error: StyleToolError };
```

Check `success` before reading `data` or `error`. A success contains the capability-specific projection or receipt. A failure contains a package-created `StyleToolError`; the top-level `message` is the public summary of that failure.

## Error fields {#error-fields}

| Field | Type | Meaning |
| --- | --- | --- |
| `code` | `StyleToolErrorCode` | Stable machine-readable category |
| `message` | `string` | Public human-readable explanation |
| `path` | `string` (optional) | RFC 6901 JSON Pointer to the rejected value |
| `details` | `JsonObject` (optional) | JSON metadata for bounded diagnostics |

Treat `message` as explanatory text, not as a programmatic discriminator. Branch on `code`; use `path` to locate input or document data, and inspect `details` only for supplementary JSON metadata.

## Error codes {#error-codes}

```text
INVALID_INPUT
STYLE_INVALID
NOT_FOUND
CONFLICT
DEPENDENCY_CONFLICT
UNSUPPORTED_SOURCE
REVISION_CONFLICT
MAP_NOT_READY
BRIDGE_DISCONNECTED
CAPABILITY_DENIED
IO_ERROR
TIMEOUT
INTERNAL
```

| Code | Typical interpretation |
| --- | --- |
| `INVALID_INPUT` | Input shape, value, or configured boundary is invalid |
| `STYLE_INVALID` | Style specification validation failed |
| `NOT_FOUND` | Requested layer, source, session, map, or other resource is absent |
| `CONFLICT` | The requested semantic change conflicts with current state |
| `DEPENDENCY_CONFLICT` | A dependent Style object prevents the change |
| `UNSUPPORTED_SOURCE` | The source type cannot perform the requested operation |
| `REVISION_CONFLICT` | The Style or map changed after the caller's baseline |
| `MAP_NOT_READY` | A required live-map authority is unavailable |
| `BRIDGE_DISCONNECTED` | The live bridge is not connected |
| `CAPABILITY_DENIED` | Authority or resource policy denied the operation |
| `IO_ERROR` | A filesystem or transport I/O operation failed |
| `TIMEOUT` | The bounded operation exceeded its deadline |
| `INTERNAL` | An unexpected implementation failure occurred |

## Failure classes {#failure-classes}

Validation and semantic failures are normal `CapabilityResult` failures: malformed capability input, invalid Styles, missing objects, dependency conflicts, unsupported sources, revision conflicts, and denied capabilities do not require exception handling.

I/O and operational failures describe the environment rather than Style semantics. MCP and capability adapters still project expected failures through `StyleToolError`; the CLI separately uses exit code `2` for argument/input/JSON errors and exit code `3` for output or internal failures. Unexpected programmer or host failures may still throw outside a capability envelope.
