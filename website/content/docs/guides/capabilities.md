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

Project this registry into your transport, whether that is OpenAI tool definitions, an internal RPC layer, or something else, and the semantics stay identical to the first-party interfaces.

## Provide authorities, not maps

Document capabilities need a `StyleAuthority`; live-map capabilities additionally need a `RuntimeAuthority`. Your `AuthoritySource` may return `null`, in which case execution returns the ordinary `MAP_NOT_READY` failure rather than picking an authority on the caller's behalf.

## Two schemas per capability

`inputSchema` is the strict boundary your executor validates against; `modelInputSchema` is the shape a model tool definition advertises. The model schema guides generation, and execution always re-validates, so a model cannot bypass the boundary by inventing fields.

## Schema projections for OpenAI and Anthropic

`createOpenAiFunctionTools()` and `createAnthropicTools()` project the registry into OpenAI function-tool and Anthropic tool definitions for direct LLM API integrations. They define the tools and nothing more: no map attached, nothing executed. Pair the definitions with an authority and invoke the matching registry executor in your own handler.

## Next

The [capability overview](../../introduction/capabilities/) covers the result envelope; [Results and errors](../../reference/results-and-errors/) covers failure handling.
