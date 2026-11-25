---
alwaysApply: true
---

# git worktree（omp）

- 在 main/master 上工作时发现另一个 agent 干扰，调用 omp 的 `wt` 工具切换 git worktree。
- 受托处理 issue 且当前在 main 上时，用 `wt` 工具自动创建 worktree 并在里面工作。
