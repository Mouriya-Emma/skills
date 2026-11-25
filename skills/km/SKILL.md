---
name: km
description: >-
  Komodo (km) for homelab and trading apps. Use to onboard a new app, move an app out of IaC, release an image or apply declarations through GitHub webhooks into km, deploy/restart/stop/destroy Stacks, debug containers, run ResourceSync/Action/Procedure, run Komodo Build/Repo, clean Docker disk (prune images/volumes), back up or restore Core metadata, call the API for CLI gaps, and manage Core connections/profiles. Read the matching reference before any command.
allowed-tools: Bash, Read, Write, Edit, Glob
hide: true
---

# km：Komodo 上的 app

km 是 Komodo 的 CLI。**Core** 管理资源，把工作派给各 **Server** 上的 **Periphery**。**Stack** 是 Server 上的一个 Compose 项目；容器是它的运行实例，不是声明来源。新 app 用 Stack，不新建单容器 Deployment。

app 归 km 还是归 IaC，按 `personal-infra-routing` 规则的归属判据定。本 skill 只处理归 km 的 app 和 km 自身资源。

## 选 Core，每条命令都带 `-p`

| Core | 位置 | 说明 |
|---|---|---|
| `homelab` | homelab-app1 / VM 110，`http://homelab-app1.mouriya.lan:9120` | Server `Local` 是同机 Periphery；其余 Server 以 `ls servers` 为准 |
| `trading` | trading-agent / VM 130，`http://trading-agent.mouriya.lan:9120` | 独立 Core，workload 见 `homelab-trading` skill |
| `nekoringo` | nekoringo1 `218.33.108.254`，由 `mouriya-devops/nekoringo-iac` 的 `apps/komodo` 部署 | 专用主机，不属 homelab；Server `nekoringo1`（Core 与边缘服务）、`nekoringo2`（生产与测试 workload） |

- 上表是主要 Core；本机登记的全部连接以 `bash ~/.claude/skills/km/bin/list.sh` 为准。每条命令以 `km -p <core>` 开头，没有"当前 Core"，也没有默认 Core。`km` 是本 skill 的 `bin/km`：它按连接清单经 `bao-exec` 从 OpenBao 取该 Core 的 API key，只在这一条命令的环境里有效；清单与安装见 `references/endpoints.md`。
- Server、Stack 的名字和 ID 只在本 Core 内有效。先列出再操作：`km -p "$core" ls servers`、`km -p "$core" ls stacks -a -f json`。
- 本机 km CLI 版本高于 Core 时，`ls stacks`、`ls servers`、`ps` 可能直接报 `ERROR: 200 OK`。此时用 `references/api.md` 的版本匹配 REST 读（`ListStacks`、`ListServers`），不要换 Core 或改配置。

## 权威：谁声明什么

| 对象 | 声明者 | 改动入口 |
|---|---|---|
| Stack、compose | app 的 workload repo：`komodo/syncs/*.toml` + `stacks/<name>/compose.yaml` | 改 repo，push 后由 GitHub webhook 触发该 repo 的声明部署（见下文第 6 步） |
| app 的 secret / 运行值 | OpenBao 的 `kv/<owner>/<repo>/runtime`，字段名即 compose 插值的名字；`<owner>/<repo>` 是该 repo 的规范名 | 操作员的 `admin` token 写入（`bao kv patch … FIELD=-`，值走 stdin）；Stack 的 `compose_cmd_wrapper` 让 Periphery 在部署时用 `bao-exec` 取 |
| workload repo 自己的 ResourceSync 对象 | 操作员以 `admin` 建一次；之后由该 repo 的 workflow 更新字段 | Komodo 2.3.4 里 `CreateResourceSync` 只允许 admin，CI service user 做不到；workflow 在 Sync 缺失时失败，需要时由操作员补建 |
| workload repo 的 Procedure（声明部署、镜像发布部署）及其 `webhook_secret` | workload repo 的 workflow，经 API 注册，id 记在 repo 里；`webhook_secret` 取自该 repo 的 `ci` 组 | workflow；不写进 Sync TOML |
| outbound Periphery 的 Server 记录 | Periphery 自己用 onboarding key 注册 | 安装 Periphery 的一方 |
| Core、Periphery 安装，Core 配置与 `[secrets]`，inbound Server 记录，私有 registry 拉取账号与刷新 Action，Core 的公网 listener 入口 | 安装 Komodo 的 IaC repo（`iac-projects`） | 该 IaC repo 的流程；这里不出现任何 app 名 |

规则：

- 声明只在 git 里改。`km` 和 API 用于读、运行时操作和有界重试，不当第二个声明来源；直接改 live 配置会被下一次 sync 覆盖或形成漂移。
- repo 为空、`file_contents` 非空的 Stack 不是 repo 声明的 Stack。把它搬进一个 workload repo；不要新建这种 Stack，也不要往 IaC 里放它的声明。
- workload repo 的 CI 是每个 Core 一个非 admin 的 service user（`komodo-ci`），在 Stack、ResourceSync、Procedure 上可写；它持有 Core 的 CI API key，只读 OpenBao 里本 repo 的 `ci` 组与所属 Core 的 `kv/mouriya-devops/homelab-tf/komodo-ci-<core>`（`KOMODO_URL`、`KOMODO_API_KEY`、`KOMODO_API_SECRET`）。它不能写 Variable，也不能建 ResourceSync；那把 key 由 Komodo 安装铸造，不要复制到别处，也不要把 admin key 交给 CI。
- 消费 OpenBao 值的 Stack 靠 `compose_cmd_wrapper` 取到值。漏设 wrapper 的 Stack 会以空值启动而不报错，是这套交付方式唯一没有运行时防护的失败形态，新增或修改 Stack 时必须核对（见第 4 步）。
- 本表描述设计。某个对象现在实际由谁创建，以 live 读为准（`ls syncs`、`ls stacks -a`、`ls servers`），不要按记忆推断。

## 接入一个 app，或把 app 从 IaC 迁到 km

1. 按归属判据过一遍：列出从空状态到声明功能可用、以及重建和升级时需要的每个动作。compose 外的动作能内置的，先改镜像、entrypoint 或 compose init（例如用 init 服务创建 bind 目录并 `chown`，用 entrypoint 从 env 落盘密钥文件）。退役的服务不接入。
2. 选 workload repo：已有 `homelab-apps`（homelab Core 的 `Local`）、`homelab-trading`（trading Core）等；源码公开而部署需要私有内容时，用单独的私有部署 repo（如 `moat-browser-deploy` 之于 `moat-browser`）。
3. 写 `stacks/<name>/compose.yaml` 和 `komodo/syncs/` 里的 `[[stack]]`；私有镜像绑定 `registry_provider = "registry.237575.xyz"`、`registry_account = "sa-registry"`。容器要读的值写进 OpenBao 的 `kv/<owner>/<repo>/runtime`，字段名就是 compose 里的变量名；compose 写 `${KEY}`，不写 `${KEY:?…}`（Komodo 另有不经 wrapper 的 compose 子命令，必填插值会让它们失败），`environment` 里不再出现这些键的 `[[KEY]]`。
4. 每个插值 runtime 值的 Stack 都设 wrapper，不设 `compose_cmd_wrapper_include`：

   ```toml
   compose_cmd_wrapper = "bao-exec run --path kv/<owner>/<repo>/runtime -- [[COMPOSE_COMMAND]]"
   ```

   Komodo 2.3.4 的默认 include 只有 `up`。把 `config` 加进 include 会把插值后的值写进 `deployed_config` 与 Update 日志 —— 永远不要加。runtime 值由 Periphery 在部署时经 wrapper 读取，不经过 `.env`：Komodo 把 Stack `environment` 的条目写进 `/etc/komodo/stacks/<stack>/.env`，`config`/`pull` 不经 wrapper 且读这个文件，所以它可以含非机密字面值（如第 7 步的版本号），但不能含任何迁到 `runtime` 的键。`environment` 非空时每次部署整份重写这个文件；`environment` 为空时 Komodo 不碰已有的 `.env` 并继续把它交给 compose，迁移前由 `[[KEY]]` 写入的明文因此会一直留着。迁移后按键名核对每个 Stack 的 `.env`，清掉迁到 `runtime` 的键。
5. workflow：在 `ci` 相关声明、workflow 本身或 Procedure 注册依赖的声明变化时运行；用 GitHub Actions OIDC 登录 OpenBao（`BAO_EXEC_AUTH=github-actions`、`BAO_EXEC_ROLE=ci-<owner>-<repo>`），经 `bao-exec` 读本 repo 的 `ci` 组与所属 Core 的 `komodo-ci-<core>`，以 `.github/scripts/` 下的脚本运行同步逻辑：更新本 repo 的 ResourceSync 字段（含 `webhook_secret`；Sync 缺失时失败而不是创建）→ 经 API 注册本 repo 的 Procedure（Get→Create 或 Update→Get，读回 id 与字段）→ RunSync → 等终态。Procedure 不写进 Sync TOML：RunSync 会把 TOML 里省略的字段重置为默认值，workflow 写入的 `webhook_secret` 会被清空。CI 不写 Variable，也不解密任何文件。
6. 声明部署 webhook：repo 的 push 事件指向 Core 公网 listener 上本 repo 的声明部署 Procedure `https://<Core 公网 listener>/listener/github/procedure/<id>/main`，secret 等于该 Procedure 的 `webhook_secret`。Procedure 第一阶段 RunSync，第二阶段对每个 `deploy = true` 的 Stack 执行 `DeployStackIfChanged`；后者先刷新 Stack 的 repo 缓存再比较，所以只改 compose 或 `config_files` 的提交也会部署。实例是 `homelab-apps` 的 `sync-homelab-apps`。push 直接指向 Sync listener `/listener/github/sync/<sync 名>/sync` 只在该 repo 的部署变化全部落在 Sync TOML 字段上时够用（如版本写在 Stack `environment` 的 runner-canary）：RunSync 不刷新 Stack 的 repo 内容，只改 compose 或配置文件的提交得到 No Changes，不会部署。`*.mouriya.lan` 只在 mesh 内可解析，GitHub 送不到，不能用作 webhook 地址。Core 的公网 listener 入口属于 Komodo 安装，由 `iac-projects` 定位的 IaC repo 提供；还没有时，在该 repo 开 issue，不要临时暴露整个 Core。
7. 镜像发布：源码 CI 不持有 Komodo 凭据；Stack 保持 `auto_pull = true`，不用 `auto_update`（私有镜像查 digest 不带 registry 账号）。
   - 源码 repo 与 workload repo 分离：源码发布 workflow 推完镜像（先推不可变 tag，再移动通道 tag）后，用自己的 `GITHUB_TOKEN`（`permissions: deployments: write`）创建 GitHub Deployment，`environment` 取 Stack 名，`ref` 取发布 commit SHA。源码 repo 上有一个只订阅 `deployment` 事件的 hook，指向 workload repo 注册的 Procedure `deploy-<stack>`：`/listener/github/procedure/<id>/__ANY__`。该 Procedure 只有一个 `DeployStack <stack>`，`webhook_secret` 专用、不与 Sync 或其他 Procedure 共用。listener 不区分事件类型，创建 hook 时的 ping 也会执行一次部署：先确认运行镜像等于通道 tag 当前 digest，再建 hook。
   - 源码 repo 即 workload repo：release workflow 推完镜像后，把精确版本作为字面值写进本 repo Sync TOML 中该 Stack 的 `environment`（compose 用该变量引用镜像 tag）并 push，由第 6 步的 push hook 部署。版本不放在 Komodo Variable。
   - 部署撞上同一 Stack 的其他操作时以 busy 失败并留下失败的 Update；恢复方式是在 GitHub 重投该 delivery。
8. 新增一个 secret 并让 compose 引用它时分两步：先用 `admin` token 把它写进 OpenBao（`bao kv patch kv/<owner>/<repo>/runtime NEW_KEY=-`，值走 stdin，不进 argv），再提交引用它的 compose 与 wrapper。只改已有 secret 的值（轮换）不会部署任何 Stack：RunSync 与 `DeployStackIfChanged` 比较的是声明和 repo 文件，不比较 wrapper 读到的值（Komodo 2.3.4 只在真正执行 `DeployStack` 时插值）；写完对使用该字段的每个 Stack 执行 `km -p <core> x deploy-stack <name>`。
9. 验证：push hook 或 Deployment hook 触发的执行终态（Procedure 各阶段或 RunSync）、Stack 的 repo/branch/文件路径、容器状态与运行镜像，以及 app 声明功能的真实使用路径。
10. 从 IaC 迁来的 app：迁移时一次性的数据搬运和切换按源仓库的迁移规则做 A/B 核对；切换完成后，在 IaC repo 开 issue 删除它的部署声明。

## 写值与轮换

运行值只经 `admin` token 写进 OpenBao；日常是操作员 OIDC 登录，`oidc/` 不可用时用 break-glass。写入形态固定为「值走 stdin」：`bao kv put` 替换整条路径，`bao kv patch` 合并单个字段，字段名必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$` 且值为字符串。核对用管道里的摘要或解码结果，不打印值。

Variable 不是运行值的交付路径：迁移后的键在 Core 里没有对应 Variable，也不要为了"让部署拿到新值"再造一个。

## 先读 reference，再执行命令

下面每类操作在执行任何命令前，必须先读对应 reference；没读不执行。

| 意图 | reference |
|---|---|
| 部署、重新部署、拉镜像、重启、启停、拆除 Stack | `references/stack.md` |
| 看或操作单个容器、查容器在哪台 Server | `references/container.md` |
| 运行 ResourceSync、Procedure、Action；commit-sync | `references/gitops.md` |
| Komodo 里的 Build 或 Repo（不是 GitHub Actions 构建） | `references/build.md` |
| Docker 磁盘满，清理镜像、构建缓存、网络、卷 | `references/cleanup.md` |
| Core 元数据库备份、恢复、复制、清理备份 | `references/database.md` |
| CLI 不支持的操作或字段，直接调 REST | `references/api.md` |
| Core 连接清单、profile、新 Core、401 | `references/endpoints.md` |

## 停下确认的操作

这些操作不可逆或影响范围大。执行前必须读对应 reference，列出确切范围和影响，并取得覆盖该影响的明确授权；保留交互确认，不加 `-y` 绕过：

- `destroy-stack`、`destroy-container`、整台 Server 的操作；
- 任何 `prune-*`、`delete-volume`、`delete-image`；
- `db restore`、`db copy`、`db prune`；
- 会删除资源的 RunSync，以及 `commit-sync`。

## 完成的标准

一次执行被接受不等于完成。看执行的终态结果，再读回资源状态，最后用 app 的真实使用路径验证；sync 成功或容器 running 不证明 app 可用。失败时先读终态日志和当前状态，在声明来源修正后只重试受影响的对象，不扩大重试范围。
