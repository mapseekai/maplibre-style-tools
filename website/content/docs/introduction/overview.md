---
title: Overview
description: What the package does, which environments it supports, and which interface to choose.
weight: 10
---

`maplibre-style-tools` helps software and AI agents inspect and edit MapLibre styles. It exposes a transport-neutral core, five shared capabilities, and thin AI SDK, MCP, WebMCP, and CLI interfaces. The package is ESM-only and requires Node.js `>=22.13.0`.

## What this package does {#what-it-does}

Use the core to validate style documents and apply structured style transactions without tying that work to a transport or a live map. The capability layer gives every interface the same five operations and strict input validation. MapLibre integration supports a live map when one is available.

Core and CLI validation perform no network fetches. A URL passed to a capability is handled by its authority; the file-based CLI authority does not accept style URLs.

## Choose an interface {#choose-an-interface}

| Interface | Runtime | Recommended use |
| --- | --- | --- |
| Core (`/core`) | ES-only | Validate documents, inspect data, and apply transactions in a transport-neutral integration. |
| MapLibre (`/maplibre`) | Browser or MapLibre host | Apply prepared work to a live MapLibre map and use bounded live-map helpers. |
| Capabilities (`/capabilities`) | Any authority-providing host | Reuse the five executors, schemas, registry, and result envelope across transports. |
| AI SDK (`/ai`) | Node-capable AI SDK 6 host | Expose the five capabilities as AI SDK 6 tools over an in-process map. |
| WebMCP (`/webmcp`) | Browser | Register page-scoped Site tools for an in-browser MapLibre map. |
| MCP (`/mcp`) | Node.js | Run the bounded MCP server, session store, and optional live bridge. |
| Bridge (`/bridge`) | Browser | Connect a browser MapLibre map to a remote MCP host with browser-safe protocol support. |
| CLI (`maplibre-style`) | Node.js | Validate, inspect, and transform local style files from scripts or a terminal. |

The MapLibre peer dependency is `maplibre-gl` `^6.3.0`. Choose the AI SDK interface when an AI SDK 6 tool consumer owns the map; choose MCP or WebMCP when a tool protocol owns the conversation; choose the CLI for local files.

## Compatibility contracts {#compatibility-contracts}

The package’s exports, capability schemas, result envelopes, bridge messages, and public DTOs are compatibility contracts. Inputs must be JSON-shaped data accepted by the public schemas; pass structured objects and arrays as native values rather than serializing them into strings.

For a common vocabulary before integrating, continue to [Architecture](../architecture/) and [Capabilities](../capabilities/).
