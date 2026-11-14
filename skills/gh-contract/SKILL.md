---
name: gh-contract
description: ghc CLI：程序化读取与检查 GitHub issue/PR 内容——完整抓取、issue/PR/树 lint、证据采集与证据包发布、review 结论首行、PR 合并与 tree PR 合并前提。writing-issue / writing-complex-issues / writing-pr / review-pr / delivering-issues 要求调用它的地方使用。
---

# gh-contract

`ghc` 把 issue/PR 正文按模板解析成类型化内容再检查；`gh` 仍是传输层。凡是有确定答案的检查（抓全没有、关闭的是不是这个 issue、每条结果有没有验收行、每个验收行在当前 HEAD 上有没有证据、review 结论对当前输入是否仍有效、PR 是否落在该去的分支）以 `ghc` 的结果为准，不再人工核对。需要判断的部分（证据是否有意义、实现说明是否回答原因、代码审查）仍按各 skill 文字执行。

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
| `ghc ev plan <issue>` | 开始实现前：列出每个验收行要采集的证据步骤 |
| `ghc ev run <issue> --row N[,M] [--step S] [--artifacts DIR] [--checkout PATH]... [--timeout SEC] -- <command>` | 跑验收命令：执行并记录，输出照常打印 |
| `ghc ev attach <issue> --row N[,M] [--step S] [--checkout PATH]... <image|dir>...` | 已有截图时登记进证据 |
| `ghc ev check <issue|PR>` | 开 PR 前与发布前：逐行报告 linked / stale / invalid / missing；在本地检出上检查树内 child 时，改动前截图以 `origin/<缓冲分支>` 为 base |
| `ghc ev publish <PR|总体验收 issue>` | 发布证据包 comment，并在 HEAD 写本 issue 的 `evidence/<owner>/<repo>#<N>` 状态（同一 head 上的多个 child PR 各有各的状态） |
| `ghc gate header <PR> --result PASS|FAIL@GateN [--design REF]` | review 结论 comment 的第一行，原样放在 comment 开头 |
| `ghc gate list <PR>` | 判断已有 review 结论是否仍对当前输入有效 |
| `ghc merge-ready <PR> --issue <ref> --head <sha>` | 合并交付一个 issue 的 PR 之前：PR open 可合并、HEAD 未变、落在该去的分支、本 issue 的证据状态 success、有对当前输入有效的 review PASS；同一 head 上其他 issue 的证据状态不计入 |
| `ghc merge-ready <树根> --tree` | 合并 tree PR 之前：剩余 child 都已合入缓冲分支、总体验收证据包齐全且采于缓冲分支当前提交、每个 repo 恰有一个合规的 tree PR；树根之外 repo 的 tree PR 先合并 |

树的缓冲分支名固定为 `tree/<树根 owner>-<树根 repo>-<树根编号>`，`ghc` 据此检查树内 PR 的 base 与 tree PR 的 head。

## 证据的规矩

- 证据只能经 `ghc ev run` / `ghc ev attach` 产生；不在 PR 正文、comment 或报告里手写输出、日志或截图。
- 采集前提交改动：checkout 有未提交的 tracked 改动时 `ghc` 拒绝采集。HEAD 一变，旧记录对新 HEAD 失效，在新 HEAD 上重跑。
- 截图经 `skill://gh-attachment` 上传为 GitHub 附件；日志以末尾片段写进证据包。
- `ghc ev publish` 发现疑似凭据时拒绝发布：换成不打印凭据的命令重新采集。
- 证据记录存在 `${XDG_STATE_HOME:-~/.local/state}/ghc/<owner>/<repo>/<N>/`，是发布前的本地原始记录；发布出去的证据包 comment 发出后不改，HEAD 变化后发新的。

## 退出码

`0` 通过；`1` 有检查未通过（输出逐条列出）；`2` 用法或环境错误（stderr 说明原因）。`ghc ev run` 例外：返回被执行命令自己的退出码（超时 124，被信号终止 128）。
