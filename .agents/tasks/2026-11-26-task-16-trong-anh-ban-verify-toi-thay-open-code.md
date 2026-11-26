# Task: T16 — OpenCode Go hiển thị 3 mốc limit (5h / tuần / tháng) kèm thời điểm reset

APPROVED_BY_USER

Verify mode: light

## Mục tiêu
Dashboard của OpenCode Go hiện chỉ có một thẻ "Cycle". Dashboard gốc của OpenCode có 3 chỉ số limit: 5 giờ, tuần, tháng, mỗi mốc có % đã dùng và thời điểm reset riêng. Hiển thị đủ 3 thẻ như vậy (dữ liệu mock, phía backend/DB chưa đổi).

## Ý tưởng
- Thêm field tuỳ chọn `opencode_windows` vào `QuotaSnapshot` (mỗi mốc: id `5h|7d|30d`, `percent`, `reset_at`); không đổi Db/migration nên API và FakeDb không bị ảnh hưởng.
- `buildQuotaCards` sinh 3 bar `opencode-5h`, `opencode-7d`, `opencode-30d` (mỗi bar dùng reset riêng, về 0% khi quá reset); nếu snapshot không có `opencode_windows` thì giữ thẻ `opencode-cycle` cũ.
- Cập nhật mock để có 3 mốc; `QuotaHealthCards` vẫn render theo mảng bars nên không cần đổi.

## Quyết định đã chốt
- Chỉ làm phía dashboard + mock; chưa lưu 3 mốc vào Supabase hay plugin ingest (việc sau).

## Ngữ cảnh
- `api/_lib/types.ts`: `interface QuotaSnapshot { provider; window_5h_percent; window_7d_percent; cycle_tokens_used; cycle_token_limit; reset_at; updated_at }`.
- `src/lib/quota-cards.ts`: `buildQuotaCards(snapshots, now): QuotaBar[]` trả hiện 3 bar `claude-5h`, `claude-7d`, `opencode-cycle`; `QuotaBar = { id, label, percent, level, resetText }`; helper `levelFor`, `resetText(resetAt, now)`; từ `./quota.js` có `effectivePercent(percent, resetAt, now)`, `cyclePercent`, `effectiveCycleUsed`.
- `src/mock/snapshots.ts`: `mockSnapshots(now)` trả [claude, opencode]; opencode hiện `cycle_tokens_used 4_200_000`, `cycle_token_limit 10_000_000`, reset +5 ngày.
- `src/components/QuotaHealthCards.tsx` map `bars` → thẻ `data-testid="quota-card-${bar.id}"`, progressbar `aria-label=bar.label`, chữ "Reset in …".
- `tests/quota-cards.test.ts` (Vitest) có T1 kỳ vọng ids `['claude-5h','claude-7d','opencode-cycle']` với snapshot opencode KHÔNG có `opencode_windows` → phải vẫn pass (fallback). Helper trong file: `claudeSnapshot`, `opencodeSnapshot`, `isoAfter`, `NOW`.
- Không có Playwright; test là Vitest, chạy trong Node. Thứ tự bar mong muốn: claude-5h, claude-7d, opencode-5h, opencode-7d, opencode-30d.
- Sau khi xong cập nhật `AGENTS.md` (Codebase Map mô tả `quota-cards.ts`/mock) nếu câu chữ sai.

## Plan
- [x] 1. [dễ] `api/_lib/types.ts` → thêm `export interface OpencodeWindow { id: '5h' | '7d' | '30d'; percent: number; reset_at: string }` và field tuỳ chọn `opencode_windows?: OpencodeWindow[]` vào `QuotaSnapshot`; `src/mock/snapshots.ts` → `mockSnapshots`: thêm `opencode_windows` cho snapshot opencode (5h: 35% reset +3h; 7d: 58% reset +4d; 30d: 82% reset +19d; giữ các field cũ).
- [x] 2. [vừa] `src/lib/quota-cards.ts` → `buildQuotaCards`: nếu `opencode?.opencode_windows` có phần tử thì thay bar `opencode-cycle` bằng 3 bar `opencode-5h` ("OpenCode Go · 5h"), `opencode-7d` ("OpenCode Go · 7d"), `opencode-30d` ("OpenCode Go · 30d") theo đúng thứ tự mốc, mỗi bar: `percent = effectivePercent(w.percent, w.reset_at, now)`, `level = levelFor(percent)`, `resetText = resetText(w.reset_at, now)`; mốc thiếu trong mảng → bar `percent null`, `resetText '--'`. Không có `opencode_windows` → giữ nguyên bar `opencode-cycle` như cũ. Chạy `npm run typecheck`.
- [x] 3. [vừa] `tests/quota-cards.test.ts` → thêm test T1 (xem Test cases), chạy `npx vitest run tests/quota-cards.test.ts`. Sau đó kiểm tra `AGENTS.md`/`README.md` có chỗ mô tả thẻ OpenCode "Cycle" cần sửa, ghi "Docs checked" vào Trạng thái hiện tại.

## Test cases
- [x] T1. OpenCode Go 3 mốc — 3 bar có percent/level/reset riêng, quá reset về 0%, thiếu windows thì fallback — tests/quota-cards.test.ts
  - Setup: `claudeSnapshot(62, 91, isoAfter(2*MS_HOUR))` + snapshot opencode (từ `opencodeSnapshot`) thêm `opencode_windows: [{id:'5h',percent:35,reset_at:isoAfter(3*MS_HOUR)},{id:'7d',percent:85,reset_at:isoAfter(4*MS_DAY)},{id:'30d',percent:95,reset_at:isoAfter(-1000)}]`
  - Steps: 1. `buildQuotaCards([claude, opencode], NOW)` · 2. lần hai với `opencode` không có `opencode_windows`
  - Assert: lần 1 ids = `['claude-5h','claude-7d','opencode-5h','opencode-7d','opencode-30d']`; percent 3 bar opencode = `[35, 85, 0]`; level = `['ok','warn','ok']`; resetText bar 5h = `'3h 00m'`, 7d = `'4d 00h'`. Lần 2 ids kết thúc bằng `'opencode-cycle'` (3 bar tổng).

## Trạng thái hiện tại
- Bước 1 xong: thêm `OpencodeWindow` + `opencode_windows?` vào `QuotaSnapshot`; mock opencode có 5h 35% (+3h), 7d 58% (+4d), 30d 82% (+19d). `npm run typecheck` pass.
- Bước 2 xong: `buildQuotaCards` sinh `opencode-5h/-7d/-30d` khi có `opencode_windows`, mốc thiếu → percent null / resetText `--`; không có → giữ `opencode-cycle`. `npm run typecheck` pass.
- Selectors: `[data-testid="quota-card-${bar.id}"]`, `[role="progressbar"]` với `aria-label=bar.label` (src/components/QuotaHealthCards.tsx); bar ids mới `opencode-5h`, `opencode-7d`, `opencode-30d` (src/lib/quota-cards.ts).
- Bước 3 xong: thêm test T1 (opencode windows) vào `tests/quota-cards.test.ts`. `npx vitest run tests/quota-cards.test.ts` 3/3 PASS (T1, T2 cũ + T1 mới); `npm run typecheck` PASS. Docs checked: `AGENTS.md` (mô tả `buildQuotaCards` chung chung, vẫn đúng) và `README.md` (không nhắc "Cycle") — không cần sửa.
- Lưu ý: `docs/SPEC.md:101` vẫn ghi "OpenCode Go Cycle", chưa phản ánh 3 mốc 5h/7d/30d; ngoài phạm vi plan bước 3 (chỉ kiểm AGENTS.md/README.md), để task docs riêng cập nhật.

## Test status
- Lần chạy cuối: bước 3 — `npx vitest run tests/quota-cards.test.ts` PASS (3/3), `npm run typecheck` PASS
- Kết quả từng test:
  - T1: PASS (OpenCode Go 3 mốc: ids/percent/level/resetText + quá reset về 0% + fallback `opencode-cycle`)
- Fail chi tiết:

## Verify
- Suite: typecheck + 46 test PASS.
- T1 PASS; giao diện hiển thị 3 thẻ OpenCode Go 5h/7d/30d kèm reset riêng: PASS (`.agents/screenshots/task-16-opencode-3-windows.png`).

VERIFY: PASS

## Lưu ý
- Lưu ý: chỉ làm dashboard + mock; 3 mốc chưa được lưu vào Supabase hay gửi từ plugin OpenCode, cần task riêng để lấy dữ liệu thật.

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
