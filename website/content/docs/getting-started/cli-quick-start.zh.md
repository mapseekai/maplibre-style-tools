---
title: CLI 快速上手
description: 在终端里校验、检查、安全地重写样式文件。
weight: 40
---

`maplibre-style` 处理本地样式文件，全程无网络，校验与事务逻辑和库完全一致。

## 校验文件

```bash
maplibre-style validate style.json
```

每条命令向 stdout 恰好写出一个 JSON 结果：

```json
{ "success": true, "message": "…", "data": { "…": "…" } }
```

诊断信息走 stderr，所以 stdout 可以直接管道给 `jq`。

## 看看里面有什么

```bash
maplibre-style inspect style.json --query road
maplibre-style inspect style.json --layer road-primary
maplibre-style inspect style.json --source-layers
```

按文本搜索图层、读取单个图层、列出在用的 source-layer。全部选项见 [CLI 参考](../../reference/cli/)。

## 预览改动

把操作写进 JSON 文件，先预览效果：

```bash
maplibre-style apply style.json --operations operations.json --dry-run
```

`--dry-run` 不写任何文件，只给你变更回执和语义 diff。

## 正式应用

```bash
maplibre-style apply style.json --operations operations.json --output next-style.json
```

CLI 不会给你意外：`--output` 拒绝覆盖已存在的文件；只有 `--in-place` 能修改输入文件；`--in-place --backup` 会把原文件保留为 `style.json.bak`。

退出码：`0` 成功；`1` 请求合法但被样式或事务语义拒绝；`2` 参数或输入错误；`3` 输出或内部故障。详见 [CLI 参考](../../reference/cli/)。
