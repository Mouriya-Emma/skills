# Skills

本仓库保存本机 omp、Claude Code、AGY 三个 agent harness 的 skill、rule 和暴露清单。`bin/skills-sync` 是唯一的生成器与链接器：它从部署克隆读取本仓库，把各 harness 应看到的 skill 软链和转换后的 rule 写到各自的读取位置。不要手工复制 skill，也不要修改生成出来的文件；源码以本仓库为准。

## 目录

| 路径 | 内容 |
|---|---|
| `skills/shared/<name>/` | 多个 harness 共用的 skill |
| `skills/<harness>/<name>/` | 只属于一个 harness 的 skill，如 `skills/omp/windows`；AGY 变体专属的 skill 放 `skills/agy-<app\|cli\|acp>/` |
| `rules/shared/<name>.md` | 各 harness 共用的 rule，frontmatter 写 `alwaysApply: true` 或 `paths`；只给部分 harness 时加单行 `harnesses: [omp, agy]` |
| `rules/<harness>/<name>.md` | 只属于一个 harness 的 rule，不与 `rules/shared/` 重名；`rules/omp/` 另可用 omp 的 `condition` |
| `harness/<harness>/manifest` | 暴露给该 harness 的 skill 名，每行一个；`harness/agy/manifest` 分 `[common]`、`[app]`、`[cli]`、`[acp]` 段 |
| `harness/claude/CLAUDE.md` | Claude Code 的全局 memory |
| `harness/agy/plugin.json` | AGY 插件 `agent-skills` 的元数据 |
| `bin/skills-sync` | 生成器与链接器（需要 `bun`） |

清单里的名字依次从 `skills/<harness>/`、`skills/shared/`、`~/.agents/skills/` 解析；第三方 skill 由 `npx skills` 安装在 `~/.agents/skills/`，写进清单后才暴露。

## 生成位置

| Harness | Skill | Rule |
|---|---|---|
| omp | `~/.local/state/agent-skills/omp/skills/` | `~/.local/state/agent-skills/omp/rules/` |
| Claude Code | `~/.claude/skills/` 中的软链 | `~/.claude/rules/agent-skills/`；`~/.claude/CLAUDE.md` 软链到 `harness/claude/CLAUDE.md` |
| AGY | 插件 `~/.gemini/config/plugins/agent-skills/skills/`；`[app]`、`[cli]`、`[acp]` 段写到 `~/.gemini/{antigravity,antigravity-cli,antigravity-acp}/skills/` | 插件的 `rules/`，frontmatter 转成 `trigger: always_on` 或 `trigger: glob` + `globs` |

omp 通过 `~/.omp/agent/config.yml` 的 `extensions` 加载 `~/.local/state/agent-skills/omp`。`skills-sync` 只增删目标落在部署克隆或 `~/.agents/skills/` 下的软链，其他条目（真实目录、`~/.claude/skills/synced/`、厂商软链、带 `uchg` 锁的条目）保持原样。

## 安装与更新

```bash
git clone https://github.com/Mouriya-Emma/skills.git ~/.local/share/agent-skills/repo
~/.local/share/agent-skills/repo/bin/skills-sync
```

之后每次 `main` 有新提交，或用 `npx skills add/update` 装了第三方 skill，都重新运行 `~/.local/share/agent-skills/repo/bin/skills-sync`。它先执行 `git pull --ff-only origin main`，校验全部 rule 与清单，校验不通过时不写任何文件。

参数：`--home <dir>` 指定 HOME（默认 `$HOME`），`--repo <dir>` 指定本仓库位置（默认脚本所在的仓库），`--no-pull` 跳过拉取。在开发 checkout 中自测：

```bash
bin/skills-sync --home /tmp/skills-sync-test-home --repo . --no-pull
```

## 第三方 skill

第三方 skill 用 `npx skills` 安装到 `~/.agents/skills/`，再把名字写进需要它的清单并运行 `skills-sync`。例如 `ssot` 系列在 [mouriya-s-lab/SSoT](https://github.com/mouriya-s-lab/SSoT) 中维护：

```bash
npx skills add mouriya-s-lab/SSoT --skill ssot ssot-judge ssot-requirement ssot-iterate ssot-migrate ssot-c4 ssot-vdm ssot-quint ssot-write-level ssot-write-deploy ssot-write-contract ssot-write-behavior ssot-verify-structure ssot-verify-contract ssot-verify-behavior --global --yes
~/.local/share/agent-skills/repo/bin/skills-sync
```
