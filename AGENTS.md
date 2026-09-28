# AGENTS.md

skill 源码位于 `skills/<name>/`，`npx skills` 的安装与管理命令见 [README.md](README.md)。

## 提交方式

本仓库禁止走 issue / PR 流程：不开 issue，不开 PR，不建功能分支；改动直接提交到 `main` 并推送到 `origin`。全局规则中的 GitHub issue / PR 路由以及 `writing-issue`、`writing-pr`、`review-pr` 流程不适用于本仓库。

## 修改 skill 后部署到本机

新增或修改的 skill 推送到 `Mouriya-Emma/skills` 的 `main` 后，由 agent 在同一任务内用 `npx skills` 把受影响的 skill 部署到本机全局，不要留给用户执行：

1. 已安装的 skill 执行 `npx skills update <name> --global`。
2. 新增的 skill 执行 `npx skills add Mouriya-Emma/skills --skill <name> --global --agent <agents> --yes`；`<agents>` 与本仓库已安装的 skill 保持一致，可用 `npx skills list --global` 查看。
3. 部署完成后，`npx skills list --global` 中该 skill 的 Source 应为 `Mouriya-Emma/skills`，并且 `diff -r skills/<name> ~/.agents/skills/<name>` 没有输出。

以 GitHub 为安装来源，`~/.agents/.skill-lock.json` 才会记录这些 skill，`update` 才能继续管理它们。不要用 `npx skills add .` 从本地 checkout 安装：这种安装不写 lock，之后 `update` 找不到该 skill。也不要手工复制或编辑 `~/.agents/skills/` 下的副本，或用全量 `update` 代替逐个部署受影响的 skill。
