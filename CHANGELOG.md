# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The project is pre-release (0.x) and not yet published to npm; breaking changes
may occur in any version.

## [Unreleased]

## [0.3.0] - 2026-08-22

### Added

- Single source of truth for model-facing tool schemas: new
  `/capabilities` `model-schema` module projects each capability's
  `modelInputSchema` to JSON Schema once, and the OpenAI, Anthropic, AI SDK,
  and MCP surfaces all advertise the same object-rooted shape (discriminator
  enums lifted, per-property branch merges, required intersection). Cross-
  interface parity tests pin the four surfaces together.
- MCP tools now advertise an `outputSchema` (the success/error envelope) and
  capability tools advertise the real model input schema instead of an opaque
  `{}`, so clients see action enums and parameter shapes in `tools/list`.
- Cancellation signals threaded end-to-end: AI SDK `abortSignal` and MCP
  request `signal` flow through capability execution into the authorities —
  MapLibre deadline aborts, session/bridge pre-abort checks — with tests
  proving pre-abort leaves the map and session untouched.
- `verify` and `verify:e2e` package scripts, plus a GitHub Actions workflow
  (`quality.yml`) running typecheck, lint, the full node:test suite, example
  tests, package-contract checks, and Playwright e2e with failure artifacts.
- ESM-only publishing contract: READMEs document the Node >=22.13
  `require(esm)` path, and `check-package` gains a CommonJS consumer smoke
  test against the built tarball.
- MCP contract tests now drive real client calls and assert
  `isError`/`structuredContent.success` for every session tool, plus
  `tools/list` schema advertisement.

### Changed

- `examples/ai-chat`: replaced the hand-written OpenAI/Anthropic tool-calling
  loops with AI SDK `ToolLoopAgent` (`stopWhen: stepCountIs(6)`) and
  provider factories (`@ai-sdk/openai@3`, `@ai-sdk/anthropic@3`); the
  per-step output cap is raised from 1024 to 4096 tokens.
- `MapLibreAiTool`/`MapLibreStyleTools` are now AI SDK `Tool` shapes: the
  returned object assigns directly to `ToolSet` (the example no longer needs
  an `as unknown as ToolSet` cast), while `.execute(input)` stays available.
- MCP library entry split from the CLI: `/mcp` now resolves to
  `dist/mcp/index.js` (`main.js` remains the `maplibre-style-mcp` binary);
  `parseMcpProcessOptions` moved with the library exports.
- The root entry (`maplibre-style-tools`) no longer loads Node ambient types;
  only `/ai` and `/mcp` transport declarations keep their Node reference.
- `ApplySessionTransactionResult` carries the applied `style`, so session
  mutation responses report the current style instead of the pre-mutation
  snapshot.
- Browser-bridge e2e: Playwright failure diagnostics (trace/screenshot/video)
  and CI retries, parallel workers, harness-internal tests moved to node:test,
  and the remaining specs rewritten against the unified MCP tool surface
  (`inspectStyle`/`applyStyleTransaction` with map targets). Demo transactions
  target the demotiles basemap layers and the map canvas uses `data-testid`.

### Fixed

- MCP session tools registered with an unrecognized `schema` key instead of
  `inputSchema`, silently dropping their input schemas; they now reuse the
  exported schemas and are covered by a real client contract test.
- MCP session mutations returned the stale pre-mutation style snapshot.
- `MapLibreAiTool` was not assignable to AI SDK `ToolSet`, contradicting the
  README's usage promise.
- Advertised input schemas embedded zod custom types that every JSON-Schema
  converter rejected, and OpenAI-compatible endpoints rejected the oneOf root;
  all four interfaces now advertise a valid object-rooted schema.
- Advertised-schema parsing stripped unknown object keys (zod strips by
  default), which would have dropped style data before execution; the
  advertised schemas are passthrough, with real validation still at the
  capability boundary.
- `contract.test.ts` used an invalid style fixture and never checked tool
  responses, so every session call was failing silently while the test
  passed; assertions now verify real success.

### Removed

- The separate raw (oneOf-rooted) model-schema projection; AI SDK and MCP use
  the same normalized projection as OpenAI/Anthropic.

## [0.2.1] - 2026-08-22

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

[Unreleased]: https://github.com/zwishing/maplibre-style-tools/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/zwishing/maplibre-style-tools/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/zwishing/maplibre-style-tools/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/zwishing/maplibre-style-tools/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/zwishing/maplibre-style-tools/releases/tag/v0.1.0
