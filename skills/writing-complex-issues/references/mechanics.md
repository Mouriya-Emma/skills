# GitHub 发布与图维护

## 发布顺序

先创建树根（umbrella，或充当树根的 audit）取得编号，再按依赖图创建 children：先无依赖的（通常是 owner），再有依赖的（消费者），最后创建总体验收 issue；Depends 引用真实编号后挂接并验证。编号取创建响应 URL，不预设连续；草稿占位符发布前替换成真实链接。coordinator 链接与「总体验收」一节指向的编号都在相应 issue 创建后编辑树根正文填入（区块见 umbrella-body「Coordinator 启动」「总体验收」）。

label 遵守目标 repo/preset 分类契约，不把别的 repo 的 `kind:code`、`kind:comment` 等当成通用分类。

读取前用 `ghc fetch` 完整落盘。挂接、re-parent、GraphQL 示例与失败恢复统一见 `skill://writing-issue/references/sub-issue-api.md`，不另用窄 ID 查询或 count-only 验证。每次变更后核对本地完整 payload 中的具体关系。

## 发布前核对

- SKILL.md「成树判据」已过：同方向 ≥2 个相关 issue 时有树根——umbrella，或充当树根的 audit（契约/设计在其决策 comment）；树根承载契约 / 总体验收指向 / 依赖图，不是按严重度分组的范围索引。下文「umbrella」对 audit 树根同样适用。
- 全树没有编排内容：由谁或哪个 agent、模型实现，实现顺序、并行、分支安排都不在 issue 里。
- 切分按 SKILL.md「切分轴」：children 是实现责任单元而非功能；每项权威契约在 umbrella 有语义、唯一 owner 与落地 owner child；消费者 Depends on owner 后置条件且不本地重定义契约；没有只能 typecheck 的空基座 child。`ghc lint <树根> --tree` 通过：恰好一个总体验收 issue、组合对象与依赖完整、每个非 e2e child 出现在总体验收的「经由」里、每个 child 自身合契约。
- 每个 child 的目标可追溯到方向 / 契约 / repo 既有承诺；追溯不到的进口目标未立 child。
- 单个 issue 满足 `skill://writing-issue` 的来源、原子性、中文正文和逐条结果验收；没有内部脚手架，引用都在完整来源中核实。
- 方向四槽已落位：指称有证据；目标是自包含的结果陈述，没有贴操作员原话；动机有来源，操作员独有事实已在写作期问得；交付约束转绝对日期并入契约。
- umbrella 系统定位在契约之前；总体验收 issue 的验收行逐行可证伪，残留及例外有 owner。
- 非 retroactive 树根正文末尾有 coordinator 徽章链接：指向树根自身编号，`cwd` 是树根所在 repo 已核实存在的本机 checkout 绝对路径并按查询值编码，没有裸 URL。
- child 继承的树内新裁决条款以契约引用写入，且 `ghc fetch` 能展开；权威文档已承载的内容以必读章节（路径 + 章节锚点 + 用途）引用，没有复写或摘抄；结果用性质描述；最省事路径不能钻过验收表；只能实现后观察的已定方案结果有具名 child 的 assumption 验收行，没有预写的失败备选方案。
- 全文没有未决问题、待定、unknown、「归 PR / 再说」、「清点后再开」占位或指向未来结论的 Depends：写作期缺口都经 decision-closure 取得事实或裁决，master record 有裁决、依据与被否方案。
- 完整 thread 的 comment 层已交付，作者自审已做完且发现都已改进正文；issue 里没有审查记录。仅草稿任务可按入口规则延后，但不宣称树完成。
