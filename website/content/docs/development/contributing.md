---
title: Contributing
description: Make focused changes that hold the line on public contracts.
weight: 40
---

## Keep changes surgical

Every changed line should serve the requested behavior. Preserve the existing architecture and terminology; keep shared semantics in the capability contracts rather than reimplementing them inside an interface; skip unrelated cleanup and speculative abstraction. Add or update tests with any behavior change — the suite runs on Node's built-in `node:test` runner.

## Public contracts are compatibility commitments

Public exports, capability schemas, result envelopes, bridge protocol messages, and public DTOs are compatibility-sensitive. Before changing any of them, review the canonical declarations and their tests: the [capability contracts](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts) with their [schema tests](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/schemas.test.ts), the [bridge protocol](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.ts) with its [tests](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.test.ts), and the [MCP/session types](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/types.ts).

## Before you start

Check the [issue tracker](https://github.com/mapseekai/maplibre-style-tools/issues) for existing work. Record user-visible changes in the [CHANGELOG](https://github.com/mapseekai/maplibre-style-tools/blob/main/CHANGELOG.md) when the release process calls for it.
