---
title: CLI 参考
description: 查询命令、选项、stdin 规则、写入保护与退出码。
weight: 20
---

`maplibre-style` 可执行文件公开三个命令，并将 JSON 结果封装写入 stdout。诊断信息写入 stderr。

## 命令表面 {#command-surface}

```text
maplibre-style validate STYLE
maplibre-style inspect STYLE [OPTIONS]
maplibre-style apply STYLE --operations OPERATIONS [OPTIONS]
```

`validate` 验证一个 Style 文档。`inspect` 投影选定的 Style 信息。`apply` 验证并应用一个由 Style 操作组成的 JSON 数组。

## Inspect 选项 {#inspect-options}

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

`--layer`、`--source-id`、`--source-layers` 与 `--analyze-geojson` 是互斥的精确模式。精确模式不能与搜索筛选器组合，但 `--source-layers` 可以用 `--source` 限定范围。

## Apply 选项 {#apply-options}

| Option | Meaning |
| --- | --- |
| `--dry-run` | Return the receipt and diff without writing |
| `--output FILE` | Write the resulting Style to a new file |
| `--in-place` | Atomically replace the Style input file |
| `--backup` | Preserve the original as `.bak`; requires `--in-place` |

`--output` 与 `--in-place` 互斥。`--dry-run` 不能与文件输出选项组合。`--in-place` 要求 `STYLE` 是文件路径，而 `--backup` 会拒绝覆盖已有备份。

## Stdin 规则 {#stdin-rules}

`-` 可以替代一个输入路径：它可以在任意命令中代表 `STYLE`，也可以在 `apply` 中代表 `OPERATIONS`，但 `STYLE` 与 `OPERATIONS` 不能同时使用 stdin。来自 stdin 的 Style 不能与 `--in-place` 一起使用。

## 写入保护 {#mutation-safeguards}

只有能力事务成功时，`apply` 才可能修改文件。`--dry-run` 不会改动输入。`--output` 创建独立文件；`--in-place` 使用原子替换，并可通过 `--backup` 保留原始字节。

## 退出码 {#exit-codes}

| Code | Meaning |
| ---: | --- |
| `0` | Success |
| `1` | Valid request rejected by semantics |
| `2` | Argument, input, or JSON error |
| `3` | Output or internal failure |

退出码 `1` 表示结构化能力失败。退出码 `3` 也覆盖提交文件输出或写入确认时发生的失败；决定能否重试写入前应先读取 stderr。
