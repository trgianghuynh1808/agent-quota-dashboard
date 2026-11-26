# Task: Hook Claude Code gửi thêm thời điểm reset 5h và 7d

APPROVED_BY_USER

Verify mode: none

## Mục tiêu
Hook Claude Code gửi cả thời điểm reset của cửa sổ 5h và 7d (`rate_limits.*.resets_at`), lưu vào `quota_snapshots`, dashboard hiện giờ reset thật cho cả hai hàng Claude thay cho "--".

## Ý tưởng
- Giữ `reset_at` hiện có = reset của 5h; thêm cột `reset_7d_at` (migration 0003) + field ingest `reset_7d_at`.
- Hook `quota-ingest.sh` đổi `seven_day.resets_at` (epoch) thành ISO và gửi kèm.
- `QuotaSnapshot` thêm `reset_7d_at`; `buildQuotaCards` dùng `reset_at` cho 5h và `reset_7d_at` cho 7d (kể cả tính auto-reset về 0%).

## Quyết định đã chốt
- Không đổi tên `reset_at` (OpenCode Go vẫn dùng). `reset_7d_at` là optional, thiếu thì hiện "--".
- Mọi thay đổi hook vẫn fail-open (không có resets_at thì bỏ field, không lỗi).

## Ngữ cảnh
- `hooks/claude-code/quota-ingest.sh`: nhánh stdin đã có `reset_at` từ `$s.rate_limits.five_hour.resets_at | todate` (khi `type == "number"`); thêm khối tương tự cho `seven_day.resets_at` → `reset_7d_at`. Nhánh `--once` không đổi.
- `api/_lib/types.ts`: `IngestBase.reset_at?: string`; `ClaudeCodeIngest` (provider claude_code); `QuotaSnapshot { reset_at: string | null; ... }`. Thêm `reset_7d_at?: string` vào `ClaudeCodeIngest` và `reset_7d_at?: string | null` vào `QuotaSnapshot` (optional để mock/OpenCode không phải đổi).
- `api/_lib/validate.ts` (~dòng 130-170): `reset_at` được validate ISO bằng `Date.parse`; nhánh `provider === 'claude_code'` dựng `ClaudeCodeIngest` — thêm đọc/validate `data.reset_7d_at` y hệt (lỗi: `'reset_7d_at must be an ISO date string'`).
- `api/_lib/supabase-db.ts`: `toSnapshot(row)` và `upsertClaudeSnapshot` (upsert `reset_at: payload.reset_at ?? null`) — thêm `reset_7d_at` cùng kiểu.
- `tests/fake-db.ts`: `upsertClaudeSnapshot` dựng snapshot — thêm `reset_7d_at: payload.reset_7d_at ?? null`.
- `supabase/migrations/`: có 0001, 0002; tạo `0003_claude_reset_7d.sql`: `alter table quota_snapshots add column if not exists reset_7d_at timestamptz;`.
- `src/lib/live-data.ts`: `SnapshotRow` + `rowToSnapshot` (dùng `toTextOrNull`) — thêm `reset_7d_at`. `supabase-source.ts` dùng `select()` (lấy hết cột), không đổi.
- `src/lib/quota-cards.ts` `buildQuotaCards`: hiện cả `claude-5h` và `claude-7d` dùng `claude.reset_at`. Đổi: 5h dùng `reset_at`, 7d dùng `reset_7d_at ?? null` cho cả `effectivePercent` và `resetText`. `resetText(null)` → `'--'`.
- `src/mock/snapshots.ts`: claude mock chỉ có `reset_at` (+2h); thêm `reset_7d_at` (+3 ngày: `now + 3 * MS_PER_DAY`).
- Test: Vitest, không cần browser. `tests/claude-hook.test.ts` có `runHook(stdin, dir, argsFile, env)`, `makeTempDirWithFakeCurl()`, `waitForArgsFile`, `argValueAfter(lines, '-d')` (lấy body JSON); `tests/quota-cards.test.ts` có helper `isoAfter(ms)`, `MS_HOUR`, `MS_DAY` và helper dựng snapshot Claude (dòng ~16-27, tham số `resetAt`). Hook test T1 hiện có sẵn tên T1, nên đặt tên test mới là `T4`/... không trùng nhãn trong describe khác nếu cần (tên `it` tự do).
- Docs: README.md dòng ~129 (ingest fields), ~298 (mapping hook), mục DB tables; AGENTS.md (Architecture/Claude hook, `quota-cards.ts`).

## Plan
- [x] 1. [dễ] `supabase/migrations/0003_claude_reset_7d.sql` → tạo migration thêm cột `reset_7d_at timestamptz` vào `quota_snapshots`.
- [x] 2. [vừa] `api/_lib/types.ts` → thêm `reset_7d_at` vào `ClaudeCodeIngest` và `QuotaSnapshot`; `api/_lib/validate.ts` → validate/đọc `reset_7d_at` cho claude_code; `api/_lib/supabase-db.ts` → `toSnapshot` + `upsertClaudeSnapshot` ghi/đọc `reset_7d_at`; `tests/fake-db.ts` → `upsertClaudeSnapshot` lưu `reset_7d_at`.
- [x] 3. [vừa] `hooks/claude-code/quota-ingest.sh` → thêm `reset_7d_at` (ISO từ `seven_day.resets_at` khi là number); `src/lib/live-data.ts` → `SnapshotRow`/`rowToSnapshot`; `src/lib/quota-cards.ts` → `buildQuotaCards` 7d dùng `reset_7d_at`; `src/mock/snapshots.ts` → thêm `reset_7d_at` mock.
- [x] 4. [vừa] `tests/claude-hook.test.ts` → viết test T1 và T2 (api ingest qua `tests/api.test.ts` nếu cần); `tests/quota-cards.test.ts` → viết T3. Chạy `npx vitest run tests/claude-hook.test.ts tests/quota-cards.test.ts tests/api.test.ts tests/live-data.test.ts` và `npm run typecheck`.
- [x] 5. [dễ] `README.md` → cập nhật mô tả field ingest `reset_7d_at`, mapping hook (`seven_day.resets_at` → `reset_7d_at`), cột bảng `quota_snapshots` và migration 0003; `AGENTS.md` → cập nhật dòng hook Claude Code và `quota-cards.ts` (7d dùng `reset_7d_at`).

## Test cases
- [x] T1. Hook gửi reset 5h và 7d — statusline có hai `resets_at` thì payload có `reset_at` và `reset_7d_at` ISO — tests/claude-hook.test.ts
  - Setup: stdin JSON `rate_limits: { five_hour: { used_percentage: 12.5, resets_at: 1790000000 }, seven_day: { used_percentage: 40, resets_at: 1790500000 } }`, `model.id`, `session_id`.
  - Steps: 1. `runHook` với fake curl · 2. đọc body sau `-d` · 3. `parseIngestPayload`.
  - Assert: `parsed.ok` true; `reset_at === new Date(1790000000*1000).toISOString()` (jq `todate` không có ms: so với `new Date(1790000000000).toISOString().replace('.000Z','Z')`); `reset_7d_at` tương tự từ 1790500000. Trường hợp thiếu `seven_day.resets_at`: body không có `reset_7d_at`, vẫn exit 0.
- [x] T2. Ingest lưu `reset_7d_at` — API ingest claude_code lưu và trả lại `reset_7d_at`, từ chối giá trị không phải ISO — tests/api.test.ts
  - Setup: `FakeDb` mới, handler `createIngestHandler` như các test claude_code sẵn có (xem dòng ~130).
  - Steps: 1. POST body claude_code kèm `reset_at` + `reset_7d_at` ISO · 2. gọi `db.getSnapshots()` hoặc cách test cũ đọc snapshot · 3. POST với `reset_7d_at: 'abc'`.
  - Assert: snapshot claude có `reset_7d_at` đúng; request thứ hai trả 400.
- [x] T3. Dashboard dùng reset riêng cho 7d — `buildQuotaCards` hiện countdown 7d từ `reset_7d_at`, thiếu thì "--" — tests/quota-cards.test.ts
  - Setup: `now` cố định; snapshot claude `reset_at = isoAfter(2*MS_HOUR)`, `reset_7d_at = isoAfter(5*MS_DAY)`, percent 5h/7d tùy ý.
  - Steps: 1. `buildQuotaCards` · 2. lặp với snapshot không có `reset_7d_at`.
  - Assert: bar `claude-5h.resetText === '2h 00m'`, `claude-7d.resetText === '5d 00h'`; không có `reset_7d_at` thì `claude-7d.resetText === '--'`.

## Trạng thái hiện tại
- Bước 1 xong: thêm `supabase/migrations/0003_claude_reset_7d.sql` (`alter table quota_snapshots add column if not exists reset_7d_at timestamptz;`). Typecheck pass; bước này không có UI, không có spec riêng. Không có Playwright config trong repo.
- Bước 2 xong: `reset_7d_at` optional ở `ClaudeCodeIngest` + `QuotaSnapshot`; `validate.ts` đọc/validate ISO cho claude_code (lỗi `reset_7d_at must be an ISO date string`); `supabase-db.ts` `toSnapshot` + `upsertClaudeSnapshot`; `fake-db.ts` lưu `reset_7d_at`. Typecheck pass.
- Bước 3 xong: hook gửi `reset_7d_at`; `live-data.ts` map cột; `quota-cards.ts` hàng 7d dùng `reset_7d_at` (reset/auto-reset); mock claude có `reset_7d_at` (+3 ngày). `SnapshotRow.reset_7d_at` để optional (không bắt buộc) vì fixture hiện có trong `tests/live-data.test.ts` không set cột này và plan không cho sửa file đó.
- Bước 4 xong: test mới `T4: sends both the 5h and 7d reset timestamps` + `T5: omits reset_7d_at` (tests/claude-hook.test.ts, nhãn T4/T5 để không trùng T1/T2 sẵn có theo gợi ý trong plan); test API `T4: claude reset_7d_at` (tests/api.test.ts); test `T4: dùng reset_7d_at riêng cho hàng 7d` (tests/quota-cards.test.ts). Phải sửa fixture ca "quá reset_at" sẵn có trong quota-cards.test.ts (truyền thêm `reset_7d_at` đã hết hạn) vì hàng 7d giờ dựa vào `reset_7d_at`, nếu không ca đó fail.
- Bước 5 xong: README cập nhật cấu trúc migrations, lệnh paste/`db push`, mô tả cột `quota_snapshots`, field ingest `reset_7d_at` (+ ví dụ), mapping hook `seven_day.resets_at` → `reset_7d_at`; AGENTS.md cập nhật dòng hook Claude Code, `quota-cards.ts` và migrations. Docs checked: đã cập nhật README + AGENTS.md.
- Lưu ý: `SnapshotRow.reset_7d_at` là optional thay vì bắt buộc (khác chữ trong plan) để không phải sửa fixture `tests/live-data.test.ts`.
- Lưu ý: nhãn test mới dùng T4/T5 (không phải T1/T2) để tránh trùng nhãn đã có trong cùng file; đã sửa fixture ca "quá reset_at" của quota-cards.test.ts cho khớp hành vi 7d mới.

## Test status
- Lần chạy cuối: bước 5 – `npm run typecheck` PASS (bước docs, không có test riêng)
- Kết quả từng test:
  - T1: PASS (tests/claude-hook.test.ts — `T4: sends both the 5h and 7d reset timestamps when present`)
  - T2: PASS (tests/api.test.ts — `T4: claude reset_7d_at`)
  - T3: PASS (tests/quota-cards.test.ts — `T4: dùng reset_7d_at riêng cho hàng 7d, thiếu thì "--"`)
- Fail chi tiết:

## Verify
Verify mode none: typecheck + vitest (54 test) PASS, diff khớp plan.

VERIFY: PASS

## Lưu ý
- Lưu ý: cần chạy migration `0003_claude_reset_7d.sql` trên Supabase thật (`supabase db push`) trước khi hook mới ghi được `reset_7d_at`; thiếu cột thì upsert Claude sẽ lỗi.

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
