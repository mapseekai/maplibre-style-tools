---
title: CLI Quick Start
description: Validate, inspect, and preview a Style transaction from the command line.
weight: 40
---

Use the `maplibre-style` binary with local JSON Style and operations files. It uses the same strict core transactions as the library.

## Validate {#validate}

```bash
maplibre-style validate style.json
```

## Inspect {#inspect}

```bash
maplibre-style inspect style.json --query road
```

## Preview a transaction {#preview-a-transaction}

```bash
maplibre-style apply style.json --operations operations.json --dry-run
```

`--dry-run` reports the candidate without writing it.

## Write intentionally {#write-intentionally}

```bash
maplibre-style apply style.json --operations operations.json --output next-style.json
```

`apply` does not mutate the input unless `--in-place` is explicit. `--output` never overwrites an existing path, and `--backup` never replaces a pre-existing backup.
