---
name: review-pr
description: 分为 review diff（采证前只审代码 diff）与 review 证据和 PR（不重复确认 ghc 已检查项，重点审证据本身能否看出解决了 issue；通过后直接合并到中转分支且不再重审重采），并裁决 issue 关闭条件。
---

# review-pr

本 skill 将审查分为两种：**review diff**（采集证据前，只审代码 diff）与 **review 证据和 PR**（证据发布后，不重复确认 `ghc` 已检查过的东西，重点看证据本身能否看出来是否解决了 issue），并规定 issue 的关闭资格。现场、原因与预期结果见 `skill://writing-issue`，实现说明与证据见 `skill://writing-pr`，树的完备性见 `skill://writing-complex-issues`。有确定答案的检查以 `skill://gh-contract` 的 `ghc` 为准。

先用 `ghc fetch` 完整取得 issue（及已开出的 PR）的本地 payload（全部 review、thread、timeline、checks、图边、附件）；源码和 diff 从本地 checkout 读，不经 GitHub API 取代码。讨论位置与已合并记录的处理按 `~/.claude/rules/git.rule.md` 的「GitHub issue / PR routing rule」。

## 边界

- **把关，不代工。** 不替作者补测试、截图、PR body 或代码；缺口要求作者补。自己补跑的结果不算作者证据。
- **以 issue 为尺。** 按原 issue 的现场、原因、预期结果与范围边界审，不追加它没写的目标或重构要求。本 diff 自身引入的缺陷（回归、越界改动、secret 或垃圾泄漏、破坏既有性质）在范围内；diff 之外的既有问题和「最好也做」的建议不阻塞本交付，按 `skill://writing-issue` 另开 issue 并附链接。
- **观察方式归 PR，产品要求归 issue。** 证据没让你看出某条结果达到时，要求作者在 PR 内换一种观察或补一条记录，不为此改 issue。结果本身与事实不符（现场写错了，或结果要求的行为与既有行为矛盾）才是 issue 的问题：指出并要求修正 issue 的那条结果，不放行，也不让实现者改写结果去迁就实现。修正只改写已有结果，不借机新增结果。

## 两种 Review

### 一、review diff（此时不需要采集证据）

在代码实现完成、repo 检查（构建、lint、测试套件）通过并提交到分支之后进行，**此时不需要采集证据**（也不需要先开 PR）。

审查本地 checkout 相对 base 的 diff：

- **单一与边界**：diff 不是不相关问题的拼盘，只含本 issue 的改动；没有越界改动，没有泄漏 secret 或运行时文件，符合 repo 惯例。
- **机制消除原因**：沿关键调用和数据路径核实实现是否满足目标、机制是否真正消除了 issue 写明的原因而非只压住症状。
- **不变边界**：改动只作用于部分人群、入口或状态时，把未受影响方挡在改动之外的符号、分支条件或类型在代码里确实成立。
- **契约与所有权**：权威状态仍只有一个 owner；消费的契约按原样使用，没有在本地扩展、复制或重定义；调用方与旧路径切换完成，issue「不应残留」列出的内容已清除。
- **无代码变更 issue**：diff 只改 issue「范围」列出的文件；改后文档各部分意图自洽，与关联文档语义一致，没有新旧并存的矛盾指导。

**结论与处置**：一次列出全部代码发现（每个发现带 `file:line`、可观察后果和依据；区分已证实缺陷、疑点、范围外和未覆盖范围；没有问题时如实报告检查范围）。未通过时作者在原分支一次改完代码、重跑 repo 检查后再送 `review diff`；**通过后才进入证据采集**。结论 comment 发在 issue（PR 已开出时发在 PR thread），第一行是 `ghc gate diff <issue> --head <被审提交的 sha> --result <PASS|FAIL>` 的输出，原样放在开头。结论只对被审的那个提交有效：之后改了代码，就在新提交上重审。

### 二、review 证据和 PR

在 `review diff` 通过、作者完成证据采集、开出 PR 且 `ghc lint <PR>` 与 `ghc ev publish <PR>` 均通过之后进行。

**不重复确认 `ghc` 已经检查过的东西。** PR 第一行身份与关闭引用、目标分支落点（树内 child 合入缓冲分支、独立 issue 合入默认分支）、正文必需段落、每条结果在当前 HEAD 上是否已有记录、`evidence/<owner>/<repo>#<N>` 状态是否为 success、无代码变更 PR 的文件范围与链接解析——这些确定性事项已由 `ghc` 检查，**reviewer 不再确认**。

**重点审证据本身能否看出来是否解决了 issue**（以及 PR 正文是否把实现讲清楚）：

- **看点读不读得到。** 按每条记录的看点（`--shows`）去读输出或截图：看点所指的具体读数、行或画面区域在不在，它说明的是这条预期结果本身，还是一个更弱的性质。看点空泛，或它说的东西在记录里找不到，这条结果的证据不成立。
- **模板对不对。** `[改]` 与 `[保持]` 有同一入口、同一输入在改动前后的两次观察，改动前那次重现了 issue 现场里的那一幕；`[新]` 观察到了新能力，issue 逐个写的 variant 每个都有；`[删]` 经原来的入口观察到它已经不在，且「不应残留」列的东西查不到。证据包标出所用类型与 issue 不同的，判断这个类型是否符合实际。
- **是不是真的。** 观察经过产品的真实入口；负例真的走了拒绝路径；`[保持]` 经过了被改的代码路径。实现者本次自写的测试、mock、stub 和取证 driver 的输出不算；CI 状态不是业务证明。命令的形式不是判据：一条记录里有几条命令、有没有准备动作，都不影响证据成立。
- **PR 正文。** 标准 PR 的实现说明回答了 diff 为何消除 issue 写明的原因（不变边界、机制、契约、切换、实现选择与未验证风险），只贴标签或复述 diff 不算；比较过多个方案的写出了被否方案及理由；改变结果或跨单元契约的偏离没有在 PR 内自行放行。无代码变更 PR 没有运行证据，核对要点：每个要点概括思路或语义变化而非逐行复述 diff；与 diff 一致，没有虚报或漏掉实质语义变化；「调整思路」写清原有问题、依据与取舍；空泛要点（「优化了措辞」）视同缺失。

证据是每条结果唯一的一次证明，reviewer 不重跑；怀疑某条证据时可以跑针对该疑点的探针，探针结果不替代作者证据。

**通过即合并，永不重审、永不重采：**

- **如果 `review 证据和 PR` 通过（`PASS`），PR 直接合并到中转分支（树内为缓冲分支 `tree/*`，独立 issue 为默认分支），并且必定不再 review、也不要再重新采集证据。**
- 即使合并前中转分支已前进或存在冲突，也只用 merge 把它合入分支、解冲突并直接完成合并，**必定不再 review，也不要再重新采集证据**；`PASS` 之后分支上不加别的提交。
- **后续再发生什么问题（包括解冲突、合入中转分支或后续组合验收时暴露的任何问题），必须按 `skill://writing-issue` 开新的 sub-issue 和新的 PR，绝不回写或重审已通过的 PR。**

## 关闭资格

- 独立 issue：实现 PR 已合并，或 no-code 理由已发布。
- 树内 child：它的 PR 已合入缓冲分支，且 tree PR 已合入默认分支。
- 树根：`ghc merge-ready <树根> --tree` 通过后 tree PR 已合并；无 PR 的 child 有可引用的 no-code / duplicate / invalid / out-of-scope / already-satisfied / moot 理由。
- blocked：外部 blocker 具体且已发布，写明解除条件。

存在连贯的剩余交付物就要求开 child 承载，不靠 parent 标签关闭。

## 执行审查

`review diff` 与 `review 证据和 PR` 均由只读子代理执行；你自己就是被派来只做这次 review 的只读 agent 时亲自做，不再下派。派出时按本机当前可用的 agent 定义选能读代码、跑只读命令的那个，显式写明 agent；同一对象同一目的不重复分派。任务里给出：

- 本次是 `review diff` 还是 `review 证据和 PR`；本地 checkout 与真实 base/head commit；`ghc fetch` 落盘的 payload 位置。
- issue 的原因、责任定位与范围边界，repo-local 规则，以及（`review 证据和 PR` 时）作者的实现说明与证据包。
- 只读边界：不改代码，不补证据，不创建或修改 GitHub 对象，不运行会改变环境的验证。
- 输出：每个发现带 `file:line` 或证据记录编号、可观察后果和依据；区分已证实缺陷、疑点、范围外和未覆盖范围；没有问题时如实报告检查范围。

子代理只产出发现，裁决由你作出：对照本地 diff、证据包和 repo 既有决策逐条核实，严重级别不是证据；存活的发现转成带具体要求的评论，不成立的丢弃或写明反证，范围外的另开 issue。agent 名不写进 PR comment。

## 裁决

| 裁决 | 条件 |
|---|---|
| Approve（`PASS`） | `review 证据和 PR` 通过；PR 直接合入中转分支，必定不再 review、不再重采证据，后续问题一律开新的 sub-issue 和 PR |
| Request changes（`FAIL`） | 在原 issue 范围内，`review diff` 代码有缺陷，或 `review 证据和 PR` 的证据看不出解决了 issue / 正文说明不足；全部要求一次列出 |
| Needs PR-thread response | 反馈只在 issue 或本地 handoff 里处理过；要求补 PR 评论 |
| Needs issue split | 拼盘，或 parent 有连贯的剩余交付物 |
| No-code close | duplicate / invalid / out-of-scope / already-satisfied / moot，理由发在 issue |
| Blocked | 具体的外部依赖阻塞，已发布解除条件 |
| Do not close | 证明或 child 完成度不足 |

`review 证据和 PR` 的结论 comment 发在 PR thread，第一行是 `ghc gate header <PR> --result <PASS|FAIL>` 的输出，原样放在开头；其后列出全部失败项、依据的链接或 `file:line`、已确认与未确认的部分、下一步责任人。通过或合并后发现的任何缺陷一律另开新的 sub-issue 和 PR，不回写旧 PR。
