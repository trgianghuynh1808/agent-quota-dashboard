# agent-quota-dashboard

Unified multi-agent quota & telemetry dashboard for **Claude Code** and **OpenCode Go** (see `docs/SPEC.md`).

This repo currently implements **Phase 1 (backend & schema)**: Supabase schema, Vercel API routes for ingest/status/control/subscribe, threshold-based auto-pause and Web Push notifications, **Phase 3a**: a sample Claude Code hook that feeds `/api/ingest`, and **Phase 3b**: the OpenCode Go global plugin (`hooks/opencode/quota-sync.ts`) with a one-time usage backfill. **Phase 2** is partially built: the dashboard reads live quota, telemetry and control from Supabase (initial fetch + Realtime) when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set, and otherwise renders mock data (quota health cards, Burn Rate & Anomaly Monitor, Active Agents Feed); the PWA shell is configured (standalone manifest, dark theme color, service worker handling `push`/`notificationclick`, plus an iOS/Safari onboarding banner that asks for notification permission only once the app is installed and the user clicks "Bật thông báo"). Dashboard control writes (`POST /api/control`) and push subscription registration are still pending. This README ships a [macOS setup guide](#macos-setup-guide-phase-3d).

## Stack

- **Frontend:** Vite + React 19 + TypeScript + Tailwind CSS v4 + vite-plugin-pwa; the dashboard reads live data from Supabase (initial fetch + Realtime) when the client env vars are set, and falls back to mock data otherwise.
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
  subscribe.ts         POST /api/subscribe handler (store Web Push subscription)
  _lib/
    auth.ts            Bearer token check (timingSafeEqual)
    ingest.ts          processIngest: snapshot update + auto-pause logic
    push.ts            Web Push notifier (VAPID)
    supabase-db.ts     Db implementation using the service role key
    types.ts           shared types and the Db/notify interfaces
    validate.ts        manual payload validation
hooks/opencode/
  quota-sync.ts        OpenCode Go global plugin (message deltas + one-time backfill)
public/
  icon.svg             app icon (used as the PWA `any` + `maskable` icon)
  push-sw.js           service worker `push`/`notificationclick` handlers (imported into the generated sw.js)
src/
  App.tsx              bento grid: push onboarding banner, quota cards, burn rate monitor, circuit breaker controls, agents feed
  components/          PushOnboardingBanner, QuotaHealthCards, BurnRateMonitor, CircuitBreakerControls, ActiveAgentsFeed
  lib/                 pure helpers (quota, quota-cards, anomaly, burn-rate, circuit-breaker, push-onboarding), live-data (LiveSource + row mappers/reducers + startLive), supabase-source (Supabase LiveSource), control-api (ControlApi + mock/read-only)
  mock/                mockSnapshots, mockTurns (used when the Supabase client env is missing)
  hooks/               useNow (re-rendering clock), useLiveData (fetch + Realtime state, mock fallback)
hooks/claude-code/     Claude Code hook: quota-ingest.sh + settings.example.json
supabase/migrations/   SQL migrations (0001_init.sql = Phase 1 schema, 0002_realtime_read_policies.sql = Realtime read policies)
tests/                 Vitest specs and the in-memory FakeDb
docs/SPEC.md           product specification
scripts/               agent-room tooling (plan/handoff/verify)
```

## Dashboard (Phase 2, live or mock data)

`npm run dev` serves a Bento grid. With `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set it reads the real data: an initial fetch of `quota_snapshots`, the latest 200 `agent_telemetry_logs` and `orchestrator_control`, then a single Supabase Realtime `postgres_changes` channel that updates the cards, feed and control state (`lib/supabase-source.ts` + `hooks/useLiveData.ts`). Without the env vars it keeps using `src/mock/snapshots.ts` and `src/mock/turns.ts`; `<main data-testid="data-source" data-mode="live|mock">` shows which mode is active. There is no automatic fallback to mock when a live fetch fails — only a missing env switches to mock.

- **Quota card** (`components/QuotaHealthCards.tsx`) — one grouped card with a section per provider (Claude Code, then OpenCode Go); each section lists its window rows with usage percent, progress bar and reset countdown (`groupQuotaBars` in `lib/quota-cards.ts`).
- **Burn Rate & Anomaly Monitor** (`components/BurnRateMonitor.tsx`) — TPM, time-to-limit for the OpenCode Go cycle (Claude shows `--`), and a red loop badge per agent detected by `detectLoops`.
- **Circuit Breaker Controls** (`components/CircuitBreakerControls.tsx`) — RUNNING/PAUSED display plus warning and auto-pause thresholds (defaults 80 and 90). Thresholds are validated client-side with the same rule as `/api/control` (integers `1`–`100`, warning ≤ auto-pause). It talks to a `ControlApi`; in live mode `App.tsx` uses `createReadOnlyControlApi` so the control row comes from Supabase (and Realtime updates re-key the panel), and the "Lưu" button rejects with "Chưa nối /api/control". With mock data it uses `createMockControlApi()`.
- **Active Agents Feed** (`components/ActiveAgentsFeed.tsx`) — the most recent turns (agent, model, task, tokens, cache ratio, age).
- **Push onboarding banner** (`components/PushOnboardingBanner.tsx`) — on iOS Safari without the standalone display mode it shows the "Share → Add to Home Screen → open from Home Screen" steps instead of asking for notifications; otherwise, when permission is `default`, it shows a "Bật thông báo" button that calls `Notification.requestPermission()` only on click. Dismissing stores `localStorage['push-onboarding-dismissed']`, and the state rules live in `lib/push-onboarding.ts`.

The pure logic lives in `src/lib/` (`quota.ts`, `quota-cards.ts`, `anomaly.ts`, `burn-rate.ts`, `circuit-breaker.ts`, `push-onboarding.ts`, `control-api.ts`, `live-data.ts`); the quota/burn-rate helpers take `now` as a parameter, `live-data.ts` holds the row mappers/reducers and `startLive` (no env access), and the modules are covered by Vitest. `supabase-source.ts` is the only dashboard module that imports `@supabase/supabase-js`.

## PWA

`vite.config.ts` configures `vite-plugin-pwa` (generateSW, `registerType: 'autoUpdate'`):

- **Manifest** — `id`/`scope`/`start_url` `/`, `display: 'standalone'`, `theme_color` and `background_color` `#0f172a` (matches the dark dashboard), and the same `public/icon.svg` declared once as `purpose: 'any'` and once as `purpose: 'maskable'`. `index.html` also has `<meta name="theme-color" content="#0f172a">`.
- **Service worker** — the generated `sw.js` imports `public/push-sw.js` via `workbox.importScripts`. That script listens for `push` (shows a notification from the server payload `{ title, body }`, falling back to `Agent Quota Dashboard` / empty body when the payload is missing or invalid) and `notificationclick` (closes the notification, focuses an open window or opens `/`).
- **Registration** — `src/main.tsx` calls `registerSW({ immediate: true })` from `virtual:pwa-register` in production builds only.
- **Onboarding** — `components/PushOnboardingBanner.tsx` decides between `install` (iOS Safari, not standalone), `enable` (permission `default` and allowed to ask) and `hidden` (dismissed, already granted/denied, unsupported, or already installed on desktop via `lib/push-onboarding.ts`). It never calls `Notification.requestPermission()` on page load, only when the user clicks "Bật thông báo".

Push **subscription** registration (calling `POST /api/subscribe`) is still pending; the banner only requests notification permission.

## Environment variables

Copy `.env.example` to `.env` and fill in real values. The server-side secrets are read only by the API routes; never commit real secrets, and the service role key must never reach the browser.

| Variable | Purpose |
| --- | --- |
| `INGEST_API_KEY` | Bearer token required by `POST /api/ingest`, `GET /api/status`, `POST /api/control` and `POST /api/subscribe`. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key used by the API routes (bypasses RLS). |
| `VAPID_PUBLIC_KEY` | Web Push public key. |
| `VAPID_PRIVATE_KEY` | Web Push private key. |
| `VAPID_SUBJECT` | Push contact, e.g. `mailto:you@example.com`. |

Client-side (baked into the Vite bundle, safe to expose because RLS + the `0002` select policies limit reads to the three dashboard tables):

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL used by the dashboard for initial fetch + Realtime. |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key used by the dashboard (read-only; the service role key is never bundled). |

Set both `VITE_*` variables to read live data; if either is missing the dashboard falls back to mock data. Server variables are read inside functions (`getEnv()`/factories), not at module import time, so tests can import the modules without env.

## Database

Apply the migrations with the Supabase CLI:

```bash
supabase db push
```

Or paste `supabase/migrations/0001_init.sql` followed by `supabase/migrations/0002_realtime_read_policies.sql` into the Supabase SQL editor.

It creates:

- `quota_snapshots` — current quota per provider (`claude_code`, `opencode_go`).
- `agent_telemetry_logs` — per-turn telemetry history, indexed by `created_at` and `(agent_id, created_at)`.
- `orchestrator_control` — single row (`id = 1`) holding `global_status`, `auto_pause_threshold` (default 90) and `downgrade_model_threshold` (default 80).
- `push_subscriptions` — Web Push subscriptions (extra table beyond the SPEC's three, needed for push).
- Function `increment_opencode_usage(delta, p_limit, p_reset_at)` for atomic token increments.

RLS is enabled on all four tables. `0001` creates no policies, so only the service role (the API routes) can read or write them; `0002` adds `select` policies for `anon` and `authenticated` on `quota_snapshots`, `agent_telemetry_logs` and `orchestrator_control` so the PWA can read them over Realtime, while `push_subscriptions` stays locked to the service role. All three of those data tables are added to the `supabase_realtime` publication for Phase 2.

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

### `POST /api/subscribe`

Stores a Web Push subscription for Phase 2, upserting on `endpoint` (re-registering the same endpoint overwrites it, no duplicate rows). The body must be:

- `endpoint` — an `https://` URL (required)
- `keys.p256dh` — non-empty string (required)
- `keys.auth` — non-empty string (required)

```bash
curl -X POST "$APP_URL/api/subscribe" \
  -H "Authorization: Bearer $INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "endpoint": "https://push.example/abc",
    "keys": { "p256dh": "...", "auth": "..." }
  }'
```

Response (`200`):

```json
{ "ok": true }
```

Errors:

- `400` — invalid body (missing `endpoint`/`keys`, `endpoint` not `https://`, or empty `p256dh`/`auth`).
- `401` — missing or wrong bearer token.
- `405` — method other than `POST`.
- `500` — database failure.

## Claude Code hook (Phase 3a)

`hooks/claude-code/quota-ingest.sh` reads the Claude Code statusline JSON on stdin, builds a `claude_code` ingest payload and POSTs it to `/api/ingest` fire-and-forget (in the background, `--max-time 5`). It never blocks or breaks Claude Code: missing `APP_URL`/`INGEST_API_KEY`, missing `jq`/`curl`, bad JSON or missing quota fields all exit `0` silently.

Install:

```bash
# 1. Copy the hook script next to your Claude Code settings
mkdir -p ~/.claude/hooks
cp hooks/claude-code/quota-ingest.sh ~/.claude/hooks/quota-ingest.sh
chmod +x ~/.claude/hooks/quota-ingest.sh

# 2. Merge hooks/claude-code/settings.example.json into ~/.claude/settings.json
#    (adds a statusLine command and a Stop hook, both pointing at the script)

# 3. Export the env vars in the shell that launches Claude Code
export APP_URL="https://your-dashboard.example.com"
export INGEST_API_KEY="your-ingest-key"
# optional: export AGENT_ID="claude-code-mybox"  (default: claude-code-$(hostname -s))
```

Requirements: `bash`, `jq` and `curl` on `PATH`. The script reads secrets only from the environment, never from a file.

Send an initial snapshot once (for example after installing), passing the current 5-hour and 7-day usage percentages (`0..100`):

```bash
~/.claude/hooks/quota-ingest.sh --once 12.5 40
```

The payload maps `rate_limits.five_hour.used_percentage` → `window_5h_percent`, `rate_limits.seven_day.used_percentage` → `window_7d_percent`, `model.id` → `model`, `session_id` → `task_name`, and `rate_limits.five_hour.resets_at` (epoch seconds) → `reset_at` (ISO). The statusline JSON shape (`rate_limits.*`) is the currently known format; adjust the `jq` filter in the script if your Claude Code version differs.

## OpenCode Go plugin

`hooks/opencode/quota-sync.ts` is a global OpenCode plugin that reports OpenCode Go token usage to `POST /api/ingest` (`provider: "opencode_go"`). It is dependency-free and never blocks or breaks OpenCode: every network/DB/config error is swallowed, sends are fire-and-forget with a 5s timeout, and a missing `APP_URL`/`INGEST_API_KEY` turns it into a no-op.

Install it on the host that runs OpenCode:

1. `mkdir -p ~/.config/opencode/plugin`
2. Copy `hooks/opencode/quota-sync.ts` into `~/.config/opencode/plugin/`.
3. Export the env vars below in the shell that launches OpenCode (e.g. in your shell profile).
4. Restart OpenCode.

Behavior:

- On each completed assistant message from `providerID: "opencode-go"` (`message.updated` with `time.completed`), it sends `delta_tokens = tokens.total` (plus `input_tokens`/`output_tokens`/`cache_read_tokens` for logging). Messages are deduped by message id, so a message is counted once.
- On first run it calls `backfillInitialUsage()` once: sums `tokens.total` of assistant `opencode-go` messages from the last `OPENCODE_CYCLE_DAYS` days (default 30) in `~/.local/share/opencode/opencode.db` and sends that total as one delta. A state file `~/.config/opencode/quota-sync.state.json` records `{"backfilled":true}` so it never backfills again.

Plugin environment variables (read from `process.env`, separate from the server-side table above):

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Base URL of the deployment, e.g. `https://your-app.vercel.app`. Required for the plugin to send anything. |
| `INGEST_API_KEY` | Bearer token for `POST /api/ingest`. Required for the plugin to send anything. |
| `AGENT_ID` | `agent_id` sent with every payload (default `opencode-go`). Optional. |
| `OPENCODE_CYCLE_TOKEN_LIMIT` | If set, sent as `cycle_token_limit` so the API can compute the usage percentage. Optional. |
| `OPENCODE_CYCLE_DAYS` | Backfill window in days (default `30`). Optional. |

## macOS setup guide (Phase 3d)

End-to-end install on a Mac: deploy the backend, wire the Claude Code hook and the OpenCode Go plugin, then verify. Run every command from the repo root unless noted.

### 1. Requirements

```bash
# Homebrew (https://brew.sh), then the CLI tools
brew install node jq
brew install supabase/tap/supabase   # Supabase CLI
brew install vercel-cli              # Vercel CLI (or: npm install -g vercel)
```

`bash` and `curl` ship with macOS. `node`/`npm` are needed to deploy and to run the repo scripts.

### 2. Create the Supabase database

Create a project in the Supabase dashboard, then link and push the migrations:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

This applies `supabase/migrations/0001_init.sql` and `0002_realtime_read_policies.sql` (see [Database](#database)). Copy the project URL and the **service role** key from Project Settings → API; they become `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

### 3. Deploy to Vercel and set environment variables

```bash
vercel            # first deploy / link the project
vercel --prod     # production deploy
```

Importing the GitHub repo in the Vercel dashboard works the same way. In **Project → Settings → Environment Variables**, add every server-side variable from [Environment variables](#environment-variables) (`INGEST_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`), then redeploy so the functions pick them up.

Generate the VAPID key pair used for auto-pause Web Push and paste the output into the two `VAPID_*` variables:

```bash
npx web-push generate-vapid-keys
```

Pick a long random `INGEST_API_KEY` (e.g. `openssl rand -hex 32`); it is the bearer token every client and the dashboard API use.

### 4. Export the client env vars

The hook and the plugin read `APP_URL` / `INGEST_API_KEY` (and optional `AGENT_ID`) from the environment, not from a file. Add them to `~/.zshrc` so every new terminal has them:

```bash
cat >> ~/.zshrc <<'EOF'
export APP_URL="https://your-app.vercel.app"
export INGEST_API_KEY="your-ingest-key"
# optional overrides
# export AGENT_ID="claude-code-mybox"          # Claude Code hook default: claude-code-$(hostname -s)
# export OPENCODE_CYCLE_TOKEN_LIMIT="500000"   # enables the Go usage percentage
# export OPENCODE_CYCLE_DAYS="30"              # backfill window
EOF
source ~/.zshrc
```

Use the `vercel --prod` URL from step 3 as `APP_URL` (no trailing slash).

### 5. Install the Claude Code hook

Follow [Claude Code hook (Phase 3a)](#claude-code-hook-phase-3a):

```bash
mkdir -p ~/.claude/hooks
cp hooks/claude-code/quota-ingest.sh ~/.claude/hooks/quota-ingest.sh
chmod +x ~/.claude/hooks/quota-ingest.sh
```

Merge `hooks/claude-code/settings.example.json` into `~/.claude/settings.json`; it adds the `statusLine` command and a `Stop` hook pointing at the script. Keep your existing settings and only add the `statusLine` and `hooks.Stop` entries.

### 6. Install the OpenCode Go plugin

Follow [OpenCode Go plugin](#opencode-go-plugin):

```bash
mkdir -p ~/.config/opencode/plugin
cp hooks/opencode/quota-sync.ts ~/.config/opencode/plugin/
```

Restart OpenCode from a terminal that has the step 4 env vars exported. On first run the plugin backfills the last `OPENCODE_CYCLE_DAYS` days from `~/.local/share/opencode/opencode.db` once, recording it in `~/.config/opencode/quota-sync.state.json`.

### 7. Verify the install

Send one Claude Code snapshot (5-hour and 7-day usage percentages) and read the current status back:

```bash
~/.claude/hooks/quota-ingest.sh --once 12.5 40
curl "$APP_URL/api/status" -H "Authorization: Bearer $INGEST_API_KEY"
```

`/api/status` should show a `claude_code` snapshot with `window_5h_percent: 12.5` and `window_7d_percent: 40`. A `401` means `INGEST_API_KEY` differs between the client shell and Vercel; an empty `snapshots` array usually means `APP_URL`/`INGEST_API_KEY` were not exported in the shell that ran the hook.

### 8. Troubleshooting

- **Nothing arrives** — `quota-ingest.sh` and the plugin exit `0` silently when `APP_URL` or `INGEST_API_KEY` is missing, or when `jq`/`curl` is not on `PATH`. Check with `echo "$APP_URL"; command -v jq curl`.
- **Works in the terminal but not in a GUI app** — apps launched from Finder/Dock do not read `~/.zshrc`, so they have no `APP_URL`/`INGEST_API_KEY`. Start `claude`/`opencode` from a terminal that exported the variables.
- **Claude Code sends nothing after a statusline update** — the script expects the `rate_limits.*` JSON shape; if your Claude Code version differs, adjust the `jq` filter in `quota-ingest.sh`.
- **`supabase db push` fails** — confirm `supabase link --project-ref ...` succeeded and the CLI is logged in (`supabase projects list`).

## Commands

```bash
npm install           # install dependencies
npm run dev           # Vite dev server (live data when VITE_SUPABASE_* is set, otherwise mock)
npm run build         # tsc -b && vite build
npm run typecheck     # tsc -b --noEmit (src + api + tests)
npm run test          # vitest run
npx vitest run tests/api.test.ts   # run only the API spec
```

## Not implemented yet

- **Phase 2 (PWA frontend):** the dashboard reads live quota/telemetry/control from Supabase (initial fetch + Realtime) when `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set, otherwise it renders mock data. Still pending: dashboard control writes (`POST /api/control` — the Circuit Breaker panel is read-only in live mode and its "Lưu" button errors) and push subscription registration (`POST /api/subscribe`). The service worker already handles incoming `push`/`notificationclick`, the manifest is configured, and the onboarding banner covers install/permission UX (it does not subscribe).
- **Phase 3 (host hooks):** the Claude Code hook (`hooks/claude-code/`) and the OpenCode Go plugin (`hooks/opencode/`) are implemented; install steps are in [macOS setup guide](#macos-setup-guide-phase-3d).
- **Phase 3c:** circuit breaker / follow-up work on top of the host hooks.
