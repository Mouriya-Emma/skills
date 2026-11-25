---
alwaysApply: true
---

# 没有端到端 runtime 验证 = 没做

凡被人、agent 或自动化消费的代码、配置、prompt、skill、脚本、CI、依赖或部署改动，未经实际 runtime 验证不得称完成。类型检查、build、lint、mock 单测、review 和历史经验只能辅助。

## 验证路径

- 优先从真实用户入口或测试版本触发本次行为，观察 UI、DB、文件、消息或下游最终结果；否则使用接近生产的集成测试。
- **Web 必须走真实用户路径：** 启动本地 dev server 或使用目标环境，按 `ego-browser` skill 操作浏览器，以真实用户身份完成登录、进入功能、操作、提交和结果/持久化核对；关键节点检查页面、接口及 DB/下游副作用。首页探活、单页 smoke、单接口或 curl 不能替代。
- 沙箱 dry-run 仅在沙箱即真实运行环境时算端到端验证。
- issue 树内的 child 按它声明的测试形态验证，整棵树的端到端验证由同一棵树的总体验收 issue 承担（见 `writing-complex-issues`）；单个 issue 和不走 issue 流程的直接改动，仍按本节做完整的 runtime 验证。
- 委派真实 runtime e2e（PTY、沙箱、浏览器或独立验收）给子代理时，按 `subagent-delegation` 规则选择能启动真实运行会话的档位，不交给只做只读核查的轻量档位。

## 交付证据

- 报告在哪里跑了什么、观察到什么、为何证明本次改动正确，并附可复现命令、输出、截图、日志或响应；由子代理执行的验证，必须先按 `subagent-delegation` 规则读取子代理的执行记录，核对实际执行的命令、改动与输出后再引用，进度标签和未核实的自述不算证据。
- 失败后修复并重跑完整相关路径，不只验证最后修的点。
- 无法验证时明确“已改，未完成 runtime 验证”，说明环境限制及可执行的验证位置和方法，不隐瞒缺口或无说明地转交用户。
- 按 `git` 规则的 GitHub issue / PR routing 走 issue→PR；runtime 证据按 `writing-pr` 由 `ghc`（`gh-contract` skill）采集，以证据包发布到 PR，Web UI 改动的截图经 `ghc` 进入证据包；本地验证不能替代交付。
