---
title: Capabilities
description: The five operations, what they need, and what they return.
weight: 30
---

Every interface described so far exposes the same five operations. Three work on the style document, and two need a live map attached.

| Capability | What it does | Live map |
| --- | --- | --- |
| `inspectStyle` | Read or validate a style and get a compact projection back | No |
| `applyStyleTransaction` | Apply an atomic list of structured edits | No |
| `applyStyleDocument` | Replace the whole style document | No |
| `runMapCommand` | Run a bounded command against a live map | Yes |
| `queryMapFeatures` | Query source or rendered features, with explicit truncation | Yes |

## The result envelope

Instead of a different result format per interface, every capability returns the same structure:

```ts
type CapabilityResult<TData> =
  | { success: true; message: string; data: TData }
  | { success: false; message: string; error: StyleToolError };
```

Write one branch on `success` (show `data`, or report `error.code` and `error.message`) and it is correct whether the call came from the AI SDK, MCP, or the CLI. A failure carries a `StyleToolError` created by the package: a stable machine-readable `code`, an optional RFC 6901 `path` pointing at the rejected value, and optional JSON `details`. The full code list is in [Results and errors](../../reference/results-and-errors/).

## Inputs and limits

Inputs are plain JSON, with objects, arrays, and numbers passed as native values, and the schemas are strict: unknown fields are rejected, and nested values must not be encoded as strings. The validation runs before anything reaches your map, so a malformed model output produces one specific error instead of a broken style.

Outputs are bounded as well. Schemas and numeric caps (bytes, counts, depths) constrain what comes back; anything past a cap is truncated and marked as truncated rather than silently exceeding a context window. The exact numbers are in [Limits and safety](../../reference/limits-and-safety/).

Next: [install the package](../../getting-started/installation/).
