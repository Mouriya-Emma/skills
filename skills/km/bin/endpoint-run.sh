#!/bin/bash
set +x
set -euo pipefail

ENDPOINTS_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/komodo/endpoints"

if [ "$#" -lt 3 ] || [ "$2" != "--" ]; then
    echo "Usage: $(basename "$0") <endpoint> -- <command> [args...]" >&2
    exit 2
fi

name="$1"
shift 2
endpoint_file="$ENDPOINTS_DIR/${name}.toml"

if [ ! -f "$endpoint_file" ]; then
    echo "ERROR: endpoint '$name' not found at $endpoint_file" >&2
    exit 1
fi

fields=$(python3 - "$endpoint_file" <<'PY'
import re
import shlex
import sys

try:
    import tomllib
except ImportError:
    sys.exit("ERROR: endpoint-run.sh requires Python 3.11+ with stdlib tomllib")

try:
    with open(sys.argv[1], "rb") as endpoint:
        data = tomllib.load(endpoint)
except (OSError, UnicodeError, tomllib.TOMLDecodeError):
    sys.exit("ERROR: endpoint file is unreadable or invalid TOML")

field_name = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
checks = {
    "host": lambda v: re.match(r"^https?://", v) is not None,
    "bao_path": lambda v: v.startswith("kv/") and "\n" not in v,
    "key_field": lambda v: field_name.match(v) is not None,
    "secret_field": lambda v: field_name.match(v) is not None,
}
out = []
for field, valid in checks.items():
    value = data.get(field)
    if not isinstance(value, str) or not valid(value):
        sys.exit(f"ERROR: endpoint requires a valid string field: {field}")
    out.append(f"{field.upper()}={shlex.quote(value)}")
extra = sorted(set(data) - set(checks))
if extra:
    sys.exit("ERROR: endpoint has unsupported fields: " + ", ".join(extra))
sys.stdout.write("\n".join(out) + "\n")
PY
) || exit 1
eval "$fields"

exec bao-exec run --path "$BAO_PATH" -- bash -c '
set +x
set -eu
key=${!2-}
secret=${!3-}
if [ -z "$key" ] || [ -z "$secret" ]; then
    echo "ERROR: OpenBao fields $2/$3 are empty" >&2
    exit 1
fi
export KOMODO_CLI_HOST="$1" KOMODO_CLI_KEY="$key" KOMODO_CLI_SECRET="$secret"
unset key secret
shift 3
exec "$@"
' endpoint-run "$HOST" "$KEY_FIELD" "$SECRET_FIELD" "$@"
