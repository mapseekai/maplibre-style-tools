---
title: 能力
description: 五个操作、各自需要什么、返回什么。
weight: 30
---

所有接口暴露同样的五个能力。三个作用于样式文档，两个需要实时地图。

| 能力 | 作用 | 需要实时地图 |
| --- | --- | --- |
| `inspectStyle` | 读取或校验样式，返回紧凑投影 | 否 |
| `applyStyleTransaction` | 原子应用一组结构化编辑 | 否 |
| `applyStyleDocument` | 整体替换样式文档 | 否 |
| `runMapCommand` | 对实时地图执行有边界的命令 | 是 |
| `queryMapFeatures` | 查询源要素或已渲染要素，显式截断 | 是 |

## 到处都是同一个结果形状

任何能力、任何接口，都返回同一个信封：

```ts
type CapabilityResult<TData> =
  | { success: true; message: string; data: TData }
  | { success: false; message: string; error: StyleToolError };
```

成功/失败只需写一次处理逻辑，AI SDK、MCP、CLI 通吃。错误码见[结果与错误](../../reference/results-and-errors/)。

## 输入是纯 JSON，严格校验

对象、数组、数字、布尔值按原生 JSON 传，不要序列化成字符串。未知字段会在执行前被拒绝，坏调用以 `INVALID_INPUT` 快速失败，碰不到你的地图。

"有界"也是一个承诺：输入输出都有明确的 schema 与上限（字节、数量、深度），超限的输出会截断并明确标记。具体数值见[限制与安全](../../reference/limits-and-safety/)。

下一步：[安装](../../getting-started/installation/)。
