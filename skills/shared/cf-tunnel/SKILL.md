---
name: cf-tunnel
description: 新增、修改或退役 237575.xyz 上的 Cloudflare tunnel 公网入口及其 connector 时用；普通 DNS 记录与 km app 本身的部署不用它。
disable-model-invocation: true
---

# cf-tunnel：Cloudflare tunnel 怎么管

## 谁管什么

| 对象 | 所在 | 改动方式 |
|---|---|---|
| tunnel、ingress 规则（hostname、path、回源 service）、connector token 输出、`<name>.237575.xyz` CNAME | `homelab-tf` 的 `cf-ingress` workspace（`cf-ingress/main.tf`，每个服务一组） | homelab-tf 的 `iac-deploy` 流程：issue → 分支 → `make plan-cf-ingress` → `make apply-cf-ingress` → PR |
| connector（运行 `cloudflared tunnel run` 的容器） | 回源服务所在的 workload repo，作为 km Stack；例如 `homelab-apps` 的 `stacks/paseo`、`stacks/omp-dispatch-ingress` | `km` skill 的流程；token 放在该 repo 的 OpenBao `kv/<owner>/<repo>/runtime`，Stack 的 `compose_cmd_wrapper` 在部署时用 `bao-exec` 取 |
| `237575.xyz` 的其他记录（apex、wildcard、MX 等） | `pve-vctcn/apps/dns` | 不在本 skill 范围 |

一个服务一个 tunnel。操作员工作站不运行 cloudflared：回源在工作站上时，connector 放在 homelab 主机上，经 NetBird 访问 `<peer>.mouriya.lan`。

## 回源写法

- connector 与服务在同一 compose 网络：`http://<service>:<port>`。
- 服务在 mesh 里的另一台机器：`http://<peer>.mouriya.lan:<port>`，对方监听器要绑定在 NetBird 地址上。
- 只暴露 webhook 时，ingress 加 `path` 白名单，最后一条用 `http_status:404` 兜底。

## 新增一个入口

1. 在 `cf-ingress/main.tf` 照现有块加四件套：tunnel、tunnel config、token data source 加 sensitive output `<name>_tunnel_token`、proxied CNAME。按 `iac-deploy` 走完 plan、apply、PR。
2. 用操作员的 `admin` token 把 token 写进该 workload repo 的 OpenBao `runtime` 路径，全程不打印：在 homelab-tf 里取 `_shared/scripts/tofu-sops.py cf-ingress output -raw <name>_tunnel_token`，管道接到 `bao kv patch kv/<owner>/<repo>/runtime <KEY>=-`，让值只经 stdin 进入 OpenBao；两端都不落盘，也不放进 argv。
3. 再提交 connector Stack：`stacks.toml` 里给该 Stack 设 `compose_cmd_wrapper = "bao-exec run --path kv/<owner>/<repo>/runtime -- [[COMPOSE_COMMAND]]"`，不设 `compose_cmd_wrapper_include`；compose 里写 `TUNNEL_TOKEN: ${<KEY>}`，`environment` 里不再出现这个键的 `[[<KEY>]]`。
4. 验证：connector 日志里出现 `Registered tunnel connection`，公网请求拿到回源服务自己的响应。
5. 换 token：用 `admin` 写入新值后对该 connector Stack 执行 `DeployStack`（`km -p <core> x deploy-stack <name>`）；OpenBao 写入本身不触发部署。

## 修改与退役

- 改回源或 path：只改 `cf-ingress`，plan 应只显示该 tunnel config 原地更新。改了 ingress 不会改变 connector 的值，不需要重写 OpenBao。
- 改 connector 的 token 引用名：`runtime` 里新增字段 + compose 引用一起改；旧字段在没有消费者后再删。
- 换 connector 位置：先让新位置的 connector 上线，再停旧的，最后改回源。
- 退役：在 `cf-ingress` 用 `removed { lifecycle { destroy = false } }` 让 state 忘掉这组对象，不删除 Cloudflare 上的 tunnel、config 和 CNAME；connector Stack 按 workload repo 的退役流程停掉。
