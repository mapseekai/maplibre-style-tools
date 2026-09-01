---
title: Capability Registry
description: Build your own transport on the five executors, schemas, and authority interfaces.
weight: 30
---

`/capabilities` is for integrations that need the five operations and their exact semantics without adopting the AI SDK, MCP, WebMCP, or CLI packaging. You supply the authorities; the registry does the rest.

## The registry is the contract

`capabilityRegistry` holds each capability's name, description, execution schema, model-facing schema, runtime requirement, and executor:

| Capability | Mutation behavior | Authority member |
| --- | --- | --- |
| `inspectStyle` | Read-only | `readStyle()` / `context()` |
| `applyStyleTransaction` | Atomic mutation | `applyTransaction()` |
| `applyStyleDocument` | Full replacement | `applyDocument()` |
| `runMapCommand` | Mixed read/write commands | `runtimeCommands()` |
| `queryMapFeatures` | Read-only bounded query | `querySourceFeatures()` / `queryRenderedFeatures()` |

Project this registry into your transport — OpenAI tools, an internal RPC layer, whatever you are building — and semantics stay identical to the first-party interfaces.

## Provide authorities, not maps

Document capabilities need a `StyleAuthority`; live-map capabilities additionally need a `RuntimeAuthority`. Your `AuthoritySource` may return `null` — execution then returns the ordinary `MAP_NOT_READY` failure rather than picking an authority on the caller's behalf.

## Two schemas per capability, on purpose

`inputSchema` is the strict boundary your executor validates against; `modelInputSchema` is the shape a model tool definition advertises. The model schema guides generation — execution always re-validates — so an imaginative model cannot bypass the boundary by inventing fields.

## Schema-only projections for OpenAI and Anthropic

`createOpenAiFunctionTools()` and `createAnthropicTools()` project the registry into OpenAI function-tool and Anthropic tool definitions for direct LLM API integrations. They define the tools; they do not attach a map or execute anything. Pair the definitions with an authority and invoke the matching registry executor in your own handler.

## Next

The [capability overview](../../introduction/capabilities/) covers the result envelope; [Results and errors](../../reference/results-and-errors/) covers failure handling.
