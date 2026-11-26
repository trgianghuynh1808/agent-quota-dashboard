# agent-quota-dashboard

Unified multi-agent quota & telemetry dashboard for **Claude Code** and **OpenCode Go** (see `docs/SPEC.md`).

This repo currently implements **Phase 1 (backend & schema)**: Supabase schema plus Vercel API routes for ingest/status/control, **Phase 3a**: a sample Claude Code hook that feeds `/api/ingest` and a circuit-breaker pre-check, and **Phase 3b**: the OpenCode Go global plugin (`hooks/opencode/quota-sync.ts`) that reports a token delta per completed assistant message. **Phase 2** is partially built: the dashboard reads live quota, telemetry and control from Supabase (initial fetch + Realtime) when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set, and otherwise renders mock data (quota health cards, Burn Rate & Anomaly Monitor, Active Agents Feed, Circuit Breaker panel). The PWA shell is configured (standalone manifest, dark theme color, service worker registration). There are no quota thresholds: ingest never auto-pauses and sends no notifications; pausing is manual through `POST /api/control` (the dashboard panel is still read-only in live mode). This README ships a [macOS setup guide](#macos-setup-guide-phase-3d).

## Stack

- **Frontend:** Vite + React 19 + TypeScript + Tailwind CSS v4 + vite-plugin-pwa; the dashboard reads live data from Supabase (initial fetch + Realtime) when the client env vars are set, and falls back to mock data otherwise.
- **Backend:** Vercel Node API routes in `api/`.
- **Database:** Supabase Postgres + Realtime.
- **Tests:** Vitest (Node environment) with an in-memory `FakeDb`; no Supabase project or network access required.

## Project structure

```text
api/
  ingest.ts            POST /api/ingest handler
  status.ts            GET /api/status handler
  control.ts           POST /api/control handler (manual pause/resume)
  _lib/
    auth.ts            Bearer token check (timingSafeEqual)
    ingest.ts          processIngest: snapshot/log/window update, returns global_status
    supabase-db.ts     Db implementation using the service role key
    types.ts           shared types and the Db interface
    validate.ts        manual payload validation
hooks/opencode/
  quota-sync.ts        OpenCode Go global plugin (per-message token deltas)
  set-quota.sh         manual helper: record a real 5h/7d/30d window read from the console
public/
  icon.svg             app icon (used as the PWA `any` + `maskable` icon)
src/
  App.tsx              bento grid: quota cards, burn rate monitor, circuit breaker controls, agents feed
  components/          QuotaHealthCards, BurnRateMonitor, CircuitBreakerControls, ActiveAgentsFeed
  lib/                 pure helpers (quota, quota-cards, anomaly, burn-rate), live-data (LiveSource + row mappers/reducers + startLive), supabase-source (Supabase LiveSource), control-api (ControlApi + mock/read-only)
  mock/                mockSnapshots, mockTurns (used when the Supabase client env is missing)
  hooks/               useNow (re-rendering clock), useLiveData (fetch + Realtime state, mock fallback)
hooks/claude-code/     Claude Code hooks: quota-ingest.sh, circuit-breaker.sh + settings.example.json
supabase/migrations/   SQL migrations (0001_init.sql = Phase 1 schema, 0002_realtime_read_policies.sql = Realtime read policies, 0003_claude_reset_7d.sql = Claude 7d reset column, 0004_opencode_windows.sql = OpenCode Go 5h/7d/30d windows)
tests/                 Vitest specs and the in-memory FakeDb
docs/SPEC.md           product specification
scripts/               agent-room tooling (plan/handoff/verify)
```

## Dashboard (Phase 2, live or mock data)

`npm run dev` serves a Bento grid. With `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set it reads the real data: an initial fetch of `quota_snapshots`, the latest 200 `agent_telemetry_logs` and `orchestrator_control`, then a single Supabase Realtime `postgres_changes` channel that updates the cards, feed and control state (`lib/supabase-source.ts` + `hooks/useLiveData.ts`). Without the env vars it keeps using `src/mock/snapshots.ts` and `src/mock/turns.ts`; `<main data-testid="data-source" data-mode="live|mock">` shows which mode is active. There is no automatic fallback to mock when a live fetch fails — only a missing env switches to mock.

- **Quota card** (`components/QuotaHealthCards.tsx`) — one grouped card with a section per provider (Claude Code, then OpenCode Go); each section lists its window rows with usage percent, progress bar and reset countdown (`groupQuotaBars` in `lib/quota-cards.ts`). OpenCode Go always shows three rows — 5h, 7d and 30d — read from `quota_snapshots.opencode_windows` (written by `hooks/opencode/set-quota.sh`); a window that has not been entered yet shows `--` for both the percent and the reset countdown. There is no estimated "cycle" row anymore.
- **Burn Rate & Anomaly Monitor** (`components/BurnRateMonitor.tsx`) — TPM and a red loop badge per agent detected by `detectLoops`. There is no estimated time-to-limit because the only source for it was the OpenCode cycle token limit, which is no longer used.
- **Circuit Breaker Controls** (`components/CircuitBreakerControls.tsx`) — a RUNNING/PAUSED `role="switch"` toggle and an inline error line. It talks to a `ControlApi`; in live mode `App.tsx` uses `createReadOnlyControlApi` so the control row comes from Supabase (and Realtime updates re-key the panel), and toggling rejects with "Chưa nối /api/control". With mock data it uses `createMockControlApi()`. There are no threshold inputs.
- **Active Agents Feed** (`components/ActiveAgentsFeed.tsx`) — the most recent turns (agent, model, task, tokens, cache ratio, age).

The pure logic lives in `src/lib/` (`quota.ts`, `quota-cards.ts`, `anomaly.ts`, `burn-rate.ts`, `control-api.ts`, `live-data.ts`); the quota/burn-rate helpers take `now` as a parameter, `live-data.ts` holds the row mappers/reducers and `startLive` (no env access), and the modules are covered by Vitest. `supabase-source.ts` is the only dashboard module that imports `@supabase/supabase-js`.

## PWA

`vite.config.ts` configures `vite-plugin-pwa` (generateSW, `registerType: 'autoUpdate'`):

- **Manifest** — `id`/`scope`/`start_url` `/`, `display: 'standalone'`, `theme_color` and `background_color` `#0f172a` (matches the dark dashboard), and the same `public/icon.svg` declared once as `purpose: 'any'` and once as `purpose: 'maskable'`. `index.html` also has `<meta name="theme-color" content="#0f172a">`.
- **Service worker** — workbox generates `sw.js` (precache + auto-update); there is no push handling.
- **Registration** — `src/main.tsx` calls `registerSW({ immediate: true })` from `virtual:pwa-register` in production builds only.

Web Push (subscriptions, `push-sw.js`, the VAPID notifier and the onboarding/permission banner) was removed together with the threshold mechanism; there is no `POST /api/subscribe` anymore.

## Environment variables

Copy `.env.example` to `.env` and fill in real values. The server-side secrets are read only by the API routes; never commit real secrets, and the service role key must never reach the browser.

| Variable | Purpose |
| --- | --- |
| `INGEST_API_KEY` | Bearer token required by `POST /api/ingest`, `GET /api/status` and `POST /api/control`. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key used by the API routes (bypasses RLS). |

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

Or paste `supabase/migrations/0001_init.sql`, `0002_realtime_read_policies.sql`, `0003_claude_reset_7d.sql` and `0004_opencode_windows.sql` into the Supabase SQL editor.

It creates:

- `quota_snapshots` — current quota per provider (`claude_code`, `opencode_go`). `reset_at` is the 5h window reset (also used by OpenCode Go); `reset_7d_at` (added by `0003`) is the Claude 7d window reset; `opencode_windows` (added by `0004`) is a jsonb array of the real OpenCode Go windows `[{ id: "5h"|"7d"|"30d", percent, reset_at }]` typed from the console via `hooks/opencode/set-quota.sh`.
- `agent_telemetry_logs` — per-turn telemetry history, indexed by `created_at` and `(agent_id, created_at)`.
- `orchestrator_control` — single row (`id = 1`) holding `global_status`. The `auto_pause_threshold` (default 90) and `downgrade_model_threshold` (default 80) columns still exist from `0001` but are no longer read or written by the code.
- `push_subscriptions` — legacy table from Phase 1 that is no longer used (there is no Web Push).
- Function `increment_opencode_usage(delta, p_limit, p_reset_at)` for atomic token increments; the code passes `p_limit: null`, so `cycle_token_limit` is never set anymore (the column remains).

RLS is enabled on all four tables. `0001` creates no policies, so only the service role (the API routes) can read or write them; `0002` adds `select` policies for `anon` and `authenticated` on `quota_snapshots`, `agent_telemetry_logs` and `orchestrator_control` so the PWA can read them over Realtime, while the unused `push_subscriptions` table stays locked to the service role. All three dashboard tables are added to the `supabase_realtime` publication for Phase 2.

Legacy columns are intentionally left in place (there is no cleanup migration): `quota_snapshots.cycle_tokens_used`/`cycle_token_limit` stay in the type and are still mapped by `rowToSnapshot`, but the dashboard no longer uses them; `orchestrator_control.auto_pause_threshold`/`downgrade_model_threshold` and the whole `push_subscriptions` table are dead.

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
- `reset_7d_at` — optional ISO date string for the 7d window reset (`reset_at` stays the 5h reset)

`opencode_go` additional fields:

- `delta_tokens` — non-negative integer (required for a token delta; not needed when `window_id` is set)
- `window_id` — `5h` | `7d` | `30d` (optional). Records a real quota window read from the OpenCode Go console instead of adding tokens.
- `window_percent` — number `0..100` (required when `window_id` is set)
- `reset_at` — ISO date string, required when `window_id` is set; it is the reset of that specific window

Successful response (`200`):

```json
{ "ok": true, "global_status": "running" }
```

Behavior: for a normal payload it inserts a telemetry log, then upserts (Claude, absolute values) or atomically increments (OpenCode) the snapshot, and returns the current `global_status` from `orchestrator_control`. When an `opencode_go` payload carries `window_id`, it instead updates `quota_snapshots.opencode_windows` (upsert of that window by `id`, other windows and token fields untouched) and does **not** insert a log or touch the token counters. Ingest never changes the control row, never compares a quota percentage against a threshold and never sends a notification; pausing is manual via `POST /api/control`. A `cycle_token_limit` field sent by an old client is ignored.

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
    "reset_at": "2026-11-26T03:00:00Z",
    "reset_7d_at": "2026-11-29T03:00:00Z"
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
    "delta_tokens": 3500
  }'
```

OpenCode Go window example (no token delta, no telemetry log):

```bash
curl -X POST "$APP_URL/api/ingest" \
  -H "Authorization: Bearer $INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "opencode_go",
    "agent_id": "opencode-console",
    "window_id": "7d",
    "window_percent": 58,
    "reset_at": "2026-12-01T00:00:00Z"
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
  "snapshots": [
    {
      "provider": "claude_code",
      "window_5h_percent": 42.5,
      "window_7d_percent": 61,
      "cycle_tokens_used": 0,
      "cycle_token_limit": null,
      "reset_at": "2026-11-26T03:00:00Z",
      "reset_7d_at": "2026-11-29T03:00:00Z",
      "updated_at": "2026-11-25T12:00:00Z"
    },
    {
      "provider": "opencode_go",
      "window_5h_percent": null,
      "window_7d_percent": null,
      "cycle_tokens_used": 53200,
      "cycle_token_limit": null,
      "reset_at": null,
      "reset_7d_at": null,
      "opencode_windows": [
        { "id": "5h", "percent": 35, "reset_at": "2026-11-26T03:00:00Z" },
        { "id": "7d", "percent": 58, "reset_at": "2026-12-01T00:00:00Z" },
        { "id": "30d", "percent": 41, "reset_at": "2026-12-25T00:00:00Z" }
      ],
      "updated_at": "2026-11-25T12:00:00Z"
    }
  ]
}
```

### `POST /api/control`

Update the single `orchestrator_control` row. The only accepted field is `global_status` (`running` | `paused`); it is required. This is the manual pause/resume switch that `hooks/claude-code/circuit-breaker.sh` enforces on the host (the hook itself only reads `GET /api/status`).

```bash
curl -X POST "$APP_URL/api/control" \
  -H "Authorization: Bearer $INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "global_status": "paused" }'
```

Response (`200`):

```json
{
  "ok": true,
  "global_status": "paused"
}
```

Errors:

- `400` — invalid body (missing `global_status`, or not `running`/`paused`).
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
cp hooks/claude-code/circuit-breaker.sh ~/.claude/hooks/circuit-breaker.sh
chmod +x ~/.claude/hooks/quota-ingest.sh ~/.claude/hooks/circuit-breaker.sh

# 2. Merge hooks/claude-code/settings.example.json into ~/.claude/settings.json
#    (adds the statusLine and Stop hooks for quota-ingest.sh, plus
#     UserPromptSubmit/PreToolUse hooks for circuit-breaker.sh)

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

The payload maps `rate_limits.five_hour.used_percentage` → `window_5h_percent`, `rate_limits.seven_day.used_percentage` → `window_7d_percent`, `model.id` → `model`, `session_id` → `task_name`, `rate_limits.five_hour.resets_at` (epoch seconds) → `reset_at` (ISO) and `rate_limits.seven_day.resets_at` (epoch seconds) → `reset_7d_at` (ISO, omitted when absent). The statusline JSON shape (`rate_limits.*`) is the currently known format; adjust the `jq` filter in the script if your Claude Code version differs.

`hooks/claude-code/circuit-breaker.sh` is the manual pause enforcement: wired as `UserPromptSubmit`/`PreToolUse` it calls `GET $APP_URL/api/status` with the bearer token (3s timeout) and reads `.global_status` with `jq`. Only a confirmed `paused` prints the reason to stderr and exits `2` to block the agent; missing env/`jq`/`curl`, network/HTTP errors and bad JSON all exit `0` (fail-open), so it can never break Claude Code. There is no automatic pause — `global_status` only changes when you send `POST /api/control` manually.

## OpenCode Go plugin

`hooks/opencode/quota-sync.ts` is a global OpenCode plugin that reports OpenCode Go token usage to `POST /api/ingest` (`provider: "opencode_go"`). It is dependency-free and never blocks or breaks OpenCode: every network/DB/config error is swallowed, sends are fire-and-forget with a 5s timeout, and a missing `APP_URL`/`INGEST_API_KEY` turns it into a no-op.

Install it on the host that runs OpenCode:

1. `mkdir -p ~/.config/opencode/plugin`
2. Copy `hooks/opencode/quota-sync.ts` into `~/.config/opencode/plugin/`.
3. Export the env vars below in the shell that launches OpenCode (e.g. in your shell profile).
4. Restart OpenCode.

Behavior:

- On each completed assistant message from `providerID: "opencode-go"` (`message.updated` with `time.completed`), it sends `delta_tokens = tokens.total` (plus `input_tokens`/`output_tokens`/`cache_read_tokens` for logging). Messages are deduped by message id, so a message is counted once.
- It does not read the local OpenCode database, has no backfill and no state file; usage before installing the plugin is not reported. It never sends a `cycle_token_limit`.

Plugin environment variables (read from `process.env`, separate from the server-side table above):

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Base URL of the deployment, e.g. `https://your-app.vercel.app`. Required for the plugin to send anything. |
| `INGEST_API_KEY` | Bearer token for `POST /api/ingest`. Required for the plugin to send anything. |
| `AGENT_ID` | `agent_id` sent with every payload (default `opencode-go`). Optional. |

## OpenCode Go quota windows (`set-quota.sh`)

The OpenCode Go console shows three quota windows (5h, 7d, 30d) that the plugin cannot read automatically. `hooks/opencode/set-quota.sh` lets you type them in; each call posts one window to `/api/ingest` and the dashboard then shows the real percent and reset for that row.

```bash
hooks/opencode/set-quota.sh <5h|7d|30d> <percent 0..100> <reset_iso>
# example: 58% used on the 7-day window, resetting 2026-12-01T00:00:00Z
hooks/opencode/set-quota.sh 7d 58 2026-12-01T00:00:00Z
```

It sends `{ provider: "opencode_go", agent_id, window_id, window_percent, reset_at }` with `AGENT_ID` (default `opencode-console`), so the token counters and telemetry log are untouched and only that window is updated. Unlike the hooks it runs synchronously and prints `ok` or the server error.

- Bad arguments (window not `5h`/`7d`/`30d`, percent not a number `0..100`, missing reset) → usage on stderr, exit `2`.
- Missing `APP_URL`/`INGEST_API_KEY`, `jq` or `curl` → warning on stderr, exit `0`.
- Network error or non-2xx response → exit `1`.

Requirements: `bash`, `jq` and `curl` on `PATH`, plus the `0004` migration applied to Supabase.

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

This applies `supabase/migrations/0001_init.sql`, `0002_realtime_read_policies.sql`, `0003_claude_reset_7d.sql` and `0004_opencode_windows.sql` (see [Database](#database)). Copy the project URL and the **service role** key from Project Settings → API; they become `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

### 3. Deploy to Vercel and set environment variables

```bash
vercel            # first deploy / link the project
vercel --prod     # production deploy
```

Importing the GitHub repo in the Vercel dashboard works the same way. In **Project → Settings → Environment Variables**, add every server-side variable from [Environment variables](#environment-variables) (`INGEST_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), then redeploy so the functions pick them up.

Pick a long random `INGEST_API_KEY` (e.g. `openssl rand -hex 32`); it is the bearer token every client and the dashboard API use.

### 4. Export the client env vars

The hook and the plugin read `APP_URL` / `INGEST_API_KEY` (and optional `AGENT_ID`) from the environment, not from a file. Add them to `~/.zshrc` so every new terminal has them:

```bash
cat >> ~/.zshrc <<'EOF'
export APP_URL="https://your-app.vercel.app"
export INGEST_API_KEY="your-ingest-key"
# optional override
# export AGENT_ID="claude-code-mybox"          # Claude Code hook default: claude-code-$(hostname -s)
EOF
source ~/.zshrc
```

Use the `vercel --prod` URL from step 3 as `APP_URL` (no trailing slash).

### 5. Install the Claude Code hook

Follow [Claude Code hook (Phase 3a)](#claude-code-hook-phase-3a):

```bash
mkdir -p ~/.claude/hooks
cp hooks/claude-code/quota-ingest.sh ~/.claude/hooks/quota-ingest.sh
cp hooks/claude-code/circuit-breaker.sh ~/.claude/hooks/circuit-breaker.sh
chmod +x ~/.claude/hooks/quota-ingest.sh ~/.claude/hooks/circuit-breaker.sh
```

Merge `hooks/claude-code/settings.example.json` into `~/.claude/settings.json`; it adds the `statusLine` command and a `Stop` hook pointing at `quota-ingest.sh`, plus `UserPromptSubmit`/`PreToolUse` hooks pointing at `circuit-breaker.sh`. Keep your existing settings and only add the `statusLine` and the `hooks` entries you want.

### 6. Install the OpenCode Go plugin

Follow [OpenCode Go plugin](#opencode-go-plugin):

```bash
mkdir -p ~/.config/opencode/plugin
cp hooks/opencode/quota-sync.ts ~/.config/opencode/plugin/
```

Restart OpenCode from a terminal that has the step 4 env vars exported. The plugin starts reporting a token delta for each completed `opencode-go` assistant message; there is no backfill of past usage.

### 7. Verify the install

Send one Claude Code snapshot (5-hour and 7-day usage percentages) and read the current status back:

```bash
~/.claude/hooks/quota-ingest.sh --once 12.5 40
curl "$APP_URL/api/status" -H "Authorization: Bearer $INGEST_API_KEY"
```

`/api/status` should show a `claude_code` snapshot with `window_5h_percent: 12.5` and `window_7d_percent: 40`. A `401` means `INGEST_API_KEY` differs between the client shell and Vercel; an empty `snapshots` array usually means `APP_URL`/`INGEST_API_KEY` were not exported in the shell that ran the hook.

Record the OpenCode Go windows shown in the console (repeat for `5h`, `7d` and `30d`, each with its own reset time):

```bash
hooks/opencode/set-quota.sh 5h 35 2026-11-26T03:00:00Z
hooks/opencode/set-quota.sh 7d 58 2026-12-01T00:00:00Z
hooks/opencode/set-quota.sh 30d 41 2026-12-25T00:00:00Z
```

Each successful call prints `ok: <window> <percent>% (reset <iso>)` and the OpenCode Go section of the dashboard shows the three rows with those values; rows you have not entered yet show `--`.

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

- **Phase 2 (PWA frontend):** the dashboard reads live quota/telemetry/control from Supabase (initial fetch + Realtime) when `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set, otherwise it renders mock data. Still pending: dashboard control writes (`POST /api/control` — the Circuit Breaker toggle is read-only in live mode and errors with "Chưa nối /api/control").
- **Phase 3 (host hooks):** the Claude Code hooks (`hooks/claude-code/`) and the OpenCode Go plugin (`hooks/opencode/`) are implemented; install steps are in [macOS setup guide](#macos-setup-guide-phase-3d).
- Out of scope by design: automatic threshold-based pause, Web Push notifications and their subscription endpoint, and cycle-limit based estimates. Pausing is manual only.
