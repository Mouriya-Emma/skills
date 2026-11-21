---
name: gh-contract
description: ghc CLI：程序化读取与检查 GitHub issue/PR 内容——完整抓取、issue/PR/树 lint、按预期结果采集证据与发布证据包、review 结论首行、PR 合并与 tree PR 合并前提。writing-issue / writing-complex-issues / writing-pr / review-pr / delivering-issues 要求调用它的地方使用。
---

# gh-contract

`ghc` 把 issue/PR 正文按模板解析成类型化内容再检查；`gh` 仍是传输层。凡是有确定答案的检查（抓全没有、关闭的是不是这个 issue、issue 有没有带原样记录的现场、每条结果有没有标类型、每条结果在当前 HEAD 上有没有证据、review 结论对当前输入是否仍有效、PR 是否落在该去的分支）以 `ghc` 的结果为准，不再人工核对。需要判断的部分（证据是否有意义、实现说明是否回答原因、代码审查）仍按各 skill 文字执行。

```bash
~/.claude/skills/gh-contract/bin/ghc <command>
```

`<ref>` 写 `owner/repo#N` 或 github.com 链接。完整用法：`ghc help`。

| 命令 | 何时用 |
|---|---|
| `ghc fetch <ref> [--out DIR]` | 读取任何 issue/PR 之前：正文、全部 comment、review 与 thread、timeline、checks、图边、附件一次落盘（默认 `/tmp/ghc/<owner>-<repo>-<N>/`），并把契约引用展开到 `refs/`；之后只读本地文件 |
| `ghc lint <issue>` | 发布或修改 issue 之后 |
| `ghc lint <umbrella> --tree` | 发布或修改 issue 树之后 |
| `ghc lint <PR>` | 创建 PR、改 PR 正文之后：身份与分支（树内 child 合入缓冲分支；独立 issue 合入默认分支且恰好关闭它；tree PR 从缓冲分支合入默认分支并关闭该 repo 全部未关闭的树内 issue）、正文模板、无代码变更的范围与链接 |
| `ghc ev plan <issue>` | 开工前定证据计划时，以及采集前：列出每条预期结果的类型、证据模板，以及按面要采集的步骤 |
| `ghc ev run <issue> --result N[,M] --shows "<看点>" [--face F] [--kind 改\|新\|删\|保持] [--step S] [--artifacts DIR] [--checkout PATH]... [--timeout SEC] -- <command>` | 采集一条记录：执行经真实入口的观察并记录，输出照常打印；`--artifacts` 目录里新出现的图片随记录登记 |
| `ghc ev attach <issue> --result N[,M] --shows "<看点>" [--face F] [--kind 改\|新\|删\|保持] [--step S] [--checkout PATH]... <image\|dir>...` | 把真实会话里截的图登记进证据 |
| `ghc ev check <issue\|PR>` | 开 PR 前与发布前：逐条结果、逐个步骤报告 linked / stale / invalid / missing，以及没有任何结果经它观察的面；在本地检出上检查树内 child 时，改动前的记录以 `origin/<缓冲分支>` 为 base |
| `ghc ev publish <PR|总体验收 issue>` | 发布证据包 comment，并在 HEAD 写本 issue 的 `evidence/<owner>/<repo>#<N>` 状态 |
| `ghc gate diff <issue> --head <sha> --result PASS\|FAIL [--design REF]` | `review diff` 结论 comment 的第一行，原样放在 comment 开头；comment 发在 issue，PR 已开出时发在 PR thread |
| `ghc gate header <PR> --result PASS\|FAIL [--design REF]` | `review 证据和 PR` 结论 comment 的第一行，原样放在 comment 开头 |
| `ghc gate list <PR>` | 列出两种 review 的结论，并判断 `review 证据和 PR` 的结论是否仍有效（`PASS` 一旦给出即锁定有效，后续为合入中转分支解冲突更新 HEAD 不再失效） |
| `ghc merge-ready <PR> --issue <ref> --head <sha>` | 合并交付一个 issue 的 PR 之前：PR open 可合并、HEAD 未变、落在该去的分支、checks 全部通过、有有效的 review PASS；`PASS` 所在提交有 `review diff` 的 `PASS` 与本 issue 证据状态 success，之后分支只新增了合并 base 的提交 |
| `ghc merge-ready <树根> --tree` | 合并 tree PR 之前：剩余 child 都已合入缓冲分支、总体验收证据包齐全且采于缓冲分支当前提交、每个 repo 恰有一个合规的 tree PR；树根之外 repo 的 tree PR 先合并 |

树的缓冲分支名固定为 `tree/<树根 owner>-<树根 repo>-<树根编号>`，`ghc` 据此检查树内 PR 的 base 与 tree PR 的 head。child 的 PR 在 issue 正文 `## 上下文` 的 `**Repo**` 所写的 repo 里找（缺省为 issue 所在 repo），所以 issue 与代码分处两个 repo 时这一行必须写代码所在的 repo。

## 证据的规矩

- 证据只能经 `ghc ev run` / `ghc ev attach` 产生；不在 PR 正文、comment 或报告里手写输出、日志或截图。
- 证据挂在 issue 的预期结果上。结果上的类型决定模板：`[改]` 与 `[保持]` 多交一条 `before`，在 base 提交的检出上采；`[新]` 与 `[删]` 只交 HEAD 上的观察。issue 标的类型是参考，`--kind` 按实际类型采集，证据包标出差异。
- 每条记录带 `--shows`：一句话写明 reviewer 能从它看出什么。怎样观察由采集的人在实现后决定：经真实入口；本次自写的测试、mock、stub 和取证 driver 的输出不算（`skill://writing-pr`「证据」）。
- issue 声明多个面时用 `--face` 指明记录经哪个面观察，面决定步骤（`ghc ev plan` 列出）；每个声明的面至少要有一条结果经它观察。
- 采集前提交改动：checkout 有未提交的 tracked 改动时 `ghc` 拒绝采集。在 `review 证据和 PR` 通过之前，HEAD 一变，旧记录对新 HEAD 失效，在新 HEAD 上重跑；issue 改写了某条结果的文字，只有这条结果的记录失效。一旦 `review 证据和 PR` 通过（`PASS`），PR 直接合入中转分支，必定不再 review 也不要再重新采集证据；之后为合入中转分支用 merge 解冲突而更新 HEAD，`ghc gate list`、`ghc ev check <PR>` 与 `ghc merge-ready` 仍直接认可在 `PASS` 提交上已通过的结论与证据。后续再发生什么问题必须开新的 sub-issue 和 PR。
- 同一条结果的同一步骤取最新一条有效记录。
- 截图经 `skill://gh-attachment` 上传为 GitHub 附件；日志以末尾片段写进证据包。
- `ghc ev publish` 发现疑似凭据时拒绝发布：换成不打印凭据的命令重新采集。
- 证据记录存在 `${XDG_STATE_HOME:-~/.local/state}/ghc/<owner>/<repo>/<N>/`，是发布前的本地原始记录；发布出去的证据包 comment 发出后不改，HEAD 变化后发新的。

## 退出码

`0` 通过；`1` 有检查未通过（输出逐条列出）；`2` 用法或环境错误（stderr 说明原因）。`ghc ev run` 例外：返回被执行命令自己的退出码（超时 124，被信号终止 128）。
