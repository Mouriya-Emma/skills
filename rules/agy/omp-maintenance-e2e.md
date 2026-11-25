---
paths:
  - "/**/{omp,.omp,omp-*,*-omp,*-omp-*}/**"
---

# 维护 omp 系列：AGY 中的 e2e 入口与派工

- **入口：** 用 `omp -p` 或 `omp --mode rpc` 运行真实 `omp`；需要交互终端时经 `tern` skill 在 Tern pane 中运行。
- **子代理：** 委派真实 `omp` 会话或独立验收时按 `subagent-delegation` 规则派工；汇报子代理结论前先读它的 `transcript.jsonl`。
