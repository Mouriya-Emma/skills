# Komodo Stack operations

A Stack is a Compose project managed by Komodo. Core selection, `-p`, the authority table and the CLI/Core version-mismatch fallback are in `../SKILL.md`; profile problems are in `endpoints.md`. Examples select homelab explicitly; use trading when that is the established target.

## Inspect the target and declaration source

```bash
core=homelab
km -p "$core" ls stacks -a -f json
```

The default listing hides down Stacks. Resolve the exact Stack and Server from this inventory, not a memorized service list. Inspect its `repo`, `branch`, file path and `file_contents` configuration in the resource details; if the listing does not expose full config, use the Komodo UI or a version-matched `GetStack` read (`api.md`).

- **`repo` set, `file_contents=false`:** the owning workload repo (`komodo/syncs/` and `stacks/`) is declaration authority. Change it there; the push reaches km through its webhook and ResourceSync (`gitops.md`, onboarding steps in `../SKILL.md`). Direct live config edits are not a substitute. This reference covers inspection, bounded retry and lifecycle operations.
- **`repo` empty, `file_contents` non-empty:** not repo-declared. Do not edit it as if it were the declaration, and do not create new Stacks of this shape. Its fix is moving the compose into a workload repo with its own ResourceSync (`../SKILL.md`).
- **Neither shape is established:** inspect ownership before changing config. Do not guess which field wins.

Keycloak stays in IaC under the placement criterion (post-deploy realm/client/user configuration); it is not a km Stack. Retired services (for example Mattermost and Forgejo on VM 180, the moat VM 111–113 Stacks) are never deployed again; down or unknown records of them do not authorize any deploy.

## Choose the smallest action that meets the request

Set `stack` to the exact name found above. These commands are alternatives, not a sequence to run wholesale.

| Need | Command | Distinction |
|---|---|---|
| Routine reapply when Compose content changed | `km -p "$core" x deploy-stack-if-changed "$stack"` | Avoids unnecessary redeploys; do not use this as proof a new mutable image tag was pulled |
| Deploy/redeploy the declared project | `km -p "$core" x deploy-stack "$stack"` | Applies Stack configuration |
| Pull configured images | `km -p "$core" x pull-stack "$stack"` | Pulling alone does not replace running containers; deploy if rollout is intended |
| Restart existing services | `km -p "$core" x restart-stack "$stack"` | Not a declaration or image rollout |
| Start existing stopped services | `km -p "$core" x start-stack "$stack"` | Does not stand in for applying changed Compose |
| Stop the project | `km -p "$core" x stop-stack "$stack"` | Intentional downtime |
| Tear down project runtime | `km -p "$core" x destroy-stack "$stack"` | Destructive; inspect mounts/data consequences and obtain explicit scoped authorization |

Service-scoped forms: `pull-stack`, `start-stack`, `restart-stack`, `stop-stack` and `destroy-stack` accept trailing `[SERVICES]...` (`stop-stack` takes optional `STOP_TIME` before the services); destroy still needs explicit destructive-scope authorization. For a confirmed non-Swarm Compose Stack, a service-scoped deployment is also available:

```bash
# stack and service come from the inspected project.
km -p "$core" x deploy-stack "$stack" "$service"
```

This is a **deployment**, not just a restart. Service filtering is ignored for Swarm-mode Stacks; do not claim bounded service scope there. For raw-container exceptions use `container.md`. Avoid wildcard/batch operations until every matched project and its impact are explicitly in scope.

## Verify and recover

1. Read the execution's terminal result and error/log details in CLI output or Komodo UI. An accepted request is not completion.
2. Re-read the Stack and its Server's containers:

   ```bash
   km -p "$core" ls stacks -a -n "$stack" -f json
   km -p "$core" ps -a -s "$server"
   ```

   Set `server` from the inspected Stack. Check expected service state and actual image/version; for stop/destroy, check the intended stopped/absent runtime instead of expecting “running”.
3. For deploy/restart, execute the service's real user/API workflow and check persistence/downstream effects. For a declaration change, also confirm the live repo/branch/file path matches the owning revision. Container state alone is insufficient.
4. On failure, inspect terminal logs and current state before retrying. Fix declaration errors in the owning repo, complete its sync, then retry only the affected Stack. Do not delete containers, rewrite live config or roll back unrelated projects to suppress the symptom. Any rollback must use an established revision/image and the same authority path.

A runtime teardown and deletion of a Komodo resource/declaration are different operations. If permanent removal is intended, update the owning declaration through its workflow rather than leaving drift for the next sync to reconcile.
