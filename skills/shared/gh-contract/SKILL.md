---
name: gh-contract
description: ghc CLI：程序化读取与检查 GitHub issue/PR 内容——完整抓取、issue/PR/树 lint、按证明分层采集证据与发布证据包、review 结论首行、PR 合并前提与 `ghc land` 落盘。writing-issue / writing-complex-issues / writing-pr / review-pr / delivering-issues 要求调用它的地方使用。
disable-model-invocation: true
---

# gh-contract

`ghc` 把 issue/PR 正文按模板解析成类型化内容再检查；`gh` 仍是传输层。凡是有确定答案的检查（抓全没有、关闭的是不是这个 issue、issue 有没有带原样记录的现场、每条结果有没有标类型、每条结果在当前补丁上有没有证据、review 结论对当前补丁是否仍有效、PR 是否落在该去的分支）以 `ghc` 的结果为准，不再人工核对。需要判断的部分（证据是否有意义、实现说明是否回答原因、代码审查）仍按各 skill 文字执行。

```bash
ghc <command>
```

`ghc` 是 `PATH` 上指向本 skill `bin/ghc` 的命令；`PATH` 上没有时，直接运行本 SKILL.md 所在目录下的 `bin/ghc`。

`<ref>` 写 `owner/repo#N` 或 github.com 链接。完整用法：`ghc help`。

| 命令 | 何时用 |
|---|---|
| `ghc fetch <ref> [--out DIR]` | 读取任何 issue/PR 之前：正文、全部 comment、review 与 thread、timeline、checks、图边、附件一次落盘（默认 `/tmp/ghc/<owner>-<repo>-<N>/`），并把契约引用展开到 `refs/`；之后只读本地文件 |
| `ghc lint <issue>` | 发布或修改 issue 之后 |
| `ghc lint <umbrella> --tree` | 发布或修改 issue 树之后 |
| `ghc lint <PR>` | 创建 PR、改 PR 正文之后：身份与分支（树内 child 合入缓冲分支；独立 issue 合入默认分支且恰好关闭它；tree PR 从缓冲分支合入默认分支并关闭该 repo 全部未关闭的树内 issue）、正文模板、无代码变更的范围与链接 |
| `ghc ev plan <issue>` | 开工前定证据计划时，以及采集前：列出每条预期结果的类型、证据模板，以及按面要采集的步骤；并说明有 `test` 检查时哪些结果由它证明 |
| `ghc ev run <issue> --result N[,M] --shows "<看点>" [--face F] [--kind 改\|新\|删\|保持] [--step S] [--artifacts DIR] [--checkout PATH]... [--timeout SEC] -- <command>` | 采集一条记录：执行经真实入口的观察并记录，输出照常打印；面只欠一个步骤时可省略 `--step`；`--artifacts` 目录里新出现的图片随记录登记 |
| `ghc ev attach <issue> --result N[,M] --shows "<看点>" [--face F] [--kind 改\|新\|删\|保持] [--step S] [--checkout PATH]... <image\|dir>...` | 把真实会话里截的图登记进证据 |
| `ghc ev check <issue\|PR>` | 开 PR 前与发布前：逐条结果、逐个步骤报告 linked / stale / invalid / missing，以及没有任何结果经它观察的面；issue 在本地检出上检查时，以检出相对 `origin/<默认分支>`（树内 child 为 `origin/<缓冲分支>`）的补丁为基准 |
| `ghc ev publish <PR\|总体验收 issue>` | 发布证据包 comment；无代码变更 issue 的检查发在它的 PR 上；全部结果由 PR 的 `test` 检查证明时不发证据包 |
| `ghc gate header <PR> --result PASS\|FAIL [--design REF]` | review 结论 comment 的第一行，原样放在 comment 开头（含当前 `patch <patchId>`、HEAD、base 与 issue 修订） |
| `ghc gate list <PR>` | 列出 review 结论各自的 patch 与是否仍有效，并给出当前 patch：结论要求 base 与当前一致；`PASS` 还按 patch 判定，HEAD 变了而 patch 不变仍有效，patch 变了即失效；`FAIL` 还要求 issue 正文未修订 |
| `ghc merge-ready <PR> --issue <ref> [--head <sha>]` | 合并交付一个 issue 的 PR 之前：PR open 非 draft、落在该去的分支、非 `evidence/` 检查全部 success、有对当前 patch 有效的 review `PASS`、按面所需的证据齐全（无代码变更 PR 改查正文要点与范围）；`--head` 是可选的前置断言，给出时 HEAD 必须仍是它 |
| `ghc merge-ready <树根> --tree` | 合并 tree PR 之前：剩余 child 都已合入缓冲分支、总体验收证据包齐全且对缓冲分支当前补丁有效、每个 repo 恰有一个合规的 tree PR；树根之外 repo 的 tree PR 先合并 |
| `ghc land <PR> --issue <ref> [--checkout PATH] [--timeout SEC]` | 单个 issue 的 PR 落盘：fetch、必要时 rebase 到 base（冲突即 abort 并列出文件；干净但补丁变化则推送后退出 1，等复核）、等待新 HEAD 的检查、复验合并前提、`--squash --delete-branch` 合并并读回状态（issue 的 CLOSED 在 `--timeout` 内等待） |
| `ghc land <树根> --tree [--timeout SEC]` | tree PR 落盘：先根 repo 之外、最后根 repo，逐个完成落盘，最后在 `--timeout` 内等待树内 issue 全部 CLOSED |

树的缓冲分支名固定为 `tree/<树根 owner>-<树根 repo>-<树根编号>`，`ghc` 据此检查树内 PR 的 base 与 tree PR 的 head。child 的 PR 在 issue 正文 `## 上下文` 的 `**Repo**` 所写的 repo 里找（缺省为 issue 所在 repo），所以 issue 与代码分处两个 repo 时这一行必须写代码所在的 repo。

## 证据的规矩

- 证据只能经 `ghc ev run` / `ghc ev attach` 产生；不在 PR 正文、comment 或报告里手写输出、日志或截图。
- 证明分层按面划分。可测试面 `library`、`cli`、`service`、`data` 由 PR 的 `test` 检查证明；外部观察面 `gui`、`iac`、`agent-config` 始终由 `ghc ev` 记录证明。
  - PR 上名为 `test` 的检查为 success 时，可测试面的每条结果由随 PR 提交、经真实入口或真实本地依赖运行且去掉本次改动即失败的行为/集成测试证明，PR 的 `## 实现说明` 写明对应测试文件与用例名。issue 的影响范围只含可测试面时，不再采集或发布 `ghc ev` 证据包。
  - 同时声明可测试面与外部面（例如 `service` + `gui`）时，每个外部面至少有一条结果经它观察并有关联有效记录；其余结果由 `test` 满足，未单独采集的结果按可测试面计，不因面的书写顺序被误判为缺失。
  - 仓库还没有接入 `test` 检查时回退：全部结果都要发布当前补丁的 `ghc ev` 记录，禁止既无 CI `test` 也无运行证据。
  - 总体验收 issue 的结果始终要记录：`gui` 交含截图的 `after`；`iac` 交有序的 `preview`、`apply`、`readback`；`agent-config` 交 `session`；回退模式下的可测试面按面交步骤（`run`、`request`+`log`、`migrate`+`readback`）。
- 证据挂在 issue 的预期结果上，每条记录观察改动后的产品，不存在改前的第二次检出：改动前的现场由 issue 的 `## 现场` 承载。issue 标的类型是参考，`--kind` 按实际类型采集，证据包标出差异。
- 每条记录带 `--shows`：一句话写明 reviewer 能从它看出什么。怎样观察由采集的人在实现后决定：经真实入口。一次性的取证脚本、mock、stub 和 driver 的输出不写进 `ghc ev` 记录；随 PR 提交、由 `test` 检查运行的测试按上面的分层证明可测试面（`writing-pr` skill「证据」）。
- issue 声明多个面时用 `--face` 指明记录经哪个面观察，面决定步骤（`ghc ev plan` 列出）；每个需要记录的面至少要有一条结果经它观察。
- 采集前提交改动：checkout 有未提交的 tracked 改动时 `ghc` 拒绝采集。每条记录带着采集检出相对目标分支（PR 的 base、树内 child 的缓冲分支）的补丁指纹，证据按补丁判定是否仍有效：HEAD 变了而补丁不变（例如无冲突 rebase 追平 base）时记录照常 linked，不重采；补丁变了（解冲突时改动了本 PR 的 hunk、追加提交）或自记录以来又改了代码文件时失效，在新补丁上重采；自记录以来只改了 `.md` 文件且新 HEAD 是记录 HEAD 的后代时，记录仍然有效；issue 改写了某条结果的文字，只有这条结果的记录失效。
- 同一条结果的同一步骤取最新一条有效记录；有序步骤（`iac`、`data`）按采集时间递增，顺序不对该结果无效。
- review 的 `PASS` 与它所审的 patch 一同锁定：之后 HEAD 变化不影响它，patch 变化则要增量复核。证据有效性由 `ghc ev check` 计算，`PASS` 有效性由 `ghc gate list` 计算，`ghc merge-ready` 与 `ghc land` 落盘前复算两者；不往任何提交 SHA 写证据状态。
- 截图经 `gh-attachment` skill 上传为 GitHub 附件；日志以末尾片段写进证据包。
- `ghc ev publish` 发现疑似凭据时拒绝发布：换成不打印凭据的命令重新采集。
- 证据记录存在 `${XDG_STATE_HOME:-~/.local/state}/ghc/<owner>/<repo>/<N>/`，是发布前的本地原始记录；发布出去的证据包 comment 发出后不改，补丁变化后发新的。

## 退出码

`0` 通过；`1` 有检查未通过或落盘未完成（输出逐条列出）；`2` 用法或环境错误（stderr 说明原因）。`ghc ev run` 例外：返回被执行命令自己的退出码（超时 124，被信号终止 128）。
