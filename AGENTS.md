<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **maplibre-style-tools** (4263 symbols, 11321 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/maplibre-style-tools/context` | Codebase overview, check index freshness |
| `gitnexus://repo/maplibre-style-tools/clusters` | All functional areas |
| `gitnexus://repo/maplibre-style-tools/processes` | All execution flows |
| `gitnexus://repo/maplibre-style-tools/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |
| Work in the Mcp area (283 symbols) | `.claude/skills/generated/mcp/SKILL.md` |
| Work in the Bridge area (276 symbols) | `.claude/skills/generated/bridge/SKILL.md` |
| Work in the Maplibre area (207 symbols) | `.claude/skills/generated/maplibre/SKILL.md` |
| Work in the Ai-sdk area (108 symbols) | `.claude/skills/generated/ai-sdk/SKILL.md` |
| Work in the Operations area (94 symbols) | `.claude/skills/generated/operations/SKILL.md` |
| Work in the Cli area (67 symbols) | `.claude/skills/generated/cli/SKILL.md` |
| Work in the E2e area (35 symbols) | `.claude/skills/generated/e2e/SKILL.md` |
| Work in the Cluster_246 area (25 symbols) | `.claude/skills/generated/cluster-246/SKILL.md` |
| Work in the Scripts area (22 symbols) | `.claude/skills/generated/scripts/SKILL.md` |
| Work in the Cluster_243 area (15 symbols) | `.claude/skills/generated/cluster-243/SKILL.md` |
| Work in the Engine area (13 symbols) | `.claude/skills/generated/engine/SKILL.md` |
| Work in the Cluster_194 area (12 symbols) | `.claude/skills/generated/cluster-194/SKILL.md` |
| Work in the Cluster_250 area (12 symbols) | `.claude/skills/generated/cluster-250/SKILL.md` |
| Work in the Cluster_201 area (11 symbols) | `.claude/skills/generated/cluster-201/SKILL.md` |
| Work in the Cluster_245 area (11 symbols) | `.claude/skills/generated/cluster-245/SKILL.md` |
| Work in the Cluster_249 area (11 symbols) | `.claude/skills/generated/cluster-249/SKILL.md` |
| Work in the Cluster_247 area (8 symbols) | `.claude/skills/generated/cluster-247/SKILL.md` |
| Work in the Cluster_248 area (8 symbols) | `.claude/skills/generated/cluster-248/SKILL.md` |
| Work in the Cluster_202 area (6 symbols) | `.claude/skills/generated/cluster-202/SKILL.md` |
| Work in the Cluster_258 area (6 symbols) | `.claude/skills/generated/cluster-258/SKILL.md` |

<!-- gitnexus:end -->
