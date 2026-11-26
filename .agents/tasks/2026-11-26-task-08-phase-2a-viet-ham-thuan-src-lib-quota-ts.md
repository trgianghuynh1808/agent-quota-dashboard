# Task: Phase 2a — hàm thuần src/lib/quota.ts

APPROVED_BY_MANAGER

Verify mode: none

## Mục tiêu
Viết các hàm thuần (không mạng, không đọc đồng hồ ẩn) cho dashboard: auto-reset về 0% khi quá `reset_at`, countdown, TPM, thời gian còn lại đến giới hạn, cache ratio; kèm test Vitest.

## Ý tưởng
- Một file `src/lib/quota.ts` chỉ chứa hàm thuần, mọi hàm nhận `now` (ms) làm tham số để test xác định.
- Dùng lại type `QuotaSnapshot` từ `api/_lib/types.ts` (import type), không tạo type trùng.
- Một spec Vitest `tests/quota.test.ts` phủ các hàm, không mạng.

## Quyết định đã chốt
- `now` luôn là tham số (number, epoch ms), không gọi `Date.now()` trong hàm.
- Không đụng UI/component (thuộc T10+).

## Ngữ cảnh
- `QuotaSnapshot` (api/_lib/types.ts): `{ provider, window_5h_percent: number|null, window_7d_percent: number|null, cycle_tokens_used: number, cycle_token_limit: number|null, reset_at: string|null, updated_at: string }`.
- Spec: quá `reset_at` thì hiển thị 0% ngay, không chờ host event.
- Vitest: `include: tests/**/*.test.ts`, environment node. Import từ test theo kiểu `tests/api.test.ts` (đường dẫn tương đối, `.js` nếu file đó dùng).
- `src/lib/` chưa tồn tại, tạo mới. Code/comment tiếng Anh.
- Chữ ký cần có (export):
  - `isExpired(resetAt: string | null, now: number): boolean` — true nếu `resetAt` hợp lệ và `now > Date.parse(resetAt)`; null/không parse được → false.
  - `effectivePercent(percent: number | null, resetAt: string | null, now: number): number | null` — null→null; hết hạn→0; ngược lại giữ nguyên.
  - `effectiveCycleUsed(s: QuotaSnapshot, now: number): number` — hết hạn→0, else `cycle_tokens_used`.
  - `cyclePercent(used: number, limit: number | null): number | null` — limit null/≤0 → null; kẹp 0..100.
  - `countdown(resetAt: string | null, now: number): { totalMs: number; days: number; hours: number; minutes: number; seconds: number } | null` — null nếu không có/không parse; totalMs kẹp ≥0.
  - `formatCountdown(c: ReturnType<typeof countdown>): string` — null → `'--'`; `1h 05m`, `2d 03h`, `4m 09s`, `0s`.
  - `tokensPerMinute(samples: {at: number; tokens: number}[], now: number, windowMs = 180000): number` — tổng tokens có `at` trong `(now-windowMs, now]` chia số phút của cửa sổ; rỗng → 0.
  - `timeToLimitMs(remaining: number, tpm: number): number | null` — tpm ≤0 hoặc remaining ≤0 → null khi tpm≤0, 0 khi remaining≤0; else `remaining / tpm * 60000`.
  - `cacheRatio(cacheRead: number, totalInput: number): number | null` — totalInput ≤0 → null; else `cacheRead/totalInput` kẹp 0..1.

## Plan
- [x] 1. [vừa] `src/lib/quota.ts` → tạo file, export đủ các hàm trong "Ngữ cảnh" (`isExpired`, `effectivePercent`, `effectiveCycleUsed`, `cyclePercent`, `countdown`, `formatCountdown`, `tokensPerMinute`, `timeToLimitMs`, `cacheRatio`); `import type { QuotaSnapshot } from '../../api/_lib/types.js'`. Chạy `npm run typecheck`.
- [x] 2. [vừa] `tests/quota.test.ts` → viết spec cho T1–T3 bên dưới. Chạy đúng: `npx vitest run tests/quota.test.ts`.

## Test cases
- [x] T1. Auto-reset — quá `reset_at` thì về 0%, chưa quá thì giữ nguyên — tests/quota.test.ts
  - Setup: `now = Date.parse('2026-01-01T12:00:00Z')`; reset_at trước = `'2026-01-01T11:59:59Z'`, sau = `'2026-01-01T12:00:01Z'`.
  - Steps: gọi `effectivePercent(73, trước, now)`, `effectivePercent(73, sau, now)`, `effectivePercent(null, trước, now)`, `effectivePercent(73, null, now)`; `effectiveCycleUsed` với snapshot opencode_go `cycle_tokens_used: 5000` hết hạn / chưa.
  - Assert: 0; 73; null; 73; 0; 5000.
- [x] T2. Countdown — tách thời gian và định dạng — tests/quota.test.ts
  - Setup: cùng `now`; reset_at = now + 2d 3h, now + 1h 5m, now + 4m 9s, quá khứ, null.
  - Steps: `countdown` rồi `formatCountdown` cho từng giá trị.
  - Assert: `'2d 03h'`, `'1h 05m'`, `'4m 09s'`, `'0s'`, `'--'`; `countdown(null, now)` là null.
- [x] T3. TPM / time-to-limit / cache ratio — tests/quota.test.ts
  - Setup: samples `[{at: now-10_000, tokens: 600}, {at: now-60_000, tokens: 300}, {at: now-200_000, tokens: 9999}]`, cửa sổ mặc định 3 phút.
  - Steps: `tokensPerMinute(samples, now)` ; `timeToLimitMs(3000, 300)`; `timeToLimitMs(100, 0)`; `timeToLimitMs(0, 50)`; `cacheRatio(30, 120)`; `cacheRatio(5, 0)`; `cyclePercent(50, 200)`; `cyclePercent(1, null)`.
  - Assert: 300 (=900/3); 600000; null; 0; 0.25; null; 25; null.

## Trạng thái hiện tại
Cả 2 bước của plan đã xong, dừng theo yêu cầu (không làm bước khác). Bước 1: tạo `src/lib/quota.ts` (đủ 9 hàm export theo chữ ký trong "Ngữ cảnh", import type `QuotaSnapshot` từ `api/_lib/types.js`), `npm run typecheck` PASS. Bước 2: viết `tests/quota.test.ts` đúng T1–T3 theo Setup/Steps/Assert, chạy đúng `npx vitest run tests/quota.test.ts` — 7/7 PASS; `npm run typecheck` sau bước cũng PASS. Không có UI thay đổi nên không có dòng Selectors. File ngoài plan đã đổi: `AGENTS.md` (Codebase Map, dòng `src/`) — lý do: Documentation Rules, ghi nhận `src/lib/quota.ts` đúng như file task dự liệu; README không đổi (Phase 2 chưa có UI). Docs checked ở bước 2: không cần đổi thêm (dòng `tests/` trong AGENTS.md chỉ liệt kê ví dụ, không cần thêm `quota.test.ts`).

## Test status
- Lần chạy cuối: `npx vitest run tests/quota.test.ts` — PASS (1 file, 7 tests); `npm run typecheck` — PASS.
- Kết quả từng test:
  - T1: PASS (2 test: effectivePercent 4 case + effectiveCycleUsed 2 case)
  - T2: PASS (2 test: countdown/formatCountdown 4 mốc + null)
  - T3: PASS (3 test: tokensPerMinute, timeToLimitMs, cacheRatio/cyclePercent)
- Fail chi tiết: không có.

## Verify
(Verify mode none — bỏ qua)

## Lưu ý

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa: 0 (không có bước nào fail)
- Model dùng: opencode-go/glm-5.3
