---
name: iac-projects
description: 定位个人基础设施的 IaC repo（homelab-tf、pve-vctcn、nekoringo-iac）：VM/CT、网络、DNS、mesh、存储、根信任、Komodo 安装，以及按归属判据留在 IaC 的 app；从 app 或 workload 上下文把基础设施需求交给 IaC repo 的 issue 写法。归 km 的 app 不走这里。
---

# iac-projects：IaC repo 路标

IaC 只管机器和平台：VM/CT 生命周期、磁盘、网卡、主机基线（含 Docker 引擎、主机 DNS 与 mesh）、网络与 DNS、公网入口对象、根信任、Komodo Core 与 Periphery 的安装，以及按 `personal-infra-routing` 规则的归属判据必须留在 IaC 的 app。其余 app 归 km（`km` skill），不在 IaC 里声明。

本 skill 只是路标。定位到 repo 后先读它的 `AGENTS.md`，跟着它指向的 rules/skills 走；记忆与 repo 现行文档冲突时以文档为准。

## repo

### homelab-tf：家庭 LAN

- 本地 `/Users/mouriya/Ext/code/homelab-tf`；GitHub `mouriya-s-lab/homelab-tf`。
- 单台 Proxmox host，家庭 LAN `192.168.1.67`，ISP NAT 之后。OpenTofu workspace 管 CT/VM；`<app>/` 下是 Ansible role submodule（各自独立 git repo，parent 跟踪指针）。
- 入口 `AGENTS.md`，之后 `.claude/rules/` 与 `.claude/skills/`（IaC 变更任务入口是 repo skill `iac-deploy`）。

### pve-vctcn：OVH 云主机与公网边缘

- 本地 `/Users/mouriya/Ext/code/pve-vctcn`；GitHub `mouriya-s-lab/pve-vctcn`。
- 单台 OVH 裸金属 Proxmox host `192.99.9.212`，单公网 IP NAT；guest 内网 `172.16.1.0/24` 于 `vmbr1`；SSH key-only。OpenTofu workspace 在 `apps/` 下管 VM，与手工 guest（如 NPM CT 171）共存。没有 Ansible。
- 入口 `AGENTS.md`（指向 `CLAUDE.md`），之后 `.claude/rules/`、`.claude/skills/`（IaC 变更任务入口同样是 `iac-deploy`）；规则与 homelab-tf 各自独立。

### nekoringo-iac

`mouriya-s-lab/nekoringo-iac`：Nekoringo 专用主机与它的 Komodo Core（`apps/komodo`），不属 homelab 或 vctcn。

## 跨 repo 不变量

- 两个 repo 的 OpenTofu state 是不同对象：共用 Cloudflare R2 bucket `homelab-tf`，homelab-tf 用 key `<workspace>/terraform.tfstate`，pve-vctcn 用 `pve-vctcn/<workspace>/...`。PVE provider 凭据、各自的 SOPS 文件、Ansible inventory（仅 homelab-tf 有）互不共享。
- homelab PVE 已入 NetBird mesh（`pve.mouriya.lan`），vctcn PVE（`192.99.9.212`）未入；不能从 guest 可达推断 PVE host 的状态。
- GARM runner 经 NetBird mesh 伸进 homelab 做 CI/CD：控制器在 pve-vctcn VM 181，执行端是 VM 181 上的常驻 LXD，或常驻满时操作员笔记本上的边缘 Incus，各自经所在主机的 NetBird peer 出网。runner 在 homelab 侧所见的变更按对象归属：homelab DNS 记录归 homelab-tf；NetBird policy、ACL 与 nameserver group 是 NetBird SaaS dashboard/API 的 live 状态，两个 repo 都没有 IaC provider，改前先读 live policy，改动记录在对应 homelab-tf issue。runner workspace 在 pve-vctcn 不改变这些归属。
- 根信任服务 Step-CA（CT 313）留在 homelab；vctcn 服务需要时经 NetBird 使用。OpenBao（CT 314）已退役停机。没有 homelab-tf issue 与设计，不把根信任外移。

## 从 app 或 workload 上下文提基础设施需求

在 app repo、workload repo、外部 agent 或普通对话里，没有加载 IaC repo 的 rules 时：

- 可以做非机密调查，写 app 的运行契约，在 IaC repo 开 issue 并双向链接。
- 不改 IaC 文件，不跑 apply/destroy、IaC playbook 或主机变更操作，不直接改 Proxmox、DNS、网络、存储、根信任或 Komodo 安装。

先用归属判据把工作拆开：app 的 compose、镜像、Variable、发布归 km 与 workload repo，不开 IaC issue；只有机器、网络、DNS、公网入口、存储、根信任、Komodo 安装、或判据留在 IaC 的 app 才进 IaC issue。issue 按 `writing-issue` 写，至少包括：

- 驱动方：app repo、issue/PR 或用户请求；
- 服务用途、入站调用方和流量形态、出站依赖；
- 持久化与备份预期，secret 的用途与来源（不写值）；
- app 一侧固定的约束及理由、范围外；
- 尚未决定、阻止实施的事实，以及由谁、凭什么证据决定。

没有外部硬约束或现行声明证据时，不替 IaC repo 指定 VMID、hostname、端口、NetBird ACL 或存储布局；已知的 app 监听口、health 接口和已有资源身份要写清。决定之后把 body 改成可执行契约。

`iac:deploy` label 会被 github-agent-router 自动派给 IaC repo 里的 agent 执行。只给可直接执行的基础设施工作加这个 label；只想记录、讨论或暂不执行的 issue 不加。

已在 IaC repo 里并加载了它的 rules 时，按 repo 自己的流程实施；用户明确要求跨 repo 端到端修复时，逐个进入每个 repo 按它的规则完成，不以开 issue 代替完成。凭据按 `credentials-from-owning-source` 规则取，不让用户粘贴。
