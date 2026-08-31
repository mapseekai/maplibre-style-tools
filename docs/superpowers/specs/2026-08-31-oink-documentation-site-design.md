# Oink Documentation Site Design

Date: 2026-08-31

Status: Approved design; implementation not started

## Summary

Add a bilingual public documentation site under `website/` using the Oink
v1.0.0 Hugo theme. The site publishes English and Simplified Chinese versions
of the project overview, onboarding guides, integration guides, public API
reference, and maintainer documentation. It deploys from the existing
repository to GitHub Pages at
`https://mapseekai.github.io/maplibre-style-tools/`.

The documentation site is a self-contained Hugo Module. It does not replace or
relocate the root `README.md`, `README.zh-CN.md`, `CHANGELOG.md`, or the existing
`docs/` tree. In particular, internal design specifications and implementation
plans under `docs/superpowers/` are not mounted into or copied to the public
site.

OINK is the publication system, not a source-code documentation generator.
Public content is written and reviewed against the package's compatibility
contracts: `package.json` exports, public entry modules, the capability
registry, public DTOs, tested examples, CLI behavior, and package-contract
tests.

## Research baseline

This design is based on the following upstream and local state:

- [OINK](https://github.com/pgsty/oink) v1.0.0.
- [OINK Starter](https://github.com/pgsty/oink-starter), which pins OINK
  v1.0.0 and provides GitHub Pages and Cloudflare Pages workflows.
- [OINK start guide](https://oink.pgsty.com/docs/start/), which recommends Go
  1.27 or newer and Hugo Extended 0.165.0 or newer for the current Starter.
- Hugo Extended 0.165.0 and Go 1.27.0 on macOS ARM64.
- The repository's eight public package entry points, five transport-neutral
  capabilities, CLI, MCP server, WebMCP facade, and live browser bridge.

A warning-strict production build of the unmodified OINK Starter completed
successfully during design validation:

```text
Pages: 91 EN, 89 ZH, 89 FR
Static files: 22 per language
Build mode: production, minified, panic on warning
```

The proof build also generated responsive HTML, print routes, local search,
semantic Markdown outputs, and language-specific `llms.txt` files. The
production site deliberately removes the Starter's French, Blog, and Book
content.

## Goals

- Publish accurate, approachable documentation for npm users and developers
  integrating AI systems with MapLibre.
- Explain the transport-neutral capability architecture before presenting any
  individual transport or adapter.
- Cover the eight supported package entry points and five capability contracts
  without exposing internal-only symbols.
- Provide equivalent English and Simplified Chinese navigation and pages.
- Keep documentation versioned with the package source and release history.
- Produce local-search, print, semantic Markdown, and `llms.txt` outputs using
  one deterministic Hugo build.
- Deploy automatically to the repository's GitHub Pages site after a successful
  warning-strict build on `main`.
- Validate documentation with repository evidence and fresh-reader testing.

## Non-goals

- Generating content automatically from the source tree or TypeScript AST.
- Introducing TypeDoc, MDX, Node-based static-site tooling, or another package
  manager inside `website/`.
- Publishing internal plans, design drafts, security notes, or temporary
  artifacts from `docs/superpowers/`.
- Replacing the root README files or changelog.
- Publishing every exported TypeScript symbol as an exhaustive API catalogue.
- Adding a Blog, Book, French localization, comments, analytics, or a custom
  domain in the initial site.
- Changing package exports, runtime behavior, TypeScript ambient-type
  boundaries, examples, tests, or npm release workflows.

## Audience and documentation principles

The primary audience is npm users and developers integrating the library with
MapLibre, the AI SDK, direct model APIs, MCP clients, WebMCP Site tools, or the
browser bridge. Maintainer material lives in a separate Development section so
consumer onboarding remains task-oriented.

The site follows these principles:

- Start with a stable mental model, then present task guides, then reference.
- Document public contracts rather than implementation details.
- Prefer tested examples already present in the repository.
- State environment, security, mutation, authority, and size limits explicitly.
- Keep English and Chinese pages structurally equivalent.
- Treat every command, type name, capability name, default, and exit code as a
  fact that must be checked against the current repository.

## Architectural decision

The selected architecture is a self-contained documentation site in the same
repository:

```text
Repository compatibility contracts
  package.json exports
  public index modules
  capability registry and DTOs
  CLI behavior and tested examples
                  |
                  v
      Curated bilingual Markdown
                  |
                  v
      website/ + OINK v1.0.0
                  |
                  v
     warning-strict Hugo build
                  |
                  v
 GitHub Pages + Markdown/LLMS outputs
```

Keeping the site in this repository makes documentation changes reviewable
beside the code and ties deployed content to the same commit. A separate
documentation repository was rejected because it would create version drift
and cross-repository release coordination. Mounting the existing `docs/` tree
was rejected because that tree contains internal design and implementation
artifacts and does not use public-site front matter.

## Directory layout

Add the following files and directories:

```text
website/
├── hugo.yaml
├── go.mod
├── go.sum
├── assets/
│   └── icons/
│       └── logo.svg
├── static/
│   └── favicon.svg
├── data/
│   └── home/
│       ├── en.yaml
│       └── zh.yaml
└── content/
    ├── _index.md
    ├── _index.zh.md
    └── docs/
        ├── _index.md
        ├── _index.zh.md
        ├── introduction/
        ├── getting-started/
        ├── guides/
        ├── reference/
        └── development/

.github/workflows/deploy-docs.yml
```

`website/go.mod` pins OINK v1.0.0 and declares Go 1.27.0. `website/go.sum`
records the resolved module checksum. The site has no `package.json`, npm
scripts, PostCSS pipeline, or CDN-hosted runtime assets.

The logo and favicon are repository-owned neutral assets. The first version
may adapt the project's existing identity but must not copy OINK's sample
project name or leave Starter placeholder branding.

## Content map

The public navigation contains only Home and Docs.

### Introduction

- **Overview:** what the package does, supported environments, and who should
  use each interface.
- **Architecture:** the transport-neutral core, capability layer, authorities,
  and thin interfaces.
- **Capabilities:** `inspectStyle`, `applyStyleTransaction`,
  `applyStyleDocument`, `runMapCommand`, and `queryMapFeatures`, including the
  shared result envelope.

### Getting Started

- **Requirements:** Node.js, MapLibre, AI SDK expectations, ESM packaging, and
  environment-specific requirements.
- **Installation:** npm installation and supported peer dependencies.
- **AI SDK quick start:** construct `createMapLibreStyleTools`, execute one
  inspection, and pass the tools to an AI SDK tool set.
- **CLI quick start:** validate, inspect, and dry-run a transaction without
  network access or input mutation.

### Guides

- **Core transactions and validation**
- **MapLibre adapter and live-map mutation**
- **Transport-neutral capabilities and direct model schemas**
- **AI SDK integration**
- **MCP server and bounded sessions**
- **WebMCP Site tools**
- **Browser bridge and live MCP access**

Each guide explains when to use the interface, its authority model, mutation
and failure behavior, its security boundary, and a tested example.

### Reference

- **Package entry points:** root, `/core`, `/maplibre`, `/capabilities`, `/ai`,
  `/webmcp`, `/mcp`, and `/bridge`.
- **CLI:** commands, standard input rules, mutation safeguards, result output,
  and exit codes.
- **Capability contracts:** inputs, outputs, authority requirements, and
  availability across interfaces.
- **Results and errors:** discriminated result envelope, `StyleToolError`,
  validation failures, conflicts, and operational failures.
- **Limits and safety:** Style, diff, operation, GeoJSON, feature-query,
  resource-policy, and bridge message boundaries.

The reference is curated at the entry-point and contract level. It does not
attempt to enumerate every type and helper.

### Development

- **Repository structure:** major source areas, examples, scripts, and build
  boundaries.
- **Ambient type boundaries:** ES-only core, DOM-capable browser modules, and
  Node-capable MCP/AI modules.
- **Verification:** typecheck, lint, unit tests, package-contract checks,
  example checks, and relevant E2E commands.
- **Contributing:** focused-change expectations, public-contract caution, and
  links to the repository issue tracker and changelog.

## Source-of-truth policy

Documentation facts are derived from these sources, in priority order:

1. `package.json` exports, engines, dependencies, binaries, and scripts.
2. Public `index.ts` entry modules and package-owned public DTOs.
3. The capability registry, schemas, authority interfaces, and result envelope.
4. Package-contract tests and interface-specific tests.
5. Existing runnable examples and CLI behavior.
6. Root README files and changelog.
7. GitNexus execution flows for architecture discovery and cross-checking.

If prose conflicts with a tested public contract, the contract wins and the
prose is corrected. Internal design documents may explain intent but are not a
public compatibility source and are never copied verbatim into the site.

## Localization

English is the default language at `/`; Simplified Chinese is published under
`/zh/`. Every public content page has an English base file and a `.zh.md` peer.
Home-page data is stored in `data/home/en.yaml` and `data/home/zh.yaml`.

Navigation order, headings, code examples, links, and factual coverage remain
equivalent across languages. Explanatory prose is translated naturally rather
than mechanically, while identifiers, commands, JSON keys, type names, and
error codes remain unchanged.

The build must fail when one language links to a missing internal route.
Translation completeness is also checked during reader testing because Hugo
can build a structurally valid site even when prose coverage has drifted.

## OINK and Hugo configuration

`website/hugo.yaml` sets:

- title: `maplibre-style-tools`;
- base URL: `https://mapseekai.github.io/maplibre-style-tools/`;
- English as the default content language;
- Simplified Chinese as the second language;
- local search and dark mode enabled;
- Docs as the only content shell in the main navigation;
- HTML, RSS where applicable, Print, Markdown, LLMS, and NAVJSON outputs needed
  by the site;
- repository links to `https://github.com/mapseekai/maplibre-style-tools`;
- OINK's required Goldmark renderer and parser settings;
- the OINK Hugo Module import with the Extended-version requirement.

The configuration omits Blog, Book, French, analytics, comments, feedback,
custom-domain, and assistant-link settings. Optional features remain absent
rather than commented placeholder blocks.

## Build and deployment

Local preview runs from the site directory:

```bash
cd website
hugo server
```

The production build is:

```bash
hugo --cleanDestinationDir --gc --minify --environment production \
  --printPathWarnings --panicOnWarning
```

`.github/workflows/deploy-docs.yml` follows the official OINK Starter GitHub
Pages workflow and uses:

- Go from `website/go.mod`;
- Hugo Extended 0.165.0;
- cached Hugo modules keyed by the module checksums;
- GitHub Pages configuration, artifact upload, and deployment Actions;
- `website/public/` as the deployment artifact;
- least-privilege Pages and OIDC permissions;
- deployment concurrency that cancels stale in-progress publishes.

Pull requests that modify `website/**`, the workflow, or documentation-relevant
public contracts run the strict build but do not deploy. Pushes to `main` run
the same build and deploy only after it succeeds. A manual workflow trigger
allows a clean rebuild without a source change.

The workflow is independent of npm packaging and existing application example
deployments. It must not alter the package build matrix or publish npm output.

## Validation

Implementation verification consists of the following gates.

### Module and site build

- `go mod verify` passes in `website/`.
- The warning-strict production Hugo command exits successfully.
- The build produces:
  - `public/index.html`;
  - `public/zh/index.html`;
  - English and Chinese Docs roots;
  - `public/llms.txt` and `public/zh/llms.txt`;
  - semantic Markdown outputs for representative pages;
  - local-search indexes for both languages.

### Repository fact check

- All eight package entry points match `package.json`.
- All five capability names and their interface availability match the
  capability registry.
- Installation requirements and peer versions match package metadata.
- CLI commands, standard input behavior, mutation safeguards, and exit codes
  match the CLI implementation and tests.
- Result, error, limit, authority, and security statements match public DTOs,
  schemas, tests, and package contracts.
- Code examples are copied from or reduced from tested repository examples
  wherever possible.

### Existing repository verification

Because the site must not change runtime behavior, run the repository's
existing typecheck, lint, unit test, package-contract, example, and relevant
E2E verification commands after the documentation files and workflow are in
place. Any failure is treated as an implementation failure even if Hugo builds.

### Reader testing

After all pages are drafted, use readers without the authoring conversation's
context to answer realistic English and Chinese questions, including:

- Which package entry point should a browser-only consumer import?
- How do the five capabilities remain consistent across AI SDK, MCP, WebMCP,
  and CLI interfaces?
- How can a user inspect a Style without mutating it?
- What guarantees does a failed transaction provide?
- When should the browser bridge be used instead of in-process tools?
- Which limits and authority requirements apply to a chosen operation?

Additional readers check for ambiguity, unsupported assumptions,
contradictions, missing translations, and internal terminology that was not
defined. Any gap returns to content refinement before completion.

## Failure handling

- A Hugo warning or path warning fails the production build.
- A module checksum or resolution failure blocks the build; the workflow does
  not float to a newer OINK release.
- Missing or stale translations block completion even when Hugo can render the
  remaining site.
- Facts that cannot be verified from public repository evidence are omitted or
  qualified rather than guessed.
- A deployment failure does not rewrite or remove the last successful Pages
  deployment.
- The implementation does not modify root documentation or package behavior to
  make the site build; site-specific fixes remain inside `website/` or its
  workflow.

## Acceptance criteria

The documentation site is complete when:

1. `website/` contains only the approved English and Simplified Chinese Home
   and Docs site.
2. OINK v1.0.0, Go 1.27.0, and Hugo Extended 0.165.0 are pinned by the module
   and workflow.
3. The content map in this design is implemented without publishing internal
   design artifacts.
4. Every public entry point and capability contract is documented accurately.
5. Local module verification and warning-strict production builds pass.
6. Existing repository verification passes without runtime or package-contract
   changes.
7. The GitHub Pages workflow builds on pull requests and deploys from `main`.
8. English and Chinese reader tests answer the discovery questions correctly
   and report no unresolved contradictions or material ambiguity.
9. The deployed site is reachable at
   `https://mapseekai.github.io/maplibre-style-tools/` with working language
   switching, local search, Markdown outputs, and `llms.txt` indexes.

## Risks and mitigations

- **Documentation drift:** keep the site in the same repository, require fact
  checks against public contracts, and update related pages with compatibility
  changes.
- **Scope growth:** exclude Blog, Book, French, exhaustive symbol generation,
  analytics, and custom-domain work from the first version.
- **Translation drift:** require page peers, equivalent navigation, and
  bilingual reader tests.
- **Accidental internal publication:** use an explicit `website/content/` tree
  and do not configure content mounts from root `docs/`.
- **Theme drift:** pin OINK v1.0.0 and update it only through an explicit,
  separately verified dependency change.
- **Pages path errors:** set the repository subpath base URL, build with path
  warnings promoted to errors, and verify representative deployed routes.
- **Toolchain mismatch:** pin Go and Hugo in CI and document the same versions
  for local contributors.

## Implementation boundary

Implementation may add or modify only:

- `website/**`;
- `.github/workflows/deploy-docs.yml`;
- a minimal root README link to the published documentation, if the final site
  URL is live and the link is verified.

It must not change public package exports, runtime code, package formats,
testing frameworks, ambient-type boundaries, or existing example behavior.
