# Task: Phase 3d — README hướng dẫn cài đặt macOS

APPROVED_BY_USER

Verify mode: none

## Mục tiêu
Thêm hướng dẫn cài đặt từng bước trên macOS vào `README.md` (deploy backend, cài hook Claude Code, cài plugin OpenCode Go, kiểm tra), và bỏ chú thích "macOS guide chưa có" ở README/AGENTS.md.

## Ý tưởng
- Thêm mục `## macOS setup guide (Phase 3d)` vào `README.md`, gom các bước đã có rải rác thành một luồng liền mạch: Supabase + Vercel → env → hook Claude Code → plugin OpenCode → kiểm tra bằng `curl`/`--once`.
- Dùng đúng đường dẫn, tên biến và lệnh có thật trong `hooks/`, không thêm code mới.
- Cập nhật các câu "chưa làm" ở README/AGENTS.md cho khớp thực tế.

## Quyết định đã chốt
- Chỉ sửa tài liệu, không đổi code, không thêm test.
- Giữ nguyên dòng "Phase 3c" trong README (task khác phụ trách).

## Ngữ cảnh
- `README.md` đã có: `## Environment variables` (INGEST_API_KEY, SUPABASE_*, VAPID_*), `## Database` (`supabase db push`), `## Claude Code hook (Phase 3a)` (copy `hooks/claude-code/quota-ingest.sh` → `~/.claude/hooks/`, merge `settings.example.json` vào `~/.claude/settings.json`, env `APP_URL`/`INGEST_API_KEY`/`AGENT_ID`, `--once <5h> <7d>`, cần `jq` + `curl`), `## OpenCode Go plugin` (copy `hooks/opencode/quota-sync.ts` → `~/.config/opencode/plugin/`, env `APP_URL`, `INGEST_API_KEY`, `AGENT_ID`, `OPENCODE_CYCLE_TOKEN_LIMIT`, `OPENCODE_CYCLE_DAYS`, backfill một lần, state `~/.config/opencode/quota-sync.state.json`, DB `~/.local/share/opencode/opencode.db`).
- Cuối README có `## Not implemented yet` với dòng "Phase 3 (host hooks)... the macOS setup guide is still to come." và đoạn mở đầu nói "the macOS setup guide are **not implemented yet**".
- `AGENTS.md` mục Project Overview có câu "Phase 2 (PWA dashboard) and the macOS guide are not built yet."
- `.env.example` có sẵn ở root. Không đưa secret thật vào tài liệu; dùng placeholder.
- macOS: `brew install jq` (curl có sẵn); biến env đặt trong `~/.zshrc`; Vercel deploy qua `vercel` CLI hoặc import repo GitHub, env đặt trong Vercel dashboard; Supabase qua `supabase db push`.
- Gotcha: `quota-ingest.sh` đọc secret từ env, nên app GUI không đọc `~/.zshrc` — phải chạy `claude`/`opencode` từ terminal đã export biến.

## Plan
- [x] 1. [dễ] `README.md` → thêm mục `## macOS setup guide (Phase 3d)` ngay trước `## Commands`: các bước 1) yêu cầu (Homebrew, Node, `jq`, Supabase CLI, Vercel CLI) 2) Supabase: `supabase db push` 3) Vercel: deploy + đặt env vars từ bảng Environment variables, sinh VAPID key bằng `npx web-push generate-vapid-keys` 4) export `APP_URL`/`INGEST_API_KEY` trong `~/.zshrc` 5) cài hook Claude Code (tham chiếu mục Phase 3a, merge `settings.example.json`) 6) cài plugin OpenCode (tham chiếu mục plugin) 7) kiểm tra: `~/.claude/hooks/quota-ingest.sh --once 12.5 40` rồi `curl "$APP_URL/api/status" -H "Authorization: Bearer $INGEST_API_KEY"`, 8) troubleshooting ngắn (hook im lặng khi thiếu env/jq, app GUI không có env). Sửa đoạn mở đầu và mục `## Not implemented yet` để bỏ câu macOS guide chưa có (giữ dòng Phase 3c). Kiểm tra tên biến/đường dẫn khớp code trong `hooks/`.
- [x] 2. [dễ] `AGENTS.md` → Project Overview: đổi câu "Phase 2 (PWA dashboard) and the macOS guide are not built yet" thành chỉ còn Phase 2 chưa làm, và nói README có macOS setup guide (Phase 3d). Ghi "Docs checked" vào Trạng thái hiện tại. Chạy `npm run typecheck` (không bắt buộc, chỉ doc).

## Test cases
Không có test case: task chỉ đổi tài liệu (Verify mode: none).

## Trạng thái hiện tại
- Bước 1 xong: `README.md` có mục `## macOS setup guide (Phase 3d)` (8 bước: yêu cầu, Supabase, Vercel + env + VAPID, export env trong `~/.zshrc`, hook Claude Code, plugin OpenCode, verify bằng `--once` + `curl /api/status`, troubleshooting). Đã sửa đoạn mở đầu và mục `## Not implemented yet` (bỏ câu macOS guide chưa có, giữ dòng Phase 3c).
- Bước 2 xong: `AGENTS.md` Project Overview còn nói Phase 2 chưa làm và README có macOS setup guide (Phase 3d).
- Tên biến/đường dẫn đã đối chiếu code: `APP_URL`, `INGEST_API_KEY`, `AGENT_ID` (default `claude-code-$(hostname -s)`), `OPENCODE_CYCLE_TOKEN_LIMIT`, `OPENCODE_CYCLE_DAYS`, `~/.claude/hooks/quota-ingest.sh`, `~/.config/opencode/plugin/`, `~/.config/opencode/quota-sync.state.json`, `~/.local/share/opencode/opencode.db`.
- `npm run typecheck`: PASS sau cả 2 bước (không có Playwright spec trong repo).
- Docs checked: README và AGENTS.md đã cập nhật, không còn câu macOS guide chưa có.

## Test status
- Lần chạy cuối: bước 2 — `npm run typecheck` PASS
- Kết quả từng test: không có (chỉ tài liệu)
- Fail chi tiết: không

## Verify
Mode none: typecheck PASS, diff README/AGENTS.md đã đọc, khớp code.

VERIFY: PASS

## Lưu ý

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
