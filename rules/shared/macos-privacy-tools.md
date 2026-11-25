---
alwaysApply: true
---

# macOS 隐私授权与 Gatekeeper：本机工具

macOS 把一个进程树的隐私检查记在 launchd 直接启动的那个程序名下；Homebrew、mise 装的命令行程序路径带版本号，升级后被当成新程序，授权失效、反复弹窗。本机用下面两个工具处理，不重签、不改 TCC 数据库。

- **trusted-run（`/Users/mouriya/.local/bin/trusted-run`）：** 路径和内容固定的启动器，自己留着做担责进程，运行 `trusted-run <程序> [参数...]` 指定的程序。新增或修改 launchd 任务时，凡 `ProgramArguments` 启动的不是带固定开发者签名的 `.app`（例如 mise shim、mise 或 brew 装的二进制、解释器脚本），都在最前面加 `trusted-run`。源码在 `/Users/mouriya/.local/share/trusted-run/trusted-run.c`；不重新编译它，内容一变授权就失效。
- **brew-trust（`/Users/mouriya/.local/bin/brew-trust`，launchd `com.mouriya.brew-trust`）：** `/Applications`、`~/Applications`、`/opt/homebrew/Caskroom` 有变化时，自动清除其中 app 的 `com.apple.quarantine`。不需要再为单个 app 写去隔离脚本。

排查授权问题时现场查实，不凭旧版 macOS 的经验：macOS 27 不允许应用直接读 TCC 数据库，用能否读 TCC.db 判断授权是无效的；完全磁盘访问是否生效，用读受保护目录（如 `~/Library/Mail`）检验。
