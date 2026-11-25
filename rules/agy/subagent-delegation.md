---
alwaysApply: true
---

# 子代理派工与执行记录（AGY）

- **档位：** 委派真实 runtime e2e（PTY、沙箱、浏览器或独立验收）给子代理（`invoke_subagent`）时，保持 `Model: "inherit"`（仅获用户明确指定时才切换其他模型），不将需要启动真实运行会话的端到端验收交给轻量只读模型。日常编排与模型分工按 `swarm-and-model-routing` 规则。
- **执行记录：** 引用子代理的结论或回答状态追问前，先核对子代理的会话日志（`<appDataDir>/brain/<conversation-id>/.system_generated/logs/transcript.jsonl`）或宿主验证信息（如 `BROWSER_HOST_FACTS`）中实际执行的命令、改动与输出；后台任务用 `manage_task` 核实。未经核实的自述不算证据。
- **终止：** 子代理偏离任务时用 `manage_subagents`（`kill`）终止，后台任务用 `manage_task`（`kill`）终止。
