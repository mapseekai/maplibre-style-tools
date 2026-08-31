---
title: Capabilities
description: The five shared operations, result envelope, and runtime requirements.
weight: 30
---

The capability layer gives every interface one set of named operations, strict schemas, and bounded results.

## Shared registry {#shared-registry}

`capabilityRegistry` is the transport-neutral source of truth for a capability’s description, input schema, model input schema, runtime requirement, and executor. AI SDK, MCP, WebMCP, and CLI integrations project this registry into their own transport without changing its semantics.

## The five capabilities {#five-capabilities}

| Capability | `requiresRuntime` | Purpose |
| --- | ---: | --- |
| `inspectStyle` | `false` | Inspect or validate a style-oriented document and produce a bounded projection. |
| `applyStyleTransaction` | `false` | Apply a structured, atomic style transaction through a style authority. |
| `applyStyleDocument` | `false` | Replace a style document through a style authority. |
| `runMapCommand` | `true` | Run a bounded command against a live map. |
| `queryMapFeatures` | `true` | Query bounded source or rendered features from a live map. |

The first three capabilities work with a `StyleAuthority`. `runMapCommand` and `queryMapFeatures` also require a live-map `RuntimeAuthority`; when no map is ready, they cannot run.

## Result envelope {#result-envelope}

Every capability returns the same public result contract:

```ts
type CapabilityResult<TData> =
  | { success: true; message: string; data: TData }
  | { success: false; message: string; error: StyleToolError };
```

Success results contain `data`. Failure results contain a package-created `StyleToolError`, so callers can handle success and failure consistently across interfaces.

## Runtime requirements {#runtime-requirements}

Inputs are strict native JSON. Nested values must not be JSON-encoded strings: pass objects, arrays, booleans, numbers, and `null` as their native JSON values. Invalid input is rejected before a capability handler or map is invoked.

Use `inspectStyle`, `applyStyleTransaction`, and `applyStyleDocument` for document-oriented work; reserve `runMapCommand` and `queryMapFeatures` for a live MapLibre runtime.
