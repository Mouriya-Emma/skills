---
name: keycloak
description: Guide vctcn-owned Keycloak SSO/OIDC/SAML integration, realms, clients, users, and protocol mappers. Includes read-only Admin REST inspection. Keycloak stays in IaC because its realm/client/user configuration is applied after deploy; durable changes go through the pve-vctcn workspace. Use internal-services for global inventory.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, WebFetch, mcp__ssh-manager__ssh_execute
disable-model-invocation: true
---

# Keycloak SSO integration

## Authority and realm selection

Use these current checkout sources before acting on placement or configuration:

- `/Users/mouriya/Ext/code/devops/pve-vctcn/apps/vctcn-app1/main.tf`
- `/Users/mouriya/Ext/code/devops/pve-vctcn/apps/vctcn-app1/templates/compose.yaml.tftpl`
- `/Users/mouriya/Ext/code/devops/pve-vctcn/apps/registry/main.tf`

The placement guide is VM 180 `vctcn-app1`, public/admin URL `https://keycloak.237575.xyz`, owned by `pve-vctcn`. Verify it against those sources and live state for an operational task; this skill is not a live inventory. Host-level inspection of VM 180 uses ordinary `ssh vctcn-app1.mouriya.lan`; in Claude Code, where the `ssh-manager` MCP server is configured, `mcp__ssh-manager__ssh_execute` is an optional equivalent that other harnesses do not have.

| Realm | Purpose / selection |
|---|---|
| `moat` | Human SSO clients: OpenCloud's public client `web`, plus the retained clients of the retired Mattermost and Forgejo, and the `moat-platform` confidential/service-account client used for Standard Token Exchange. Use for human-facing apps unless current IaC specifies otherwise. |
| `registry` | Machine authentication for `registry.237575.xyz` and `sa-registry`; keep separate from human login. |
| `master` | Admin authentication only; do not create application clients here. Its two admins are declared in `apps/vctcn-app1/main.tf`: `mouriya` (the operator) and `riri-agent` (agents and automation). |

A similarly named realm or service record elsewhere does not establish ownership. Check current IaC before selecting it.

## Durable integration workflow

Keycloak is the reference case of an app that stays in IaC under the placement criterion in `personal-infra-routing`: its realm, client, user and mapper configuration is applied after the containers start, through the OpenTofu Keycloak provider. Changes to clients, redirects, realm settings, users, mappers, or their secrets therefore go through the pve-vctcn workspace (`iac-projects`). Load `pve-vctcn/AGENTS.md` and its rules before implementation; external app agents supply the integration contract rather than editing IaC from app context. Execution-ready handoffs go to an issue in the IaC repo with explicit login/token verification. A Keycloak client used by a km app is an external object that app consumes through `.env`; it does not move the app into IaC.

1. Classify the consumer as human-facing or machine-facing.
2. Establish its client ID, public URL, exact redirect URIs, web origins, required claims/groups/roles, and confidential/public-client requirements from the app contract.
3. Implement the realm/client/mapper or compose-managed configuration in the owning OpenTofu workspace, using its issue/PR and apply boundaries.
4. Verify the real browser login or token flow, claims, redirect, and resulting authenticated app behavior. API resource existence alone is not proof of an SSO integration. Put layered evidence in the PR via `writing-pr`.

Admin REST examples below are inspection, not an alternative persistent configuration path. Emergency/manual reconciliation requires explicit scope and authorization and must be reconciled to IaC.

The admin credential lives in OpenBao, not in a file in the pve-vctcn repo. Rotate it with an `admin` token against `kv/mouriya-devops/pve-vctcn/ops`; do not write it back into any repository or into the Keycloak provider state by hand.

## Authentication helper

`token.sh` sits in this skill's directory (the directory containing this SKILL.md); the example passes its path to the child as `KC_HELPER`. It consumes environment credentials; it does not discover or store them. Agents authenticate as the master-realm admin `riri-agent`, never as the operator's `mouriya`. Its password is the `keycloak_agent_password` field of `kv/mouriya-devops/pve-vctcn/ops`; `bao-exec` reads it with the workstation identity, so the password exists only inside that child process and only the resulting token comes back:

```bash
KC_TOKEN=$(KC_HELPER=<skill-dir>/token.sh bao-exec run --path kv/mouriya-devops/pve-vctcn/ops -- bash -c '
  export KC_ADMIN_USERNAME=riri-agent
  export KC_ADMIN_PASSWORD="$keycloak_agent_password"
  source "$KC_HELPER" || exit 1
  printf %s "$KC_TOKEN"')
```

Never put the password in the agent's own shell: no `export KC_ADMIN_PASSWORD=…` outside `bao-exec`, and no printing of the token or the password. `bao-exec` needs the workstation identity (`BAO_ADDR`, `BAO_EXEC_AUTH`, `~/.config/bao-exec/{role_id,secret_id}`). If the read fails, investigate the integration gap rather than asking the user to paste secrets or run the command for you.

| Variable | Contract |
|---|---|
| `KC_ADMIN_USERNAME` | Required, nonempty; `riri-agent` |
| `KC_ADMIN_PASSWORD` | Required, nonempty; the OpenBao field `keycloak_agent_password` |
| `KC_HOST` | Optional; defaults to `https://keycloak.237575.xyz` |
| `KC_TOKEN` | Set by the sourced helper after master-realm password grant using client `admin-cli` |

The helper is sourced inside the `bao-exec` child shown above, which is the only place the two variables are set. Sourcing it directly in the agent's shell only works when that shell already holds both credentials, which is not the intended path.

Stop on a nonzero source result. Missing env produces `KC_ADMIN_USERNAME and KC_ADMIN_PASSWORD must be set`; an empty/null token produces `Failed to obtain Keycloak admin token`. Inspect reachability, host/realm, credential source, and grant policy without echoing the password/token. A successful source permits the inspection request; it does not establish that the token has every admin permission. Treat token responses and shell traces as sensitive.

## Read-only examples

List client IDs in the first page:

```bash
REALM=moat
curl -fsS "$KC_HOST/admin/realms/${REALM}/clients?first=0&max=100" \
  -H "Authorization: Bearer $KC_TOKEN" | jq '.[].clientId'
```

For a complete inventory, continue pagination until exhausted; the example's 100-row page is not a total. For a known client, set `CLIENT_ID` from the task-confirmed app contract before running the query; do not use a placeholder or infer a client from another service example. The query fails before any request when `CLIENT_ID` is unset or empty and requires exactly one result before using its UUID:

```bash
(
  set -o pipefail
  : "${CLIENT_ID:?Set CLIENT_ID from the task-confirmed app contract}"
  REALM=moat
  CLIENT_UUID=$(curl -fsS --get "$KC_HOST/admin/realms/${REALM}/clients" \
    --data-urlencode "clientId=${CLIENT_ID}" \
    -H "Authorization: Bearer $KC_TOKEN" | jq -er 'if length == 1 then .[0].id else error("expected one client") end') || exit
  printf '%s\n' "$CLIENT_UUID"
)
```

Use OIDC discovery to confirm endpoints for the selected realm:

| Endpoint | URL pattern |
|---|---|
| Issuer | `https://keycloak.237575.xyz/realms/<realm>` |
| Discovery | `https://keycloak.237575.xyz/realms/<realm>/.well-known/openid-configuration` |
| Authorization | `<issuer>/protocol/openid-connect/auth` |
| Token | `<issuer>/protocol/openid-connect/token` |
| Userinfo | `<issuer>/protocol/openid-connect/userinfo` |
| Logout | `<issuer>/protocol/openid-connect/logout` |
| JWKS | `<issuer>/protocol/openid-connect/certs` |

## Consumer-specific sources

For OpenCloud, read `keycloak_openid_client.opencloud_web`, its client roles and `roles` mapper in `apps/vctcn-app1/main.tf`; the OpenCloud side is appliance-local compose on OMV (pve-vctcn#291).

Mattermost and Forgejo are retired; their `moat` clients, mappers and users remain declared in `apps/vctcn-app1/main.tf` as retained identity (pve-vctcn#286), not live integrations.

For `moat-platform` token exchange, read the `moat-platform` client and its token-exchange notes in `apps/vctcn-app1/main.tf`.

For registry machine auth, read `apps/registry/main.tf`, `README.md`, `templates/docker_auth.yml.tftpl`, and `templates/ext_auth.sh.tftpl`. Do not turn the registry service-account flow into a human-login client in `moat`.
