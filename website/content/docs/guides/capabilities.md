---
title: Capability Registry
description: Use the transport-neutral executors, schemas, and authority interfaces.
weight: 30
---

The `/capabilities` entry point supplies the transport-neutral layer behind the interface-specific packages. It is useful when an integration needs the same named operations and result semantics without adopting AI SDK, MCP, WebMCP, or CLI presentation details. See the [capability overview](../../introduction/capabilities/) for the shared result envelope.

## Why the registry exists {#why-the-registry-exists}

`capabilityRegistry` is the single source for capability names, descriptions, schemas, runtime requirements, and execution. Integrations project this registry into their own transport instead of redefining the five operations.

| Capability | `requiresRuntime` | Mutation behavior | Authority member |
| --- | ---: | --- | --- |
| `inspectStyle` | `false` | Read-only | `readStyle()` and `context()` |
| `applyStyleTransaction` | `false` | Mutates atomically | `applyTransaction()` |
| `applyStyleDocument` | `false` | Replaces the Style | `applyDocument()` |
| `runMapCommand` | `true` | Mixed read/write commands | `runtimeCommands()` |
| `queryMapFeatures` | `true` | Read-only bounded query | `querySourceFeatures()` or `queryRenderedFeatures()` |

## Authority interfaces {#authority-interfaces}

Provide a `StyleAuthority` for document-oriented capabilities. It reads a validated Style, supplies context, applies transactions, and applies full Style documents. Add a `RuntimeAuthority` only for live-map commands and feature queries. An `AuthoritySource` may return `null`; capability execution then returns the normal `MAP_NOT_READY` failure instead of selecting a Style authority on the caller's behalf.

## Strict model schemas {#strict-model-schemas}

Each registry item carries an execution `inputSchema` and a model-facing `modelInputSchema`. The model schema projects input shape for a model tool definition, while the execution schema remains the strict validation boundary. Treat an advertised schema as guidance for generation, not permission to skip capability validation.

## Direct OpenAI schemas {#direct-openai-schemas}

`createOpenAiFunctionTools()` projects the registry into immutable OpenAI function-tool definitions. It provides the capability name, description, and JSON Schema parameters, but does not select a Style authority for the caller. Pair the definitions with an authority and invoke the corresponding registry executor in your own transport handler.

## Direct Anthropic schemas {#direct-anthropic-schemas}

`createAnthropicTools()` projects the same definitions into Anthropic tool objects with `name`, `description`, and `input_schema`. Like the OpenAI helper, it is a definition projection only: it does not attach a map, choose an authority, or execute a capability.
