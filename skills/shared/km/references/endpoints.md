# Komodo endpoint inventory

This reference owns connection inventory, not service lifecycle operations (those are in `../SKILL.md` and its other references).

## Files and authority

Helpers below live in the km skill directory, the parent of this `references/` directory; the commands hold that directory in `KM_SKILL`. The sole endpoint inventory is `${XDG_CONFIG_HOME:-$HOME/.config}/komodo/endpoints`, outside all skill installation directories. It holds no credentials: each entry names the Core address and the OpenBao path and fields that hold the Core's API key. The values live only in OpenBao and reach `km` through `bao-exec` for the duration of one command.

| Path | Contract |
|---|---|
| `${XDG_CONFIG_HOME:-$HOME/.config}/komodo/endpoints/<name>.toml` | One file per Core, exactly the string fields `host`, `bao_path`, `key_field`, `secret_field`; the filename is the endpoint name used by `-p` |
| `bin/km` | `km` on `PATH` (`~/.local/bin/km` is a symlink to it). `km -p <name> …` runs the real CLI (`/opt/homebrew/bin/km`, override with `KM_REAL_BIN`) through `endpoint-run.sh`; config-file search is pinned to the inventory directory, so no `komodo.cli.toml` is read |
| `bin/endpoint-run.sh <name> -- <command>` | Reads `bao_path` through `bao-exec` and runs the command with `KOMODO_CLI_HOST`, `KOMODO_CLI_KEY`, `KOMODO_CLI_SECRET` set from `host`, `key_field`, `secret_field`; rejects missing, malformed or extra inventory fields and empty OpenBao fields before the command starts |
| `bin/list.sh` | Prints each endpoint name, host and OpenBao path |

Current entries:

| Endpoint | Owning deployment | `bao_path` | `key_field` / `secret_field` |
|---|---|---|---|
| `homelab` | `mouriya-devops/homelab-tf` | `kv/mouriya-devops/homelab-tf/ops` | `komodo_api_key` / `komodo_api_secret` |
| `trading` | `mouriya-devops/homelab-tf` | `kv/mouriya-devops/homelab-tf/ops` | `komodo_trading_api_key` / `komodo_trading_api_secret` |
| `nekoringo` | `mouriya-devops/nekoringo-iac` (`apps/komodo`) | `kv/mouriya-devops/nekoringo-iac/ops` | `komodo_api_key` / `komodo_api_secret` |
| `soroic` | `Pepgent/iac` | `kv/Pepgent/iac/ops` | `komodo_api_key` / `komodo_api_secret` |
| `cachyos` | `mouriya-s-lab/build-edge` (`cachyos/komodo`) | `kv/mouriya-s-lab/build-edge/ops` | `komodo_api_key` / `komodo_api_secret` |

Register only a Core that actually exists, from the deployment that owns it, and put its API key in that deployment's OpenBao `ops` path; the workstation reads it with its default `bao-exec` identity. Do not write a key or secret into the inventory file. Keep the directory private (mode `0700`, files `0600`), outside repositories and skill directories. Installing or updating the skill does not populate this inventory.

Known routing: `homelab` is homelab-app1 / VM 110; `trading` is trading-agent / VM 130; `nekoringo` is an independent Core at `http://218.33.108.254:9120`; `cachyos` runs Komodo 2.2.0, older than the local CLI, so use REST (`api.md`) there. Check each endpoint with a real read (`km -p <name> ls servers`) before relying on it.

## List and select

```bash
KM_SKILL=<km-skill-dir>
bash "$KM_SKILL/bin/list.sh"
km -p homelab config
```

`km config` is sanitized by default; do not add `--unsanitized`. Every real command passes `-p <name>` as the **first** argument. There is no default endpoint and no global selection, so concurrent shells can use different Cores. `km` without `-p` has no credentials.

## Install the wrapper

```bash
KM_SKILL=<km-skill-dir>
ln -sfn "$KM_SKILL/bin/km" ~/.local/bin/km
command -v km    # must print ~/.local/bin/km
```

`~/.local/bin` precedes `/opt/homebrew/bin` on `PATH`. A shell that resolves `km` to `/opt/homebrew/bin/km` has no credentials and fails to connect.

## Add, change or remove a connection

1. Identify the deployment that owns the Core and its OpenBao `ops` path. The `iac-projects` skill covers homelab-tf and pve-vctcn; the Nekoringo Core belongs to `nekoringo-iac/apps/komodo`; for any other Core verify its deployment repository first. If the Core does not exist yet, route provisioning there rather than registering an imagined endpoint.
2. Write the Core's API key and secret into that path (value on stdin, e.g. `bao kv patch <path> -` with a JSON object), with a write-capable identity.
3. Write `<name>.toml` with `host`, `bao_path`, `key_field`, `secret_field`. Remove an endpoint only when its retirement is established; check consumers before removing their connection.
4. Make a read-only connection check against the intended Core:

   ```bash
   km -p "$core" ls servers
   ```

The Server listing must come from the intended Core.

## Use REST credentials without displaying them

`api.md` runs `curl` under `endpoint-run.sh`. The key and secret exist only in that command's environment; pass them as headers through a file descriptor so they never reach `argv`:

```bash
KM_SKILL=<km-skill-dir>
bash "$KM_SKILL/bin/endpoint-run.sh" homelab -- bash -c '
  curl --silent --show-error --fail-with-body -X POST "$KOMODO_CLI_HOST/read" \
    -H "Content-Type: application/json" \
    -H @<(printf "x-api-key: %s\nx-api-secret: %s\n" "$KOMODO_CLI_KEY" "$KOMODO_CLI_SECRET") \
    -d "{\"type\":\"GetVersion\",\"params\":{}}"'
```

Do not echo the variables, enable shell tracing or verbose curl.

## Recovery

- **`endpoint '<name>' not found`:** list endpoints; if the Core exists, add its inventory entry from the owning deployment. Do not switch to a different Core merely to make a command run.
- **Inventory field error:** correct the named field in `<name>.toml`; the file must contain only the four fields.
- **`bao-exec` failure:** the category it names (`config`, `auth`, `path`, `field`, `addresses`) points at the workstation identity, the path or the field; fix that link, do not take the key from another source.
- **Empty OpenBao field / 401 from the Core:** the key in OpenBao is missing or revoked; rotate it through the owning deployment and write the new value to the same path.
