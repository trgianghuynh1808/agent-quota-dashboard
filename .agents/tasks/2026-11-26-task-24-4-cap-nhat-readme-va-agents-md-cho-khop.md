# Task: Cập nhật README và AGENTS.md cho khớp (T24)

APPROVED_BY_USER

Verify mode: none

## Mục tiêu
README.md, AGENTS.md (và docs/SPEC.md nếu lệch) khớp với code sau T21–T23: reset 5h/7d của Claude, 3 mốc OpenCode Go + set-quota.sh, bỏ cơ chế ngưỡng/Web Push/cycle limit.

## Ý tưởng
- T21–T23 đã sửa phần lớn tài liệu; task này chỉ rà soát từng mục so với code thật rồi sửa chỗ còn lệch.
- Xóa câu không còn đúng thay vì thêm ghi chú bên cạnh; không đổi code.

## Quyết định đã chốt
- Chỉ sửa tài liệu, không đụng code/test.
- Không thêm test (docs only).

## Ngữ cảnh
- Đã grep: README/AGENTS/SPEC không còn nhắc threshold/Web Push như tính năng hiện hành (chỉ như "đã bỏ" / cột legacy).
- Cần đối chiếu với code: `README.md` mục "Project structure", "API" (`POST /api/ingest` có `window_id`/`window_percent`, `reset_at`, `reset_7d_at`, response `quota_snapshots` có `opencode_windows`), "Claude Code hook", "OpenCode Go quota windows", "Commands", "Not implemented yet" (mục "Phase 3c" mơ hồ); `AGENTS.md` mục "Project Overview", "Architecture", "Codebase Map" (danh sách tests, migrations 0001–0004); `docs/SPEC.md` (chưa nhắc `reset_7d_at`/`opencode_windows`/`window_id`/`set-quota.sh` ở phần schema + ingest: grep trả 0).
- Nguồn sự thật: `api/_lib/types.ts`, `api/_lib/validate.ts`, `api/_lib/ingest.ts`, `hooks/claude-code/quota-ingest.sh`, `hooks/opencode/set-quota.sh`, `supabase/migrations/0003*.sql`, `0004*.sql`, `.env.example`, `package.json` scripts.
- Tệp `.env.example` tồn tại; kiểm tra bảng biến môi trường README khớp nó.

## Plan
- [x] 1. [vừa] `docs/SPEC.md` → thêm vào schema `quota_snapshots` cột `reset_7d_at` và `opencode_windows` (jsonb, merge theo `id`), vào mục ingest payload `window_id`/`window_percent`/`reset_7d_at`, và nhắc `hooks/opencode/set-quota.sh`; đối chiếu với `api/_lib/types.ts` + `validate.ts`.
- [x] 2. [vừa] `README.md` → rà từng mục (intro, Project structure, API ingest/status, hook Claude, set-quota, env vars, Commands, "Not implemented yet") với code; sửa chỗ lệch, làm rõ/bỏ dòng "Phase 3c" mơ hồ; `AGENTS.md` → rà Overview/Architecture/Codebase Map (danh sách tests, migrations, hooks) và sửa chỗ lệch. Cuối cùng ghi "Docs checked" vào Trạng thái hiện tại. Chạy `npm run typecheck` (không cần test).

## Test cases
- Không có (chỉ sửa tài liệu; Verify mode none).

## Trạng thái hiện tại
- Bước 1 xong: `docs/SPEC.md` đã thêm cột `reset_7d_at` + `opencode_windows` (jsonb, upsert theo `id`) vào schema `quota_snapshots`, mục payload ingest (`window_id`/`window_percent` kèm `reset_at` bắt buộc, `reset_7d_at` tùy chọn cho Claude) và mục host-side nhắc `hooks/opencode/set-quota.sh`; đã đối chiếu với `api/_lib/types.ts` + `api/_lib/validate.ts` + `api/_lib/ingest.ts` (window payload: không log, không token delta).
- Bước 2 xong, cả hai bước đều xong. Đã rà `README.md` (intro, Stack, Project structure, Dashboard, PWA, env vars so với `.env.example`, Database so với 0001–0004 + `supabase-db.ts`, API ingest/status/control so với `validate.ts`/`ingest.ts`/`status.ts`/`control.ts`/`auth.ts`, hook Claude so với `quota-ingest.sh`/`circuit-breaker.sh`, plugin + set-quota so với `quota-sync.ts`/`set-quota.sh`, macOS guide, Commands so với `package.json`, "Not implemented yet") và `AGENTS.md` (Overview, Architecture, Codebase Map: tests/migrations/hooks khớp thực tế).
- Sửa README: mô tả `_lib/ingest.ts` thêm "window update"; ví dụ `GET /api/status` thêm snapshot `opencode_go` với `opencode_windows` (3 mốc) — response thật trả cột này; câu `POST /api/control` đổi thành "switch that circuit-breaker.sh enforces" (hook chỉ đọc `/api/status`, không gọi control); bỏ dòng "Phase 3c" mơ hồ trong "Not implemented yet". Sửa AGENTS.md: câu Phase 3a Overview ghi rõ hook gửi kèm reset timestamps (5h/7d).
- Docs checked: các mục còn lại của README/AGENTS.md khớp code (env table khớp `.env.example`; `INGEST_API_KEY` dùng cho cả 3 route; `p_limit: null`; thresholds 90/80 là cột legacy đúng default của `0001`; 200 logs; `AGENT_ID` defaults `claude-code-$(hostname -s)` / `opencode-go` / `opencode-console`).
- Lưu ý: chỉ còn duy nhất phần pending thật sự là dashboard control writes (`POST /api/control` từ PWA), đã ghi rõ ở mục "Not implemented yet" của README.

## Test status
- Lần chạy cuối: `npm run typecheck` sau bước 2 — PASS (bước 2 không yêu cầu lệnh test nào).
- Kết quả từng test: không có test case

## Verify

## Lưu ý

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa: 0
- Model dùng: glm-5.3 (opencode-go)
