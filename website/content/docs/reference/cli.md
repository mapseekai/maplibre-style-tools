---
title: CLI Reference
description: Look up commands, options, stdin rules, mutation safeguards, and exit codes.
weight: 20
---

The `maplibre-style` executable exposes three commands and writes JSON result envelopes to stdout. Diagnostics go to stderr.

## Command surface {#command-surface}

```text
maplibre-style validate STYLE
maplibre-style inspect STYLE [OPTIONS]
maplibre-style apply STYLE --operations OPERATIONS [OPTIONS]
```

`validate` validates one Style document. `inspect` projects selected Style information. `apply` validates and applies a JSON array of Style operations.

## Inspect options {#inspect-options}

| Option | Meaning |
| --- | --- |
| `--query QUERY` | Filter layers by text query |
| `--type TYPE` | Filter layers by layer type |
| `--source SOURCE` | Filter layers by source, or scope `--source-layers` |
| `--source-layer SOURCE_LAYER` | Filter layers by source layer |
| `--layer LAYER_ID` | Get one layer |
| `--source-id SOURCE_ID` | Get one source |
| `--source-layers` | List referenced source layers |
| `--analyze-geojson SOURCE_ID` | Analyze one GeoJSON source |

`--layer`, `--source-id`, `--source-layers`, and `--analyze-geojson` are mutually exclusive exact modes. Exact modes cannot be combined with search filters, except that `--source-layers` may be scoped by `--source`.

## Apply options {#apply-options}

| Option | Meaning |
| --- | --- |
| `--dry-run` | Return the receipt and diff without writing |
| `--output FILE` | Write the resulting Style to a new file |
| `--in-place` | Atomically replace the Style input file |
| `--backup` | Preserve the original as `.bak`; requires `--in-place` |

`--output` and `--in-place` are mutually exclusive. `--dry-run` cannot be combined with file-output options. `--in-place` requires `STYLE` to be a file path, and `--backup` refuses to overwrite an existing backup.

## Stdin rules {#stdin-rules}

`-` may replace one input path. It may stand for `STYLE` on any command or for `OPERATIONS` on `apply`, but `STYLE` and `OPERATIONS` cannot both use stdin. An stdin-backed Style cannot be used with `--in-place`.

## Mutation safeguards {#mutation-safeguards}

`apply` produces no file mutation unless the capability transaction succeeds. `--dry-run` leaves the input untouched. `--output` creates a separate file, while `--in-place` uses atomic replacement and can preserve the original bytes with `--backup`.

## Exit codes {#exit-codes}

| Code | Meaning |
| ---: | --- |
| `0` | Success |
| `1` | Valid request rejected by semantics |
| `2` | Argument, input, or JSON error |
| `3` | Output or internal failure |

A code `1` result is a structured capability failure. Code `3` also covers failures that occur while committing or acknowledging file output; read stderr before deciding whether a write can be retried.
