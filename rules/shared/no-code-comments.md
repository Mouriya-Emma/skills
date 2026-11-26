---
alwaysApply: true
---

# 代码里不写注释

禁止在代码中写注释。

只允许留下功能性标注，比如特殊的检查用标注，或者特殊错误处理标注。

本规则不适用于基础设施与运维（devops）仓库：`personal-infra-routing` 所指的 homelab-tf、pve-vctcn 和 workload repo（homelab-apps、homelab-trading 等），以及 IaC 与 CI 基础设施仓库（OpenTofu/Ansible 工作区、CI 共用 workflow 与 action、runner 基础设施）。这些仓库里可以写注释，已有注释不删。
