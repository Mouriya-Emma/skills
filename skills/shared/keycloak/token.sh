#!/usr/bin/env bash
# Source this file to get $KC_HOST and $KC_TOKEN for read-only inspection.
# Usage: source "${CLAUDE_SKILL_DIR}/token.sh"

KC_HOST="${KC_HOST:-https://keycloak.237575.xyz}"

if [ -z "${KC_ADMIN_USERNAME:-}" ] || [ -z "${KC_ADMIN_PASSWORD:-}" ]; then
  echo "ERROR: KC_ADMIN_USERNAME and KC_ADMIN_PASSWORD must be set in the environment" >&2
  return 1 2>/dev/null || exit 1
fi

# The password reaches curl only on stdin (`--data-urlencode password@-`);
# `printf` is a shell builtin, so the value never appears in any process argv
# (homelab-tf#641 decision §8, §12).
KC_TOKEN=$(printf %s "$KC_ADMIN_PASSWORD" | curl -fsS -X POST "$KC_HOST/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" \
  --data-urlencode "username=$KC_ADMIN_USERNAME" \
  --data-urlencode "password@-" \
  -d "grant_type=password" | jq -r '.access_token')

if [ -z "$KC_TOKEN" ] || [ "$KC_TOKEN" = "null" ]; then
  echo "ERROR: Failed to obtain Keycloak admin token" >&2
  return 1 2>/dev/null || exit 1
fi
