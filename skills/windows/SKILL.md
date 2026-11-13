---
name: windows
description: Use for the Windows test machine g16pro — reaching it (NetBird, LAN, ssh, windows-mcp), running remote commands, and keeping every test inside D:\omp-test with omptest; not for macOS desktop control (cua-driver).
---

# windows：Windows 测试机 g16pro

g16pro 是用户自己日常使用的实体机（Windows 11 23H2，build 22631，简体中文系统，RTX 4060 Laptop + Intel UHD），兼作 omp、Tern 和 omomp 插件的 Windows 测试机。它不是无人值守的测试 VM：用户的 omp、Tern、浏览器和数据都在这台机器上，用户也会坐在机器前或经 Apollo/Parsec 串流使用桌面。由此有两条硬约束：

- 测试写下的一切都在 `D:\omp-test` 里，测试程序一律经 `omptest` 启动（见下文），测完用 `omptest clean` 清掉。
- 不碰用户自己的东西：`C:\Users\Mouriya\.omp`、`%APPDATA%\Tern`、`%LOCALAPPDATA%\Tern`、用户的 Tern 窗口与守护进程（管道 `\\.\pipe\tern-Mouriya-admin`）、Scoop 装的程序及其 `persist` 目录、系统设置。不安装、升级或卸载用户的工具，不运行 `tern register`、`omp update`、`scoop`/`winget` 安装命令；不结束不是自己启动的进程。

| | |
|---|---|
| NetBird 名 | `g16pro.mouriya.lan` |
| LAN 名（Kea 租约投影到 `hb.lan`） | `desktop-1or0gmo.hb.lan` |
| Windows 主机名 | `DESKTOP-1OR0GMO` |
| 账户 | `mouriya`（用户本人的账户，本地管理员） |
| ssh 别名（`~/.ssh/config`） | `g16pro` |
| omp MCP server（`~/Ext/code/omomp/` 下各仓库被 git 忽略的 `.omp/mcp.json`） | `windows-mcp`，工具族 `mcp__windows_mcp_*` |

## 网络

- LAN 走 DHCP，NetBird 地址由 NetBird 分配；地址不写死，用名字连。主入口是 NetBird 名，NetBird 不通时用 LAN 名。两条路都能 ssh，也都能连 windows-mcp。
- Windows 防火墙三个配置文件都是关的。

## 系统与登录

- ssh 用 `~/.ssh/dev-dai` 登录 `mouriya`。远端默认 shell 是 `cmd.exe`（`HKLM:\SOFTWARE\OpenSSH\DefaultShell` 未设置；这是用户的机器，不改它）。UAC 关闭（`EnableLUA=0`），ssh 会话（会话 0）是高完整性级别。
- 不自动登录：用户自己登录桌面会话 1。用户没登录时没有桌面，windows-mcp 也不在运行。
- 用户的工具由 Scoop 装在 `D:\Applications\Scoop`（git 与 Git Bash、python、uv、bun、omp），Tern 按用户安装在 `%LOCALAPPDATA%\Programs\Tern`。测试读用这些程序，不改它们。
- 接通交流电时显示器与睡眠都不超时；用电池时显示器 3 分钟后关闭。这是用户的电源设置，不改；显示器关着时截图停在旧画面。

## 测试沙箱 `D:\omp-test`

| 路径 | 内容 | 生命周期 |
|---|---|---|
| `D:\omp-test\bin` | `omptest.cmd`/`omptest.ps1`、Tern pane 用的 `omptest-pane.cmd`、`sweep.ps1` | 长期 |
| `D:\omp-test\home` | 测试用的 `HOME`/`USERPROFILE`：`.omp`（配置、凭据、插件）、`.bun`、`bin`（omp 的 Scoop shim 副本、`sqlite3.exe`、`omp-light`） | 长期 |
| `D:\omp-test\src` | 测试用的源码检出（如 `omp-config`） | 长期 |
| `D:\omp-test\runs\<name>` | 一次测试：`work`（工作目录）、`tmp`、`appdata\Roaming`、`appdata\Local`、`tern`（Tern 配置、日志、控制端点）、`sessions`（omp 会话）、`pids.txt` | 测完 `omptest clean <name>` 删除 |

`omptest` 用法（脚本头注释是准）：

```
D:\omp-test\bin\omptest run   <name> <program> [args...]   在当前控制台运行并等待（omp、tern.com、shell）
D:\omp-test\bin\omptest start <name> <program> [args...]   脱离启动并记录 PID（GUI 程序）
D:\omp-test\bin\omptest tern  <name> [args...]             启动属于这次运行的 Tern 窗口
D:\omp-test\bin\omptest clean <name>                       关掉这次运行启动的一切并删除 runs\<name>
D:\omp-test\bin\omptest list                               还存在的运行
```

- 环境：`HOME`/`USERPROFILE` 指向 `D:\omp-test\home`；`APPDATA`、`LOCALAPPDATA`、`TEMP`/`TMP`、`TERN_CONFIG_DIR`、`TERN_DAEMON_SOCKET`（`\\.\pipe\omptest-<name>`）、`STENCIL_LOG_DIR`、`PI_CODING_AGENT_SESSION_DIR` 指向 `runs\<name>`；用户环境里指向 Scoop `persist` 的 `BUN_INSTALL*`、`UV_*`、`CARGO_HOME` 改指 `D:\omp-test\home`；PATH 取 machine 加 user，前面加 `D:\omp-test\home\bin`、`.local\bin`、`.bun\bin`；继承来的 MSYS、`TERN_*`、`STENCIL_*`、`PI_*`、`OMP_*` 变量清掉。
- `D:\omp-test\home\bin` 排在 PATH 最前，是因为 omp-config 的更新器会把 `omp-light` 写到 PATH 上 `omp` 所在的目录；放在这里，它写进沙箱而不是 Scoop 的 `shims`。
- Tern 给每个 pane 重建用户的登录环境（`USERPROFILE`、`APPDATA`、`TEMP` 回到 `C:\Users\Mouriya`，只保留 `TERN_*`）。所以 `omptest tern` 在运行的 `tern\settings.json` 里把 `shell` 设为 `D:\omp-test\bin\omptest-pane.cmd`、`start_folder` 设为 `work`：pane 的 shell 按 `TERN_CONFIG_DIR` 认出所属运行，重新进入沙箱环境后再起 PowerShell。用 `tern new … -- <命令>` 直接起程序的 pane 不经过 shell 设置，命令要写成 `D:\omp-test\bin\omptest-pane.cmd <程序> [参数…]`。
- 操作这次运行的 Tern 时，`tern.com` 也经 `omptest run <name> tern.com …` 调用，才会连到 `\\.\pipe\omptest-<name>`；直接跑 `tern.com` 连的是用户自己的 Tern。
- `omptest clean` 先在运行环境里让 Tern 窗口经控制端点退出、停掉运行的 Tern 守护进程，再结束 `pids.txt` 里的进程、命令行里含运行目录或管道名的进程及其子进程，最后删除目录；有文件仍被占用时列出文件并以非零退出。
- 有疑问时用 `powershell -NoProfile -ExecutionPolicy Bypass -File D:\omp-test\bin\sweep.ps1 -Minutes <n> -Exclude <正则>` 列出最近 n 分钟在 `C:\Users\Mouriya`、`D:\Applications`、`D:\Users`、`D:\Program Files`、`C:\ProgramData` 下改过的文件，确认测试没有写到沙箱外。用户同时在用这台机器，结果里有用户自己的写入，按时间和路径区分。

## windows-mcp

- 用 Scoop 的 uv 安装：`set PYYAML_FORCE_LIBYAML=0&& uv tool install windows-mcp --with opencv-python-headless`，装在 `D:\Applications\Scoop\persist\uv\tools\versions\windows-mcp`。Scoop 的 Python 3.15 没有 pyyaml 的 wheel，机器上也没有 MSVC，这个变量让 pyyaml 按纯 Python 构建；`opencv-python-headless` 是 dxcam 截图后端要的 `cv2`。
- 配置 `C:\Users\Mouriya\.windows-mcp\config.toml`（`windows-mcp auth --transport streamable-http --host 0.0.0.0 --port 8000` 生成）：streamable-http 监听 `0.0.0.0:8000`、Bearer `auth_key`；`[security] ip_allowlist` 放行 NetBird `100.85.0.0/16` 和 LAN `192.168.1.0/24`；`[control] consent_countdown_seconds = 0`（接管桌面不弹确认）。
- key 只存在于 `config.toml` 和本机 omomp 各仓库的 `.omp/mcp.json`，不打印到对话或日志；需要用时从文件里读进变量。
- 计划任务 `windows-mcp-server`（`windows-mcp install` 创建，运行 `conhost --headless cmd /c %USERPROFILE%\.windows-mcp\start-server.cmd`）：`mouriya` 登录时在会话 1 启动，不限运行时长，退出后每分钟重启，用电池时照常运行。日志在 `C:\Users\Mouriya\.windows-mcp\server.log`。
- 改 `config.toml` 后重启服务：`Stop-ScheduledTask -TaskName windows-mcp-server`，结束仍在监听 8000 端口的进程，再 `Start-ScheduledTask -TaskName windows-mcp-server`。
- GUI 输入前先读 `ControlStatus`：`wait_seconds` 大于 0 表示用户正在操作，等它归零。屏幕上是用户自己的窗口；只点自己启动的窗口，每次点击前重新截图。截图的任务栏时钟应与真实时间一致。机器带 Parsec、SudoMaker（Apollo）、GameViewer 虚拟显示适配器，截图后端是 pillow：画面实时，只是慢。
- windows-mcp 的 `PowerShell` 工具运行在会话 1，是在桌面会话里启动 GUI 程序（例如 `omptest tern`）的入口；ssh 里启动的程序在会话 0，没有窗口。
- 改了 `mcp.json` 的 omp 会话要重启 harness 才会重新加载 MCP。

## 远程执行要点

- 远端命令按 `cmd.exe` 语法写，从本机只经一层引号：`ssh g16pro "D:\omp-test\bin\omptest list & dir /b D:\omp-test\runs"`。命令里有 `$` 时外层用单引号，否则本机 zsh 先展开它。omp 里连远端走 `exec_command`；`write_stdin` 会把 `\b` 等当转义，路径里的反斜杠写成 `\\`。
- omp 的 `ssh://` 路径不支持 Windows 主机；读远程文件用 `ssh g16pro "type <路径>"`。`scp` 目标写 `g16pro:D:/omp-test/...`。
- 稍复杂的 PowerShell：本机写好只含 ASCII 的 `.ps1`（Windows PowerShell 5.1 把不带 BOM 的 UTF-8 当 GBK 读），`scp` 到 `D:\omp-test` 下，`powershell -NoProfile -ExecutionPolicy Bypass -File D:\omp-test\…\x.ps1` 执行，跑完删掉。
- 系统 ANSI 代码页是 936，原生命令（`ipconfig`、`schtasks`、`powercfg`）输出 GBK，经 ssh 读到会乱码。要读字段时用 PowerShell 对象，或只对单条命令 `chcp.com 65001`，不改系统设置。
- 交互式程序（omp、TUI）走 PTY：`exec_command` 里开不带远程命令的 `ssh -t g16pro`，进入 `cmd.exe` 后再键入 `D:\omp-test\bin\omptest run <name> omp …`。
