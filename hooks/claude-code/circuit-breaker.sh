#!/usr/bin/env bash
# Claude Code circuit breaker: query the dashboard for the global status and
# block the agent (exit 2) when the dashboard has paused all agents.
#
# Usage:
#   hooks/claude-code/circuit-breaker.sh   # wire as a UserPromptSubmit/PreToolUse hook
#
# Env:
#   APP_URL          dashboard base URL, e.g. https://aqd.example.com (required)
#   INGEST_API_KEY   bearer token for /api/status (required)
#
# Fail-open: missing env, jq, curl, network errors, HTTP errors or bad JSON all
# exit 0 so this hook can never break Claude Code. Only a confirmed `paused`
# status exits 2 with the reason on stderr.

set -uo pipefail

app_url="${APP_URL:-}"
api_key="${INGEST_API_KEY:-}"

[ -n "$app_url" ] || exit 0
[ -n "$api_key" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

body=$(curl -sS --max-time 3 -H "Authorization: Bearer $api_key" \
  "$app_url/api/status" </dev/null 2>/dev/null) || exit 0

status=$(printf '%s' "$body" | jq -r '.global_status // empty' 2>/dev/null) || exit 0

if [ "$status" = "paused" ]; then
  echo "Circuit breaker: agents are PAUSED from the dashboard. Stop and wait until resumed." >&2
  exit 2
fi

exit 0
