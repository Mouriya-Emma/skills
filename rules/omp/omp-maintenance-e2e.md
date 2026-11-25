---
paths:
  - "/**/{omp,.omp,omp-*,*-omp,*-omp-*}/**"
---

# 维护 omp 系列：omp 中的 e2e 入口与派工

- **入口：** 优先用 `exec_command` 以 PTY 模式交互运行 `omp`：输入 prompt，观察渲染输出和落盘副作用。只有 PTY 覆盖不了的场景才用 `omp -p`。跑完关闭 PTY 会话。
- **子代理档位：** 委派真实 `omp` PTY、OrbStack 沙箱或独立验收时，至少用 `task:mid`（仅本轮对话获用户明确允许时可用 `task:high`），禁止交给 `task:free1` 或 `task:low`（二者仅用于不跑真实 `omp` 会话的只读核查）；汇报子代理结论前必须读取并引用 `history://<id>`。
