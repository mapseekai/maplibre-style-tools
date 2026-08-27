# WebMCP Support Design

Date: 2026-08-27

Status: Approved design; implementation not started

## Summary

Add a browser-only `maplibre-style-tools/webmcp` entry point that exposes the
package's five existing MapLibre capabilities through the proposed WebMCP API.
The new facade registers tools on `document.modelContext`, reuses the existing
capability registry and bounded result contracts, and executes against the live
MapLibre map through the existing browser runtime so resource admission,
revision checks, limits, cancellation, and rollback behavior stay consistent
with bridge v2.

Add a standalone `examples/webmcp` Vite application for testing with Site tools
in the ChatGPT desktop app's built-in browser. The example also supports native
ChatGPT Browser comments over map features. A user can pick a feature, create an
immutable comment target for one feature, one property-defined class, or the
whole layer, annotate the resulting DOM target with ChatGPT's Annotation mode,
and submit the native comment in the ChatGPT composer. ChatGPT consumes the
referenced selection contexts through one example-only WebMCP tool and then
uses the five core tools to inspect or update the map.

## Research baseline

This design is based on the following current upstream state:

- WebMCP repository commit `41d12f057167ccf5954dbcf49d99502cb6c84491`.
- `webmcp-types` npm version `0.1.5` and repository commit
  `d54df903bddb0453e2e6940dd41984ef72a44f85`.
- [WebMCP explainer and specification](https://github.com/webmachinelearning/webmcp).
- [WebMCP implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md).
- [OpenAI Site tools documentation](https://developers.openai.com/codex/webmcp).
- [OpenAI Browser comments documentation](https://learn.chatgpt.com/docs/browser#comment-on-the-page).

The current normative page API is a secure-context `ModelContext` exposed as
`document.modelContext`. It supports imperative tool registration, discovery,
in-page execution, cross-origin exposure controls, dynamic tool changes, and
AbortSignal-based registration and invocation lifetimes. A registered tool has
a constrained name, optional localized title, description, JSON Schema input,
execute callback, and `readOnlyHint` / `untrustedContentHint` annotations.

The published `webmcp-types` package augments DOM ambient types with the
page-author registration surface. It is intentionally used as development-time
conformance input only; consumers of this package must not be required to add
it to their own TypeScript `types` configuration.

OpenAI implements WebMCP as Site tools in the ChatGPT desktop app's built-in
browser. Current testing requires an up-to-date desktop app and GPT-5.6 Sol or
Terra. Luna has Site tools disabled, and Site tools are not currently available
in Enterprise or Edu workspaces. The built-in browser's Annotation mode owns
visual comments and the ChatGPT composer integration; WebMCP itself does not
provide a page-to-composer message API.

## Goals

- Expose all five existing MapLibre capabilities as conforming WebMCP tools.
- Preserve the capability registry as the single source of truth for names,
  descriptions, input schemas, validation, execution semantics, and result
  envelopes.
- Keep the new package entry browser-only and free of Node, AI SDK, MCP SDK,
  `ws`, and server transport dependencies.
- Default to a read-only Site tools surface and require an explicit opt-in for
  mutation tools.
- Reuse existing browser runtime security, URL admission, limits, revision
  checks, cancellation, and rollback behavior.
- Provide a deterministic lifecycle with atomic registration and idempotent
  unregistration.
- Provide a standalone example that can be inspected and operated from the
  ChatGPT desktop app's built-in browser without an API key or MCP server.
- Make MapLibre WebGL features precise targets for native ChatGPT Browser
  comments by projecting picked feature context into stable DOM targets.
- Treat submitted feature-comment context as ephemeral: consume it once and do
  not retain comment text or processing status.
- Verify the new entry point, package closure, example, and protocol projection
  through automated tests, with native ChatGPT comment/composer behavior covered
  by an explicit manual acceptance checklist.

## Non-goals

- Implementing the declarative HTML form flavor of WebMCP.
- Implementing the supplemental Service Worker WebMCP proposal.
- Implementing an in-page agent, `getTools()` client, or `executeTool()` client.
- Replacing the existing MCP server, AI SDK facade, CLI, or browser bridge.
- Starting a WebSocket bridge or Node process for WebMCP calls.
- Pushing messages from the page into the ChatGPT composer. Native Browser
  comments provide this integration.
- Persisting map comments, resolving/rejecting comments, or tracking whether a
  submitted comment was processed successfully.
- Splitting the five capability tools into action-specific WebMCP tools.
- Adding an output schema before WebMCP has a stable output-schema contract.

## Architectural decision

The selected architecture is a dedicated WebMCP facade over the transport-
neutral capability registry:

```text
ChatGPT Site tools
        |
        v
document.modelContext
        |
        v
WebMCP registration and execution boundary
        |
        v
capabilityRegistry[name].execute(...)
        |
        v
WebMcpMapAuthority
        |
        v
BrowserMapRuntime (local, no WebSocket)
        |
        v
current MapLibre Map
```

The initial idea was to use `MapStyleAuthority` directly, matching the AI SDK
facade. Detailed security review showed that `MapStyleAuthority` does not apply
the bridge resource policy. In particular, checking only a Style entry URL is
insufficient: a remotely loaded Style can introduce disallowed glyph, sprite,
tile, or other resource URLs and must be rolled back after post-load admission.
`BrowserMapRuntime` already implements the required preflight, post-load
inspection, capability gating, and rollback. The WebMCP facade therefore uses a
new authority adapter over the local browser runtime. This does not use the
WebSocket bridge protocol as a transport and does not start a bridge server.

## Module layout

Add the following browser-only modules:

```text
src/webmcp/
├── index.ts
├── types.ts
├── tool-definitions.ts
├── runtime-authority.ts
├── execution.ts
└── register.ts
```

Responsibilities:

- `index.ts`: the only public WebMCP package surface.
- `types.ts`: package-owned public DTOs and structural browser interfaces that
  do not leak the global `WebMCP` namespace into emitted declarations.
- `tool-definitions.ts`: projection from the capability registry to WebMCP
  names, titles, descriptions, JSON schemas, and annotations.
- `runtime-authority.ts`: `StyleAuthority & RuntimeAuthority` implementation
  that translates capability operations into local `BrowserMapRuntime`
  commands and maps runtime results back to the established authority result
  contracts.
- `execution.ts`: lazy map/runtime resolution, application authorization,
  invocation events, normal failure envelopes, cancellation, and unexpected
  error handling.
- `register.ts`: feature detection, option normalization, atomic registration,
  external/internal AbortSignal linking, and idempotent close.

The entry may import browser-safe internal modules from `capabilities`,
`adapters/maplibre`, `core`, and `bridge/browser-runtime`. It must not import
from `ai`, `mcp`, `bridge/server`, `bridge/registry`, `ws`, or Node built-ins.

## Public package entry

Add this export:

```json
{
  "./webmcp": {
    "types": "./dist/webmcp/index.d.ts",
    "import": "./dist/webmcp/index.js",
    "default": "./dist/webmcp/index.js"
  }
}
```

The principal public API is:

```ts
export function isWebMcpSupported(document?: Document): boolean;

export function registerMapLibreWebMcpTools(
  options: RegisterMapLibreWebMcpToolsOptions,
): Promise<MapLibreWebMcpRegistration>;
```

Proposed option contract:

```ts
export interface RegisterMapLibreWebMcpToolsOptions {
  getMap(): MapLibreMap | null;
  document?: Document;
  getContext?(): MapToolContext;
  imageLoader?: RuntimeImageLoader;
  allowMutations?: boolean;
  resourcePolicy?: Partial<ResourcePolicy>;
  exposedTo?: readonly string[];
  signal?: AbortSignal;
  authorizeInvocation?(request: WebMcpAuthorizationRequest):
    boolean | Promise<boolean>;
  onInvocation?(event: WebMcpInvocationEvent): void;
}
```

The registration result is a discriminated union:

```ts
export type MapLibreWebMcpRegistration =
  | {
      readonly supported: false;
      readonly toolNames: readonly [];
      close(): void;
    }
  | {
      readonly supported: true;
      readonly toolNames: readonly MapLibreWebMcpToolName[];
      close(): void;
    };
```

`isWebMcpSupported()` checks for a callable
`document.modelContext.registerTool` and never reads `document` during module
evaluation. `registerMapLibreWebMcpTools()` returns `supported: false` without
throwing when the API is unavailable. A present but unusable implementation
(for example, disabled Permissions Policy, insecure context, duplicate names,
or invalid `exposedTo`) is a configuration/registration failure and rejects
with the original useful error.

## Tool surface

The core WebMCP facade preserves the existing five names and capability input
contracts:

| Tool | Default | `readOnlyHint` | `untrustedContentHint` |
| --- | --- | ---: | ---: |
| `inspectStyle` | Registered | `true` | `true` |
| `queryMapFeatures` | Registered | `true` | `true` |
| `applyStyleTransaction` | Opt-in | `false` | `true` |
| `applyStyleDocument` | Opt-in | `false` | `true` |
| `runMapCommand` | Opt-in | `false` | `true` |

The default registers only the two read-only tools. Setting
`allowMutations: true` also registers the three mutation-capable tools.
`runMapCommand` is not marked read-only because some of its actions mutate map
state or assets.

Every tool is projected from the registry:

```ts
{
  name,
  title,
  description: capabilityRegistry[name].description,
  inputSchema: capabilityModelJsonSchema(name),
  annotations,
  execute(input, { signal }) { /* shared execution boundary */ },
}
```

Tool names satisfy WebMCP's 1–128-character character constraints. Titles are
static display labels. Descriptions and schemas never include map data or user
content. Every result is marked as potentially untrusted because Style
metadata, GeoJSON properties, source data, and diffs can contain content not
trusted by the package author.

The existing model-facing JSON Schema projection is reused. The strict
capability Zod schema remains the actual input trust boundary even if the user
agent also validates the advertised JSON Schema.

## Execution and result semantics

For every invocation:

1. Emit a `started` invocation event.
2. Run `authorizeInvocation`, when provided.
3. Lazily resolve the current Map using `getMap()`.
4. Lazily construct the local browser runtime for that Map and current
   normalized policy, or reuse the runtime already associated with the same
   Map instance.
5. Reconcile external map changes through `noteExternalStyle()` before exposing
   the runtime-backed authority to the capability.
6. Execute the named registry capability with the runtime-backed authority and
   pass the WebMCP execution signal as the existing `abortSignal`.
7. Resolve with the existing `CapabilityResult<T>` JSON envelope.
8. Emit `succeeded`, `failed`, or `aborted` with bounded safe data and duration.

`getMap()` is called for each invocation so a host can change its active map.
A null return or thrown accessor is projected as the existing `MAP_NOT_READY`
capability failure.

Invocations are serialized per registration. This matches the deterministic
ordering of the live browser bridge, prevents a read from observing a partially
completed mutation, and gives concurrent mutation requests the existing
revision-conflict semantics. A signal aborted while its invocation is queued
rejects without starting map work.

Normal validation, authority, policy, conflict, not-found, and operation errors
resolve as:

```ts
{ success: false, message, error: StyleToolError }
```

This allows the agent to inspect an authentic error and correct its next call.
Registration failures, AbortSignal cancellation, and unexpected internal
exceptions reject. WebMCP results are direct JSON-serializable values and are
not wrapped in the MCP `content` result envelope.

If `authorizeInvocation` returns false or throws, the invocation resolves with
a safe `CAPABILITY_DENIED` envelope. `allowMutations` controls registration;
the authorization hook remains an optional per-call application permission
check and can deny any registered tool.

## Runtime capability mapping

The local browser runtime receives these fine-grained capabilities:

```text
Default:
  style.read
  features.query

allowMutations: true:
  style.write
  runtime.state
  assets.write
  network.load
```

The new `WebMcpMapAuthority` maps all style and runtime authority methods to the
same command/result semantics used by bridge v2. No mutation is retried.
Existing revision/style-hash conflict behavior is preserved.

## Registration lifecycle

Registration is all-or-nothing:

1. Normalize and validate all options before the first `registerTool()` call.
2. Create one internal AbortController for the registration set.
3. Link an optional external signal to the internal controller.
4. Register each selected tool with the same internal signal and optional
   `exposedTo` list.
5. If a registration fails, abort the internal controller, remove every tool
   registered by this attempt, and reject with the original error.

`close()` is idempotent and aborts the internal controller. To change the tool
set, callers close the registration and register a new set. Map style changes
do not change the tool set and do not require re-registration.

## Resource and origin security

Defaults:

- `baseUrl` is `document.baseURI`.
- `allowedResourceOrigins` contains only the current page origin.
- `allowedUrlPrefixes` is empty.
- data URLs are denied.
- `blob:`, `file:`, and `javascript:` URLs are denied.
- custom protocols are denied unless explicitly allowed and confirmed as
  registered.
- URL credentials are denied.

Explicit `exposedTo` values must be trustworthy origins. Omitting `exposedTo`
preserves the browser's built-in-agent and same-origin default behavior.

The runtime applies the existing policy to:

- new resources introduced by inline Style documents and transactions;
- the entry URL for remote Style documents;
- resources discovered in a remotely loaded Style;
- images loaded by URL;
- sprites loaded by URL.

If a remote Style passes entry admission but introduces a denied resource, the
runtime rolls the map back to its pre-operation Style. Resource limits,
message/result limits, operation counts, query bounds, and timeouts remain the
existing browser-runtime limits.

ChatGPT's Site tools safety review is defense in depth. Package correctness
must not rely on it.

## Development-time WebMCP types

Add exact dev dependency `webmcp-types@0.1.5`. Use it only to compile-check the
implementation against the current page-author API. The emitted public
declarations expose package-owned DTOs and ordinary DOM types, not the ambient
`WebMCP` namespace, so consumers do not need to configure
`types: ["webmcp-types"]`.

The version is exact because the proposal is evolving; upgrades should be
reviewed as explicit protocol changes rather than arriving through an ambient
semver range.

## Standalone example

Add:

```text
examples/webmcp/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tsconfig.test.json
├── playwright.config.ts
├── src/
│   ├── main.ts
│   ├── style.css
│   ├── activity-log.ts
│   ├── demo-style.ts
│   ├── feature-picker.ts
│   └── comment-targets.ts
└── e2e/
    └── webmcp.spec.ts
```

Run the example at `http://127.0.0.1:5175`. A loopback HTTP origin is a
potentially trustworthy secure context. The example requires no model API key,
MCP server, or WebSocket bridge.

Page layout:

- live MapLibre map;
- WebMCP support and registration status;
- secure-context status;
- registered Site tools grouped by read/write classification;
- recent invocation name, action, outcome, message, and duration;
- current layer count, revision, and Style hash;
- reset-map control;
- feature-picking and comment-target controls;
- concise instructions and suggested ChatGPT test prompts.

The example registers all five core tools with `allowMutations: true`, allows
the page origin and the exact demotiles origin needed by the demo, permits each
invocation, and logs bounded summaries instead of rendering complete GeoJSON
or arbitrary input values.

If WebMCP is unavailable, the map, picker, and reset control continue to work
and the status panel reports that Site tools are unavailable.

## Native Browser comments over map features

MapLibre renders features into a WebGL canvas, so ChatGPT Browser Annotation
mode cannot identify a feature as a distinct DOM element. The example projects
the picked feature into a stable, visible, accessible DOM target:

1. The user clicks the map.
2. The example calls `queryRenderedFeatures` and lets the user select the
   intended feature when several overlap.
3. The example shows a DOM marker at the picked location and a side-panel
   feature card.
4. The user selects a scope.
5. The user creates an immutable comment target with a new `selectionId`.
6. The user turns on ChatGPT Browser Annotation mode, comments on the marker or
   card, saves the comment, and submits the native comment from the ChatGPT
   composer.

The target card visibly and accessibly exposes only the bounded context needed
by the model:

- selection ID;
- layer ID;
- source ID;
- optional source layer;
- optional stable feature ID;
- picked longitude/latitude;
- bounded scalar properties;
- selected scope and selector.

The three scopes are:

```ts
export type MapCommentTarget =
  | {
      selectionId: string;
      scope: 'feature';
      feature: FeatureReference & { featureId: string | number };
    }
  | {
      selectionId: string;
      scope: 'property-class';
      feature: FeatureReference;
      selector: { property: string; value: JsonValue };
    }
  | {
      selectionId: string;
      scope: 'layer';
      feature: FeatureReference;
    };
```

`feature` requires a stable feature ID and is disabled otherwise.
`property-class` means all features in the same MapLibre layer whose selected
scalar property equals the picked value. Object and array properties are not
available as class selectors. `layer` means all features rendered by the
current layer.

Creating a comment target freezes its context. Later picks or scope changes do
not mutate existing targets. Several targets may be created and submitted in
one native ChatGPT message.

## Ephemeral selection consumption

The ChatGPT composer does not expose a public page event when a native browser
comment is submitted. The example therefore registers one additional
example-owned WebMCP tool:

```text
consumeMapSelectionContexts
```

This tool is not part of the package capability registry. It accepts a bounded
list of selection IDs, atomically returns the immutable contexts, and removes
the corresponding map markers, DOM cards, and in-memory snapshots. Its
`readOnlyHint` is false because it mutates transient page state, and its output
is marked untrusted.

The tool description instructs the agent to consume referenced selection
contexts before applying map changes. The native Browser comments contain the
visible selection IDs, allowing ChatGPT to identify the snapshots to consume.

There is no comment text store and no pending/resolved/rejected status. Once
consumed, a target is gone even if a later map mutation fails. Resetting the
map, closing the WebMCP registration, navigating away, or reloading the page
clears all unconsumed targets. The store has a fixed small capacity and evicts
the oldest unconsumed target when full.

With mutations enabled, the example exposes six Site tools: two read-only core
tools and four write tools (three core mutation tools plus selection
consumption).

## Invocation observability

`onInvocation` is a synchronous observer and cannot change an invocation
result. Events cover:

- `started`;
- `succeeded`;
- normal capability `failed`;
- `aborted`;
- unexpected `errored`.

Subscriber errors are isolated. Events include tool name, optional recognized
action discriminator, timestamps/duration, and bounded result/error summaries.
The example does not display raw complete inputs, feature properties, Style
documents, or GeoJSON payloads.

## Automated testing

### Registration tests

Use a fake structural ModelContext to test:

- unsupported feature detection;
- default two-tool registration;
- full five-tool registration;
- exact names, titles, descriptions, schemas, and annotations;
- option validation before registration;
- atomic rollback on partial failure;
- duplicate-name and native DOMException preservation;
- external signal linking and idempotent close;
- authorization allow, deny, and thrown-hook behavior;
- invocation event order and subscriber isolation;
- no global `document` read at module evaluation.

### Runtime authority tests

Test the complete authority/command translation for:

- style inspection reads;
- transactions;
- inline and URL document replacement;
- runtime commands;
- source and rendered feature queries;
- revision/style-hash conflicts;
- map switching and map-not-ready behavior;
- operation cancellation and timeout;
- resource admission and remote Style rollback;
- authentic capability failures and unexpected errors.

### Example tests

Inject a fake `document.modelContext` before the Vite page loads and verify:

- six tools are registered;
- support/secure-context/registration status;
- feature picking and overlap selection;
- all three comment-target scopes;
- feature scope disabled without a stable ID;
- property-class scalar-property restrictions;
- immutable snapshots and bounded retention;
- multiple simultaneous targets;
- batch consumption returns the correct contexts and removes page state;
- reset and teardown clear unconsumed targets;
- unsupported WebMCP fallback keeps map controls usable.

### Package contract tests

Extend package checks to verify:

- `maplibre-style-tools/webmcp` is exported and importable;
- the browser closure contains only expected browser-safe modules;
- Node built-ins, `ws`, AI SDK, and MCP SDK are absent;
- emitted declarations do not reference Node or require the WebMCP ambient
  package;
- installed-package smoke tests can import and feature-detect in a non-browser
  process without a module-evaluation crash;
- the manifest export map and packed file list are exact.

## Native ChatGPT manual acceptance

Prerequisites:

- latest ChatGPT desktop app;
- Site tools enabled;
- GPT-5.6 Sol or Terra;
- supported non-Enterprise/non-Edu workspace and rollout;
- local example running at `http://127.0.0.1:5175`;
- site access approved in the built-in browser.

Checklist:

1. Confirm the Site tools panel shows two read and four write tools.
2. Ask ChatGPT to inspect layers and query visible features.
3. Ask ChatGPT to modify the map with a transaction.
4. Exercise a runtime command and allowed Style URL replacement.
5. Create and submit a single-feature browser comment; confirm ChatGPT consumes
   the selection and the marker/card disappears before map processing.
6. Repeat with a property-class comment.
7. Repeat with a whole-layer comment.
8. Submit multiple comment targets in one message and confirm batch consumption.
9. Reset the map and verify ChatGPT can re-read the initial state.
10. Disable Site tools or use an unsupported environment and verify the normal
    map UI still works.

## Repository integration

Implementation will update:

- `package.json` exports, scripts, and dev dependency;
- `tsconfig.browser.json` and build/test configs;
- package closure and installed-package contract checks;
- English and Chinese README entry-point and example documentation;
- the new `src/webmcp` entry and tests;
- the new `examples/webmcp` application and tests.

The existing ESM-only `tsc -b` build, Node `node:test` infrastructure, peer
MapLibre version, public capability DTOs, five-tool semantics, MCP transport,
AI SDK facade, and bridge protocol remain unchanged.

## Verification commands

The implementation plan must identify the exact added example scripts and then
run the repository's existing verification surface, including:

```text
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run check:package
pnpm run test:example:webmcp
pnpm run build:example:webmcp
pnpm run test:e2e:webmcp
pnpm run verify
pnpm run verify:e2e
```

Native ChatGPT Annotation/composer behavior remains a manual acceptance step;
automated tests cover the page-visible targets, fake WebMCP contract, and
selection consumption behavior.

## Compatibility and evolution

The WebMCP proposal and ambient types are pre-stable. The implementation pins
the type version, structurally isolates the browser API, and keeps all protocol
touchpoints in `src/webmcp`. Future changes to annotations, output schemas,
native confirmation, streaming, declarative forms, or Service Workers can be
evaluated without changing the five capability semantics.

If WebMCP later standardizes output schemas, the capability result schemas may
be projected in a separate reviewed change. If declarative forms or Service
Workers become relevant and interoperable, they require separate designs and
must not be added implicitly to this entry point.
