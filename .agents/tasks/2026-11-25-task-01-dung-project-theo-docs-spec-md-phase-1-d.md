# Task: Dựng project Phase 1 (Supabase + Vercel API routes)

APPROVED_BY_MANAGER

Verify mode: light
<!-- Không có UI trong task này: Verify chỉ chạy bộ test + typecheck + build, không mở trình duyệt. -->

## Mục tiêu
Theo `docs/SPEC.md` Phase 1: khung Vite + React + TS + Tailwind + vite-plugin-pwa, schema 3 bảng trên Supabase (SQL migration), `POST /api/ingest` và `GET /api/status` (Vercel API routes, bearer `INGEST_API_KEY`), tự pause khi vượt ngưỡng + gửi Web Push (VAPID). Không làm UI dashboard (Phase 2), không làm host hooks (Phase 3). Không Cloudflare/D1/wrangler.

## Ý tưởng
- Khung Vite/React/TS/Tailwind/PWA tối thiểu (trang placeholder), thư mục `api/` là Vercel Node functions, `supabase/migrations/` chứa SQL.
- Logic nghiệp vụ nằm trong `api/_lib/` và nhận interface `Db` + `notify` được inject; bản thật dùng `@supabase/supabase-js` với service role đọc từ env, bản test dùng `FakeDb` trong bộ nhớ nên không cần Supabase thật.
- `opencode_go` tăng atomic qua hàm SQL RPC `increment_opencode_usage`; `claude_code` upsert tuyệt đối. Sau đó so với `auto_pause_threshold`, vượt thì set `paused` và gửi Web Push (`web-push`) tới bảng `push_subscriptions`.
- Test bằng vitest (không có UI nên không dùng Playwright).

## Quyết định đã chốt
- Supabase (Postgres + Realtime), không Cloudflare. Backend = Vercel API routes trong `api/`.
- Key service role chỉ ở server qua env; `.env.example` chỉ có mẫu, không secret.
- Thêm bảng thứ 4 `push_subscriptions` (SPEC không liệt kê nhưng Web Push cần nơi lưu subscription). Endpoint đăng ký subscription để Phase 2.
- Quy ước payload ingest do plan này định nghĩa (SPEC chưa chốt), xem Ngữ cảnh.

## Ngữ cảnh
- Repo chưa có `package.json`/source. `node_modules/` và `dist/` đã bị gitignore (`dist/` cũ là rác, bỏ qua). File biến môi trường thật đã được gitignore, chỉ file mẫu `.env.example` được commit.
- Dùng imports tương đối KÈM đuôi `.js` trong `api/` (Vercel chạy ESM; vite/vitest tự map `.js` → `.ts`). `package.json` có `"type": "module"`.
- Scripts cần có: `dev` (vite), `build` (`tsc -b && vite build`), `typecheck` (`tsc -b --noEmit` hoặc tương đương, bao cả `api/` và `tests/`), `test` (`vitest run`).
- Deps: runtime `react react-dom @supabase/supabase-js web-push`; dev `vite @vitejs/plugin-react typescript tailwindcss @tailwindcss/vite vite-plugin-pwa vitest @vercel/node @types/react @types/react-dom @types/web-push @types/node`.
- Env: `INGEST_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:...). Không đọc env ở top-level module khi import (để test import được): đọc trong hàm `getEnv()`.
- Schema (migration `supabase/migrations/0001_init.sql`):
  - `quota_snapshots(provider text pk check in ('claude_code','opencode_go'), window_5h_percent float8, window_7d_percent float8, cycle_tokens_used bigint not null default 0, cycle_token_limit bigint, reset_at timestamptz, updated_at timestamptz not null default now())`
  - `agent_telemetry_logs(id uuid pk default gen_random_uuid(), provider text, agent_id text not null, task_name text, model text, input_tokens int not null default 0, output_tokens int not null default 0, cache_read_tokens int not null default 0, created_at timestamptz not null default now())`; index `(created_at desc)` và `(agent_id, created_at desc)`.
  - `orchestrator_control(id int pk default 1 check (id = 1), global_status text not null default 'running' check in ('running','paused'), auto_pause_threshold int not null default 90, downgrade_model_threshold int not null default 80, updated_at timestamptz not null default now())` + `insert ... values (1) on conflict do nothing`.
  - `push_subscriptions(endpoint text pk, p256dh text not null, auth text not null, created_at timestamptz default now())`.
  - Bật RLS trên cả 4 bảng, không tạo policy (chỉ service role truy cập; Phase 2 sẽ thêm policy đọc cho Realtime). `alter publication supabase_realtime add table quota_snapshots, agent_telemetry_logs, orchestrator_control;`.
  - Hàm `increment_opencode_usage(delta bigint, p_limit bigint default null, p_reset_at timestamptz default null) returns quota_snapshots` (security definer): `insert ... on conflict (provider) do update set cycle_tokens_used = quota_snapshots.cycle_tokens_used + delta, cycle_token_limit = coalesce(p_limit, quota_snapshots.cycle_token_limit), reset_at = coalesce(p_reset_at, quota_snapshots.reset_at), updated_at = now()` rồi trả về dòng đó. `revoke execute ... from public, anon, authenticated`.
- Payload `POST /api/ingest` (JSON, header `Authorization: Bearer <INGEST_API_KEY>`), tự validate bằng tay (không thêm zod):
  - chung: `provider` ('claude_code'|'opencode_go'), `agent_id` string không rỗng, tuỳ chọn `task_name`, `model` (string), `input_tokens`, `output_tokens`, `cache_read_tokens` (số nguyên >= 0, mặc định 0).
  - `claude_code`: `window_5h_percent`, `window_7d_percent` (số 0..100, bắt buộc), `reset_at` (ISO string, tuỳ chọn).
  - `opencode_go`: `delta_tokens` (số nguyên >= 0, bắt buộc), `cycle_token_limit` (số nguyên > 0, tuỳ chọn), `reset_at` (tuỳ chọn).
  - Response: 401 thiếu/sai bearer (so sánh `crypto.timingSafeEqual`), 405 sai method, 400 `{error}` payload sai, 200 `{ok:true, global_status, paused_now: boolean}`.
- Phần trăm dùng để so ngưỡng: `claude_code` = `max(window_5h_percent, window_7d_percent)`; `opencode_go` = `cycle_tokens_used / cycle_token_limit * 100` (bỏ qua nếu limit null hoặc 0). Chỉ pause khi đang `running` và `pct >= auto_pause_threshold`; `paused_now` true và gửi push đúng một lần khi chuyển trạng thái.
- `GET /api/status`: cùng bearer auth, trả `{global_status, auto_pause_threshold, downgrade_model_threshold, snapshots: QuotaSnapshot[]}`; 405 nếu không phải GET.
- Thiết kế thư mục `api/_lib/` (thư mục gạch dưới không thành route Vercel):
  - `types.ts`: `Provider`, `IngestPayload` (discriminated union), `QuotaSnapshot`, `Control`, interface `Db { insertLog(p); upsertClaudeSnapshot(p): Promise<QuotaSnapshot>; incrementOpencode(delta, limit?, resetAt?): Promise<QuotaSnapshot>; getControl(): Promise<Control>; setPaused(): Promise<void>; listSnapshots(): Promise<QuotaSnapshot[]> }`.
  - `auth.ts`: `isAuthorized(header: string | undefined, key: string | undefined): boolean` (false nếu key rỗng).
  - `validate.ts`: `parseIngestPayload(body: unknown): { ok: true; value: IngestPayload } | { ok: false; error: string }`.
  - `ingest.ts`: `processIngest(db: Db, payload, notify: (msg: {title: string; body: string}) => Promise<void>): Promise<{ global_status; paused_now }>`; lỗi `notify` bị nuốt (log), không làm hỏng ingest.
  - `supabase-db.ts`: `createSupabaseDb(): Db` dùng `createClient(url, serviceKey, { auth: { persistSession: false } })`; `incrementOpencode` gọi `.rpc('increment_opencode_usage', ...)`.
  - `push.ts`: `createPushNotifier(): notify` — `web-push` `setVapidDetails`, đọc `push_subscriptions` bằng client service role, `sendNotification` song song với `Promise.allSettled`, xoá subscription trả 404/410.
  - Handler: `api/ingest.ts` và `api/status.ts` `export default async function handler(req: VercelRequest, res: VercelResponse)`; để test được, mỗi file cũng `export function createIngestHandler(deps)` / `createStatusHandler(deps)` và default export gọi nó với deps thật (tạo lười trong handler, không ở top-level).
- Test: vitest, môi trường node, không import Supabase thật. `FakeDb` đặt ở `tests/fake-db.ts` (in-memory, `incrementOpencode` cộng dồn, `control` mặc định `{global_status:'running', auto_pause_threshold:90, downgrade_model_threshold:80}`). Gọi handler với `req`/`res` giả tối thiểu (`{method, headers, body}` và res có `status().json()`), hoặc test trực tiếp `processIngest`. Chỗ dễ nhầm: tên hàm RPC là `increment_opencode_usage`; `dist/` cũ không phải output của project này.

## Plan
- [x] 1. [vừa] `package.json` → dựng khung: `package.json` (scripts + deps ở Ngữ cảnh), `tsconfig.json` + `tsconfig.app.json` (src) + `tsconfig.api.json` (api, tests; types node/vitest), `vite.config.ts` (react, tailwind, VitePWA với manifest standalone/theme color, icon dùng lại `public/icon.svg`), `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx` (placeholder một dòng tiêu đề), `src/index.css` (`@import "tailwindcss"`), `public/icon.svg`, `vercel.json` (chỉ cần nếu muốn chỉ rõ rewrite SPA, giữ `api/*` không bị rewrite), `.env.example` (6 biến, giá trị rỗng). Chạy `npm install`, rồi `npm run typecheck && npm run build` phải pass.
- [x] 2. [dễ] `supabase/migrations/0001_init.sql` → viết đúng schema, RLS, publication và hàm `increment_opencode_usage` như mô tả ở Ngữ cảnh.
- [x] 3. [khó] `api/_lib/types.ts` → viết các file `types.ts`, `auth.ts`, `validate.ts`, `ingest.ts` (`processIngest`) đúng chữ ký ở Ngữ cảnh; logic ngưỡng/pause/notify một lần; nội dung push: title "Quota auto-pause", body nêu provider và phần trăm. Chạy `npm run typecheck`.
- [x] 4. [vừa] `api/_lib/supabase-db.ts` → viết `supabase-db.ts`, `push.ts`, `api/ingest.ts`, `api/status.ts` (factory + default export, mã trạng thái như Ngữ cảnh, chỉ nhận đúng method). Không đọc env khi import. Chạy `npm run typecheck`.
- [x] 5. [vừa] `tests/fake-db.ts` → viết `FakeDb` + `tests/api.test.ts` cho T1–T3 (xem Test cases). Chạy `npx vitest run tests/api.test.ts`, rồi `npm run typecheck`.
- [x] 6. [dễ] `README.md` → viết lại: mô tả dự án, stack (Vite/React/TS/Tailwind/PWA, Vercel API routes, Supabase), cấu trúc thư mục, bảng biến môi trường, cách áp migration (`supabase db push` hoặc dán SQL), schema payload ingest/status kèm ví dụ `curl`, lệnh `dev/build/typecheck/test`, ghi rõ Phase 2/3 chưa làm. Cập nhật `AGENTS.md` (Project Overview, Architecture, Codebase Map, Commands, Code Conventions, Testing Rules "Test hook: none" → ghi rằng test là vitest + FakeDb) cho khớp code; xoá các dòng TODO không còn đúng. Ghi "Docs checked" vào Trạng thái hiện tại.

## Test cases
- [x] T1. Auth và validate — từ chối request sai — tests/api.test.ts
  - Setup: `FakeDb` mặc định; handler `createIngestHandler({ db, notify, apiKey: 'k' })` và `createStatusHandler` tương tự.
  - Steps: 1. POST không header · 2. POST bearer sai · 3. GET `/api/ingest` (đúng key) · 4. POST đúng key, `provider:'claude_code'` thiếu `window_7d_percent` · 5. POST đúng key, `opencode_go` với `delta_tokens: -5` · 6. status với key sai.
  - Assert: 401 · 401 · 405 · 400 · 400 · 401; `db.logs.length === 0` sau cả 6.
- [x] T2. Ingest cập nhật snapshot — claude upsert tuyệt đối, opencode cộng dồn — tests/api.test.ts
  - Setup: `FakeDb` mặc định, `notify` là `vi.fn()`.
  - Steps: 1. POST claude `{agent_id:'a1', input_tokens:10, output_tokens:5, cache_read_tokens:3, window_5h_percent:20, window_7d_percent:30}` · 2. POST claude lần nữa với 5h=25, 7d=31 · 3. POST opencode `{delta_tokens:100, cycle_token_limit:1000}` rồi `{delta_tokens:50}` · 4. GET status.
  - Assert: bước 1 và 2 trả 200, `paused_now:false`; snapshot claude có 5h=25, 7d=31 (ghi đè, không cộng); `db.logs.length === 4` với log đầu có `input_tokens:10, cache_read_tokens:3`; snapshot opencode `cycle_tokens_used === 150`, `cycle_token_limit === 1000`; status trả `global_status:'running'`, `snapshots.length === 2`; `notify` chưa được gọi.
- [x] T3. Tự pause + push đúng một lần — vượt ngưỡng thì pause — tests/api.test.ts
  - Setup: `FakeDb` với `auto_pause_threshold: 90`, `notify = vi.fn().mockResolvedValue(undefined)`.
  - Steps: 1. POST claude với 5h=89, 7d=10 · 2. POST claude với 5h=40, 7d=91 · 3. POST claude với 5h=95, 7d=95 · 4. (test phụ trong cùng file) opencode limit 100, `delta_tokens:90` trên DB mới · 5. `notify` ném lỗi, POST claude 5h=99 trên DB mới.
  - Assert: bước 1 `paused_now:false`, status vẫn `running` · bước 2 `paused_now:true`, `db.control.global_status === 'paused'`, `notify` gọi 1 lần · bước 3 `paused_now:false`, `notify` vẫn 1 lần · bước 4 `paused_now:true` (90 >= 90) · bước 5 vẫn trả 200 và `paused_now:true` dù `notify` lỗi.

## Trạng thái hiện tại
Bước 1 xong: dựng khung Vite + React 19 + TS + Tailwind v4 + vite-plugin-pwa (trang placeholder 1 dòng tiêu đề). File: package.json, package-lock.json, tsconfig.json/tsconfig.app.json/tsconfig.api.json, vite.config.ts, vitest.config.ts, index.html, src/main.tsx, src/App.tsx, src/index.css, public/icon.svg, vercel.json (rewrite SPA loại trừ `api/*` bằng negative lookahead `"/((?!api/).*)"`), .env.example (6 biến, giá trị rỗng).
Selectors: #root (index.html), h1 (src/App.tsx, class "text-2xl font-semibold p-4")
Ghi chú kỹ thuật: tsconfig.api.json (dùng cho `tsc -b`) ngoài `api/**`/`tests/**` còn include vite.config.ts + vitest.config.ts vì bước 1 chưa có file nào trong api/tests (project rỗng sẽ làm `tsc -b` lỗi TS18003); khi bước 3/5 thêm file thì tự động được phủ typecheck.
Phiên bản đã chốt: typescript ~5.9.3 (không dùng typescript@7.0.2 mới ra để tránh rủi ro hành vi `tsc -b`), web-push ^3.6.7 (web-push@4.0.0 chưa kèm types, @types/web-push vẫn dừng ở 3.x), vite ^8.3.8 + @vitejs/plugin-react 6 + @tailwindcss/vite 4.3.5 + vite-plugin-pwa 2 + vitest 5.1.2 (peer-range khớp vite 8), @types/node ^24 (khớp Node 24 local).
Lưu ý: npm audit báo ~12 vuln (1 low/7 moderate/4 high) ở dev-deps gián tiếp của @vercel/node, @vercel/nft, tsx (busboy, path-to-regexp, ajv, glob, minimatch, esbuild) — không thuộc runtime app; chưa fix vì `npm audit fix` yêu cầu breaking change; không chặn task này.
Lưu ý: step 1 chưa chạy `npm test` — chưa có test nào (spec thuộc bước 5); kiểm tra của bước 1 chỉ gồm npm install + typecheck + build như plan.
Bước 2 xong: thêm `supabase/migrations/0001_init.sql` với 4 bảng (`quota_snapshots`, `agent_telemetry_logs`, `orchestrator_control`, `push_subscriptions`), 2 index log, RLS bật trên cả 4 bảng (không policy), publication `supabase_realtime` cho 3 bảng nghiệp vụ, và hàm `increment_opencode_usage` (security definer, revoke execute khỏi public/anon/authenticated). Kiểm tra: `npm run typecheck` PASS; không có Playwright/vitest spec nào cho bước này.
Bước 3 xong: thêm `api/_lib/{types,auth,validate,ingest}.ts`. `parseIngestPayload` validate tay (provider, agent_id, token số nguyên >= 0 mặc định 0, claude window 0..100 bắt buộc, opencode delta >= 0 + limit > 0 tuỳ chọn, reset_at ISO); `isAuthorized` dùng `timingSafeEqual`, false nếu key rỗng; `processIngest` insert log → cập nhật snapshot → đọc control → pause + notify đúng một lần khi `running` và pct >= ngưỡng, lỗi notify bị nuốt (chỉ `console.error`). Kiểm tra: `npm run typecheck` PASS; chưa có spec cho bước này.
Bước 4 xong: thêm `api/_lib/supabase-db.ts` (createSupabaseDb đọc env trong hàm, upsert claude tuyệt đối, RPC `increment_opencode_usage`, control/snapshot helpers), `api/_lib/push.ts` (createPushNotifier đọc env khi gọi, `Promise.allSettled`, xoá subscription 404/410), `api/ingest.ts` + `api/status.ts` (factory `createIngestHandler`/`createStatusHandler` nhận `{db, notify?, apiKey}`, default export tạo deps lười; 405 → 401 → 400/200). Kiểm tra: `npm run typecheck` PASS; chưa có spec cho bước này.
Bước 5 xong: thêm `tests/fake-db.ts` (FakeDb in-memory: logs, snapshots, control default running/90/80) và `tests/api.test.ts` (5 test: T1, T2, 3 test T3). `npx vitest run tests/api.test.ts` → 5 passed; `npm run typecheck` PASS.
Bước 6 xong: viết lại `README.md` (mô tả, stack, cấu trúc, env, migration, API + curl, commands, Phase 2/3 chưa làm) và cập nhật `AGENTS.md` (Project Overview, Architecture, Codebase Map, Commands, Code Conventions, Testing Rules) — đã xoá các dòng TODO "no app code". Docs checked: README.md + AGENTS.md khớp code hiện tại (không còn TODO). Kiểm tra: `npm run typecheck` PASS.

## Test status
- Lần chạy cuối: `npm run typecheck` (bước 6) → PASS; `npx vitest run tests/api.test.ts` (bước 5) → 5 passed (bước 6 chỉ sửa docs, không đổi test).
- Kết quả từng test:
  - T1: PASS
  - T2: PASS
  - T3: PASS
- Fail chi tiết: không có.

## Verify
- Typecheck: PASS
- `npm test` (cả bộ): 5 passed (T1, T2, T3 PASS)
- `npm run build`: PASS
- Không có UI nên không mở trình duyệt, không chụp ảnh.

VERIFY: PASS

## Lưu ý
Lưu ý: thêm bảng thứ 4 `push_subscriptions` ngoài 3 bảng trong SPEC để lưu Web Push subscription; endpoint đăng ký subscription (và policy RLS cho Realtime) để Phase 2.
Lưu ý: không kiểm tra với Supabase thật; chỉ test bằng `FakeDb`, nên SQL migration và hàm RPC `increment_opencode_usage` chưa được chạy thử trên Postgres.

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
