# Task: Endpoint ghi orchestrator_control (toggle pause + ngưỡng)

APPROVED_BY_MANAGER

Verify mode: none

## Mục tiêu
Thêm `POST /api/control` để đổi `global_status` (running/paused) và hai ngưỡng `auto_pause_threshold`, `downgrade_model_threshold` trong bảng `orchestrator_control`, xác thực bằng bearer `INGEST_API_KEY` như các endpoint khác. Không cần biến môi trường mới.

## Ý tưởng
- Handler `api/control.ts` theo đúng mẫu `api/status.ts`: `createControlHandler({ db, apiKey })` + default export dựng `createSupabaseDb()`.
- Validate body (JSON hoặc string) ở `api/_lib/validate.ts`: field nào gửi thì kiểm tra, ít nhất 1 field, ngưỡng là số nguyên 1–100.
- Thêm `Db.updateControl(patch)` (Supabase update hàng `id = 1`, FakeDb cập nhật in-memory), trả về control mới.
- Kiểm tra `downgrade_model_threshold <= auto_pause_threshold` trên giá trị sau khi gộp với control hiện tại.

## Quyết định đã chốt
- Dùng chung bearer `INGEST_API_KEY`, không thêm biến môi trường hay file cấu hình mới.
- Chỉ nhận `POST`; body là patch một phần (partial update).
- Response `200`: `{ ok: true, global_status, auto_pause_threshold, downgrade_model_threshold }`.

## Ngữ cảnh
- `api/status.ts`: mẫu handler (405 nếu sai method, 401 qua `isAuthorized(req.headers.authorization, deps.apiKey)` từ `./_lib/auth.js`, 500 + `console.error` khi lỗi). Import trong `api/` dùng đuôi `.js`.
- `api/_lib/types.ts`: `GlobalStatus = 'running' | 'paused'`; `Control { global_status; auto_pause_threshold; downgrade_model_threshold }`; interface `Db` có `getControl()`, `setPaused()`, ... (thêm `updateControl` vào đây).
- `api/_lib/validate.ts`: có `isRecord`, `ParseResult` (cho ingest). Thêm `parseControlPatch(body: unknown)` trả `{ ok: true; value: ControlPatch } | { ok: false; error: string }` (cùng kiểu xử lý body string → JSON.parse như `parseIngestPayload`).
- `api/_lib/supabase-db.ts`: `createSupabaseDb()` trả object literal; `setPaused` dùng `client.from('orchestrator_control').update({...,updated_at}).eq('id', 1)`. `updateControl` làm tương tự rồi `.select('global_status, auto_pause_threshold, downgrade_model_threshold').single()`, ném `Error('updateControl failed: ...')` khi lỗi.
- `tests/fake-db.ts`: `FakeDb` có `readonly control: Control` (mutable fields); `new FakeDb({ control: {...} })`. Thêm `updateControl(patch)` gộp patch vào `this.control` và trả bản sao.
- `tests/api.test.ts`: có sẵn helper `call(handler, { method, headers, body })`, `AUTH = { authorization: 'Bearer k' }`, `API_KEY = 'k'`, `makeStatus(db)` ở khoảng dòng 51–60 (làm `makeControl` tương tự: `createControlHandler({ db, apiKey: API_KEY })`). Test là Vitest, không chạm Supabase/mạng.
- README.md: mục `## API` (có `### POST /api/ingest`, `### GET /api/status`), cây `## Project structure` (liệt kê `api/status.ts`). AGENTS.md: Codebase Map dòng `api/` liệt kê `ingest.ts`, `status.ts`.
- Lệnh kiểm tra: `npm run typecheck`; test: `npx vitest run tests/api.test.ts`.

## Plan
- [x] 1. [vừa] `api/_lib/types.ts` → thêm `type ControlPatch = Partial<Control>` và `updateControl(patch: ControlPatch): Promise<Control>` vào `Db`; `api/_lib/supabase-db.ts` → `createSupabaseDb`: implement `updateControl`; `tests/fake-db.ts` → `FakeDb.updateControl`. Chạy `npm run typecheck`.
- [x] 2. [vừa] `api/_lib/validate.ts` → thêm `parseControlPatch(body)`: `global_status` phải là `running|paused`; hai ngưỡng là số nguyên 1–100; cần ít nhất 1 field hợp lệ (lỗi `400` có thông điệp rõ); bỏ qua field lạ không. Tạo `api/control.ts` → `createControlHandler({ db, apiKey })` + default export: 405 nếu không phải POST, 401 nếu sai bearer, 400 nếu body sai, đọc `getControl()`, gộp patch, nếu `downgrade_model_threshold > auto_pause_threshold` trả 400, gọi `updateControl(patch)`, trả `200 { ok: true, ...control }`; lỗi DB → 500. Chạy `npm run typecheck`.
- [x] 3. [vừa] `tests/api.test.ts` → thêm `describe('POST /api/control')` theo Test cases bên dưới. Chạy `npx vitest run tests/api.test.ts`.
- [x] 4. [dễ] `README.md` → thêm mục `### POST /api/control` (body, response, mã lỗi) sau `GET /api/status`, thêm `control.ts` vào cây Project structure; `AGENTS.md` → Codebase Map: thêm `control.ts` vào dòng `api/`. Ghi "Docs checked" vào Trạng thái hiện tại.

## Test cases
- [x] T1. Cập nhật từng phần — đổi pause và ngưỡng, field không gửi giữ nguyên — tests/api.test.ts
  - Setup: `const db = new FakeDb()` (mặc định running, 90, 80); handler `makeControl(db)`.
  - Steps: 1. POST `{ global_status: 'paused' }` với `AUTH`. 2. POST `{ auto_pause_threshold: 95, downgrade_model_threshold: 85 }`. 3. GET `/api/status` qua `makeStatus(db)` đọc lại.
  - Assert: bước 1 → 200, `global_status: 'paused'`, ngưỡng còn 90/80. Bước 2 → 200, 95/85, `global_status` vẫn `paused`. Bước 3 trả cùng giá trị với `db.control`.
- [x] T2. Xác thực và method — sai bearer/method bị chặn, DB không đổi — tests/api.test.ts
  - Setup: `new FakeDb()`.
  - Steps: 1. POST không header. 2. POST bearer `Bearer wrong`. 3. GET với `AUTH`.
  - Assert: 401, 401, 405; `db.control.global_status` vẫn `running`.
- [x] T3. Validate body — giá trị sai trả 400 và không ghi — tests/api.test.ts
  - Setup: `new FakeDb()`.
  - Steps: POST với `AUTH` lần lượt: `{}`, `{ global_status: 'stopped' }`, `{ auto_pause_threshold: 150 }`, `{ auto_pause_threshold: 70 }` (thấp hơn downgrade 80).
  - Assert: cả 4 lần `400` với `body.error` là string; `db.control` vẫn `running`, 90, 80.

## Trạng thái hiện tại
- Bước 1 xong: `ControlPatch` + `Db.updateControl` thêm vào `api/_lib/types.ts`; `createSupabaseDb.updateControl` (`api/_lib/supabase-db.ts`); `FakeDb.updateControl` (`tests/fake-db.ts`). `npm run typecheck` PASS. Commit 0ee0df0.
- Bước 2 xong: `parseControlPatch` thêm vào `api/_lib/validate.ts` (field lạ bị bỏ qua, cần ít nhất 1 trong 3 field); handler mới `api/control.ts` (`createControlHandler` + default export, check `downgrade_model_threshold <= auto_pause_threshold` trên giá trị gộp). `npm run typecheck` PASS. Commit 01eda95.
- Bước 3 xong: thêm `describe('POST /api/control')` vào `tests/api.test.ts` (helper `makeControl`), cover T1–T3. `npx vitest run tests/api.test.ts` PASS 8/8; `npm run typecheck` PASS. Commit 0496134.
- Bước 4 xong: `README.md` thêm mục `### POST /api/control` (body, response 200, lỗi 400/401/405/500) sau `GET /api/status`, thêm `control.ts` vào cây Project structure và cập nhật dòng `INGEST_API_KEY`; `AGENTS.md` cập nhật Codebase Map, dòng Phase 1 và Architecture để liệt kê `control.ts`. `npm run typecheck` PASS. Docs checked: README + AGENTS.md đã khớp code.
- Lưu ý: Bước 4 chỉ đổi tài liệu (README/AGENTS.md), không thêm/sửa test; plan không yêu cầu test cho bước này.
- Lưu ý: Vitest chạy lần đầu có 2 lần fail T1 do test còn thiếu `headers: AUTH` ở 2 request POST đầu; đã sửa trong cùng bước 3, chạy lại PASS toàn bộ.

## Test status
- Lần chạy cuối: npx vitest run tests/api.test.ts (sau bước 3) — 8/8 PASS; npm run typecheck PASS
- Bước 4: không có test (chỉ sửa tài liệu); `npm run typecheck` PASS sau bước 4.
- Kết quả từng test:
  - T1: PASS
  - T2: PASS
  - T3: PASS
- Fail chi tiết: lần chạy đầu T1 fail 401 thay vì 200 vì 2 request POST thiếu `headers: AUTH`; thêm header vào là PASS (2 lần sửa trong cùng bước).

## Verify

## Lưu ý

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
