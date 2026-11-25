---
name: ci-status-is-not-merge-evidence
description: "Never inspect CI run results or describe CI as a merge gate; merge decisions rest only on ghc acceptance evidence"
condition: ["gh run (list|view)[^\\n]{0,160}(conclusion|--json jobs)", "check-runs/[^\\n]{0,80}/annotations", "CI ?门禁[^\\n]{0,12}没(有)?(真正)?(跑|执行)"]
scope: ["tool:bash", "text"]
---

CI 的结果不决定 PR 能不能合并。CI 是绿是红、有没有跑，结论都一样。

- **合并依据**：只看 issue 的验收证据，即每条验收行都有 `ghc ev run` 记录，且 `ghc ev check` 显示齐全。满足就合并，不满足就补证据。
- **不查 CI**：不要为了判断能否合并去看 CI 的运行结果、失败日志或注释。
- **不把 CI 说成门禁**：向用户汇报时，不要把 CI 称为「门禁」，也不要说「合并时 CI 门禁没跑」，好像合并少了一道关。
- **CI 跑不起来时**：例如账户计费阻断、runner 为空，这属于外部故障。在 PR 里记一句事实就停下，不重跑，不观察，也不当作完成前提。
- **汇报合并依据**：写证据包链接和 `ghc ev check` 的结果，不写 CI 状态。