---
name: likec4
description: "Use when writing, refactoring, reviewing, or previewing standalone LikeC4 (.c4) architecture models, interactive C4 diagrams, Flows, or deployment views; skip SSoT projects (use ssot-c4 instead)."
---

# likec4：交互式架构建模（IcePanel 阅读体验）

本 skill 适用于纯 LikeC4 架构仓库（`*.c4`），目标是构建像 **IcePanel** 一样可逐层下钻、可逐步播放流程、卡片清爽且详情丰富的交互式架构站点，而非把 LikeC4 当成 PlantUML/Graphviz 静态大图导出器。若项目使用 `ssot check` / `#contract` / VDM / Quint，转用 `ssot-c4`。

---

## 一、四个核心准则

1. **单图认知预算（6～12 个节点）**：任何视图在浏览器默认 `Fit View`（100% 视口）下必须直接看清标题、图标与关系。节点或跨组连线过多时，按子域拆焦点视图并用 `view of` / `navigateTo` 串联点击下钻，严禁把 20 个容器和外部公共依赖画成一张蜘蛛网。
2. **画布极简，详情进抽屉**：卡片表面只放 `title` + `technology` + `icon` + 一句话 `summary`（≤25 字）；完整职责、约束、参数表、主机 `metadata` 与仓库 `link` 放进三引号 Markdown `description`（点击节点 `Open details` 查看）。严禁在视图 `description` 里手写文字图例——左下角原生图例由 `specification` 的 `notation` 自动生成。
3. **关系单一事实源（Single-Source Leaf Relations）**：每条交互只在**最深层真实端点**声明一次，上层容器图与全景图依赖 LikeC4 自动向上聚合（Rollup）；严禁在 L1、L2、L3 手工把同一条关系重复写三遍（会污染关系面板并制造重复边）。
4. **动态流程默认用架构叠加流（Diagram Flow）**：`dynamic view` **不写 `variant sequence`**（CLI 导出也**不加 `--seq`**），默认以架构拓扑叠加编号路径 + 右上角 **`Start ▶` 逐步走查** + 关键步骤浮动 **`notes` 卡片**呈现（读者仍可在页面顶栏随时切 `Sequence`）。

---

## 二、C4 层级与边界纪律

- **只建前三层逻辑元素，不手画第 4 层 `code`**：
  - 标准种类：`actor`、`system`、`externalSystem`（上游外部依赖）、`targetSystem`（被本系统交付或操作的目标对象，如受管应用栈、受管基础设施）、`container`、`store`（持久化存储）、`component`。
  - **严禁塞入伪组件/伪代码层**：YAML/脚本串行步骤（`-> '然后'`）、配置表行、路由枚举、数据结构包含树（`A -> B '包含'`）、1:1 单例套娃一律不建元素——执行先后归 `dynamic view`，算力池/主机分布归 `deployment`，单例基数写进 `summary` / `description`。
- **被交付对象移出系统边界**：系统部署出去的业务应用、IaC 管辖的基础设施与系统自身不是包含关系，统一建成外部 `targetSystem`，避免“容器部署自身同类容器”的自指混乱。
- **第三方现成软件停在 L2 黑盒**：不归本项目维护源码的现成二进制（GARM、Komodo、PostgreSQL、Keycloak、终端守护进程等）停在 `container` / `externalSystem`，不拆假想内部模块，不把配置资源种类（CRD/表记录）画成 `component`。
- **L3 组件层只拆自研/自维护核心单元**：
  - 严禁把纯文本 Prompt / Skill 文档画成主动发起网络调用的组件（所有外部 I/O 归到实际执行工具的运行时/扩展组件上）。
  - 单向请求不画同步“返回箭头”（避免双向标签重叠）。
  - 核对因果时机：派单/调度前发生的标签解析或路由决策，不得画进已启动的下游实例内部。

---

## 三、文件命名与视图目录组织

LikeC4 侧边栏默认停在 **`By files`** 页签，而首页总览网格按视图 `order` 排序。两边同时保持阅读顺序的做法：

```text
structure/
├── _spec.c4          # 元素种类、形状、关系样式、部署节点与标签（无视图，不占文件树）
├── 1-overview.c4     # views '1. 架构总览'   (order 1..9)   系统全景 Context + 内部容器总览
├── 2-<domain-a>.c4   # views '2. 子域与组件' (order 10..19) 子域焦点图 + 自研容器组件图
├── 3-<domain-b>.c4   # views '2. 子域与组件'
├── 5-flows.c4        # views '3. 动态流程 (Flows)' (order 20..39) 每个场景一张交互 Flow
└── 6-deployment.c4   # views '4. 部署拓扑'   (order 40..49) 全局网络主机总览 + 分域部署图
```

---

## 四、关键 DSL 写法与防坑细则（LikeC4 1.60+）

### 1. 元素属性顺序、图标与语义形状

- **`#tag` 必须写在元素块第一行**，早于 `icon`、`technology`、`summary`、`description`、`style`、`link`、`metadata`，否则报语法错误。
- **语义形状（`style { shape ... }`）**：`person`、`storage`、`queue`（消息/事件队列）、`agent`（AI agent 容器或运行时）、`browser`、`mobile`、`document`；多实例运行单元加 `multiple true` 显示叠卡。
- **内置图标**：使用 `tech:<name>`（如 `tech:github-icon`、`tech:github-actions`、`tech:docker-icon`、`tech:go`、`tech:rust`、`tech:linux-tux`、`tech:git-icon`、`tech:terraform-icon`、`tech:terminal`、`tech:anthropic-icon`）与 `bootstrap:<name>`（如 `bootstrap:shield-lock`、`bootstrap:router`、`bootstrap:clock`、`bootstrap:inbox`、`bootstrap:layers`、`bootstrap:key`、`bootstrap:check2-circle`）。不确定图标名时现场查 `node_modules/@likec4/icons/{tech,bootstrap}`，不臆造名字。

```c4
runnerManager = container 'GARM' {
  #ci
  icon tech:go
  technology 'Go · Service process'
  summary '按常驻优先、边缘溢出、arm64 专属调度一次性 runner'
  description '''
    ### 自托管 Runner 编排器
    - **常驻池 (`lxd_local`)**：VM 181 LXD，默认优先
    - **边缘池 (`incus_edge`)**：主力笔记本 Incus，承接溢出与高内存任务
  '''
  link https://github.com/cloudbase/garm 'Upstream'
  metadata {
    host 'VM 181'
    state 'SQLite'
  }
}
```

### 2. 渐进下钻与 `navigateTo` 的合法位置

- 为元素定义 `view <id> of <fqn>` 后，该元素在所有视图中自动带点击下钻入口。
- **`navigateTo` 严禁直接写在 `model` 的元素体内部**（语法不支持）；只允许出现在三处：
  1. **`model` 的关系体**：`runner.image -[mesh]-> registry '推送镜像' { navigateTo imageRelease }`（在静态图连线上生成跳转到 Flow 的按钮）；
  2. **`view` 或 `deployment view` 的 `include ... with`**：`include delivery.edgeGate with { navigateTo ciDomain }`、`include mesh.vm181 with { navigateTo deployCi }`（让未单独建 `view of` 的兄弟容器或主机节点也能点击下钻）；
  3. **`dynamic view` 的步骤体**：串联上下游子流程。

### 3. 总览去噪与子域焦点高亮

- **内部容器总览（`view deliveryView of sys`）**：用淡底色 `group`（`opacity 10%`）框出内部子域，保留 `actor`（`size sm`）与 `targetSystem`，**不把扇出极广的外部公共 SaaS（如 GitHub、Keycloak、镜像源）拉进内部容器总览**（它们已在上一层 Context 与下一层各子域焦点图中完整展示），从而彻底消除跨组蜘蛛网。
- **子域焦点图**：用 `style * { color secondary }`、`style <外部依赖> { color muted }` 压暗背景上下文，再用 `style <本子域核心容器> { color primary / green / indigo / amber }` 突出当前阅读焦点，外层系统边界框设 `opacity 8%`。
- 用 `rank source { ... }` 与 `rank sink { ... }` 将触发角色固定在入口侧、交付目标固定在出口侧。

### 4. 消除聚合边 `[...]` 折叠标（逻辑视图 vs 部署视图）

当同一对上层元素之间聚合了 ≥2 条下层叶子关系时，默认会折叠成 `[...]`：

- **逻辑视图（`view`）**：直接在视图内用 `include A -> B with { title '汇总后的动词短语' navigateTo ... }` 覆盖标题。
- **部署视图（`deployment view`）**：
  - **严禁写全局 `exclude * -> * where source.kind is component or target.kind is component`**：在单一叶子关系源写法下，由组件向上聚合出的容器间连线其底层端点仍是 `component`，全局排除会把所有正常的跨容器部署连线一并删光！
  - 正确做法：仅对确实产生多条组件投影的部署实例对，在 `deployment` 块补一条实例级关系（`zone.hostA.c1 -[mesh]-> zone.hostB.c2 '清晰标题'`），并在该部署视图里只排除这一对的组件投影：
    ```c4
    exclude mesh.vm180.agentRouter -> mesh.macmini.tern where source.kind is component
    ```
  - 若在 `deployment` 中用 `instanceOf <externalSystem>` 表示公网外部节点，先写 `exclude * <-> publicZone.**` 清掉无关全局投影，再显式 `include` 该节点实际关心的跨边界连线。

### 5. 交互式 Flow（`dynamic view`）与批注

- 只在关键设计决策、令牌时效、权限边界或异常兜底步骤上加三引号 Markdown `notes ''' ... '''`（`Start ▶` 走查到该步时在左上角弹出浮动卡片）。
- 若某一步在静态模型中没有同类型直连关系（或需覆盖静态默认样式），直接在步骤块内赋样式：
  ```c4
  delivery.runnerManager -> delivery.runtime '匹配 arm64 池，经 Incus 在 Oracle 创建容器' {
    color green
    line solid
    notes '''
      **跨机路径**：常驻池走同机 LXD，arm64 池与边缘池经 NetBird mesh 调远端 Incus HTTPS API。
    '''
  }
  ```

---

## 五、端到端验证清单（必做）

`npx -y likec4 validate <dir>` 通过只代表语法合法，**绝不代表图形可读**。交付前必须启动 `npx -y likec4 start <dir>`，用 `ego-browser` 打开页面按真实读者路径逐项核验：

1. **首页与目录顺序**：首页首屏前两张是否为 `系统全景 (Context)` 与 `系统总览 (Containers)`；左侧抽屉 `By files` 与 `By folders` 顺序是否整洁一致。
2. **100% 视口直读与零残缺**：逐张检查总览、子域、组件与分域部署视图，确认 `Fit View` 下卡片尺寸适中、无双向标签重叠、**全站无意外 `[...]` 折叠标**、部署视图连线完整未丢失。
3. **点击下钻与详情抽屉**：实测容器与部署主机的下钻跳转、关系线上的 Flow 跳转，并点开节点 `Open details` 核对 `summary`、Markdown `description`、`metadata` 与外链渲染。
4. **Flow 播放体验**：打开 `dynamic view` 确认默认处于 `Diagram` 模式，点击 **`Start ▶`** 并逐步点 `Next` 验证镜头聚焦移动与 `Notes` 批注卡片正常显示。
