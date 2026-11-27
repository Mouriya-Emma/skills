---
name: tern-orchestration
description: >-
  Use Tern sessions and panes to orchestrate work across DIFFERENT agent harnesses
  or external interactive CLIs (e.g., launching Codex from omp, or Claude Code /
  Gemini CLI from another harness) and collect their results back.
  ONLY for cross-harness orchestration: NEVER use this inside a single harness
  for tasks its own subagents or swarm can run natively. For Tern GUI testing,
  headless `tern serve`, or `shot` screenshot evidence, use the `tern` skill instead.
---

# Tern 跨 Harness 编排（Cross-Harness Orchestration）

参照 Orca `orchestration` 思路，用 Tern 的真实窗口会话守护进程（session daemon）跨 harness 启动外部 agent、等待完成并回收结果。

## 强边界：何时用、何时严禁用

- **允许使用（仅限跨 harness）：**
  - 当前在 A harness（如 `omp`、Antigravity、Claude Code），需要调度 **B harness**（如 `codex`、`claude`、`gemini` 或其他独立 CLI agent）执行任务、做独立 review 并拿回结果。
  - 需要把多个**不同 harness** 放到独立 Tern 窗格/会话中并行执行并汇总结论。
- **严禁使用（harness 内部禁止）：**
  - **禁止在当前 harness 内部用 `tern` 再起同款 harness** 来替代原生的 subagent / swarm / 并行工具。
  - 搜索、读文件、单 harness 内的代码拆分、多角度 review 等，一律留在当前 harness 原生机制内完成。
- **职责区分：**
  - 涉及 `tern serve`、`tern ctl --file`、UI 截图采证、Luau 插件或 CSS 热加载，改用 `tern` skill，不走本 skill。

---

## 与 Orca 编排的核心差异

Tern 是终端与浏览器复用器，**没有** Orca 的内置 mailbox、`worktree` 管理器或事件自动唤醒（wake）：

| 能力 | Orca `orchestration` | Tern 编排 |
|---|---|---|
| 进程与窗格 | `orca worktree` / `orchestration worker-start` | `tern new session` / `tern new tab` / `tern split` |
| 发任务 / 交互 | `orchestration send`（信箱） | 启动参数、`tern run`、`tern send ... paste\|text\|keys` |
| 等完成 | Orca 主动唤醒 | 显式调用 `tern wait BLOCK --until exit\|prompt\|idle=MS --timeout SEC` |
| 读结果 | `agent read` / `worker_done` | `tern capture BLOCK [--scrollback] [--surfaces] [--json]` |
| 代码隔离 | 自动建 child worktree | 需要写隔离时先手动 `git worktree add`，再传 `--cwd DIR` |

---

## 前置条件与窗口定位

1. **必须有运行中的真实 Tern 窗口（session daemon）：**
   `tern serve`（无头模式）**不起** session daemon，无法使用 `ls` / `new` / `wait` / `capture`。
   先用 `tern ls --json` 确认可连通，并用 `tern inspect --json` 观察现有窗口与会话。
2. **窗口选择：**
   所有会话命令默认作用于当前 `$TERN_PANE` 所在窗口（否则 `$TERN_WINDOW_KEY`，否则第一个窗口）。多窗口环境下显式传 `--window KEY`（`tern inspect` 会显示窗口 key，第一个窗口为空串 `--window ""`）。
3. **写代码隔离：**
   - 只读任务（代码审查、分析、只读调研）：可直接共用当前 `--cwd`。
   - 会修改文件的任务、或并行多个写手：先用 `git worktree` 建独立目录，再将该路径传给 `--cwd DIR`。

---

## 编排标准流程

### 1. 准备任务 Spec（避免 shell 转义与 heredoc 卡死）

- 多行或复杂任务说明先用文件工具写入 `/tmp/tern-orch-<id>.md`（或目标 CLI 支持的 prompt 文件），**严禁使用 `<<` heredoc 或 `<<<` here-string**。
- 每个 spec 必须自包含：目标、允许/禁止修改的范围、约束条件、以及完成后需要输出或落盘的证据路径。

### 2. 启动跨 Harness Worker

优先使用独立 session 或 tab，避免打扰用户当前聚焦的窗格：

```bash
# 新建独立会话运行一次性（non-interactive / print）模式的外部 harness
tern new session "codex-review" --cwd /abs/path/to/work --keep-open -- \
  codex exec "$(cat /tmp/tern-orch-spec.md)" --json

# 或在当前/指定会话中开新 tab 或 split
tern new tab --cwd /abs/path/to/work --keep-open -- claude -p "..."
tern split @focused right --cwd /abs/path/to/work --keep-open -- ...
```

参数说明：
- `--keep-open`：默认程序退出码为 `0` 时 block 会自动关闭；编排场景**务必加 `--keep-open`**，否则来不及 `capture` 输出就被销毁。
- `--end-on-success`：仅当你明确不需要事后读终端屏幕（例如产物已约定写到文件）时使用。
- 所有启动命令加 `--json`，记录返回的 `block` id（和 `session` 名），后续全部用精确 `BLOCK` id 操作，不要用容易重名的标题或程序名。

**并行扇出：** 多个独立跨 harness worker 应在一条命令或同一轮并发启动（建议每批不超过 4 个），分别记录各自的 `BLOCK` id。

### 3. 向已运行的交互式 Harness 派发输入

若启动的是交互式 TUI（而非单次命令），用 `tern send` 投递内容，不要依赖 `tern run` 直接拼接复杂字符串：

```bash
# 粘贴多行文本后发回车（括号粘贴更安全）
tern send "$BLOCK" paste "$(cat /tmp/tern-orch-spec.md)" --json
tern send "$BLOCK" keys Return --json
```

### 4. 等待完成（有界等待）

根据目标 harness 的运行形态选择等待条件，**必须显式设置 `--timeout`**：

```bash
# 1. 一次性非交互命令（如 codex exec / claude -p）：等进程退出
tern wait "$BLOCK" --until exit --timeout 300 --json

# 2. 交互式 shell / REPL：等回到提示符
tern wait "$BLOCK" --until prompt --timeout 180 --json

# 3. 交互式 TUI agent：等输出静默（如连续 3000ms 无新输出）
tern wait "$BLOCK" --until idle=3000 --timeout 300 --json
```

- `tern wait` 超时退出码为 `124`。
- 超时后先 `tern process "$BLOCK" --json` 和 `tern capture` 检查进度，再决定继续等待、发送中断（`tern send "$BLOCK" keys Ctrl-c`）或终止，不要无限循环死等。

### 5. 回收结果与验证

```bash
# 读取文本输出（含回滚历史）
tern capture "$BLOCK" --scrollback --json

# 若目标 harness 使用了 Tern 原生 TSP surface（如 omp），必须加 --surfaces
tern capture "$BLOCK" --surfaces --scrollback --json

# 核对进程状态与退出码
tern process "$BLOCK" --json
```

- `idle=MS` 只代表屏幕暂时停止变化，**不等于任务成功**；必须结合 `capture` 实际输出、约定产物文件或 `process` 退出状态判定结果。
- 需要持续观察多个 worker 状态变更时，可用 `tern events --filter ...`（带超时或按需中断）。

### 6. 清理现场

结果回收完毕后及时清理编排创建的临时资源（不要误关用户原有的窗格）：

```bash
# 关闭单个 block
tern close "$BLOCK"

# 关闭整个临时编排 session（注意：tern kill 只接受 session <SESSION>）
tern kill session "codex-review"
```

---

## 常见错误与禁令

1. **禁止 `tern kill <BLOCK>`**：`tern kill` 只接受 `tern kill session <SESSION>`；关闭单个 pane/block 必须用 `tern close <BLOCK>`。
2. **禁止漏掉 `--keep-open`**：未加 `--keep-open` 时，子命令一旦成功退出（exit 0），block 会立即关闭导致 `capture` 找不到目标。
3. **禁止漏掉 `--surfaces`**：对运行在 Tern TSP surface 上的程序（如 `omp`）执行 `tern capture` 时，不加 `--surfaces` 会漏掉主界面文本。
4. **禁止越界接管用户窗格**：不要对用户正在交互的原有窗格执行 `send`、`run`、`focus` 或 `close`；只操作本次编排新建的 `session` / `tab` / `block`。
5. **禁止在 harness 内部滥用**：能用当前 harness 原生 subagent / swarm 解决的任务，不要拉起 `tern` 编排。
