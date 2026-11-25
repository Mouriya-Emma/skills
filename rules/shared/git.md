---
alwaysApply: true
---

# GIT规范

## GitHub 账号路由

可选 owner：

| Owner | 类型 | 说明 |
|---|---|---|
| **RiriAgent** | 个人账号 | AI agent 专用，日常操作的默认账号 |
| **Mouriya-Emma** | 个人账号 | 操作员本人账号，非特殊情况不使用 |
| **mouriya-s-lab** | org | — |
| **mouriya-devops** | org | 私人 devops 基础设施，优先 IaC：IaC repo、CI 共用 workflow 与 action、runner 及其 canary |
| **Pepgent** | org | AI4S 的 org |
| **oh-my-omp** | org | — |

日常 git/gh 操作使用 **RiriAgent**。未经用户确认不得切到 **Mouriya-Emma**；获准临时切换时，先说明账号和理由，操作后立即切回 RiriAgent，用 `gh auth status` 验证并告知。切回失败则停止 gh 操作并报告。

`/Users/mouriya/Ext/code/` 下以下子目录与 owner 一一对应。仓库位于 `<子目录>/<repo>` 时，owner 就是对应的那一个，创建仓库或 fork 时直接用它，不询问：

| 子目录 | Owner |
|---|---|
| `devops/` | **mouriya-devops** |
| `omomp/` | **oh-my-omp** |
| `pepgent/` | **Pepgent** |

仓库不在上述子目录下时，创建仓库或 fork 前，若用户本轮未指定 owner，必须在正文列出「可选 owner」表的全部 owner 并等其选择；不预设默认值，不用提问工具。

IaC 与 CI 基础设施仓库（OpenTofu/Ansible 工作区、CI 共用 workflow 与 action、runner 基础设施）归 **mouriya-devops**，所以放在 `devops/` 下。app 源码和 Komodo workload repo 不属于这一类。

## 不考虑给上游提 issue

用户不说，禁止考虑给上游提 issue。

## GitHub issue / PR routing rule

- **归属：** Issue 承载问题、范围、原因、ownership、依赖和 blocker；PR 承载实现说明、closing keyword、证据、checks 和 review。
- **关联：** 先有真实 issue 才开 PR，PR body 用 closing keyword 关联；一个 PR 交付一个 issue，独立问题拆分，连贯 refactor 可归同一 issue。issue 树例外：child 的 PR 合入树的缓冲分支，由把缓冲分支合入默认分支的 tree PR 一起关闭树内 issue（见 `delivering-issues`）。
- **技能：** 单 issue 用 `writing-issue`，issue 树用 `writing-complex-issues`，PR 正文与证据用 `writing-pr`，review、重试裁决和关闭条件用 `review-pr`。
- **讨论位置：** PR 出现前反馈放 issue；出现后实现和 review 讨论放 PR thread，不以 issue comment、本地 handoff 或 memory 替代。Issue 主题争议、blocked/skipped/no-code 或 PR 明确作废时回 issue。
- **重试：** 沿用可用的 open PR/branch；closing keyword 缺失或错误则修正 body，证据过时则按 `ghc ev check` 列出的过期项在新 HEAD 上重新采集并发布证据包；review 后另发 PR comment 汇总修改和证据。review 通过之后不再重审、不再重采，只把 base 合入分支后合并。
- **不可变记录：** 不回写已合并 PR；缺陷或 follow-up 新建 issue 和对应 PR。遗漏 closing keyword 时保留缺失关联，或在新 issue/umbrella 散文中引用旧 PR。
- **层级：** 只有 issue 可作 parent/child；PR 不作 sub-issue，不用 `addSubIssue`，只用 closing keyword 连接 issue。追溯性组织放新 issue/umbrella，不改已落地的 PR/issue body。
- PR禁止设置为draft

## 日常规范

回复中提及 GitHub issue/PR 必须附链接。

任何情况下，只要不是有问题的阻塞代码，都应该push，而不是在本机当孤儿

对于工作区：

分为两种情况，第一种情况是不直接处理一个issue，而是直接被用户要求做事。

- 在 main/master 上工作，通常情况禁止新建或切换到其他分支，改动直接提交到 main/master 。
- 当你在main/master 工作发现似乎有另一个agent干扰，应该切换到独立的 git worktree 继续工作，做法见 `git-worktree` 规则。

第二种情况是，被任何人委托处理一个issue，那么必须要有对应的pr。

- 如果在main上，按 `git-worktree` 规则创建一个独立 worktree，并在里面工作，如果已经在worktree，则在当前worktree里工作。

无论那种情况都必须遵守的事情：

* 工作结束时必须停在 main，且全部改动已提交到 main；已在其他分支上产生的改动，须先合并进 main 再切回 main。结束时未切回 main，或改动未合并、未提交到 main，均为重大违规。
* main必须是主分支，如果远程为master，需要改名为main
