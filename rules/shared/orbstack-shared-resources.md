---
alwaysApply: true
---

# OrbStack 共享资源与台账

所有本地 OrbStack 使用登记到唯一台账 `~/Ext/work/orbstack/`；共享依赖的 compose/启动定义也存于此。

- 创建容器或 VM 前先读台账并查 `docker ps -a` / `orb list`，有可复用实例就复用，不未经检查直接启动新资源。
- 有状态依赖共用长期实例，以 database/schema/namespace/key-prefix 隔离；禁止按服务、套件或测试轮次重复创建，测试后只清理自己的数据。
- 容器、卷、网络、stack 和 VM 登记资源名、用途、共用者、端口/DSN/database 划分及起停命令。无状态一次性容器可用后销毁，但仍须登记，不遗留未登记资源。
- 改动后实际连接验证并记录连接方式，遵循 `runtime-verification-required`；凭据遵循 `credentials-from-owning-source`。
