---
name: writing-pr
description: 起草或修复 open PR：closing link、实现说明、重试评论；实现完成后用 ghc 逐行采集证据并发布证据包，证据是对真实入口的单条命令或真实会话截图，不用脚本。无代码变更 PR 用要点模板。
---

# writing-pr

PR 承载实现说明与证据：正文说明 diff 怎样兑现 issue 的原因、结果与契约；证据由 `skill://gh-contract` 的 `ghc` 采集，作为证据包 comment 发在 PR 上。问题、范围和验收行在 `skill://writing-issue`，裁决在 `skill://review-pr`。讨论位置与已合并记录的处理按 `~/.claude/rules/git.rule.md` 的「GitHub issue / PR routing rule」，更严的 repo-local 流程优先。

模板由 PR 交付的 issue 决定：「无代码变更」issue 用无代码变更模板，其余用标准模板并发布证据包；把树的缓冲分支合入默认分支的用 tree PR 模板。总体验收 issue 没有自己的 PR，证据发在它上面，由 tree PR 关闭。

## 身份

- 一个 PR 交付一个 issue，正文第一行 `Closes #<N>` 或 `Closes <owner>/<repo>#<N>`。
- base 由 issue 的位置决定，`ghc lint <PR>` 检查：独立 issue 合入默认分支；树内 child 合入缓冲分支 `tree/<树根 owner>-<树根 repo>-<树根编号>`，到 tree PR 合并时才关闭。同一轮的 child 各开一个 PR、指向同一个 head，实现说明只写本 issue 负责的部分。
- 标题和正文用中文；代码、路径、命令与工具输出原样。conventional-commit 前缀仅在 repo 已有惯例时用。
- 只修改 open PR。重试续用原 branch 和 PR：同步更新实现说明，在新 HEAD 上重新采集并发布证据包，再发重试评论。

## 实现说明（标准 PR）

回答「这个 diff 为什么能解决 issue 写明的原因」。只写实际相关的项，不复制 issue 的 Why，不逐文件复述 diff：

- **不变边界**：改动只作用于部分人群、入口或状态时，写哪些不受影响，靠哪个符号、分支条件或类型把它们挡在改动之外；对应 `[保持]` 结果时注明编号。
- **机制**：改在哪个责任单元、用了什么机制、它怎样消除原因而非只压住症状；关键实现附文件 + 符号。
- **契约**：维护或改变的契约落在哪个符号；消费的契约如何使用、没有在本地扩展或重定义。
- **切换**：同步迁移的调用方、删除的旧路径与兜底；未迁移的写原因与承接 issue。
- **阅读入口**：diff 同时含中心逻辑与机械改动时，指出核心改动在哪。
- **实现选择与偏离**：issue 留给实现者的选择写所选方案与理由；比较过两个及以上方案时用 issue 决策表的四列（分叉、裁决、依据、被否方案及否决理由）。会改变操作员结果或跨单元契约的偏离不能在 PR 自行放行：在 PR thread 提出，由 issue 裁决后再实现。
- **未验证与风险**：没覆盖的路径、推断而未观察的行为，明确标为未验证。

## 证据（标准 PR）

验收行只写了观察什么、期望什么。怎样观察由你在实现完成后决定：只有这时才知道结果从哪个入口、用哪条命令能看到。

1. 实现并提交后跑 `ghc ev plan <issue>`：列出每行的观察对象、环境、期望，以及按面和测试形态要交的步骤（如 `iac` 的 preview → apply → readback）。
2. 每个步骤采集一条记录：
   - 命令行能读到的结果：`ghc ev run <issue> --row N [--step S] -- <命令>`。命令是对真实入口的一次直接调用——产品 CLI 的一条子命令、一次 HTTP 请求、控制面或数据库的一次读回——输出里能直接读到 Expect。一条命令同时证明多行时用 `--row N,M`。
   - 界面上的结果：按 `skill://ego-browser` 以真实用户身份操作到该状态并截图，再 `ghc ev attach <issue> --row N --step S <图片>`。改动前截图在 base 提交的干净检出上采集。
3. `ghc ev check <issue>` 退出码 0 才开 PR；它列出的缺失、过期、无效行就是待办。工作区有未提交改动时 `ghc` 拒绝采集，HEAD 变了就在新 HEAD 上重采。

**证据里没有脚本。**

- 不为采集写脚本文件、driver 或一次性测试，也不运行已有的验收脚本。
- 测试套件、lint、build、CI 结果不是覆盖行的证据，只能记在卫生行。
- 一条记录只做观察：对真实入口的调用，以及对其输出的过滤。`ghc ev plan` 没列的准备动作（造数据、起依赖、重建）在记录之外做，不和观察串成一条命令；不同的行也不串成一条链。
- 输出不手写、不挪用别次的；PR 正文不贴日志或截图。

**观察不到时。** 某行按原文观察不到（入口不存在、Expect 与实现后的事实不符）：属于本 PR 的问题先修；确属验收行本身的问题，不改 issue、不改写 Expect 迁就实现，在 PR thread 写「验收行 #N：<观察不到的原因与证据>；建议改为 <…>」，交派工方裁决，该行在证据包里如实缺失，其余行照常采集。外部 blocker 用 `skill://writing-issue` 发布并写解除条件。缺凭据先按 `credentials-from-owning-source` 规则查拥有方的 secret store 与本机既有来源。

这次采集是验收表唯一的一次执行：review 判断证据而不重跑，合并后也不重跑。在哪里采集按 issue 的「测试形态」，不升级；运行强度按 `~/.claude/rules/runtime-verification-required.rule.md`。

## 模板

### 标准 PR

```markdown
Closes <owner>/<repo>#<N>

## 摘要

<1–3 句改动结果。>

## 实现说明

<不变边界、机制、契约、切换、阅读入口、实现选择与偏离、未验证与风险中实际相关的项。>
```

正文不写证据、日志、截图或卫生检查段，`ghc lint <PR>` 把这类段落报为错误。

### 无代码变更 PR

每段用无序列表，一个 bullet 概括一个要点：写思路与语义变化（新增了哪条规则、收窄了哪个边界、删掉了什么及原因），不按文件或行复述 diff，不贴改前改后原文。兑现某条预期结果的要点末尾标 `（结果 N）`，每条结果都要有。diff 只能改 issue「范围」里列出的文件。

```markdown
Closes <owner>/<repo>#<N>

## 摘要

<1–3 句：这次文档更新解决 issue 的什么问题。>

## 做了什么

- <哪份文档的哪部分语义变了，同步核对了哪些关联文档>（结果 1）

## 调整思路

- <原有内容的问题或矛盾、依据、取舍与被否方案>

## 增加

- <新增的规则、概念、流程或章节要点>

## 减少

- <删除或收窄的内容及原因；无则写「无」>
```

### tree PR

树的 child 全部合入缓冲分支、总体验收 issue 的证据包齐全后，在每个涉及的 repo 开一个：head 是缓冲分支，base 是默认分支。它没有自己的实现说明与证据包。

```markdown
Tree <owner>/<repo>#<树根>

## 摘要

<1–3 句：这棵树交付了什么。>

## 关闭

Closes <owner>/<repo>#<N>（<合入缓冲分支的 PR 链接>）
Closes <owner>/<repo>#<总体验收 issue>（证据包 <链接>）
Closes <owner>/<repo>#<树根>
```

逐行 `Closes` 该 repo 里全部未关闭的树内 issue，树根所在 repo 的那个还关闭树根。合并前提用 `ghc merge-ready <树根> --tree`；树根之外的 repo 先合并，树根所在 repo 的最后合并。

### 重试评论（标准 PR）

```markdown
## 重试意图

本次重试处理 <review comment URL>，续用 <issue 链接> 的现有 branch / PR。
计划动作：<收窄的改动或契约更正>

## 实现变化

<本次重试改变了哪些不变边界、机制、契约或切换，正文已同步；未改实现则写「无」。>

## 证据

HEAD <sha> 的证据包：<ghc ev publish 输出的 comment 链接>
```

无代码变更 PR 的重试评论写「重试意图」，再按「做了什么 / 调整思路 / 增加 / 减少」概括本次变化。

## 创建与发布

```bash
ghc ev check <issue>        # 标准 PR：退出码 0 才继续
git push -u origin <branch>
gh pr create --repo <owner>/<repo> --title "<中文标题>" --body-file <body-file>
ghc lint <PR>               # 身份、分支与模板；无代码变更另查范围、链接与结果标注
ghc ev publish <PR>         # 发布证据包（或无代码变更检查），并写 evidence/<owner>/<repo>#<N> 状态
```

两条 `ghc` 命令退出码都是 0 才算发布完成。`ghc lint` 非零时用 `gh pr edit --body-file` 修正后重跑；`ghc ev publish` 非零时按输出补采后重发，它发现疑似凭据会拒绝发布，换成不打印凭据的命令重采。再核对程序判断不了的：diff 单一连贯；实现说明与当前 HEAD 一致并对得上 issue 写明的原因；观察、推断与未验证项分开写；阻塞如实说明。
