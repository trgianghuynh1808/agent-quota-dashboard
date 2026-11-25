# AGENTS.md

Guidelines for coding agents working in this repo.
<!-- Generate the project-specific sections with prompts/generate-agents-md.md, then review them by hand.
     Keep the "Testing Rules", "Verify Phase" and "Workflow Rules" sections: the scripts depend on them. -->

## Project Overview

`agent-quota-dashboard` is a quota & telemetry dashboard for Claude Code and OpenCode Go, built in phases from `docs/SPEC.md`. Phase 1 is in place: Vite + React + TS + Tailwind + PWA scaffold, Supabase schema, Vercel API routes (`POST /api/ingest`, `GET /api/status`), threshold auto-pause and Web Push. Phase 2 (PWA dashboard) and Phase 3 (host hooks) are not built yet.
- App stack: Vite + React 19 + TypeScript + Tailwind CSS v4 + vite-plugin-pwa; Vercel Node API routes in `api/`; Supabase Postgres + Realtime; Vitest for tests.
- Tooling stack: bash scripts + one Python 3 helper (`scripts/room-ops.py`); Claude plans/verifies, OpenCode implements.

## Architecture

- App architecture: the API handlers (`api/ingest.ts`, `api/status.ts`) build real dependencies lazily via `createSupabaseDb()` / `createPushNotifier()`; business logic lives in `api/_lib/` behind the injected `Db` + `notify` interfaces, so tests use an in-memory `FakeDb`. `quota_snapshots` stores the current quota (`claude_code` absolute upsert, `opencode_go` atomic increment through the RPC `increment_opencode_usage`), `agent_telemetry_logs` stores per-turn history, `orchestrator_control` holds the single control row, and `push_subscriptions` stores Web Push subscriptions. All tables enable RLS with no policies: only the service role (server) can access them.
- App dev URL: the config default is `http://localhost:5173` (`DEFAULT_VERIFY_URL` in `.agents/config.sh`); the Vite dev server serves the placeholder page there. In a room, `APP_PORT` / `PLAYWRIGHT_BASE_URL` come from `.agents/room.env`.
- Agent tooling: Claude hands tasks to OpenCode through files. `scripts/handoff.sh` writes a job to `.agents/queue/`, `scripts/watch-tasks.sh` picks it up and runs `scripts/run-task.sh`, and status goes to `.agents/status/<task>.status` (`queued` -> `running` -> `done` | `stuck`), which `scripts/wait-task.sh` polls.
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
- `api/` - Vercel Node API routes: `ingest.ts`, `status.ts`, and `_lib/` (`types`, `auth`, `validate`, `ingest`, `supabase-db`, `push`).
- `src/` - React placeholder app (`App.tsx`, `main.tsx`, `index.css`); the dashboard comes in Phase 2.
- `supabase/migrations/` - SQL migrations; `0001_init.sql` holds the Phase 1 schema and `increment_opencode_usage`.
- `tests/` - Vitest specs and the in-memory `FakeDb` (`fake-db.ts`, `api.test.ts`).
- `docs/SPEC.md` - product spec covering all phases.
- App source folders: `api/`, `src/`, `supabase/migrations/`, `tests/`.

## Commands

```bash
# App commands (run from the repo root)
npm install
npm run dev          # vite dev server
npm run build        # tsc -b && vite build
npm run typecheck    # tsc -b --noEmit (covers src, api, tests)
npm run test         # vitest run
npx vitest run tests/api.test.ts   # run only the API spec

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

