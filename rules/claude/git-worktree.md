---
alwaysApply: true
---

# git worktree（Claude Code）

- 在 main/master 上工作时发现另一个 agent 干扰，或受托处理 issue 且当前在 main 上时，用 `git worktree add` 创建独立 worktree 并在里面工作。
- 交给子代理的隔离工作，按 `subagent-delegation` 规则用 `isolation: worktree`。
