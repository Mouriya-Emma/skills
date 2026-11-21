---
name: devops
description: 个人基础设施与 homelab/trading 运维的入口：app 接入、发布与部署（Komodo/km）、VM/CT、网络、DNS、mesh、Keycloak、IaC repo、自托管 CI 与私有 registry、内部服务清单、VM 130 trading workload 与 moomoo OpenD。任何这类任务先读本 skill，再按表进入下一层 skill。
---

# devops：基础设施 skill 路由

app 归 km 还是归 IaC，先按 `personal-infra-routing` 规则的归属判据判定，再按下表进入对应 skill。下一层 skill 不在 skill 目录里列出，用 `skill://<name>` 读取；其中 `iac-projects`、`homelab-trading` 自身也是路由，按它们的指引再往下一层。

| 任务 | skill |
|---|---|
| app 的接入、发布、部署与运行操作；km 资源（Stack、ResourceSync、Action、Procedure、Variable、Build、Server）；容器排障、磁盘清理、Core 元数据备份恢复、km 连接 | `skill://km` |
| 机器、网络、DNS、根信任、Komodo 安装；按判据留在 IaC 的 app；工作归哪个 IaC repo；Keycloak realm、client、user、mapper | `skill://iac-projects` |
| CI：GARM runner、私有 registry 推送、构建产物 | `skill://local-cicd` |
| 服务清单、数量、位置 | `skill://internal-services` |
| VM 130 trading workload 与 OpenD 部署；moomoo OpenD 客户端连接 | `skill://homelab-trading` |
