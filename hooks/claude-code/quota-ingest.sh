#!/usr/bin/env bash
# Claude Code statusline/Stop hook: read statusline JSON on stdin, build a
# claude_code ingest payload and POST it fire-and-forget to /api/ingest.
#
# Usage:
#   hooks/claude-code/quota-ingest.sh                     # statusline JSON on stdin
#   hooks/claude-code/quota-ingest.sh --once <5h%> <7d%>  # one-off manual snapshot
#
# Env:
#   APP_URL          dashboard base URL, e.g. https://aqd.example.com (required)
#   INGEST_API_KEY   bearer token for /api/ingest (required)
#   AGENT_ID         override agent id (default: claude-code-$(hostname -s))
#
# Fire-and-forget: missing env, jq, curl or quota data exits 0 silently, so this
# hook can never break Claude Code.

set -uo pipefail

app_url="${APP_URL:-}"
api_key="${INGEST_API_KEY:-}"
agent_id="${AGENT_ID:-claude-code-$(hostname -s)}"

[ -n "$app_url" ] || exit 0
[ -n "$api_key" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

post_payload() {
  # $1: JSON payload string
  curl -sS --max-time 5 -X POST "$app_url/api/ingest" \
    -H "Authorization: Bearer $api_key" \
    -H "Content-Type: application/json" \
    -d "$1" </dev/null >/dev/null 2>&1 &
}

if [ "${1:-}" = "--once" ]; then
  p5="${2:-}"
  p7="${3:-}"
  [ -n "$p5" ] || exit 0
  [ -n "$p7" ] || exit 0
  payload=$(jq -nc \
    --arg aid "$agent_id" \
    --argjson p5 "$p5" \
    --argjson p7 "$p7" '
    select($p5 >= 0 and $p5 <= 100 and $p7 >= 0 and $p7 <= 100)
    | {provider: "claude_code", agent_id: $aid, window_5h_percent: $p5, window_7d_percent: $p7}
  ' 2>/dev/null) || exit 0
  [ -n "$payload" ] || exit 0
  post_payload "$payload"
  exit 0
fi

input=$(cat 2>/dev/null) || exit 0
[ -n "$input" ] || exit 0

payload=$(jq -nc \
  --arg aid "$agent_id" \
  --argjson s "$input" '
  def pct($v): $v != null and $v >= 0 and $v <= 100;
  select(pct($s.rate_limits.five_hour.used_percentage) and pct($s.rate_limits.seven_day.used_percentage))
  | {
      provider: "claude_code",
      agent_id: $aid,
      window_5h_percent: $s.rate_limits.five_hour.used_percentage,
      window_7d_percent: $s.rate_limits.seven_day.used_percentage
    }
  | if ($s.model.id // "") != "" then . + {model: $s.model.id} else . end
  | if ($s.session_id // "") != "" then . + {task_name: $s.session_id} else . end
  | if ($s.rate_limits.five_hour.resets_at | type) == "number"
    then . + {reset_at: ($s.rate_limits.five_hour.resets_at | todate)}
    else . end
  | if ($s.rate_limits.seven_day.resets_at | type) == "number"
    then . + {reset_7d_at: ($s.rate_limits.seven_day.resets_at | todate)}
    else . end
' 2>/dev/null) || exit 0
[ -n "$payload" ] || exit 0

post_payload "$payload"
exit 0
