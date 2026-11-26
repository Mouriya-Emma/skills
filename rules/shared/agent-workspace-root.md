---
alwaysApply: true
---

# agent 只在 /Users/mouriya/Ext/code 下启动

必须遵守工作区：禁止在 `/Users/mouriya/Ext/code` 之外的目录启动 agent 会话。

唯一例外是 omp 按 `git-worktree` 规则创建的 worktree（位于 omp 的 `worktree.base`）：在其中启动和工作不违反本规则。
