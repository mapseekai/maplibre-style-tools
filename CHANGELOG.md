# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The project is pre-release (0.x) and not yet published to npm; breaking changes
may occur in any version.

## [Unreleased]

### Added

- MIT license (`LICENSE` file and package.json `license` field).
- npm installation instructions in both READMEs.

### Fixed

- READMEs no longer claim the package is unpublished; it has been on npm
  since 0.1.0.

## [0.2.0] - 2026-08-22

### Added

- `maplibre-style-tools/capabilities` now exports `createOpenAiFunctionTools`
  and `createAnthropicTools`, which project the capability registry into
  OpenAI function-calling and Anthropic Messages tool schemas. Root union
  schemas are normalized to a single object with an `allOf`/`anyOf` constraint
  so strict LLM providers accept them.
- `examples/ai-chat`: provider switcher with Anthropic Messages support
  alongside OpenAI-compatible endpoints, including provider-specific
  connection defaults.
- Chinese translation of the README (`README.zh-CN.md`) and this changelog.
- `AGENTS.md`: behavioral guidelines section (think before coding, simplicity
  first, surgical changes, goal-driven execution).

### Changed

- `examples/ai-chat`: tool schemas are generated from the capability registry
  instead of hand-written; the registry gained a `modelInputSchema` per
  capability so model-facing schemas can differ from executor envelopes
  (e.g. `applyStyleTransaction` requires non-empty operations).
- `README.md`: language/changelog navigation, the `/capabilities` entry-point
  description covers the new tool-schema factories, and a new Examples section
  documents both Vite examples.
- GitNexus skill files moved from `.claude/skills/gitnexus/` to
  `.agents/skills/gitnexus/`; `CLAUDE.md` was removed and its content merged
  into `AGENTS.md`.

### Fixed

- `examples/ai-chat`: send `anthropic-dangerous-direct-browser-access: true`
  on Anthropic requests so the provider works from the browser (CORS).
- `examples/ai-chat`: check `finish_reason: length` / `stop_reason: max_tokens`
  before recording the assistant message, so a truncated turn no longer
  corrupts conversation history with unanswered tool calls.
- `examples/ai-chat`: tool executor exceptions are converted into the result
  envelope (`TOOL_EXECUTION_ERROR`) instead of corrupting Anthropic history or
  being misreported as malformed tool arguments.
- `examples/ai-chat`: the malformed-arguments retry flag now resets after a
  successful call, so only genuinely consecutive failures abort the turn.

### Removed

- Six empty placeholder test files under `src/mcp/` (`http.test.ts`,
  `integration.test.ts`, `live-extension.test.ts`, `main.test.ts`,
  `schemas.test.ts`, `server-extension.test.ts`).

## [0.1.0] - 2026-08-21

Initial standalone release, extracted from the ai-style-editor project.

### Added

- Transport-neutral capability layer (`/capabilities`) defining five style
  capabilities — `inspectStyle`, `applyStyleTransaction`,
  `applyStyleDocument`, `runMapCommand`, `queryMapFeatures` — with strict
  input schemas, bounded result envelopes, and the
  `StyleAuthority`/`RuntimeAuthority` authority interfaces.
- AI SDK interface (`/ai`): `createMapLibreStyleTools` wraps the capability
  registry as five AI SDK tools over an in-process MapLibre map.
- MCP interface (`/mcp`): bounded server factory, stdio runner, protected
  Streamable HTTP runner, style session store with revision-checked commits,
  canonical session/map resource URIs, and the live-bridge extension.
- Browser live bridge (`/bridge`): WebSocket protocol v2 with per-map
  capability grants (`style.read`, `style.write`, `features.query`,
  `runtime.state`, `assets.write`, `network.load`), resource URL authorization
  policy, revision/hash conflict detection, and reconnect idempotency.
- `maplibre-style` CLI: offline validate/inspect/apply commands over the
  shared capability envelope with durable in-place writes and backups.
- Pure core (`/core`): strict style transactions with RFC 6901 diffs,
  expression filters, inline GeoJSON validation/analysis, and source-layer
  discovery.
- MapLibre adapter (`/maplibre`): transaction application with authority
  reporting and bounded live runtime commands.
- Examples: `examples/browser-bridge` (live bridge demo) and
  `examples/ai-chat` (LLM tool-calling chat against a live map).
- Read-only MCP Builder evaluation fixture under `evals/`.

[Unreleased]: https://github.com/zwishing/maplibre-style-tools/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/zwishing/maplibre-style-tools/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/zwishing/maplibre-style-tools/releases/tag/v0.1.0
