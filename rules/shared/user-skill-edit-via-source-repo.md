---
description: 修改用户级 skill、rule 或 harness 的 skill 暴露时，回源 git 仓库修改，再用 bin/skills-sync 部署
paths:
  - ".claude/skills/**"
  - ".claude/rules/agent-skills/**"
  - ".agents/skills/**"
  - ".local/share/agent-skills/**"
  - ".local/state/agent-skills/**"
  - ".gemini/config/plugins/agent-skills/**"
  - ".gemini/{antigravity,antigravity-cli,antigravity-acp}/skills/**"
---

# 用户级 skill 与 rule 回源仓库修改

各 harness 读到的用户级 skill 和 rule 都不是源头，不在这些位置改文件：

| 位置 | 性质 |
|---|---|
| `~/.local/share/agent-skills/repo` | `Mouriya-Emma/skills` 的部署克隆，只快进到 `origin/main` |
| `~/.local/state/agent-skills/omp/{skills,rules}`、`~/.claude/skills/`、`~/.claude/rules/agent-skills/`、`~/.gemini/config/plugins/agent-skills/`、`~/.gemini/<AGY 变体>/skills/` | `bin/skills-sync` 生成的软链与 rule 文件 |
| `~/.agents/skills/` | `npx skills` 安装的第三方 skill 副本 |

1. **溯源：** 软链指向部署克隆的 skill 和生成的 rule 属于 `Mouriya-Emma/skills`，源在本机 checkout `/Users/mouriya/Ext/code/skills` 的 `skills/<shared|omp|claude|agy>/<name>/` 与 `rules/<shared|omp|claude|agy>/<name>.md`。软链指向 `~/.agents/skills/` 的是第三方 skill：在 `~/.agents/.skill-lock.json` 的 `skills.<name>` 查 `sourceUrl` 和 `skillPath`；lock 里没有记录的 skill，先查明来源再改。
2. **在源仓库修改：** 改源仓库里的 skill 或 rule，按 `git` 规则提交并 push 到远程默认分支。某个 harness 暴露哪些 skill 由 `Mouriya-Emma/skills` 的 `harness/<harness>/manifest` 决定，增删暴露就改清单。
3. **部署：** `Mouriya-Emma/skills` push 后运行 `~/.local/share/agent-skills/repo/bin/skills-sync`，它把部署克隆快进到 `origin/main`，再重新生成三端的 skill 软链和 rule。第三方 skill push 后执行 `npx skills update <name> -g -y`，随即运行 `skills-sync`，清理 npx 在清单之外建的软链。
4. **核对：** 目标 harness 的 skill 目录里，`<name>` 指向部署克隆或 `~/.agents/skills/<name>`，内容是新版本；生成的 rule 与源一致。
