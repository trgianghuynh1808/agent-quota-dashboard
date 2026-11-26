# Task: Phase 3a — file mẫu hook Claude Code gọi /api/ingest

APPROVED_BY_USER

Verify mode: none

## Mục tiêu
- Có script hook `hooks/claude-code/quota-ingest.sh` đọc JSON từ stdin (statusline Claude Code), dựng payload `claude_code` hợp lệ và POST nền tới `/api/ingest` (fire-and-forget).
- Có file mẫu `hooks/claude-code/settings.example.json` để gộp vào `~/.claude/settings.json` (statusLine + Stop hook).
- Có lệnh push snapshot ban đầu 1 lần (`--once`), theo SPEC mục 4.B.
- Test chứng minh payload do script sinh ra qua được `parseIngestPayload`.

## Ý tưởng
- Script bash + `jq`, không daemon: đọc stdin, lấy `rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.used_percentage`, `model.id`, `session_id`; thiếu dữ liệu quota thì thoát im lặng (exit 0).
- `curl --max-time 5 ... >/dev/null 2>&1 &` với `APP_URL` và `INGEST_API_KEY` từ biến môi trường; không bao giờ làm hỏng Claude Code (luôn exit 0).
- Chế độ `--once <5h%> <7d%>` gửi snapshot ban đầu thủ công.
- Test Vitest chạy script thật với `curl` giả trên PATH ghi lại body, rồi validate bằng `parseIngestPayload`.

## Quyết định đã chốt
- Chỉ làm Claude Code (Phase 3a); không động tới `api/`.
- Thư mục `hooks/`; script không đọc secret từ file, chỉ từ env.

## Ngữ cảnh
- Payload ingest `claude_code` (api/_lib/validate.ts `parseIngestPayload`): bắt buộc `provider:"claude_code"`, `agent_id` (non-empty), `window_5h_percent`, `window_7d_percent` (số 0..100); tuỳ chọn `task_name`, `model`, `input_tokens`/`output_tokens`/`cache_read_tokens` (int >=0), `reset_at` (ISO string).
- Auth: `Authorization: Bearer $INGEST_API_KEY`; URL `$APP_URL/api/ingest`.
- Statusline stdin của Claude Code (dạng giả định, script phải chịu được thiếu field): `{"session_id":"..","model":{"id":"claude-..."},"rate_limits":{"five_hour":{"used_percentage":12.5,"resets_at":1790000000},"seven_day":{"used_percentage":40}}}`. `resets_at` là epoch giây → đổi sang ISO bằng `date -u -r` (macOS) hoặc `jq todate`; dùng `jq` (`todate`) cho gọn.
- `agent_id` = `claude-code-$(hostname -s)` (cho phép override bằng `AGENT_ID`).
- Test: `tests/*.test.ts` (Vitest node, include `tests/**/*.test.ts`), import `parseIngestPayload` từ `../api/_lib/validate.js`. Chạy script bằng `node:child_process` `spawnSync('bash',[script],{input, env})`. Vì script gửi curl nền, test đặt thư mục tạm có `curl` giả (shell script ghi `"$@"` và body vào file) đứng đầu PATH; phải chờ file xuất hiện (poll tối đa ~3s). Cần `jq` có trên máy (kiểm tra `command -v jq`, skip test nếu thiếu).
- Dễ nhầm: curl nhận body qua `--data-binary @-` hay `-d`? Chọn `-d "$payload"` để curl giả đọc được từ argv.

## Plan
- [x] 1. [vừa] `hooks/claude-code/quota-ingest.sh` → viết script (`#!/usr/bin/env bash`, header usage, `set -uo pipefail`): đọc stdin, dựng payload bằng `jq -n`, gửi `curl -sS --max-time 5 -X POST "$APP_URL/api/ingest" -H ... -d "$payload" >/dev/null 2>&1 &`; thiếu env/jq/quota → exit 0 im lặng; chế độ `--once <5h> <7d>` gửi snapshot ban đầu. `chmod +x`.
- [x] 2. [dễ] `hooks/claude-code/settings.example.json` → mẫu `statusLine` (`type: command`, command trỏ `~/.claude/hooks/quota-ingest.sh`) và `hooks.Stop` cùng trỏ script đó.
- [x] 3. [vừa] `tests/claude-hook.test.ts` → viết spec T1, T2. Chạy: `npx vitest run tests/claude-hook.test.ts` và `npm run typecheck`.
- [x] 4. [dễ] `README.md` + `AGENTS.md` → thêm mục cài hook Claude Code (chép script, gộp settings, env `APP_URL`/`INGEST_API_KEY`, lệnh `--once`), cập nhật Codebase Map (`hooks/`) và dòng "Phase 3 chưa build"; không sửa phần OpenCode/circuit breaker.

## Test cases
- [x] T1. Payload hợp lệ — script biến JSON statusline thành body ingest qua validate — tests/claude-hook.test.ts
  - Setup: thư mục tạm với `curl` giả ghi argv vào `args.txt`; env `APP_URL=http://x.test`, `INGEST_API_KEY=k-${Date.now()}`, PATH có curl giả.
  - Steps: 1. chạy script với stdin `{"session_id":"s1","model":{"id":"claude-sonnet-x"},"rate_limits":{"five_hour":{"used_percentage":12.5,"resets_at":1790000000},"seven_day":{"used_percentage":40}}}` 2. đợi `args.txt`, lấy giá trị sau `-d`.
  - Assert: exit 0; argv chứa `http://x.test/api/ingest` và `Authorization: Bearer <key>`; `parseIngestPayload(JSON.parse(body))` ok với `provider=claude_code`, `window_5h_percent=12.5`, `window_7d_percent=40`, `model="claude-sonnet-x"`.
- [x] T2. Không phá Claude Code — thiếu quota/env thì im lặng — tests/claude-hook.test.ts
  - Setup: như T1.
  - Steps: 1. chạy với stdin `{"session_id":"s1"}` (không có rate_limits) 2. chạy stdin hợp lệ nhưng không có `INGEST_API_KEY`.
  - Assert: cả hai exit 0, stdout/stderr rỗng, `args.txt` không được tạo sau ~500ms.

## Trạng thái hiện tại

- Bước 1 xong: đã tạo `hooks/claude-code/quota-ingest.sh` (chmod +x, `bash -n` PASS).
- Script đọc stdin 1 lần, dựng payload bằng một lệnh `jq -nc --argjson s "$input"`: bắt buộc `provider:"claude_code"`, `agent_id` (mặc định `claude-code-$(hostname -s)`, override bằng `AGENT_ID`), `window_5h_percent`, `window_7d_percent`; thêm `model` từ `.model.id`, `task_name` từ `session_id` (payload không có trường session_id nên map sang `task_name` — trường duy nhất phù hợp), `reset_at` từ `.rate_limits.five_hour.resets_at` đổi sang ISO bằng jq `todate`. Thiếu APP_URL/INGEST_API_KEY/jq/curl/quota hoặc JSON hỏng → exit 0 im lặng, không sinh output. `--once <5h> <7d>` dựng payload tối giản, chỉ số 0..100 mới gửi. curl chạy nền `</dev/null >/dev/null 2>&1 &` nên không giữ pipe stdin/stdout.
- Smoke test thủ công (curl giả trên PATH, không chạm mạng): JSON statusline hợp lệ → body đúng `{"provider":"claude_code",...,"window_5h_percent":12.5,"window_7d_percent":40,"model":"claude-sonnet-x",...}` kèm header `Authorization: Bearer` + URL `/api/ingest`; stdin `{"session_id":"s1"}` (thiếu quota) → exit 0, không gọi curl; thiếu `INGEST_API_KEY` → exit 0, không gọi curl; `--once 33 66` → body đúng; `--once abc 66` → exit 0 im lặng.
- Bước 1 chưa có spec riêng (spec T1/T2 thuộc bước 3); bước này verify bằng `npm run typecheck` + smoke thủ công như Testing Rules.
- Bước 2 xong: đã tạo `hooks/claude-code/settings.example.json` gồm `statusLine` (`type: command`, command `~/.claude/hooks/quota-ingest.sh`) và `hooks.Stop` (matcher rỗng) cùng trỏ script đó; `jq .` xác nhận JSON hợp lệ; `npm run typecheck` PASS. Không có Playwright spec (bước không đổi UI).
- Bước 3 xong: đã tạo `tests/claude-hook.test.ts` (T1, T2). Dùng `spawnSync('bash',[SCRIPT])`, thư mục tạm có `curl` giả ghi argv vào `args.txt`, poll tối đa 3s; `describe.skipIf(!hasJq)` để skip khi thiếu `jq`. T1 kiểm URL/Bearer header/body qua `parseIngestPayload`; T2 kiểm thiếu quota và thiếu `INGEST_API_KEY` đều exit 0, stdout/stderr rỗng, không tạo `args.txt`. `npx vitest run tests/claude-hook.test.ts` → 2 passed; `npm run typecheck` → PASS.
- Bước 4 xong: `README.md` thêm mục "Claude Code hook (Phase 3a)" (chép script, gộp `settings.example.json`, env `APP_URL`/`INGEST_API_KEY`/`AGENT_ID`, lệnh `--once`, mapping trường), thêm `hooks/claude-code/` vào Project structure, cập nhật câu mở đầu và mục "Not implemented yet" (Phase 3a đã có, còn OpenCode plugin + macOS guide). `AGENTS.md` cập nhật Overview, Architecture (bullet hook), Codebase Map (`hooks/claude-code/`), Commands (lệnh chạy spec hook). Không sửa phần OpenCode/circuit breaker. `npm run typecheck` PASS; không có lệnh test riêng/không đổi UI.
- Docs checked: README.md và AGENTS.md đã cập nhật ở bước 4 (không còn mục nào lỗi thời về hook Claude Code).

## Test status
- Lần chạy cuối: `npm run typecheck` → PASS (bước 4, docs-only; lần chạy spec gần nhất `npx vitest run tests/claude-hook.test.ts` → 2 passed).
- Kết quả từng test:
  - T1: PASS
  - T2: PASS
- Fail chi tiết: không có.

## Verify

## Lưu ý
Lưu ý: định dạng JSON statusline của Claude Code (`rate_limits.*`) là giả định theo tài liệu hiện biết; nếu thực tế khác cần chỉnh jq filter khi cài thật.

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa: 0
- Model dùng: glm-5.3 (opencode)
