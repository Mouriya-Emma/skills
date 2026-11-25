---
alwaysApply: true
---

# git worktree（AGY）

- 在 main/master 上工作时发现另一个 agent 干扰，或受托处理 issue 且当前在 main 上时，用 `git worktree add` 创建独立 worktree 并在里面工作。
- 多个 swarm worker 并行写代码时，按 `swarm-and-model-routing` 规则使用 `workspace: "share"`。
