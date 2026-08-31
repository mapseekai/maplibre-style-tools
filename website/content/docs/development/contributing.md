---
title: Contributing
description: Make focused changes without breaking public contracts.
weight: 40
---

Contributions should be surgical: every changed line should support the requested behavior, without unrelated cleanup or speculative abstractions.

## Focused changes {#focused-changes}

Preserve the existing architecture and terminology. Keep shared capability semantics in their contracts, and avoid reimplementing them in an interface. Add or update focused tests with a behavior change; the repository uses the existing Node.js `node:test` infrastructure.

## Compatibility commitments {#compatibility-commitments}

Public exports, capability schemas, result envelopes, bridge protocol messages, and public DTOs are compatibility contracts. Treat changes to them cautiously. Preserve the ESM-only `tsc -b` build, package formats, runtime requirements, and testing frameworks unless the change explicitly requires a migration.

Before opening or selecting work, review the [issue tracker](https://github.com/mapseekai/maplibre-style-tools/issues). Record user-visible changes in the [CHANGELOG](https://github.com/mapseekai/maplibre-style-tools/blob/main/CHANGELOG.md) when the repository's release process calls for it.
