# GARM onboarding / pool shape

Onboarding commands: see `pve-vctcn/apps/runner/README.md` ("GARM 仓 onboarding" and "边缘 Incus provider"). The shape they produce:

1. GARM repository entity with balancer `pack` and a GitHub webhook installed by GARM.
2. A resident `lxd_local` pool (`priority=100`, enabled) with labels matching the workflow `runs-on`.
3. An edge `incus_edge` pool (`priority=0`, image `images:ubuntu/24.04/cloud`) with the same base labels, flavor, OS, bootstrap timeout and `extra_specs` as the resident pool; the only intended label difference is an operator-added `cachyos` capability. It is created disabled; only the availability gate writes its `enabled` — never pass `--enabled` to an edge pool.
4. Docker build/push or job-container workflows require the Docker-capable pool shape (`flavor=docker`, `runner-bootstrap-timeout=60`, helper `--docker`).
5. Optional arm64 pool: `incus_oracle`, `--os-arch arm64`, tags `self-hosted,linux,arm64`, created `--enabled`, `extra_specs` copied from the resident pool (command in the runner README, "arm64 Incus provider（Oracle A1）").

Existing pools are changed live with `garm-cli pool update` on VM 181, applying the same change to both pools of a repo; OpenTofu does not manage repository registrations, pool labels, or `extra_specs`.

## Runner environment differences a workflow must tolerate

- Mesh access comes from the runner host's NetBird peer: VM 181 (LXD bridge NAT) for resident runners, the CachyOS edge host for edge runners, `oracle-a1` for arm64 runners. Edge and arm64 runners cannot reach vctcn `172.16.1.0/24`.
- In Docker-capable pools, `registry-mesh-hosts.sh` in `extra_specs` pins `registry.237575.xyz` to VM 182's mesh IP on every runner kind; non-Docker pools get no pin. See [Private registry](../SKILL.md#private-registry-registry237575xyz) for what that path implies.
- Only resident runners have the `/mnt/docker-images` cache for `catthehacker/ubuntu:act-24.04`; edge and arm64 runners pull it (the image has an arm64 variant).
- Edge runner files have no Linux file capabilities (`ping` works through `ping_group_range`); values are fetched from OpenBao by `bao-exec` on the edge host, so that host needs the mesh route to both nodes; the edge host going offline fails the running job.
- `yq` and `sops` are installed by `binary-tools-install.sh` only when the pool was built with them requested (`--extra-packages yq,…`; `sops` is no longer needed by the sync jobs). The installer downloads with `curl`, so request `curl` too, and `jq` for the sync script. `bao-exec` is not a pool package: each repo's install step puts it in the job-local toolchain dir. Do not assume these tools on other pools.
- Do not inject old per-runner `netbird-install.sh`.
