---
alwaysApply: true
---

# 本机全局工具链由 mise 管理

工具链指语言运行时及其配套的包管理器、构建工具。本机全局工具链只由 mise 管理；其他 CLI 应用不进 mise，留在原来的安装方式。

- **现场查，不凭记忆：** 涉及全局工具链时，先用 `mise ls`、`mise config ls`、`command -v`、`brew list`、`brew uses --installed` 查清当前由谁提供、谁在依赖，再决定动作。
- **单一来源：** 同一工具链只由 mise 提供。发现其他来源（brew formula/cask、官方安装脚本、语言自带的版本管理器）提供的全局工具链时，先用 mise 装上并确认可用，再安全卸载其他来源；被其他软件依赖、卸载会破坏依赖方的副本保留，不作为全局工具链使用。
- **配置：** 全局工具链写在 `~/.config/mise/config.toml`，版本写 `latest`，用 `mise upgrade` 升级。
- **位置：** 全局工具链的安装目录、包缓存、全局包目录都放在 `/Users/mouriya/Ext/toolchains/<名称>`，原默认位置用符号链接指向它；新增工具链按同样方式落位。
- **系统集成：** 需要系统级位置（例如 `/Library/Java/JavaVirtualMachines`）才能找到的工具链，用 sudo 在该位置建符号链接，指向 mise 的 `installs/<工具>/latest`，升级后无需重建；同一位置的其他来源副本移除。
