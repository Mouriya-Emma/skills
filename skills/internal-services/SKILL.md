---
name: internal-services
description: Inventory and count internal services across homelab-tf, pve-vctcn and both Komodo Cores (what runs where, who declares it, which are retired), and refresh this skill when the inventory guidance goes stale. Recompute totals from live sources; operating a service belongs to its own skill.
---

# Internal services inventory

Use this skill for inventory questions such as “内网有多少服务”, “what runs where?”, “which skills are missing for my apps?”, and for refreshing this skill. It is an overview: do not load operational skills (`km`, `keycloak`, `dns-check`, `local-cicd`) just to count or describe services. Route to them once the question becomes operating or changing a service.

## Counting policy

Never answer from a stored total. Recompute on each request; workload repos and ResourceSyncs change without this skill changing.

1. Read OpenTofu CT/VM declarations from the IaC repos.
2. Read the homelab Core's Stacks and ResourceSyncs, and the trading Core's when trading is in scope (commands below).
3. Count vctcn services from the VM-backed `apps/*/main.tf` workspaces plus live placement, and add Stacks on vctcn Servers (`ct171`, `vctcn-mail`) from the homelab Core. `apps/dns/` manages Cloudflare records and is not a service.
4. State the timestamp, granularity, which inactive or retired items are excluded, and the concrete names behind the total.

Count active top-level services, not backing containers. Do not count Postgres sidecars, registry `docker_auth`, NPM proxy-host rows or CoreDNS/Unbound/Kea/dns-info sub-daemons as separate services. Count `moat-browser` once although it has a VM and several containers.

Retired services are reported in a separate “retired” list and never counted as active, even when their Stack records, volumes or disks remain. Retention does not imply a cleanup or recovery task.

## Placement guide

Use this to locate declarations, not as proof a guest is running.

### homelab-tf

DNS/DHCP (CT 312), Step-CA (CT 313), the homelab Komodo Core and its `Local` Server (VM 110 moat-app1), the browser host (VM 104), and trading-agent with the independent trading Core (VM 130). Retired and stopped: OpenBao (CT 314), app01 (VM 102), agent-runtime (VM 103), nanoclaw (VM 106), moat workload hosts (VM 111–113). Static CT/PVE identities come from `network/identities.yaml`.

### pve-vctcn

Read current workspaces rather than a stored list:

- VM 180 `vctcn-app1`: Keycloak and the other compose services in its workspace. Mattermost and Forgejo there are retired (pve-vctcn#286); their volumes and Keycloak identities are retained.
- VM 181 `vctcn-runner`: GARM controller and resident LXD runner host. Overflow runners run as edge Incus instances on the operator's laptop; count GARM once and do not count the laptop as a service host.
- VM 182 `vctcn-registry`: registry and its auth helper (count the registry once).
- VM 183 `vctcn-mail`: the `mail` Stack on the homelab Core (Server `vctcn-mail`).
- CT 171: NPM and 3proxy Stacks on the homelab Core (Server `ct171`). NPM is ingress infrastructure; count it only when the requested granularity includes control-plane services.

### Komodo Stacks

Stack names, state, target Server and declaring repo come from live reads only:

```bash
km -p homelab ls stacks -a -f json
km -p homelab ls syncs -f json
km -p trading ls stacks -a -f json
km -p trading ls syncs -f json
```

If the local km CLI is newer than the Core and `ls stacks` fails with `ERROR: 200 OK`, use the version-matched REST reads in the `km` skill (`references/api.md`). For a repo-backed Stack, `repo`/`branch` identify its declaring workload repo. A Stack with an empty repo and non-empty `file_contents` is not repo-declared; report it as such. A stopped VM or down/stopped Stack is reported separately and excluded from an active count unless the user asks for all declared services.

## Reporting format

Return a compact table grouped by repo or Core: service, active/inactive/retired/unknown, placement, declaring source, evidence command or path. Then the computed total and the explicit exclusions. If a live source is unavailable, separate declared inventory from confirmed-active inventory; do not present unknown as active or silently omit a Core.

## Skill coverage

Existing: `km` (all Komodo operations and app onboarding), `iac-projects` (IaC repo routing), `local-cicd` (GARM, registry, build artifacts), `keycloak` (SSO integration and inspection), `dns-check` (LAN DNS discoverability, not full DNS operations), `homelab-trading` (trading workloads), `opend-client`, `image-share`.

Without a dedicated skill: registry, Memos, Homepage, moat-browser, Step-CA, full DNS service operations.

## Sources

Verify current state from these before a recommendation the user may act on; discover additions rather than treating the list as complete.

homelab-tf (`/Users/mouriya/Ext/code/homelab-tf`): `AGENTS.md`, `Makefile` (workspace list), workspace `main.tf` with `vms/*.yaml` and `network/cts/*.yaml`, `network/identities.yaml`, `_shared/ansible/inventory.yml`, `.gitmodules`.

pve-vctcn (`/Users/mouriya/Ext/code/pve-vctcn`): `AGENTS.md`, `apps/*/{main.tf,README.md,variables.tf}`, the compose templates under `apps/*/templates/`.

`homelab-tf/docs/iac-drift-investigation/*` is historical incident evidence, not current inventory; it may hold stale placement or sensitive details.

## Refreshing this skill

This skill's source is `skills/internal-services/SKILL.md` in `Mouriya-Emma/skills` (local checkout `/Users/mouriya/Ext/code/skills`); installed copies under `~/.agents/skills` and `~/.claude/skills` are deployment artifacts, never editing targets.

1. In the checkout, `git fetch` and work on current `origin/main`; read its `AGENTS.md`. Preserve any existing uncommitted work.
2. Collect current evidence from the sources above and both Cores' live reads. Initialize only the submodules whose detail is needed; report unavailable evidence as unknown.
3. Recompute with the counting policy into a named list; reconcile top-level services versus helpers, homelab versus vctcn placement, retired items, duplicate names, declaring sources, and missing or stale skills.
4. Replace stale prose directly; do not append contradictory notes or store a numeric total. Keep operational runbooks in their own skills; if another skill is stale, fix it in the same checkout.
5. Deliver as the repo's `AGENTS.md` prescribes (direct commit to `main`, push), then deploy only the changed skills with `npx skills update <name> --global`. Confirm `diff -r skills/<name> ~/.agents/skills/<name>` prints nothing and `~/.claude/skills/<name>` resolves to `~/.agents/skills/<name>`.

When the evidence calls for host, network, storage or Komodo-installation changes, use `iac-projects`; for app changes, use `km`. A refresh does not itself authorize those changes.
