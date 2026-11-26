# AGENTS.md

Guidelines for coding agents working in this repo.
<!-- Generate the project-specific sections with prompts/generate-agents-md.md, then review them by hand.
     Keep the "Testing Rules", "Verify Phase" and "Workflow Rules" sections: the scripts depend on them. -->

## Project Overview

`agent-quota-dashboard` is a quota & telemetry dashboard for Claude Code and OpenCode Go, built in phases from `docs/SPEC.md`. Phase 1 is in place: Vite + React + TS + Tailwind + PWA scaffold, Supabase schema, Vercel API routes (`POST /api/ingest`, `GET /api/status`, `POST /api/control`, `POST /api/subscribe`), threshold auto-pause and Web Push. Phase 3a is in place: a sample Claude Code hook (`hooks/claude-code/`) that posts statusline quota to `/api/ingest`. Phase 3b ships the OpenCode Go global plugin (`hooks/opencode/quota-sync.ts`) with a one-time usage backfill, plus `hooks/opencode/set-quota.sh` to record the real 5h/7d/30d windows typed from the OpenCode Go console (the OpenCode quota card always shows those three rows, `--` when a window is missing). Phase 2 is partially built: the PWA dashboard reads live quota, telemetry and control from Supabase (initial fetch + one Realtime `postgres_changes` channel) when `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set, and otherwise renders mock data (quota health cards, Burn Rate & Anomaly Monitor, Active Agents Feed); it ships a PWA shell (standalone manifest with `#0f172a` theme, service worker handling `push`/`notificationclick`) and a push onboarding banner (iOS Safari install steps, "Bật thông báo" requests permission only on click); dashboard control writes (`POST /api/control`) and push subscription registration are pending; `README.md` includes a macOS setup guide (Phase 3d).
- App stack: Vite + React 19 + TypeScript + Tailwind CSS v4 + vite-plugin-pwa; Vercel Node API routes in `api/`; Supabase Postgres + Realtime; Vitest for tests.
- Tooling stack: bash scripts + one Python 3 helper (`scripts/room-ops.py`); Claude plans/verifies, OpenCode implements.

## Architecture

- App architecture: the API handlers (`api/ingest.ts`, `api/status.ts`, `api/control.ts`, `api/subscribe.ts`) build real dependencies lazily via `createSupabaseDb()` / `createPushNotifier()`; business logic lives in `api/_lib/` behind the injected `Db` + `notify` interfaces, so tests use an in-memory `FakeDb`. `quota_snapshots` stores the current quota (`claude_code` absolute upsert, `opencode_go` atomic increment through the RPC `increment_opencode_usage`, and `opencode_windows` jsonb holding the real 5h/7d/30d windows merged by `id` through `Db.setOpencodeWindow`), `agent_telemetry_logs` stores per-turn history, `orchestrator_control` holds the single control row, and `push_subscriptions` stores Web Push subscriptions. All tables enable RLS; `0001` adds no policies, `0002` adds `select` policies for `anon`/`authenticated` on `quota_snapshots`, `agent_telemetry_logs` and `orchestrator_control` for Realtime, so otherwise only the service role (server) can access them (`push_subscriptions` stays service-role only). An `opencode_go` ingest with `window_id` updates only `opencode_windows` (no telemetry log, no token delta), and OpenCode auto-pause uses `max(opencode_windows[].percent)` when windows exist, otherwise the cycle tokens/limit.
- App dev URL: the config default is `http://localhost:5173` (`DEFAULT_VERIFY_URL` in `.agents/config.sh`); the Vite dev server serves the dashboard there (live from Supabase when the `VITE_SUPABASE_*` env vars are set, otherwise mock). In a room, `APP_PORT` / `PLAYWRIGHT_BASE_URL` come from `.agents/room.env`.
- OpenCode Go plugin (`hooks/opencode/quota-sync.ts`): dependency-free global plugin copied to `~/.config/opencode/plugin/`. `createQuotaSync(deps)` holds the testable logic (dedupe by message id, `backfillInitialUsage`, no-op without `APP_URL`/`INGEST_API_KEY`, errors swallowed); the default export wires real deps (`global fetch`, `process.env`, `bun:sqlite` opened read-only via dynamic `import("bun:sqlite")`, state file `~/.config/opencode/quota-sync.state.json`). `message.updated` events for assistant `opencode-go` messages send `delta_tokens = tokens.total` fire-and-forget (5s timeout). Backfill sums the last `OPENCODE_CYCLE_DAYS` (default 30) days from `~/.local/share/opencode/opencode.db` once. `hooks/opencode/set-quota.sh <5h|7d|30d> <percent> <reset_iso>` records one real console window (env `APP_URL`/`INGEST_API_KEY`, `AGENT_ID` default `opencode-console`), sending `{provider:'opencode_go', agent_id, window_id, window_percent, reset_at}` synchronously with `curl --max-time 5`; bad args exit `2`, missing env/`jq`/`curl` warn and exit `0`, network/HTTP errors exit `1`.
- Agent tooling: Claude hands tasks to OpenCode through files. `scripts/handoff.sh` writes a job to `.agents/queue/`, `scripts/watch-tasks.sh` picks it up and runs `scripts/run-task.sh`, and status goes to `.agents/status/<task>.status` (`queued` -> `running` -> `done` | `stuck`), which `scripts/wait-task.sh` polls.
- Claude Code hook: `hooks/claude-code/quota-ingest.sh` reads the statusline JSON on stdin, builds a `claude_code` payload with `jq` and POSTs it fire-and-forget (`curl ... &`) to `$APP_URL/api/ingest` with `INGEST_API_KEY`. Secrets come from the environment only; missing env/`jq`/`curl`/quota exits `0` silently so the hook never breaks Claude Code. `--once <5h> <7d>` sends a one-off snapshot. When present, `rate_limits.five_hour.resets_at` → `reset_at` and `rate_limits.seven_day.resets_at` → `reset_7d_at` (both ISO; each omitted if absent). Tests run the real script with a fake `curl` on `PATH` (`tests/claude-hook.test.ts`).
- Claude Code circuit breaker: `hooks/claude-code/circuit-breaker.sh` (wired as `UserPromptSubmit`/`PreToolUse` in `settings.example.json`) synchronously calls `GET $APP_URL/api/status` with `Authorization: Bearer $INGEST_API_KEY` (3s timeout) and reads `.global_status` with `jq`. Only a confirmed `paused` prints the reason to stderr and exits `2` to block the agent; missing env/`jq`/`curl`, network/HTTP errors or bad JSON all exit `0` (fail-open) so the hook can never break Claude Code.
- State lives in files: task plans in `.agents/tasks/`, the multi-room board in `.agents/board.md`, logs in `.agents/run.log`. The runtime paths are gitignored (see `.gitignore`).

## Codebase Map

- `.agents/tasks/` - task plans (`_TEMPLATE.md` is the template).
- `.agents/config.sh` - OpenCode models per difficulty label, verify URL, check hint, batch/run limits.
- `.agents/MANAGER.md` - instructions for the Manager role.
- `scripts/agent-room.sh` - init/start/stop/status of a room (pm2 or tmux).
- `scripts/manager-loop.sh` - Manager daemon (AUTO_MODE), drives plan/verify/ship phases.
- `scripts/room-ops.py` - deterministic room operations (inbox, plan checks, approve, finalize).
- `scripts/room-env.sh` - loads `.agents/room.env` (ports, branches, AUTO_MODE).
- `scripts/handoff.sh`, `scripts/watch-tasks.sh`, `scripts/run-task.sh`, `scripts/wait-task.sh` - hand a task to OpenCode, run it step by step, wait for it.
- `scripts/notify.sh`, `scripts/board-view.sh`, `scripts/log-gaps.sh` - desktop notification, board viewer, run-log timing analysis.
- Main flow: plan on `task/<slug>` -> `handoff.sh` -> `watch-tasks.sh` runs `run-task.sh` -> Verify/review -> squash-merge and ship (see CLAUDE.md).
- `api/` - Vercel Node API routes: `ingest.ts`, `status.ts`, `control.ts`, `subscribe.ts`, and `_lib/` (`types`, `auth`, `validate`, `ingest`, `supabase-db`, `push`).
- `hooks/opencode/` - OpenCode Go global plugin (`quota-sync.ts`; copy into `~/.config/opencode/plugin/`) and the manual `set-quota.sh` helper for recording the 5h/7d/30d console windows.
- `public/` - static assets copied to `dist/`: `icon.svg` (PWA `any` + `maskable` icon) and `push-sw.js` (service worker `push`/`notificationclick` handlers, pulled into the generated `sw.js` through `workbox.importScripts`).
- `src/` - React app (`App.tsx`, `main.tsx` registers the SW via `registerSW` from `virtual:pwa-register` when `import.meta.env.PROD`, `index.css`) rendering a Bento Grid (live from Supabase when `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set via `createSupabaseSource`, otherwise mock): `src/components/QuotaHealthCards.tsx` (single `data-testid="quota-card"` with one `data-testid="quota-group-<claude|opencode>"` section per provider — Claude Code then OpenCode Go — each row `data-testid="quota-row-<bar-id>"` showing label, percent, `role="progressbar"` and countdown), `src/components/BurnRateMonitor.tsx` (TPM, time-to-limit, red loop badges), `src/components/CircuitBreakerControls.tsx` (RUNNING/PAUSED `role="switch"` toggle, warning/auto-pause number inputs, "Lưu" button, inline validation/API error; takes a `ControlApi` prop), `src/components/ActiveAgentsFeed.tsx` (recent turns: agent/model/task/tokens/cache/age), and `src/components/PushOnboardingBanner.tsx` (first grid item; `data-testid="push-onboarding"` + `data-state` `install`/`enable`: iOS Safari install steps or a "Bật thông báo" button calling `Notification.requestPermission()` only on click; "Đóng" stores `localStorage[DISMISS_KEY]`), driven by `src/hooks/useNow.ts`, `src/hooks/useLiveData.ts` (`useLiveData(source | null)` → `{ snapshots, turns, control }`, mock when `null`) and live data from `src/lib/live-data.ts` (`LiveSource`/`LiveSourceHandlers`, `rowToSnapshot` (maps `opencode_windows`, dropping invalid entries)/`rowToTurn`/`rowToControl` mappers, `upsertSnapshot`/`prependTurn` reducers, `startLive` subscribe-then-fetch; pure, no env) + `src/lib/supabase-source.ts` (`createSupabaseSource(url, anonKey)` = initial `.from(...).select()` fetch + one `dashboard-live` channel with `postgres_changes` `event: '*'` for the three tables, returns `removeChannel`), falling back to mock data from `src/mock/snapshots.ts` + `src/mock/turns.ts`; pure dashboard helpers in `src/lib/quota.ts` (expiry/auto-reset, countdown, TPM, time-to-limit, cache ratio; all take `now` as a parameter), `src/lib/quota-cards.ts` (`buildQuotaCards` → ordered `QuotaBar[]` with level thresholds; the Claude 5h row uses `reset_at`, the 7d row uses `reset_7d_at` for both the auto-reset and the countdown (`--` when missing); OpenCode Always shows three rows `opencode-5h|7d|30d` from `opencode_windows`, a missing window → percent `null` + `--`, no `opencode-cycle` fallback; `groupQuotaBars` → ordered `QuotaGroup[]` by provider with shortened labels; both take/consume `now`), `src/lib/anomaly.ts` (loop detection by `agent_id` over a 3-minute window, bucketed burn check; takes `now`), `src/lib/burn-rate.ts` (`buildBurnRate` → TPM/time-to-limit/loop alerts, `buildAgentFeed` → ordered `FeedRow[]`; take `now`), `src/lib/circuit-breaker.ts` (`validateThresholds` mirrors the server rule: integers 1..100 and warning ≤ auto-pause; `buildControlPatch` returns only changed fields), `src/lib/push-onboarding.ts` (`getOnboardingState(env)` → `install`/`enable`/`hidden` from UA/platform/touch/standalone/permission/dismissed, plus `OnboardingEnv` and `DISMISS_KEY`; pure, no `window`), and `src/lib/control-api.ts` (`ControlApi { getControl, updateControl }` + `createMockControlApi` keeping state in memory and rejecting invalid merged thresholds, plus `createReadOnlyControlApi(getControl)` whose `updateControl` rejects with "Chưa nối /api/control"; `App.tsx` wires the read-only API in live mode and the mock otherwise, so nothing calls `/api/control` yet); `<main>` carries `data-testid="data-source"` + `data-mode="live"|"mock"`; the rest of the dashboard UI comes in Phase 2.
- `hooks/claude-code/` - Claude Code hooks (`quota-ingest.sh`: statusline JSON on stdin → fire-and-forget `POST /api/ingest`, plus `--once <5h> <7d>`; `circuit-breaker.sh`: `GET /api/status` → exit 2 + stderr when `global_status` is `paused`, fail-open otherwise) and `settings.example.json` (statusLine + Stop + UserPromptSubmit/PreToolUse samples).
- `supabase/migrations/` - SQL migrations; `0001_init.sql` holds the Phase 1 schema and `increment_opencode_usage`, `0002_realtime_read_policies.sql` adds the Realtime read policies, `0003_claude_reset_7d.sql` adds the `reset_7d_at` column to `quota_snapshots`, `0004_opencode_windows.sql` adds the `opencode_windows` jsonb column.
- `tests/` - Vitest specs and the in-memory `FakeDb` (`fake-db.ts`, `api.test.ts`, `quota-cards.test.ts`, `opencode-set-quota.test.ts`, `claude-hook.test.ts`).
- `docs/SPEC.md` - product spec covering all phases.
- App source folders: `api/`, `hooks/`, `src/`, `supabase/migrations/`, `tests/`.

## Commands

```bash
# App commands (run from the repo root)
npm install
npm run dev          # vite dev server
npm run build        # tsc -b && vite build
npm run typecheck    # tsc -b --noEmit (covers src, api, tests)
npm run test         # vitest run
npx vitest run tests/api.test.ts   # run only the API spec
npx vitest run tests/claude-hook.test.ts   # run only the Claude Code hook spec

# Agent tooling (run from the repo root)
scripts/agent-room.sh init --topic <ID> --port <PORT> [--name <name>]
scripts/agent-room.sh start | stop | status
scripts/handoff.sh .agents/tasks/<file>.md      # hand a committed task to OpenCode
scripts/wait-task.sh .agents/tasks/<file>.md    # exit 0 done, 2 stuck, 3 running, 1 error
```

## Code Conventions

- TypeScript is strict ESM (`"type": "module"`). Imports inside `api/` use relative paths **with** a `.js` extension (Vercel runs ESM; Vite/Vitest map `.js` → `.ts`).
- Code under `api/_lib/` must not read `process.env` at module top level: read it inside `getEnv()`/factory functions so modules stay importable in tests.
- Business logic depends on the injected `Db` and `notify` interfaces; only `supabase-db.ts` and `push.ts` touch Supabase/`web-push`. Notification failures must never break ingest.
- Shell scripts: `#!/usr/bin/env bash`, a usage comment header, `set -euo pipefail` (`set -uo pipefail` in the watcher/wait scripts).
- Python: `scripts/room-ops.py` is a standalone Python 3 script with a docstring listing its subcommands.
- Task files and agent-facing prompts use Vietnamese; code identifiers and comments are English.
- Commits use Conventional Commits (`feat(...)`, `chore:`, `plan: <slug>`).

## Testing Rules

- After each coding step, run the type/lint check and only the test command named in that step (see Commands). Do not run the whole suite per step, and do not design or add tests the plan does not ask for. If there are no specs yet, rely on the type check and note it in the task file.
- When tests fail, read the failing spec output first; if it is a Playwright failure, read `test-results/results.json` (the Playwright JSON reporter writes it).
- In "Test status", report every test case from the task file (T1, T2...) as PASS / FAIL / not written yet, not just an overall result.
- When a plan step writes a spec, tick the matching test case in "Test cases" once the spec exists.
- Only use `playwright-cli` (interactive browser tool, separate from `@playwright/test`) when a failure is visual and `results.json` is not enough, or during the Verify phase.
- After any browser testing, clean up: close the browser and stop any dev server you started.
- Never kill, restart or stop a process you did not start, including a dev server on the user's ports (`lsof` and `ps` are for looking only). If a server on the test port does not fit (for example a missing env var such as `ADMIN_TOKEN`), do not kill it: record the port, PID and reason in "Đã thử mà không được", leave the step unticked and stop. Prefer dedicated test ports with `reuseExistingServer: false`, so tests never depend on or disturb a dev server.
- Notes for the approver: when something should be known before approving (a deviation from the plan, something left untested, a known bug or `test.fail`, a follow-up), write a line starting with `Lưu ý:` in "Trạng thái hiện tại". Only such lines (and "Đã thử mà không được") are relayed to the user, so never use the marker for reminders to agents or maintainers.
- A step that adds or changes UI ends by writing one `Selectors:` line to "Trạng thái hiện tại" (ids, classes, data-* and the file holding them). A later test step reads that line before grepping the code.
- Use unique test data per run (e.g. usernames like `user-${Date.now()}`) so runs do not collide.
- Tests must never touch production data.
- App tests are Vitest (Node environment) and must not hit Supabase or the network: use `tests/fake-db.ts` (`FakeDb`) and call `createIngestHandler` / `createStatusHandler` with minimal fake `req`/`res`. Run only the spec a step names (`npx vitest run tests/<file>.test.ts`).
- Phase 1 has no dashboard/UI, so there is no Playwright config or browser flow yet; do not script long UI flows to reach a screen.

## Verify Phase

- After all plan steps are done, a Verify agent checks the feature in a real browser with `playwright-cli`, at the level set by the task file's `Verify mode:` line (`none` / `light` / `full`).
- `light`: run the suite once, open the browser only for test cases a spec cannot check (visual/layout), no new scenarios; write a spec only to reproduce a bug found.
- `full`: also try up to 2 important edge scenarios and add specs for unchecked scenarios (max 3 new tests).
- Results go in the task file's "## Verify" section with screenshot paths.
- The Verify agent must not change app code. Its last line in "## Verify" is exactly `VERIFY: PASS` or `VERIFY: FAIL`.

## Workflow Rules

- Every task has a file in `.agents/tasks/` (template: `_TEMPLATE.md`). Read it before starting work.
- Only modify files named in the task's plan. If another file must change, record the reason in the task file.
- Commit after each step with a clear message.
- Before finishing: tick the plan checkboxes and update "Trạng thái hiện tại" and "Test status" in the task file.

## Documentation Rules

After finishing anything new (feature, behavior change, API or config change, env var, script, folder or dependency change), double-check the project docs and update whatever is now out of date, in the same task:
- `README.md`: features, architecture/diagrams, API, environment variables, scripts, project structure, tech stack. Compare it against the code, not against memory.
- Any other spec/design doc that describes the changed behavior.
- `AGENTS.md`: Architecture, Codebase Map, Commands, conventions.
- Remove statements that are no longer true instead of adding a note next to them.
- If nothing needs changing, say so in the task file's "Trạng thái hiện tại" (e.g. "Docs checked: no change needed").

