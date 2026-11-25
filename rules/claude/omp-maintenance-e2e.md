---
paths:
  - "/**/{omp,.omp,omp-*,*-omp,*-omp-*}/**"
---

# 维护 omp 系列：Claude Code 中的 e2e 入口与派工

- **入口：** 需要交互终端时经 `tern` skill 在 Tern pane 中运行 `omp`，用 `tern send` 输入 prompt、`tern capture --surfaces` 读渲染输出；只有交互覆盖不了的场景才用 `omp -p`。
- **子代理：** 委派真实 `omp` 会话或独立验收时按 `subagent-delegation` 规则派工；汇报子代理结论前先读它的 transcript。
