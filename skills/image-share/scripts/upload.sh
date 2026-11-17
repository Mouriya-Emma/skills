#!/usr/bin/env bash
# Upload a local image to the operator's 0721 image host
# (img.237575.xyz) and print a public URL on stdout.
#
# Auth is auto-resolved:
#   1. $ZERO721_PASSWORD env var (highest priority, for explicit overrides)
#   2. the vctcn-edge OpenBao ops path (the 0721 Stack's workload repo):
#      VCTCN_EDGE_ZERO721_RUNTIME_PASSWORD, the retained admin's login password,
#      read by bao-exec from kv/mouriya-s-lab/vctcn-edge/ops
#
# Exit code is the source of truth for success/failure. On success exactly one
# line is written to stdout (the URL, or markdown form with -m). All diagnostics
# go to stderr.

set -euo pipefail

BASE_URL="${ZERO721_BASE_URL:-https://img.237575.xyz}"
EMAIL="${ZERO721_EMAIL:-mouriya@vctcn.local}"
OPENBAO_PATH="${ZERO721_OPENBAO_PATH:-kv/mouriya-s-lab/vctcn-edge/ops}"
PASSWORD_FIELD="VCTCN_EDGE_ZERO721_RUNTIME_PASSWORD"

usage() {
  cat >&2 <<'USAGE'
Usage: upload.sh [-m|--markdown] <path-to-image>

Options:
  -m, --markdown   Output `![](URL)` instead of the bare URL.
  -h, --help       Show this help.

Environment overrides:
  ZERO721_BASE_URL     default: https://img.237575.xyz
  ZERO721_EMAIL        default: mouriya@vctcn.local
  ZERO721_PASSWORD     explicit password override
  ZERO721_OPENBAO_PATH default: kv/mouriya-s-lab/vctcn-edge/ops

Default auth comes from the vctcn-edge OpenBao ops path
(VCTCN_EDGE_ZERO721_RUNTIME_PASSWORD) through bao-exec, using the
workstation OpenBao identity (BAO_ADDR, BAO_EXEC_AUTH and the approle
files). The password and the token reach their consumers only through a
process environment or stdin: they never appear in argv, stdout or stderr.

Stdout (success): https://img.237575.xyz/media/<key>
Exit codes: 0 ok, 1 runtime error, 2 usage error.
USAGE
}

die() { echo "ERROR: $*" >&2; exit 1; }

MARKDOWN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--markdown) MARKDOWN=1; shift ;;
    -h|--help)     usage; exit 0 ;;
    --)            shift; break ;;
    -*)            usage; exit 2 ;;
    *)             break ;;
  esac
done
[[ $# -eq 1 ]] || { usage; exit 2; }

IMG_PATH=$1
[[ -f "$IMG_PATH" ]] || die "file not found: $IMG_PATH"
[[ -r "$IMG_PATH" ]] || die "file not readable: $IMG_PATH"

command -v curl >/dev/null || die "curl not in PATH"
command -v jq   >/dev/null || die "jq not in PATH"

read_openbao_password() {
  command -v bao-exec >/dev/null \
    || die "bao-exec not in PATH; install its release binary from mouriya-devops/bao-exec (OpenBao is the credential source), or set ZERO721_PASSWORD"
  local pw
  # bao-exec exports the path's fields into the printenv child only; the
  # value travels through the pipe, never through argv.
  if ! pw=$(bao-exec run --path "$OPENBAO_PATH" -- printenv "$PASSWORD_FIELD"); then
    die "OpenBao read failed: bao-exec could not read $OPENBAO_PATH (check BAO_ADDR, the bao-exec identity and the path's policies)"
  fi
  [[ -n "$pw" ]] || die "OpenBao field $PASSWORD_FIELD is empty at $OPENBAO_PATH"
  printf '%s' "$pw"
}

resolve_password() {
  if [[ -n "${ZERO721_PASSWORD:-}" ]]; then
    printf '%s' "$ZERO721_PASSWORD"
    return
  fi
  read_openbao_password
}

response_body_path() {
  local name=$1
  local dir="${XDG_CACHE_HOME:-$HOME/.cache}/image-share"
  mkdir -p "$dir"
  printf '%s/%s.%s.body' "$dir" "$name" "$$"
}

login() {
  local pw=$1
  local resp http body_file
  body_file=$(response_body_path 0721-login)
  # The password reaches jq as an environment value and curl's request body on
  # stdin: neither process ever sees it in argv.
  resp=$( ZERO721_PW=$pw jq -nc --arg n "$EMAIL" '{name:$n,password_raw: env.ZERO721_PW}' \
    | curl -sS -o "$body_file" -w '%{http_code}' \
    -X POST "$BASE_URL/api/auth/login" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
    -m 15) || { rm -f "$body_file"; return 1; }
  http=$resp
  if [[ "$http" != 2?? ]]; then
    rm -f "$body_file"
    return 1
  fi
  local tok
  tok=$(jq -r .token < "$body_file" 2>/dev/null || true)
  rm -f "$body_file"
  [[ -n "$tok" && "$tok" != null ]] || return 1
  printf '%s' "$tok"
}

upload() {
  local token=$1 path=$2 name
  name=$(basename "$path")
  local resp http body_file
  body_file=$(response_body_path 0721-upload)
  # The bearer token travels to curl as a header on stdin, not in argv.
  resp=$(printf 'Authorization: Bearer %s\n' "$token" \
    | curl -sS -o "$body_file" -w '%{http_code}' \
      -X PUT "$BASE_URL/api/media/insert?name=$(printf %s "$name" | jq -sRr @uri)" \
      -H @- \
      -F "file=@${path}" \
      -m 120) || { rm -f "$body_file"; return 1; }
  http=$resp
  if [[ "$http" != 2?? ]]; then
    local errbody
    errbody=$(cat "$body_file")
    rm -f "$body_file"
    if [[ "$errbody" == *"already uploaded"* ]]; then
      echo "0721 dedup-hit: this exact content was uploaded before." >&2
      echo "   reuse the existing URL, or modify the file (re-encode with imagemagick: \`magick in.png -strip out.png\`) before retry." >&2
    else
      echo "upload HTTP $http: $errbody" >&2
    fi
    return 1
  fi
  # Response is either a raw key string or JSON {"key":"..."} — handle both.
  local body key
  body=$(cat "$body_file")
  rm -f "$body_file"
  if key=$(printf '%s' "$body" | jq -er .key 2>/dev/null); then
    :
  else
    key=$(printf '%s' "$body" | tr -d '[:space:]"')
  fi
  [[ -n "$key" ]] || { echo "no key in response: $body" >&2; return 1; }
  printf '%s' "$key"
}

PW=$(resolve_password)
TOKEN=""
if ! TOKEN=$(login "$PW"); then
  die "login failed"
fi

KEY=$(upload "$TOKEN" "$IMG_PATH") || die "upload failed"
URL="$BASE_URL/media/$KEY"

if [[ $MARKDOWN -eq 1 ]]; then
  printf '![](%s)\n' "$URL"
else
  printf '%s\n' "$URL"
fi
