# brief 与消息模板

什么时候读我：派 owner、续作 owner、reviewer、验收者，或向 owner、PR、issue 发裁定、授权、验收结论时。模板列出必须出现的块；`<...>` 处填当前事实。child 看不到对话、本 skill 和 appendix，brief 里没写的它就不知道。

## 所有 brief 共有的块

**分工**（逐字放进每个 brief 的 context）：

> 用户要求按本流程交付，并显式改写了 APPEND_SYSTEM 的默认分工（依据其「User instructions take precedence」）：编排者不写任何实现代码与测试，负责串行门禁、设计裁定、设计权威文件与 issue 契约的编辑、派审与验收、核实 gate 结论、合并授权。设计权威文件指设计文档，以及被指定为契约源、且不在产品源码目录里的类型声明；只有编排者编辑它们。契约源在产品源码里时，编排者先裁定并写进文档与 issue，类型改动由 owner 实现。每个 issue 由一名独立隔离的 task:high 独占实现（含核心代码）、测试、PR、修复与按授权合并，并按自己的 system prompt 安排下级 subagent；交付物只有设计权威文件的项例外，由编排者兼任 owner。issue 严格串行，当前项在合并生效处验收通过前不开始下一项。每轮 review 由一名全新的隔离 task:mid 在一个 HEAD 上完成全部 Gate 1–5 并把结论直接发到 PR thread；独立验收由另一名全新的隔离 task:mid 完成并报告编排者。任何人不向用户提问；契约问题上报编排者。

**策略原文**：派工当时从文件和 system prompt 读出，逐字粘贴，不凭记忆复述、不挑条目、不改写成摘要：

1. `~/Ext/code/omp-config/agent/APPEND_SYSTEM.md` 全文（用 `read` 的 `:raw` 读取），放在分工块之后；分工块是它的优先条款。
2. 当前 system prompt 中下列区块整块照录，存在的都附上：`# Engineering`；`§ Workflow`；`§ Delivery`；`§ Critical`；`<generic-rules>` 整个区块。

**通用要求**（每个 brief 都写）：

- 读目标 repo 的 `AGENTS.md` / `CLAUDE.md` / rules，并遵守。
- 不在继承来的隔离工作区里改动或检出 repo：在 `/tmp/delivering-issues/<owner>-<repo>-<issue>/<你的 agent 名>` 下基于远端提交另建 clone 或 worktree 工作，路径写相对这个 checkout 的仓库根。报告里写明这个工作目录。
- 有疑问或发现契约问题，发消息给编排者，不猜、不自行裁定。
- 报告列出主张、证据（命令、输出、链接）和未验证项；长报告写进 `local://<名字>.md` 并给出路径。不限制报告长度。

## 实现 owner

`task`，`agent: task:high`，`isolated: true`，名字如 `Issue<N>Owner`。

```markdown
# 目标
只交付 <issue 链接>（清单第 <k> 项<，属于 <parent 链接>>）。目标 repo <owner/repo>，起点 <默认分支> <SHA>，在你自己的工作目录里从远端建 branch。<沿用 PR 时：沿用 <PR 链接> / <branch>。><他人 PR 时：<PR 链接> 属于他人，不改动其 branch，只作参考；你另开 PR。>
不做清单中的其他 issue。

# 分工
<共有块>

# 策略原文
<APPEND_SYSTEM.md 全文与指定 system prompt 区块，逐字>

# 必读（动手前通读全文，不以 grep 代替）
- issue 全文与全部 comment；<parent 链接> 的契约与设计修正 comment。
- issue 列出的全部设计章节、契约类型与例子；近期契约 commit 与尚未进入默认分支的裁定：<SHA / comment 链接>。
- repo rules；实现前读 `skill://writing-pr`，按 issue 的预期结果和验收表规划证据。

# 交付
- 实现整个 issue，核心代码由你亲自写；其余是否委派、怎样拆由你按策略原文决定。
- 一个 PR，首行 `Closes <owner>/<repo>#<N>`，只关闭这一个 issue。
- PR body 按 writing-pr 选模板。非纯文档 PR 用四层证据，其中：
  - Layer 2 读回关键落地内容：`git show <HEAD>:<path> | nl -ba` 的相关行加说明。`git diff --stat`、文件清单、符号名清单不算。
  - Layer 4 逐条对应 issue 验收行，经该 issue 的真实用户入口观察正负路径的具体输出：纯库用固定输入的一次性 driver 调用公开 API，CLI 走真实命令，Web 按 `skill://agent-browser` 走真实用户路径并附截图。测试 pass 数只放「卫生检查」；没有接入被测路径的 mock 或计数器不是证据。
- 跑 issue 指定的命令与 repo 校验命令。

# 契约问题
发现设计文档或契约沉默、矛盾，立即发给编排者：最小复现输入（`path: bytes`）、两种读法及各自的权威出处、最早缺信息的环节、你的建议。等裁定期间继续做无争议部分。不在本地扩展或复制契约类型，不加兼容 shim，不编辑设计权威文件。编排者要把设计修正随你的 PR 落地时，会请你推送当前 branch 并暂停推送；它推上 commit 后你拉取再继续，并在 PR 实现说明里注明该 commit 由编排者提交及裁定链接。
发现本 issue 无需代码（已满足、重复）或需要拆分时，带证据报告编排者，不开空 PR。

# 生命周期
- PR 就绪后报告：PR URL、HEAD、base 分支、closing issue、证据摘要、风险。之后保持在线，等 review 反馈与合并授权。
- 编排者派的 review 与验收运行期间不推送；修复先在本地准备，等通知再推。推送被拒（远端已被别人改动）时停下报告。
- 收到修复要求：读 PR thread 里对应的 comment，在原 branch/PR 修复，把 body 的实现说明与证据更新到当前 HEAD，按 writing-pr 模板发重试评论，报告新 HEAD。
- 只有收到编排者的合并授权才合并：用 `gh pr merge <N> --merge --match-head-commit <HEAD>`（repo 另有合并方式时照 repo），回报合并 SHA 与 issue 状态。HEAD 或 base 分支与授权不符、PR 不可合并、checks 未过，或编排者撤回授权时，停下报告。
- 合并后不开始下一个 issue。不向用户提问。

# 完成标准
按 writing-pr 所选模板，issue 每条预期结果都在 PR body 里有对应证据；repo 校验通过；PR 经编排者授权合并，issue 经 closing link 关闭。
```

## 续作 owner

向原 owner 发消息失败，或新会话接手未完成的 PR 时使用。`task`，`agent: task:high`，`isolated: true`。brief 为「实现 owner」全文，另加：

```markdown
# 接手状态
接手 <PR 链接>，branch <branch>，远端 HEAD <SHA>。原 owner 的工作目录：<路径>；其中尚未推送的提交：<内容或「无」，编排者已核对>。
先完整读 PR body 与全部 comment。待处理：<review / 验收 / 编排者 comment 链接及要点>。
在同一 branch/PR 上继续，不开新 PR；以远端 HEAD 为起点，只合入上面列出的未推送改动。推送被拒时不强推，停下报告编排者。
```

## reviewer

`task`，`agent: task:mid`，`isolated: true`，名字如 `Issue<N>ReviewRound<R>`。每轮新起。

```markdown
# 目标
全新一轮 review：<PR 链接>（关闭 <issue 链接>），HEAD <SHA>，base 分支 <branch>。先读 `skill://review-pr`。

# 你在 review-pr 里的角色
你同时是 review-pr 的主审与执行层：Gate 1–5 全部由你亲自完成，包括 Gate 5 的代码与检查，不再派任何审查子代理。按用户要求，你把结论直接发到 PR thread，这一点改写 review-pr「执行层不创建或修改 GitHub 对象」的限制；除这条结论 comment（及必要的更正 comment）外不写 GitHub。编排者会核实你的发现并决定合并。

# 分工
<共有块>

# 策略原文
<APPEND_SYSTEM.md 全文与指定 system prompt 区块，逐字>

# 必读
完整抓取 issue 与 PR（body、全部 comment、review、checks、图边）；<parent 链接> 的契约与设计修正 comment <链接>；issue 必读的设计章节、类型与例子全文；repo rules。以前各轮的 comment 是已发布记录，结论由你独立作出。编排者驳回或改判过的主张，没有新证据时不重复提出；你发现新的前提、新的反例或契约已变更时可以重新提出，并写明新在哪里、同时告知编排者。

# 做法
- 在自己的工作目录里检出 <SHA>（detached），确认 `git rev-parse HEAD`，不相信继承来的 worktree。HEAD 变化立即停下，报告编排者。
- 按 Gate 1–5 顺序审，首个失败即停；PR 未合并时不裁定 Gate 6。
- 以 issue 的问题、预期结果与范围为尺，不追加它没写的要求；diff 之外的既有问题标「范围外」。
- 可以跑探针核实发现，但你的运行结果不能替代作者应交的证据。
- 遇到契约歧义，发给编排者裁定，不自行裁定。
- 发现落在编排者提交的 commit（<SHA 列表>）上时，下一责任人写编排者。

# 输出
在 PR thread 发一条结论 comment：所依据的输入（HEAD、base 分支、issue body 修订或最近的决策 comment、设计权威 commit 或 comment）、各 gate 状态、首个失败 gate、`file:line`、可观察后果、复现命令、下一责任人。发错的内容另发更正 comment，不改原文。
不改代码、文档或 PR body，不合并。向编排者回报 comment URL、所依据的输入、gate 结果与未覆盖范围。
```

## 验收者

`task`，`agent: task:mid`，`isolated: true`，名字如 `Issue<N>AcceptanceRound<R>`。每次新起。

```markdown
# 目标
独立验收 <issue 链接> 在 <PR 链接> HEAD <SHA> 上的实现。你不是 reviewer，也不是作者。

# 分工
<共有块>

# 策略原文
<APPEND_SYSTEM.md 全文与指定 system prompt 区块，逐字>

# 必读
issue 全文（尤其预期结果与验收表）与决策 comment；<parent 链接> 的相关契约与设计修正 comment；相关设计章节与例子全文；repo rules。

# 做法
- 在自己的工作目录里干净地检出 <SHA>（detached），确认 commit 与工作区干净后再运行，不相信继承来的 worktree。HEAD 变化立即停下报告。
- 经该 issue 的真实用户入口逐条观察预期结果的正负路径：<纯库：在仓库外自写固定输入的一次性 driver 调用公开 API / CLI：真实命令 / Web：按 skill://agent-browser 走真实用户路径并截图 / 纯文档：核对文档间语义与引用>，涉及存储、文件、进程时用真实的。不复用作者的 driver 或测试。最后跑一次 repo 校验命令。
- 作者的测试通过不算验收。发现缺陷时给出最小复现；NOT ACCEPTED 加复现就是完整交付，不要修代码。
- 不改 repo，不写 GitHub；临时文件与数据用完清理。

# 输出
PASS 或 NOT ACCEPTED；所依据的输入（HEAD、base 分支、issue body 修订或最近的决策 comment、设计权威 commit 或 comment）；逐条预期结果 → 命令或操作 → 实际输出的对照；未覆盖项与原因。
```

## 合并后验收与树关闭验收

`task`，`agent: task:mid`，`isolated: true`，名字如 `Issue<N>MergedAcceptance` 或 `Parent<N>ClosureAcceptance`。

```markdown
# 目标
<合并后验收：<PR 链接> 已合并为 <默认分支> <merge SHA>，<issue 链接> 应已关闭。><已关闭项：<issue 链接> 已关闭，在 <默认分支> 当前最新提交 <SHA> 上验收。><树关闭：按 <parent 链接> 的「关闭验证」逐行验收，<默认分支> <SHA>。>在合并生效处独立验收。

# 分工
<共有块>

# 策略原文
<APPEND_SYSTEM.md 全文与指定 system prompt 区块，逐字>

# 做法
- 用实时来源确认相关 PR 为 MERGED、issue 为 CLOSED 且由该 PR 关闭。树关闭时逐个 child 确认：由合并的 PR 关闭，或 issue 上发布了持久的 no-code 理由。
- 在 <对应提交的干净 checkout，按 lockfile 安装依赖 / repo 交付规则规定的目标环境> 上，经真实入口观察 <该 issue 的预期结果 / parent 关闭验证的每一行><；修正项时同时观察 <原 issue 链接> 的预期结果>，再跑 repo 校验命令。
- 与本次改动无关的失败如实记录并说明为何无关，不宣称已修复。不改 repo，不写 GitHub；结论报告编排者，由编排者发布。

# 输出
PASS 或失败；所验提交；逐条预期结果或关闭验证行的命令与输出；无关失败；未覆盖项。
```

## 消息：设计裁定通知 owner

```markdown
<issue 链接> 契约裁定：<一句话结论>。依据与被否方案见 <设计修正 comment 链接>。
<默认分支先行：设计权威已更新于 <默认分支> <commit>（<文件与章节>）。<已知暂时失败：<调用方编译错误>，由你在 PR 中迁移。> 请同步到该 commit 后按此实现。>
<随 PR 落地：我已把设计修正 commit <SHA> 推到你的 branch <branch>（<文件与章节>）。请拉取后继续，并在 PR 实现说明里注明。>
不要在本地另立兼容层。依赖旧契约的 review 与验收结论已失效，推新 HEAD 后我会重新派 gate。
```

## 消息：合并授权

```markdown
合并授权：<PR 链接> HEAD <SHA>，base 分支 <branch>。依据：review Gate 1–5 通过 <comment 链接>；独立验收 PASS <comment 链接>。
仅当远端 PR 仍为 open、base 分支仍是 <branch>、HEAD 等于 <SHA>、可合并、repo 要求的 checks 通过、且只关闭 <issue 链接> 时，执行 `gh pr merge <N> --merge --match-head-commit <SHA>`，然后回报合并 SHA 与 issue 状态。任何一项不符就停下报告，不推新提交。在你回报结果前我不改动这些依据；确需改动时我会先发撤回，你收到撤回时若尚未合并就不再合并，并回复确认。合并后不要开始下一个 issue，合并后验收由我另派。
```

## PR comment：独立验收结论

```markdown
## 独立验收（编排者发布，不替代作者 PR body 的证据）

HEAD：<SHA>；base 分支：<branch>；依据的契约：<issue body 修订或决策 comment>、<设计权威 commit 或 comment>
结论：<PASS / NOT ACCEPTED>

| 预期结果 | 命令 / 操作 | 实际输出 | 判定 |
|---|---|---|---|
| <行> | <命令> | <输出> | <通过/失败> |

<失败时：最小复现与预期。>
未覆盖：<项与原因>。
```

## PR comment：驳回或改判 review 发现

```markdown
## 编排者核实：<发现所在 comment 链接> 中的 <发现>

判定：<契约已答 / 输入越界 / 改判为设计缺口 / 改判为范围外>。
依据：<设计章节或 issue 条款链接与原文>；<核实所用的命令与输出>。
<设计缺口：裁定见 <设计修正 comment 链接>。范围外：已另开 <issue 链接>。>
本判定只针对上述主张与所引契约版本；出现新的前提、新的反例或契约变更时可以重新提出。<该发现是本轮 review 的首个失败项时：已重派全新一轮 review。>
```

## issue comment：合并后验收结论

```markdown
## 合并后验收（编排者发布）

合并：<PR 链接> → <默认分支> <merge SHA><；已关闭项：验于 <默认分支> <SHA>>
环境：<合并提交的干净 checkout / 目标环境>
结论：<PASS / 未通过，已开修正 <issue 链接>>

| 预期结果 | 命令 / 操作 | 实际输出 | 判定 |
|---|---|---|---|
| <行> | <命令> | <输出> | <通过/失败> |

与本次改动无关的失败：<内容，及另开的 <issue 链接>；无则写「无」>。
```
