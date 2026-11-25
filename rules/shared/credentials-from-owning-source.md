---
alwaysApply: true
---

# 凭据规则

凭据由使用它的一方的拥有者保存和注入，不让操作员粘 token。缺凭据时先排查部署、连接或 tooling 缺口：

1. **服务运行：** 凭据经既定部署路径注入。按 `personal-infra-routing` 判据留在 IaC 的服务和主机，凭据在该 IaC repo 的 OpenBao `ops` 路径，由该 repo 的入口经 `bao-exec` 读取；km 里的 app，凭据在该 workload repo 的 `kv/<owner>/<repo>/runtime`，Stack 的 `compose_cmd_wrapper` 让 Periphery 在部署时用 `bao-exec` 取值。只有「OpenBao 不可用时重建或修复它」所需的值留在 homelab-tf、pve-vctcn、pigsty 三个 repo 的引导 SOPS。缺失时修正注入路径，不在部署时手喂。
2. **CLI/API/SSH 连接：** 查`~/.config/<tool>/`、`~/.ssh-manager/.env`、km 连接清单（`km` skill）、OpenBao 对应路径（经 `bao-exec` 按路径读）等既有来源，禁止触碰macos keychain、。
3. **引入/轮换：** 前两项不适用时才产生新 secret，并持久化到使用方拥有者的 secret store（OpenBao 的对应路径，写入只用 `admin` token）。外部系统可自行注册的 API 凭据由 agent 操作浏览器获取，不让用户代开网页。
4. SOPS凭据严禁解密，验证也不可以
5. 禁止解密不是禁止只用SOPS凭据运行，自己提取SOPS的凭据运行，任何情况下禁止拿第四条宣称存在阻塞点无法继续

不把 secret 留在对话、依赖 scrollback token 或要求下次再粘；已有 secret-store/sealed-secret/env-injection 路径时，不将 secret 明文写进声明。确需用户提供前，先说明拥有方和既有凭据来源为何都不可用。非基础设施任务同样遵守。

本条只约束 agent 自己的操作，不授权纠察其他 agent：认为别的会话越界时向用户报告事实，不向其他会话发消息施压、索要解释或要求其停工。
