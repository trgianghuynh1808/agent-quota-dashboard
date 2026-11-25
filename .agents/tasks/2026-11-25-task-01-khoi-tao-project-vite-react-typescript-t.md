# Task: Khởi tạo project Vite + React + TS + Tailwind + PWA và làm Phase 1 backend (docs/SPEC.md)

APPROVED_BY_USER

Verify mode: light
<!-- none: refactor/đổi chữ/không ảnh hưởng UI · light: mặc định · full: luồng người dùng mới, nhiều người dùng, logic đồng bộ -->

## Mục tiêu
- Có project chạy được: Vite + React + TypeScript + Tailwind + vite-plugin-pwa (manifest, service worker nhận push).
- Phase 1 backend theo `docs/SPEC.md` §3, §4: schema 3 bảng, `POST /api/ingest`, `GET /api/status`, gửi Web Push khi tự pause.
- Có `npm run typecheck` và Playwright e2e (API + app shell) chạy được cục bộ, không cần tài khoản cloud.

## Ý tưởng
- Backend: Cloudflare Workers + D1 (SQLite) + Hono, chạy cục bộ bằng `wrangler dev`; migration SQL trong `migrations/`.
- Frontend: Vite SPA tối thiểu (vỏ app + PWA); UI bento grid để Phase 2. Vite dev proxy `/api` sang worker.
- Ingest: claude_code upsert phần trăm tuyệt đối; opencode_go cộng dồn token bằng một câu SQL atomic; vượt ngưỡng thì tự `paused` và gửi Web Push.
- Test: Playwright dựng cả worker + Vite bằng `webServer`, test API bằng `request` fixture.

## Quyết định đã chốt
- Chọn Cloudflare Workers + D1 (một trong hai lựa chọn của SPEC) vì chạy local hoàn toàn bằng wrangler, test được trong CI/room.
- Auth: một bearer token `INGEST_API_KEY` dùng cho `/api/ingest`, `/api/status`, `/api/control`, `/api/push/subscribe` (Phase 1; dashboard Phase 2 sẽ quyết định cách auth riêng nếu cần).
- Icon PWA: dùng SVG trong `public/` (chưa có PNG); không làm UI dashboard, Realtime, host hooks (Phase 2, 3).

## Ngữ cảnh
- Repo chưa có app code: không `package.json`. Cổng dev của phòng: `APP_PORT=4817` (Vite). Worker test chạy cổng `4818`.
- Dependencies dự kiến: `react react-dom`; dev: `vite @vitejs/plugin-react typescript tailwindcss @tailwindcss/vite vite-plugin-pwa workbox-precaching @types/react @types/react-dom @playwright/test wrangler @cloudflare/workers-types`; worker: `hono @block65/webcrypto-web-push`. Nếu `@block65/webcrypto-web-push` không dùng được trên Workers, tự viết VAPID bằng WebCrypto, ghi vào "Đã thử mà không được".
- Scripts `package.json`: `dev` (vite --port 4817 --strictPort), `dev:api` (wrangler dev --port 4818), `build`, `typecheck` = `tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.worker.json --noEmit`, `test:e2e` = `playwright test`.
- Cấu trúc: `src/` (React + `src/sw.ts`), `worker/` (index.ts, db.ts, push.ts, types.ts), `migrations/0001_init.sql`, `wrangler.toml` (D1 binding `DB`, database_name `quota-db`, `main = "worker/index.ts"`), `tests/`.
- PWA: `VitePWA({ strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts', manifest: { name, short_name, display: 'standalone', theme_color, icons: svg } })`. `src/sw.ts` xử lý `push` (showNotification từ JSON `{title, body}`) và `notificationclick` (focus/open `/`).
- Schema (SQLite, theo SPEC §3):
  - `quota_snapshots(provider TEXT PRIMARY KEY, window_5h_percent REAL, window_7d_percent REAL, cycle_tokens_used INTEGER DEFAULT 0, cycle_token_limit INTEGER, reset_at TEXT, updated_at TEXT)`
  - `agent_telemetry_logs(id TEXT PRIMARY KEY, provider, agent_id, task_name, model, input_tokens INT, output_tokens INT, cache_read_tokens INT, created_at TEXT)`
  - `orchestrator_control(id INTEGER PRIMARY KEY CHECK (id=1), global_status TEXT DEFAULT 'running', auto_pause_threshold INT DEFAULT 90, downgrade_model_threshold INT DEFAULT 80, updated_at TEXT)` + seed row id=1
  - `push_subscriptions(endpoint TEXT PRIMARY KEY, p256dh TEXT, auth TEXT, created_at TEXT)` (thêm cho Web Push)
- API contract:
  - `POST /api/ingest` (Bearer). Body: `{provider:'claude_code'|'opencode_go', agent_id, task_name, model, input_tokens, output_tokens, cache_read_tokens, window_5h_percent?, window_7d_percent?, reset_at?, delta_tokens?, cycle_token_limit?}`. Sai bearer → 401; payload sai (provider lạ, thiếu field, claude_code thiếu 2 percent) → 400 JSON `{error}`. Luôn insert log. `claude_code`: UPSERT ghi đè 2 percent + `reset_at`. `opencode_go`: `INSERT ... ON CONFLICT(provider) DO UPDATE SET cycle_tokens_used = cycle_tokens_used + excluded.cycle_tokens_used` (delta = `delta_tokens` ?? input+output; `cycle_token_limit` nếu có thì ghi đè). Trả `{ok:true, usage_percent, global_status}`.
  - % để so ngưỡng: claude_code = `max(window_5h, window_7d)`; opencode_go = `used/limit*100` (limit null/0 → 0). Nếu `>= auto_pause_threshold` và `global_status='running'` → set `'paused'` rồi gọi `sendPushToAll` (chỉ khi đang running, tránh push lặp; lỗi push không làm ingest fail; thiếu VAPID env thì bỏ qua).
  - `GET /api/status` (Bearer) → `{global_status, auto_pause_threshold, downgrade_model_threshold, snapshots: QuotaSnapshot[]}`.
  - `PUT /api/control` (Bearer) body `{global_status?, auto_pause_threshold?, downgrade_model_threshold?}` (validate 'running'|'paused', ngưỡng 1–100) → trả trạng thái mới như status.
  - `POST /api/push/subscribe` (Bearer) body `{endpoint, keys:{p256dh, auth}}` → upsert vào `push_subscriptions`.
- Env của worker (`worker/types.ts` `Env`): `DB: D1Database; INGEST_API_KEY: string; VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string`. Local secrets đặt trong `.dev.vars` (gitignore, thêm vào `.gitignore` cùng `.wrangler/`, `.wrangler-test/`, `dist/`, `node_modules/`, `test-results/`, `playwright-report/`).
- Test facts: không có test hook UI. Playwright `webServer` (2 server, `reuseExistingServer: false`): worker cổng 4818 với lệnh `rm -rf .wrangler-test && npx wrangler d1 migrations apply quota-db --local --persist-to .wrangler-test && npx wrangler dev --port 4818 --persist-to .wrangler-test --var INGEST_API_KEY:test-key`, `url: http://localhost:4818/api/status` KHÔNG dùng được làm readiness vì cần bearer → dùng `url: 'http://localhost:4818/api/health'` (route công khai trả `{ok:true}`, thêm vào worker). Vite cổng 4817 (`PLAYWRIGHT_BASE_URL`). Test API gọi thẳng `http://localhost:4818` với header `Authorization: Bearer test-key`.
- DB dùng chung giữa các test trong một lần chạy: test phải tự reset bằng `PUT /api/control {global_status:'running', auto_pause_threshold:90}` ở đầu và chạy tuần tự (`workers: 1`, `fullyParallel: false`). Dùng `agent_id` duy nhất `agent-${Date.now()}`.
- Chỗ dễ nhầm: `opencode_go` dùng `cycle_tokens_used` cộng dồn nên test phải tính từ giá trị đọc được trước đó, không giả định 0.

## Plan
- [x] 1. [vừa] `package.json` → khởi tạo frontend: tạo `package.json` (scripts như Ngữ cảnh), `vite.config.ts` (react, tailwind, VitePWA injectManifest, `server.proxy['/api'] = 'http://localhost:4818'`), `tsconfig.app.json`, `tsconfig.worker.json`, `index.html`, `src/main.tsx`, `src/App.tsx` (placeholder `<h1 data-testid="app-title">Agent Quota Dashboard</h1>`), `src/index.css` (`@import "tailwindcss"`), `src/sw.ts` (push + notificationclick), `public/icon.svg`; cập nhật `.gitignore`. Chạy `npm install`, `npm run build`.
- [ ] 2. [vừa] `migrations/0001_init.sql` → tạo 4 bảng + seed `orchestrator_control`; `wrangler.toml`; `worker/types.ts` (`Env`, `Provider`, `QuotaSnapshot`, `IngestPayload`); `worker/db.ts` (hàm `upsertClaudeSnapshot`, `incrementOpencodeSnapshot`, `insertLog`, `getControl`, `updateControl`, `getSnapshots`, `saveSubscription`, `listSubscriptions`).
- [ ] 3. [khó] `worker/index.ts` → Hono app: `GET /api/health`, bearer middleware cho `/api/*` (trừ health), `POST /api/ingest` (validate + upsert/increment + kiểm tra ngưỡng + auto-pause), `GET /api/status`, `PUT /api/control`, `POST /api/push/subscribe`; `worker/push.ts` → `sendPushToAll(env, payload)` (VAPID, xóa subscription trả 404/410). Chạy `npm run typecheck`.
- [ ] 4. [vừa] `tests/api.spec.ts` + `tests/app.spec.ts` + `playwright.config.ts` → viết config (2 webServer, `workers: 1`, JSON reporter ra `test-results/results.json`, `use.baseURL = PLAYWRIGHT_BASE_URL ?? 'http://localhost:4817'`) và các test T1–T3. Chạy `npx playwright test` (cài browser nếu thiếu: `npx playwright install chromium`).
- [ ] 5. [dễ] `README.md` → cập nhật: mô tả dự án, stack, cách chạy (`npm install`, `npm run dev`, `npm run dev:api`, migrate D1 local), biến môi trường, API; `AGENTS.md` → thay các mục TODO (Project Overview, Architecture, Codebase Map, Commands, Code Conventions, Test hook) bằng thông tin thật.

## Test cases
- [ ] T1. App shell + PWA — trang tải được, manifest hợp lệ, service worker được đăng ký — tests/app.spec.ts
  - Setup: cả 2 webServer chạy; không cần dữ liệu.
  - Steps: 1. `page.goto('/')` · 2. đọc `[data-testid="app-title"]` · 3. `request.get('/manifest.webmanifest')` · 4. (nếu dev server không phục vụ SW thì chỉ kiểm tra manifest; không dựng build riêng)
  - Assert: title text chứa "Agent Quota Dashboard"; manifest JSON có `display === 'standalone'` và `icons.length >= 1`; `<link rel="manifest">` tồn tại trong `<head>`.
- [ ] T2. Ingest claude_code + opencode_go — upsert tuyệt đối và cộng dồn atomic, auth/validate — tests/api.spec.ts
  - Setup: reset control bằng `PUT /api/control {global_status:'running', auto_pause_threshold:90, downgrade_model_threshold:80}`; `agent_id = agent-${Date.now()}`; header Bearer `test-key`.
  - Steps: 1. `POST /api/ingest` không bearer · 2. POST với `provider:'bogus'` · 3. POST claude_code `{window_5h_percent:10, window_7d_percent:20, reset_at:<ISO tương lai>, tokens...}` rồi POST lần 2 với `window_5h_percent:30, window_7d_percent:25` · 4. `GET /api/status` · 5. POST opencode_go `{cycle_token_limit:1000000, delta_tokens:1000}` hai lần · 6. `GET /api/status`.
  - Assert: (1) 401; (2) 400 có `error`; sau bước 3 snapshot `claude_code` có `window_5h_percent=30`, `window_7d_percent=25` (ghi đè, không cộng); sau bước 5 `cycle_tokens_used` = giá trị trước + 2000 và `cycle_token_limit=1000000`.
- [ ] T3. Auto-pause khi vượt ngưỡng — `global_status` chuyển 'paused' và PUT /api/control resume được — tests/api.spec.ts
  - Setup: reset control như T2 (running, ngưỡng 90, không cấu hình VAPID nên push bị bỏ qua).
  - Steps: 1. POST claude_code `window_5h_percent:50, window_7d_percent:50` → status · 2. POST claude_code `window_5h_percent:95, window_7d_percent:60` → status · 3. `PUT /api/control {global_status:'running'}` → status.
  - Assert: bước 1 `global_status='running'`, response ingest 200; bước 2 ingest trả `global_status:'paused'` và `GET /api/status` cũng `'paused'`; bước 3 trả `'running'`. Ingest vẫn 200 dù không có VAPID.

## Trạng thái hiện tại
<!-- Tiến độ từng bước. Bước tạo/đổi giao diện ghi thêm MỘT dòng: Selectors: #id, .class, [data-x] (file chứa chúng). Bước test đọc dòng này trước khi grep code. -->
- Bước 1 (xong): npm install OK (543 packages); `npm run build` OK — sinh `dist/index.html`, `dist/manifest.webmanifest`, `dist/sw.js` (injectManifest, 6 precache entries). Typecheck phần app (`tsc -p tsconfig.app.json --noEmit`) exit 0.
- Selectors: [data-testid="app-title"] (src/App.tsx), #root (index.html)
- Lưu ý: `npm run typecheck` (toàn bộ) sau bước 1 fail đúng chỗ `tsconfig.worker.json` với TS18003 vì `worker/` chưa có file TS nào — file worker theo plan thuộc bước 2–3; đây là hệ quả của script typecheck gộp 2 config, không phải lỗi của bước 1. Full typecheck được xác nhận lại sau bước 2.
- Lưu ý: `src/sw.ts` bị exclude khỏi `tsconfig.app.json` (cần lib `webworker` riêng — trộn với lib DOM của app sẽ xung đột), nên sw.ts không nằm trong typecheck; `vite build` vẫn transpile sw.ts qua esbuild của vite-plugin-pwa.
- Docs (README/AGENTS.md): theo plan sẽ cập nhật ở bước 5, chưa đụng tới ở bước 1–2.

## Test status
- Lần chạy cuối: chưa có spec nào (bước 4 sẽ viết tests/ + playwright.config.ts); bước 1–2 chỉ chạy typecheck/build theo plan.
- Kết quả từng test:
  - T1: chưa viết
  - T2: chưa viết
  - T3: chưa viết
- Fail chi tiết: -

## Verify
<!-- Bước Verify tự điền: từng kịch bản đã kiểm tra trên trình duyệt, PASS/FAIL, screenshot, lỗi phát hiện, dòng kết luận cuối cùng. -->

## Lưu ý
Lưu ý: chọn Cloudflare Workers + D1 thay vì Supabase (SPEC cho phép cả hai); đổi hướng thì plan phải làm lại.
Lưu ý: Web Push chỉ có code gửi, chưa test gửi thật tới trình duyệt (cần VAPID keys + subscription thật); test chỉ xác nhận ingest không lỗi khi thiếu VAPID.
Lưu ý: UI dashboard, Realtime, host hooks nằm ngoài task này (Phase 2, 3); icon PWA mới chỉ là SVG.

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
