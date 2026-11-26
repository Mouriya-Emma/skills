---
name: review-pr
description: 每个 PR 只做一次只读审查：`ghc lint` 通过、证明分层要求证据包时 `ghc ev publish` 通过之后进行，不重复确认 `ghc` 已检查的确定性事项，按五个问题审机制、随 PR 的测试、冗余、证据包与正文；结论首行取自 `ghc gate header` 的 patch 判定，有效性按 patch id 计算，合并只经 `ghc land`。并裁决 issue 关闭资格。
---

# review-pr

本 skill 规定 PR 的审查与 issue 的关闭资格。一个 PR 只有一次只读审查，结论锁定在它审的 patch 上；此后按 patch id 判断它是否仍然有效，patch 不变就不重审。现场、原因与预期结果见 `writing-issue` skill，实现说明与证据见 `writing-pr` skill，树与总体验收见 `writing-complex-issues` skill。有确定答案的检查以 `gh-contract` skill（`../gh-contract/SKILL.md`）的 `ghc` 为准。讨论位置与已合并记录的处理按 `git` 规则的「GitHub issue / PR routing rule」。

先用 `ghc fetch` 完整取得 issue 与 PR 的本地 payload（全部 review、thread、timeline、checks、图边、附件）；源码和 diff 从本地 checkout 读，不经 GitHub API 取代码。

## 边界

- **把关，不代工。** 不替作者补测试、截图、PR body 或代码；缺口要求作者补。自己补跑的结果不算作者证据。
- **以 issue 为尺。** 按原 issue 的现场、原因、预期结果与范围边界审，不追加它没写的目标或重构要求。本 diff 自身引入的缺陷（回归、越界改动、secret 或垃圾泄漏、破坏既有性质）在范围内；diff 之外的既有问题和「最好也做」的建议不阻塞本交付，按 `writing-issue` skill 另开 issue 并附链接。
- **观察方式归 PR，产品要求归 issue。** 证据没让你看出某条结果达到时，要求作者在 PR 内换一种观察或补一条记录，不为此改 issue。结果本身与事实不符（现场写错了，或结果要求的行为与既有行为矛盾）才是 issue 的问题：指出并要求修正 issue 的那条结果，不放行，也不让实现者改写结果去迁就实现。修正只改写已有结果，不借机新增结果。

## 何时审查

在 `ghc lint <PR>` 退出码 0 之后；证明分层要求证据包时，还要 `ghc ev publish <PR>` 已发布。

- 有 `test` 检查、issue 的影响范围全是可测试面（`library`、`cli`、`service`、`data`）：结果由随 PR 的测试证明，没有证据包也不影响送审。
- 含外部面（`gui`、`iac`、`agent-config`），或仓库没有 `test` 检查（回退：每条结果都要有记录）：先有证据包。

审查对象是 PR 当前的 patch：base 到 HEAD 的三点 diff，以及 `ghc gate list <PR>` 报出的当前 patch id。tree PR 没有自己的实现与证据，不单独审查，它的合并前提由 `ghc merge-ready <树根> --tree` 把关。

## ghc 已经检查过的，不重复确认

PR 第一行身份与 closing 引用、目标分支落点（树内 child 合入缓冲分支，独立 issue 合入默认分支，tree PR 从缓冲分支合入默认分支）、正文必需段落、无代码变更 PR 的文件范围与链接解析、每条结果在当前 patch 上有没有有效记录、非 `evidence/` 的 checks 是否全部 success、`ghc merge-ready` 的合并前提——这些由 `ghc lint`、`ghc ev check`、`ghc merge-ready` 判定，reviewer 不再确认，也不把它们当作审查发现。

## 五个问题

逐条回答。判据是仓库里的代码、测试、证据包与 PR 正文，不是标签，也不是别人转述的严重级别。

1. **机制消除原因，守住不变边界。** 沿关键调用和数据路径核实 diff 满足目标、机制真正消除了 issue 写明的原因而不是只压住症状；改动只作用于部分人群、入口或状态时，未受影响方确实被符号、分支条件或类型挡在改动之外；权威状态仍只有一个 owner，消费的契约按原样使用，没有在本地扩展、复制或重定义；调用方与旧路径切换完成，issue「不应残留」列出的内容已清除。diff 只含本 issue 的改动，没有越界改动，没有泄漏 secret 或运行时文件，符合 repo 惯例。
2. **随 PR 提交的测试真的能证明。** 见「测试作为证明」。
3. **没有该删的冗余。** 不留兼容分支、兜底路径、旧别名、已废弃的 re-export、脚手架或死代码；这次切换造成的过时代码与注释一并清除，除非 issue 明确要求保留。
4. **外部面与回退的证据包能看出结果。** 见「证据包」。
5. **当前 patch 能否合并，还漏了什么风险。** 结论针对当前 patch id，并写明未覆盖范围、推断而未观察的部分；blocked 的交付物只有 blocker 具体且解除条件已发布才算交代清楚。

## 测试作为证明

用于证明可测试面结果的测试必须随 PR 提交，且满足：

- **经真实入口或真实本地依赖。** 走产品自己的入口（CLI、HTTP 接口、控制面、数据库读回），或起真实的本地依赖；只调用内部函数的单元测试证明不了结果。
- **去掉本次改动即失败。** 读测试代码与 fixture 判断它断言的是这次改动才产生的行为，因此在改动前的代码上不可能通过；有无改动都通过的测试不算。改动前的代码不另外检出，判断靠读，不重跑测试。
- **不是 mock、stub 搭出来的结果，不是照抄实现。** 只钉内部实现细节、复制实现逻辑、或全靠替身的测试不构成证明。
- **与实现说明对得上。** `## 实现说明` 写明的测试文件与用例名要在代码里找得到，且确实是用来证明该条结果的。

## 证据包（外部面与回退）

审查 `ghc ev publish <PR>` 发出的证据包时：

- **看点读得到。** 按每条记录的看点（`--shows`）去读输出或截图：看点所指的具体读数、行或画面区域在不在，它说明的是这条预期结果本身，还是一个更弱的性质。看点空泛，或它说的东西在记录里找不到，这条结果不成立。
- **模板对。** `[改]` 与 `[保持]` 只观察改动后的产品一次，改动前的现场由 issue 的 `## 现场` 承载，不存在改动前的第二次检出；`[保持]` 的观察经过被改的代码路径，读数与 issue 现场一致；`[新]` 观察到新能力，issue 逐个写的 variant 每个都有；`[删]` 经原来的入口观察到它已经不在，且「不应残留」列的东西查不到。证据包标出所用类型与 issue 不同的，判断这个类型是否符合实际。
- **是真的。** 观察经过产品的真实入口；负例真的走了拒绝路径；`iac` 的 `preview`、`apply`、`readback` 顺序和内容成立；`agent-config` 的会话能读出所用配置与结果。mock、stub 与为取证单独写的 driver 的输出不算；CI 状态不是外部面的证明。一条记录里有几条命令、有没有准备动作，都不是判据。
- **面覆盖齐全。** 混合面时每个外部面至少有一条结果经它观察，其余结果按可测试面由 `test` 证明。

既没有 `test` 证明、也没有有效证据记录的结果不通过。证据是每条结果唯一的一次证明，reviewer 不重跑，也不另行采集。

## PR 正文

标准 PR 的 `## 实现说明` 要回答 diff 为何消除 issue 写明的原因（不变边界、机制、契约、切换、实现选择与偏离、未验证与风险），只贴标签或复述 diff 不算；对照 diff 核对说明属实：它说的机制、不变边界和切换在代码里找得到（这是核对说明，不重审代码）；比较过多个方案的写出了被否方案及理由；会改变结果或跨单元契约的偏离没有在 PR 内自行放行。无代码变更 PR 没有运行证据，核对要点：每个要点概括思路或语义变化而非逐行复述 diff；与 diff 一致，没有虚报或漏掉实质语义变化；「调整思路」写清原有问题、依据与取舍；空泛要点（「优化了措辞」）视同缺失。

## 结论与有效性

结论 comment 发在 PR thread，第一行是 `ghc gate header <PR> --result <PASS|FAIL>` 的输出，原样放在开头；它带着这次审查的 patch id、HEAD、base 与 issue 修订。其后列出全部失败项、依据的 `file:line` 或证据记录编号、已确认与未确认的部分、下一步责任人。

- **`PASS` 锁定在它审的 patch 上。** base 与当前一致、patch id 不变时有效：无冲突地 rebase 到前进的 base、HEAD 随之变化也不重审，照常合并。
- **patch id 变了即失效**——解冲突改动了本 PR 的 hunk，或追加了提交。这时在新 patch 上做一次增量复核：只审变化的部分，再核对五个问题里受影响的那几项；它仍是同一次审查针对新 patch 的结论，不是另一个阶段。
- **`FAIL` 还会被 issue 正文修订作废。** HEAD、base 分支、issue 正文修订任一改变即失效。
- **是否仍有效由 `ghc gate list <PR>` 计算，最新的有效结论决定最终裁决。** 未通过时作者在原分支一次改完并重跑 repo 检查；证据失效的在新 HEAD 上按 `writing-pr` 重采，需要时 `ghc ev publish <PR>` 重发证据包。

回到审查的路径都在这里：`FAIL` 之后作者改代码改变了 patch id，在新的 patch 上做增量复核；issue 正文修订作废 `FAIL`，按修订后的结果重新给出结论；`ghc land` 因 rebase 冲突或 patch 变化退出 1 时，新 patch 同样走增量复核。

## 合并

通过后只经 `ghc land` 合并，不自行 `gh pr merge`，也不用 merge commit；合并动作本身不触发重审、重采，只有 patch id 变化才走增量复核：

- `ghc land <PR> --issue <ref>` 把 PR rebase 到最新 base（不产生 merge commit），必要时推送新 HEAD 并等它自己的检查，复验 `ghc merge-ready` 后以 `--squash --delete-branch` 合并，读回 MERGED，默认分支的 PR 还要读回 issue 已关闭。它因 rebase 退出 1 时有两种情形，都按「结论与有效性」在新 patch 上做增量复核，再重新执行 `ghc land`：rebase 冲突时它已 abort、分支不变并列出冲突文件，由会话在 PR 分支上自行 rebase、解决、提交并推送；干净 rebase 改变了 patch 时它已经推送新的 HEAD，不必再提交任何东西，只欠这次增量复核。
- tree PR 用 `ghc land <树根> --tree`，以同样方式合并：先树根之外的 repo，最后树根所在 repo，落盘后读回树内 issue 全部关闭。
- 合并后发现的任何缺陷（包括 rebase、合入中转分支或后续组合暴露的问题）一律按 `writing-issue` skill 开新的 issue 和 PR，不回写旧 PR。

## 关闭资格

- 独立 issue：实现 PR 已经 `ghc land <PR> --issue <issue>` 以 `--squash --delete-branch` 合并，读回 MERGED 且 issue CLOSED；或 no-code 理由已发布。
- 树内 child：它的 PR 已经 `ghc land` 合入缓冲分支（不合默认分支，GitHub 不关闭 issue），且 tree PR 已经 `ghc land <树根> --tree` 合入默认分支，读回树内 issue 全部 CLOSED。
- 树根：`ghc merge-ready <树根> --tree` 通过后 tree PR 经 `ghc land <树根> --tree` 合并并读回；无 PR 的 child 有可引用的 no-code / duplicate / invalid / out-of-scope / already-satisfied / moot 理由。
- blocked：外部 blocker 具体且已发布，写明解除条件。

存在连贯的剩余交付物就要求开 child 承载，不靠 parent 标签关闭。

## 执行审查

审查由只读子代理执行；你自己就是被派来只做这次 review 的只读 agent 时亲自做，不再下派。派出时按本机当前可用的 agent 定义选能读代码、跑只读命令的那个，显式写明 agent；同一个 patch 不重复分派。任务里给出：

- PR 链接、当前 patch id、真实 base 与 head commit、本地 checkout，以及 `ghc fetch` 落盘的 payload 位置。
- issue 的原因、责任定位与范围边界，repo-local 规则，以及证明分层：哪些面由 `test` 证明、哪些必须看证据包。
- 作者的实现说明与证据包（有的话）。
- 只读边界：不改代码，不补证据，不创建或修改 GitHub 对象，不运行会改变环境的验证，不推送、不合并。
- 输出：逐个回答五个问题；每个发现带 `file:line` 或证据记录编号、可观察后果和依据；区分已证实缺陷、疑点、范围外和未覆盖范围；没有问题时如实报告检查范围。

子代理只产出发现，裁决由你作出：对照本地 diff、证据包和 repo 既有决策逐条核实，严重级别不是证据；存活的发现转成带具体要求的评论，不成立的丢弃或写明反证，范围外的另开 issue。agent 名不写进 PR comment。

## 裁决

| 裁决 | 条件 |
|---|---|
| Approve（`PASS`） | 五个问题全部通过，发出 `ghc gate header <PR> --result PASS` 作首行的结论；随后只经 `ghc land` 合并（tree PR 用 `ghc land <树根> --tree`），patch id 不变就不重审、不重采 |
| Request changes（`FAIL`） | 在原 issue 范围内，机制、测试、冗余、证据包或正文任一不成立；全部要求一次列出 |
| Needs PR-thread response | 反馈只在 issue 或本地 handoff 里处理过；要求补 PR 评论 |
| Needs issue split | 拼盘，或 parent 有连贯的剩余交付物 |
| No-code close | duplicate / invalid / out-of-scope / already-satisfied / moot，理由发在 issue |
| Blocked | 具体的外部依赖阻塞，已发布解除条件 |
| Do not close | 证明或 child 完成度不足 |
