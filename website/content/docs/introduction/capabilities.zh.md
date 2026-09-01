---
title: 能力
description: 五个操作、各自需要什么、返回什么。
weight: 30
---

前面提到的每个接口，暴露的都是同样的五个操作。三个作用于样式文档，两个需要挂上实时地图。

| 能力 | 做什么 | 需要实时地图 |
| --- | --- | --- |
| `inspectStyle` | 读取或校验样式，返回紧凑投影 | 否 |
| `applyStyleTransaction` | 原子应用一组结构化编辑 | 否 |
| `applyStyleDocument` | 整体替换样式文档 | 否 |
| `runMapCommand` | 对实时地图执行有边界的命令 | 是 |
| `queryMapFeatures` | 查询源要素或已渲染要素，超出限制会显式截断 | 是 |

## 结果信封

各接口不各搞一套结果格式，所有能力返回的都是同一个结构：

```ts
type CapabilityResult<TData> =
  | { success: true; message: string; data: TData }
  | { success: false; message: string; error: StyleToolError };
```

对 `success` 写一次分支逻辑（成功展示 `data`，失败报告 `error.code` 和 `error.message`），无论调用来自 AI SDK、MCP 还是 CLI，这段代码都是对的。失败时携带的是包自己创建的 `StyleToolError`：一个稳定的机器可读 `code`、一个可选的 RFC 6901 `path` 指向被拒绝的值，以及可选的 JSON `details`。全部错误码见[结果与错误](../../reference/results-and-errors/)。

## 输入与限制

输入是普通的 JSON：对象、数组、数字按原生值传入。schema 是严格的：未知字段会被拒绝，嵌套值不允许编码成字符串。校验发生在任何内容到达你的地图之前，因此一次畸形的模型输出只会产生一条具体的错误，而不是一个损坏的样式。

输出同样有界。schema 和数值上限（字节、数量、深度）约束着返回内容，超过上限的部分会被截断并明确标记，而不是无声地超出上下文窗口。具体数值见[限制与安全](../../reference/limits-and-safety/)。

下一步：[安装](../../getting-started/installation/)。
