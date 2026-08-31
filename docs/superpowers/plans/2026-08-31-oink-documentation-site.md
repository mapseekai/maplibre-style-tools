# Oink Documentation Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish an English and Simplified Chinese Oink documentation site at the repository GitHub Pages root while preserving the existing WebMCP example at `/webmcp/`.

**Architecture:** A self-contained Hugo Module under `website/` owns public documentation content and generates HTML, print, Markdown, LLMS, and NAVJSON outputs. One replacement Pages workflow builds both the Oink site and the existing WebMCP example, assembles them into `.tmp/pages/`, and deploys the single artifact.

**Tech Stack:** Oink v1.0.0, Hugo Extended 0.165.0, Go 1.27.0, Markdown, YAML, GitHub Actions, Node.js 22, pnpm 10.10.0

**Spec:** `docs/superpowers/specs/2026-08-31-oink-documentation-site-design.md`

## Global Constraints

- Pin Oink to exactly `v1.0.0`, Go to `1.27.0`, and CI Hugo Extended to `0.165.0`.
- Keep the site under `website/`; do not mount or copy root `docs/` content.
- Publish only English at `/` and Simplified Chinese at `/zh/`.
- Keep only Home and Docs; do not add Blog, Book, French, analytics, comments, feedback, or a custom domain.
- Preserve all eight package entry points and five capability names exactly as implemented.
- Do not change runtime code, package exports, package formats, ambient-type boundaries, testing frameworks, npm publishing, or WebMCP application behavior.
- Preserve the WebMCP public URL `/maplibre-style-tools/webmcp/` and remove only the old Pages-root redirect.
- Use relative content links or Hugo-aware URLs so the repository Pages subpath is retained.
- Write English base pages and matching `.zh.md` peers with identical heading anchors, examples, identifiers, and factual coverage.
- Use `apply_patch` for repository file edits. Preserve unrelated worktree changes.
- Before every commit, run `node .gitnexus/run.cjs detect-changes --scope all --repo .`; do not commit if the result is partial, truncated, HIGH, or CRITICAL.
- The local Hugo prerequisite must print `extended`. If `hugo` is missing, request user authorization before running `brew install hugo`.
- Do not push or trigger an external deployment without explicit user authorization.

## File Map

```text
website/
├── .gitignore
├── go.mod
├── go.sum
├── hugo.yaml
├── assets/icons/logo.svg
├── static/favicon.svg
├── data/home/en.yaml
├── data/home/zh.yaml
└── content/
    ├── _index.md
    ├── _index.zh.md
    └── docs/
        ├── _index.md
        ├── _index.zh.md
        ├── introduction/{_index,overview,architecture,capabilities}.{md,zh.md}
        ├── getting-started/{_index,requirements,installation,ai-sdk-quick-start,cli-quick-start}.{md,zh.md}
        ├── guides/{_index,core,maplibre,capabilities,ai-sdk,mcp,webmcp,bridge}.{md,zh.md}
        ├── reference/{_index,package-entry-points,cli,capability-contracts,results-and-errors,limits-and-safety}.{md,zh.md}
        └── development/{_index,repository-structure,ambient-types,verification,contributing}.{md,zh.md}

.github/workflows/deploy-pages.yml
.github/workflows/deploy-webmcp.yml  # remove after behavior moves
```

## Page Metadata Matrix

Every ordinary content page begins with YAML front matter containing exactly
`title`, `description`, and `weight`, in that order, using the values from its
matrix row below.

| File stem | Weight | English title | English description | Chinese title | Chinese description |
| --- | ---: | --- | --- | --- | --- |
| `introduction/overview` | 10 | Overview | What the package does, which environments it supports, and which interface to choose. | 概览 | 了解软件包的用途、支持环境以及如何选择接口。 |
| `introduction/architecture` | 20 | Architecture | How the core, capability registry, authorities, and interfaces fit together. | 架构 | 理解核心、能力注册表、Authority 与各接口如何协作。 |
| `introduction/capabilities` | 30 | Capabilities | The five shared operations, result envelope, and runtime requirements. | 能力 | 了解五项共享操作、结果封装与运行时要求。 |
| `getting-started/requirements` | 10 | Requirements | Runtime, peer dependency, and interface-specific requirements. | 环境要求 | 了解运行时、Peer Dependency 与各接口的具体要求。 |
| `getting-started/installation` | 20 | Installation | Install the package from npm or a local checkout. | 安装 | 从 npm 或本地检出安装软件包。 |
| `getting-started/ai-sdk-quick-start` | 30 | AI SDK Quick Start | Inspect a live MapLibre Style through the AI SDK interface. | AI SDK 快速开始 | 通过 AI SDK 接口检查实时 MapLibre 样式。 |
| `getting-started/cli-quick-start` | 40 | CLI Quick Start | Validate, inspect, and preview a Style transaction from the command line. | CLI 快速开始 | 从命令行验证、检查并预览样式事务。 |
| `guides/core` | 10 | Core Transactions | Validate and transform Style documents without a browser or transport. | Core 事务 | 在不依赖浏览器或传输层的情况下验证和转换样式文档。 |
| `guides/maplibre` | 20 | MapLibre Adapter | Apply prepared changes and run bounded operations against a live map. | MapLibre 适配器 | 对实时地图应用已准备的修改并执行有边界的操作。 |
| `guides/capabilities` | 30 | Capability Registry | Use the transport-neutral executors, schemas, and authority interfaces. | 能力注册表 | 使用传输无关的执行器、Schema 与 Authority 接口。 |
| `guides/ai-sdk` | 40 | AI SDK | Expose the five shared capabilities as AI SDK tools over an in-process map. | AI SDK | 将五项共享能力作为 AI SDK 工具作用于进程内地图。 |
| `guides/mcp` | 50 | MCP Server | Serve bounded Style sessions and live maps over stdio or protected HTTP. | MCP 服务器 | 通过 stdio 或受保护的 HTTP 提供有边界的样式会话与实时地图。 |
| `guides/webmcp` | 60 | WebMCP Site Tools | Register page-scoped browser tools with read-only defaults and explicit mutation opt-in. | WebMCP Site tools | 以只读默认值和显式写入授权注册页面级浏览器工具。 |
| `guides/bridge` | 70 | Browser Bridge | Connect a browser MapLibre map to the MCP live-map extension safely. | 浏览器桥接 | 安全地将浏览器中的 MapLibre 地图连接到 MCP 实时地图扩展。 |
| `reference/package-entry-points` | 10 | Package Entry Points | Choose among the eight supported import specifiers. | 软件包入口 | 在八个受支持的导入入口之间做出选择。 |
| `reference/cli` | 20 | CLI Reference | Look up commands, options, stdin rules, mutation safeguards, and exit codes. | CLI 参考 | 查询命令、选项、stdin 规则、写入保护与退出码。 |
| `reference/capability-contracts` | 30 | Capability Contracts | Compare inputs, outputs, authority needs, and interface availability. | 能力契约 | 比较输入、输出、Authority 要求与接口可用性。 |
| `reference/results-and-errors` | 40 | Results and Errors | Interpret success envelopes, failures, error codes, paths, and details. | 结果与错误 | 理解成功封装、失败、错误码、路径与详细信息。 |
| `reference/limits-and-safety` | 50 | Limits and Safety | Look up byte, count, depth, transport, and resource-policy boundaries. | 限制与安全 | 查询字节、数量、深度、传输和资源策略边界。 |
| `development/repository-structure` | 10 | Repository Structure | Understand the source areas, examples, scripts, and documentation site. | 仓库结构 | 理解源码区域、示例、脚本与文档站。 |
| `development/ambient-types` | 20 | Ambient Type Boundaries | Preserve ES-only, DOM-capable, and Node-capable declaration boundaries. | Ambient Type 边界 | 保持 ES-only、DOM-capable 与 Node-capable 声明边界。 |
| `development/verification` | 30 | Verification | Run repository, example, E2E, module, and documentation checks. | 验证 | 运行仓库、示例、E2E、模块与文档检查。 |
| `development/contributing` | 40 | Contributing | Make focused changes without breaking public contracts. | 贡献指南 | 在不破坏公开契约的前提下进行聚焦修改。 |

---

### Task 1: Scaffold the Oink Module and Bilingual Site Shell

**Files:**
- Create: `website/.gitignore`
- Create: `website/go.mod`
- Create: `website/go.sum`
- Create: `website/hugo.yaml`
- Create: `website/assets/icons/logo.svg`
- Create: `website/static/favicon.svg`
- Create: `website/data/home/en.yaml`
- Create: `website/data/home/zh.yaml`
- Create: `website/content/_index.md`
- Create: `website/content/_index.zh.md`
- Create: `website/content/docs/_index.md`
- Create: `website/content/docs/_index.zh.md`
- Create: bilingual `_index` files for the five Docs sections listed in the File Map

**Interfaces:**
- Consumes: Oink Hugo Module `github.com/pgsty/oink v1.0.0`; GitHub Pages base URL `https://mapseekai.github.io/maplibre-style-tools/`.
- Produces: a warning-strict bilingual Hugo site with Home, Docs, local search, Markdown, LLMS, and NAVJSON outputs; stable section routes used by Tasks 2–7.

- [ ] **Step 1: Verify prerequisites and the red state**

Run from the repository root:

```bash
go version
hugo version
test -f website/hugo.yaml
```

Expected: Go reports `go1.27.0`; Hugo reports `v0.165.0` or newer and contains `extended`; the final `test` exits `1` because the site does not exist. If Hugo is absent, stop, request authorization, run `brew install hugo`, then repeat this step.

- [ ] **Step 2: Create the module, ignore rules, and exact site configuration**

Use `apply_patch` to create `website/.gitignore`:

```gitignore
/public/
/resources/_gen/
/.hugo_build.lock
```

Create `website/go.mod`:

```go
module github.com/mapseekai/maplibre-style-tools/website

go 1.27.0

require github.com/pgsty/oink v1.0.0
```

Create `website/hugo.yaml` with this exact baseline:

```yaml
title: &siteTitle maplibre-style-tools
baseURL: https://mapseekai.github.io/maplibre-style-tools/
defaultContentLanguage: en
enableGitInfo: true
enableRobotsTXT: true
enableEmoji: true
timeZone: UTC

languages:
  en:
    label: English
    locale: en-US
    weight: 1
    title: *siteTitle
    params:
      description: AI-driven tools for inspecting and editing MapLibre styles.
  zh:
    label: 简体中文
    locale: zh-CN
    weight: 2
    title: *siteTitle
    hasCJKLanguage: true
    params:
      description: 用于检查和编辑 MapLibre 样式的 AI 驱动工具。

markup:
  goldmark:
    renderer:
      unsafe: true
    parser:
      attribute:
        block: true
      wrapStandAloneImageWithinParagraph: false
  highlight:
    noClasses: false

outputs:
  home: [HTML, RSS, markdown, LLMS, NAVJSON]
  page: [HTML, markdown]
  section: [HTML, RSS, print, markdown]

params:
  offline_search: true
  copyright:
    authors: maplibre-style-tools contributors
    from_year: 2026
  footer_center_info: ''
  github_repo: https://github.com/mapseekai/maplibre-style-tools
  github_branch: main
  logo: icons/logo.svg
  ui:
    dark_mode: true
    section_index: cards
    sidebar_menu_foldable: true
    sidebar_icon_policy: groups
    backlinks: true

module:
  imports:
    - path: github.com/pgsty/oink
  hugoVersion:
    extended: true
    min: 0.160.1
```

- [ ] **Step 3: Create the repository-owned SVG identity**

Create both SVG files with their respective accessible titles. `logo.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title">
  <title id="title">maplibre-style-tools</title>
  <path fill="#3969ac" d="M32 4 58 18 32 32 6 18 32 4Z"/>
  <path fill="#11a579" d="m6 29 26 14 26-14v10L32 53 6 39V29Z"/>
  <path fill="#f2b701" d="m6 42 26 14 26-14v8L32 64 6 50v-8Z"/>
</svg>
```

`favicon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title">
  <title id="title">maplibre-style-tools icon</title>
  <path fill="#3969ac" d="M32 4 58 18 32 32 6 18 32 4Z"/>
  <path fill="#11a579" d="m6 29 26 14 26-14v10L32 53 6 39V29Z"/>
  <path fill="#f2b701" d="m6 42 26 14 26-14v8L32 64 6 50v-8Z"/>
</svg>
```

- [ ] **Step 4: Create exact bilingual home data**

Create `website/data/home/en.yaml`:

```yaml
sections: [hero, cards, cta]

hero:
  align: center
  eyebrow: MapLibre style tooling
  title_lines:
    - words: [{ text: Inspect styles. }]
    - words: [{ text: Change them with confidence. }]
  lead: One bounded capability layer for Core, MapLibre, AI SDK, MCP, WebMCP, browser bridge, and CLI integrations.
  actions:
    - { label: Read the docs, url: docs/, icon: fa-solid fa-book, style: primary }
    - { label: View on GitHub, url: https://github.com/mapseekai/maplibre-style-tools, icon: fa-brands fa-github, style: ghost }

cards:
  eyebrow: Choose a path
  title: Start from the interface you need
  columns: 3
  items:
    - title: Understand the architecture
      desc: Learn how the core, capability registry, authorities, and interfaces fit together.
      icon: fa-solid fa-diagram-project
      url: docs/introduction/
    - title: Complete a first integration
      desc: Install the package and inspect a MapLibre style through AI SDK or CLI.
      icon: fa-solid fa-rocket
      url: docs/getting-started/
    - title: Select an interface
      desc: Compare Core, MapLibre, AI SDK, MCP, WebMCP, bridge, and CLI workflows.
      icon: fa-solid fa-code-branch
      url: docs/guides/

cta:
  title: Need an exact contract?
  text: Look up package entry points, capability inputs, errors, limits, and CLI behavior.
  label: Open the reference
  url: docs/reference/
  style: primary
```

Create `website/data/home/zh.yaml`:

```yaml
sections: [hero, cards, cta]

hero:
  align: center
  eyebrow: MapLibre 样式工具
  title_lines:
    - words: [{ text: 检查样式。 }]
    - words: [{ text: 有把握地修改。 }]
  lead: 一套有边界的能力层，统一支持 Core、MapLibre、AI SDK、MCP、WebMCP、浏览器桥接与 CLI 集成。
  actions:
    - { label: 阅读文档, url: docs/, icon: fa-solid fa-book, style: primary }
    - { label: 在 GitHub 查看, url: https://github.com/mapseekai/maplibre-style-tools, icon: fa-brands fa-github, style: ghost }

cards:
  eyebrow: 选择路径
  title: 从你需要的接口开始
  columns: 3
  items:
    - title: 理解架构
      desc: 了解核心、能力注册表、Authority 与各接口如何协作。
      icon: fa-solid fa-diagram-project
      url: docs/introduction/
    - title: 完成首次集成
      desc: 安装软件包，并通过 AI SDK 或 CLI 检查 MapLibre 样式。
      icon: fa-solid fa-rocket
      url: docs/getting-started/
    - title: 选择接口
      desc: 比较 Core、MapLibre、AI SDK、MCP、WebMCP、Bridge 与 CLI 工作流。
      icon: fa-solid fa-code-branch
      url: docs/guides/

cta:
  title: 需要精确契约？
  text: 查询软件包入口、能力输入、错误、限制和 CLI 行为。
  label: 打开参考
  url: docs/reference/
  style: primary
```

- [ ] **Step 5: Create root, Docs, and section index pages**

Create root page peers with only this front matter:

```yaml
---
title: maplibre-style-tools
description: AI-driven tools for inspecting and editing MapLibre styles.
---
```

```yaml
---
title: maplibre-style-tools
description: 用于检查和编辑 MapLibre 样式的 AI 驱动工具。
---
```

Create `website/content/docs/_index.md`:

```markdown
---
title: Docs
description: Learn the architecture, complete an integration, and look up exact public contracts.
type: docs
icon: fa-solid fa-book
sidebar_root_for: self
sidebar_root_link_self: true
menus:
  main:
    identifier: docs
    weight: 20
cascade:
  type: docs
  footer_style: slim
---

Choose a path:

- [Introduction](introduction/)
- [Getting Started](getting-started/)
- [Guides](guides/)
- [Reference](reference/)
- [Development](development/)
{.cards}
```

Create `website/content/docs/_index.zh.md`:

```markdown
---
title: 文档
description: 理解架构、完成集成，并查询精确的公开契约。
type: docs
icon: fa-solid fa-book
sidebar_root_for: self
sidebar_root_link_self: true
menus:
  main:
    identifier: docs
    weight: 20
cascade:
  type: docs
  footer_style: slim
---

选择一条路径：

- [简介](introduction/)
- [快速开始](getting-started/)
- [指南](guides/)
- [参考](reference/)
- [开发](development/)
{.cards}
```

Create five bilingual section index pairs with the following exact metadata and one-sentence body:

| Route | Weight | English title / description | Chinese title / description |
| --- | ---: | --- | --- |
| `introduction` | 10 | Introduction / Understand the package, architecture, and shared capabilities. | 简介 / 理解软件包、架构与共享能力。 |
| `getting-started` | 20 | Getting Started / Install the package and complete a first inspection. | 快速开始 / 安装软件包并完成首次检查。 |
| `guides` | 30 | Guides / Integrate the package through the interface that matches your runtime. | 指南 / 通过适合当前运行时的接口集成软件包。 |
| `reference` | 40 | Reference / Look up public contracts, commands, errors, and limits. | 参考 / 查询公开契约、命令、错误与限制。 |
| `development` | 50 | Development / Understand repository boundaries, verification, and contribution rules. | 开发 / 理解仓库边界、验证流程与贡献规则。 |

Each `_index` file uses `type: docs` through the parent cascade and contains no Starter sample links.

- [ ] **Step 6: Resolve and verify the Hugo Module**

Run:

```bash
cd website
go mod download github.com/pgsty/oink
go mod verify
hugo --cleanDestinationDir --gc --minify --environment production --printPathWarnings --panicOnWarning
```

Expected: `website/go.sum` is created; module verification prints `all modules verified`; Hugo exits `0` without warnings.

- [ ] **Step 7: Verify shell output contracts**

Run from `website/` as separate commands:

```bash
test -f public/index.html
test -f public/zh/index.html
test -f public/docs/index.html
test -f public/zh/docs/index.html
test -f public/llms.txt
test -f public/zh/llms.txt
test -f public/navigation.json
test -f public/zh/navigation.json
test -f public/docs/index.md
test -f public/zh/docs/index.md
test -f public/_print/docs/index.html
test -f public/zh/_print/docs/index.html
rg --files -g 'offline-search-index*.json' public
rg -n "maplibre-style-tools" public/index.html public/zh/index.html
test ! -e public/blog
test ! -e public/book
test ! -e public/fr
```

Expected: every command exits `0`; no Blog, Book, French, or sample-project route appears in `public/`.

- [ ] **Step 8: Run the graph gate and commit the foundation**

```bash
cd ..
node .gitnexus/run.cjs detect-changes --scope all --repo .
git add website
git commit -m "docs: scaffold Oink documentation site"
```

Expected: graph risk is LOW with no runtime symbols changed; commit contains only `website/**`.

---

### Task 2: Write Introduction and Capability Model Pages

**Files:**
- Create: `website/content/docs/introduction/overview.md`
- Create: `website/content/docs/introduction/overview.zh.md`
- Create: `website/content/docs/introduction/architecture.md`
- Create: `website/content/docs/introduction/architecture.zh.md`
- Create: `website/content/docs/introduction/capabilities.md`
- Create: `website/content/docs/introduction/capabilities.zh.md`

**Interfaces:**
- Consumes: `package.json`, root README files, `src/capabilities/registry.ts`, authority contracts, and Task 1 routes.
- Produces: the stable mental model and terminology referenced by every later guide and reference page.

- [ ] **Step 1: Verify the red content state**

```bash
test -f website/content/docs/introduction/overview.md
test -f website/content/docs/introduction/architecture.md
test -f website/content/docs/introduction/capabilities.md
```

Expected: each command exits `1`.

- [ ] **Step 2: Create the bilingual Overview pages**

Use front-matter weight `10`. English headings and Chinese peers use identical explicit anchors:

```text
## What this package does {#what-it-does}
## Choose an interface {#choose-an-interface}
## Compatibility contracts {#compatibility-contracts}
```

State exactly that the package exposes a transport-neutral core, five shared capabilities, and thin AI SDK, MCP, WebMCP, and CLI interfaces. Include a table mapping Core, MapLibre, Capabilities, AI SDK, WebMCP, MCP, Bridge, and CLI to their runtime and recommended use. State Node.js `>=22.13.0`, MapLibre `^6.3.0`, AI SDK 6 integration, ESM-only packaging, and no network fetch in Core/CLI validation.

- [ ] **Step 3: Create the bilingual Architecture pages**

Use weight `20` and these anchors:

```text
## System map {#system-map}
## Style authorities {#style-authorities}
## Runtime authorities {#runtime-authorities}
## Ambient type boundaries {#ambient-type-boundaries}
```

Include this exact flow diagram:

```text
AI SDK | MCP | WebMCP | CLI
              |
              v
      capabilityRegistry
              |
              v
 StyleAuthority + RuntimeAuthority
              |
              v
 Core document | live MapLibre map | browser bridge
```

Define `/core` as ES-only, `/maplibre`, `/webmcp`, and browser `/bridge` as DOM-capable without Node ambient types, and `/mcp` plus `/ai` as Node-capable where required.

- [ ] **Step 4: Create the bilingual Capabilities pages**

Use weight `30` and these anchors:

```text
## Shared registry {#shared-registry}
## The five capabilities {#five-capabilities}
## Result envelope {#result-envelope}
## Runtime requirements {#runtime-requirements}
```

List exactly `inspectStyle`, `applyStyleTransaction`, `applyStyleDocument`, `runMapCommand`, and `queryMapFeatures`. Mark the first three with `requiresRuntime: false` and the final two with `requiresRuntime: true`, matching `src/capabilities/registry.ts`. Include this exact public result contract:

```ts
type CapabilityResult<TData> =
  | { success: true; message: string; data: TData }
  | { success: false; message: string; error: StyleToolError };
```

State that inputs are strict native JSON and nested values must not be JSON-encoded strings.

- [ ] **Step 5: Build and verify the Introduction pages**

```bash
cd website
hugo --cleanDestinationDir --gc --minify --environment production --printPathWarnings --panicOnWarning
test -f public/docs/introduction/overview/index.html
test -f public/zh/docs/introduction/overview/index.html
rg -n "inspectStyle|applyStyleTransaction|queryMapFeatures" public/docs/introduction public/zh/docs/introduction
```

Expected: build and checks exit `0`; both languages contain all five capability names and the same explicit anchors.

- [ ] **Step 6: Run the graph gate and commit**

```bash
cd ..
node .gitnexus/run.cjs detect-changes --scope all --repo .
git add website/content/docs/introduction
git commit -m "docs: add architecture introduction"
```

---

### Task 3: Write Requirements, Installation, and Quick Starts

**Files:**
- Create: bilingual `requirements`, `installation`, `ai-sdk-quick-start`, and `cli-quick-start` pages under `website/content/docs/getting-started/`

**Interfaces:**
- Consumes: `package.json`, CLI help and tests, README installation examples, and Introduction terminology.
- Produces: two complete first-use paths—AI SDK against a live map and CLI against a Style file.

- [ ] **Step 1: Verify the red content state**

```bash
test -f website/content/docs/getting-started/requirements.md
test -f website/content/docs/getting-started/installation.md
test -f website/content/docs/getting-started/ai-sdk-quick-start.md
test -f website/content/docs/getting-started/cli-quick-start.md
```

Expected: each command exits `1`.

- [ ] **Step 2: Write Requirements and Installation peers**

Requirements uses weight `10` and headings `Runtime`, `Peer dependencies`, and `Interface-specific requirements`. Record Node.js `>=22.13.0`, `maplibre-gl ^6.3.0`, AI SDK `^6.0.141`, ESM-only output, and the distinction between browser and Node entry points.

Installation uses weight `20` and these exact commands:

```bash
npm install maplibre-style-tools maplibre-gl
```

```bash
cd ../maplibre-style-tools
pnpm install
pnpm run build
cd ../your-project
pnpm add ../maplibre-style-tools
pnpm add maplibre-gl
```

State that CommonJS on supported Node versions can use `require(esm)`, but no `.cjs` artifact is published.

- [ ] **Step 3: Write the AI SDK quick-start peers**

Use weight `30`, headings `Create the tools`, `Execute an inspection`, and `Handle the result`. Include this tested import and construction:

```ts
import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';

const tools = createMapLibreStyleTools({ getMap: () => map });
const result = await tools.inspectStyle.execute({ action: 'getLayerCount' });

if (!result.success) {
  console.error(result.error.code, result.error.message);
}
```

State that the factory returns exactly five tools and that `getMap()` may return `null`, which yields a normal failure envelope rather than arbitrary application state.

- [ ] **Step 4: Write the CLI quick-start peers**

Use weight `40`, headings `Validate`, `Inspect`, `Preview a transaction`, and `Write intentionally`. Include:

```bash
maplibre-style validate style.json
maplibre-style inspect style.json --query road
maplibre-style apply style.json --operations operations.json --dry-run
maplibre-style apply style.json --operations operations.json --output next-style.json
```

State that apply does not mutate input unless `--in-place` is explicit, `--output` never overwrites an existing path, and `--backup` never replaces a pre-existing backup.

- [ ] **Step 5: Build and verify onboarding content**

```bash
cd website
hugo --cleanDestinationDir --gc --minify --environment production --printPathWarnings --panicOnWarning
test -f public/docs/getting-started/ai-sdk-quick-start/index.html
test -f public/zh/docs/getting-started/cli-quick-start/index.html
rg -n "Node.js 22.13|maplibre-style validate|createMapLibreStyleTools" public/docs/getting-started public/zh/docs/getting-started
```

Expected: every check exits `0`; code identifiers and commands are identical across languages.

- [ ] **Step 6: Run the graph gate and commit**

```bash
cd ..
node .gitnexus/run.cjs detect-changes --scope all --repo .
git add website/content/docs/getting-started
git commit -m "docs: add getting started guides"
```

---

### Task 4: Write Core, MapLibre, and Capability Integration Guides

**Files:**
- Create: bilingual `core`, `maplibre`, and `capabilities` pages under `website/content/docs/guides/`

**Interfaces:**
- Consumes: `/core`, `/maplibre`, and `/capabilities` public entry modules; transaction, GeoJSON, feature-query, and registry tests.
- Produces: transport-neutral and in-process integration guidance used by the interface guides and reference.

- [ ] **Step 1: Verify the red content state**

```bash
test -f website/content/docs/guides/core.md
test -f website/content/docs/guides/maplibre.md
test -f website/content/docs/guides/capabilities.md
```

Expected: each command exits `1`.

- [ ] **Step 2: Write the Core guide peers**

Use weight `10` and anchors `Validate a document`, `Apply a transaction`, `Filter composition`, `Inline GeoJSON`, and `Atomic failure`. Include:

```ts
import { applyStyleTransaction } from 'maplibre-style-tools/core';

const result = applyStyleTransaction(
  { version: 8, sources: {}, layers: [] },
  {
    operations: [{
      op: 'setLayerProperties',
      layerId: 'roads',
      paint: { 'line-color': '#ffffff' },
    }],
  },
);
```

State that the operation discriminator is required, a failed operation rejects the whole candidate, successful diffs use RFC 6901 pointers, and default limits are 5 MiB Style, 1 MiB diff, and 100 operations.

- [ ] **Step 3: Write the MapLibre guide peers**

Use weight `20` and anchors `Prepare before mutation`, `Apply and await`, `Revision conflicts`, `Bounded feature queries`, and `Incremental GeoJSON`. Include the exact runtime schema example:

```ts
import { runtimeGeoJsonSourceDiffSchema } from 'maplibre-style-tools/maplibre';

const parsed = runtimeGeoJsonSourceDiffSchema.safeParse({
  update: [{
    id: 'station-1',
    addOrUpdateProperties: [{ key: 'status', value: 'open' }],
  }],
});

if (parsed.success) {
  await source.updateData(parsed.data);
}
```

State that `applyTransactionToMap` validates the current Style, prepares an immutable transaction, detects revision conflicts, waits for Style confirmation, and reports `current`, `pre-operation`, or `unavailable` authority.

- [ ] **Step 4: Write the Capabilities guide peers**

Use weight `30` and anchors `Why the registry exists`, `Authority interfaces`, `Strict model schemas`, `Direct OpenAI schemas`, and `Direct Anthropic schemas`. State that the registry is the single source for names, descriptions, schemas, and execution, while `createOpenAiFunctionTools` and `createAnthropicTools` project tool definitions without selecting a Style authority for the caller.

Include this exact authority table and verify it against
`src/capabilities/registry.ts` and `src/capabilities/authority.ts` before
committing:

| Capability | `requiresRuntime` | Mutation behavior | Authority member |
| --- | ---: | --- | --- |
| `inspectStyle` | `false` | Read-only | `readStyle()` and `context()` |
| `applyStyleTransaction` | `false` | Mutates atomically | `applyTransaction()` |
| `applyStyleDocument` | `false` | Replaces the Style | `applyDocument()` |
| `runMapCommand` | `true` | Mixed read/write commands | `runtimeCommands()` |
| `queryMapFeatures` | `true` | Read-only bounded query | `querySourceFeatures()` or `queryRenderedFeatures()` |

- [ ] **Step 5: Build and verify integration guides**

```bash
cd website
hugo --cleanDestinationDir --gc --minify --environment production --printPathWarnings --panicOnWarning
test -f public/docs/guides/core/index.html
test -f public/zh/docs/guides/maplibre/index.html
rg -n "RFC 6901|REVISION_CONFLICT|createOpenAiFunctionTools" public/docs/guides public/zh/docs/guides
```

Expected: build and checks exit `0` and the bilingual pages retain exact public identifiers.

- [ ] **Step 6: Run the graph gate and commit**

```bash
cd ..
node .gitnexus/run.cjs detect-changes --scope all --repo .
git add website/content/docs/guides
git commit -m "docs: add core integration guides"
```

---

### Task 5: Write AI SDK, MCP, WebMCP, and Browser Bridge Guides

**Files:**
- Create: `website/content/docs/guides/ai-sdk.md`
- Create: `website/content/docs/guides/ai-sdk.zh.md`
- Create: `website/content/docs/guides/mcp.md`
- Create: `website/content/docs/guides/mcp.zh.md`
- Create: `website/content/docs/guides/webmcp.md`
- Create: `website/content/docs/guides/webmcp.zh.md`
- Create: `website/content/docs/guides/bridge.md`
- Create: `website/content/docs/guides/bridge.zh.md`

**Interfaces:**
- Consumes: README-tested examples, `/ai`, `/mcp`, `/webmcp`, and `/bridge` public contracts, plus terminology from Tasks 2 and 4.
- Produces: four runtime-specific integration paths that preserve the package's security and authority distinctions.

- [ ] **Step 1: Verify the red content state**

```bash
test -f website/content/docs/guides/ai-sdk.md
test -f website/content/docs/guides/mcp.md
test -f website/content/docs/guides/webmcp.md
test -f website/content/docs/guides/bridge.md
```

Expected: each command exits `1`.

- [ ] **Step 2: Write the AI SDK guide peers**

Use weight `40` and anchors `Create the tool set`, `Pass tools to a model`,
`Execute directly`, `Map availability`, and `Result handling`. Reuse the Task 3
factory example, then include this direct transaction call:

```ts
const result = await tools.applyStyleTransaction.execute({
  transaction: {
    operations: [{
      op: 'setLayerProperties',
      layerId: 'roads',
      paint: { 'line-color': '#ffffff' },
    }],
  },
});
```

State that the AI facade wraps the shared capability registry, returns exactly
five tools, and never returns arbitrary application state or a complete Style
document in `data.style`.

- [ ] **Step 3: Write the MCP guide peers**

Use weight `50` and anchors `Choose a transport`, `Stdio`, `Protected HTTP`, `Document sessions`, and `Live-map extension`. Include:

```bash
maplibre-style-mcp --stdio
```

```bash
TOKEN='replace-with-a-random-secret'
maplibre-style-mcp --http --bearer-token "$TOKEN"
```

State that stdout is reserved for protocol messages, startup diagnostics use stderr, default MCP messages are 5 MiB, configurable bounds are 128 KiB through 64 MiB, HTTP binds loopback by default, and non-loopback requires `--allow-non-loopback` plus bearer and origin checks.

- [ ] **Step 4: Write the WebMCP guide peers**

Use weight `60` and anchors `When to use WebMCP`, `Read-only registration`, `Mutation opt-in`, `Invocation authorization`, and `How it differs from MCP`. Include:

```ts
import { registerMapLibreWebMcpTools } from 'maplibre-style-tools/webmcp';

const registration = await registerMapLibreWebMcpTools({
  getMap: () => map,
  signal: pageLifetime.signal,
});

if (!registration.supported) {
  console.info('This browser does not expose WebMCP Site tools.');
}
```

State that the default registers only `inspectStyle` and `queryMapFeatures`; `allowMutations: true` adds the three mutation-capable tools and must be paired with suitable invocation authorization and resource policy.

- [ ] **Step 5: Write the Browser Bridge guide peers**

Use weight `70` and anchors `When to use the bridge`, `Connect a map`, `Capabilities`, `Start the MCP bridge host`, and `Token and origin safety`. Include:

```ts
import { connectMapLibreBridge } from 'maplibre-style-tools/bridge';

const connection = connectMapLibreBridge(map, {
  mapId: 'demo-map',
  url: 'ws://127.0.0.1:7788',
  token: processSuppliedToken,
  capabilities: [
    'style.read', 'style.write', 'features.query', 'runtime.state',
    'assets.write', 'network.load',
  ],
  allowedResourceOrigins: [],
});

await connection.whenReady();
```

Include this stdio bridge command:

```bash
maplibre-style-mcp --stdio \
  --bridge-host 127.0.0.1 \
  --bridge-port 7788 \
  --bridge-origin http://127.0.0.1:5173
```

State that the token is sent in the first WebSocket frame, never in the URL.
Explain that `/bridge` is browser-only and does not export the Node WebSocket
server or live registry.

- [ ] **Step 6: Build and verify interface guides**

```bash
cd website
hugo --cleanDestinationDir --gc --minify --environment production --printPathWarnings --panicOnWarning
test -f public/docs/guides/ai-sdk/index.html
test -f public/zh/docs/guides/mcp/index.html
test -f public/docs/guides/webmcp/index.html
test -f public/zh/docs/guides/bridge/index.html
rg -n "allowMutations|maplibre-style-mcp --stdio|connectMapLibreBridge" public/docs/guides public/zh/docs/guides
```

Expected: all commands exit `0`; English and Chinese retain the same commands, capability identifiers, and safety claims.

- [ ] **Step 7: Run the graph gate and commit**

```bash
cd ..
node .gitnexus/run.cjs detect-changes --scope all --repo .
git add website/content/docs/guides
git commit -m "docs: add interface integration guides"
```

---

### Task 6: Write the Public Contract Reference

**Files:**
- Create: bilingual `package-entry-points`, `cli`, `capability-contracts`, `results-and-errors`, and `limits-and-safety` pages under `website/content/docs/reference/`

**Interfaces:**
- Consumes: `package.json`, all eight public entry modules, CLI and MCP tests, capability schemas, `STYLE_TOOL_ERROR_CODES`, and exported limit constants.
- Produces: lookup-oriented reference pages whose identifiers and numeric defaults are direct compatibility claims.

- [ ] **Step 1: Verify the red content state**

```bash
test -f website/content/docs/reference/package-entry-points.md
test -f website/content/docs/reference/cli.md
test -f website/content/docs/reference/capability-contracts.md
test -f website/content/docs/reference/results-and-errors.md
test -f website/content/docs/reference/limits-and-safety.md
```

Expected: each command exits `1`.

- [ ] **Step 2: Write Package Entry Points peers**

Use weight `10` and a table with exactly these package specifiers and roles:

| Specifier | Role |
| --- | --- |
| `maplibre-style-tools` | Non-AI convenience exports |
| `maplibre-style-tools/core` | Pure validation, transactions, GeoJSON, analysis, and discovery |
| `maplibre-style-tools/maplibre` | Live MapLibre mutation, runtime commands, and bounded feature queries |
| `maplibre-style-tools/capabilities` | Five executors, schemas, registry, result envelope, and authorities |
| `maplibre-style-tools/ai` | AI SDK tool factory over an in-process map |
| `maplibre-style-tools/webmcp` | Browser-native page-scoped Site tools |
| `maplibre-style-tools/mcp` | MCP server, sessions, transports, resources, and live extension |
| `maplibre-style-tools/bridge` | Browser-safe live map client, protocol, hashing, and resource policy |

Use this completed ambient/runtime table and verify every row against
`package.json` and its public `index.ts` before commit:

| Specifier | DOM ambient | Node ambient | Runtime dependency |
| --- | ---: | ---: | --- |
| root | No | No | Pure core only |
| `/core` | No | No | None |
| `/maplibre` | Yes | No | In-process MapLibre map |
| `/capabilities` | No | No | Caller-provided authorities |
| `/ai` | Through dependencies | Yes | AI SDK and in-process map |
| `/webmcp` | Yes | No | Browser `document.modelContext` and in-process map |
| `/mcp` | No | Yes | Node MCP host and optional bridge server |
| `/bridge` | Yes | No | Browser map and protected WebSocket endpoint |

- [ ] **Step 3: Write CLI Reference peers**

Use weight `20`. Start with the exact help surface:

```text
maplibre-style validate STYLE
maplibre-style inspect STYLE [OPTIONS]
maplibre-style apply STYLE --operations OPERATIONS [OPTIONS]
```

Document inspect options `--query`, `--type`, `--source`, `--source-layer`, `--layer`, `--source-id`, `--source-layers`, and `--analyze-geojson`. Document apply options `--dry-run`, `--output`, `--in-place`, and `--backup`. State that `-` may replace one input but both inputs cannot use stdin. Include exit codes `0` success, `1` valid request rejected by semantics, `2` argument/input/JSON error, and `3` output/internal failure.

- [ ] **Step 4: Write Capability Contract peers**

Use weight `30` and include this exact matrix:

| Capability | Input type | Success data | Runtime | AI SDK | MCP | WebMCP | CLI |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `inspectStyle` | `InspectStyleInput` | `InspectionProjection` | No | Yes | Yes | Default | `inspect`; `validate` covers validation actions |
| `applyStyleTransaction` | `ApplyStyleTransactionInput` | `StyleMutationReceipt` | No | Yes | Yes | `allowMutations` | `apply` |
| `applyStyleDocument` | `ApplyStyleDocumentInput` | `StyleMutationReceipt` | No | Yes | Yes | `allowMutations` | No |
| `runMapCommand` | `RunMapCommandInput` | `MapCommandReceipt` | Yes | Yes | Yes | `allowMutations` | No |
| `queryMapFeatures` | `QueryMapFeaturesInput` | `FeatureQueryProjection` | Yes | Yes | Yes | Default | No |

State that WebMCP mutation tools are opt-in and MCP additionally exposes
session management.

- [ ] **Step 5: Write Results and Errors peers**

Use weight `40`. Include the `CapabilityResult<TData>` union from Task 2 and list exactly:

```text
INVALID_INPUT
STYLE_INVALID
NOT_FOUND
CONFLICT
DEPENDENCY_CONFLICT
UNSUPPORTED_SOURCE
REVISION_CONFLICT
MAP_NOT_READY
BRIDGE_DISCONNECTED
CAPABILITY_DENIED
IO_ERROR
TIMEOUT
INTERNAL
```

Document `StyleToolError` fields `code`, `message`, optional RFC 6901 `path`, and optional JSON `details`. Distinguish validation/semantic failures from I/O and operational failures.

- [ ] **Step 6: Write Limits and Safety peers**

Use weight `50` and include this verified defaults table:

| Boundary | Default or maximum |
| --- | ---: |
| Style JSON | 5 MiB |
| Semantic diff | 1 MiB |
| Operations per transaction | 100 |
| Inline GeoJSON | 5 MiB |
| GeoJSON features | 100,000 |
| Coordinate positions | 1,000,000 |
| Geometry depth | 16 |
| Property depth | 32 |
| Feature query | 100 features and 1 MiB serialized |
| Runtime list | 300 default, 500 maximum |
| Bridge message | 5 MiB |
| MCP message | 5 MiB default, 64 MiB configurable maximum |
| MCP request ID | 256 bytes |
| MCP method | 128 bytes |
| MCP resource URI | 8 KiB |
| Style session ID | 512 bytes |
| HTTP bearer token | 4 KiB |

Explain strict schemas, bounded result projection, transaction atomicity, revision conflict detection, loopback defaults, bearer/origin validation, and resource policy admission. Do not claim that remote GeoJSON is fetched by `analyzeGeoJson`; it returns `available: false` with reason `remote-url`.

- [ ] **Step 7: Build and verify the reference**

```bash
cd website
hugo --cleanDestinationDir --gc --minify --environment production --printPathWarnings --panicOnWarning
test -f public/docs/reference/package-entry-points/index.html
test -f public/zh/docs/reference/limits-and-safety/index.html
rg -n "CAPABILITY_DENIED|64 MiB|maplibre-style-tools/webmcp" public/docs/reference public/zh/docs/reference
```

Expected: all commands exit `0`; both languages contain the same entry points, error codes, numbers, and CLI syntax.

- [ ] **Step 8: Run the graph gate and commit**

```bash
cd ..
node .gitnexus/run.cjs detect-changes --scope all --repo .
git add website/content/docs/reference
git commit -m "docs: add public contract reference"
```

---

### Task 7: Write Maintainer and Contribution Documentation

**Files:**
- Create: bilingual `repository-structure`, `ambient-types`, `verification`, and `contributing` pages under `website/content/docs/development/`

**Interfaces:**
- Consumes: repository directories, TypeScript project references, `package.json` scripts, AGENTS repository overrides, and contribution links.
- Produces: a focused maintainer path that does not expose internal design specifications.

- [ ] **Step 1: Verify the red content state**

```bash
test -f website/content/docs/development/repository-structure.md
test -f website/content/docs/development/ambient-types.md
test -f website/content/docs/development/verification.md
test -f website/content/docs/development/contributing.md
```

Expected: each command exits `1`.

- [ ] **Step 2: Write Repository Structure peers**

Use weight `10`. Document `src/core`, `src/adapters/maplibre`, `src/capabilities`, `src/ai`, `src/mcp`, `src/webmcp`, `src/bridge`, `src/cli`, `examples`, `scripts`, and `website`. Include the architecture rule that interfaces project shared capability contracts instead of reimplementing semantics.

- [ ] **Step 3: Write Ambient Types peers**

Use weight `20` and this exact table:

| Area | Allowed ambient types |
| --- | --- |
| `/core` | ES only; no DOM or Node |
| `/maplibre`, `/webmcp`, browser `/bridge` | DOM allowed; Node forbidden |
| `/mcp`, `/ai` | Node allowed where required |

State that public declaration closure is tested and that generic refactors must not leak ambient types across these boundaries.

- [ ] **Step 4: Write Verification peers**

Use weight `30`. Document these exact commands and purposes:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run test:example:ai-chat
pnpm run test:example:bridge
pnpm run test:example:webmcp
pnpm run check:package
pnpm run verify:e2e
```

Add the website checks:

```bash
cd website
go mod verify
hugo --cleanDestinationDir --gc --minify --environment production --printPathWarnings --panicOnWarning
```

- [ ] **Step 5: Write Contributing peers**

Use weight `40`. State surgical-change expectations, public-contract caution,
the existing `node:test` infrastructure, the ESM-only `tsc -b` build, and the
requirement to preserve package formats and testing frameworks. Link to
`https://github.com/mapseekai/maplibre-style-tools/issues` and
`https://github.com/mapseekai/maplibre-style-tools/blob/main/CHANGELOG.md`; do
not link to `docs/superpowers/`.

- [ ] **Step 6: Build and verify Development pages**

```bash
cd website
hugo --cleanDestinationDir --gc --minify --environment production --printPathWarnings --panicOnWarning
test -f public/docs/development/ambient-types/index.html
test -f public/zh/docs/development/verification/index.html
rg -n "pnpm run verify:e2e|Node forbidden|node:test" public/docs/development public/zh/docs/development
```

Expected: all commands exit `0` and no internal design-plan route is present.

- [ ] **Step 7: Run the graph gate and commit**

```bash
cd ..
node .gitnexus/run.cjs detect-changes --scope all --repo .
git add website/content/docs/development
git commit -m "docs: add maintainer documentation"
```

---

### Task 8: Replace the WebMCP-Only Pages Workflow with One Combined Deployment

**Files:**
- Create: `.github/workflows/deploy-pages.yml`
- Delete: `.github/workflows/deploy-webmcp.yml`

**Interfaces:**
- Consumes: Task 1 Hugo Module, Task 7 completed content, existing `build:example:webmcp`, Oink Starter GitHub Pages workflow, and GitHub Pages repository configuration.
- Produces: `.tmp/pages/index.html` for Oink and `.tmp/pages/webmcp/index.html` for the unchanged WebMCP example; a single Pages deployment artifact.

- [ ] **Step 1: Reproduce the current collision risk**

```bash
rg -n "upload-pages-artifact|meta http-equiv" .github/workflows/deploy-webmcp.yml
test -f .github/workflows/deploy-pages.yml
```

Expected: the first command finds the WebMCP-only artifact and root redirect; the second exits `1`.

- [ ] **Step 2: Create the combined workflow**

Use `apply_patch` to create `.github/workflows/deploy-pages.yml` exactly as follows:

```yaml
name: deploy-pages

on:
  pull_request:
    paths:
      - website/**
      - examples/webmcp/**
      - src/**
      - scripts/**
      - package.json
      - pnpm-lock.yaml
      - .github/workflows/deploy-pages.yml
  push:
    branches: [main]
    paths:
      - website/**
      - examples/webmcp/**
      - src/**
      - scripts/**
      - package.json
      - pnpm-lock.yaml
      - .github/workflows/deploy-pages.yml
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages-${{ github.ref }}
  cancel-in-progress: true

env:
  HUGO_VERSION: 0.165.0
  GOWORK: off
  HUGO_MODULE_WORKSPACE: off
  HUGO_CACHEDIR: ${{ github.workspace }}/.hugo_cache

jobs:
  build:
    name: Build Pages artifact
    runs-on: ubuntu-latest
    steps:
      - name: Check out source
        uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - name: Set up pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.10.0

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install package dependencies
        run: pnpm install --frozen-lockfile

      - name: Build WebMCP example
        run: pnpm run build:example:webmcp
        env:
          WEBMCP_BASE: /maplibre-style-tools/webmcp/

      - name: Set up Go
        uses: actions/setup-go@v7
        with:
          go-version-file: website/go.mod
          cache-dependency-path: website/go.sum

      - name: Configure GitHub Pages
        id: pages
        uses: actions/configure-pages@v6

      - name: Install Hugo Extended
        run: |
          curl --fail --location --silent --show-error \
            --output "${RUNNER_TEMP}/hugo.deb" \
            "https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-amd64.deb"
          sudo dpkg -i "${RUNNER_TEMP}/hugo.deb"

      - name: Download Oink
        working-directory: website
        run: go mod download github.com/pgsty/oink

      - name: Build documentation
        working-directory: website
        run: |
          hugo --cleanDestinationDir --gc --minify --environment production \
            --printPathWarnings --panicOnWarning \
            --baseURL "${{ steps.pages.outputs.base_url }}/"

      - name: Assemble Pages artifact
        run: |
          rm -rf .tmp/pages
          mkdir -p .tmp/pages
          cp -R website/public/. .tmp/pages/
          mkdir -p .tmp/pages/webmcp
          cp -R examples/webmcp/dist/. .tmp/pages/webmcp/

      - name: Verify Pages entry points
        run: |
          test -f .tmp/pages/index.html
          test -f .tmp/pages/zh/index.html
          test -f .tmp/pages/llms.txt
          test -f .tmp/pages/navigation.json
          test -f .tmp/pages/webmcp/index.html

      - name: Upload Pages artifact
        if: github.event_name != 'pull_request'
        uses: actions/upload-pages-artifact@v5
        with:
          path: .tmp/pages

  deploy:
    name: Deploy
    if: github.event_name != 'pull_request'
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Publish
        id: deployment
        uses: actions/deploy-pages@v5
```

- [ ] **Step 3: Remove the old workflow**

Use `apply_patch` to delete `.github/workflows/deploy-webmcp.yml`. Confirm no other workflow uploads a Pages artifact:

```bash
rg -n "upload-pages-artifact|deploy-pages" .github/workflows
```

Expected: only `.github/workflows/deploy-pages.yml` contains those actions.

- [ ] **Step 4: Reproduce the workflow locally through artifact assembly**

Run each command from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run build:example:webmcp
cd website
go mod verify
hugo --cleanDestinationDir --gc --minify --environment production --printPathWarnings --panicOnWarning
cd ..
rm -rf .tmp/pages
mkdir -p .tmp/pages
cp -R website/public/. .tmp/pages/
mkdir -p .tmp/pages/webmcp
cp -R examples/webmcp/dist/. .tmp/pages/webmcp/
test -f .tmp/pages/index.html
test -f .tmp/pages/zh/index.html
test -f .tmp/pages/llms.txt
test -f .tmp/pages/navigation.json
test -f .tmp/pages/webmcp/index.html
```

Expected: all commands exit `0`; the root contains Oink rather than the former redirect; `/webmcp/` contains the existing example build.

- [ ] **Step 5: Run the graph gate and commit**

```bash
node .gitnexus/run.cjs detect-changes --scope all --repo .
git add .github/workflows/deploy-pages.yml .github/workflows/deploy-webmcp.yml
git commit -m "ci: unify GitHub Pages deployment"
```

Expected: the commit contains one workflow addition and one deletion; no example or runtime source file changes.

---

### Task 9: Run Full Verification and Bilingual Reader Testing

**Files:**
- Modify only pages where verification or reader testing identifies a concrete factual or clarity defect.

**Interfaces:**
- Consumes: the complete site and workflow from Tasks 1–8.
- Produces: verified repository behavior, a warning-clean site, a complete combined artifact, and reader-tested English and Chinese documentation.

- [ ] **Step 1: Run module and strict site verification**

```bash
cd website
go mod verify
hugo --cleanDestinationDir --gc --minify --environment production --printPathWarnings --panicOnWarning
test -f public/index.html
test -f public/zh/index.html
test -f public/llms.txt
test -f public/zh/llms.txt
test -f public/navigation.json
test -f public/zh/navigation.json
test -f public/docs/index.md
test -f public/zh/docs/index.md
test -f public/_print/docs/index.html
test -f public/zh/_print/docs/index.html
rg --files -g 'offline-search-index*.json' public
test ! -e public/blog
test ! -e public/book
test ! -e public/fr
```

Expected: every command exits `0`; Hugo prints no warning or error.

- [ ] **Step 2: Run the repository's full verification surface**

```bash
cd ..
pnpm run verify
pnpm run test:example:webmcp
pnpm run verify:e2e
```

Expected: typecheck, lint, unit tests, package contract, AI-chat example, browser bridge example, WebMCP example, and both E2E suites pass.

- [ ] **Step 3: Check public facts against source**

Run:

```bash
node dist/cli/main.js --help
rg -n '"\./(core|maplibre|capabilities|ai|webmcp|mcp|bridge)"' package.json
rg -n "inspectStyle|applyStyleTransaction|applyStyleDocument|runMapCommand|queryMapFeatures" src/capabilities/registry.ts
rg -n "INVALID_INPUT|CAPABILITY_DENIED|INTERNAL" src/core/errors.ts
rg -n "5 \* 1024 \* 1024|1 \* 1024 \* 1024|DEFAULT_MAX_OPERATIONS" src/core/utf8.ts
```

Compare those outputs to the built reference pages. Correct any mismatch in both languages and rerun Steps 1–2 after edits.

- [ ] **Step 4: Run English reader questions with a fresh agent**

Give a fresh reader only `website/content/` and ask these exact questions:

1. Which package entry point should a browser-only consumer use for page-scoped AI tools?
2. How do the five capabilities remain consistent across AI SDK, MCP, WebMCP, and CLI?
3. How can a user inspect a Style without mutating it?
4. What happens when one operation in a transaction fails?
5. When should the browser bridge be used instead of in-process AI tools?
6. What default limits apply to Style JSON, diffs, operations, GeoJSON, feature queries, bridge messages, and MCP messages?

Expected: answers identify `/webmcp`, the shared registry, `inspectStyle` or CLI inspect, atomic rejection, the cross-process live-map use case, and every numeric default without relying on outside knowledge.

- [ ] **Step 5: Run Chinese reader questions with a separate fresh agent**

Give a different fresh reader only the `.zh.md` pages and ask Chinese translations of the same six questions. Expected answers must match the English facts and preserve identifiers and numbers exactly.

- [ ] **Step 6: Run ambiguity and consistency review**

Ask a third fresh reader to report:

- undefined internal terminology;
- conflicting interface recommendations;
- claims not supported by a public contract;
- missing English/Chinese page peers or headings;
- absolute links that escape `/maplibre-style-tools/`;
- references to Blog, Book, French, `docs/superpowers/`, or sample project content.

Apply only evidence-backed corrections, then rerun Tasks 9 Steps 1–3 and the failed reader question.

- [ ] **Step 7: Verify the final diff and commit reader fixes when present**

```bash
git diff --check
node .gitnexus/run.cjs detect-changes --scope all --repo .
git status --short
```

If reader testing changed files, stage only those bilingual page pairs and commit:

```bash
git add website/content
git commit -m "docs: resolve documentation review gaps"
```

If no files changed, do not create an empty commit.

---

### Task 10: Approval-Gated Deployment Verification

**Files:**
- No repository files unless deployment reveals a reproducible site defect; fix such defects in the owning earlier task and rerun all relevant gates.

**Interfaces:**
- Consumes: clean local commits and the combined Pages workflow.
- Produces: verified public routes at the approved GitHub Pages URL.

- [ ] **Step 1: Stop and request explicit push authorization**

Report the commit list and local verification evidence. Do not push until the user authorizes `git push origin main`.

- [ ] **Step 2: Push after authorization and wait for the Pages workflow**

```bash
git push origin main
PAGES_RUN_ID=$(gh run list --workflow deploy-pages.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$PAGES_RUN_ID" --exit-status
```

Expected: the workflow concludes successfully and the deployment job reports the GitHub Pages URL.

- [ ] **Step 3: Verify representative public routes**

```bash
curl --fail --location https://mapseekai.github.io/maplibre-style-tools/
curl --fail --location https://mapseekai.github.io/maplibre-style-tools/zh/
curl --fail --location https://mapseekai.github.io/maplibre-style-tools/docs/
curl --fail --location https://mapseekai.github.io/maplibre-style-tools/llms.txt
curl --fail --location https://mapseekai.github.io/maplibre-style-tools/navigation.json
curl --fail --location https://mapseekai.github.io/maplibre-style-tools/webmcp/
```

Expected: every request returns a successful response; the root is the Oink site and `/webmcp/` remains the existing example.

- [ ] **Step 4: Perform a final browser smoke test**

Open the deployed English and Chinese home pages. Verify language switching, local search, dark mode, Docs navigation, one code page, one print route, Markdown alternate links, and the WebMCP example route. Record any failure with its exact route and browser console evidence before changing files.
