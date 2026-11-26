# Task: T22 — OpenCode Go hiện đúng 3 mốc 5h/tuần/tháng từ console

APPROVED_BY_USER

Verify mode: light

## Mục tiêu
- Script `hooks/opencode/set-quota.sh <5h|7d|30d> <percent> <reset_iso>` ghi mốc quota thật của OpenCode Go (đọc từ console) vào Supabase qua `/api/ingest`.
- Dashboard đọc `opencode_windows` từ Supabase và luôn hiện 3 hàng 5h / 7d / 30d kèm giờ reset thật; bỏ hàng "Cycle" ước lượng.

## Ý tưởng
- Thêm cột jsonb `opencode_windows` vào `quota_snapshots` (migration 0004); `/api/ingest` nhận payload `opencode_go` kèm `window_id` + `window_percent` + `reset_at`, gộp vào mảng windows (không tăng token, không ghi log).
- `rowToSnapshot` map `opencode_windows`; `buildQuotaCards` luôn trả 3 hàng OpenCode (thiếu mốc → `--`), bỏ nhánh fallback `opencode-cycle`.
- Script bash mỏng giống `quota-ingest.sh` (curl + jq, fail-open) để người dùng gõ tay số từ console.

## Quyết định đã chốt
- Nhập tay qua script (không scrape console).
- Auto-pause của OpenCode dùng max percent các mốc nếu có windows, ngược lại giữ cách cũ (cycle tokens/limit).

## Ngữ cảnh
- `api/_lib/types.ts` đã có `OpencodeWindow { id: '5h'|'7d'|'30d'; percent: number; reset_at: string }` và `QuotaSnapshot.opencode_windows?: OpencodeWindow[]`. `OpencodeGoIngest` hiện: `delta_tokens: number; cycle_token_limit?: number` (+ `reset_at?` từ IngestBase).
- `Db` interface (types.ts) có `incrementOpencode`, `upsertClaudeSnapshot`, `listSnapshots`... Cần thêm `setOpencodeWindow(window: OpencodeWindow): Promise<QuotaSnapshot>`.
- `api/_lib/supabase-db.ts`: `toSnapshot(row)` chưa map `opencode_windows`; `createSupabaseDb()` trả object các method. Cách làm: select hàng `opencode_go` hiện có, merge window theo `id`, upsert `{provider:'opencode_go', opencode_windows, updated_at}` (upsert theo `provider` như `upsertClaudeSnapshot`; cột khác giữ nguyên vì upsert chỉ ghi cột có mặt). Đừng đụng `reset_at`/cycle.
- `api/_lib/validate.ts` `parseIngestPayload`: nhánh opencode hiện bắt buộc `delta_tokens`. `reset_at` đã được parse chung (ISO). Thêm field tùy chọn `window_id` (`'5h'|'7d'|'30d'`) + `window_percent` (0..100, dùng `isPercent`); khi có `window_id` thì bắt buộc `window_percent` và `reset_at`, và `delta_tokens` mặc định 0 (không bắt buộc). Giữ nguyên hành vi cũ khi không có `window_id`.
- `api/_lib/ingest.ts` `processIngest`: khi payload là opencode có `window_id` → KHÔNG `insertLog`, gọi `db.setOpencodeWindow(...)`; `usagePercent` cho opencode: nếu `snapshot.opencode_windows?.length` → max percent (đã bỏ qua window hết hạn không cần), ngược lại logic cũ.
- `tests/fake-db.ts` `FakeDb implements Db`: thêm `setOpencodeWindow` (merge theo id vào snapshot `opencode_go`, giữ các field khác).
- Migration mới `supabase/migrations/0004_opencode_windows.sql`: `alter table quota_snapshots add column if not exists opencode_windows jsonb;` (policy select của 0002 đã áp cho cả bảng, Realtime không cần đổi).
- `src/lib/live-data.ts`: `SnapshotRow` thêm `opencode_windows?: unknown`; `rowToSnapshot` map sang `OpencodeWindow[]` (lọc phần tử sai: id không thuộc 5h/7d/30d, percent không phải số, reset_at không phải string); trả `opencode_windows` chỉ khi mảng không rỗng.
- `src/lib/quota-cards.ts` `buildQuotaCards`: đã có `OPENCODE_WINDOWS` + nhánh khi `windows.length > 0`. Sửa: luôn dùng nhánh này (windows mặc định `[]`), xóa nhánh fallback `opencode-cycle` và các import chỉ nó dùng (`cyclePercent`, `effectiveCycleUsed`) nếu hết dùng. Thiếu mốc → `percent: null`, `resetText: '--'`.
- `tests/quota-cards.test.ts` đang kỳ vọng `opencode-cycle` ở dòng ~53, ~121, ~155: cập nhật sang 3 hàng `opencode-5h|7d|30d`.
- Mẫu script + test: `hooks/claude-code/quota-ingest.sh` (env `APP_URL`, `INGEST_API_KEY`, `jq`, `curl ... &`, fail-open exit 0) và `tests/claude-hook.test.ts` (fake `curl` trên PATH ghi args vào `FAKE_CURL_LOG`, `spawnSync('bash',[SCRIPT,...])`, `waitForArgsFile`, skip nếu không có jq, import `parseIngestPayload` để kiểm payload hợp lệ). Test chạy Vitest Node, không import được `src/` Vite-only module (`virtual:pwa-register`).
- Script `set-quota.sh`: `agent_id` mặc định `opencode-console`; payload `{provider:"opencode_go", agent_id, window_id, window_percent (số), reset_at}`; sai tham số (id ngoài 5h/7d/30d, percent không phải số 0..100, thiếu reset_iso) → in usage ra stderr, exit 0 hoặc 2? Chọn: in usage + exit 2 cho lỗi tham số (khác quota-ingest vì chạy tay), vẫn exit 0 khi thiếu env/jq/curl kèm thông báo stderr.
- Dễ đoán nhầm: `reset_at` trong payload là reset của chính window đó (không phải 5h reset cũ của snapshot); `delta_tokens` bị bỏ khi có `window_id`.
- Mock `src/mock/snapshots.ts` đã có `opencode_windows`, không sửa.

## Plan
- [x] 1. [vừa] `supabase/migrations/0004_opencode_windows.sql` → thêm cột jsonb `opencode_windows`; `api/_lib/types.ts` → thêm `setOpencodeWindow(window: OpencodeWindow)` vào `Db` và field `window_id?: OpencodeWindow['id']; window_percent?: number` vào `OpencodeGoIngest` (`delta_tokens` thành optional-theo-logic: giữ `number`, validate gán 0); `api/_lib/supabase-db.ts` → `toSnapshot` map `opencode_windows`, thêm `setOpencodeWindow` (đọc hàng cũ, merge theo id, upsert).
- [x] 2. [vừa] `api/_lib/validate.ts` → `parseIngestPayload`: nhận `window_id`/`window_percent` như mô tả; `api/_lib/ingest.ts` → `processIngest`: nhánh window (không log, gọi `setOpencodeWindow`) và `usagePercent` theo max windows; `tests/fake-db.ts` → `FakeDb.setOpencodeWindow` (đã thêm sớm ở bước 1, xem Lưu ý).
- [x] 3. [vừa] `src/lib/live-data.ts` → `SnapshotRow.opencode_windows` + `rowToSnapshot` map/lọc; `src/lib/quota-cards.ts` → `buildQuotaCards` luôn 3 hàng OpenCode, bỏ fallback `opencode-cycle` và import thừa; `tests/quota-cards.test.ts` → sửa các kỳ vọng `opencode-cycle` cho khớp.
- [x] 4. [dễ] `hooks/opencode/set-quota.sh` → script `#!/usr/bin/env bash` có usage header, `set -uo pipefail`, kiểm tham số, build payload bằng `jq -n --arg/--argjson`, `curl --max-time 5 -X POST "$APP_URL/api/ingest"` đồng bộ (chạy tay nên chờ kết quả, in `ok`/lỗi), `chmod +x`.
- [x] 5. [vừa] `tests/api.test.ts` → thêm `describe('T22 ...')` cho T1; `tests/quota-cards.test.ts` → thêm case cho T2; `tests/opencode-set-quota.test.ts` (mới) → T3. Chạy: `npx vitest run tests/api.test.ts tests/quota-cards.test.ts tests/opencode-set-quota.test.ts` rồi `npm run typecheck`.
- [x] 6. [dễ] `README.md` + `AGENTS.md` → cập nhật: field `window_id`/`window_percent` của `/api/ingest`, behavior mới, bảng `quota_snapshots.opencode_windows` + migration `0004`, mục dùng `set-quota.sh` (cấu trúc thư mục `hooks/opencode/`), quota card OpenCode luôn 3 hàng (bỏ nhắc "Cycle"); sửa dòng `Codebase Map` nói về `buildQuotaCards`/`rowToSnapshot`. Ghi "Docs checked" vào Trạng thái hiện tại.

## Test cases
- [x] T1. Ingest window OpenCode — `window_id` được validate, lưu vào snapshot, không ghi log, không đụng token — tests/api.test.ts
  - Setup: `FakeDb`, handler `createIngestHandler` như các test T2/T4 hiện có; reset time `2026-12-01T00:00:00.000Z`.
  - Steps: 1. POST `{provider:'opencode_go', agent_id:'a', window_id:'5h', window_percent:35, reset_at:<iso>}` · 2. POST `window_id:'7d', window_percent:58` với reset khác · 3. POST lại `5h` với percent 40 · 4. POST `window_id:'1h'` và `window_id:'5h'` thiếu `window_percent`.
  - Assert: 1–3 trả 200; `db.logs.length === 0`; `listSnapshots()` opencode_windows có đúng 2 phần tử, `5h.percent === 40`, `7d.percent === 58`, `reset_at` đúng; 4 trả 400 và windows không đổi.
- [x] T2. Quota card luôn 3 hàng OpenCode — không còn `opencode-cycle`, mốc thiếu hiện `--`, mapper đọc đúng jsonb — tests/quota-cards.test.ts
  - Setup: snapshot opencode không có `opencode_windows`; snapshot khác có đủ 3 windows; row giả cho `rowToSnapshot` (import từ `src/lib/live-data.ts`) có `opencode_windows` gồm 1 phần tử hợp lệ + 1 phần tử id sai.
  - Steps: 1. `buildQuotaCards` với snapshot không windows · 2. với snapshot đủ 3 windows (now trước reset) · 3. `rowToSnapshot(row)`.
  - Assert: cả hai lần ids opencode = `['opencode-5h','opencode-7d','opencode-30d']`, không có `opencode-cycle`; lần 1 percent `null` + resetText `--`; lần 2 percent theo windows; mapper chỉ giữ phần tử hợp lệ.
- [x] T3. set-quota.sh gửi đúng payload — script build payload hợp lệ và từ chối tham số sai — tests/opencode-set-quota.test.ts
  - Setup: fake `curl` trên PATH ghi args (copy helper từ `tests/claude-hook.test.ts`), env `APP_URL=https://example.test`, `INGEST_API_KEY=k`; skip nếu không có `jq`.
  - Steps: 1. chạy `bash set-quota.sh 7d 58 2026-12-01T00:00:00Z` · 2. đọc args fake curl, lấy body sau `-d`, đưa qua `parseIngestPayload` · 3. chạy với `1h 10 <iso>` và với `5h abc <iso>`.
  - Assert: args chứa `https://example.test/api/ingest` và `Authorization: Bearer k`; `parseIngestPayload` ok với `provider:'opencode_go'`, `window_id:'7d'`, `window_percent:58`, `reset_at` đúng; 2 lệnh sau exit status ≠ 0 và fake curl không được gọi.

## Trạng thái hiện tại
<!-- Bước giao diện không có (UI chỉ đổi dữ liệu); không có dòng Selectors. -->
- Bước 1 xong: migration `0004_opencode_windows.sql` (cột jsonb `opencode_windows`); `Db.setOpencodeWindow` + `OpencodeGoIngest.window_id`/`window_percent` (api/_lib/types.ts); `toSnapshot` map `opencode_windows` + `setOpencodeWindow` đọc hàng cũ, merge theo id, upsert theo `provider` (api/_lib/supabase-db.ts). `npm run typecheck` PASS.
- Lưu ý: `tests/fake-db.ts` (plan đặt ở bước 2) đã được thêm `setOpencodeWindow` sớm ở bước 1 — nếu không, `FakeDb implements Db` (thiếu method mới của `Db`) làm typecheck fail; nội dung đúng mô tả bước 2 (merge theo id, giữ nguyên field khác).
- Bước 2 xong: `parseIngestPayload` nhận `window_id` ('5h'|'7d'|'30d') + `window_percent` (0..100); có `window_id` thì bắt buộc `window_percent` + `reset_at`, `delta_tokens` gán 0, không có thì giữ nguyên hành vi cũ (api/_lib/validate.ts); `processIngest` nhánh window không ghi log, gọi `db.setOpencodeWindow`, auto-pause vẫn chạy chung; `usagePercent` opencode dùng max percent windows nếu có, ngược lại cycle cũ (api/_lib/ingest.ts).
- Bước 3 xong: `SnapshotRow.opencode_windows` + `rowToSnapshot` lọc phần tử hợp lệ (id 5h/7d/30d, percent số, reset_at string; chỉ trả khi mảng không rỗng) (src/lib/live-data.ts); `buildQuotaCards` luôn trả 3 hàng `opencode-5h|7d|30d` (windows mặc định `[]`, thiếu mốc → percent `null` + `'--'`), bỏ nhánh fallback `opencode-cycle` + import `cyclePercent`/`effectiveCycleUsed` (src/lib/quota-cards.ts); `tests/quota-cards.test.ts` cập nhật 3 chỗ kỳ vọng `opencode-cycle` sang 3 hàng mới.
- Selectors: data-testid `quota-row-opencode-5h`, `quota-row-opencode-7d`, `quota-row-opencode-30d` (src/components/QuotaHealthCards.tsx, id sinh từ src/lib/quota-cards.ts; hàng cũ `quota-row-opencode-cycle` không còn).
- Bước 4 xong: `hooks/opencode/set-quota.sh` (dùng tay, `chmod +x`) nhận `<5h|7d|30d> <percent 0..100> <reset_iso>`, `agent_id` mặc định `opencode-console`, build payload `{provider:"opencode_go", agent_id, window_id, window_percent, reset_at}` bằng `jq -nc --arg/--argjson`, POST đồng bộ `curl --max-time 5` tới `$APP_URL/api/ingest` kèm `Authorization: Bearer`; in `ok`/lỗi + HTTP code. Tham số sai → usage ra stderr, exit 2; thiếu env/`jq`/`curl` → cảnh báo stderr, exit 0; lỗi mạng/HTTP → exit 1. Không đổi UI nên không có dòng Selectors mới. `node --check` không áp dụng; đã thử `bash -n` OK, tham số sai exit 2, thiếu env exit 0. `npm run typecheck` PASS.
- Lưu ý: không có Playwright spec cho bước này vì chỉ thêm script bash, không đổi giao diện; test hành vi script thuộc T3 ở bước 5.
- Bước 5 xong: `tests/api.test.ts` thêm `describe('T22: opencode quota windows')` cho T1 (5h/7d/gửi lại 5h → 200, `window_id:'1h'` và thiếu `window_percent` → 400, `db.logs` rỗng, `cycle_tokens_used` không đổi, windows đúng 2 phần tử với percent 40/58 và reset đúng); `tests/quota-cards.test.ts` thêm case T2 (snapshot không windows → 3 hàng `opencode-5h|7d|30d` percent `null` + `'--'`, đủ 3 windows → percent theo mốc, không còn `opencode-cycle`, `rowToSnapshot` chỉ giữ phần tử hợp lệ khi jsonb có 1 phần tử id sai); `tests/opencode-set-quota.test.ts` (mới) cho T3 (fake `curl` trên PATH copy từ `tests/claude-hook.test.ts`, env `APP_URL=https://example.test`/`INGEST_API_KEY=k`, payload sau `-d` qua `parseIngestPayload` ok với `window_id:'7d'`/`window_percent:58`/`reset_at` đúng, `1h 10` và `5h abc` exit ≠ 0 và không gọi curl; `describe.skipIf` khi thiếu `jq`). `npx vitest run tests/api.test.ts tests/quota-cards.test.ts tests/opencode-set-quota.test.ts` → 3 files 19/19 PASS; `npm run typecheck` PASS. Bước viết test cho logic thuần, không đổi UI nên không có dòng Selectors mới.
- Bước 6 xong: `README.md` cập nhật field `window_id`/`window_percent` + hành vi ingest window (không log, không đụng token), ví dụ `curl` window, cột `quota_snapshots.opencode_windows` + migration `0004` trong Database/macOS guide, mục "OpenCode Go quota windows (`set-quota.sh`)" (cách dùng, exit code), quota card OpenCode luôn 3 hàng (`--` khi thiếu), burn-rate ghi rõ time-to-limit cần `cycle_token_limit`, cấu trúc `hooks/opencode/set-quota.sh`. `AGENTS.md` cập nhật Project Overview, Architecture (opencode_windows/`setOpencodeWindow`, window ingest, auto-pause max windows), OpenCode Go section (`set-quota.sh`), Codebase Map (`hooks/opencode/`, `tests/`, migrations `0004`, `buildQuotaCards` luôn 3 hàng, `rowToSnapshot` map `opencode_windows`). Docs checked: README + AGENTS.md đã đối chiếu code, không còn chỗ nào nhắc hàng "Cycle" của OpenCode. `npm run typecheck` PASS; không có Playwright spec (chỉ sửa tài liệu, không đổi UI).

## Test status
- Lần chạy cuối: bước 6 — `npm run typecheck` PASS; không có lệnh test nào trong bước (chỉ sửa tài liệu) nên không chạy lại Vitest, kết quả T1–T3 giữ nguyên từ bước 5. Không có Playwright spec (bước không đổi UI).
- Kết quả từng test:
  - T1: PASS (tests/api.test.ts — describe 'T22: opencode quota windows')
  - T2: PASS (tests/quota-cards.test.ts — case T2 trong describe 'buildQuotaCards')
  - T3: PASS (tests/opencode-set-quota.test.ts)
- Fail chi tiết:

## Verify
- Toàn bộ Vitest: 13 files / 57 tests PASS; `npm run typecheck` PASS (T1–T3 PASS).
- Visual (mock mode, cổng 4899): card OpenCode có đúng 3 hàng `opencode-5h|7d|30d` (35% / 58% / 82%), không còn hàng cycle. Ảnh: `.agents/screenshots/task-22-opencode-3-rows.png`.

VERIFY: PASS

## Lưu ý
- Lưu ý: cần chạy migration `0004_opencode_windows.sql` trên Supabase (`supabase db push` hoặc SQL editor) trước khi dùng `set-quota.sh` thật.
- Lưu ý: spec T3 (bước 5) không assert exit status của lệnh chạy đúng vì fake curl (copy theo plan từ tests/claude-hook.test.ts) không trả HTTP code nên script báo lỗi và exit 1; plan chỉ yêu cầu assert args + payload hợp lệ — hành vi exit 0 khi HTTP 2xx đã kiểm tra tay ở bước 4.

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
