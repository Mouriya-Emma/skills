---
alwaysApply: true
---

# Fork customization placement rule

适用于维护 upstream 同步的 fork 定制，不包括继承的 upstream bug 修复。

- **目录契约：** 集中存放 fork 专属实现、辅助代码和维护记录时，统一使用 `fork-features/`。
- **方法论：** 根据上游扩展点、依赖边界、可读性和 rebase 成本，选择注册接入、提取模块或直接 patch；避免为隔离而增加绕行、复制或抽象。
- Rebase 时重新评估定制：上游已提供扩展点或原生功能时，考虑迁移或删除；需要维护记录时放在 `fork-features/`。
- 同步方式按仓库需要选择；采用 CI 自动同步方案时参考 `fork-upstream-sync`。
