#!/usr/bin/env bash
# OpenCode Go quota helper: record a real quota window (typed from the console)
# into Supabase through /api/ingest.
#
# Usage:
#   hooks/opencode/set-quota.sh <5h|7d|30d> <percent> <reset_iso>
#
# Example:
#   hooks/opencode/set-quota.sh 7d 58 2026-12-01T00:00:00Z
#
# Env:
#   APP_URL          dashboard base URL, e.g. https://aqd.example.com (required)
#   INGEST_API_KEY   bearer token for /api/ingest (required)
#   AGENT_ID         override agent id (default: opencode-console)
#
# Sends the window synchronously so the user sees ok/error. Bad arguments print
# usage and exit 2; missing env, jq or curl warn on stderr and exit 0.

set -uo pipefail

usage() {
  echo "usage: $0 <5h|7d|30d> <percent 0..100> <reset_iso>" >&2
}

if [ "$#" -ne 3 ]; then
  usage
  exit 2
fi

window_id="$1"
percent="$2"
reset_at="$3"

case "$window_id" in
  5h | 7d | 30d) ;;
  *)
    usage
    exit 2
    ;;
esac

if ! awk -v p="$percent" 'BEGIN { exit (p ~ /^[0-9]+(\.[0-9]+)?$/ && p + 0 >= 0 && p + 0 <= 100) ? 0 : 1 }'; then
  usage
  exit 2
fi

[ -n "$reset_at" ] || {
  usage
  exit 2
}

app_url="${APP_URL:-}"
api_key="${INGEST_API_KEY:-}"
agent_id="${AGENT_ID:-opencode-console}"

[ -n "$app_url" ] || {
  echo "set-quota: APP_URL is not set" >&2
  exit 0
}
[ -n "$api_key" ] || {
  echo "set-quota: INGEST_API_KEY is not set" >&2
  exit 0
}
command -v jq >/dev/null 2>&1 || {
  echo "set-quota: jq is not installed" >&2
  exit 0
}
command -v curl >/dev/null 2>&1 || {
  echo "set-quota: curl is not installed" >&2
  exit 0
}

payload=$(jq -nc \
  --arg aid "$agent_id" \
  --arg wid "$window_id" \
  --argjson pct "$percent" \
  --arg reset "$reset_at" \
  '{provider: "opencode_go", agent_id: $aid, window_id: $wid, window_percent: $pct, reset_at: $reset}') || {
  echo "set-quota: failed to build payload" >&2
  exit 0
}

body_file=$(mktemp) || {
  echo "set-quota: failed to create temp file" >&2
  exit 0
}

http_code=$(curl -sS --max-time 5 -o "$body_file" -w '%{http_code}' -X POST "$app_url/api/ingest" \
  -H "Authorization: Bearer $api_key" \
  -H "Content-Type: application/json" \
  -d "$payload" </dev/null) || {
  rm -f "$body_file"
  echo "set-quota: request failed" >&2
  exit 1
}

if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
  echo "ok: $window_id ${percent}% (reset $reset_at)"
  rm -f "$body_file"
  exit 0
fi

echo "set-quota: server returned HTTP $http_code" >&2
cat "$body_file" >&2
rm -f "$body_file"
exit 1
