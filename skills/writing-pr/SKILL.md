---
name: writing-pr
description: 起草或修复 open PR 的 closing link、实现说明和重试评论，并用 ghc 采集、发布证据包；无代码变更 PR 用要点模板；实施前用 ghc ev plan 确定要采集的证据。
---

# writing-pr

PR 承载实现说明与证据：正文说明 diff 怎样兑现 issue 的原因、结果与契约；证据由 `skill://gh-contract` 的 `ghc` 采集，作为证据包 comment 发在 PR 上。问题、Why、范围和 checkpoint 在 `skill://writing-issue`，裁决在 `skill://review-pr`。遵从 `~/.claude/rules/git.rule.md` 的「GitHub issue / PR routing rule」，更严的 repo-local 流程优先。

PR 用哪个模板由它关闭的 issue 决定，不混用：关闭「无代码变更」issue 的用「无代码变更 PR 模板」，其余用「PR body 模板」并发布证据包。总体验收 issue 不经 PR 关闭。

## PR 身份与正文

- 一个 PR 关一个真实 issue；多个独立问题拆开，单一连贯 refactor 可跨子系统。umbrella 工作关所实现的 child，不关 parent。
- 第一行 `Closes #<N>`（同仓库）或 `Closes <owner>/<repo>#<N>`（跨仓库）；`Fixes` / `Resolves` 等价。PR 不作 sub-issue，closing keyword 是它连接 issue 的机制。
- 中文标题和正文；固定 token、代码、路径、命令与工具原样输出不翻译。摘要 1–3 句写改了什么；实现怎样做写在「实现说明」，不复制 issue 的业务 Why，不逐文件复述 diff。conventional-commit 前缀仅在 repo 已有惯例时用。
- 只修改 open PR。重试续用原 branch/PR：实现变化后同步更新正文的实现说明，在新 HEAD 上重新采集并发布证据包，再另发 PR-thread 评论。已合并记录及后续缺陷按全局路由处理。

## 实现说明（标准 PR）

回答「这个 diff 为什么能解决 issue 写明的原因」。按变更实际相关的项写，没有的项不写，不填标签：

- **不变边界**：改动只作用于部分人群、入口或状态时，写哪些不受影响，以及靠哪个符号、分支条件或类型把它们挡在改动之外；对应 issue 的 `[保持]` 结果时注明结果编号。改动全局生效时不写。
- **机制**：改在哪个责任单元、用了什么机制、它怎样消除 issue 写明的原因而非只压住症状；关键实现附文件 + 符号或 diff 锚点。私有算法修复即使不碰共享契约，也要说清关键机制。
- **契约**：维护或改变的契约落在哪个符号（owner PR 写明，供消费者引用）；消费的契约如何使用、未在本地扩展或重定义；不涉及共享契约就不写。
- **切换**：同步迁移的调用方、删除的旧路径与兜底；留下未迁移的写原因与承接 issue。
- **阅读入口**：diff 同时含中心逻辑与机械改动时，指出核心改动所在和哪些是机械跟随，给 reviewer 阅读顺序；单部件小改不写。
- **实现选择与偏离**：issue 留给实现者的选择，写所选方案与理由；实际比较过两个及以上方案时写成下表，一个分叉一行，列与 issue「决策」表相同：

  | 分叉 | 裁决 | 依据 | 被否方案及否决理由 |
  |---|---|---|---|
  | <issue 留给实现者的选择> | <采用的方案> | <代码现状、既有惯例或实测数据> | <方案：否决理由> |

  改变操作员结果或跨单元契约的偏离不能在 PR 自行放行：PR 已存在时在 PR thread 提出，由 issue 契约更正或裁决后再实现。
- **未验证与风险**：已知未覆盖的路径、推断出而未观察的行为，明确标为未验证，不写成观察。

部署过程、事故经过和采集条件不写进实现说明；采集条件由证据记录本身携带。

## 证据（标准 PR）

证据的作用是让实现者自证每个验收行都真的跑过，所以 PR 开出时就要齐全。

1. 实施前跑 `ghc ev plan <issue>`：按 issue 的影响范围、测试形态和验收表列出每行要采集的步骤。
2. 逐行用 `ghc ev run <issue> --row N [--step S] -- <命令>` 采集，Command 列能逐字跑就逐字跑。截图类步骤加 `--artifacts <目录>`，命令产出的截图自动上传；已有截图用 `ghc ev attach`。改动前截图在 base 提交的干净检出上采集。
3. 契约命令有 typo 或过时时，先在 issue 明确更正契约（issue 修订后旧记录对新契约失效），再重新采集；不默默改命令后声称原行通过。review 期间不能由实现者为迎合实现自行改写验收契约。
4. 先提交再采集：工作区有未提交的 tracked 改动时 `ghc` 拒绝采集，HEAD 变了就在新 HEAD 上重跑。不手写输出、不挪用别次输出，正文不贴日志或截图。
5. `ghc ev check <issue>` 退出码为 0 才开 PR；它列出的缺失、过期、无效行就是待办。

运行强度按 `~/.claude/rules/runtime-verification-required.rule.md`：Web 用 `skill://ego-browser` 完整执行真实用户路径，经 `ghc` 采集截图；首页探活、单接口 curl 或 spec 名称不能替代它。mock、stub、fake、in-memory 或实现者本次自写的测试不能充当覆盖行的观察；套件计数、CI 绿勾、typecheck/lint/build 只属于卫生行。历史反例见 [acceptance-cases.md](../writing-issue/references/acceptance-cases.md)。

真实验证受阻时：属于本 PR 的问题先修；外部 blocker 用 `skill://writing-issue` 发布并写解除条件，确需操作员独有判断才提问。缺凭据先按 `credentials-from-owning-source` 规则查拥有方的 secret store 与本机既有凭据来源，不向用户索要 token。没有证据不宣称 ready；确实无法解除的阻塞在 PR thread 写明「验收行 #N 阻塞——<原因> + <blocker issue 链接 / 已提出的问题>」，交 reviewer 裁决，证据包里该行如实显示为缺失。

## PR body 模板

```markdown
Closes <owner>/<repo>#<N>

## 摘要

<1–3 句改动结果。>

## 实现说明

<不变边界、机制、契约、切换、阅读入口、实现选择与偏离、未验证与风险中实际相关的项。>
```

正文不写证据、日志、截图、卫生检查或分析段，`ghc lint <PR>` 把这类段落报为错误。

## 无代码变更 PR 模板

讲清这次改了什么、为什么这样调整、增加与减少了什么。每段用无序列表，一个 bullet 概括一个要点：写思路与语义变化（新增了哪条规则、收窄了哪个边界、删掉了什么机制及原因），不按文件或行复述 diff，不贴改前改后原文，不写「修改了 X 文件第 N 行」。兑现某条预期结果的要点末尾标 `（结果 N）`，每条结果都要有。diff 只能改 issue「范围」里列出的文件；需要多改文件时先改 issue 的「范围」。

```markdown
Closes <owner>/<repo>#<N>

## 摘要

<1–3 句：这次文档更新解决 issue 的什么问题。>

## 做了什么

- <一项改动的概括：哪份文档的哪部分语义变了，以及同步核对了哪些关联文档>（结果 1）

## 调整思路

- <为什么这样改：原有内容的问题或矛盾、依据、取舍与被否方案>

## 增加

- <新增的规则、概念、流程或章节要点>

## 减少

- <删除或收窄的内容，以及删减的原因；无则写「无」>
```

## 创建与发布

```bash
ghc ev check <issue>        # 标准 PR：退出码 0 才继续
git push -u origin <branch>
gh pr create --repo <owner>/<repo> --title "<中文标题>" --body-file <body-file>
ghc lint <PR>               # 身份与模板；无代码变更另查范围、链接与结果标注
ghc ev publish <PR>         # 发布证据包或无代码变更检查，并写 evidence/complete 状态
```

`ghc lint` 非零时检查 issue 身份、keyword 拼写与跨 repo 前缀，open PR 用 `gh pr edit <number> --repo <owner>/<repo> --body-file <body-file>` 修正后重跑。没有 `addClosingIssueReference` mutation；合并后不修 body。`ghc ev publish` 非零时按输出补采后重发；它发现疑似凭据会拒绝发布，换成不打印凭据的命令重新采集。

## 重试评论模板（标准 PR）

```markdown
## 重试意图

本次重试处理 <review comment URL>，续用 <issue 链接> 的现有 branch / PR。
计划动作：<收窄的改动或契约更正 + 验证命令>

## 实现变化

<本次重试改变了哪些不变边界、机制、契约或切换，正文的实现说明已同步；未改实现则写「无」。>

## 证据

HEAD <sha> 的证据包：<ghc ev publish 输出的 comment 链接>
```

只更正了 issue 的命令拼写、没改实现时，写明实现 commit 与 PR 正文不变、契约已更正，在当前 HEAD 按更正后的命令重新采集并发布。普通讨论无需套模板。

无代码变更 PR 的重试评论写「重试意图」（处理哪条 review comment、续用哪个 PR），再按无代码变更模板的「做了什么 / 调整思路 / 增加 / 减少」用无序列表概括本次重试的变化；同步更新 PR 正文，重跑 `ghc lint <PR>` 与 `ghc ev publish <PR>`。

## 发布前核对

`ghc lint <PR>` 与 `ghc ev publish <PR>` 退出码都是 0。再核对程序判断不了的：diff 单一连贯；实现说明与当前 HEAD 一致并对得上 issue 写明的原因；观察事实、推断与未验证项分开写，不把预期写成观察；blocked 状态诚实。无代码变更 PR 另核对：四段都是要点概括而非 diff 复述；要点与当前 HEAD 一致，没有漏掉实质语义变化。
