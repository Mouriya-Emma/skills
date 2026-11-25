---
alwaysApply: true
---

# 个人基础设施：app 归属与 skill 路由

适用于 homelab-tf、pve-vctcn、workload repo（homelab-apps、homelab-trading 等）及其上运行的 app、VM/CT、网络和 CI/CD；不适用于普通编程或第三方库。

## app 归属判据

一个 app 由 km（Komodo）部署还是由 IaC 部署，只按本节判定，不按它现在跑在哪台机器、哪个 workspace、由谁部署过来判定。

前提：km 主机基线（Docker 引擎、主机 DNS 与 mesh、网络）就绪，部署前由其他系统建好的外部对象已存在。在此前提下问两件事：

1. 从空的持久状态出发，一次 compose 操作能否让 app 履行它的声明功能？compose 操作包括 compose 文件、`.env`、与 compose 一起提交的配置文件和构建上下文，以及 compose 里声明的 init 服务和 entrypoint。
2. 保留持久状态时，重建和升级是否不需要 compose 之外的任何动作？

| 结果 | 归属 |
|---|---|
| 两问都是 | km |
| 需要 compose 外的动作（人、agent、CI 脚本、TF provider、临时 CLI/API/SQL/UI 对该 app 做必需配置），但这个动作能放进镜像、entrypoint 或 compose init | 先修镜像或 compose，再进 km；不能以此为由留在 IaC |
| 需要 app 专属的主机级准备（OS 用户、sudoers、systemd 单元、磁盘格式化、在宿主机上执行任务），或部署后的领域配置无法内置（Keycloak 的 realm/client/user） | IaC |

不影响判定的事项：

- 部署前已存在、由其他系统拥有的外部对象：Cloudflare tunnel 与路由、Keycloak client、GitHub secret 与 webhook、DNS 记录、DNAT。app 通过 `.env` 消费它们。
- 普通用户数据：没有它 app 也能履行声明功能。
- 一次性的数据迁移与切换。

判定以声明功能真实可用为准，容器 running 或 HTTP 200 不算。

## 退役

退役的服务不再部署，不再运行，不进 km，也不恢复。退役时删除 IaC 和 workload repo 里能部署它的声明（Stack、compose、role、playbook、模板、guest 定义），并停掉仍在运行的部分：容器 compose down（不删卷），主机 unit `systemctl disable --now`，guest 保持 stopped、onboot 0。数据盘、卷、保留的凭据、Komodo 记录，以及 Keycloak client/user、NetBird peer 等身份对象保留。由 TF 声明的 guest 和身份对象用 `removed { lifecycle { destroy = false } }` 或 `tofu state rm` 移出 state，不让 apply 销毁它们。保留不代表还要清理或恢复。

## 先读哪个 skill

先按上面的判据定 app 归属，再读 `devops` skill，由它的路由表进入下一层 skill 或 repo；进入 repo 后遵守它的 `AGENTS.md` 与 rules。
