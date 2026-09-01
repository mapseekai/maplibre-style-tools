---
title: Capabilities
description: The five operations, what they need, and what they return.
weight: 30
---

Every interface exposes the same five capabilities. Three work on style documents; two need a live map.

| Capability | What it does | Needs a live map |
| --- | --- | --- |
| `inspectStyle` | Read or validate a style and get a compact projection back | No |
| `applyStyleTransaction` | Apply an atomic list of structured edits | No |
| `applyStyleDocument` | Replace the whole style document | No |
| `runMapCommand` | Run a bounded command against a live map | Yes |
| `queryMapFeatures` | Query source or rendered features, with explicit truncation | Yes |

## One result shape everywhere

Every capability — through every interface — resolves to the same envelope:

```ts
type CapabilityResult<TData> =
  | { success: true; message: string; data: TData }
  | { success: false; message: string; error: StyleToolError };
```

Handle success and failure once, and the same code works whether the call came from the AI SDK, MCP, or the CLI. The error codes are in [Results and errors](../../reference/results-and-errors/).

## Inputs are plain JSON, checked strictly

Pass objects, arrays, numbers, and booleans as native JSON values — never stringified. Unknown fields are rejected before anything runs, so a malformed call fails fast with `INVALID_INPUT` instead of reaching your map.

"Bounded" is a promise, too: inputs and outputs are capped by explicit schemas and limits (bytes, counts, depths), and output that would exceed a cap is truncated and marked as such. The numbers are in [Limits and safety](../../reference/limits-and-safety/).

Next: [install the package](../../getting-started/installation/).
