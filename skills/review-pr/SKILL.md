---
name: review-pr
description: 审核 open PR、重试证据和 issue 关闭条件，裁决 request-changes、no-code、invalid、duplicate 或 blocked。
---

# review-pr

本 skill 决定检查顺序、证据是否成立和允许的裁决，不代替实现者补交付。问题契约见 `skill://writing-issue`，实现说明与四层证据见 `skill://writing-pr`，parent/child 完备性见 `skill://writing-complex-issues`。

先按 `~/.claude/rules/gh-full-fetch-issues-prs.rule.md` 完整取得本地 issue/PR payload 和附件，包含所有 review/thread、timeline、checks 与图边；用完整上下文判断新决定和重试。源码和 diff 从本地 checkout 读取，不经 GitHub API 取代码。讨论位置及合并后不可变边界按 `~/.claude/rules/github-issue-pr-routing.rule.md`。

## Review 边界

- **把关，不代工：** 不替作者补缺失测试、截图、PR body 或代码。独立核实已有证据/发现可以做，但不能把自己补跑的结果当成作者已交证据；缺口要求作者在 PR thread 补。
- **结果优先：** 验收表全绿只是必要条件。每条预期结果还要有真实路径直接观察它的覆盖行；卫生检查和实现者本次自写测试不算覆盖。缺口是 issue 契约问题，先指出并要求修正契约；不能放行，也不能让实现者中途改契约来匹配实现。修正只补齐 issue 已写结果的覆盖，不借机新增结果。
- **不扩大 issue：** review 以原 issue 的问题、原因、预期结果与范围边界为尺，不追加它没写的目标、结果、验收或重构要求。本 PR diff 自身引入的缺陷（回归、越界改动、secret/垃圾泄漏、破坏既有性质）在范围内；diff 之外的既有问题、顺带发现的改进和「最好也做」的建议不阻塞本 PR，按 `skill://writing-issue` 另开 issue 并在 PR thread 附链接。
- **关闭有语义：** 原子结果和 checkpoint 满足，且实现已合并或有正当 no-code 理由，才完成。parent/wrapper 还须全部 child/subtask 完成且 parent 级验证通过；连贯剩余交付物必须有 child 承载，不因它是 parent 就跳过。

## PR 审查与 issue 关闭

Gate 1–5 决定 open PR 是否可批准，按序检查，首个失败即停。Gate 6 独立决定 issue 是否可关闭：批准尚未合并的 PR 不等于接受 issue 已完成。open PR 的实现/证据反馈发 PR thread；issue 契约本身的争议按全局路由回 issue，并在 PR 指明阻塞。

### 1. 目标身份

确认 repo、base branch、预期目标与恰好一个真实 closing issue；diff 不是不相关问题的拼盘。无 PR 时，no-PR 路径要有 issue/PR 历史中的显式理由。身份或关闭条件不成立就说明缺失项，不进入代码 review。

### 2. 路由

问题、原因、Why、scope、结果和 follow-up 在 issue；PR 是实现说明和证据。PR 出现后的实现/重试不能只留在 issue、本地 handoff 或 memory。证据错放时要求补 PR body/thread，而非 reviewer 搬运代交。

### 3. Body 与证据形式

按 `writing-pr` 或更严的 repo-local 契约核对：closing keyword 第一行、默认中文、必需段、实现说明、四层内容或明确不适用理由、总体分析。实现说明要回答 diff 为何消除 issue 写明的原因，只贴标签或复述 diff 不算；改变结果或跨单元契约的偏离在 PR 内自行放行的，按契约问题处理。每段输出都说明它证明哪个结果/checkpoint。纯文档 PR 先核对 diff 确属 `writing-pr` 定义的纯文档，再按其「纯文档 PR 模板」核对：摘要与「做了什么 / 调整思路 / 增加 / 减少」四段齐全，均为无序列表；混入代码、配置、脚本、依赖、CI 或部署改动却套纯文档模板的，要求改用标准模板。形式不全先补，再进代码 review。

### 4. 证据实质

逐条把预期结果映射到真实观察，重放行数不能替代业务覆盖。命令、环境、exit status、具体读数、日志/工件足以复现；正面与负面/错误/禁用路径符合 issue 和 `writing-pr` 要求。截图必须 reviewer 可见，Web 路径与 UI 截图满足 `~/.claude/rules/runtime-verification-required.rule.md`。CI 或本地 CI-parity 状态如实记载，但不是业务证明。过期、局部、仅本地、凭记忆或含糊的证据要求作者重新采集。

**证据必须有意义。** 每段证据都要证明它声明的那件事，且只按它能证明的计。承担结果覆盖的证据逐段问：回退本 PR，或把实现写错到 issue 原因仍在，这段读数会不会变？不会变的就是无意义证据；issue 明确要求保持的既有性质例外，但其证据仍须经过被改代码路径观察。Layer 1–3 的证据只证明变更预演、落地或启动顺序，不承担结果覆盖；在任何一层都证明不了东西的是凑数。无意义证据视同缺失，数量再多也不放行，要求作者删掉并换成能区分改对与改错的观察。典型形态：

- 不经过改动路径的命令：`--help`、版本号、`echo`、与本次责任单元无关的调用。
- 只证明「写进去了」的读回冒充行为：文件存在、grep 到新字符串或常量名、`git show` 贴 diff（这些只属 Layer 2 落地核对）。
- 裸状态信号：`is-active`、Running、HTTP 200、首页可打开、`Apply complete!`，没有与结果对应的具体内容或读数。
- 读数不由被改代码产出：测试或 driver 直接写入期望值、mock/stub 返回、实现者本次自写测试的 pass（固定输入调用公开 API 的一次性 driver 不在此列）；或观察的是改动前就成立、与本次结果无关的既有行为。
- 没有分析的日志堆砌、看不出所证结果的截图、同一观察换个形式重复凑数、只有措辞没有读数的「已验证」。
- 用空泛理由写的「不适用」层，而该层对本 diff 实际适用。

**纯文档 PR 不适用本 gate 的运行证据要求**，改为核对要点实质：每个要点概括思路或语义变化，逐文件逐行复述 diff、贴改前改后原文的不算；要点与当前 head 的 diff 一致，没有虚报，也没有漏掉实质语义变化（新增或删除的规则、收窄或放宽的边界）；「调整思路」写清原有问题、依据与取舍，而非复读「做了什么」；issue 每条预期结果都能对应到要点。空泛要点（「优化了措辞」「完善了文档」）视同缺失。

### 5. 代码与检查

前四 gate 通过后，交执行层检查本地 diff：实现是否满足目标、有没有越界、测试/检查是否覆盖风险、是否泄漏 secret/运行时文件/生成垃圾、是否符合 repo 惯例与安全要求。另沿关键调用/数据路径核实实现说明是否属实：机制是否消除所述原因、权威状态是否仍只有一个 owner 且消费侧未另立副本、结果不变量与错误/生命周期路径、必要调用方与旧路径 cutover 是否完成。纯文档 PR 改为核对：改后文档各部分意图自洽、与关联文档语义一致、引用的章节与文件存在、没有留下新旧并存的矛盾指导。只查本次受影响的责任，不借 review 重设计全仓库，也不把 issue 之外的要求当成本 PR 的缺陷；符合作者所述结构不等于结果正确。执行层只产出发现，不替本协议裁决；不能用手工 grep 冒充执行层已完成。

### 6. 关闭资格

- 原子 issue：实现 PR 已合并，或 no-code 理由已明确发布。
- parent：全部 child/subtask 完成，parent 级标准也满足；无合并 PR 的 child 有可引用的 no-code/duplicate/invalid/out-of-scope/already-satisfied/moot 理由。
- blocked：外部 blocker 具体且已发布，写明解除条件。
- invalid/duplicate/moot：理由持久、带链接/引用。

存在剩余交付物则要求原子 child，不能靠 wrapper 标签接受关闭。Gate 1–5 全过的 open PR 可以按 repo 政策 approve；在实际合并前，关联 issue 仍不满足 Gate 6。执行层的 Ready to merge 既不代替前五个 gate，也不授权提前关闭 issue。

## OMP 执行层

使用当前 `task` 工具的 `task:mid` 子代理执行只读代码审查，不使用禁用的 bundled `reviewer` 或省略 agent 字段后落到默认 `task`。不依赖旧插件 slash command，也不因磁盘上有插件文件就声称它在 OMP 可调用。

交给执行者的任务应包含：

- 本地 checkout、真实 base/head commit 或未提交改动范围；完整本地 issue/PR payload 与附件位置。
- 目标契约（含 issue 的原因、责任定位与范围边界）、作者的实现说明与证据位置、repo-local 规则，以及需要特别核对的类型、权威归属、错误恢复、安全或交互风险。
- 范围边界：以 issue 契约为尺，diff 外既有问题与改进建议单独标为「范围外」，不计入本 PR 缺陷。
- 只读边界：不修改代码，不替作者补测试/截图/证据，不创建或修改 GitHub 对象，不运行会改变环境的验证。
- 输出契约：每个发现包含 `file:line`、可观察后果和依据；区分已证实缺陷、疑点和未覆盖范围；找不到问题时如实报告检查范围，不凭空凑发现。

同一 diff 同一目的不重复分派。按实质独立范围拆任务，而不是固定凑多个角色。Main 核实发现并裁决，不能把子代理的结论直接当成已通过全部 gate。

`task:mid` 实际不可用时报告 Gate 5 blocker，不偷偷安装插件或换用其他 agent；源码仍只从本地 checkout 读，GitHub 元数据仍走完整本地 payload。

## 消化报告

审查发现按以下步骤消化；这些是本协议的核实步骤，不要求加载其他插件，也不进入实现：

1. 读完整发现，理解主张；不懂先澄清。
2. 对照本地 diff、周边代码、repo 契约与设计记录核实。agent 可能判断错，严重级别不是证据。
3. 评估本 repo 的既有架构决策与风险容忍度；与它们冲突的建议给出技术反驳。
4. 存活发现转为带 `file:line`、可观察影响和具体要求的 PR-thread 评论；未成立的丢弃或说明反证，不原样转发每条 Critical/Important。范围外的存活发现不作本 PR 的修改要求，按「不扩大 issue」另开 issue 并附链接。

## 裁决

| 裁决 | 条件 / 后续 |
|---|---|
| Approve / accept PR | Gate 1–5 全过；按 repo 政策处理合并。issue 关闭资格另按 Gate 6 判断。 |
| Request changes | 在原 issue 范围内，PR 协议、证据、代码或检查不足；要求在 PR thread。 |
| Needs PR-thread response | 反馈仅在 issue/handoff 处理；要求补 PR 评论并按需更新 body。 |
| Needs issue split / child issues | 拼盘或 parent 有连贯剩余交付物；要求按 issue 树契约拆分/挂接。 |
| No-code close | duplicate/invalid/out-of-scope/already-satisfied/moot，理由在 issue。 |
| Blocked | 具体外部依赖或不可用执行能力阻塞，发布解除条件。 |
| Do not close | 证明或 child 完成度不足。 |

输出指出首个失败 gate、依据链接/文件锚点、已确认与未确认部分及下一步责任人。已合并后的缺陷另开 issue，不回写旧 PR。
