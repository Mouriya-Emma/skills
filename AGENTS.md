# AGENTS.md

本仓库是本机 omp、Claude Code、AGY 三个 harness 的 skill 与 rule 的源头；`bin/skills-sync` 从部署克隆生成各 harness 读取的目录。目录结构与安装方式见 [README.md](README.md)。

## 提交方式

本仓库禁止走 issue / PR 流程：不开 issue，不开 PR，不建功能分支；改动直接提交到 `main` 并推送到 `origin`。全局规则中的 GitHub issue / PR 路由以及 `writing-issue`、`writing-pr`、`review-pr` 流程不适用于本仓库。

## 改动后部署到本机

改动推送到 `Mouriya-Emma/skills` 的 `main` 后，由 agent 在同一任务内部署，不要留给用户执行：

1. 部署克隆 `~/.local/share/agent-skills/repo` 不存在时，先 `git clone https://github.com/Mouriya-Emma/skills.git ~/.local/share/agent-skills/repo`。部署克隆只跟随 `origin/main`，不在里面改文件。
2. 运行 `~/.local/share/agent-skills/repo/bin/skills-sync`。它先把部署克隆快进到 `origin/main`，再生成三端的 skill 软链和 rule；校验不通过时报错退出，不写任何文件，按报错修改源文件后重新提交。
3. 核对：受影响的 skill 在目标 harness 的 skill 目录里是指向部署克隆的软链，生成的 rule 与源一致；清单里没有的 skill 不出现在该 harness 中。

本仓库自有的 skill 不经 `npx skills` 安装。第三方 skill 仍由 `npx skills add/update <name> -g -y` 安装到 `~/.agents/skills/`，之后立即运行 `skills-sync`；它是否暴露给某个 harness，由 `harness/<harness>/manifest` 决定。

## 本地自测

改 `bin/skills-sync`、规则或清单后，先在 `/tmp` 下的假 HOME 运行 `bin/skills-sync --home <假 HOME> --repo . --no-pull`，检查生成结果，再提交。
