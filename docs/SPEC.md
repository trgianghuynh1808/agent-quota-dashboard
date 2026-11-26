# PROJECT SPECIFICATION: Unified Multi-Agent Quota & Telemetry PWA Dashboard

## 1. Objective & System Overview
Build a lightweight, zero-overhead, real-time monitoring and remote-control PWA dashboard to track quota consumption, burn rate, and agent statuses across **Claude Code** and **OpenCode Go**.

### Core Constraints
1. **Zero Local Overhead:** Must NOT run persistent background daemons, file watchers, or heavy runtimes (like Node.js workers) on the host machine (MacBook Air). All telemetry must be event-driven via native lifecycle hooks (`fire-and-forget`).
2. **Zero AI Quota Cost:** Telemetry ingestion uses standard HTTPS POST requests carrying lightweight JSON metadata. Never invoke LLM endpoints for tracking.
3. **Mobile-First PWA:** Installable on Android and iOS (Home Screen) with a remote "Circuit Breaker" (Pause/Resume) control. There are no quota thresholds and no Web Push: pausing is manual only.

---

## 2. System Architecture

```text
[Host Machine: MacBook Air]
 ├── Claude Code (Stop / Statusline Hook) ──┐
 │    └─ Async `curl` POST (< 5ms)          │
 └── OpenCode Go (Custom TS Plugin) ────────┼──▶ [Cloud Ingest API] ──▶ [Cloud DB (Realtime)]
      └─ Non-blocking `fetch()`             │                                   │
                                            │                                   ▼
[Mobile / Desktop Browser] ◀────────────────┴───(WebSocket / Realtime)─── [PWA Dashboard]
```

### Recommended Tech Stack
- **Backend & Realtime DB:** Supabase (Edge Functions + PostgreSQL + Supabase Realtime) OR Cloudflare Workers + D1 + WebSockets.
- **Frontend:** React + Vite + TypeScript + Tailwind CSS + vite-plugin-pwa.

---

## 3. Database Schema Design
Implement the following core tables:

### A. `quota_snapshots` (Current State - Upsert / Delta)
Stores the real-time quota state for each provider.

- `provider` (PK, text): 'claude_code' | 'opencode_go'
- `window_5h_percent` (float): Current 5-hour rolling window usage % (Claude Code).
- `window_7d_percent` (float): Current 7-day rolling window usage % (Claude Code).
- `cycle_tokens_used` (bigint): Total tokens used in current cycle (OpenCode Go).
- `cycle_token_limit` (bigint): Legacy cycle limit column; kept in the schema but no longer set or used (the dashboard no longer computes a cycle percentage).
- `reset_at` (timestamptz): Next quota reset timestamp — the Claude Code 5h window reset (OpenCode Go still uses it for token-delta payloads and window resets).
- `reset_7d_at` (timestamptz): Claude Code 7d window reset, separate from `reset_at` (added by `0003_claude_reset_7d.sql`).
- `opencode_windows` (jsonb): The real OpenCode Go quota windows `[{ id: '5h' | '7d' | '30d', percent, reset_at }]` typed from the console (added by `0004_opencode_windows.sql`); a window ingest upserts its entry by `id`, leaving the other windows untouched.
- `updated_at` (timestamptz): Last sync timestamp.

### B. `agent_telemetry_logs` (Event History & Burn Rate)
Stores individual turn/task execution logs for calculating Tokens Per Minute (TPM) and detecting infinite retry loops.

- `id` (uuid, PK)
- `provider` (text): 'claude_code' | 'opencode_go'
- `agent_id` (text): Identifier for the specific agent/worktree/session.
- `task_name` (text): Current feature or prompt context.
- `model` (text): e.g., claude-sonnet-4-6, claude-opus-4-6.
- `input_tokens` (int)
- `output_tokens` (int)
- `cache_read_tokens` (int)
- `created_at` (timestamptz)

### C. `orchestrator_control` (Remote Circuit Breaker)
Single-row configuration table polled/checked before agents execute new tasks.

- `id` (int, PK, default 1)
- `global_status` (text): 'running' | 'paused' — changed only by a manual `POST /api/control`; ingest never flips it.
- `updated_at` (timestamptz)

The `0001` table also has `auto_pause_threshold` and `downgrade_model_threshold` columns; they are legacy and no longer read or written (no cleanup migration).

---

## 4. Data Ingestion & Sync Mechanics

### A. Ingest Endpoint (`POST /api/ingest`)
**Auth:** Bearer Token (`INGEST_API_KEY`).

**Payload fields:**
- Common: `provider`, `agent_id` (required); optional `task_name`, `model`, `input_tokens`/`output_tokens`/`cache_read_tokens` (non-negative integers, default `0`) and `reset_at` (ISO date string).
- `claude_code`: requires `window_5h_percent` and `window_7d_percent` (numbers `0..100`); optional `reset_7d_at` (ISO date string for the 7d window reset; `reset_at` stays the 5h reset).
- `opencode_go` token delta: requires `delta_tokens` (non-negative integer).
- `opencode_go` quota window: `window_id` (`5h` | `7d` | `30d`) with `window_percent` (`0..100`) and `reset_at` — both required when `window_id` is set.

**Behavior:**
1. Validates payload and inserts into `agent_telemetry_logs`.
2. For `claude_code`: Performs an UPSERT on `quota_snapshots` overwriting `window_5h_percent`, `window_7d_percent`, `reset_at` and (when present) `reset_7d_at` with the exact absolute values reported by Claude's hook/statusline payload.
3. For `opencode_go`: Performs an atomic increment (`cycle_tokens_used = cycle_tokens_used + delta_tokens`) on `quota_snapshots` — unless `window_id` is set, in which case it only upserts that window in `opencode_windows` (merged by `id`) and inserts no telemetry log and no token delta.
4. **No threshold check:** ingest never compares quota percentages against a threshold, never changes `orchestrator_control` and never sends a notification. Pausing is manual through `POST /api/control` with `{ global_status }`, and the response only carries `{ ok: true, global_status }`.

### B. Host-Side Integration Scripts (To be generated in `/scripts` or `/hooks`)

**Claude Code (`~/.claude/settings.json`):**
- Configure `Stop` and/or `Statusline` hook to pipe JSON payload into an asynchronous background `curl` command (`> /dev/null 2>&1 &`) targeting `/api/ingest`.
- Provide a 1-time CLI command to push initial current quota snapshot upon setup.

**OpenCode Go (`~/.config/opencode/plugin/quota-sync.ts`):**
- Create a lightweight global plugin hooking into `message.updated` for completed assistant messages.
- Use non-blocking `fetch()` (fire-and-forget with short timeout) to push one token delta per message.
- Do not read the local OpenCode DB, do not backfill past usage and do not send a cycle token limit.

**OpenCode Go quota windows (`hooks/opencode/set-quota.sh`):**
- The plugin cannot read the OpenCode Go console windows, so `set-quota.sh <5h|7d|30d> <percent> <reset_iso>` posts one real window (`window_id`/`window_percent`/`reset_at`, synchronous `curl`) to `/api/ingest`.
- The dashboard always renders the three OpenCode Go rows (5h/7d/30d) from `quota_snapshots.opencode_windows`; a window not entered yet shows `--`.

**Circuit Breaker Pre-Check (`GET /api/status`):**
- Provide a lightweight `PreToolUse` / `UserPromptSubmit` hook snippet that checks `global_status`. If 'paused', exits with a non-zero code or sleep loop instructing the agent to halt until resumed.

---

## 5. PWA Frontend Requirements

### A. Core UI Components (Mobile-First Bento Grid)
1. **Quota Health Cards (Top Priority):**
   - Progress bars for Claude Code (5h & 7d windows) and OpenCode Go (real 5h/7d/30d windows typed from the console; a missing window shows `--`).
   - Live countdown timers to the window reset.
   - **Auto-Reset UI Logic:** If `Date.now() > reset_at`, visually render usage as 0% immediately without waiting for a new host event.
2. **Burn Rate & Anomaly Monitor:**
   - Real-time Tokens/Min (TPM) metric.
   - Visual alert badge if any single `agent_id` triggers high consecutive token burn within a 3-minute window (loop detection).
3. **Remote Circuit Breaker Controls:**
   - Prominent toggle switch: System Active (RUNNING) / Emergency Pause (PAUSED).
   - No threshold inputs: the only control is the manual toggle.
4. **Active Agents Feed:**
   - Live stream of recent agent turns, model used, cache efficiency ratio (`cache_read / total_input`), and token cost per feature.

### B. PWA Implementation
- Configure `manifest.json` (`display: "standalone"`, custom icons, theme colors).
- Ship a generated Service Worker for the app shell (precache/auto-update). No Web Push: no `push`/`notificationclick` handlers, no subscription endpoint and no permission onboarding banner.

---

## 6. Execution Phases for the Coding Agent
Please execute the implementation in the following order:

- **Phase 1 (Backend & Schema):** Initialize project structure, database migrations/schema, and the `/api/ingest`, `/api/status` and `/api/control` endpoints (manual pause/resume only).
- **Phase 2 (PWA Frontend):** Build the Vite + React + Tailwind dashboard with Realtime DB subscriptions, Bento Grid UI, auto-reset countdown logic, and the generated Service Worker (no Web Push).
- **Phase 3 (Host Hooks & Setup Guide):** Generate the exact Claude Code hook config (quota ingest + circuit-breaker pre-check), the OpenCode Go global TypeScript plugin (per-message deltas, no backfill), and a `README.md` with step-by-step installation instructions for macOS.
