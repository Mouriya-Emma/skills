---
alwaysApply: true
---

# 子代理派工与执行记录（Claude Code）

- **档位：** 委派真实 runtime e2e（PTY、沙箱、浏览器或独立验收）给子代理（`Agent` 工具）时，子代理沿用会话模型（`model: inherit`，仅获用户明确指定时换模型），不交给只做只读核查的轻量模型。
- **隔离：** 需要独立工作区的子代理，在子代理定义的 frontmatter 写 `isolation: worktree`，由 Claude Code 自动创建和删除 worktree。
- **执行记录：** 引用子代理的结论或回答状态追问前，先读它的 transcript（`~/.claude/projects/<project>/<session-id>/subagents/agent-<id>.jsonl`），核对实际执行的命令、改动与输出；后台任务用 Read 读它的输出文件。子代理自报的进度不是证据。
- **终止：** 子代理或后台任务偏离任务时，用 `TaskStop` 终止。
