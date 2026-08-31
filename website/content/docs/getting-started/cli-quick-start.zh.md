---
title: CLI 快速开始
description: 从命令行验证、检查并预览样式事务。
weight: 40
---

将 `maplibre-style` 二进制程序用于本地 JSON Style 与操作文件。它使用与库相同的严格核心事务。

## 验证 {#validate}

```bash
maplibre-style validate style.json
```

## 检查 {#inspect}

```bash
maplibre-style inspect style.json --query road
```

## 预览事务 {#preview-a-transaction}

```bash
maplibre-style apply style.json --operations operations.json --dry-run
```

`--dry-run` 返回变更收据和可选的语义差异，但不会写入文件。它绝不会返回完整的候选 Style 或 `data.style`。

## 有意地写入 {#write-intentionally}

```bash
maplibre-style apply style.json --operations operations.json --output next-style.json
```

除非明确提供 `--in-place`，否则 `apply` 不会修改输入文件。`--output` 绝不会覆盖现有路径，`--backup` 也绝不会替换已存在的备份。
