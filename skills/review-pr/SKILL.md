---
name: review-pr
description: 审核 open PR、重试证据和 issue 关闭条件，裁决 request-changes、no-code、invalid、duplicate 或 blocked。
---

# review-pr

本 skill 决定检查顺序、证据是否成立和允许的裁决，不代替实现者补交付。问题契约见 `skill://writing-issue`，实现说明与证据见 `skill://writing-pr`，树的完备性见 `skill://writing-complex-issues`。有确定答案的检查以 `skill://gh-contract` 的 `ghc` 为准。

先用 `ghc fetch` 完整取得 issue 与 PR 的本地 payload（全部 review、thread、timeline、checks、图边、附件）；源码和 diff 从本地 checkout 读，不经 GitHub API 取代码。讨论位置与已合并记录的处理按 `~/.claude/rules/git.rule.md` 的「GitHub issue / PR routing rule」。

## 边界

- **把关，不代工。** 不替作者补测试、截图、PR body 或代码；缺口要求作者在 PR thread 补。自己补跑的结果不算作者证据。
- **以 issue 为尺。** 按原 issue 的问题、原因、预期结果与范围边界审，不追加它没写的目标或重构要求。本 PR diff 自身引入的缺陷（回归、越界改动、secret 或垃圾泄漏、破坏既有性质）在范围内；diff 之外的既有问题和「最好也做」的建议不阻塞本 PR，按 `skill://writing-issue` 另开 issue 并在 PR thread 附链接。
- **验收行有问题是 issue 的问题。** 验收行观察不到它声称覆盖的结果时，指出并要求修正 issue；不放行，也不让实现者改写验收去迁就实现。修正只补齐 issue 已写结果的观察，不借机新增结果。

## Gate

Gate 1–5 决定 open PR 能否批准，按序检查，首个失败即停。Gate 6 单独决定 issue 能否关闭。

**1. 身份。** `ghc lint <PR>` 的身份检查通过：第一行指名的 issue 真实存在，PR 落在该去的分支（独立 issue 合入默认分支；树内 child 合入缓冲分支；tree PR 把缓冲分支合入默认分支并关闭该 repo 全部未关闭的树内 issue）。再确认 diff 不是不相关问题的拼盘：它只含本 issue 的改动。

**2. 路由。** 问题、范围和 follow-up 在 issue，实现说明和证据在 PR。证据没有经 `ghc ev publish` 发成证据包、而是写在正文或别处时，要求作者用 `ghc` 重新采集发布，reviewer 不代为搬运。

**3. 正文。** `ghc lint <PR>` 通过。再核对：实现说明回答了 diff 为何消除 issue 写明的原因，只贴标签或复述 diff 不算；比较过多个方案的写出了被否方案及理由；改变结果或跨单元契约的偏离没有在 PR 内自行放行。

**4. 证据。** 当前 HEAD 上本 issue 的 `evidence/<owner>/<repo>#<N>` 状态为 success，否则直接失败，要求作者补采后重新发布。齐全之后读证据包判断实质：

- 记录里的命令是不是对真实入口的一次直接调用。脚本文件、driver、测试套件、把准备动作或多行串成一条的链，都不是证据，该行按无效处理。
- 输出或截图里能不能直接读到该行的 Expect；负例是否真的走了拒绝路径；`[保持]` 行是否经过被改的代码路径。
- 实现者本次自写的测试、mock、stub 的输出不算覆盖行的观察；CI 状态不是业务证明。

证据是这张验收表唯一的一次执行，reviewer 不重跑整张表；怀疑某条证据时可以跑针对该疑点的探针，探针结果不替代作者证据。

无代码变更 PR 没有运行证据，改为核对要点：每个要点概括思路或语义变化，不是逐行复述 diff；与当前 head 的 diff 一致，没有虚报或漏掉实质语义变化；「调整思路」写清原有问题、依据与取舍。空泛要点（「优化了措辞」）视同缺失。

**5. 代码。** 前四个 gate 通过后审本地 diff：实现是否满足目标、有无越界、是否泄漏 secret 或运行时文件、是否符合 repo 惯例。沿关键调用和数据路径核实实现说明属实：机制消除了所述原因；不变边界所述的条件真把未受影响方挡在改动之外；权威状态仍只有一个 owner；调用方与旧路径切换完成。无代码变更 PR 改为核对：改后文档各部分意图自洽，与关联文档语义一致，没有新旧并存的矛盾指导。

**6. 关闭资格。**

- 独立 issue：实现 PR 已合并，或 no-code 理由已发布。
- 树内 child：它的 PR 已合入缓冲分支，且 tree PR 已合入默认分支。
- 树根：`ghc merge-ready <树根> --tree` 通过后 tree PR 已合并；无 PR 的 child 有可引用的 no-code / duplicate / invalid / out-of-scope / already-satisfied / moot 理由。
- blocked：外部 blocker 具体且已发布，写明解除条件。

存在连贯的剩余交付物就要求开 child 承载，不靠 parent 标签关闭。Gate 1–5 全过的 PR 可以按 repo 政策 approve；实际合并之前，issue 仍不满足 Gate 6。

## 执行代码审查

Gate 5 的 diff 审查可以派一名只读子代理做；你自己就是被派来只做这次 review 的只读 agent 时亲自做，不再下派。派出时按本机当前可用的 agent 定义选能读代码、跑只读命令的那个，显式写明 agent；同一 diff 同一目的不重复分派。任务里给出：

- 本地 checkout 与真实 base/head commit；`ghc fetch` 落盘的 payload 位置。
- issue 的原因、责任定位与范围边界，作者的实现说明与证据包，repo-local 规则，以及要特别核对的风险。
- 只读边界：不改代码，不补证据，不创建或修改 GitHub 对象，不运行会改变环境的验证。
- 输出：每个发现带 `file:line`、可观察后果和依据；区分已证实缺陷、疑点、范围外和未覆盖范围；没有问题时如实报告检查范围。

要下派而没有满足要求的 agent 时报告 Gate 5 blocker。子代理只产出发现，裁决由你作出：对照本地 diff、周边代码和 repo 既有决策逐条核实，严重级别不是证据；存活的发现转成带 `file:line`、可观察影响和具体要求的 PR-thread 评论，不成立的丢弃或写明反证，范围外的另开 issue。agent 名不写进 PR comment。

## 裁决

| 裁决 | 条件 |
|---|---|
| Approve | Gate 1–5 全过；合并按 repo 政策，issue 关闭另按 Gate 6 |
| Request changes | 在原 issue 范围内，身份、正文、证据或代码不足；要求发在 PR thread |
| Needs PR-thread response | 反馈只在 issue 或本地 handoff 里处理过；要求补 PR 评论 |
| Needs issue split | 拼盘，或 parent 有连贯的剩余交付物 |
| No-code close | duplicate / invalid / out-of-scope / already-satisfied / moot，理由发在 issue |
| Blocked | 具体的外部依赖阻塞，已发布解除条件 |
| Do not close | 证明或 child 完成度不足 |

结论 comment 发在 PR thread，第一行是 `ghc gate header <PR> --result <PASS|FAIL@GateN>` 的输出，原样放在开头；其后写首个失败的 gate、依据的链接或 `file:line`、已确认与未确认的部分、下一步责任人。已合并后发现的缺陷另开 issue，不回写旧 PR。
