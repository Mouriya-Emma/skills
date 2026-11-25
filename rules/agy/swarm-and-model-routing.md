---
alwaysApply: true
description: "Global rules for Swarm parallel workspaces and model routing across Argon, Neon, and Hydrogen."
---

# Swarm 与多模型分工规范

## 并行写代码与调度方式

- 日常编排不要使用 `invoke_subagent`，应使用 `swarm`，并将任务拆分为细粒度、高并发的工作单元并行推进。
- 多 worker 并行写代码时，必须使用 `workspace: "share"`。

## 模型职责分工

模型简称对应 `agy models` 中的精确模型 ID 与显示名（按需选择思考档位）：

| 简称 | 显示名 | 精确模型 ID（`agy models`） | 适用职责 |
|---|---|---|---|
| `hydrogen` | `Gemini 4 Hydrogen` | `gemini-4-hydrogen-low` / `gemini-4-hydrogen-medium` / `gemini-4-hydrogen-high` / `gemini-4-hydrogen-xhigh` | 调查与小规模代码任务（优先将任务拆分到它也能独立完成的粒度） |
| `neon` | `Gemini 4 Neon` | `gemini-4-neon-low` / `gemini-4-neon-medium` / `gemini-4-neon-high` / `gemini-4-neon-xhigh` | 大型、复杂且只能由单个 worker/subagent 完成的代码任务 |
| `argon` | `Gemini 4 Argon` | `gemini-4-argon-low` / `gemini-4-argon-medium` / `gemini-4-argon-high` | 意图分析、设计分析、重要决策 |

- **工具传参区分：**
  - `swarm`（`add` / `model`）与 `agy --model`：直接传入上表中的精确模型 ID 或显示名（以 `swarm` 的 `models` 动作返回为准）。
  - `invoke_subagent`（仅在明确需要或无法使用 `swarm` 时）：`Model` 参数仅支持 `inherit` / `flash_lite` / `flash` / `pro` 四个档位枚举，不接受 `hydrogen` / `neon` / `argon` 模型名；其中 `flash_lite` 运行时路由到 `gemini-3.5-flash-lite`，并非 `Gemini 4 Hydrogen`。

## Argon 禁止执行约束

- **`Gemini 4 Argon`（`gemini-4-argon-*`）禁止参与任何执行类任务。**
- 当当前模型为 `Gemini 4 Argon` 时，所有执行、代码实现、命令运行、文件修改等实操任务，必须通过 `swarm` 交给其他模型（选用 `gemini-4-hydrogen-*` 或 `gemini-4-neon-*`）完成，主会话仅负责分析、拆分、决策与协调。
