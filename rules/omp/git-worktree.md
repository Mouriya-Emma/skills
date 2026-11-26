---
alwaysApply: true
---

# git worktree（omp）

- omp 中使用 worktree 只经 omp 进入，入口只有两个：启动前用 omp 的 `worktree` 子命令（`omp worktree add`，别名 `omp wt add`）创建 worktree，再在其中启动 omp；或启动后执行 `/wt`，agent 调用 `wt` 工具即排队执行 `/wt`。
- 禁止手工绕过：不用 `git worktree add`/`remove`、`cd`、脚本或其他工具创建、进入、切换或删除 worktree，不在非 omp 创建的 worktree 中启动 omp。离开 `/wt` 建的 worktree 用 `wt_remove` 工具。
- 在 main/master 上工作时发现另一个 agent 干扰，或受托处理 issue 且当前在 main 上时，经上述入口进入 worktree 并在里面工作。
