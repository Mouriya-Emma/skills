---
name: no-ci-as-smoke-or-e2e-venue
description: "Never use CI as a smoke/e2e venue (no reruns or watches to obtain test results); keep e2e out of normal test and CI gates"
condition: ["gh run rerun", "\\brun_watch\\b", "gh workflow run", "gh pr checks[^\"]*--watch", "run:\\s*npm run (smoke|e2e|test:e2e)", "\\\"test[^\\\"]*\\\":\\s*\\\"[^\\\"]*\\b(e2e|smoke)\\b"]
scope: "tool"
---

CI 不是冒烟测试或 e2e 的运行场所。

- 不要为了拿到测试结论去重跑、观察或手动触发 CI（`gh run rerun`、`run_watch`、`gh workflow run`、`gh pr checks --watch`）。冒烟测试和 e2e 在本地或目标环境中单独手动运行，证据用 `ghc ev run` 记录。
- CI 不是合并门禁。CI 无法运行（例如账单或计费阻断）属于外部故障：查清故障边界后就停止，不重跑，不追问用户，不把它当作完成的前提。
- 不要把 e2e 或冒烟测试加进常规测试脚本（`test`、`test:*`）或 CI workflow 的步骤里。e2e 必须单独、手动运行。
- 发现 CI workflow 或常规测试脚本里已经有 smoke 或 e2e 步骤时，这就是违规，必须立即清理：在同一个改动里删除该步骤，并把它改为文档化的手动运行入口。