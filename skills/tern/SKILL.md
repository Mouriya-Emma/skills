---
name: tern
description: 在 Tern 终端中运行测试、复现 GUI 现场、采集 ghc 截图证据或录制演示（无头 tern serve、真实窗口 tern --control、tern ctl --file 场景脚本、omp 原生 surface/Console/tray/jobs/form 验证、Tern Luau 插件与 CSS 热加载）时必读。
---

# tern：Tern 自动化测试与 GUI 采证

本机 Tern 可执行文件为 `/Users/mouriya/.local/bin/tern`（指向 `/Applications/Tern.app/Contents/MacOS/tern`）。凡涉及 Tern 界面、omp 在 Tern 中的原生渲染（TSP surface）、Tern 插件或样式的复现、验证、证据截图与录屏，均按本 skill 执行。在 Windows 测试机 `g16pro` 上运行 Tern 时，沙箱与启动入口同时遵守 `skill://windows`（`omptest tern` / `omptest run <name> tern.com`）。

## 硬约束：隔离与生命周期

1. **必须隔离配置与守护进程端点：**
   每次测试在 `/tmp/<run>` 下建独立目录，启动任何 `tern` 命令都显式注入 `TERN_CONFIG_DIR` 与 `TERN_DAEMON_SOCKET`：
   ```bash
   D=/tmp/tern-<run>
   mkdir -p "$D/config" "$D/shots" "$D/work"
   cp ~/Library/Application\ Support/Tern/settings.json "$D/config/settings.json" 2>/dev/null || true
   export TERN_CONFIG_DIR="$D/config"
   export TERN_DAEMON_SOCKET="$D/daemon.sock"
   ```
   - 不设这两个变量时，`tern` 会连到用户正在使用的桌面 Tern 守护进程、把窗口开进用户的会话，或直接修改 `~/Library/Application Support/Tern/plugins`。
   - 只按需复制 `settings.json`（保留字体、主题等基线设置），绝不复制用户的 `plugins/` 目录或 socket。
2. **采证前先冻结代码 HEAD：**
   走 issue / PR 交付时，必须在代码提交且 `review diff` 通过（`PASS`）之后才启动 Tern 采集正式证据（见 `skill://delivering-issues`）。禁止边派 reviewer 边手搓 Tern 采证，避免 review 修代码改变 HEAD SHA 导致整轮截图作废重采。
3. **用完立即退出并清理：**
   测试或采证结束时执行 `tern ctl --control "$D/ctl.sock" quit`；若启动过真实窗口，确认关联的隔离 daemon 进程已退出后再删 `$D`，不遗留后台 `tern serve` 或多余窗口。

## 第一步：选无头 `tern serve` 还是真实窗口 `tern --control`

**默认优先用无头 `tern serve`**，只有在测试项确实依赖真实窗口才起 `tern --control`：

| 能力 / 场景 | 无头 `tern serve --control $D/ctl.sock --out $D/shots` | 真实窗口 `cd $D && tern --control $D/ctl.sock --dir $D/work` |
|---|---|---|
| omp 原生渲染（TSP surface：消息、工具卡片、`ask` 表单、`tray`、`JobsSheet`、`omp.overlay.console`、输入框） | 支持 | 支持 |
| 经典终端字符网格 / `tmux` 内运行 omp ANSI TUI | 支持 | 支持 |
| 样式表热加载与 A/B 对比（`tern ctl css <name> <abs-path>`）、亮暗外观（`appearance light\|dark`）、移动端壳（`phone on` + `size 393 852 3`） | 支持 | 支持 |
| `shot NAME` 截图与 `record start/speed/stop` 录屏 | 支持（输出到 `$D/shots/serve/<NAME>.png` 与 `.layout.json`） | `shot` 支持（输出到**启动窗口时的工作目录**下 `target/shots/tern/live/<NAME>.png`） |
| Tern Luau 插件（`init.luau`、插件自定义 block/lens、`tern plugin list\|link\|install\|reload`） | **不支持**（`serve` 不加载插件） | **必须用真实窗口** |
| 原生 WebView 子页面（如 `<video>` 播放器，经 `tern ctl webcall SEL JSON` 驱动） | **不支持**（`a headless session shows no pages`） | **必须用真实窗口** |
| 会话守护进程 CLI（`tern ls`、`tern inspect`、`tern send`、`tern capture`、`tern wait`） | **不支持**（`serve` 不起 session daemon） | 支持（需带同一组 `TERN_CONFIG_DIR` 与 `TERN_DAEMON_SOCKET`） |

> **真实窗口的启动目录陷阱：** 真实窗口不接受 `--out`，它的 `shot NAME` 固定写到**启动该窗口进程时的 `cwd`** 下的 `target/shots/tern/live/<NAME>.png`。启动真实窗口前必须先 `cd "$D"`（可写目录）；若在只读目录或应用包目录启动，`shot` 会报 `cannot write target/shots/tern/live: Read-only file system (os error 30)`。

## 第二步：分清两套 CLI 通道与帮助命令

### 1. 帮助命令禁令（高频卡死点）

- 查所有控制命令与场景语法：**只运行 `tern help dev`**（常规 CLI 跑 `tern help` 或 `tern <subcmd> --help`）。
- **严禁运行 `tern serve --help`**：`tern serve` 会把 `--help` 当作传给应用的 `ARGS`，直接在 `/tmp/tern.sock` 启动一个永不退出的无头服务，把当前工具调用卡死到超时。
- **严禁运行 `tern ctl --help` 或 `tern ctl help`**：`tern ctl` 会把 `--help` / `help` 当成控制命令发给 socket，报 `{"ok":false,"error":"unknown command \"--help\""}` 或 `Connection refused`。
- **严禁无参数运行 `tern shot --help`**：`tern shot` 会尝试在当前目录寻找 golden fixtures 并报错退出。

### 2. 控制端点 `tern ctl --control $D/ctl.sock ...` vs 会话守护进程 `tern <subcmd>`

这两套命令走不同的 socket、语法完全不同，不要混用：

| 通道 | 作用对象 | 常用命令与精确签名 |
|---|---|---|
| `tern ctl --control $D/ctl.sock ...` | 无头 `serve` 或带 `--control` 的窗口 | 驱动 UI 与渲染树：`--file <scenario>`、`tree [SEL]`、`dump [SEL]`、`pick X Y`、`state`、`stats`、`layers`、`css ...`、`shot NAME`、`resize W H`、`webcall SEL JSON`、`quit` |
| `TERN_CONFIG_DIR=... TERN_DAEMON_SOCKET=... tern <subcmd>` | 仅真实窗口的 session daemon | 管理会话与 pane：<br>• `tern ls [--json]`<br>• `tern inspect [--json]`（**不接受** block ID 参数；传 ID 会报 `inspect takes other arguments`）<br>• `tern capture <BLOCK> [--surfaces] [--scrollback] [--html\|--ansi]`（读 omp surface 文字必须加 `--surfaces`）<br>• `tern send <BLOCK> text "<TEXT>" \| keys <COMBO>... \| paste "<TEXT>"`<br>• `tern wait <BLOCK> [--until exit\|prompt\|idle=MS] [--timeout SECONDS]`<br>• `tern close <BLOCK>`（关单个 block/pane 用 `close`；**`tern kill` 只接受 `tern kill session <SESSION>`**，传 block ID 会报错）<br>• `tern plugin list\|reload\|dir\|install\|remove\|link\|unlink [--json]`（用 `link` 接入的插件不能 `remove`，必须 `unlink <ID>`） |

## 第三步：用 `tern ctl --file` 场景脚本驱动，禁止单步手搓

### 1. 为什么单条 CLI `tern ctl` 经常报参数错误？

`tern ctl COMMAND...` 会先把命令行 `ARGV` 用空格拼成一行，再交给场景解析器。在 shell 里直接写：
```bash
# 错误示例：shell 先剥掉了双引号，tern ctl 拼出来是 `run omp --no-extensions`（多出了裸参数）
tern ctl --control "$S" run "omp --no-extensions"
tern ctl --control "$S" type "hello world"
tern ctl --control "$S" expect "How should"
```
会直接报错：
- `{"ok":false,"error":"expected run <command> [done]"}`
- `{"ok":false,"error":"type: expected 1 argument(s), got N"}`
- `{"ok":false,"error":"expected expect <text>"}`

**正确做法：** 把交互流程写成场景文件（每行一条命令，字符串保留字面双引号 `"..."`），用 `tern ctl --control "$D/ctl.sock" --file "$D/scenario.txt"` 一次性顺序执行。严禁“发一条 `tern ctl` → 截一张图 → `read` 看图 → 猜下一个坐标”的单步试探循环。

### 2. 场景命令高频陷阱对照表

| 场景命令 | 正确写法 | 高频错误与原因 |
|---|---|---|
| 设置视口尺寸 | `size 1120 760 2`（宽、高、可选缩放，空格分隔） | 写成 `size 1120x760`（报 `size: expected W H [scale], got 1 argument(s)`） |
| 等 shell 提示符就绪 | `ready` | 在 omp 已经占据前台运行时调 `ready` 或 `finished`——此时前台不是 shell 提示符，会固定卡满 **20 秒超时**（`timed out after 20s`） |
| 在 shell 里起命令 | `run "cd /tmp/work; omp ..." `（常驻程序不加 `done`；短命令等结束加 `done`） | 当焦点在 overlay、表单或已运行的 omp 里（没有聚焦在运行中的 shell）时调 `run`，会报 `no running shell has focus` 或超时 |
| **等待画面出现文字（最常见 20s 超时根源）** | • 等 **omp 原生界面（surface）** 文字：`plugins expect "目标文字"`<br>• 等 **终端字符网格（shell / tmux / ANSI）** 文字：`expect "目标文字"` | 在 Tern 原生渲染的 omp 里用 `expect "目标文字"`：`omp` 的消息、卡片、`ask` 表单、`tray`、`JobsSheet`、`Console` 全部画在 **Tern surface（`.sf-*` DOM）** 上，不在底层终端字符网格里，`expect` 永远等不到，每次白等 20 秒 |
| 截图 | `shot r1-open`（名字只能匹配 `[A-Za-z0-9_.-]+`） | 传路径 `shot /tmp/shots/r1.png`（报 `shot: name must match [A-Za-z0-9_.-]+`）。输出路径由 `serve --out` 或窗口启动 `cwd` 决定，`shot` 返回的 JSON 里直接带 `"png": "/abs/path/..."` |
| 点击元素 | `click [data-role="omp.jobs.status"] button.sf-button` 或先用 `tree` 查准坐标 | • 盲猜像素坐标点歪，导致浮层（如 tray peek）关闭、焦点落到底下 composer 输入框，后续按键被当成聊天消息发给模型<br>• 用 Playwright/CSS4 伪选择器如 `click text=Broken`、`dblclick ".x:has(.y)"`（Tern 选择器解析器不支持 `text=` 与 `:has()`，只支持标签、`.class`、`#id`、`[attr="val"]`/`[attr*='val']`、后代空格与 `>`） |
| 查可见 DOM 树与坐标 | `tern ctl --control "$S" tree` 或 `tern ctl --control "$S" tree '[data-role="omp.ask.option"]'` | 在 shell 里给 `tree` / `dump` 的选择器套双层引号 `tree '"[data-role=...]"'`（`tree` 和 `dump` 直接取整行剩余文本作 CSS 选择器，多套一层引号会报 `bad selector: unexpected QuotedString`） |
| 切换亮暗外观 | `appearance dark` / `appearance light`（或在窗口中 `palette "Dark appearance"`） | 用 `theme dark <NAME>` 以为能切到暗色模式（`theme dark <NAME>` 只设置暗色模式选用哪套配色，不切换当前亮暗状态） |
| 热加载/卸载 CSS | `css <sheet-name> /abs/path/to/style.css`；卸载写 `css <sheet-name>` | 为测一段 CSS 反复重装插件或重启 Tern 窗口；用 `css` 命令在无头 `serve` 里即可秒级完成改动前后 A/B 截图 |

## 第四步：在 Tern 中测试 omp 与插件的标准配方

### 1. 启动隔离实例并拉起待测 omp

- 用 `--no-extensions -e <待测插件入口绝对路径>` 排除全局已安装副本的干扰。
- **注意 `--no-extensions` 会同时卸掉由其他扩展提供的模型 provider**：启动命令必须显式指定当前配置下无需外部扩展即可调用的模型（如 `--model openai-codex/gpt-6.1-sol` 或 `--model futureppo-pool/ernie-5.5-flash-preview`）。
- 截图不展示思考过程时加上 `--hide-thinking`；加 `TMPDIR=/tmp --no-session --no-title` 避免截图里暴露临时目录长路径或账号启动通知（或启动后先发 `/new` 清屏）。

```bash
D=/tmp/tern-test-run
rm -rf "$D" && mkdir -p "$D/config" "$D/shots" "$D/work"
cp ~/Library/Application\ Support/Tern/settings.json "$D/config/settings.json" 2>/dev/null || true
export TERN_CONFIG_DIR="$D/config"
export TERN_DAEMON_SOCKET="$D/daemon.sock"
S="$D/ctl.sock"

# 1. 后台启动无头 Tern（若测 Luau 插件则先 cd "$D" 再起 tern --control "$S" --dir "$D/work"）
tern serve --control "$S" --out "$D/shots" >"$D/serve.log" 2>&1 &
SERVE_PID=$!
while [ ! -S "$S" ]; do sleep 0.1; done

# 2. 写一次性场景脚本
cat >"$D/scenario.txt" <<'EOF'
size 1120 760 2
appearance dark
ready
run "cd /tmp/tern-test-run/work; TMPDIR=/tmp omp --no-extensions -e /abs/path/to/plugin/src/index.ts --no-session --no-title --hide-thinking"
wait 1500
shot 01-launched
EOF

tern ctl --control "$S" --file "$D/scenario.txt"
```

### 2. 检查 DOM 状态、精确点击与输入

需要确认界面上有哪些角色属性（`data-role`、`data-id`、`class`）、按钮位置或当前焦点在不在目标控件上时，先跑一次 `tree`：

```bash
# 查看匹配的可见节点、文本、rect 坐标与 focus 状态
tern ctl --control "$S" tree '.sf-main [data-role]' | jq '.nodes[] | {tag, class, text, rect, focus}'
```

确认选择器后，把后续交互写进下一个 `--file` 场景一次性跑完：
- 向 `omp` 输入框或 Console 发按键前，确认当前焦点在目标输入区（从 overlay 退回主界面先发 `key Escape` 并 `wait 200`）。
- 若在真实窗口中测试含原生 `<video>` / WebView 的块，`tern ctl` 的普通 `click`/`key` 只发给 Tern 主文档；操作子页面需经 `tern ctl --control "$S" webcall <SEL> '{"op":"eval","function":"() => ..."}'`。

### 3. 清理收尾

```bash
tern ctl --control "$S" quit
wait "$SERVE_PID" 2>/dev/null || true
```
