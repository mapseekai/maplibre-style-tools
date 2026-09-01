---
title: CLI Reference
description: Commands, options, stdin rules, mutation safeguards, and exit codes.
weight: 20
---

`maplibre-style` has three commands. Every command writes one JSON result envelope to stdout and diagnostics to stderr.

## Commands

```text
maplibre-style validate STYLE
maplibre-style inspect STYLE [OPTIONS]
maplibre-style apply STYLE --operations OPERATIONS [OPTIONS]
```

`validate` checks one style document. `inspect` projects the parts you ask for. `apply` validates and applies a JSON array of style operations.

## Inspect options

| Option | Effect |
| --- | --- |
| `--query QUERY` | Filter layers by text query |
| `--type TYPE` | Filter layers by layer type |
| `--source SOURCE` | Filter layers by source, or scope `--source-layers` |
| `--source-layer SOURCE_LAYER` | Filter layers by source layer |
| `--layer LAYER_ID` | Get one layer |
| `--source-id SOURCE_ID` | Get one source |
| `--source-layers` | List referenced source layers |
| `--analyze-geojson SOURCE_ID` | Analyze one inline GeoJSON source |

`--layer`, `--source-id`, `--source-layers`, and `--analyze-geojson` are mutually exclusive exact modes and cannot combine with search filters — except that `--source-layers` may be scoped by `--source`.

## Apply options

| Option | Effect |
| --- | --- |
| `--dry-run` | Return the receipt and diff without writing anything |
| `--output FILE` | Write the resulting style to a new file |
| `--in-place` | Atomically replace the input file |
| `--backup` | Preserve the original as `.bak`; requires `--in-place` |

`--output` and `--in-place` are mutually exclusive. `--dry-run` cannot combine with file-output options, `--in-place` requires `STYLE` to be a file path, and `--backup` never overwrites an existing backup.

## Stdin rules

`-` replaces exactly one input path — the `STYLE` on any command, or the `OPERATIONS` on `apply`. One invocation cannot read both from stdin, and an stdin-backed style cannot be used with `--in-place`.

## Mutation safeguards

`apply` changes no file unless the transaction succeeds. `--dry-run` leaves the input untouched. `--output` creates a separate file, `--in-place` replaces the input atomically (write to a same-directory temp file, sync, rename, sync), and `--backup` keeps the original bytes as `.bak`.

If a write commits and a later step fails, the CLI says so on stderr — an exit code `3` does not mean nothing was written, so check the destination before retrying.

## Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | Success |
| `1` | Valid request rejected by style or transaction semantics |
| `2` | Argument, input, or JSON error |
| `3` | Output or internal failure |
