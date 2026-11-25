---
paths:
  - "/**/omomp/**"
---

# oh-my-omp 仓库的公共能力与开发范式（一：归属、公共代码、工具、语言与宿主 API）

`~/Ext/code/omomp/` 下是 GitHub oh-my-omp org 的仓库：omp-config、各个 `omp-*` 插件（包括 omp-dispatch）、`omomp-site` 和 `shared`；org 的 `.github` 仓库只放组织主页，不放代码、workflow 或脚本。各仓库保持独立，安装后彼此没有运行时依赖：多个仓库都要用、行为必须一致的代码只在 `oh-my-omp/shared` 维护，各仓库提交它的副本（见“公共代码”）；其余公共能力靠下面这些约定保持一致。改其中任何一个仓库，都按本规则与 `omomp-plugin-paradigm-workflow` 规则（依赖、shell、文档、发布、缓存与验证）的约定写；碰到约定没覆盖的公共能力，先改这两条 rule，再写代码。

## 归属

- 每项能力由拥有它的仓库自己声明，经宿主原生的通道发布。不回 omp-config 登记，不 import omp-config 的任何路径（包括 `~/.omp/agent/extensions/_shared/`），不用 `Symbol.for("omp-config…")` 去找它的内部对象，也不依赖 omp-config 先加载。
- 插件在没装 omp-config 的 omp 里必须照样完整可用。
- omp-config 只拥有它自己的扩展、它给宿主内置工具写的覆盖文档，以及它对宿主内置工具的调用限制。限制可以拒绝某类宿主工具调用，并指明改用哪个插件工具，但只给一行 `help://<tool>` 或 `<tool> --help` 指针。它不为别的仓库的工具注册、索引、配置或仲裁任何东西：不解析、不评判插件工具的调用内容，不下发插件的配置文件，不抄写插件工具的用法。
- omp-config 读取已装包在自己 `package.json` 顶层 `omomp` 字段里的声明和它随包发布的 changelog，用来在客户机上合并显示更新内容（见 `omomp-plugin-paradigm-workflow` 规则的“发布与 changelog”）。这是读取各包自己发布的事实，不算登记或索引；插件不依赖它，没装 omp-config 时照样发布、照样可用。

## 公共代码

- **源头：** `oh-my-omp/shared` 的 main 是公共代码唯一的修改点。各仓库里的副本是派生物，不在副本上改；要改行为先改 shared。只服务一个仓库的代码、仓库专属的文字表不进 shared。
- **声明：** 用到公共文件的仓库在自己仓库里声明用了哪些文件、各自落在本仓库的什么路径。没有中心清单，shared 靠这些声明找到消费方。
- **同步：** shared 的 main 有改动时，由 shared 的 workflow 以 org 的 GitHub App 身份，给每个声明了受影响文件的仓库开同步 PR，并在该仓库的 `## [Unreleased]` 写一条条目，使副本随下一次发布到达客户机。消费仓库不自己拉取。
- **检查：** 每个仓库的检查 workflow 比对声明的副本与 shared main 上的文件，内容不同或缺失就失败。
- **运行时：** 副本在包内按相对路径 import；不 import shared 包，不跨包 import。安装后的插件不知道 shared 存在。

## Issue 的位置

- `oh-my-omp/shared` 不开 issue。
- 公共 issue 从 omp-config 起：涉及多个仓库或公共能力的 RFC、umbrella、child，以及要改 `oh-my-omp/shared` 的工作，都开在 `oh-my-omp/omp-config`。只涉及一个插件仓库的问题开在那个仓库。
- 代码仍在它所在的仓库提 PR：改 `oh-my-omp/shared` 的 PR 开在该仓库，正文用 `Closes oh-my-omp/omp-config#N` 关闭 omp-config 里的 issue。

## 工具 topic

- 把工具的详细调用说明放在 `pi.registerTool` 定义对象的 `docTopics: () => Readonly<Record<string, string>>` 上：key 是 topic 名（`[A-Za-z0-9_.-]+`），value 是 markdown 正文。宿主读 `help://<tool>`（列出 topic）和 `help://<tool>/<topic>`（读单篇正文）时调用它。
- 宿主的 `ToolDefinition` 类型没有声明 `docTopics`，用交叉类型补上，例如 `ToolDefinition<typeof params> & { docTopics(): Readonly<Record<string, string>> }`，不用 `as` 或 `any`。参考 omp-ask-ng 的 `index.ts`（注册时的交叉类型）与 `src/description.ts`（`docTopics()`）。
- `docTopics()` 只返回正文。topic 文件可以带 `title`/`when` 头，由插件自己解析；读取时才生成的 topic 写在函数里。
- 工具说明开头保留一句话说清用途：不常用的插件工具（`loadMode` 省略或为 `"discoverable"`）在 bash 可用时挂成 bash 命令，系统提示里只保留说明的前 200 字，后面跟 ``… (full text: `<tool> --help`)``（`tools.commandDocs` 为 `catalog` 时只保留单行摘要，按需运行 `<tool> --help`）。挂成命令的工具应在前 200 字内写清用途和需要读的 `help://` 地址；完整说明的最后逐行列出 topic，每行写完整 URL：

  ```
  Topics — read the one a call needs before making it:
  - `help://<tool>/<topic>` — <何时读，一行>
  ```

- 正文和调用指引里引用 topic 时写完整的 `help://<tool>/<topic>`；指引模型调用时，顶层工具直接写工具名，挂成命令的工具写 bash 命令形态（`<tool> <args>` 或 `<tool> --json '{…}'`），eval 场景写 `await tool.<tool>({…})`。`tool://` 只属于 omp-config 给宿主内置工具写的 topic，插件不用。

## 工具参数

工具给模型的信息分三层，各写各的，不互相复述：参数定义写单个字段，工具说明写用途，topic 写跨字段的流程。

- **字段说明：** 参数定义里的每个字段都带说明（zod `.describe()`、TypeBox `description`），嵌套对象和数组元素里的字段同样要带，选择操作的枚举字段（`op`、`action`）也要带。说明写这个字段的含义，以及它有的格式、单位、默认值和适用的 `op`/`action`。宿主把参数定义渲染成 `--help` 选项列表时会丢掉 `regex`、`min`/`max` 等约束，所以 ID 形态（如 `b3`）、取值范围也写进说明。多个 `op`/`action` 共用的字段，在共用的 schema 常量上写一次。
- **工具说明：** 只写用途和何时用。
- **topic：** 锁、生命周期、多步流程、返回值形状等跨字段、跨调用的说明。
- 工具说明和 topic 都不用 `{a, b?}` 这类写法复述参数签名，也不写单个字段的含义、格式或默认值；这些只在字段说明里。返回值形状（如 `→ {block}`）不是参数签名，可以写。
- **形状：** 所有工具的参数定义都只用下面的形状，不论是否声明 `loadMode`：
  - 根是单个对象（`type: "object"`）。
  - 任何层级都没有对象联合（zod `z.union`/`z.discriminatedUnion` 的对象分支、TypeBox `Type.Union` 的对象分支）。一个参数或字段有多种形状时，写成一个对象：枚举字段（`op`、`action`、`kind`）选形状，其余字段可选，说明里写适用哪些取值。execute 入口再 parse 成判别联合，拒绝不属于该取值的字段和缺少的必填字段。参数定义里没有声明的键，宿主会在校验前删除，execute 收不到，所以入口只需要处理已声明的字段。
  - 没有键名任意的字典（`z.record`、`additionalProperties` 为 schema 或 `true`）和结构不定的值（`z.unknown()`、`z.any()`）。需要成组的键值时，用元素为固定字段对象的数组，例如 `{name, value}`。
  - 没有多种基本类型任选：不用 `z.union([z.string(), z.number()])` 这类联合，也不用 `.nullable()`。一组字面量取值写成 `z.enum`（渲染为 `enum`，不是 `anyOf`），不算任选。可以省略的值用 `.optional()`；“清空”“取消”等需要与省略区分的意思，用枚举取值或单独字段表达。
  - 对象最多嵌套两层：根的字段可以是对象或对象数组（第一层），这些对象的字段还可以是对象或对象数组（第二层），第二层对象的字段只能是标量、枚举或标量数组。

  违反这些形状时，模型拿到的定义要么被拒，要么被改写：Kimi Code 等 OpenAI 兼容端点要求根是 `type: "object"`，根是 `anyOf` 时整次请求返回 400；omp 的 Anthropic provider 把根上各分支合并成一个对象，再把原 union 整段写进根 `description`；挂成 bash 命令的工具在生成 `--help` 时也会把 `anyOf`/`oneOf` 各分支拍平合并、把混合基本类型或任意字典退化成 `<JSON>`；宿主 `tools.commands` 关闭或 bash 不可用时，`loadMode: "discoverable"` 的工具同样作为顶层 provider 工具发送。

## 面向人的文字的语言

通知、标签、对话框、渲染器等面向人的文字，每次生成时按下面的顺序决定用英文还是中文。发给模型的文字不走这套逻辑。

1. `OMOMP_LANG`：去首尾空白、转小写后是 `en` 或 `zh` 就采用，其他值忽略。omp-config 的 omomp-lang 扩展会按它的插件设置 `omomp-lang.language` 导出这个变量；插件只读环境变量，不读 omp-config 的任何配置。
2. `LC_ALL`、`LC_MESSAGES`、`LANG` 中第一个去空白后非空的值：以 `zh` 开头（不分大小写）就是中文，否则英文。
3. 英文。

补充规定：
- 环境变量每次解析时重新读。不在模块顶层（import 时）求值文字；factory 里注册的命令说明和工具 label 每个会话求值一次，可以接受。宿主只接受字符串的注册元数据（例如 Tern Luau 插件的 `tern.command` 标题）在插件加载时求值一次，同样可以接受；其余文字仍在生成时解析。
- 插件不读 omomp 文件来决定语言。
- 实现：`oh-my-omp/shared` 的 `src/i18n.ts`，各仓库用它的副本（见“公共代码”）。omp-config 把 `omomp-lang.language` 设置放进环境映射后调用其中的 `languageFrom`。
- 改动语言解析后，用下面的测试向量自检：

| 环境 | 结果 |
|---|---|
| `OMOMP_LANG=" ZH "` | zh |
| `OMOMP_LANG=zh-CN`，`LANG=en_US.UTF-8` | en |
| `LC_ALL=""`，`LC_MESSAGES=zh_CN.UTF-8` | zh |
| `LC_ALL=C`，`LANG=zh_CN.UTF-8` | en |
| 全部未设置 | en |
| 无 `OMOMP_LANG`，agent 目录 `omomp.yml` 写 `omomp-lang: {language: zh}`，`LANG=en_US.UTF-8` | en（不读 omomp 文件） |

**图形界面应用**（例如 NSH 写的 Meerkat，仓库 mouriya-s-lab/meerkat，沿用本节约定）没有 omp 进程环境，从 Finder 或浏览器启动时上面的环境变量通常都没设。它们在第 2 步与第 3 步之间加一步：取平台报告的首选语言列表（NSH `locale_settings().languages`；macOS 是系统首选语言，web 是浏览器语言），第一个以 `zh` 开头的语言排在第一个以 `en` 开头的语言之前就用中文，否则英文。web 端没有环境变量，只走这一步与英文兜底。平台语言是响应式的：系统或浏览器语言改变后，界面文字随之切换，不需要重启。

| 环境（图形界面应用） | 结果 |
|---|---|
| 无环境变量，首选语言 `["zh-Hans-CN", "en-US"]` | zh |
| 无环境变量，首选语言 `["ja-JP", "zh-CN"]` | zh |
| 无环境变量，首选语言 `["en-US", "zh-CN"]` | en |
| `LANG=en_US.UTF-8`，首选语言 `["zh-Hans-CN"]` | en（环境变量优先） |
| web，浏览器语言 `["zh-CN"]` | zh |
| web，浏览器语言 `["fr-FR"]` | en |

## 配置、模型角色和宿主 API

- **插件配置：** 插件配置用宿主原生的插件 settings：在 `package.json` 写 `omp.settings`，用户在 `/settings` → Plugins 或 `omp plugin config` 里改，代码里用 `getPluginSettings` 读。omp-config 自己也以插件 `omp-config` 的身份这样声明它的扩展配置。omomp 文件里已有的插件段（例如 omp-unified-exec 的配置段）保持原样，不再新增插件段。
- **模型角色：** 插件自己用的模型角色叫 `@<插件名>`，不需要写进 omp-config 的 `modelTags`；用户在 `/model` 里用 "+ New role" 绑定。角色没有绑定时，插件要有明确的退路（例如用会话模型或宿主的 judge 链），不能报错卡死。
- **宿主能力：** judge、模型角色解析、子进程等能力，直接用宿主包的导出，不复制 omp-config `_shared` 里的封装。用到宿主包的子路径时，要在真实的 omp 进程里确认能加载：omp 二进制只映射显式导出的路径，`tsc` 通过不代表能运行。
- **宿主已经处理过平台差异的能力，插件不自己写：** 先查宿主（与已安装 omp 同版本的源码）有没有，有就调用；宿主没有，或在 Windows 上实测不覆盖插件要处理的情况时，才在插件里写，并在代码旁写明宿主缺什么。宿主已有的能力包括：
  - 本机 IPC：`ipcEndpoint(dir, name)`、`IpcServer.listen`、`IpcConnection.connect`（`@oh-my-pi/pi-natives`）。Windows 上是命名管道，POSIX 上是 socket 文件，过长的路径由宿主改放到短目录，认领、残留和权限也由宿主处理。插件不自己拼 socket 路径，不自己做认领；判断端点是否有人监听，连一次看 `ENOENT`/`ECONNREFUSED`，不 `stat` 端点。宿主把 `dir` 字符串当身份，两端要传同一个规范化后的目录。
  - 打开 URL 或文件：`openPath`（`@oh-my-pi/pi-coding-agent/utils/open`）。它不返回结果，打开失败只写日志；调用方要据失败立即报错时，按 `omomp-plugin-paradigm-workflow` 规则「调用宿主没有的 Windows 系统能力」的写法自己启动 PowerShell `Start-Process`，读它的退出码。
  - 路径：展开 `~` 用 `expandTilde`（`@oh-my-pi/pi-utils`；它也把 `~name` 展开成 `<home>/name`，只接受 `~` 与 `~/` 的地方不用它）；显示时把 home 缩成 `~` 用 `shortenPath`（`@oh-my-pi/pi-tui/render`；它随包是 TS 源码，插件若要在 Node 宿主上加载，不能静态 import 它）。宿主的 `pathIsWithin`、`relativePathWithinRoot`、`normalizePathForComparison`、`resolveEquivalentPath` 不能用来判断 Windows 上的路径包含：它们用 `fs.realpathSync`，在 Windows 上不解析 8.3 短名和 junction，同一目录的这两种写法会被判成在目录外。包含判断两侧都用 `realpathSync.native` 求真实路径再比较。
  - 进程：argv 启动与整树终止用 `ptree`，识别用户选的 shell 属于哪一类用 `procmgr`（`@oh-my-pi/pi-utils`）。默认 shell 不取 `procmgr.getShellConfig()` 的结果：它在 Windows 上最后会落到 `cmd.exe`。
- **公共小工具：** 只有几行的辅助函数（如 `errorText`）在各仓库内联即可，不放进 shared。

