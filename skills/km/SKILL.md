---
name: km
description: >-
  Komodo (km) for homelab and trading apps. Use to onboard a new app, move an app out of IaC, release an image or apply declarations through GitHub webhooks into km, deploy/restart/stop/destroy Stacks, debug containers, run ResourceSync/Action/Procedure, run Komodo Build/Repo, clean Docker disk (prune images/volumes), back up or restore Core metadata, call the API for CLI gaps, and manage Core connections/profiles. Read the matching reference before any command.
allowed-tools: Bash, Read, Write, Edit, Glob
---

# km：Komodo 上的 app

km 是 Komodo 的 CLI。**Core** 管理资源，把工作派给各 **Server** 上的 **Periphery**。**Stack** 是 Server 上的一个 Compose 项目；容器是它的运行实例，不是声明来源。新 app 用 Stack，不新建单容器 Deployment。

app 归 km 还是归 IaC，按 `personal-infra-routing` 规则的归属判据定。本 skill 只处理归 km 的 app 和 km 自身资源。

## 选 Core，每条命令都带 `-p`

| Core | 位置 | 说明 |
|---|---|---|
| `homelab` | moat-app1 / VM 110，`http://moat-app1.mouriya.lan:9120` | Server `Local` 是同机 Periphery；其余 Server 以 `ls servers` 为准 |
| `trading` | trading-agent / VM 130，`http://trading-agent.mouriya.lan:9120` | 独立 Core，workload 见 `homelab-trading` skill |
| `nekoringo` | nekoringo1 `218.33.108.254`，由 `mouriya-s-lab/nekoringo-iac` 的 `apps/komodo` 部署 | 专用主机，不属 homelab；Server `nekoringo1`（Core 与边缘服务）、`nekoringo2`（生产与测试 workload） |

- 上表是主要 Core；本机登记的全部连接以 `bash ~/.claude/skills/km/bin/list.sh` 为准。每条命令写 `km -p <core>`，没有"当前 Core"。生成配置里的 `default_profile` 只是 CLI 兜底，不是选择依据。
- Server、Stack 的名字和 ID 只在本 Core 内有效。先列出再操作：`km -p "$core" ls servers`、`km -p "$core" ls stacks -a -f json`。
- 本机 km CLI 版本高于 Core 时，`ls stacks`、`ls servers`、`ps` 可能直接报 `ERROR: 200 OK`。此时用 `references/api.md` 的版本匹配 REST 读（`ListStacks`、`ListServers`），不要换 Core 或改配置。

## 权威：谁声明什么

| 对象 | 声明者 | 改动入口 |
|---|---|---|
| Stack、compose、Stack 的 Variable 引用 | app 的 workload repo：`komodo/syncs/*.toml` + `stacks/<name>/compose.yaml` | 改 repo，push 后由 GitHub webhook 触发该 repo 的声明部署（见下文第 5 步） |
| app 的 secret | workload repo 根目录 SOPS `secrets.yml` | 该 repo 的 workflow 解密后写成 km Variable，再 RunSync |
| workload repo 自己的 ResourceSync 对象 | workload repo 的 workflow | workflow 在 RunSync 前做"不存在就创建，存在就局部更新" |
| workload repo 的 Procedure（声明部署、镜像发布部署）及其 `webhook_secret` | workload repo 的 workflow，经 API 注册，id 记在 repo 里 | workflow；不写进 Sync TOML |
| outbound Periphery 的 Server 记录 | Periphery 自己用 onboarding key 注册 | 安装 Periphery 的一方 |
| Core、Periphery 安装，Core 配置与 `[secrets]`，inbound Server 记录，私有 registry 拉取账号与刷新 Action，Core 的公网 listener 入口 | 安装 Komodo 的 IaC repo（`iac-projects`） | 该 IaC repo 的流程；这里不出现任何 app 名 |

规则：

- 声明只在 git 里改。`km` 和 API 用于读、运行时操作和有界重试，不当第二个声明来源；直接改 live 配置会被下一次 sync 覆盖或形成漂移。
- repo 为空、`file_contents` 非空的 Stack 不是 repo 声明的 Stack。把它搬进一个 workload repo；不要新建这种 Stack，也不要往 IaC 里放它的声明。
- workload repo 的 workflow 持有的 Core API key 是 admin key：Variable 写入和 ResourceSync 创建在 Komodo 2.2 都只允许 admin。这是已知的信任范围，不要再往别处复制这把 key。
- 本表描述设计。某个对象现在实际由谁创建，以 live 读为准（`ls syncs`、`ls stacks -a`、`ls servers`），不要按记忆推断。

## 接入一个 app，或把 app 从 IaC 迁到 km

1. 按归属判据过一遍：列出从空状态到声明功能可用、以及重建和升级时需要的每个动作。compose 外的动作能内置的，先改镜像、entrypoint 或 compose init（例如用 init 服务创建 bind 目录并 `chown`，用 entrypoint 从 env 落盘密钥文件）。退役的服务不接入。
2. 选 workload repo：已有 `homelab-apps`（homelab Core 的 `Local`）、`homelab-trading`（trading Core）等；源码公开而部署需要私有内容时，用单独的私有部署 repo（如 `moat-browser-deploy` 之于 `moat-browser`）。
3. 写 `stacks/<name>/compose.yaml` 和 `komodo/syncs/` 里的 `[[stack]]`；私有镜像绑定 `registry_provider = "registry.237575.xyz"`、`registry_account = "sa-registry"`。secret 进 repo 根 SOPS，compose 用 `[[KEY]]` 引用。
4. workflow：在 `secrets.yml`、workflow 本身或 Procedure 注册依赖的声明变化时运行；解密 → 不存在就创建、存在就局部更新本 repo 的 ResourceSync（含 `webhook_secret`）→ upsert Variables → 经 API 注册本 repo 的 Procedure（Get→Create 或 Update→Get，读回 id 与字段）→ RunSync → 等终态。Procedure 不写进 Sync TOML：RunSync 会把 TOML 里省略的字段重置为默认值，workflow 写入的 `webhook_secret` 会被清空。
5. 声明部署 webhook：repo 的 push 事件指向 Core 公网 listener 上本 repo 的声明部署 Procedure `https://<Core 公网 listener>/listener/github/procedure/<id>/main`，secret 等于该 Procedure 的 `webhook_secret`。Procedure 第一阶段 RunSync，第二阶段对每个 `deploy = true` 的 Stack 执行 `DeployStackIfChanged`；后者先刷新 Stack 的 repo 缓存再比较，所以只改 compose 或 `config_files` 的提交也会部署。实例是 `homelab-apps` 的 `sync-homelab-apps`。push 直接指向 Sync listener `/listener/github/sync/<sync 名>/sync` 只在该 repo 的部署变化全部落在 Sync TOML 字段上时够用（如版本写在 Stack `environment` 的 runner-canary）：RunSync 不刷新 Stack 的 repo 内容，只改 compose 或配置文件的提交得到 No Changes，不会部署。`*.mouriya.lan` 只在 mesh 内可解析，GitHub 送不到，不能用作 webhook 地址。Core 的公网 listener 入口属于 Komodo 安装，由 `iac-projects` 定位的 IaC repo 提供；还没有时，在该 repo 开 issue，不要临时暴露整个 Core。
6. 镜像发布：源码 CI 不持有 Komodo 凭据；Stack 保持 `auto_pull = true`，不用 `auto_update`（私有镜像查 digest 不带 registry 账号）。
   - 源码 repo 与 workload repo 分离：源码发布 workflow 推完镜像（先推不可变 tag，再移动通道 tag）后，用自己的 `GITHUB_TOKEN`（`permissions: deployments: write`）创建 GitHub Deployment，`environment` 取 Stack 名，`ref` 取发布 commit SHA。源码 repo 上有一个只订阅 `deployment` 事件的 hook，指向 workload repo 注册的 Procedure `deploy-<stack>`：`/listener/github/procedure/<id>/__ANY__`。该 Procedure 只有一个 `DeployStack <stack>`，`webhook_secret` 专用、不与 Sync 或其他 Procedure 共用。listener 不区分事件类型，创建 hook 时的 ping 也会执行一次部署：先确认运行镜像等于通道 tag 当前 digest，再建 hook。
   - 源码 repo 即 workload repo：release workflow 推完镜像后，把精确版本作为字面值写进本 repo Sync TOML 中该 Stack 的 `environment`（compose 用该变量引用镜像 tag）并 push，由第 5 步的 push hook 部署。版本不放在 Komodo Variable。
   - 部署撞上同一 Stack 的其他操作时以 busy 失败并留下失败的 Update；恢复方式是在 GitHub 重投该 delivery。
7. 新增一个 secret 并让 compose 引用它时分两次提交：先提交 secret，等 workflow 成功，再提交引用它的 compose。push hook 触发的部署与 workflow 之间没有先后保证。只改已有 secret 的值（轮换）不会部署任何 Stack：RunSync 与 `DeployStackIfChanged` 比较的是 TOML 里 `[[KEY]]` 字面量和 repo 文件，不比较插值后的值（Komodo 2.3.3 只在真正执行 `DeployStack` 时插值）；workflow 成功后对使用该 key 的每个 Stack 执行 `km -p <core> x deploy-stack <name>`。
8. 验证：push hook 或 Deployment hook 触发的执行终态（Procedure 各阶段或 RunSync）、Stack 的 repo/branch/文件路径、容器状态与运行镜像，以及 app 声明功能的真实使用路径。
9. 从 IaC 迁来的 app：迁移时一次性的数据搬运和切换按源仓库的迁移规则做 A/B 核对；切换完成后，在 IaC repo 开 issue 删除它的部署声明。

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
