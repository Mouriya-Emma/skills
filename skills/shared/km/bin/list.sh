#!/bin/bash
set -euo pipefail

ENDPOINTS_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/komodo/endpoints"

exec python3 - "$ENDPOINTS_DIR" <<'PY'
import pathlib
import sys

try:
    import tomllib
except ImportError:
    sys.exit("ERROR: list.sh requires Python 3.11+ with stdlib tomllib")

files = sorted(pathlib.Path(sys.argv[1]).glob("*.toml"))
if not files:
    sys.exit(f"No endpoints defined in {sys.argv[1]}")
for f in files:
    try:
        data = tomllib.loads(f.read_text())
    except (OSError, UnicodeError, tomllib.TOMLDecodeError):
        print(f"{f.stem:<20} ERROR: unreadable or invalid TOML")
        continue
    print(f"{f.stem:<20} {data.get('host', '')}  {data.get('bao_path', '')}")
PY
