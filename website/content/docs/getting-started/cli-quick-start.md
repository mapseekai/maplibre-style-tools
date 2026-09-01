---
title: CLI Quick Start
description: Validate, inspect, and safely rewrite a style file from your terminal.
weight: 40
---

The `maplibre-style` CLI works on local style files with no network access, using the same validation and transactions as the library.

## Validate a file

```bash
maplibre-style validate style.json
```

Every command writes exactly one JSON result to stdout:

```json
{ "success": true, "message": "…", "data": { "…": "…" } }
```

Diagnostics go to stderr, so you can pipe stdout straight into `jq`.

## Inspect what is inside

```bash
maplibre-style inspect style.json --query road
maplibre-style inspect style.json --layer road-primary
maplibre-style inspect style.json --source-layers
```

Search layers by text, read one layer, or list the source layers in use. All options are in the [CLI reference](../../reference/cli/).

## Preview a change

Describe your edits in a JSON operations file, then preview what they would do:

```bash
maplibre-style apply style.json --operations operations.json --dry-run
```

`--dry-run` writes nothing. You get the mutation receipt and a semantic diff of the changes.

## Apply it

```bash
maplibre-style apply style.json --operations operations.json --output next-style.json
```

Nothing happens silently: `--output` refuses to overwrite an existing file, `--in-place` is the only way to modify the input file, and `--in-place --backup` preserves the original as `style.json.bak`.

Exit codes: `0` success, `1` the request was valid but the style or transaction rejected it, `2` bad arguments or input, `3` output or internal failure. Details in the [CLI reference](../../reference/cli/).
