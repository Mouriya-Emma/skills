# Private registry internals

How `registry.237575.xyz` authenticates, how GARM runners and Komodo reach it, and how to tell its failures apart. Onboarding a pushing repo and the workflow step are in [SKILL.md](../SKILL.md#private-registry-registry237575xyz).

## How authentication works

The Docker password is a **Keycloak access token**, never the client secret:

1. A token producer runs client_credentials against realm `registry`, client `registry`, and gets an access token whose `aud` includes `registry` (a client audience mapper; Keycloak 26.6.2+ refuses introspection otherwise).
2. `docker login registry.237575.xyz -u sa-registry --password-stdin` with that token. The username must be literally `sa-registry`.
3. On **every** registry token request (each push/pull scope), Docker re-sends that stored token; docker_auth introspects it at Keycloak and, if active, issues a 900-second registry JWT.

So the Keycloak token must still be valid at every push and pull, not just at login. Its effective lifetime is **1800 seconds** today (realm SSO session cap), there is no refresh token, and the action does not renew it. Use the action's `expires-in` output, not a remembered default.

## Network path from GARM runners

Docker-capable runners resolve `registry.237575.xyz` to VM 182's mesh IP via `/etc/hosts`; VM 182's `registry-mesh-forward` (socat, Stack `mesh-forward` in `vctcn-edge`) passes TCP :443 through to NPM, which terminates TLS and routes `/v2/` to the registry and `/auth` to docker_auth. TLS and the `/auth` realm URL are identical to the public path. Outside the mesh (GitHub-hosted runners, off-mesh laptops) the name resolves publicly to the vctcn host. Since pve-vctcn#360 the vctcn host hairpins `172.16.1.0/24` traffic for `192.99.9.212:80/443` back to NPM on CT 171, so the public path also works from inside vctcn; the pinned mesh path stays the default for both runner kinds.

A push opens a burst of parallel connections at once (roughly one blob HEAD per layer). From the edge host (~180 ms RTT) those handshakes complete together, so the forwarder's listen queue must hold them: with socat's default backlog of 5 the VM 182 kernel reset most of them and edge pushes failed with `connection reset by peer` while auth had already succeeded (pve-vctcn#302, fixed with `backlog=1024`). Lowering `max-concurrent-uploads` does not help, because the HEAD checks are not bounded by it. If that error returns, check the listener first on VM 182: `ss -ltn 'sport = :443'` (Send-Q is the backlog) and `nstat -az TcpExtListenOverflows TcpExtTCPReqQFullDoCookies TcpOutRsts`.

## Pull side (Komodo deploy)

Komodo Periphery never uses a CI runner's login. The target Core's Komodo installation (`homelab-tf/komodo`, role `komodo-registry-account`) maintains a `DockerRegistryAccount` `{domain: registry.237575.xyz, username: sa-registry}` holding a client_credentials access token, re-minted every 15 minutes by the Komodo Action `refresh-registry-237575-token` (shorter than the 1800-second lifetime). The workload's Stack declaration binds it:

```toml
registry_provider = "registry.237575.xyz"
registry_account = "sa-registry"
```

Only the primary homelab Core has this account today. Deploying a private image to another Core (trading included) first needs that Core's Komodo installation to provision the account and refresher (`iac-projects`). Before relying on a pull, check the account exists and the refresher Action's last run succeeded.

## Telling failures apart

| Symptom | Meaning | Where to look |
|---|---|---|
| `unauthorized: Auth failed` at login or on a later push/pull | Keycloak token rejected: expired, wrong secret, missing/unsynced repo secret, or audience/introspection broken | token age vs `expires-in`; repo listed in the IaC sync; docker_auth logs on VM 182; Keycloak `INTROSPECT_TOKEN_ERROR` |
| `denied` / 403 | docker_auth ACL (only `sa-registry` is allowed) | username used at login |
| `connection reset by peer` / EOF to the registry IP | transport, not auth; login and token issuance already succeeded | runner kind (resident vs edge); VM 182 mesh-forward backlog and listen-overflow counters (see Network path); then NPM logs |
| Deploy pull fails, CI pull works | target Core's registry account or refresher | Core `DockerRegistryAccount`, refresher Action history, Stack `registry_account` binding |
