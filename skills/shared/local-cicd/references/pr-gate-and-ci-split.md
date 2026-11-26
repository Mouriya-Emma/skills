# PR 门禁与合入后重检（快慢分离）

所有仓库都按同一套两层 CI 交付：PR 只跑托管 runner 上的单个 `test` 快检，重型验证在合入后的 `ci.yml` 按变更重新规划。这套结构与 artifact 类型无关，三类仓库（纯代码/插件、镜像服务、IaC/Komodo workload）都照它接入，差异只在 `ci.yml` 的套件和 `mise` 任务的轻重。完整实现见 `mouriya-devops/runner-canary`（`pr.yml`、`ci.yml`、`scripts/ci.ts`、`test/ci-policy.test.ts`）；本节只写接入方必须提供的东西和三类仓库的差异。

## `pr.yml`：唯一必过 `test` 门禁

`pr.yml` 产出唯一顶层 CheckRun `test`：

```yaml
name: PR Check

on:
  pull_request:
    branches: [main, 'tree/**']
  merge_group

permissions:
  contents: read

jobs:
  test:
    name: test
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@main
        with:
          persist-credentials: false
      - uses: mouriya-devops/ci/actions/mise-check@main
        with:
          task: check:pr
```

- 运行在公网托管 runner：默认 `ubuntu-24.04`，macOS 专属仓用 `macos-latest`；PR 不上自建池、不依赖 mesh 或机密。
- `mise-check` 是 composite action，直接作为 job 的步骤运行。不用 `workflow_call`，CheckRun 名才精确为 `test`，不带 `<caller-job> / <callee-job>` 前缀。
- 禁止 workflow 级 `paths` / `paths-ignore`：任何 PR（含纯文档改动）都必须产出 `test`。
- 禁止 `continue-on-error: true`；`actions/checkout` 显式 `persist-credentials: false`。

## `ci.yml`：合入后按变更规划重检

重型验证只在这里跑。触发器限定 `push` 到 `main` 与 `'tree/**'`、每日 `schedule`、`workflow_dispatch`；禁止无分支过滤的 `on: push`，否则推 PR 分支会双跑。

结构是 `plan` → 各套件 job → `gate`：

- `plan`（托管 runner）：仓库脚本读取 `before..HEAD` 的变更文件，写出 `ci-plan.json` artifact，并给出每个套件一个 `if` 输出。纯文档改动不选重型套件；未知路径或共享配置（`mise.toml`、锁文件、`.github/workflows/*`、规划脚本自身）一律回退全量。
- 套件 job：以自身 `plan` 输出为 `if`。需要 GARM 的套件调用 `mouriya-devops/ci/.github/workflows/check.yml@main` 并传 `task`（保留托管的 `parse` 闸门，拒绝跨仓 fork PR 进入自建池），或直接在 GARM runner 上运行。
- `gate`（`if: always()`）：读取 `ci-plan.json` 与 `toJSON(needs)`，`plan` 缺失或失败、任一被选套件不是 `success` 时失败，并把同一张表写进 job summary。规划与门禁的完整判定逻辑只写在仓库脚本里，参考 `runner-canary` 的 `scripts/ci.ts`，不在 workflow 里重写。

## `mise.toml`：`check:pr` 与 `check`

- `check:pr`：托管 runner 上的快门禁，`pr.yml` 通过 `mise-check` 运行它。至少包含策略自测、单元/集成测试和构建产物检查。
- `check`：完整重检，本地和合入后运行；`depends = ["check:pr"]`，再加重型套件（容器冒烟等）。
- 工具链由 `mise` 提供，workflow 不钉版本号。

## 门禁策略自测

每个引入规划脚本的仓库都带离线、确定性的策略/规划自测（不依赖外部网络），并纳入 `check:pr`，至少覆盖：

1. 未登记路径 → 全量运行；
2. 共享配置（`mise.toml`、锁文件、`.github/workflows/*`、规划脚本自身）变更 → 全量运行；
3. 纯文档改动：`pr.yml` 仍产出 `test`，`ci.yml` 跳过重型套件；
4. `gate` 在任一被选套件非 `success` 时报错退出；
5. `pr.yml` 不含 `paths` / `paths-ignore` 与 `continue-on-error: true`，`checkout` 为 `persist-credentials: false`，job 为托管 runner 且 `task: check:pr`。

参考 `runner-canary` 的 `test/ci-policy.test.ts`。

## 三类仓库改造规范

三类划分来自 mouriya-devops/ci#16 §7；「证明方式」按 `gh-contract` 的证明分层套到各类仓库常见的结果面上。

| 仓库类 | `pr.yml` | `ci.yml` 套件 | `mise` 任务 | 证明方式 |
|---|---|---|---|---|
| 纯代码 / 插件仓 | 同一个 `test` 门禁 | `plan` → lint / 构建 / 单元与集成测试 → `gate`；需要 mesh 的才上 GARM | `check:pr` 跑测试与构建；`check` 加较慢的集成套件 | 结果多为 `library` / `cli` / `data`（可测试面），由 `test` 检查证明；issue 只有这类面时不发 `ghc ev` 包 |
| 镜像服务仓 | 同上 | `plan` → 共享 `check.yml@main` 的容器冒烟（GARM）；需要网格的仓再加探测 → `gate` | `check:pr` 跑测试与构建产物；`check` 加 `container-smoke` | `service` 由 `test` 证明；`gui` 等外部面另交 `ghc ev` |
| IaC / Komodo workload 仓 | 同上 | `plan` → 声明/配置 lint 与校验 → `gate`；需要 mesh 的 GARM 任务在此 | `check:pr` 跑 lint/校验；`check` 跑完整校验 | `iac` / `agent-config` 属外部面，始终 `ghc ev`；`test` 仍产出但不替代外部面证据 |

三类仓库都产出同一个 `test` 门禁；差异只在 `ci.yml` 的套件和 `mise` 任务的轻重。证明方式以 `gh-contract` 的证明分层为准：PR 有成功 `test` 时，可测试面由随 PR 入库、经真实入口运行的真实行为/集成测试证明；外部面（`gui`、`iac`、`agent-config`）始终要 `ghc ev` 记录；仓库没有 `test` 检查时全部结果都要 `ghc ev`。

## 仓库合并开关

所有仓库只允许 squash 合并并自动删分支，这是 `ghc land` 以 `--squash --delete-branch` 落盘的前提：

```sh
gh api -X PATCH repos/<owner>/<repo> -f allow_squash_merge=true -f allow_merge_commit=false -f allow_rebase_merge=false -f delete_branch_on_merge=true
```
