---
title: CLI 参考
description: 命令、选项、stdin 规则、写入保护与退出码。
weight: 20
---

`maplibre-style` 有三条命令。每条命令向 stdout 写出一个 JSON 结果信封，诊断信息走 stderr。

## 命令

```text
maplibre-style validate STYLE
maplibre-style inspect STYLE [OPTIONS]
maplibre-style apply STYLE --operations OPERATIONS [OPTIONS]
```

`validate` 校验一个样式文档；`inspect` 投影你要的部分；`apply` 校验并应用一个 JSON 样式操作数组。

## inspect 选项

| 选项 | 作用 |
| --- | --- |
| `--query QUERY` | 按文本搜索图层 |
| `--type TYPE` | 按图层类型过滤 |
| `--source SOURCE` | 按源过滤图层，或限定 `--source-layers` 范围 |
| `--source-layer SOURCE_LAYER` | 按 source-layer 过滤图层 |
| `--layer LAYER_ID` | 读取单个图层 |
| `--source-id SOURCE_ID` | 读取单个源 |
| `--source-layers` | 列出引用的 source-layer |
| `--analyze-geojson SOURCE_ID` | 分析一个内联 GeoJSON 源 |

`--layer`、`--source-id`、`--source-layers`、`--analyze-geojson` 是互斥的精确模式，不能与搜索过滤器组合 —— 例外：`--source-layers` 可以用 `--source` 限定范围。

## apply 选项

| 选项 | 作用 |
| --- | --- |
| `--dry-run` | 只返回回执和 diff，不写任何文件 |
| `--output FILE` | 把结果样式写到新文件 |
| `--in-place` | 原子替换输入文件 |
| `--backup` | 把原文件保留为 `.bak`；需要 `--in-place` |

`--output` 与 `--in-place` 互斥。`--dry-run` 不能与任何文件输出选项组合；`--in-place` 要求 `STYLE` 是文件路径；`--backup` 绝不覆盖已存在的备份。

## stdin 规则

`-` 只能替代一个输入路径 —— 任何命令的 `STYLE`，或 `apply` 的 `OPERATIONS`。一次调用不能两个输入都走 stdin；走 stdin 的样式也不能配合 `--in-place`。

## 写入保护

事务不成功，`apply` 不动任何文件。`--dry-run` 不碰输入；`--output` 创建独立文件；`--in-place` 原子替换（写同目录临时文件、sync、rename、sync 目录）；`--backup` 把原始字节保留为 `.bak`。

如果文件已提交、后续步骤才失败，CLI 会在 stderr 上说明 —— 退出码 `3` 不代表什么都没写，重试前先检查目标文件。

## 退出码

| 码 | 含义 |
| ---: | --- |
| `0` | 成功 |
| `1` | 请求合法，但被样式或事务语义拒绝 |
| `2` | 参数、输入或 JSON 错误 |
| `3` | 输出或内部故障 |
