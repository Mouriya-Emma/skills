---
name: km
description: >-
  Komodo (km) for homelab and trading apps. Use to onboard a new app, move an app out of IaC, release or redeploy through the workload repo and GitHub webhook, deploy/restart/stop/destroy Stacks, debug containers, run ResourceSync/Action/Procedure, run Komodo Build/Repo, clean Docker disk (prune images/volumes), back up or restore Core metadata, call the API for CLI gaps, and manage Core connections/profiles. Read the matching reference before any command.
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

- 每条命令写 `km -p <core>`，没有"当前 Core"。生成配置里的 `default_profile` 只是 CLI 兜底，不是选择依据。
- Server、Stack 的名字和 ID 只在本 Core 内有效。先列出再操作：`km -p "$core" ls servers`、`km -p "$core" ls stacks -a -f json`。
- 本机 km CLI 版本高于 Core 时，`ls stacks`、`ls servers`、`ps` 可能直接报 `ERROR: 200 OK`。此时用 `references/api.md` 的版本匹配 REST 读（`ListStacks`、`ListServers`），不要换 Core 或改配置。

## 权威：谁声明什么

| 对象 | 声明者 | 改动入口 |
|---|---|---|
| Stack、compose、Stack 的 Variable 引用 | app 的 workload repo：`komodo/syncs/*.toml` + `stacks/<name>/compose.yaml` | 改 repo，push 后由 GitHub webhook 触发该 repo 的 ResourceSync |
| app 的 secret | workload repo 根目录 SOPS `secrets.yml` | 该 repo 的 workflow 解密后写成 km Variable，再 RunSync |
| workload repo 自己的 ResourceSync 对象 | workload repo 的 workflow | workflow 在 RunSync 前做"不存在就创建，存在就局部更新" |
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
4. workflow：只在 `secrets.yml` 或 workflow 本身变化时运行；解密 → 不存在就创建、存在就局部更新本 repo 的 ResourceSync（含 `webhook_secret`）→ upsert Variables → RunSync → 等终态。
5. GitHub webhook：repo 的 push 事件指向 Core 的公网 listener 地址 `https://<Core 公网 listener>/listener/github/sync/<sync 名>/sync`，secret 与该 Sync 的 `webhook_secret` 相同；Komodo 校验签名和分支后执行 RunSync。`*.mouriya.lan` 只在 mesh 内可解析，GitHub 送不到，不能用作 webhook 地址。Core 的公网 listener 入口属于 Komodo 安装，由 `iac-projects` 定位的 IaC repo 提供；还没有时，在该 repo 开 issue，不要临时暴露整个 Core。
6. 新增一个 secret 并让 compose 引用它时分两次提交：先提交 secret，等 workflow 成功，再提交引用它的 compose。webhook 触发的 RunSync 与 workflow 之间没有先后保证。
7. 验证：RunSync 终态、Stack 的 repo/branch/文件路径、容器状态，以及 app 声明功能的真实使用路径。
8. 从 IaC 迁来的 app：迁移时一次性的数据搬运和切换按源仓库的迁移规则做 A/B 核对；切换完成后，在 IaC repo 开 issue 删除它的部署声明。

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
