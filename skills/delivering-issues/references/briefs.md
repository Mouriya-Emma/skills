# brief 与消息模板

什么时候读我：派实现者、reviewer、总体验收采集者，或向实现者、PR 发裁定与核实结论时。模板列出必须出现的块；`<...>` 处填当前事实。子代理看不到对话、本 skill 和 appendix，brief 里没写的它就不知道。按本机当前可用的 agent 定义选择满足 SKILL.md「分工」表要求的 agent；brief 与发到 GitHub 的文字都不写 agent 名或模型名。

## 所有 brief 共有的块

**分工**（逐字放进每个 brief 的 context）：

> 用户要求按本流程交付，并显式改写了 APPEND_SYSTEM 的默认分工（依据其「User instructions take precedence」）：编排者不写任何实现代码与测试，负责设计裁定、设计权威文件与 issue 契约的编辑、派实现、review 与总体验收、核实 review 结论、关闭未通过的 PR 与合并。设计权威文件指设计文档，以及被指定为契约源、且不在产品源码目录里的类型声明；只有编排者编辑它们。契约源在产品源码里时，编排者先裁定并写进文档与 issue，类型改动由实现者实现。一棵 issue 树的剩余 child 每轮由一名实现者在同一个 head 上一起实现（含核心代码）、测试、按各 child 声明的测试形态采集证据并为每个 child 开一个 PR，PR 合入树的缓冲分支；独立 issue 由一名实现者实现并开 PR 合入默认分支。实现者按自己的 system prompt 安排下级 subagent。每个 PR 由一名新起的 reviewer 在一个 HEAD 上完成全部 Gate 1–5 并把结论直接发到 PR thread。每张验收表只执行一次：实现者采集的证据就是该 issue 的验收，reviewer 判断证据，不重跑。任何人不向用户提问；契约问题上报编排者。

**策略原文**：派工当时从文件和 system prompt 读出，逐字粘贴，不凭记忆复述、不挑条目、不改写成摘要：

1. `~/Ext/code/omomp/omp-config/agent/APPEND_SYSTEM.md` 全文（用 `read` 的 `:raw` 读取），放在分工块之后；分工块是它的优先条款。
2. 当前 system prompt 中下列区块整块照录，存在的都附上：`# Engineering`；`§ Workflow`；`§ Delivery`；`§ Critical`；`<generic-rules>` 整个区块。

**通用要求**（每个 brief 都写）：

- 读目标 repo 的 `AGENTS.md` / `CLAUDE.md` / rules，并遵守。
- 不在继承来的隔离工作区里改动或检出 repo：在 `/tmp/delivering-issues/<owner>-<repo>-<编号>/<角色>-<轮次>` 下基于远端提交另建 clone 或 worktree 工作。报告里写明这个工作目录。
- 有疑问或发现契约问题，发消息给编排者，不猜、不自行裁定。
- 报告列出主张、证据（命令、输出、链接）和未验证项；长报告写进 `local://<名字>.md` 并给出路径。不限制报告长度。
- issue、PR、comment 与 commit message 里不写 agent 名、模型名或编排细节。

## 树的一轮

```markdown
# 目标
实现 <树根链接> 第 <r> 轮：<本轮 child 链接列表>（树内尚未合入缓冲分支的全部 child）。每个 repo 的缓冲分支 <tree/...>，当前提交 <SHA>。<r > 1 时：上一轮未通过的 PR 与其 review：<链接及要点>。>
不做本轮之外的 issue。

# 分工
<共有块>

# 策略原文
<APPEND_SYSTEM.md 全文与指定 system prompt 区块，逐字>

# 必读（动手前通读全文，不以 grep 代替）
- 树根的契约与设计修正 comment；本轮每个 child 的全文与全部 comment。
- 列出的全部设计章节、契约类型与例子；近期契约 commit：<SHA / comment 链接>。
- repo rules；实现前读 `skill://writing-pr` 与 `skill://gh-contract`，对每个 child 跑 `ghc ev plan <child>` 规划证据。

# 交付
- 每个 repo 基于缓冲分支当前提交建一个工作分支，一起实现本轮全部 child，核心代码由你亲自写；其余是否委派、怎样拆由你按策略原文决定。
- 提交后在这一个 head 上对每个 child 用 `ghc ev run` 采集证据，强度按该 child 的「测试形态」，不升级；Web 按 `skill://ego-browser` 走真实用户路径，截图经 `--artifacts` 采集。`ghc ev check <child>` 退出码 0 的 child 才开 PR。
- 每个要开 PR 的 child：推分支 `<缓冲分支>-c<child 编号>-r<r>` 指向同一个 head；开 PR，base 是缓冲分支，正文第一行 `Closes <owner>/<repo>#<N>`，按 writing-pr 写实现说明；`ghc lint <PR>` 与 `ghc ev publish <PR>` 退出码 0。
- 跑 repo 校验命令。

# 契约问题
发现设计文档或契约沉默、矛盾，立即发给编排者：最小复现输入（`path: bytes`）、两种读法及各自的权威出处、最早缺信息的环节、你的建议。等裁定期间继续做无争议部分。不在本地扩展或复制契约类型，不加兼容 shim，不编辑设计权威文件。编排者把设计修正提交到缓冲分支后通知你，你把工作分支整合到新的缓冲分支提交上再继续。
发现某个 child 无需代码（已满足、重复）或需要拆分时，带证据报告编排者，不为它开空 PR。

# 生命周期
- PR 全部开好后报告：每个 repo 的 head、每个 child 的 PR 链接与证据包链接、没开 PR 的 child 与缺失的证据行及原因、风险。之后保持在线，等编排者通知。
- review 期间不推送。不合并，不关闭 PR，不开始下一轮。不向用户提问。

# 完成标准
本轮每个 child 要么有 PR（`ghc lint` 与 `ghc ev publish` 退出码 0），要么在报告里写明未开 PR 的原因；repo 校验通过。
```

## 独立 issue

```markdown
# 目标
只交付 <issue 链接>。目标 repo <owner/repo>，起点 <默认分支> <SHA>，在你自己的工作目录里从远端建 branch。<沿用 PR 时：沿用 <PR 链接> / <branch>。><存在本任务无权维护的 PR 时：<PR 链接> 不改动其 branch，只作参考；你另开 PR。>

# 分工
<共有块>

# 策略原文
<APPEND_SYSTEM.md 全文与指定 system prompt 区块，逐字>

# 必读（动手前通读全文，不以 grep 代替）
- issue 全文与全部 comment；issue 列出的全部设计章节、契约类型与例子。
- repo rules；实现前读 `skill://writing-pr` 与 `skill://gh-contract`，用 `ghc ev plan <issue>` 规划证据。

# 交付
- 实现整个 issue，核心代码由你亲自写。
- 一个 PR，base 是默认分支，首行 `Closes <owner>/<repo>#<N>`。证据只经 `ghc ev run` / `ghc ev attach` 采集（Web 按 `skill://ego-browser` 走真实用户路径，截图经 `--artifacts` 采集）；`ghc ev check <issue>` 退出码 0 才开 PR，开 PR 后 `ghc lint <PR>` 与 `ghc ev publish <PR>` 退出码都是 0。
- 跑 issue 指定的命令与 repo 校验命令。

# 契约问题
同「树的一轮」。编排者要把设计修正随你的 PR 落地时，会请你推送当前 branch 并暂停推送；它推上 commit 后你拉取再继续，并在 PR 实现说明里注明该 commit 由编排者提交及裁定链接。

# 生命周期
- PR 就绪后报告：PR URL、HEAD、closing issue、证据包链接、风险。之后保持在线，等 review 反馈。
- review 期间不推送。收到修复要求：读 PR thread 里对应的 comment，在原 branch/PR 修复，更新正文的实现说明，在新 HEAD 上重新采集并 `ghc ev publish <PR>`，按 writing-pr 模板发重试评论，报告新 HEAD。
- 不合并。不向用户提问。
```

## 接手

新会话接手未结算的一轮，或原实现者不可恢复时使用。brief 为「树的一轮」或「独立 issue」全文，另加：

```markdown
# 接手状态
接手 <PR 链接列表>，head <SHA>，工作分支 <branch>。原实现者的工作目录：<路径>；其中尚未推送的提交：<内容或「无」，编排者已核对>。
先完整读每个 PR 的 body 与全部 comment。待处理：<review / 编排者 comment 链接及要点>。
在同一批 PR 上继续，不开新 PR；以远端 head 为起点，只合入上面列出的未推送改动。推送被拒时不强推，停下报告编排者。
```

## reviewer

每个 PR 每个 HEAD 新起一名。

```markdown
# 目标
全新一轮 review：<PR 链接>（交付 <issue 链接>），HEAD <SHA>，base 分支 <branch>。先读 `skill://review-pr`。<树内：同一 head 上还有 <其他 PR 链接>，各由别的 reviewer 审；你只审本 PR 交付的 issue。>

# 你在 review-pr 里的角色
你同时是 review-pr 的主审与执行层：Gate 1–5 全部由你亲自完成，包括 Gate 5 的代码与检查，不再派任何审查子代理。按用户要求，你把结论直接发到 PR thread，这一点改写 review-pr「执行层不创建或修改 GitHub 对象」的限制；除这条结论 comment（及必要的更正 comment）外不写 GitHub。编排者会核实你的发现并决定合并。

# 分工
<共有块>

# 策略原文
<APPEND_SYSTEM.md 全文与指定 system prompt 区块，逐字>

# 必读
用 `ghc fetch` 抓取 issue 与 PR（body、全部 comment、review、checks、图边）；<树根链接> 的契约与设计修正 comment <链接>；issue 必读的设计章节、类型与例子全文；repo rules。以前各轮的 comment 是已发布记录，结论由你独立作出。编排者驳回或改判过的主张，没有新证据时不重复提出；你发现新的前提、新的反例或契约已变更时可以重新提出，并写明新在哪里、同时告知编排者。

# 做法
- 在自己的工作目录里检出 <SHA>（detached），确认 `git rev-parse HEAD`，不相信继承来的 worktree。HEAD 变化立即停下，报告编排者。
- 按 Gate 1–5 顺序审，首个失败即停；不裁定 Gate 6。
- 以 issue 的问题、预期结果与范围为尺，不追加它没写的要求；diff 之外的既有问题标「范围外」。树内 PR 的 diff 含同一 head 上其他 child 的改动：只审本 issue 负责的部分，其他 child 的改动只在它破坏本 issue 的结果时才算本 PR 的缺陷。
- Gate 4 判断作者证据是否真的观察到结果，不重跑验收表；怀疑某条证据时可以跑针对该疑点的探针，探针结果不替代作者证据。
- 遇到契约歧义，发给编排者裁定，不自行裁定。
- 发现落在编排者提交的 commit（<SHA 列表>）上时，下一责任人写编排者。

# 输出
在 PR thread 发一条结论 comment：第一行是 `ghc gate header <PR> --result <PASS|FAIL@GateN> --design <设计权威 commit 或 comment>` 的输出，原样放在开头；其后写各 gate 状态、首个失败 gate、`file:line`、可观察后果、复现命令、下一责任人。发错的内容另发更正 comment，不改原文。
不改代码、文档或 PR body，不合并。向编排者回报 comment URL、所依据的输入、gate 结果与未覆盖范围。
```

## 总体验收

每次新起一名，不用本树任何一轮的实现者。

```markdown
# 目标
执行总体验收 issue <链接>（树根 <链接>）：在全部 child 合入后的缓冲分支上，逐行采集它的验收表。各 repo 的检出：<owner/repo @ <缓冲分支> <SHA>，逐个列出>。

# 分工
<共有块>

# 策略原文
<APPEND_SYSTEM.md 全文与指定 system prompt 区块，逐字>

# 做法
- 先读 `skill://gh-contract`，跑 `ghc ev plan <总体验收 issue>`。
- 每个 repo 在自己的工作目录里干净检出上面列出的 SHA；部署型 repo 在 <repo 交付规则允许的目标环境> 上部署该提交后观察。
- 逐行用 `ghc ev run <总体验收 issue> --row N --checkout <各 repo 检出> ... -- <命令>` 采集；截图用 `--artifacts`。不复用 child 的证据、driver 或测试。
- `ghc ev check <总体验收 issue>` 退出码 0 才报告完成；发现组合缺陷时给出最小复现，不修代码。
- 除 `ghc` 上传截图附件外不写 GitHub；证据包由编排者发布。

# 输出
`ghc ev check` 的输出；逐行观察结论；发现的组合缺陷与复现；未覆盖项。
```

## 消息：设计裁定通知实现者

```markdown
<issue 链接> 契约裁定：<一句话结论>。依据与被否方案见 <设计修正 comment 链接>。
<树内：设计权威已提交到缓冲分支 <branch> <commit>（<文件与章节>）。<已知暂时失败：<调用方编译错误>，由你在本轮迁移。> 请把工作分支整合到该提交后按此实现。>
<独立 issue：我已把设计修正 commit <SHA> 推到你的 branch <branch>（<文件与章节>）。请拉取后继续，并在 PR 实现说明里注明。>
不要在本地另立兼容层。依赖旧契约的 review 结论已失效，推新 head 后我会重新派 reviewer。
```

## PR comment：关闭未通过的 PR

```markdown
## 本轮未通过，关闭本 PR

<child 链接> 在 head <SHA> 上未通过：<review 首个失败 gate 与 comment 链接 / 证据缺失的行与 ghc ev check 输出摘要>。
同一 head 上通过的 PR 随后合入 <缓冲分支>，本 PR 若不先关闭会被 GitHub 一起标记为已合并。<child 链接> 进入第 <r+1> 轮，修复后开新 PR。
```

## PR comment：驳回或改判 review 发现

```markdown
## 编排者核实：<发现所在 comment 链接> 中的 <发现>

判定：<契约已答 / 输入越界 / 改判为设计缺口 / 改判为范围外>。
依据：<设计章节或 issue 条款链接与原文>；<核实所用的命令与输出>。
<设计缺口：裁定见 <设计修正 comment 链接>。范围外：已另开 <issue 链接>。>
本判定只针对上述主张与所引契约版本；出现新的前提、新的反例或契约变更时可以重新提出。<该发现是本轮 review 的首个失败项时：已重派新的 reviewer。>
```
