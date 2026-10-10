---
name: writing-issue
description: 起草或修订单个 GitHub issue，定义结果验收和 parent 归属，写作期当场收口遗漏、不留未决项；相关 issue 树转 writing-complex-issues。
---

# writing-issue

本 skill 管单个 issue 的问题与原因、责任定位、必要决策、结果契约和归属。发布的 issue 不含未决问题或等待结论的阻塞项：写作中发现的遗漏按 [decision-closure](../writing-complex-issues/references/decision-closure.md) 当场收口——取得事实，或与 subagent 讨论后裁决。两个及以上相关 issue 用 `skill://writing-complex-issues` 组织成树；PR 实现说明与证据用 `skill://writing-pr`，关闭裁决用 `skill://review-pr`。

## 先取得事实

- 按 `~/.claude/rules/github-issue-pr-routing.rule.md` 分配 issue/PR 语义；更严的 repo-local `CLAUDE.md` 优先。目标 repo 使用 coder-loop preset 时，先读 `presets/<preset>/contract.md` 的分类 label、必需段和 review replay 契约。
- 读取 issue/PR 必须按 `~/.claude/rules/gh-full-fetch-issues-prs.rule.md` 一次完整落盘：正文、全部讨论/评审、timeline、checks、labels、assignees、图边和附件，分页取全；随后只分析本地文件。先遵守该规则要求的落盘位置规则。不用 `gh issue view` 的窄输出或仅 ID 查询代替完整上下文；现有工具无法完成完整抓取时明确 tooling gap，不假设存在 helper。
- 每句动机可追溯到真实来源：原文引用 + issue/PR 链接、`owner/repo@<sha>`、代码或日志锚点，或操作员方向原文与日期。转述标清来源；不拼接不同来源伪装成一句引用，矛盾要点明。
- 起草前落实业务输入：具体 workload、样本总体、使用场景、验证对象及受益者。不能以未定义的「真实 / 目标 / 代表性 X」替代，也不把定义责任下推给实现者。源未指定且调查未能确定的目标扩展、依赖、约束不自行添加；实现目标必然遇到的分叉（非法或不存在的输入、重复请求、并发竞争、错误报告方式）不是扩展，按「方案边界」裁决。

## 一个问题，一份结果契约

**原子性：** 一段连贯 Why 能论证整个 issue；若自然裂成几个独立问题，就拆 children，由 umbrella 说明共同 driver，树内 children 按 [writing-complex-issues](../writing-complex-issues/SKILL.md)「切分轴」沿实现责任切分，不按功能切。不要按版本、批次、repo、时间窗或标题关键词机械分组，归属要读实际 body 后判断。标题和正文不放草稿 ID、agent ID、working-group 名或临时源树路径；关联项用标题或真实链接。

**问题写到原因：** 先写可观察症状与影响，再写原因：哪个责任单元的哪项状态/规则、哪条不变量或缺失的能力产生了症状，附文件 + 符号 + 当前行为的概念锚点。原因在写作期查证并带证据：派 subagent 读代码、复现、查日志或跑实验，不开前置调查 issue Blocks 实现，也不把未证实原因标成假设留给实现者。不影响修法的旁支原因不写。多个症状同根时写根及其覆盖面。新功能没有被违反的不变量，写现有责任单元缺什么能力，不编造违约。原因不是改法：写「值在 Y 处未经 parse 跨域」，不写「在 Y 加校验函数」。

**责任定位：** 写明问题落在哪个现有责任单元；它维护相关状态/规则（owner，核心）还是只消费既定契约（外围）；哪些调用方或消费者受影响、是否需同步迁移。状态的 owner 在别的单元、repo 或外部系统时，issue 向 owner 提请求或依赖它，不在消费侧另立副本。跨单元的目标边界属于必要决策，写作期裁决；单元内模块划分留给 PR，不预选。纯文档、文案等不涉及共享状态的改动，写一行责任单元即可，不为填段编写 owner 分析。

**方案边界：** 按 [decision-closure](../writing-complex-issues/references/decision-closure.md) 的 a/b 判据：会改变操作员观察结果、或迫使另一实现单元同步改变的分叉（权威归属、状态空间、错误分类、接口语义），在 issue 裁决并写入「责任与必要决策」，只钉协作所需的最小语义；单元内部组织、算法、私有命名、模块划分留给 PR。裁决先查代码现状与项目既有惯例，不以「源未说明」列成未定义；缺事实就在写作期取得，设计分叉与 subagent 讨论后当场裁决并写依据与被否方案；操作员独有事实（业务动机、商业约束）缺失且会改变目标时，写作期直接问操作员。按 decision-closure 处置外部 owner 状态与只能实现后观察的结果。树内 child 不自行裁决跨单元契约：继承树根已裁决条款并逐字快照，写作中发现缺失或冲突当场回到树根裁决，发布后才暴露的走树根设计修正。源要求的外部契约照写。

**结果从原因推出：** 预期结果写问题消失后可观察的性质，按真实风险追问：哪些性质要成立、哪些已有性质不能变、相关的拒绝输入或非法转移如何处理、生命周期终点和适用边界在哪。只写本次确有的项，不为填表罗列不相关边界。

**未知：** 未文档化第三方行为、跨环境可行性等高风险假设在写作期验证，结论带证据写入。只能在实现后观察的已定方案结果写成 `assumption` 验收行，不预写失败备选方案。环境暂不可用的验证必须有具名下游 owner，写入继承验证义务；继承义务不可二次延期。

### checkpoint 写法

future-work 的每行都有 `Dimension / Check / Command / Env / Expect`：具体可执行命令、目标环境、期望读数或 exit status。维度按真实风险选择 `function`、`environment`、`integration`、`assumption`；涉及 Docker、网络、部署、browser、外部服务或跨 repo 时不能 function-only。

`## 预期结果` 每条 bullet 必须由至少一行通过真实路径直接观察**该结果本身**，Check 列点名覆盖条目。typecheck、套件计数、残留 grep 仅作卫生补充，不计入覆盖。覆盖行也不能引用本次实现者将自写的测试；用固定文本 inline driver、真实 CLI/API/UI 或外部终态读数，避免测试注值绕过真实入口。运行强度遵从 `~/.claude/rules/runtime-verification-required.rule.md`。

checkpoint 验结果和被拒的无效行为，不用它强制个人实现偏好。某结果当前无法检验，改成可检验形态或明确进入具名继承义务，不留隐式缺口。发布前模拟最省事的通过路径：若用户问题没解决也能全绿，锐化结果 checkpoint；易混术语首次出现即消歧。

## 模板

正文中文、简练；代码标识符、命令、路径、API/label、维度名、`Depends on` / `Blocks` / `RFC:` 保留英文，源引文和工具输出保持原样。已落地用过去时，计划工作用祈使句。

### future-work 实现 issue

```markdown
# <中文标题：一个问题>

## 目标

<设计源或用户请求中的目标。>

## 上下文

- **Repo**: `owner/repo`（path: `/local/path`）
- **Working directory**: <如适用>
- **Design doc / source**: <路径、issue/PR 链接或用户请求原文>
- **Conventions**: <跨 repo 时明确遵从哪一份契约>
- **Anchors**: <文件 + 符号 + 当前行为；实施前 grep 核对行号>

## 问题

<症状与影响；原因（责任单元、状态/规则、不变量或能力缺口）及写作期查证的证据；Why 与来源。不写代码改法。>

## 责任与必要决策

- **责任单元**: <现有单元；owner（核心）或消费者（外围）>
- **受影响方**: <调用方/消费者及是否同步迁移>
- **决策**: <已裁决的跨单元或目标级决策、依据与被否方案。无则写「无」>

## 预期结果

- 结果 1：<问题消失后可观察的性质或终态，含相关拒绝/边界行为。>

## 范围边界

- **不应残留**: <本次确有的旧路径、兜底、字面量>
- **不在范围**: <邻近但不做的项及其归属>

## 约束

<可选；源强加的外部约束，或树内继承的契约条款快照。>

## 验收标准

| # | Dimension | Check | Command | Env | Expect |
|---|-----------|-------|---------|-----|--------|
| 1 | function | 覆盖结果 1：<直接观察什么> | `<可执行命令>` | <具体环境> | <读数 / exit code> |

## 继承验证义务

<可选；同验收表，加 From / Original # 列，注明 owner，不可二次延期。>

## 依赖关系

- Depends on: <issue 链接>（<需要的上游已交付后置条件，不是待产出的结论>）
- Blocks: <issue 链接>（<谁需要本结果>）
```

umbrella child 的继承快照、使用场景、baseline、不应残留等扩展按 [child-body.md](../writing-complex-issues/references/child-body.md)，不另设一套 child 模板。

### retroactive umbrella

追溯性组织属于树，使用 [umbrella-body.md](../writing-complex-issues/references/umbrella-body.md) 的 retroactive 模板。它记录已落地事实，不使用未来 Acceptance 清单；不回写已落地 issue/PR。

## 归属、发布与修订

1. 按要改的对象选 home repo：对象由哪个 repo 声明就开在哪个 repo。app 的部署归 km 还是 IaC，按 `personal-infra-routing` 规则的归属判据定，不按 driver 来自哪里定。
2. 先定 parent。通过完整本地 payload 确认已有 parent 仍合适；新层级先建 parent 再建 child。一个 child 一个 issue parent，另一条线用散文引用。跨 repo（同 org）可连接，无需复制任务。
3. API 操作及失败恢复见 [sub-issue-api.md](references/sub-issue-api.md)。PR 只用 closing keyword 连接 issue，不参与 sub-issue 边。
4. 发布前检查：原子 Why 与来源、症状到原因的证据链、责任定位与必要决策、无未决项或指向未来结论的依赖、具体业务输入、外部约束与继承契约、逐条结果覆盖、范围边界、可跑命令和真实风险维度、延期验证 owner、对抗捷径，以及 repo/preset 必需段。起草中的 Source bundle 和内部脚手架不落 GitHub。
5. 活跃 issue（包括 umbrella 和原子 child）的错误引用、作废前提、错误范围或过时铺垫直接替换；裁决、范围扩展、设计演进以 comment 留迭代记录。树内同时核对引用锚和活跃 child 的继承快照，按 [comment-layers.md](../writing-complex-issues/references/comment-layers.md) 保持当前任务与决策记录一致；已落地记录遵守全局不可变边界。

历史验收失败案例仅在需要理解反例时读 [acceptance-cases.md](references/acceptance-cases.md)。
