# PROJECT SPECIFICATION: Unified Multi-Agent Quota & Telemetry PWA Dashboard

## 1. Objective & System Overview
Build a lightweight, zero-overhead, real-time monitoring and remote-control PWA dashboard to track quota consumption, burn rate, and agent statuses across **Claude Code** and **OpenCode Go**.

### Core Constraints
1. **Zero Local Overhead:** Must NOT run persistent background daemons, file watchers, or heavy runtimes (like Node.js workers) on the host machine (MacBook Air). All telemetry must be event-driven via native lifecycle hooks (`fire-and-forget`).
2. **Zero AI Quota Cost:** Telemetry ingestion uses standard HTTPS POST requests carrying lightweight JSON metadata. Never invoke LLM endpoints for tracking.
3. **Mobile-First PWA:** Installable on Android and iOS (Home Screen) with Web Push Notifications and a remote "Circuit Breaker" (Pause/Resume) control.

---

## 2. System Architecture

```text
[Host Machine: MacBook Air]
 ├── Claude Code (Stop / Statusline Hook) ──┐
 │    └─ Async `curl` POST (< 5ms)          │
 └── OpenCode Go (Custom TS Plugin) ────────┼──▶ [Cloud Ingest API] ──▶ [Cloud DB (Realtime)]
      └─ Non-blocking `fetch()`             │                                   │
                                            │                                   ▼
[Mobile / Desktop Browser] ◀────────────────┴───(WebSocket / Web Push)─── [PWA Dashboard]
```

### Recommended Tech Stack
- **Backend & Realtime DB:** Supabase (Edge Functions + PostgreSQL + Supabase Realtime) OR Cloudflare Workers + D1 + WebSockets.
- **Frontend:** React + Vite + TypeScript + Tailwind CSS + vite-plugin-pwa.
- **Notifications:** Standard Web Push API with VAPID keys via Service Worker.

---

## 3. Database Schema Design
Implement the following core tables:

### A. `quota_snapshots` (Current State - Upsert / Delta)
Stores the real-time quota state for each provider.

- `provider` (PK, text): 'claude_code' | 'opencode_go'
- `window_5h_percent` (float): Current 5-hour rolling window usage % (Claude Code).
- `window_7d_percent` (float): Current 7-day rolling window usage % (Claude Code).
- `cycle_tokens_used` (bigint): Total tokens used in current cycle (OpenCode Go).
- `cycle_token_limit` (bigint): Configured cycle limit (OpenCode Go).
- `reset_at` (timestamptz): Next quota reset timestamp.
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
- `global_status` (text): 'running' | 'paused'
- `auto_pause_threshold` (int, default 90): Auto-pause when quota % exceeds this value.
- `downgrade_model_threshold` (int, default 80): Warning/model-downgrade trigger.
- `updated_at` (timestamptz)

---

## 4. Data Ingestion & Sync Mechanics

### A. Ingest Endpoint (`POST /api/ingest`)
**Auth:** Bearer Token (`INGEST_API_KEY`).

**Behavior:**
1. Validates payload and inserts into `agent_telemetry_logs`.
2. For `claude_code`: Performs an UPSERT on `quota_snapshots` overwriting `window_5h_percent`, `window_7d_percent`, and `reset_at` with the exact absolute percentages reported by Claude's hook/statusline payload.
3. For `opencode_go`: Performs an atomic increment (`cycle_tokens_used = cycle_tokens_used + delta_tokens`) on `quota_snapshots`.
4. **Threshold Check:** Evaluates updated quota % against `orchestrator_control` thresholds. If `>= auto_pause_threshold`, automatically flips `global_status` to 'paused' and triggers a Web Push Notification.

### B. Host-Side Integration Scripts (To be generated in `/scripts` or `/hooks`)

**Claude Code (`~/.claude/settings.json`):**
- Configure `Stop` and/or `Statusline` hook to pipe JSON payload into an asynchronous background `curl` command (`> /dev/null 2>&1 &`) targeting `/api/ingest`.
- Provide a 1-time CLI command to push initial current quota snapshot upon setup.

**OpenCode Go (`~/.config/opencode/plugin/quota-sync.ts`):**
- Create a lightweight global plugin hooking into `session.idle` / `message.updated`.
- Include a 1-time initialization check (`backfillInitialUsage()`) that reads existing local usage from `~/.local/share/opencode/` on first run to establish the baseline in `quota_snapshots`.
- Use non-blocking `fetch()` (fire-and-forget with short timeout) to push token deltas on subsequent events.

**Circuit Breaker Pre-Check (`GET /api/status`):**
- Provide a lightweight `PreToolUse` / `UserPromptSubmit` hook snippet that checks `global_status`. If 'paused', exits with a non-zero code or sleep loop instructing the agent to halt until resumed.

---

## 5. PWA Frontend Requirements

### A. Core UI Components (Mobile-First Bento Grid)
1. **Quota Health Cards (Top Priority):**
   - Progress bars for Claude Code (5h & 7d windows) and OpenCode Go Cycle.
   - Live countdown timers to `reset_at`.
   - **Auto-Reset UI Logic:** If `Date.now() > reset_at`, visually render usage as 0% immediately without waiting for a new host event.
2. **Burn Rate & Anomaly Monitor:**
   - Real-time Tokens/Min (TPM) metric and estimated Time-to-Limit.
   - Visual alert badge if any single `agent_id` triggers high consecutive token burn within a 3-minute window (loop detection).
3. **Remote Circuit Breaker Controls:**
   - Prominent toggle switch: System Active (RUNNING) / Emergency Pause (PAUSED).
   - Editable slider/inputs for Warning Threshold (default 80%) and Auto-Pause Threshold (default 90%).
4. **Active Agents Feed:**
   - Live stream of recent agent turns, model used, cache efficiency ratio (`cache_read / total_input`), and token cost per feature.

### B. PWA & Web Push Implementation
- Configure `manifest.json` (`display: "standalone"`, custom icons, theme colors).
- Implement Service Worker (`sw.js`) handling `push` and `notificationclick` events.
- Add a clean onboarding banner for iOS Safari users instructing them to tap "Share -> Add to Home Screen" before requesting `Notification.requestPermission()`.

---

## 6. Execution Phases for the Coding Agent
Please execute the implementation in the following order:

- **Phase 1 (Backend & Schema):** Initialize project structure, database migrations/schema, `/api/ingest` and `/api/status` endpoints, and Web Push notification sender.
- **Phase 2 (PWA Frontend):** Build the Vite + React + Tailwind dashboard with Realtime DB subscriptions, Bento Grid UI, auto-reset countdown logic, and Service Worker push registration.
- **Phase 3 (Host Hooks & Setup Guide):** Generate the exact Claude Code hook config, OpenCode Go global TypeScript plugin (with 1-time backfill logic), and a `README.md` with step-by-step installation instructions for macOS.
