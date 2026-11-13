---
name: windows
description: Use for the unattended Windows 11 agent VMs agent-vm-win11-01/-02: reaching them (NetBird, LAN, ssh, windows-mcp), running remote commands, and splitting identity after a clone; not for macOS desktop control (cua-driver).
---

# windows：Windows 11 agent VM

两台 VMware 上的 Windows 11 23H2（build 22631，简体中文系统）供 AI 操作，全无人值守：没有人坐在机器前，任何需要现场点击或输入的步骤都不成立。两台由一台完整克隆而来，身份已拆开，按下表区分。

| | `-01` | `-02` |
|---|---|---|
| NetBird 名 | `agent-vm-win11-01.mouriya.lan` | `agent-vm-win11-02.mouriya.lan` |
| LAN 名（Kea 租约投影到 `hb.lan`） | `desktop-k3j5gqd.hb.lan` | `agent-win11-02.hb.lan` |
| Windows 主机名 | `DESKTOP-K3J5GQD` | `AGENT-WIN11-02` |
| ssh 别名（`~/.ssh/config`） | `agent-vm-win11`、`agent-vm-win11-01` | `agent-vm-win11-02` |
| omp MCP server（`~/.omp/agent/mcp.json`） | `windows-mcp` | `windows-mcp-02` |

## 网络约束

- LAN 只用 DHCP + SLAAC，NetBird 地址由 NetBird 分配；任何地址都不手动设置，也不写死在配置里。两台只按名字区分，IP 会变，用前现查。
- 主入口是 NetBird 名；NetBird 不通时用上表 LAN 名做后备。两条路都能 ssh，也都能连 windows-mcp。
- `-02` 的 IPv6 固定后缀由 MAC 生成（`netsh interface ipv6 set global randomizeidentifiers=disabled`），因为克隆会复制 Windows 保存的随机后缀，开关该选项也不会重新生成。
- Windows 防火墙三个配置文件都是关的。

## 系统与登录

- 唯一账户 `Mo`：本地管理员、空密码，`AutoAdminLogon` 开机自动登录到 console 会话 1。
- ssh 登录用 `~/.ssh/dev-dai`，默认 shell 是 `cmd.exe`，管理员会话已提权。ssh 会话不在桌面会话里，GUI 操作走 windows-mcp，或用 `schtasks` 在交互会话里起进程。
- 工具链：`uv` 在 `C:\Users\Mo\.local\bin`（不在 PATH 上，用全路径），Python 由 uv 管理。

## windows-mcp

- `uv tool install windows-mcp` 装在 `Mo` 名下；配置 `C:\Users\Mo\.windows-mcp\config.toml`：streamable-http 监听 `0.0.0.0:8000`、Bearer `auth_key`、`ip_allowlist` 放行 NetBird 网段和 LAN 网段、`[control] consent_countdown_seconds = 0`（接管桌面不弹确认）。
- 两台的 key 不同。key 只存在于各自的 `config.toml` 和本机 `~/.omp/agent/mcp.json`，不要打印到对话或日志。
- 计划任务 `windows-mcp-server`：`Mo` 登录时在会话 1 启动，不限运行时长，退出后每分钟重启。日志在 `C:\Users\Mo\.windows-mcp\server.log` 和 `server.error.log`。
- 改 `config.toml` 后要重启服务才生效：先 `schtasks /End /TN windows-mcp-server`，杀掉仍在监听 8000 端口的进程，再 `schtasks /Run /TN windows-mcp-server`。
- 改了 `mcp.json` 的 omp 会话要重启 harness 才会重新加载 MCP。

## 远程执行要点

- `cmd.exe` 遇到以引号开头的命令（如 `"C:\Program Files\..."`）会剥掉引号后报错；先 `cd /d` 进目录，或改用脚本。`%`、`|` 在 cmd 和 PowerShell 两层解析下容易被吃掉。
- 稍复杂的 PowerShell：本机写好 `.ps1`，`scp` 到 VM，再执行 `powershell -NoProfile -ExecutionPolicy Bypass -File x.ps1`，跑完删掉。
- 原生命令（`ipconfig`、`netsh`、`schtasks`）输出是 GBK，经 ssh 读到会乱码。要读字段时用 PowerShell 对象（`Get-NetIPAddress`、`Get-ScheduledTask` 等）。
- 会断开当前连接的操作（`ipconfig /release`、`netbird down`、改网卡），要么从另一条路执行（NetBird 断就从 LAN 进，反之亦然），要么写成脚本、用一次性 SYSTEM 计划任务后台跑完，再回来读日志。

## 再次克隆时拆身份

克隆会复制 NetBird 私钥、主机名、windows-mcp key、IPv6 后缀和 DHCP 缓存地址。新机器按顺序处理：

1. 换 MAC（VMware 设置），开机后 `ipconfig /release` 再 `/renew`，丢掉缓存的旧地址；IPv6 关掉 `randomizeidentifiers`。
2. 生成新的 `auth_key` 写进 `config.toml`，重启 windows-mcp。
3. `Rename-Computer`：NetBIOS 名最多 15 个字符，超出会被截断。
4. 从 LAN 进去：`netbird down`、停服务，移走并删除 `C:\ProgramData\Netbird\default.json`（里面是被克隆机器的私钥），启动服务，执行 `netbird up --hostname <新名字> --no-browser`。这里只能 SSO 登录：回调地址是 VM 上的 `localhost:53000`，用 `ssh -L 53000:127.0.0.1:53000` 转到本机，由用户本人在浏览器里打开登录链接。
5. 重启；在 `~/.ssh/config` 和 `~/.omp/agent/mcp.json` 加新条目，并更新上表。
