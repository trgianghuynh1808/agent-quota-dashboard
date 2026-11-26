# Task: Migration 0002 (RLS đọc cho Realtime) + endpoint POST /api/subscribe

APPROVED_BY_MANAGER

Verify mode: none

## Mục tiêu
- Thêm migration `0002` cho phép PWA (anon key) đọc 3 bảng dữ liệu qua Realtime.
- Thêm `POST /api/subscribe` lưu Web Push subscription vào `push_subscriptions` để Phase 2 dùng.

## Ý tưởng
- Migration 0002: policy `select` cho role `anon, authenticated` trên `quota_snapshots`, `agent_telemetry_logs`, `orchestrator_control`; `push_subscriptions` vẫn khóa hoàn toàn.
- `/api/subscribe` theo đúng mẫu `api/control.ts`: bearer `INGEST_API_KEY`, validate body `{endpoint, keys:{p256dh, auth}}`, upsert theo `endpoint` qua `Db` mới `upsertPushSubscription`.
- Test bằng `FakeDb` trong `tests/api.test.ts`, không đụng Supabase thật.

## Quyết định đã chốt
- Không thêm biến môi trường mới và không sửa file cấu hình môi trường nào.
- Auth dùng bearer `INGEST_API_KEY` như các endpoint khác.
- Chỉ POST (đăng ký/ghi đè); chưa làm huỷ đăng ký.

## Ngữ cảnh
- Mẫu handler: `api/control.ts` (`createControlHandler({ db, apiKey })`, default export tạo `createSupabaseDb()`; 405 nếu không POST, 401 qua `isAuthorized`, 400 khi body sai, 500 khi lỗi DB).
- `api/_lib/types.ts`: interface `Db` (thêm method). `api/_lib/validate.ts`: có `isRecord`, `parseControlPatch` trả `{ok:true,value}|{ok:false,error}`; body có thể là string JSON.
- `api/_lib/supabase-db.ts`: `createSupabaseDb()` trả object `Db` dùng `client.from(...)`; lỗi thì `throw new Error('... failed: ' + error.message)`.
- Bảng `push_subscriptions(endpoint text pk, p256dh text, auth text, created_at)`. 0001 đã bật RLS cho cả 4 bảng và thêm 3 bảng đầu vào publication `supabase_realtime`.
- `tests/fake-db.ts`: class `FakeDb implements Db` — phải thêm method mới + `subscriptions` public để test đọc. `tests/api.test.ts` có helper `call(handler, {method, headers, body})`, `AUTH = {authorization: 'Bearer k'}`, `API_KEY='k'`.
- Import trong `api/` dùng đuôi `.js`. Không đọc `process.env` ở top level.
- Test chạy: `npx vitest run tests/api.test.ts`; check: `npm run typecheck`.

## Plan
- [x] 1. [dễ] `supabase/migrations/0002_realtime_read_policies.sql` → tạo file: với từng bảng `quota_snapshots`, `agent_telemetry_logs`, `orchestrator_control` thêm `create policy "<bảng>_read_realtime" on <bảng> for select to anon, authenticated using (true);`. Không tạo policy nào cho `push_subscriptions`. Thêm comment đầu file giải thích.
- [x] 2. [vừa] `api/_lib/types.ts` → thêm `interface PushSubscriptionInput { endpoint: string; p256dh: string; auth: string }` và `upsertPushSubscription(sub: PushSubscriptionInput): Promise<void>` vào `Db`; `api/_lib/supabase-db.ts` → implement bằng `client.from('push_subscriptions').upsert({...}, { onConflict: 'endpoint' })`; `api/_lib/validate.ts` → thêm `parseSubscription(body)` (endpoint là chuỗi bắt đầu `https://`, `keys.p256dh` và `keys.auth` là chuỗi không rỗng; chấp nhận body dạng string JSON) trả `{ok,value}|{ok,error}`; `tests/fake-db.ts` → thêm `readonly subscriptions = new Map<string, PushSubscriptionInput>()` và implement method (ghi đè theo endpoint).
- [x] 3. [vừa] `api/subscribe.ts` → tạo `createSubscribeHandler({ db, apiKey })` + default export theo mẫu `api/control.ts`; trả `200 {ok:true}`.
- [x] 4. [vừa] `tests/api.test.ts` → thêm `describe('subscribe')` cho T1–T2 rồi chạy `npx vitest run tests/api.test.ts` và `npm run typecheck`.
- [x] 5. [dễ] `README.md` → cập nhật mục API (thêm `POST /api/subscribe`: bearer, body, kết quả), mục schema/security (policy đọc Realtime của 0002, `push_subscriptions` vẫn chỉ service role), bỏ "subscription endpoint" khỏi danh sách Phase 2 còn thiếu; `AGENTS.md` → Architecture/Codebase Map: thêm `api/subscribe.ts`, sửa câu "no policies" (RLS có policy đọc từ 0002), nhắc `0002` trong `supabase/migrations/`. Ghi "Docs checked" vào Trạng thái hiện tại.

## Test cases
- [x] T1. Subscribe lưu và ghi đè — POST hợp lệ lưu sub, gửi lại cùng endpoint không tạo bản trùng — tests/api.test.ts
  - Setup: `db = new FakeDb()`, `handler = createSubscribeHandler({ db, apiKey: API_KEY })`, endpoint duy nhất `https://push.example/${Date.now()}`.
  - Steps: 1. POST với `AUTH` và body `{endpoint, keys:{p256dh:'p1', auth:'a1'}}` · 2. POST lại cùng endpoint với `p256dh:'p2'`.
  - Assert: cả hai trả status 200, `body.ok === true`; `db.subscriptions.size === 1`; `db.subscriptions.get(endpoint).p256dh === 'p2'`.
- [x] T2. Subscribe từ chối request sai — auth/method/body — tests/api.test.ts
  - Setup: như T1.
  - Steps: 1. POST không header auth · 2. GET với `AUTH` · 3. POST với `AUTH` và body thiếu `keys` · 4. POST với `AUTH` và endpoint `http://x`.
  - Assert: lần lượt 401, 405, 400, 400; `db.subscriptions.size === 0`.

## Trạng thái hiện tại
- Bước 1 xong: tạo `supabase/migrations/0002_realtime_read_policies.sql` với 3 policy select cho `anon, authenticated` trên `quota_snapshots`, `agent_telemetry_logs`, `orchestrator_control`; không có policy cho `push_subscriptions`.
- Bước 2 xong: `Db` có `upsertPushSubscription` (interface `PushSubscriptionInput`), `createSupabaseDb()` upsert vào `push_subscriptions` theo `endpoint`; `parseSubscription` trong `validate.ts` (endpoint `https://`, `keys.p256dh`/`keys.auth` không rỗng, body string JSON ok); `FakeDb.subscriptions` là `Map` public ghi đè theo endpoint.
- Bước 3 xong: `api/subscribe.ts` có `createSubscribeHandler({ db, apiKey })` + default export (405 nếu không POST, 401 qua `isAuthorized`, 400 qua `parseSubscription`, 500 khi lỗi DB, thành công trả `200 {ok:true}`); auth dùng bearer `INGEST_API_KEY`.
- Bước 4 xong: `tests/api.test.ts` thêm `describe('subscribe')` với T1–T2 (endpoint duy nhất theo `Date.now()`).
- Bước 5 xong: `README.md` thêm mục `POST /api/subscribe` (bearer, body, `200 {ok:true}`, lỗi 400/401/405/500), cập nhật bảng env (`INGEST_API_KEY` dùng cho subscribe), mục Database (apply `0001` + `0002`, policy đọc Realtime của `0002`, `push_subscriptions` vẫn chỉ service role) và bỏ "subscription endpoint" khỏi Phase 2 còn thiếu; `AGENTS.md` thêm `api/subscribe.ts` (Overview + Architecture + Codebase Map), sửa câu "no policies" thành policy đọc từ `0002`, nhắc `0002` trong `supabase/migrations/`.
- Docs checked: README.md + AGENTS.md đã cập nhật theo bước 5; không còn tài liệu nào khác mô tả hành vi này.

## Test status
- Bước 5 (docs-only): `npm run typecheck` PASS; không có test mới, không có Playwright spec trong repo.
- Lần chạy cuối: `npx vitest run tests/api.test.ts` → 10 passed (10); `npm run typecheck` (bước 4) PASS.
- Kết quả từng test:
  - T1: PASS (200/200, `db.subscriptions.size === 1`, `p256dh === 'p2'`)
  - T2: PASS (401, 405, 400, 400; `db.subscriptions.size === 0`)
- Fail chi tiết: không có

## Verify

## Lưu ý
Lưu ý: `/api/subscribe` dùng bearer `INGEST_API_KEY`, nên PWA phải có key này (nhập tay trong cài đặt) — ổn cho dùng một người; nếu muốn công khai cần cơ chế khác ở Phase 2.
Lưu ý: policy 0002 cho `anon` đọc cả `agent_telemetry_logs` (có `task_name`, `agent_id`); ai có anon key đều đọc được. Chấp nhận cho dashboard cá nhân.
Lưu ý: chưa chạy migration 0002 trên Supabase thật, cần bạn tự apply.

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
