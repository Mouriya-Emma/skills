# Skills

本仓库的 skill 定义位于 `skills/<name>/SKILL.md`。安装、更新、查看和移除均使用 [`npx skills`](https://github.com/vercel-labs/skills)，不要手工复制到 agent 的 skill 目录或直接修改已安装的副本；源码以本仓库为准。

## 安装

先查看仓库中可用的 skill：

```bash
npx skills add Mouriya-Emma/skills --list
```

按需安装到当前项目：

```bash
npx skills add Mouriya-Emma/skills --skill km
```

若要在所有项目中供指定 agent 使用，加上 `--global --agent`；例如：

```bash
npx skills add Mouriya-Emma/skills --skill km --global --agent codex claude-code --yes
```

需要安装仓库中全部 skill 时，将 `--skill km` 换成 `--skill '*'`。不指定 `--agent` 时由 CLI 检测或提示选择目标 agent；不指定 `--global` 时安装到当前项目。

## 管理

```bash
npx skills list                         # 查看项目和全局已安装的 skill
npx skills list --global                # 只看全局安装
npx skills update km --global           # 更新指定的全局 skill
npx skills remove km --global           # 移除指定的全局 skill
```

项目级 skill 去掉 `--global`。修改本仓库的 skill 后，先把源码提交并推送到 `main`，再针对受影响的 skill 执行更新或重新安装，并检查已安装内容；不要用全量更新代替选择和核对变更。
