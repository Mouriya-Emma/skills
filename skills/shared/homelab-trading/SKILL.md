---
name: homelab-trading
description: Workload routing for VM 130 trading-agent stacks, moomoo OpenD, the trading Komodo Core's declarations, and the homelab-trading secrets/sync workflow. VM 130, SR-IOV, DNS, mesh and the trading Komodo installation belong to IaC (iac-projects); Stack operations use the km skill with -p trading.
disable-model-invocation: true
---

# homelab-trading — workload-only signpost

`mouriya-s-lab/homelab-trading`, at `/Users/mouriya/Ext/code/homelab-trading`, owns Docker Compose workloads for VM 130 `trading-agent`, not the VM or its infrastructure. Read its current `AGENTS.md`, then the referenced rules/skills before changing stacks or secrets. This guide locates authority; it does not establish live runtime state.

## Owned surface

| Path | Authority |
|---|---|
| `stacks/<name>/compose.yaml` | One directory per workload; optional Dockerfile/app files belong with their stack |
| `komodo/syncs/stacks.toml` | Stack declarations consumed by the trading Core's ResourceSync, including each Stack's `compose_cmd_wrapper` |
| OpenBao `kv/mouriya-s-lab/homelab-trading/{runtime,ci}` | Single source of the repo's values: `runtime` holds what the Stacks interpolate, `ci` holds the Sync webhook secret. No value file in the repo, no committed populated `.env`, no second copy in the Core |
| `.github/workflows/sync-to-komodo.yml` | Authenticates to OpenBao with GitHub OIDC, reads `ci` plus the Core's CI key through `bao-exec`, refreshes the Sync webhook and runs `RunSync`; individual custom-image stacks may have a dedicated build workflow |

This repo owns its trading ResourceSync object as well as the declarations it points at (authority table in the `km` skill); read `km -p trading ls syncs -f json` for the live object. The Sync is created once by the operator with an `admin` key, because Komodo's non-admin CI identity cannot create one; the workflow then updates its fields. `trading-agent` is the VM name, not a Compose service name.

Read repo-local `.claude/rules/{topology,dev-conventions,secrets-handling,deploy-plane,pr-evidence}.md`. For cross-stack conventions use `.claude/skills/stack-baseline/`; OpenD deployment/SMS/account/restart specifics use `.claude/skills/opend/`. Client quote connections use `../opend-client/SKILL.md`.

## Ownership outside this repo

| Task | Route |
|---|---|
| VM 130 lifecycle, sizing, disks, SR-IOV, cloud-init | `iac-projects`, `homelab-tf/trading/` |
| Trading Komodo Core install, Periphery, host bootstrap | `iac-projects`, `homelab-tf` Ansible |
| DNS / NetBird enrollment | `iac-projects`, current homelab DNS/VM authority |
| `registry.237575.xyz` | registry app: `vctcn-edge/stacks/registry`; VM 182, Keycloak realm and signing keypair: `pve-vctcn/apps/registry`; CI push and pull side: `local-cicd` |
| GARM controller (VM 181) and its resident/edge runners | `pve-vctcn/apps/runner`, `local-cicd` |
| Core connection/profile, Stack deploy/restart/stop/list, container ps/inspect/restart, REST reads | `km` skill with `-p trading` |

Work that reaches the VM, network, DNS or the Komodo installation goes to the IaC repo through `iac-projects`. Workload changes use this repo's issue/PR. Routine version rollout through this repo's CD path is not an IaC task.

## Connection and secret invariants

- Pass `km -p trading` on every call. `km -p homelab` is a separate Core/state; there is no active-endpoint switch.
- Connection guide: VM LAN `192.168.1.225`, mesh name `trading-agent.mouriya.lan`, trading Core `http://trading-agent.mouriya.lan:9120`. Verify current reachability/config before operating. The SSH MCP key is normalized by `ssh-mcp-sync` (the trading-agent name becomes `TRADINGAGENT`).
- The sync job runs on a GARM self-hosted runner: resident LXD on VM 181 or, when the repo's resident pool is busy, edge Incus on the operator's laptop; it reaches the trading Core through that runner host's NetBird peer, and it reads its OpenBao values on that host through `bao-exec` with the GitHub OIDC identity. Do not infer PVE mesh membership from VM reachability; the PVE host is enrolled as `pve.mouriya.lan` (`100.85.59.151`) per homelab-tf `topology.md`. For Core-unreachable failures, first identify which runner ran the job (job `runner_name`, GARM pool), then inspect that host's mesh/DNS and the target path before changing stacks.
- Values are read from OpenBao, never from a decrypted file: the workstation uses `bao-exec` with `BAO_ADDR`, `BAO_EXEC_AUTH=approle` and `~/.config/bao-exec/{role_id,secret_id}`; the sync job uses `BAO_EXEC_AUTH=github-actions` with role `ci-mouriya-s-lab-homelab-trading`. Reading is the only path; never print a value as a verification step.
- Follow the current routing table, not “publish every key raw”: `KOMODO_TRADING_SYNC_WEBHOOK_SECRET` lives in `ci` and sets the Sync's `webhook_secret`; values the Stacks interpolate live in `runtime` under exactly the names compose uses (`FUTU_ACCOUNT_ID`, `FUTU_RSA_PEM_B64` as the single-line base64 PEM). `FUTU_ACCOUNT_PWD_MD5` stays a literal in the Sync TOML because it is a one-way hash. The repo's `secrets-handling.md` is the contract.

## Select the deployment mode

Read `deploy-plane.md` for exact current commands and authorization before applying one of these distinct paths:

| Change | Mode and persistence |
|---|---|
| Compose/Stack structure, new or deleted stack, or structure plus value change | Normal repo PR, then the main-branch declaration path. Update compose, declarations and the OpenBao `runtime` fields together as applicable; the push hook deploys changed Stacks, and each Stack's wrapper reads the values when it does. |
| Durable value change | Write the field in `kv/mouriya-s-lab/homelab-trading/runtime` with an `admin` token, value through stdin, then redeploy every Stack that interpolates it: `km -p trading x deploy-stack <name>`. A KV write alone deploys nothing, and `RunSync`/`DeployStackIfChanged` do not see the new value. |
| Rotating the Sync webhook secret | Write `KOMODO_TRADING_SYNC_WEBHOOK_SECRET` in `ci`, run `.github/workflows/sync-to-komodo.yml` (manual dispatch) so the Sync carries the new value, then update the GitHub push hook through `gh api`. Both must match or deliveries are rejected. |
| Short-lived alternate image/args smoke | Authorized `UpdateStack` inline `file_contents` override through the `km` skill's REST reference (`references/api.md`, `/write`), then `km -p trading execute deploy-stack <stack>`; next RunSync restores repo/branch/file paths and git-sourced compose. Make persistent changes in the repo, not inline state. |
| Force redeploy without config change | `km -p trading execute deploy-stack <stack>`; no structural edit needed. |

Every Stack that interpolates a `runtime` field must declare `compose_cmd_wrapper = "bao-exec run --path kv/mouriya-s-lab/homelab-trading/runtime -- [[COMPOSE_COMMAND]]"` with no include list, and its compose must write `${KEY}` rather than `${KEY:?…}`. A Stack without the wrapper starts with empty values and fails silently; re-check the wrapper whenever a Stack is added or edited. Never add `config` to the wrapper's include: Komodo would write the interpolated values into `deployed_config` and the Update log, and `config` reads `/etc/komodo/stacks/<stack>/.env` unwrapped, so that file may hold only the Stack's non-secret `environment` literals: a migrated key still left there from the old `[[KEY]]` path leaks plaintext the same way. Komodo rewrites the file only when `environment` is non-empty, so check it by key name after migration.

After any mode, inspect the terminal deployment result and actual workload behavior on VM 130 using `pr-evidence.md`. A successful `RunSync`/DeployStack is control-plane evidence, not proof the app works. Use `local-cicd` for delivery-shape details rather than adding another deployment implementation here.
