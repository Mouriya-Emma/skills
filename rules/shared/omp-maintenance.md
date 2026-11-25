---
paths:
  - "/**/{omp,.omp,omp-*,*-omp,*-omp-*}/**"
---

# 维护 omp 系列

路径中有以 `omp` 为独立片段的目录（`omp-config`、`omp-*` 插件仓库、`oh-my-omp`、`~/.omp`）时，即在维护 omp 系列，适用本规则。运行真实 `omp` 的入口与子代理派工见 `omp-maintenance-e2e` 规则。

## e2e 测试

- **模型：** 用 `--model` 优先选 `futureppo-pool/ernie-5.5-flash-preview`，其次 `futureppo-pool/nemotron-3-ultra-550b-a55b`。`futureppo-pool` 渠道下若模型超过 30 秒仍未回复，必须立即打断并切换其他模型（换上述列表中的下一个，或进入下方回退链），禁止继续等待。仅在 `futureppo-pool` 报鉴权、额度、限流、模型不可用或超 30 秒无响应时，按顺序回退：`opencode-go/deepseek-v4.1-flash` → `anthropic/claude-haiku-5-5`。前一个失败时换下一个，不在同一个模型上反复重试，也不跳过 `futureppo-pool` 直接起手用回退模型。
- **真实入口：** 真实模型 e2e 走真实 `omp` 入口，观察渲染输出和落盘副作用，走真实用户路径；本地 mock provider 仅用于协议或钩子集成测试，不能替代真实模型 e2e。
- **有界：** 开始前写定步骤和结束条件，只覆盖本次改动的入口，命中与不命中各验证一次即可。跑完立即退出 `omp` 并结束本次启动的终端会话和后台进程。不写无限循环，不挂没有截止的 monitor 或轮询，失败后先查清原因再重跑，不自动反复重跑。
