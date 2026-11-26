# Task: T11 Phase 2d — Burn Rate & Anomaly Monitor + Active Agents Feed (mock data)

APPROVED_BY_MANAGER

Verify mode: light

## Mục tiêu
- Thêm card Burn Rate & Anomaly Monitor: TPM, Time-to-Limit, badge cảnh báo loop theo `agent_id` (dùng `detectLoops`).
- Thêm Active Agents Feed: danh sách turn gần đây (agent, model, task, tokens, cache ratio, tuổi).
- Dùng mock data, chưa nối Supabase/Realtime.

## Ý tưởng
- Thêm helper thuần `src/lib/burn-rate.ts` (`buildBurnRate`, `buildAgentFeed`) tái dùng `tokensPerMinute`, `timeToLimitMs`, `cacheRatio`, `detectLoops`; mọi hàm nhận `now`.
- Thêm mock turns `src/mock/turns.ts` (có 1 agent đang loop) và 2 component `BurnRateMonitor`, `ActiveAgentsFeed` theo style `QuotaHealthCards`.
- Gắn vào bento grid `App.tsx`; test bằng Vitest cho helper (repo chưa có Playwright).

## Quyết định đã chốt
- Không thêm Playwright/dependency; chỉ Vitest trên helper thuần.
- Time-to-Limit tính trên OpenCode Go cycle (remaining = limit − `effectiveCycleUsed`); Claude chỉ có % nên không tính.

## Ngữ cảnh
- `src/lib/quota.ts`: `tokensPerMinute(samples: {at,tokens}[], now, windowMs=180_000)`, `timeToLimitMs(remaining, tpm): number|null`, `cacheRatio(cacheRead, totalInput): number|null`, `effectiveCycleUsed(s: QuotaSnapshot, now)`, `formatCountdown(countdown(resetAt, now))`.
- `src/lib/anomaly.ts`: `AgentTokenSample {agentId, at, tokens}`, `detectLoops(samples, now, opts?) → LoopAlert[] {agentId,totalTokens,turns,tpm}`; loop = agent có sample trong cả 3 bucket của cửa sổ 180s và tổng ≥ 30_000 token.
- `api/_lib/types.ts`: `QuotaSnapshot`, `LogEntry {provider, agent_id, task_name?, model?, input_tokens, output_tokens, cache_read_tokens}`.
- `src/mock/snapshots.ts`: `mockSnapshots(now)` (opencode_go used 4.2M/10M). `src/App.tsx` dùng `useNow()` + `useMemo(() => mockSnapshots(Date.now()), [])`, grid `md:grid-cols-3`.
- Style card: `rounded-2xl border border-slate-200 bg-white p-4 shadow-sm`, `data-testid` trên mỗi card (xem `src/components/QuotaHealthCards.tsx`).
- Imports dùng đuôi `.js`. Repo không có Playwright: không viết spec trình duyệt. Vitest include `tests/**/*.test.ts`, môi trường node.
- Type đề xuất:
  ```ts
  export interface FeedTurn { id: string; at: number; entry: LogEntry }
  export interface BurnRate { tpm: number; timeToLimitMs: number | null; alerts: LoopAlert[] }
  export interface FeedRow { id: string; agentId: string; model: string; task: string; tokens: number; cachePercent: number | null; ageText: string }
  ```

## Plan
- [x] 1. [vừa] `src/lib/burn-rate.ts` → tạo `FeedTurn`, `buildBurnRate(turns: FeedTurn[], snapshots: QuotaSnapshot[], now): BurnRate` (samples = `toAgentSample(t.entry, t.at)`; tpm = `tokensPerMinute` trên mọi sample; remaining từ snapshot `opencode_go` = `cycle_token_limit - effectiveCycleUsed`, null nếu không có limit; alerts = `detectLoops`) và `buildAgentFeed(turns, now, limit = 8): FeedRow[]` (mới nhất trước; cachePercent = `cacheRatio(cache_read, input+cache_read)` × 100 làm tròn; model/task mặc định `'--'`; ageText kiểu `12s ago`/`3m ago`).
- [x] 2. [vừa] `src/mock/turns.ts` → `mockTurns(now): FeedTurn[]`: ~8 turn; agent `loop-agent` có turn ở cả 3 bucket 60s gần nhất, tổng ≥ 30k token; 2-3 agent khác bình thường (model/task/cache khác nhau). Rồi `src/components/BurnRateMonitor.tsx` (`data-testid="burn-rate-monitor"`, hiển thị TPM, Time-to-Limit bằng `formatCountdown`-style text hoặc `--`, badge `data-testid="loop-alert-<agentId>"` màu đỏ) và `src/components/ActiveAgentsFeed.tsx` (`data-testid="agents-feed"`, mỗi dòng `data-testid="feed-row-<id>"`). Ghi dòng `Selectors:` vào Trạng thái hiện tại.
- [x] 3. [dễ] `src/App.tsx` → thêm `const turns = useMemo(() => mockTurns(Date.now()), [])`, render `<BurnRateMonitor>` và `<ActiveAgentsFeed>` (feed `md:col-span-3`) sau `QuotaHealthCards`. Chạy `npm run typecheck`.
- [x] 4. [vừa] `tests/burn-rate.test.ts` → viết T1, T2 (xem Test cases). Chạy `npx vitest run tests/burn-rate.test.ts`.
- [x] 5. [dễ] `README.md` + `AGENTS.md` → cập nhật Codebase Map (`src/lib/burn-rate.ts`, 2 component mới, `src/mock/turns.ts`) và README nếu có mục dashboard; ghi "Docs checked" vào Trạng thái hiện tại.

## Test cases
- [x] T1. Burn rate + loop alert — `buildBurnRate` tính TPM, Time-to-Limit, alert — tests/burn-rate.test.ts
  - Setup: `now = 1_000_000_000_000`; snapshot opencode_go `cycle_token_limit=10_000_000`, `cycle_tokens_used=9_000_000`, `reset_at` sau now; turns: agent `a` 3 turn (at = now−150s, now−90s, now−30s) mỗi turn 12_000 token; agent `b` 1 turn 1_000 token tại now−20s; 1 turn của `a` tại now−400s (ngoài cửa sổ).
  - Steps: gọi `buildBurnRate(turns, [snapshot], now)`.
  - Assert: `tpm` = 37_000/3; `alerts` có đúng 1 phần tử `agentId==='a'`, `totalTokens===36000`, `turns===3`; `timeToLimitMs` = `1_000_000 / tpm * 60_000`; với snapshot không có limit (claude_code) → `timeToLimitMs === null`.
- [x] T2. Agents feed — `buildAgentFeed` sắp xếp, cache ratio, giới hạn — tests/burn-rate.test.ts
  - Setup: 10 turn tăng dần theo `at`; một turn có `input_tokens=300`, `cache_read_tokens=100`, không `model`/`task_name`.
  - Steps: `buildAgentFeed(turns, now)` và `buildAgentFeed(turns, now, 3)`.
  - Assert: độ dài 8 và 3; hàng đầu là turn mới nhất; turn đặc biệt có `cachePercent===25`, `model==='--'`, `task==='--'`; turn `at = now−12_000` có `ageText==='12s ago'`; turn có `input+cache_read=0` → `cachePercent===null`.

## Trạng thái hiện tại
- Bước 1 xong: `src/lib/burn-rate.ts` tạo `FeedTurn`, `BurnRate`, `FeedRow`, `buildBurnRate` (TPM qua `tokensPerMinute`, Time-to-Limit từ snapshot `opencode_go` = `cycle_token_limit - effectiveCycleUsed`, alerts qua `detectLoops`) và `buildAgentFeed` (mới nhất trước, `cachePercent` = `cacheRatio × 100` làm tròn, model/task mặc định `--`, ageText `Xs/Xm/Xh ago`). `npm run typecheck` PASS. Commit `d08c88b`.
- Bước 2 xong: `src/mock/turns.ts` (`mockTurns(now)` — 8 turn, `loop-agent` có 3 turn ở 3 bucket 60s gần nhất tổng 36k token, còn lại `claude-main`/`go-helper`/`docs-bot` bình thường với model/task/cache khác nhau, `go-helper` cache 0) + `src/components/BurnRateMonitor.tsx` (TPM, Time-to-Limit qua `formatCountdown`-style, badge loop màu đỏ) + `src/components/ActiveAgentsFeed.tsx` (dòng mới nhất trước, tokens/cache/age). Chưa gắn vào `App.tsx` (bước 3). `npm run typecheck` PASS. Commit `d13efb3`.
- Bước 3 xong: `src/App.tsx` thêm `const turns = useMemo(() => mockTurns(Date.now()), [])` và render `<BurnRateMonitor>` (cột 3, cùng hàng 2 quota card) + `<ActiveAgentsFeed>` bọc `div className="md:col-span-3"` (component không nhận `className`, nên bọc ngoài để full-width). `npm run typecheck` PASS. Commit `da97b22`. Docs chưa cập nhật (bước 5).
- Bước 4 xong: `tests/burn-rate.test.ts` viết T1 (buildBurnRate: tpm 37_000/3, đúng 1 alert agent `a` với totalTokens 36_000/turns 3, timeToLimitMs = 1_000_000/tpm×60_000, snapshot claude_code không limit → null) và T2 (buildAgentFeed: mới nhất trước, độ dài 8 mặc định và 3 khi truyền limit, cachePercent 25 + model/task `--` cho turn không model/task, ageText `12s ago`, turn input+cache=0 → cachePercent null). `npx vitest run tests/burn-rate.test.ts` PASS (2/2), `npm run typecheck` PASS. Commit `f0a0183`.
Selectors: [data-testid="burn-rate-monitor"], [data-testid="loop-alert-<agentId>"] (src/components/BurnRateMonitor.tsx); [data-testid="agents-feed"], [data-testid="feed-row-<id>"] (src/components/ActiveAgentsFeed.tsx)
- Bước 5 xong: `AGENTS.md` cập nhật Project Overview (Phase 2 partial), App dev URL, Codebase Map `src/` (thêm `BurnRateMonitor`, `ActiveAgentsFeed`, `src/mock/turns.ts`, `src/lib/burn-rate.ts`). `README.md` thêm mục "Dashboard (Phase 2, mock data)", cập nhật Stack/Project structure, mục "Not implemented yet" (Phase 2 còn Realtime + push). Docs checked: no remaining stale statements. `npm run typecheck` PASS (không có Playwright spec trong repo).

## Test status
- Lần chạy cuối: `npx vitest run tests/burn-rate.test.ts` (bước 4) — PASS 2/2; `npm run typecheck` (bước 5) — PASS.
- Kết quả từng test:
  - T1: PASS
  - T2: PASS
- Fail chi tiết:

## Verify
- Suite đầy đủ `npx vitest run`: 32/32 PASS; `npm run typecheck` PASS. T1: PASS, T2: PASS.
- Visual (PASS): Burn Rate 14,440 tok/min, Time to limit 6h 41m, badge đỏ loop-agent 36,000 tokens/3 turns; Active Agents Feed 8 dòng, mới nhất trước. Ảnh: `.agents/screenshots/task-11-burn-rate-feed.png`.

VERIFY: PASS

## Lưu ý

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
