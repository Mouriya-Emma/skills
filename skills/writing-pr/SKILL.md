---
name: writing-pr
description: 起草或修复 open PR 的 closing link、实现说明、四层证据和重试评论，纯文档 PR 用思路要点模板；实施前用它确定需要采集的证据。
---

# writing-pr

PR 承载实现说明与证据：说明 diff 怎样兑现 issue 的原因、结果与契约，再证明它。问题、Why、范围和 checkpoint 在 `skill://writing-issue`，裁决在 `skill://review-pr`。遵从 `~/.claude/rules/github-issue-pr-routing.rule.md`，更严的 repo-local 流程优先。

PR 按 diff 性质二选一，不混用：**纯文档 PR** 用「纯文档 PR 模板」；其余 PR 用下文实现说明、采集纪律、四层证据与「PR body 模板」。纯文档 PR 指 diff 只改文档类文本——README、设计文档、指南，以及 skill、prompt、rule、agent 定义等 Markdown/纯文本；只要同时改了代码、配置、脚本、依赖、CI 或部署，就不是纯文档 PR，文档部分并入实现说明。

## PR 身份与正文

- 一个 PR 关一个真实 issue；多个独立问题拆开，单一连贯 refactor 可跨子系统。umbrella 工作关所实现的 child，不关 parent。
- 第一行 `Closes #<N>`（同仓库）或 `Closes <owner>/<repo>#<N>`（跨仓库）；`Fixes` / `Resolves` 等价。PR 不作 sub-issue，closing keyword 是它连接 issue 的机制。
- 中文标题和正文；固定 token、代码、路径、命令与工具原样输出不翻译。摘要 1–3 句写改了什么；实现怎样做写在「实现说明」，不复制 issue 的业务 Why，不逐文件复述 diff。conventional-commit 前缀仅在 repo 已有惯例时用。
- 只修改 open PR。重试续用原 branch/PR，实现变化后同步更新 body 的实现说明与证据，使其反映当前 head，再另发 PR-thread 评论。已合并记录及后续缺陷按全局路由处理。

## 实现说明（非纯文档 PR）

回答「这个 diff 为什么能解决 issue 写明的原因」。按变更实际相关的项写，没有的项不写，不填标签：

- **机制**：改在哪个责任单元、用了什么机制、它怎样消除 issue 写明的原因而非只压住症状；关键实现附文件 + 符号或 diff 锚点。私有算法修复即使不碰共享契约，也要说清关键机制。
- **契约**：维护或改变的契约落在哪个符号（owner PR 写明，供消费者快照）；消费的契约如何使用、未在本地扩展或重定义；不涉及共享契约就不写。
- **切换**：同步迁移的调用方、删除的旧路径与兜底；留下未迁移的写原因与承接 issue。
- **阅读入口**：diff 同时含中心逻辑与机械改动时，指出核心改动所在和哪些是机械跟随，给 reviewer 阅读顺序；单部件小改不写。
- **实现选择与偏离**：issue 留给实现者的选择，写所选方案与理由。改变操作员结果或跨单元契约的偏离不能在 PR 自行放行：PR 已存在时在 PR thread 提出，由 issue 契约更正或裁决后再实现。
- **未验证与风险**：已知未覆盖的路径、推断出而未观察的行为，明确标为未验证，不写成观察。

## 采集纪律（非纯文档 PR）

开始实施前对照 issue 的预期结果与验收表安排采集（纯文档 PR 不采集四层证据，见「纯文档 PR 模板」）。每条结果必须有直接观察它的真实路径证据；逐行映射 checkpoint，命令能逐字跑就逐字跑。契约命令有 typo 或过时时，先在 issue 明确更正契约，再发 retry intent；不默默改命令后声称原行通过。review 期间不能由实现者为迎合实现自行改写验收契约。

每段证据包含命令、环境、exit status、原样简明输出/日志或 reviewer 可访问工件，以及一句说明它证明哪个结果。只写本次亲眼观察到的值；不得重构丢失输出、修改数字/时间戳、挪用别次输出或拔高测试类型。丢失就重跑重抓，未结束的 CI 如实标 pending，不提前称通过。

套件 pass 计数、CI 绿勾、typecheck/lint/build 成功，以及实现者本次自写测试的 pass，**不进入任何证据层，也不承担结果覆盖**；它们仅在「卫生检查」附一行。需要的是能区分改对与改错的具体观察值，不是聚合计数。历史反例见 [acceptance-cases.md](../writing-issue/references/acceptance-cases.md)。

运行强度按 `~/.claude/rules/runtime-verification-required.rule.md`：Web 用 `skill://agent-browser` 完整执行真实用户路径，核对页面、接口与持久化/下游副作用，UI 改动截图进入 PR body。首页探活、单接口 curl 或 spec 名称不能替代它。

真实验证受阻时：属于本 PR 的问题先修；外部 blocker 用 `skill://writing-issue` 发布并写解除条件，确需操作员独有判断才提问。缺凭据先按全局 credentials 路由查 IaC/secret-store/tooling，不向用户索要 token。不得以 mock、stub、fake、in-memory 或单测填 Layer 4；没有证据不宣称 ready。确实无法解除的阻塞如实写 `Layer 4 阻塞——<原因> + <blocker issue 链接 / 已提出的问题>`，交 reviewer 裁决。

## 四层证据（非纯文档 PR）

四层均保留；不适用的层写 `不适用——<理由>`。每段输出后有结果映射分析，末尾另有 2–4 句总体分析。

| 层 | 采集内容 |
|---|---|
| 1：变更预演 | 声明式变更在 apply 前用 `tofu plan`、`--check --diff`、`kubectl diff`、migration dry-run 或 lockfile diff 观察预期变更；apply 后对照真实 state。纯代码可声明不适用，从 Layer 2 起。 |
| 2：落地核对 | 每项关键变更的 on-disk/on-process 读回：配置内容、已装依赖、服务地址、产物含新代码；代码可用 `git show` 定位目标 `file:line`。这只证明落地，不替代行为验证。 |
| 3：启动 / 运行时顺序 | 需重启、冷启动或部署时，采集干净的 post-change journal/log，检查顺序是否符合 issue 约束。 |
| 4：端到端业务行为 | 在真实系统执行 outcome/checkpoint，包含正面和负面用例，记录具体输入、响应或终态。纯库无 CLI/UI 时用固定输入的一次性 driver 直接调用公开 API（如 `bun -e`、`node -e`、`python -c`）；不能退回套件输出。 |

IaC 基础层变更的证据必须覆盖 preview、apply、live-state、runtime 行，plan-only/mock-only 不关合同。

裸 `is-active`、Running、HTTP 200 或 `Apply complete!` 是弱信号，须配具体内容/diff/读数。只有 log 没分析、无法打开的截图或只在本地 scrollback 的工件不合格。

验收映射可选紧凑行映射、逐字 transcript，或「表行 / 命令 / 结果 / log 路径与行号」表；卫生行单独标明，不冒充业务结果覆盖。

### 截图

用 `skill://image-share` 上传，PR body/评论使用返回的 `![](https://img.237575.xyz/media/<key>)`。贴前以 `curl -sI --max-time 8 "<url>"` 确认 200 和 `content-type: image/webp`；检查图片可见。

## PR body 模板

```markdown
Closes <owner>/<repo>#<N>

## 摘要

<1–3 句改动结果。>

## 实现说明

<机制、契约、切换、阅读入口、实现选择与偏离、未验证与风险中实际相关的项。>

## 变更预演（Layer 1）

<原样输出 + 分析，或不适用及理由。>

## 落地核对（Layer 2）

<每项关键变更读回 + 分析。>

## 启动 / 运行时顺序（Layer 3）

<post-change log + 分析，或不适用及理由。>

## 端到端业务行为（Layer 4）

<真实正面/负面路径、具体读数、截图/工件、checkpoint 映射及分析。>

## 卫生检查

<可选，一行如命令与 pass 数；不构成四层证据。>

## 分析

<2–4 句：观察值是否满足 outcome/checkpoint？未满足如何处理？没有这些证据会漏哪类 bug？>
```

## 纯文档 PR 模板

纯文档 PR 讲清这次改了什么、为什么这样调整、增加与减少了什么，不写四层证据、卫生检查和「分析」段。每段用无序列表，一个 bullet 概括一个要点：写思路与语义变化（新增了哪条规则、收窄了哪个边界、删掉了什么机制及原因），不按文件或行复述 diff，不贴改前改后原文，不写「修改了 X 文件第 N 行」。issue 的每条预期结果都要能在要点里找到对应。

```markdown
Closes <owner>/<repo>#<N>

## 摘要

<1–3 句：这次文档更新解决 issue 的什么问题。>

## 做了什么

- <一项改动的概括：哪份文档的哪部分语义变了，以及同步核对了哪些关联文档>

## 调整思路

- <为什么这样改：原有内容的问题或矛盾、依据、取舍与被否方案>

## 增加

- <新增的规则、概念、流程或章节要点>

## 减少

- <删除或收窄的内容，以及删减的原因；无则写「无」>
```

## 创建与 closing-link 核对

先按 `writing-issue` 的完整抓取入口确认真实目标 issue，准备完整 body 文件，再执行已授权的创建：

```bash
git push -u origin <branch>
gh pr create --repo <owner>/<repo> --title "<中文标题>" --body-file <body-file>
```

创建、body 修改都是状态变化。按 `~/.claude/rules/gh-full-fetch-issues-prs.rule.md` 重新完整抓取 PR 到本地，从 payload 的 closing-issue links 检查**恰好目标 issue**，不是只看非空或用 `first:5` 窄查询。没有完整抓取能力时报告 tooling gap，不能声称图边已验证。

为空/目标错误时检查 issue 身份、keyword 拼写与跨 repo 前缀；open PR 用 `gh pr edit <number> --repo <owner>/<repo> --body-file <body-file>` 修正，再完整读取验证。没有 `addClosingIssueReference` mutation；合并后不修 body。

## 重试评论模板（非纯文档 PR）

```markdown
## 重试意图

本次重试处理 <review comment URL>，续用 <issue 链接> 的现有 branch / PR。
计划动作：<收窄的改动或契约更正 + 验证命令>

## 实现变化

<本次重试改变了哪些机制、契约或切换，body 的实现说明已同步；未改实现则写「无」。>

## 重试证据

<采用四层及分析的同一骨架，写新鲜证据。>
```

若只修 issue 命令拼写且确实没改实现/body，明确写实现 commit 与 PR body 不变、契约已更正、按更正后的命令逐字重跑。普通讨论无需套证据模板。

纯文档 PR 的重试评论写「重试意图」（处理哪条 review comment、续用哪个 PR），再按纯文档模板的「做了什么 / 调整思路 / 增加 / 减少」用无序列表概括本次重试的变化，并同步更新 PR body。

## 发布前核对

确认目标 issue/child 正确、diff 单一连贯、实现说明与当前 head 一致并对得上 issue 写明的原因、四层无空缺、每段有诊断读数与分析、所有结果/checkpoint 有对应证据、图片可访问、blocked/pending 状态诚实。观察事实、推断与未验证项分开写，不把预期写成观察。纯文档 PR 改为核对：确属纯文档 diff；四段都是无序列表的要点概括而非 diff 复述；要点与当前 head 一致，没有漏掉实质语义变化；issue 每条预期结果都有对应要点。
