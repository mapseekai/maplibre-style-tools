---
title: Results and Errors
description: Read the result envelope, branch on codes, and interpret failures.
weight: 40
---

Capabilities do not throw for expected problems. Validation failures, missing layers, revision conflicts, and policy denials all return as normal results that you handle by branching on `success`.

## The envelope

```ts
type CapabilityResult<TData> =
  | { success: true; message: string; data: TData }
  | { success: false; message: string; error: StyleToolError };
```

Check `result.success` first. On success, `data` holds the capability's projection or receipt. On failure, `error` holds a package-created `StyleToolError`, and the top-level `message` is its human-readable summary.

## Two failure layers, two discriminators {#core-capability-failures}

| Layer | Failure looks like | What you get back |
| --- | --- | --- |
| Direct `/core` transaction | `ok: false` | The original style, empty changed-object lists, an empty diff, warnings, and an `error` |
| Capability (AI SDK, MCP, WebMCP, CLI) | `success: false` | The shared envelope with a public `message` and `error`; no `data` |

Branch on whichever the API you called uses. Adapters never turn a failed core result into successful capability data.

## Error fields

| Field | Type | Use it for |
| --- | --- | --- |
| `code` | `StyleToolErrorCode` | Branching — the stable, machine-readable category |
| `message` | `string` | Showing to humans; not a programmatic discriminator |
| `path` | `string` (optional) | Locating the rejected value via an RFC 6901 JSON Pointer |
| `details` | `JsonObject` (optional) | Supplementary JSON diagnostics |

## Error codes

| Code | Means |
| --- | --- |
| `INVALID_INPUT` | Input shape, value, or a configured boundary was invalid |
| `STYLE_INVALID` | The style failed spec validation |
| `NOT_FOUND` | The requested layer, source, session, map, or other resource does not exist |
| `CONFLICT` | The requested change conflicts with current state |
| `DEPENDENCY_CONFLICT` | A dependent style object blocks the change |
| `UNSUPPORTED_SOURCE` | That source type cannot do the requested operation |
| `REVISION_CONFLICT` | The style or map changed after your baseline — re-read and resubmit |
| `MAP_NOT_READY` | A required live map is unavailable right now |
| `BRIDGE_DISCONNECTED` | The live bridge is not connected |
| `CAPABILITY_DENIED` | The authority or resource policy denied the operation |
| `IO_ERROR` | A filesystem or transport I/O operation failed |
| `TIMEOUT` | The bounded operation exceeded its deadline |
| `INTERNAL` | An unexpected implementation failure |

## What throws, what does not

Style and input problems never throw — they are `success: false` results, and the CLI mirrors them with exit code `1`. I/O and environment problems surface as projected `StyleToolError` failures too, with the CLI using exit `2` for argument/input errors and `3` for output or internal failures. Only unexpected programmer or host failures may still throw outside an envelope.
