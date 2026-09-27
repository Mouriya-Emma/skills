---
name: km-gitops
description: Run Komodo ResourceSyncs, Procedures and Actions. Inspect declaration diffs before run-sync, distinguish run-sync from commit-sync (a write-back whose destination and eligibility depend on the sync's mode), and verify terminal execution plus resulting runtime. Use for GitOps sync and operator-defined orchestration.
allowed-tools: Bash, Read
---

# ResourceSync, Procedure and Action workflows

A **ResourceSync** reconciles declared resources. A **Procedure** chains executions; an **Action** runs operator-defined code. Their names do not establish their effects. Select a Core through `skill://container-management`; use `skill://km-endpoints` for connection/profile problems.

## Inspect before choosing a direction

```bash
core=homelab
km -p "$core" ls syncs -f json
km -p "$core" ls procedures -f json
km -p "$core" ls actions -f json
```

Inspect the selected resource's full configuration and pending changes in the Komodo UI; if the listing is insufficient and an API read is needed, use `skill://km-api` with the installed Core's schema. Establish repository, branch, paths, targets and owner. For Procedures/Actions read their steps/code, permissions and nested targets, including destructive actions and external side effects.

For repo-backed workloads, `komodo/syncs/` and `stacks/` in the owning workload repo are authority. Its ResourceSync/secrets-sync CI workflow supplies bounded Variables/secrets and runs reconciliation; see `skill://local-cicd`. Do not bypass it with live config edits or substitute an IaC playbook based on historical usage.

## Apply declarations: run-sync

1. Inspect the declaration revision and **pending create/update/delete diff** before execution. Surface the affected resources, removals and drift to the user. If a diff is unavailable, do not assume the sync is harmless; resolve the preview/inspection gap before applying to shared state.
2. Establish that the desired change is authorized. Deletions and other destructive changes need explicit scope/impact confirmation. Prefer the owning repo's workflow for normal changes; use direct execution for a requested or bounded retry with the same declared revision and prerequisites.
3. Set `sync` to the inspected name and execute:

   ```bash
   km -p "$core" x run-sync "$sync"
   ```

4. Wait for its terminal execution result in Komodo and inspect failures. Re-read resulting resources, including each affected Stack's repo/branch/file path. In Komodo 2.x, RunSync also runs the deploy work its configuration requests for changed Stacks/Deployments (`deploy_from_cache`), so do not issue a second deploy by habit. A successful sync still does **not** prove application health: run the real application smoke via `skill://km-stack`, and use a separate Stack lifecycle action only as an authorized, bounded retry.

## Capture live state: commit-sync

```bash
km -p "$core" x commit-sync "$sync"
```

This is a write, not a preview or a local commit. Its destination is the ResourceSync's source: the Git repo for repo-backed syncs, a Core-host file for `files_on_host`, or the sync's own `file_contents` for UI-defined syncs. Komodo 2.2.0 rejects it unless the sync is `managed = true` (or fresh). All current homelab and trading syncs are repo-backed with `managed = false`, so commit-sync is rejected for them — their declarations change only through the owning workload repo. For an eligible sync, before running, inspect the current drift, destination, proposed changes and write authority. Confirm that the user intends to preserve that live state, rather than overwrite the intended declaration with accidental drift. Check that no secret values will be committed.

Afterward inspect the actual destination commit/diff and any triggered CI. Verify it contains only the intended state, then follow the repository's review/reconciliation path. Do not run `commit-sync` as a remedy for a failing `run-sync`: that reverses authority rather than fixing the declaration error.

## Execute a Procedure or Action

Set `procedure` or `action` from the inspected inventory; execute only the chosen operation:

```bash
km -p "$core" x run-procedure "$procedure"
km -p "$core" x run-action "$action"
```

Record the terminal result of each relevant step and verify its final effects, not merely that the outer job started. A failed chain may leave earlier steps applied. Before retrying, identify completed effects and whether repeating them is safe; rerun only through the resource's supported recovery path. Do not wildcard-run unrelated resources.

## Recovery

On a failed sync, inspect the execution logs and live partial state; repair repo declarations or the authorized Variables/secrets path, then rerun the owning workflow and verify the entire affected path. On an incorrect write-back, use the repository's normal reviewed correction/revert process, not another blind commit-sync. Connection failures route to endpoints; ownership or host-provisioning changes route to IaC, not a custom Action workaround.
