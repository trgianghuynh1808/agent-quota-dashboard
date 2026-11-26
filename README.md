# agent-quota-dashboard

Unified multi-agent quota & telemetry dashboard for **Claude Code** and **OpenCode Go** (see `docs/SPEC.md`).

This repo currently implements **Phase 1 (backend & schema)**: Supabase schema, Vercel API routes for ingest/status, threshold-based auto-pause and Web Push notifications. The PWA dashboard (Phase 2) and the host hooks (Phase 3) are **not implemented yet**.

## Stack

- **Frontend scaffold:** Vite + React 19 + TypeScript + Tailwind CSS v4 + vite-plugin-pwa (placeholder page only; the dashboard arrives in Phase 2).
- **Backend:** Vercel Node API routes in `api/`.
- **Database:** Supabase Postgres + Realtime.
- **Notifications:** Web Push with VAPID keys (`web-push`).
- **Tests:** Vitest (Node environment) with an in-memory `FakeDb`; no Supabase project or network access required.

## Project structure

```text
api/
  ingest.ts            POST /api/ingest handler
  status.ts            GET /api/status handler
  control.ts           POST /api/control handler (toggle pause + thresholds)
  _lib/
    auth.ts            Bearer token check (timingSafeEqual)
    ingest.ts          processIngest: snapshot update + auto-pause logic
    push.ts            Web Push notifier (VAPID)
    supabase-db.ts     Db implementation using the service role key
    types.ts           shared types and the Db/notify interfaces
    validate.ts        manual payload validation
src/                   placeholder React app (Phase 1)
supabase/migrations/   SQL migrations (0001_init.sql = Phase 1 schema)
tests/                 Vitest specs and the in-memory FakeDb
docs/SPEC.md           product specification
scripts/               agent-room tooling (plan/handoff/verify)
```

## Environment variables

Copy `.env.example` to `.env` and fill in real values. All of these are **server-side only**; never commit real secrets. The service role key must never reach the browser.

| Variable | Purpose |
| --- | --- |
| `INGEST_API_KEY` | Bearer token required by `POST /api/ingest`, `GET /api/status` and `POST /api/control`. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key used by the API routes (bypasses RLS). |
| `VAPID_PUBLIC_KEY` | Web Push public key. |
| `VAPID_PRIVATE_KEY` | Web Push private key. |
| `VAPID_SUBJECT` | Push contact, e.g. `mailto:you@example.com`. |

Variables are read inside functions (`getEnv()`/factories), not at module import time, so tests can import the modules without env.

## Database

Apply the migration with the Supabase CLI:

```bash
supabase db push
```

Or paste `supabase/migrations/0001_init.sql` into the Supabase SQL editor.

It creates:

- `quota_snapshots` — current quota per provider (`claude_code`, `opencode_go`).
- `agent_telemetry_logs` — per-turn telemetry history, indexed by `created_at` and `(agent_id, created_at)`.
- `orchestrator_control` — single row (`id = 1`) holding `global_status`, `auto_pause_threshold` (default 90) and `downgrade_model_threshold` (default 80).
- `push_subscriptions` — Web Push subscriptions (extra table beyond the SPEC's three, needed for push).
- Function `increment_opencode_usage(delta, p_limit, p_reset_at)` for atomic token increments.

RLS is enabled on all four tables with **no policies**: only the service role (the API routes) can read or write them. `quota_snapshots`, `agent_telemetry_logs` and `orchestrator_control` are added to the `supabase_realtime` publication for Phase 2.

## API

All endpoints require `Authorization: Bearer <INGEST_API_KEY>`.

- Missing/invalid bearer → `401`
- Wrong HTTP method → `405`
- Invalid payload → `400 { "error": "..." }`

### `POST /api/ingest`

Common fields:

- `provider` — `claude_code` | `opencode_go` (required)
- `agent_id` — non-empty string (required)
- `task_name`, `model` — optional strings
- `input_tokens`, `output_tokens`, `cache_read_tokens` — non-negative integers, default `0`
- `reset_at` — optional ISO date string

`claude_code` additional fields:

- `window_5h_percent`, `window_7d_percent` — numbers `0..100` (required)

`opencode_go` additional fields:

- `delta_tokens` — non-negative integer (required)
- `cycle_token_limit` — positive integer (optional)

Successful response (`200`):

```json
{ "ok": true, "global_status": "running", "paused_now": false }
```

Behavior: inserts a telemetry log, then upserts (Claude, absolute values) or atomically increments (OpenCode) the snapshot. The usage percentage is `max(window_5h_percent, window_7d_percent)` for Claude and `cycle_tokens_used / cycle_token_limit * 100` for OpenCode (skipped when the limit is missing). When the control row is `running` and the percentage reaches `auto_pause_threshold`, the status flips to `paused`, one Web Push notification is sent (`title: "Quota auto-pause"`), and the response has `paused_now: true`. Notification failures are logged and never fail the ingest.

Claude Code example:

```bash
curl -X POST "$APP_URL/api/ingest" \
  -H "Authorization: Bearer $INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "claude_code",
    "agent_id": "session-abc",
    "task_name": "feature-x",
    "model": "claude-sonnet-4-6",
    "input_tokens": 1200,
    "output_tokens": 400,
    "cache_read_tokens": 800,
    "window_5h_percent": 42.5,
    "window_7d_percent": 61.0,
    "reset_at": "2026-11-26T03:00:00Z"
  }'
```

OpenCode Go example:

```bash
curl -X POST "$APP_URL/api/ingest" \
  -H "Authorization: Bearer $INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "opencode_go",
    "agent_id": "opencode-1",
    "delta_tokens": 3500,
    "cycle_token_limit": 500000
  }'
```

### `GET /api/status`

```bash
curl "$APP_URL/api/status" -H "Authorization: Bearer $INGEST_API_KEY"
```

Response (`200`):

```json
{
  "global_status": "running",
  "auto_pause_threshold": 90,
  "downgrade_model_threshold": 80,
  "snapshots": [
    {
      "provider": "claude_code",
      "window_5h_percent": 42.5,
      "window_7d_percent": 61,
      "cycle_tokens_used": 0,
      "cycle_token_limit": null,
      "reset_at": "2026-11-26T03:00:00Z",
      "updated_at": "2026-11-25T12:00:00Z"
    }
  ]
}
```

### `POST /api/control`

Partial update of the single `orchestrator_control` row. Send any subset of `global_status`, `auto_pause_threshold` and `downgrade_model_threshold`; omitted fields keep their current value. The two thresholds are integers `1`–`100`, and `downgrade_model_threshold` must be less than or equal to `auto_pause_threshold` after merging with the stored values.

```bash
curl -X POST "$APP_URL/api/control" \
  -H "Authorization: Bearer $INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "global_status": "paused", "auto_pause_threshold": 95 }'
```

Response (`200`):

```json
{
  "ok": true,
  "global_status": "paused",
  "auto_pause_threshold": 95,
  "downgrade_model_threshold": 80
}
```

Errors:

- `400` — invalid body (no valid field, `global_status` not `running`/`paused`, threshold out of `1`–`100`, or `downgrade_model_threshold > auto_pause_threshold`).
- `401` — missing or wrong bearer token.
- `405` — method other than `POST`.
- `500` — database failure.

## Commands

```bash
npm install           # install dependencies
npm run dev           # Vite dev server (placeholder page)
npm run build         # tsc -b && vite build
npm run typecheck     # tsc -b --noEmit (src + api + tests)
npm run test          # vitest run
npx vitest run tests/api.test.ts   # run only the API spec
```

## Not implemented yet

- **Phase 2 (PWA frontend):** dashboard UI, Supabase Realtime subscriptions, service worker push registration, and the subscription endpoint.
- **Phase 3 (host hooks):** Claude Code `Stop`/`Statusline` hook config, the OpenCode Go global plugin with one-time backfill, and the macOS setup guide.
