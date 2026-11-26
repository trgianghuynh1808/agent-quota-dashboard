# Task: Gộp các provider thành một card quota

APPROVED_BY_MANAGER

Verify mode: light

## Mục tiêu
Hiện có 5 card quota riêng (Claude 5h/7d, OpenCode Go 5h/7d/30d). Gộp thành MỘT card duy nhất, chia hai khu vực (Claude Code, OpenCode Go), mỗi khu vực liệt kê các thanh cửa sổ với %, progress bar và thời gian reset.

## Ý tưởng
- Thêm hàm thuần `groupQuotaBars` trong `src/lib/quota-cards.ts` gom `QuotaBar[]` theo provider; `buildQuotaCards` giữ nguyên.
- `QuotaHealthCards.tsx` render một card duy nhất, mỗi provider là một section với các hàng thanh quota (giữ `role="progressbar"`).
- Cập nhật README + AGENTS.md mô tả; thêm unit test cho hàm gom nhóm.

## Quyết định đã chốt
- Một card duy nhất cho tất cả provider; thứ tự: Claude Code rồi OpenCode Go.
- Không đổi logic tính %, level, reset.

## Ngữ cảnh
- `src/lib/quota-cards.ts`: `QuotaBar = { id; label; percent|null; level: 'ok'|'warn'|'critical'|'unknown'; resetText }`. `buildQuotaCards(snapshots, now)` trả id `claude-5h`, `claude-7d`, và `opencode-5h|7d|30d` hoặc `opencode-cycle`; label dạng `Claude Code · 5h`, `OpenCode Go · 30d`.
- `src/components/QuotaHealthCards.tsx`: hiện render fragment, mỗi bar một div `data-testid="quota-card-${bar.id}"`, có `levelColor`, `formatPercent`, progressbar. `App.tsx:21` dùng `<QuotaHealthCards snapshots now />` làm grid item(s) — kiểm tra class grid để card mới chiếm chỗ hợp lý (vd `md:col-span-2`).
- Test: Vitest `tests/quota-cards.test.ts` (đã có helper tạo snapshot ở đầu file, import `buildQuotaCards`). Không có Playwright.
- Không có test/doc nào khác tham chiếu `quota-card-*`. README.md dòng 52 và AGENTS.md (Codebase Map, mục `QuotaHealthCards`/`quota-cards.ts`) cần cập nhật.

## Plan
- [x] 1. [dễ] `src/lib/quota-cards.ts` → thêm `export type QuotaGroup = { id: 'claude' | 'opencode'; title: string; bars: QuotaBar[] }` và `groupQuotaBars(bars: QuotaBar[]): QuotaGroup[]`: nhóm theo tiền tố id (`claude-` → "Claude Code", `opencode-` → "OpenCode Go"), bỏ nhóm rỗng, bars giữ nguyên thứ tự; `label` mỗi bar rút gọn phần sau " · " (vd "5h", "Cycle").
- [x] 2. [vừa] `src/components/QuotaHealthCards.tsx` → render một card `data-testid="quota-card"` chứa mỗi group một section `data-testid="quota-group-${group.id}"` (tiêu đề + các hàng `data-testid="quota-row-${bar.id}"` gồm label, %, progressbar với `aria-label` đầy đủ như "Claude Code · 5h", "Reset in ..."). Chỉnh `src/App.tsx` nếu cần cho card chiếm bề rộng phù hợp. Ghi dòng `Selectors:` vào "Trạng thái hiện tại".
- [x] 3. [vừa] `tests/quota-cards.test.ts` → thêm test T1 cho `groupQuotaBars`; chạy `npx vitest run tests/quota-cards.test.ts` rồi `npm run typecheck`.
- [x] 4. [dễ] `README.md` (dòng 52) và `AGENTS.md` (Codebase Map: `QuotaHealthCards`, `quota-cards.ts`) → mô tả một card gộp + `groupQuotaBars`; ghi "Docs checked" vào Trạng thái hiện tại.

## Test cases
- [x] T1. Gom nhóm quota theo provider — `groupQuotaBars` ra 2 nhóm đúng thứ tự, đủ bar — tests/quota-cards.test.ts
  - Setup: dùng helper snapshot sẵn có trong file với claude_code + opencode_go có `opencode_windows` 5h/7d/30d.
  - Steps: gọi `groupQuotaBars(buildQuotaCards(snapshots, now))`; thêm lần gọi chỉ có snapshot claude.
  - Assert: 2 nhóm `claude` (2 bar: id `claude-5h`,`claude-7d`) và `opencode` (3 bar `opencode-5h|7d|30d`), label rút gọn `5h`/`7d`/`30d`; trường hợp chỉ claude: nhóm opencode vẫn có 1 bar `opencode-cycle` với percent null (vì buildQuotaCards luôn trả bar opencode).

## Trạng thái hiện tại
- Bước 1 xong: thêm `QuotaGroup` + `groupQuotaBars` trong `src/lib/quota-cards.ts` (giữ thứ tự Claude Code rồi OpenCode Go, bỏ nhóm rỗng, label rút gọn sau " · "). Typecheck PASS.
- Bước 2 xong: `QuotaHealthCards.tsx` render một card duy nhất (`md:col-span-2` ngay trên card, cùng pattern `PushOnboardingBanner`), mỗi provider một section với tiêu đề + các hàng thanh quota; `App.tsx` không cần chỉnh. Không có Playwright spec cho UI này nên chỉ chạy typecheck.
- Bước 3 xong: thêm test T1 cho `groupQuotaBars` (2 nhóm đúng thứ tự, đủ bar, label rút gọn; trường hợp chỉ claude vẫn có nhóm opencode với bar `opencode-cycle` percent null).
- Selectors: [data-testid="quota-card"], [data-testid="quota-group-claude"], [data-testid="quota-group-opencode"], [data-testid="quota-row-<bar-id>"] (claude-5h, claude-7d, opencode-5h/7d/30d/cycle), progressbar với aria-label "Claude Code · 5h" (src/components/QuotaHealthCards.tsx)
- Bước 4 xong: cập nhật README mục "Quota card" (một card gộp, section theo provider) và AGENTS.md Codebase Map (`QuotaHealthCards.tsx`, `quota-cards.ts` có `groupQuotaBars`). Không có Playwright spec cho UI này nên chỉ chạy typecheck. Docs checked: no other doc references the old per-card layout.

## Test status
- Lần chạy cuối: bước 4 — `npm run typecheck` PASS (docs only, không có lệnh test riêng)
- Kết quả từng test:
  - T1: PASS
- Fail chi tiết:

## Verify
- Typecheck + vitest toàn bộ (47 test): PASS
- T1 (unit): PASS
- Giao diện: một card gộp, 2 section Claude Code / OpenCode Go, đủ %, progressbar, reset: PASS — `.agents/screenshots/task-19-grouped-quota-card.png`

VERIFY: PASS

## Lưu ý

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
