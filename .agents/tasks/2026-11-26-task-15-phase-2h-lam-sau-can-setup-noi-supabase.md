# Task: Phase 2h (a) — nối Supabase Realtime chỉ đọc cho dashboard

APPROVED_BY_MANAGER

Verify mode: light

## Mục tiêu
Dashboard đọc quota / telemetry / control thật từ Supabase (fetch ban đầu + Realtime) thay cho mock khi có `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. Thiếu env thì giữ nguyên mock. Chỉ làm phần (a) chỉ đọc; `/api/control` và `/api/subscribe` để task sau.

## Ý tưởng
- Lớp `LiveSource` (interface nhỏ: fetch snapshots/turns/control + subscribe) tách khỏi `@supabase/supabase-js`; bản Supabase dùng anon key + `channel().on('postgres_changes')`.
- Hàm thuần map row DB → `QuotaSnapshot` / `FeedTurn` / `Control` và reducer áp sự kiện Realtime, test bằng fake source trong Vitest.
- Hook `useLiveData` trả `{snapshots, turns, control}`; `App.tsx` chọn live hay mock theo env. Control UI vẫn dùng API mock/chỉ đọc (không có token nên chưa ghi).

## Quyết định đã chốt
- Không đụng file `.env*` nào (kể cả `.env.example`, `.env.local`).
- Supabase thật đã có, env `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` nằm trong `.env.local`. Thiếu env → fallback mock.
- Token control (nhập tay, localStorage) KHÔNG nằm trong task này; không nhúng key vào bundle.
- Chỉ (a) Realtime đọc. Test bằng fake client Vitest, không gọi Supabase/mạng.

## Ngữ cảnh
- `src/App.tsx`: hiện dùng `mockSnapshots(Date.now())`, `mockTurns(Date.now())`, `createMockControlApi()` qua `useMemo`; render `QuotaHealthCards snapshots now`, `BurnRateMonitor turns snapshots now`, `CircuitBreakerControls api`, `ActiveAgentsFeed turns now`.
- Types (`api/_lib/types.ts`): `QuotaSnapshot {provider, window_5h_percent, window_7d_percent, cycle_tokens_used, cycle_token_limit, reset_at, updated_at, opencode_windows?}`, `Control {global_status, auto_pause_threshold, downgrade_model_threshold}`, `LogEntry {provider, agent_id, task_name?, model?, input_tokens, output_tokens, cache_read_tokens}`. `FeedTurn {id: string; at: number(ms); entry: LogEntry}` trong `src/lib/burn-rate.ts`.
- `ControlApi {getControl(); updateControl(patch)}` trong `src/lib/control-api.ts`; `createMockControlApi`.
- Bảng DB (migration 0001/0002, anon có policy select + đã thêm vào publication `supabase_realtime`): `quota_snapshots` (PK `provider`; cột như `QuotaSnapshot`, bigint/timestamptz có thể về dạng string/number), `agent_telemetry_logs` (`id uuid`, `provider`, `agent_id`, `task_name`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `created_at`), `orchestrator_control` (1 hàng `id=1`).
- DB KHÔNG có `opencode_windows` → snapshot live của opencode_go không có 3 mốc 5h/7d/30d (UI đã xử lý khi thiếu; kiểm tra `src/lib/quota-cards.ts` xem fallback thế nào, không sửa nếu đã ổn).
- `@supabase/supabase-js` ^2.119.2 đã có trong package.json. Env client đọc bằng `import.meta.env.VITE_SUPABASE_URL` (khai báo kiểu trong `src/vite-env.d.ts`). Code trong `src/lib/` mới không đọc env ở top-level; truyền qua tham số.
- Import trong `src/` dùng đuôi `.js`. Vitest chạy Node, không import được `import.meta.env` thật: giữ logic thuần trong `live-data.ts`, chỉ `supabase-source.ts` / `App.tsx` đụng env.
- Lấy turns: 200 hàng mới nhất của `agent_telemetry_logs` (order `created_at` desc), giữ tối đa 200 trong state; `at = Date.parse(created_at)`.

## Plan
- [x] 1. [vừa] `src/lib/live-data.ts` → tạo: `LiveSource` interface (`fetchSnapshots(): Promise<QuotaSnapshot[]>`, `fetchTurns(): Promise<FeedTurn[]>`, `fetchControl(): Promise<Control>`, `subscribe(h: {onSnapshot(s: QuotaSnapshot): void; onTurn(t: FeedTurn): void; onControl(c: Control): void}): () => void`), hàm thuần `rowToSnapshot`, `rowToTurn`, `rowToControl` (ép số, null-safe), `upsertSnapshot(list, s)` (thay theo provider), `prependTurn(list, t, max=200)` (bỏ trùng id, sắp mới nhất trước).
- [x] 2. [vừa] `src/lib/supabase-source.ts` → `createSupabaseSource(url, anonKey): LiveSource` dùng `createClient`; fetch ban đầu bằng `.from(table).select()`; `subscribe` mở một channel `postgres_changes` (`event: '*'`) cho 3 bảng, map bằng hàm bước 1, trả hàm `removeChannel`. Thêm `createReadOnlyControlApi(getControl)` vào `src/lib/control-api.ts` (`updateControl` reject `Error('Chưa nối /api/control')`). Khai báo `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` trong `src/vite-env.d.ts`.
- [x] 3. [vừa] `src/hooks/useLiveData.ts` + `src/App.tsx` → hook `useLiveData(source: LiveSource | null)` trả `{snapshots, turns, control}` (fetch + subscribe, cleanup khi unmount; `null` → trả mock). `App.tsx`: tạo source nếu cả hai env có giá trị (useMemo), ngược lại mock như cũ; `CircuitBreakerControls` dùng read-only API khi live, đặt `key` theo giá trị control để hiển thị cập nhật Realtime. Ghi dòng `Selectors:` (nếu thêm data-testid, ví dụ `data-testid="data-source"` `data-mode=live|mock` ở `<main>`) vào Trạng thái hiện tại.
- [x] 4. [vừa] `tests/live-data.test.ts` → viết spec cho T1–T3 (fake `LiveSource` + hàm thuần), chạy `npx vitest run tests/live-data.test.ts`, rồi `npm run typecheck`.
- [x] 5. [dễ] `README.md` → cập nhật theo Documentation Rules: bỏ câu "Realtime pending" / "mock data" nay không còn đúng, thêm `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (client, anon key, fallback mock; chỉ ghi trong README, KHÔNG tạo/sửa bất kỳ file `.env*` nào), cấu trúc `src/lib`; cập nhật `AGENTS.md` (Project Overview, Codebase Map: live-data, supabase-source, useLiveData). Control/push vẫn ghi là pending.

## Test cases
- [x] T1. Map row → model — row DB (số dạng string, null window) map đúng thành `QuotaSnapshot`/`FeedTurn`/`Control` — tests/live-data.test.ts
  - Setup: row mẫu `quota_snapshots` với `cycle_tokens_used: '4200000'`, `window_5h_percent: null`; row log có `created_at: '2026-11-26T10:00:00.000Z'`; row control `paused`.
  - Steps: gọi `rowToSnapshot`, `rowToTurn`, `rowToControl`.
  - Assert: `cycle_tokens_used === 4200000` (number); `window_5h_percent === null`; `turn.at === Date.parse('2026-11-26T10:00:00.000Z')` và `turn.entry.agent_id` giữ nguyên; `control.global_status === 'paused'`.
- [x] T2. Reducer Realtime — sự kiện mới thay snapshot theo provider và thêm turn lên đầu, không trùng — tests/live-data.test.ts
  - Setup: list 2 snapshot (claude_code, opencode_go) và 2 turn id `a`, `b`.
  - Steps: `upsertSnapshot(list, claude mới 70%)`; `prependTurn(turns, turn c)`; `prependTurn(..., turn c lần nữa)`; `prependTurn` với max=2.
  - Assert: vẫn 2 snapshot, claude = 70, opencode giữ nguyên; turns thứ tự `c, a, b`, lần 2 không nhân đôi `c`; với max=2 độ dài là 2 và `b` bị bỏ.
- [x] T3. Hook/nguồn giả — fake `LiveSource` đẩy dữ liệu ban đầu rồi sự kiện, và unsubscribe được gọi — tests/live-data.test.ts
  - Setup: fake `LiveSource` ghi lại handlers và có `unsubscribe` là `vi.fn()`. Không render React: viết hàm thuần `startLive(source, onState): () => void` trong `live-data.ts` (dùng bởi `useLiveData`) và test hàm này.
  - Steps: gọi `startLive`, await fetch ban đầu, gọi `handlers.onControl({global_status:'paused', ...})`, rồi gọi hàm dừng.
  - Assert: state đầu có snapshots/turns/control từ fetch; sau `onControl` state.control.global_status === 'paused'; `unsubscribe` được gọi đúng 1 lần.

## Trạng thái hiện tại
- Bước 1 xong: tạo `src/lib/live-data.ts` — `LiveSource` + `LiveSourceHandlers`, row types `SnapshotRow`/`TurnRow`/`ControlRow` (bigint/timestamptz có thể là string/number/null), `rowToSnapshot`/`rowToTurn`/`rowToControl` (ép số, null-safe; `at = Date.parse(created_at)`, NaN → 0), `upsertSnapshot` (thay theo provider, giữ thứ tự), `prependTurn` (bỏ trùng id, mới nhất trước, max mặc định 200). Không đọc env, không đụng Supabase — module thuần chạy được trong Vitest Node. `opencode_windows` không map (DB không có cột này; UI đã có fallback cycle ở `src/lib/quota-cards.ts`, không sửa).
- Bước 2 xong: `src/lib/supabase-source.ts` — `createSupabaseSource(url, anonKey)` dựng `createClient`, fetch ban đầu 3 bảng bằng `.from(...).select()` (turns order `created_at` desc, limit 200; control `.eq('id', 1).limit(1)`, thiếu hàng thì trả default DB `{running, 90, 80}`), `subscribe` mở 1 channel `dashboard-live` với 3 handler `postgres_changes` `event: '*'` (bỏ qua DELETE vì `payload.new` null) map bằng hàm bước 1, trả hàm gọi `client.removeChannel`. `createReadOnlyControlApi(getControl)` thêm vào `src/lib/control-api.ts` — `updateControl` reject `Error('Chưa nối /api/control')`. `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (optional string) khai báo trong `src/vite-env.d.ts`; không tạo/sửa file `.env*` nào.
- Bước 3 xong: theo T3, thêm hàm thuần `startLive(source, onState)` + `LiveState` + `DEFAULT_CONTROL` vào `src/lib/live-data.ts` (subscribe trước rồi `Promise.allSettled` fetch ban đầu; hàm dừng idempotent gọi unsubscribe đúng 1 lần; fetch lỗi từng phần thì giữ phần còn lại). `src/hooks/useLiveData.ts`: `useLiveData(source|null)` — `null` → mock (như App cũ: `mockSnapshots`/`mockTurns` + control `{running,90,80}`); live đang fetch → state rỗng trung tính; cleanup khi unmount. `src/App.tsx`: `useMemo` tạo `createSupabaseSource` khi cả `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` có giá trị, ngược lại `null` (mock như cũ); live → `createReadOnlyControlApi` bọc control hiện tại, `CircuitBreakerControls` đặt `key` theo `global_status:auto_pause:downgrade` để Realtime cập nhật giao diện; `<main>` thêm `data-testid="data-source"` + `data-mode=live|mock`. Env chỉ đọc trong `App.tsx`, logic thuần không đụng env.
- Selectors: `data-testid="data-source"` (kèm `data-mode="live"|"mock"`) trên `<main>` và `key` trên CircuitBreakerControls (src/App.tsx); các selector cũ giữ nguyên: `#cb-warn-input`, `#cb-pause-input`, `[data-testid="cb-toggle"|"cb-save"|"cb-error"|"quota-card"|"circuit-breaker"]` (src/components/CircuitBreakerControls.tsx, src/components/QuotaHealthCards.tsx).
- Bước 4 xong: viết `tests/live-data.test.ts` đúng T1–T3 (fake `LiveSource` + hàm thuần `startLive`, không render React, không gọi Supabase/mạng). T1 map row (số string, null window, control paused); T2 upsert theo provider + prepend không trùng + max=2 bỏ `b`; T3 fetch ban đầu → state đủ snapshots/turns/control, `onControl` → paused, `unsubscribe` đúng 1 lần. Không viết test ngoài plan.
- Bước 5 xong: cập nhật `README.md` (Overview/Stack: live từ Supabase khi có env, fallback mock; Project structure thêm `live-data`, `supabase-source`, `useLiveData`; mục Dashboard mô tả fetch ban đầu + Realtime và `data-mode`; bảng env mới tách client `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (anon key, fallback mock); Commands; "Not implemented yet" chỉ còn control writes + push subscription) và `AGENTS.md` (Project Overview, App dev URL, Codebase Map `src/` thêm live-data/supabase-source/useLiveData/read-only control api). Không tạo/sửa file `.env*`. Docs checked against code; không còn câu "Realtime pending"/"mock data" sai.

## Test status
- Lần chạy cuối: `npx vitest run tests/live-data.test.ts` — 3/3 PASS (1 file); sau đó `npm run typecheck` — PASS.
- Bước 5 (docs) không có spec riêng; `npm run typecheck` — PASS.
- Kết quả từng test:
  - T1: PASS (tests/live-data.test.ts)
  - T2: PASS (tests/live-data.test.ts)
  - T3: PASS (tests/live-data.test.ts)
- Fail chi tiết: không.

## Verify
- Suite đầy đủ: 12 file / 50 test PASS; `npm run typecheck` PASS. T1–T3 PASS.
- Mở dashboard (vite cổng 4829, có `.env.local`): hiển thị dữ liệu thật từ Supabase (Claude 5h 13%, 7d 40%, 1 agent trong feed, OpenCode Go chỉ có Cycle). PASS — `.agents/screenshots/task-15-dashboard.png`.
VERIFY: PASS

## Lưu ý
- Lưu ý: khi chạy live, nếu fetch Supabase lỗi (mạng sai/env sai) dashboard hiển thị trạng thái trống trung tính chứ không tự fallback về mock; chỉ thiếu env mới dùng mock.
- Lưu ý: bảng DB không có `opencode_windows` nên card OpenCode Go khi chạy live sẽ không hiện 3 mốc 5h/7d/30d như mock (cần task riêng để lưu/ghi các mốc này).
- Lưu ý: Circuit Breaker khi chạy live chỉ hiển thị trạng thái; nút "Lưu" báo lỗi vì chưa nối `/api/control` (cần token, để task sau). Chưa đăng ký push (`/api/subscribe`).

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
