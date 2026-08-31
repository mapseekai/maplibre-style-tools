---
title: Contributing
description: Make focused changes without breaking public contracts.
weight: 40
---

Contributions should be surgical: every changed line should support the requested behavior, without unrelated cleanup or speculative abstractions.

## Focused changes {#focused-changes}

Preserve the existing architecture and terminology. Keep shared capability semantics in their contracts, and avoid reimplementing them in an interface. Add or update focused tests with a behavior change; the repository uses the existing Node.js `node:test` infrastructure.

## Compatibility commitments {#compatibility-commitments}

Public exports, capability schemas, result envelopes, bridge protocol messages, and public DTOs are compatibility-sensitive. Treat changes to them cautiously. This site summarizes supported contracts; review the canonical [capability declarations and DTOs](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/contracts.ts), [capability schema tests](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/capabilities/schemas.test.ts), [bridge protocol declarations](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.ts), [bridge protocol tests](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/bridge/protocol.test.ts), [MCP/session DTOs](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/types.ts), and [MCP contract tests](https://github.com/mapseekai/maplibre-style-tools/blob/main/src/mcp/contract.test.ts) before changing a field-level shape. Preserve the ESM-only `tsc -b` build, package formats, runtime requirements, and testing frameworks unless the change explicitly requires a migration.

Before opening or selecting work, review the [issue tracker](https://github.com/mapseekai/maplibre-style-tools/issues). Record user-visible changes in the [CHANGELOG](https://github.com/mapseekai/maplibre-style-tools/blob/main/CHANGELOG.md) when the repository's release process calls for it.
