---
paths:
  - "/**/omomp/**"
---

# oh-my-omp 仓库的公共能力与开发范式（二：依赖、Shell、文档、发布、缓存与验证）

接 `omomp-plugin-paradigm` 规则；两条规则共同构成 oh-my-omp 仓库的约定。

## 依赖与宿主类型

插件跟随 omp 的最新发布：omp 一升级，插件代码里与新版宿主不符的地方就成为类型错误，修好后随下一次发布到达客户机。宿主包是 `@oh-my-pi/` 下的 `pi-agent-core`、`pi-ai`、`pi-catalog`、`pi-coding-agent`、`pi-natives`、`pi-tui`、`pi-utils` 与 `omptype`。

- **不锁版本：** `package.json` 的 `dependencies`、`devDependencies`、`optionalDependencies` 每一项写 `latest`，`peerDependencies` 每一项写 `*`；不写版本号、版本范围或指向某个提交的 git 引用。宿主包之外的依赖同样如此。
- **类型来自宿主导出：** 描述宿主对象的类型只从宿主包的导出 import，或由导出类型派生（`Pick`、`Omit`、`Parameters`、`ReturnType`、索引访问）。不写 `declare module "@oh-my-pi/…"`，不手写与宿主导出同形的 interface 或 type，不把宿主值收成 `unknown` 再用手写守卫或 `as` 还原。动态 `import()` 宿主子路径时，结果本身已带宿主类型；要在类型注解里写模块的形状，在文件顶部 `import type * as M from "…"` 后用 `typeof M`，不在注解里写 `import("…")`。旧版 omp 缺导出时要给出明确错误的加载点，守卫也写在宿主类型上：参数取 `Partial<Pick<typeof M, 名称>>`，逐个检查 `typeof … === "function"`，返回 `Pick<typeof M, 名称>`。
- **不用旧包名：** omp 加载插件时把 `@earendil-works/*`、`@mariozechner/*` 的同名包解析成 `@oh-my-pi/*`，把 `typebox`、`@sinclair/typebox` 解析成 `@oh-my-pi/omptype/typebox`。插件不依赖这些包，类型检查也不以它们为准。例外是跟踪外部上游的 omp-unified-exec：源码沿用上游的 `@earendil-works/*` 写法以免同步冲突，`tsconfig.json` 的 `paths` 把它们指到 `@oh-my-pi/*`，与 omp 的解析一致；`typebox` 的 import 则改写成 `@oh-my-pi/omptype/typebox`，因为 `paths` 指向 omptype 源码会得到与宿主不同的第二份 `TSchema` 类型。
- **进程外的数据：** 会话 JSONL、子进程输出、工具调用的 `input` 等仍在边界解析；宿主导出了这份数据的类型时，解析结果标成该类型（例如 `ZodLikeSchema<宿主类型>`），宿主改了形状就报类型错误。
- **锁文件与检查：** 锁文件照常提交。检查 workflow 按锁文件安装后，把 `package.json` 列出的宿主包升到 npm 最新版，再跑类型检查与测试，并检查上面的版本写法与 `declare module`；各仓库的检查 workflow 另有每天一次的定时运行。omp 发布不兼容的新版后，各仓库的检查在一天内失败，先修类型再合并其他改动。本地复现前先把宿主包升到最新。
- **不管的类型错误：** tsc 报 `@oh-my-pi/pi-coding-agent` 没有导出 `isMountableUnderXdev`、`XDEV_KEEP_TOP_LEVEL` 时，不修、不排查，也不在回复、issue、PR 或 comment 里提它；它不影响任何 PR 的合并。

## 命令交给 shell

用户机器上的 shell 各不相同：Windows 上常常只有 Windows PowerShell 5.1，它启动原生程序时会丢掉参数里的双引号；cmd、PowerShell 与 POSIX shell 的引号写法也互不相通。所以 omomp 的代码不为任何平台 shell 写命令行。需要 shell 语法时，一律交给 omp 自带的 pi-shell，写 POSIX 语法，各平台走同一条路径，不分平台写分支。omomp 不用 cmd：不启动 `cmd.exe`，不写 `.cmd`/`.bat` 文件，也不用会在 Windows 上落到 cmd 的 `shell: true`。

- **不需要 shell 语法：** 直接 spawn argv，不经任何 shell。
- **omp 进程内执行一条命令行**（例如用户配置的命令）：用宿主导出的 `Shell`（`@oh-my-pi/pi-natives`）的 `run({ command })`。不 spawn `sh`、`bash`、`cmd`、`powershell`、`pwsh`，不用 `shell: true` 或 `child_process.exec`。`Shell` 在第一次 `run` 时给进程环境拍快照，之后才写进 `process.env` 的变量看不到，要经 `run({ env })` 传入。
- **交给 Tern pane 的命令：** Tern 把 `-- ` 之后的 argv 按用户的 pane shell 引号化后交给它执行，没有设环境变量或绕过 pane shell 的选项。参数都是程序名、路径和不含 `"` 的固定词时，直接写 `tern split|new tab … -- <程序> <参数…>`。要设环境变量，或参数是任意文本（可能含 `"`，例如 prompt）时，写成 `-- omp bash -c '<行>'`，这样只有一个参数带 shell 语法。Windows PowerShell 5.1 启动原生程序时会丢掉参数里的每一个 `"`，所以这一行里不能出现 `"` 字符。
  - 每个词用单引号包住，`'` 写成 `'\''`，`"` 写成 `'$'\x22''`（bash 的 ANSI-C 引号，由 pi-shell 还原成 `"`）。
  - 用 `omp bash`，不用 `omp sh`：后者是 POSIX sh 模式，不支持 `$'…'`。
  - 设环境变量用前缀赋值 `VAR=值 命令`。不用 `env` 程序，Windows 上没有它；也不用 `exec`，pi-shell 的 `exec` 只把含 `/` 的词当路径，Windows 的反斜杠路径会被当成命令名去 PATH 里找。
  - 宿主的 `quotePosixArgv` 不能用在这里：它不处理 `"`，它的 ASCII 版本还会写出 `"$(printf …)"`。
  - Tern 插件（Luau）的 `layout:split` 只接受命令串，没有一种引号写法对所有 pane shell 都成立。所以插件要开 pane 时，经 `tern.process.run` 调 `tern` CLI，或者交给插件的 TS 侧去开，不给 `Launch.command` 写命令串。
- **调用宿主没有，或宿主的写法不满足调用方的 Windows 系统能力**（例如回收站，或要读退出码的打开 URL）：走 Windows PowerShell。以 argv 启动 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`（绝对路径，不用裸名）`-NoProfile -NonInteractive -Command <固定脚本>`。脚本是代码里写死的文本，要处理的数据经环境变量传入，不拼进脚本。参考 omp-config delete-guard 的回收站调用。
- **默认 shell：** 用户自己选了 shell（omp 的 `shellPath`、工具调用的 `shell` 参数）就照用户的选择，PowerShell 也在可选之列，cmd 不在。没有选择时用 pi-shell（`omp bash`），不兜底到 PowerShell。
- **例外：** 发给远端 Linux 主机的 shell 行（ssh、Komodo）。

## 文档

- **用户文档：** 组件的用户文档就是仓库根目录的 README：英文 `README.md` 与中文 `README.zh-CN.md` 两份，开头有互相切换的语言行，逐节同步，各用自己的语言写，不逐句对译。
- **README 的内容：** 列出组件的全部机制，相关的机制归在同一个加粗的组名下。每个机制一条，写明它做什么、在什么时机注入或触发，以及一个取自源码的真实实例（英文版是 Does / When / Example，中文版是 功能 / 时机 / 实例）。带演示视频或 GIF 的 README（omp-playbooks、omp-dispatch）保留原有结构。
- **README 之外的：** 模型运行时读取的 topic 正文、`AGENTS.md`、开发者文档（构建、CI、沙箱、fork 维护记录、设计与评测记录）和 `CHANGELOG.md`。

## 发布与 changelog

omomp 体系就是 `~/Ext/code/omomp/` 下的仓库：omp-config 和各 `omp-*` 插件。不在这个目录的插件不属于体系，本节不管。体系内的仓库一视同仁、各自独立发布；没有中心清单，不在任何地方登记成员。

- **加入与退出：** 插件可以随时加入或剔除。新插件加入 omomp 目录时，要有本节格式的 changelog、`release` 分支、发布 workflow，包的 `package.json` 顶层要有 `omomp` 声明。包根目录是 `package.json` 所在目录：插件是仓库根目录，omp-config 是 `agent/extensions/_shared`（客户机上以插件 `omp-config` 链接）。新插件同时要有按“文档”一节写的中英两份 README。剔除时删掉发布 workflow 或归档仓库；客户机卸载这个包后，它不再出现在合并显示里。
- **changelog 格式：** 文件名是 `CHANGELOG.md`（lgit 只认这个名字）。沿用 omp 自己的格式。顶部是 `## [Unreleased]`，每个版本一段 `## [X.Y.Z] - YYYY-MM-DD`，段内用 `### Breaking Changes`、`### Added`、`### Changed`、`### Deprecated`、`### Removed`、`### Fixed`、`### Security` 分类。每个顶层列表项是一项变更，客户机按它计数。
- **PR：** 只在 `## [Unreleased]` 的分类下写条目，不改版本号，不新增版本段。合并到 main 不是发布。
- **条目由 lgit 写：** 提交用 [lgit](https://github.com/can1357/llm-git)：`git add` 后运行 `uvx --from lgit-cli lgit`。它生成提交说明，并把每个暂存文件的用户可见变化写进最近上级目录的 `CHANGELOG.md`（路径上没有时用仓库根目录的那份）的 `## [Unreleased]`；同一提交里手写的条目它保留不重写。lgit 读 `~/.config/llm-git/config.toml`：接口是 futureppo-pool（`https://pool.futureppo.top/v1`，`api_key` 由 `!bun -e …` 命令从 `~/.omp/agent/models.yml` 的 `futureppo-pool` 项读出），三个模型角色都用 `gpt-6.2-sol`。本机 `omp auth-gateway serve` 只转发 auth-broker 里有凭据的 provider，不含 futureppo-pool。
- **发布时机：** 每天 GMT+9 02:00 定时发布一次（GitHub Actions 的 `schedule` 只按 UTC 写：`cron: "0 17 * * *"`），另可用 `workflow_dispatch` 手动发布。`## [Unreleased]` 为空时不发布。
- **版本号：** 由这次发布的条目分类决定：有 `Breaking Changes` 时，1.0 及以上升 major，0.x 升 minor；否则有 `Added` 升 minor；其余升 patch。
- **一次发布：** 把 `## [Unreleased]` 的内容改写成新版本段，日期用发布那一刻的 GMT+9 日期，再补一个空的 `## [Unreleased]`；同步 `package.json` 和其他携带版本号的文件（如 `plugin.toml`）；在 main 上提交 `chore: release X.Y.Z`，打 tag `vX.Y.Z`；把 `release` 分支快进到这个提交；用这一段正文建 GitHub Release；当前版本的 tag 已推送却没有 GitHub Release 时，下一次发布运行先补建它。main 上不再有每次 push 都升版本的 workflow。
- **发布流程的位置：** 每个仓库自己的 `.github/workflows/omomp-release.yml` 是完整的 job，不调用其他仓库的 workflow：它检出 `oh-my-omp/shared` main，运行其中的 `release.ts`，参数与触发时机写在本仓库。
- **检查流程的位置：** 每个仓库自己的 `.github/workflows/omomp-check.yml` 是完整的 job，同样不调用其他仓库的 workflow：它检出 `oh-my-omp/shared` main，依次跑依赖写法检查（`deps.ts check`）、依赖安装、宿主包升级（见“依赖与宿主类型”）、Biome 与 TypeScript 类型检查（`bun run check`）、本仓库测试（`bun run test`）和公共代码副本比对（`verify.ts`）；仓库自己的测试入口与专属测试环境留在仓库里。包管理器统一用 bun，锁文件只有 `bun.lock`。例外是跟踪外部上游的 fork（omp-unified-exec）：它保留上游的包管理器、锁文件和自己的 CI，自己的 CI 同样在安装后把宿主包升到最新再检查；它的 omomp-check 只跑依赖写法检查与副本比对，避免每次同步上游都在锁文件上冲突。
- **分发通道：** `release` 分支是发布通道，main 是开发集成。插件的安装 spec 写 `<git url>#release`；omp-config 的自动更新应用 `release` 分支。
- **成员声明：** 包的 `package.json` 顶层写 `"omomp": { "changelog": "CHANGELOG.md" }`，`changelog` 是相对包根目录的路径，这个文件要随包安装（有 `files` 字段时要列进去）。不放进宿主读取的 `omp` 段。
- **omp-config 的 changelog：** 在仓库根目录 `CHANGELOG.md`，所以 lgit 覆盖整个仓库（包括客户机经更新器读取的 `install-plugins.sh`）。更新器把它复制到客户机的 `<agentDir>/extensions/_shared/CHANGELOG.md`；`agent/extensions/_shared/package.json` 的声明写 `CHANGELOG.md`，指向客户机上的那份。仓库里这个相对路径不存在，所以 omp-config 的发布 workflow 用 `--changelog CHANGELOG.md` 指向仓库根目录的那份。
- **客户机合并显示：** omp-config 每次启动从已装包现场读取成员（声明了 `omomp` 的包加 omp-config 自己），每个成员按自己的“上次看过的版本”取出新的版本段，按版本段日期、再按组件合并成一份 What's New。各仓库同一时刻发布，同一批发布的日期相同，日期就是合并的分组键，所以版本段日期必须是 GMT+9 发布日。

## 启用工具集与缓存

工具定义和挂成 bash 命令的工具说明（`tools.commandDocs` 控制的目录与内联 `--help`）属于 system / tools 前缀。provider 按前缀 hash 命中缓存，所以前缀的集合和顺序都必须确定。插件自己的工具在会话中途变得可用或不可用时，用差分消息告诉模型，不改前缀。

- **顺序：** 写启用集只调用一次 `pi.setActiveTools(规范顺序)`。规范顺序是：请求里的内置工具排在前面，按 `pi.getAllTools()` 的注册表顺序；其余名称按码点排序并去重。宿主在这个顺序的基础上把顶层工具排在挂成 bash 命令的工具之前，两组内部都保持传入顺序。因此同一个集合总是得到同一份前缀，fork、`wt` 等重建出来的对话也能命中缓存。`pi.getActiveTools()` 返回的是宿主的展示顺序，只能按集合比较，不能和规范顺序逐位比较。实现：`oh-my-omp/shared` 的 `src/active-tools.ts`（`applyActiveTools`），各仓库用它的副本。
- **生命周期与基线：** 一个 system 生命周期从会话构建（`session_start`、`session_switch`）开始，到前缀下一次重建为止。起点时，插件按规范顺序写入自己在本生命周期可能用到的全部工具。集合相同时规范顺序得到的前缀也相同，所以起点可以无条件写；恢复的会话要靠这次写入重建带插件工具的基础 system prompt。写入后的自有工具集就是基线。宿主调用不到未启用的工具，因此要在起点就启用，不能等到需要时再加。
- **差分：** 生命周期内只要启用条件变了（例如 remote-build 换目录后不再满足条件），插件就拿基线和自己当前可用的工具做差分，不改启用集。差分只覆盖本插件的工具，作为 user 尾部的隐藏消息投递：`<system-reminder source="<插件名>/tools">`，列出当前不可用的工具和原因，以及恢复可用的工具；差分为空时撤回。实现是 `oh-my-omp/shared` 的 `src/context-delta.ts`（`createDeltaStream(source)`，source 由调用方给出完整的 `<插件名>/<id>`），各仓库用它的副本。投递点是 `before_agent_start` 结果里的 `message`，以及 `tool_result` 的 `additionalContext`；以当前分支投影中该 source 的最后一块为准，内容相同不重发，新块声明取代旧块。
- **拦截：** 在基线里但当前不可用的工具，在 `tool_call` 里 `block`，并给出不可用的原因。
- **基线外的新需求：** 生命周期内出现基线里没有的工具需求时，才按规范顺序改写启用集，接受这一次缓存失效；改写后的自有工具集成为新基线。
- **subagent 的 `todo`：** 在 subagent 里，宿主会从扩展的每次 `setActiveTools` 中滤掉 `todo`，由 omp-todo-ng 在每次模型调用前补回。其他插件不需要处理这件事。

## 验证

- 改了 topic，要在真实 omp 里读一次 `help://<tool>` 和 `help://<tool>/<topic>`，确认指针行和正文。
- 改了参数定义或工具说明，要在真实 omp 里看发给模型的结果：发一条消息后执行 `/dump`，打开它报告的 `omp-llm-request-*.json`。顶层工具看 `tools[]` 里该工具的 `parameters`：根是 `type: "object"`，任何层级都没有 `anyOf`/`oneOf`、类型数组、`additionalProperties` 为 schema 或 `true` 的对象，对象嵌套不超过两层，每个字段带 `description`。挂成 bash 命令的工具在真实 omp 里运行一次 `<tool> --help`，同时看快照 `systemPrompt`（或会话中途注册时的挂载通知）里的条目：系统提示里前 200 字已说清用途和需要读的 `help://` 地址，`--help` 里的 `Options` 每项都有清晰的类型与说明、没有退化成 `<JSON>` 的混合类型或冲突/保留字段告警。两者的工具说明和 topic 都不复述参数签名。
- 改了语言解析，要跑 `omomp-plugin-paradigm` 规则“面向人的文字的语言”一节的测试向量，再在真实 omp 里触发一段面向人的文字。
- 改了交给 shell 或 pane 的命令：在 Windows 真实 Tern 里从用户入口触发一次，pane shell 用 Windows PowerShell 5.1；带空格、单引号、双引号、反斜杠路径和结尾反斜杠的参数都要原样到达。macOS 上同样触发一次。
- 改了发布 workflow 或 changelog 格式：手动触发一次 `workflow_dispatch`，确认 `## [Unreleased]` 为空时不发布；不为空时版本段、`package.json` 版本、tag、`release` 分支和 GitHub Release 正文一致。
- 改了 changelog 位置、文件名或 lgit 配置：在临时克隆里改一个会到达客户机的文件，`git add` 后运行 lgit，确认条目落在该成员 changelog 的 `## [Unreleased]` 下。
- 改了启用工具集或差分：在真实 omp 里让启用条件来回切换两次，确认 system / tools 前缀在两次切换前后不变，差分消息出现后又被撤回，拦截给出原因。
- 改了 shared 的公共代码：确认每个声明了该文件的仓库都收到同步 PR，PR 里副本与 shared main 一致、`## [Unreleased]` 有条目、检查 workflow 通过；再在真实 omp 里经其中一个插件触发被改的行为。
- 改了 README：在 GitHub 上打开 `README.md` 与 `README.zh-CN.md`，确认两份的分组与条目一一对应、语言切换行互相指向；每条的实例在当前代码里能找到。
- 改了依赖或宿主类型的写法：在宿主包升到最新后跑 `bun run check` 与 `bun run test`，再在真实 omp 里加载该插件并调用一次它的工具。
- e2e 的具体做法见 `omp-maintenance` rule。
