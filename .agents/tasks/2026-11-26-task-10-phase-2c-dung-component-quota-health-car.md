# Task: T10 Phase 2c — Quota Health Cards (mock data, Bento Grid mobile-first)

APPROVED_BY_MANAGER

Verify mode: light

## Mục tiêu
Dựng component Quota Health Cards: progress bar Claude Code 5h / 7d và OpenCode Go cycle, countdown tới `reset_at`, tự hiển thị 0% khi quá `reset_at`; dùng mock data, bố cục Bento Grid mobile-first.

## Ý tưởng
- Một hàm thuần `buildQuotaCards(snapshots, now)` trong `src/lib/quota-cards.ts` biến `QuotaSnapshot[]` thành view-model (label, percent, countdown text) bằng helper có sẵn trong `src/lib/quota.ts`.
- Component `QuotaHealthCards` nhận `snapshots` + `now` qua props, tự tick mỗi giây bằng hook `useNow`; mock data nằm ở `src/mock/snapshots.ts`.
- `App.tsx` render lưới Bento (1 cột mobile, 3 cột từ `md`) với Quota cards làm ô đầu; màu thanh đổi theo ngưỡng (xanh <80, vàng 80–89, đỏ ≥90).

## Quyết định đã chốt
- Không thêm thư viện (không jsdom, không Playwright): test chỉ cho logic thuần bằng Vitest.
- Component nhận dữ liệu qua props để Phase 2h thay mock bằng Realtime dễ dàng.

## Ngữ cảnh
- `QuotaSnapshot` (`api/_lib/types.ts`): `{ provider: Provider; window_5h_percent: number|null; window_7d_percent: number|null; cycle_tokens_used: number; cycle_token_limit: number|null; reset_at: string|null; updated_at: string }`. Provider có `'claude_code' | 'opencode_go'`.
- Helper trong `src/lib/quota.ts` (đều nhận `now` ms): `effectivePercent(percent, resetAt, now): number|null` (0 nếu quá reset), `effectiveCycleUsed(s, now)`, `cyclePercent(used, limit): number|null`, `countdown(resetAt, now): Countdown|null`, `formatCountdown(c): string` ("--" nếu null).
- Import từ `src/` sang `api/_lib/types.js` dùng `import type` với đuôi `.js` (xem đầu `src/lib/quota.ts`).
- Hiện `src/App.tsx` chỉ có `<h1>`; Tailwind v4 qua `@import "tailwindcss"` trong `src/index.css`. Không có jsdom/Playwright; Vitest chạy môi trường Node nên test không render React.
- Claude Code snapshot dùng `window_5h_percent`/`window_7d_percent` (chung một `reset_at` cho hiển thị countdown); OpenCode Go dùng cycle used/limit + `reset_at`.
- `npm run typecheck` phủ src, api, tests.

## Plan
- [x] 1. [dễ] `src/mock/snapshots.ts` → export `mockSnapshots(now: number): QuotaSnapshot[]`: 1 snapshot `claude_code` (5h 62%, 7d 91%, reset_at = now + 2h) và 1 `opencode_go` (used 4_200_000 / limit 10_000_000, reset_at = now + 5 ngày).
- [x] 2. [vừa] `src/lib/quota-cards.ts` → export `type QuotaBar = { id: string; label: string; percent: number | null; level: 'ok'|'warn'|'critical'|'unknown'; resetText: string }` và `buildQuotaCards(snapshots: QuotaSnapshot[], now: number): QuotaBar[]`. Trả 3 bar theo thứ tự: `claude-5h`, `claude-7d`, `opencode-cycle`; dùng `effectivePercent`, `cyclePercent` + `effectiveCycleUsed`, `countdown`, `formatCountdown`; snapshot thiếu → bar `percent: null`, `level: 'unknown'`, `resetText: '--'`. Level: `<80` ok, `80–<90` warn, `>=90` critical. Quá reset_at → percent 0, level ok.
- [x] 3. [vừa] `src/components/QuotaHealthCards.tsx` + `src/hooks/useNow.ts` + `src/App.tsx`: `useNow(intervalMs = 1000)` trả `Date.now()` cập nhật bằng setInterval (có cleanup). `QuotaHealthCards({ snapshots, now })` render mỗi bar thành card (label, `%` hoặc "--", thanh `role="progressbar"` với `aria-valuenow`, `resetText`). `App` lưới `grid grid-cols-1 gap-4 p-4 md:grid-cols-3`, tạo mock bằng `useMemo` ở lần mount và render `QuotaHealthCards`. Ghi dòng `Selectors:` vào "Trạng thái hiện tại" (ví dụ `[data-testid="quota-card-claude-5h"]`, `[role=progressbar]`).
- [x] 4. [vừa] `tests/quota-cards.test.ts` → viết spec cho T1, T2; chạy `npx vitest run tests/quota-cards.test.ts`. Sau đó chạy `npm run typecheck` và `npm run build`.
- [x] 5. [dễ] `AGENTS.md` → cập nhật Codebase Map mục `src/` (thêm `src/lib/quota-cards.ts`, `src/components/QuotaHealthCards.tsx`, `src/hooks/useNow.ts`, `src/mock/snapshots.ts`) và ghi vào "Trạng thái hiện tại" kết quả kiểm tra `README.md`/`docs/` (Docs checked).

## Test cases
- [x] T1. Thứ tự và giá trị bar — `buildQuotaCards` trả 3 bar đúng id, percent, level, resetText — tests/quota-cards.test.ts
  - Setup: `now = Date.parse('2026-01-01T00:00:00Z')`; claude snapshot 5h=62, 7d=91, reset_at = now+2h; opencode used 4_200_000 limit 10_000_000, reset_at = now+5d.
  - Steps: gọi `buildQuotaCards([claude, opencode], now)`.
  - Assert: ids `['claude-5h','claude-7d','opencode-cycle']`; percent `[62, 91, 42]`; level `['ok','critical','ok']`; resetText bar đầu `'2h 00m'`, bar cuối `'5d 00h'`.
- [x] T2. Auto-reset và thiếu dữ liệu — quá reset_at hiển thị 0%, thiếu snapshot thì `unknown` — tests/quota-cards.test.ts
  - Setup: cùng `now`; claude snapshot 5h=95, 7d=85 với reset_at = now-1000; không có snapshot opencode.
  - Steps: gọi `buildQuotaCards([claude], now)`.
  - Assert: bar 5h và 7d có percent 0, level `'ok'`; bar `opencode-cycle` có percent `null`, level `'unknown'`, resetText `'--'`. Thêm 1 assert riêng: 7d=85 chưa hết hạn (reset_at = now+1h) → level `'warn'`.

## Trạng thái hiện tại
- Bước 1 xong: thêm `src/mock/snapshots.ts` export `mockSnapshots(now)`. `npm run typecheck` pass. Chưa có Playwright spec.
- Bước 2 xong: thêm `src/lib/quota-cards.ts` export `QuotaLevel`, `QuotaBar`, `buildQuotaCards(snapshots, now)` trả 3 bar đúng thứ tự, snapshot thiếu → unknown/`--`, quá reset → 0%/ok. `npm run typecheck` pass.
- Bước 3 xong: thêm `src/hooks/useNow.ts`, `src/components/QuotaHealthCards.tsx`, cập nhật `src/App.tsx` (grid Bento + mock qua `useMemo`). `npm run typecheck` pass.
- Selectors: [data-testid="quota-card-claude-5h"], [data-testid="quota-card-claude-7d"], [data-testid="quota-card-opencode-cycle"], [role=progressbar], [aria-valuenow] (src/components/QuotaHealthCards.tsx)
- Bước 4 xong: thêm `tests/quota-cards.test.ts` (T1, T2). `npx vitest run tests/quota-cards.test.ts` 2/2 PASS; `npm run typecheck` PASS; `npm run build` PASS.
- Bước 5 xong: cập nhật Codebase Map `src/` trong `AGENTS.md`. Docs checked: `README.md`/`docs/SPEC.md` vẫn đúng ở mức tổng thể (Phase 2 chưa hoàn tất, dashboard đầy đủ còn ở Phase 2); không có thay đổi API/env/script nên không sửa.
- Lưu ý: `README.md` mục Project structure vẫn gọi `src/` là "placeholder React app (Phase 1)"; dòng này có thể tinh chỉnh khi Phase 2 hoàn thiện.

## Test status
- Lần chạy cuối: bước 4 — `npx vitest run tests/quota-cards.test.ts` PASS (2/2), `npm run typecheck` PASS, `npm run build` PASS
- Kết quả từng test:
  - T1: PASS
  - T2: PASS
- Fail chi tiết: không có

## Verify
- Suite: vitest 30/30 PASS, typecheck PASS. T1: PASS, T2: PASS.
- Visual mobile (390px): 3 card, thanh xanh/đỏ/xanh đúng ngưỡng, countdown đúng — PASS (`.agents/screenshots/task-10-quota-cards-mobile.png`).

VERIFY: PASS

## Lưu ý

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
