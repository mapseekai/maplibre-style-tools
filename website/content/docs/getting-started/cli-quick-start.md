---
title: CLI Quick Start
description: Validate, inspect, and rewrite a style file from the terminal.
weight: 40
---

The `maplibre-style` CLI works on local style files without network access, using the same validation and transactions as the library.

## Validate a file

```bash
maplibre-style validate style.json
```

Every command writes exactly one JSON result to stdout:

```json
{ "success": true, "message": "…", "data": { "…": "…" } }
```

Diagnostics go to stderr, so stdout can be piped directly into `jq`.

## Inspect a style

```bash
maplibre-style inspect style.json --query road
maplibre-style inspect style.json --layer road-primary
maplibre-style inspect style.json --source-layers
```

Search layers by text, read a single layer, or list the source layers in use. All options are listed in the [CLI reference](../../reference/cli/).

## Preview a transaction

Describe the edits in a JSON operations file, then preview their effect:

```bash
maplibre-style apply style.json --operations operations.json --dry-run
```

`--dry-run` writes nothing. The output is the mutation receipt and a semantic diff of the changes.

## Apply the transaction

```bash
maplibre-style apply style.json --operations operations.json --output next-style.json
```

File writes are guarded: `--output` refuses to overwrite an existing file, `--in-place` is the only way to modify the input file, and `--in-place --backup` preserves the original as `style.json.bak`.

Exit codes: `0` success, `1` the request was valid but rejected by style or transaction semantics, `2` argument or input error, `3` output or internal failure. Details in the [CLI reference](../../reference/cli/).
