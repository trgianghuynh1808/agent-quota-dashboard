# Task: Phase 3c — hook circuit breaker kiểm tra GET /api/status

APPROVED_BY_USER

Verify mode: none

## Mục tiêu
Thêm hook Claude Code (`UserPromptSubmit` / `PreToolUse`) gọi `GET /api/status`; nếu `global_status` là `paused` thì chặn (exit 2 + thông báo stderr) để agent dừng cho đến khi được resume. Có test.

## Ý tưởng
- Script bash mới `hooks/claude-code/circuit-breaker.sh`, dùng `curl` + `jq` giống `quota-ingest.sh`, gửi `Authorization: Bearer $INGEST_API_KEY`, timeout ngắn (3s).
- `paused` → in lý do ra stderr và `exit 2` (Claude Code chặn prompt/tool). Mọi trường hợp khác (running, thiếu env/jq/curl, lỗi mạng, HTTP lỗi, JSON hỏng) → `exit 0` (fail-open, không làm hỏng Claude Code).
- Test bằng `curl` giả trên `PATH` (như `tests/claude-hook.test.ts`), thêm cấu hình mẫu vào `settings.example.json`.

## Quyết định đã chốt
- Chặn bằng exit code 2 (không dùng vòng sleep) và fail-open khi không xác định được trạng thái.
- Không sửa API; dùng `GET /api/status` hiện có.

## Ngữ cảnh
- `GET /api/status` (api/status.ts): cần header `Authorization: Bearer <INGEST_API_KEY>`; trả 200 `{ global_status: 'running'|'paused', auto_pause_threshold, downgrade_model_threshold, snapshots }`.
- Mẫu script: `hooks/claude-code/quota-ingest.sh` (`set -uo pipefail`, env `APP_URL`, `INGEST_API_KEY`, thiếu thì `exit 0`, kiểm `command -v jq/curl`).
- Mẫu test: `tests/claude-hook.test.ts` — tạo thư mục tạm có file `curl` giả (chmod 755) đặt đầu `PATH`, chạy `spawnSync('bash', [SCRIPT], {input, env})`. Khác với ingest: breaker chạy curl ĐỒNG BỘ và đọc stdout của curl, nên curl giả phải `echo` JSON ra stdout (ví dụ đọc từ biến env `FAKE_CURL_BODY`, và `exit "${FAKE_CURL_EXIT:-0}"`). Script không nên dùng `-f`-phụ thuộc; dùng `curl -sS --max-time 3 -H ... "$APP_URL/api/status"` rồi `jq -r .global_status`.
- Hook của Claude Code nhận JSON ở stdin (có thể bỏ qua); exit 2 = chặn, stderr được đưa cho Claude.
- `settings.example.json` hiện có `statusLine` và `hooks.Stop`; thêm `UserPromptSubmit` và `PreToolUse` (matcher `""`) trỏ `~/.claude/hooks/circuit-breaker.sh`.
- Docs: cập nhật mục `hooks/claude-code/` trong AGENTS.md (Architecture + Codebase Map); README chưa có hướng dẫn hook (Phase 3d lo), nếu README có mô tả hooks thì cập nhật.

## Plan
- [x] 1. [dễ] `hooks/claude-code/circuit-breaker.sh` → script mới (chmod +x): đọc env, gọi `GET $APP_URL/api/status`, `paused` → stderr "Circuit breaker: agents are PAUSED from the dashboard. Stop and wait until resumed." + `exit 2`; còn lại `exit 0`.
- [x] 2. [dễ] `hooks/claude-code/settings.example.json` → thêm `UserPromptSubmit` và `PreToolUse` gọi `circuit-breaker.sh`; sau đó cập nhật `AGENTS.md` (Architecture + Codebase Map) cho hook mới.
- [x] 3. [vừa] `tests/circuit-breaker-hook.test.ts` → viết spec T1–T3 (dùng helper kiểu `tests/claude-hook.test.ts`, curl giả in body ra stdout). Chạy: `npx vitest run tests/circuit-breaker-hook.test.ts` rồi `npm run typecheck`.

## Test cases
- [x] T1. paused chặn — status `paused` thì exit 2 và stderr có "PAUSED" — tests/circuit-breaker-hook.test.ts
  - Setup: thư mục tạm + curl giả in `{"global_status":"paused"}`; env `APP_URL=https://x.test`, `INGEST_API_KEY=k`
  - Steps: 1. chạy script với stdin `{}`
  - Assert: status 2; stderr chứa "PAUSED"; curl giả nhận `http://…/api/status` hoặc `https://x.test/api/status` và header `Authorization: Bearer k`
- [x] T2. running cho qua — status `running` thì exit 0, không in stderr — tests/circuit-breaker-hook.test.ts
  - Setup: như T1, body `{"global_status":"running"}`
  - Steps: 1. chạy script
  - Assert: status 0; stderr rỗng
- [x] T3. fail-open — lỗi mạng hoặc thiếu env thì exit 0 — tests/circuit-breaker-hook.test.ts
  - Setup: (a) curl giả `exit 7` không in gì; (b) không đặt `APP_URL`
  - Steps: 1. chạy script ở từng trường hợp
  - Assert: cả hai status 0

## Trạng thái hiện tại
- Bước 1 xong: thêm `hooks/claude-code/circuit-breaker.sh` (chmod +x), fail-open mọi trường hợp trừ `global_status=paused` (exit 2 + stderr). `bash -n` và `npm run typecheck` đều pass.
- Bước 2 xong: `settings.example.json` thêm `UserPromptSubmit` + `PreToolUse` (matcher `""`) trỏ `~/.claude/hooks/circuit-breaker.sh` (JSON hợp lệ); `AGENTS.md` cập nhật Architecture + Codebase Map cho hook mới; `npm run typecheck` pass.
- Bước 3 xong: thêm `tests/circuit-breaker-hook.test.ts` (T1–T3) theo mẫu `tests/claude-hook.test.ts`: curl giả log args vào file, in `FAKE_CURL_BODY` ra stdout và exit theo `FAKE_CURL_EXIT`; breaker chạy đồng bộ nên đọc args file ngay sau khi script kết thúc. `npx vitest run tests/circuit-breaker-hook.test.ts` 3/3 pass; `npm run typecheck` pass. Docs checked: no change needed (AGENTS.md đã mô tả hook ở bước 2, không liệt kê từng spec).

## Test status
- Lần chạy cuối: `npx vitest run tests/circuit-breaker-hook.test.ts` (3/3 pass) rồi `npm run typecheck` (pass) — bước 3
- Kết quả từng test:
  - T1: PASS
  - T2: PASS
  - T3: PASS
- Fail chi tiết:

## Verify

## Lưu ý

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
