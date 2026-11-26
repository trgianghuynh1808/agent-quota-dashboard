# Task: T13 Phase 2f — cấu hình PWA (manifest standalone, icon, theme color) + service worker push/notificationclick

APPROVED_BY_MANAGER

Verify mode: light

## Mục tiêu
- Manifest PWA đầy đủ: standalone, theme/background color khớp dashboard tối, icon any + maskable.
- Service worker xử lý `push` (hiện notification từ payload `{title, body}` do `api/_lib/push.ts` gửi) và `notificationclick` (focus tab đang mở hoặc mở `/`).
- App đăng ký service worker khi build production.

## Ý tưởng
- Giữ `vite-plugin-pwa` (generateSW) và thêm `workbox.importScripts: ['push-sw.js']`; handler push/click viết bằng JS thuần trong `public/push-sw.js` (tránh xung đột lib DOM/WebWorker của tsconfig).
- Sửa manifest trong `vite.config.ts` (theme_color khớp nền tối, icon maskable, `scope`, `id`), thêm `theme-color` meta vào `index.html`.
- Đăng ký SW bằng `registerSW` từ `virtual:pwa-register` trong `src/main.tsx` (chỉ production). Test handler bằng Vitest nạp `push-sw.js` vào `vm` với `self` giả.

## Quyết định đã chốt
- Chưa làm đăng ký push subscription (`POST /api/subscribe`) — thuộc task khác; task này chỉ SW + manifest.
- Không thêm file PNG icon: dùng `icon.svg` (sizes `any`) cho cả `any` và `maskable`.

## Ngữ cảnh
- `vite.config.ts` hiện có `VitePWA({ manifest: { name, short_name, display:'standalone', start_url:'/', theme_color:'#0f172a', background_color:'#ffffff', icons:[{src:'/icon.svg', sizes:'any', type:'image/svg+xml', purpose:'any'}] } })`.
- `public/icon.svg` là nền `#0f172a` bo góc (viewBox 64). `index.html` chưa có `<meta name="theme-color">`.
- `src/main.tsx` chỉ render `<App/>` trong StrictMode; chưa đăng ký SW.
- Payload push từ server: `JSON.stringify({ title: string, body: string })` (`NotifyMessage` trong `api/_lib/ingest.ts`).
- `tsconfig.app.json` include `src` (strict, noUnusedLocals); `virtual:pwa-register` cần `/// <reference types="vite-plugin-pwa/client" />` (thêm vào `src/vite-env.d.ts` hoặc file d.ts có sẵn; kiểm tra bằng `npm run typecheck`).
- Test là Vitest môi trường Node (`tests/*.test.ts`), không có Playwright. `public/push-sw.js` là script classic (không import/export); test đọc file bằng `fs.readFileSync` và chạy bằng `node:vm` với `self` giả (`addEventListener`, `registration.showNotification`, `clients.matchAll/openWindow`), event giả có `waitUntil(p)` lưu promise, `data.json()`, `notification.close()`.
- Dễ đoán nhầm: `importScripts` của workbox là đường dẫn tương đối gốc scope (`'push-sw.js'`), file nằm ở `public/` nên được copy nguyên ra `dist/`.

## Plan
- [x] 1. [dễ] `public/push-sw.js` → tạo SW script: listener `push` (parse `event.data.json()` an toàn, fallback title 'Agent Quota Dashboard' / body rỗng; `event.waitUntil(self.registration.showNotification(title, { body, icon: '/icon.svg', badge: '/icon.svg', tag: 'quota-alert', data: { url: '/' } }))`) và listener `notificationclick` (`event.notification.close()`; `waitUntil(clients.matchAll({type:'window', includeUncontrolled:true}))` → focus client đầu tiên nếu có, ngược lại `clients.openWindow(data.url || '/')`).
- [x] 2. [vừa] `vite.config.ts` → cấu hình `VitePWA`: `registerType: 'autoUpdate'`, `workbox: { importScripts: ['push-sw.js'] }`, manifest thêm `id: '/'`, `scope: '/'`, `background_color: '#0f172a'`, `theme_color: '#0f172a'`, icon thứ hai cùng `src` với `purpose: 'maskable'`. Cũng sửa `index.html` thêm `<meta name="theme-color" content="#0f172a" />`, và `src/main.tsx` gọi `registerSW({ immediate: true })` từ `virtual:pwa-register` khi `import.meta.env.PROD`; thêm types reference nếu typecheck đòi. Chạy `npm run typecheck && npm run build`, kiểm tra `dist/manifest.webmanifest` và `dist/sw.js` chứa `push-sw.js`.
- [x] 3. [vừa] `tests/push-sw.test.ts` → viết spec T1, T2 (đọc dòng Selectors không cần: không có UI). Chạy `npx vitest run tests/push-sw.test.ts`.
- [x] 4. [dễ] `README.md` → cập nhật mục PWA/cấu trúc dự án (manifest, `public/push-sw.js`); `AGENTS.md` → cập nhật Project Overview/Codebase Map (Phase 2f: manifest + SW push/notificationclick, `public/`). Xóa câu "push registration pending" chỉ nếu sai; SW đã xử lý push nhưng đăng ký subscription vẫn pending.

## Test cases
- [x] T1. push hiện notification — SW hiển thị title/body từ payload và fallback khi payload hỏng — tests/push-sw.test.ts
  - Setup: nạp `public/push-sw.js` vào `vm` với `self` giả ghi lại `showNotification` calls.
  - Steps: 1. phát event `push` với `data.json()` trả `{title:'Quota auto-pause', body:'claude_code quota reached 96.0%'}` · 2. phát event `push` với `data.json()` throw · 3. phát `push` không có `data`.
  - Assert: lần 1 `showNotification('Quota auto-pause', objectContaining({body:'claude_code quota reached 96.0%', data:{url:'/'}}))`; lần 2 và 3 gọi với title `'Agent Quota Dashboard'` và body `''`; mỗi lần `waitUntil` nhận một promise.
- [x] T2. notificationclick — đóng notification và focus tab có sẵn, hoặc mở mới — tests/push-sw.test.ts
  - Setup: như T1; `clients.matchAll` giả trả mảng.
  - Steps: 1. `matchAll` trả `[{focus: fn}]`, phát `notificationclick` · 2. `matchAll` trả `[]`, phát `notificationclick` với `notification.data.url='/'`.
  - Assert: cả hai lần `notification.close` được gọi; lần 1 `focus` được gọi và `openWindow` không; lần 2 `openWindow('/')` được gọi.

## Trạng thái hiện tại
- Bước 1 xong: tạo `public/push-sw.js` với listener `push` (payload `{title, body}`, fallback title 'Agent Quota Dashboard' / body rỗng, `showNotification` với icon/badge `/icon.svg`, tag `quota-alert`, `data.url='/'`) và listener `notificationclick` (đóng notification, focus tab đang mở hoặc `clients.openWindow(url || '/')`).
- `npm run typecheck` PASS. Không có Playwright spec liên quan (repo không có Playwright).
- Bước 2 xong: `vite.config.ts` thêm `registerType: 'autoUpdate'`, `workbox.importScripts: ['push-sw.js']`, manifest `id`/`scope` `/`, `background_color`/`theme_color` `#0f172a`, icon maskable; `index.html` thêm `<meta name="theme-color" content="#0f172a" />`; `src/main.tsx` gọi `registerSW({ immediate: true })` khi `import.meta.env.PROD` (thêm `src/vite-env.d.ts` với reference `vite/client` + `vite-plugin-pwa/client`).
- `npm run typecheck && npm run build` PASS; `dist/manifest.webmanifest` có `id`/`scope`/`#0f172a`/2 icon, `dist/sw.js` có `importScripts("push-sw.js")`, `dist/push-sw.js` được copy.
- Bước 3 xong: `tests/push-sw.test.ts` nạp `public/push-sw.js` vào `node:vm` với `self` giả, phủ T1 (payload hợp lệ, payload hỏng, không có data) và T2 (focus tab có sẵn, mở window mới).
- Bước 4 xong: `README.md` thêm mục PWA (manifest, `public/push-sw.js`, đăng ký SW) + `public/` trong cấu trúc dự án; `AGENTS.md` cập nhật Project Overview và Codebase Map (`public/`, `main.tsx` đăng ký SW). Vẫn ghi rõ push subscription registration đang pending (đúng: SW xử lý push nhưng chưa đăng ký subscription).
- Docs checked: README.md và AGENTS.md đã cập nhật, không còn câu sai.

## Test status
- Lần chạy cuối: bước 4 — `npm run typecheck` PASS (bước chỉ sửa docs)
- Kết quả từng test:
  - T1: PASS
  - T2: PASS
- Fail chi tiết:

## Verify

- typecheck PASS; `npm run test` 10 file / 43 test PASS (T1, T2 PASS). Đọc diff: đúng plan, docs đã cập nhật. Không có UI nên không chụp ảnh.

VERIFY: PASS

## Lưu ý
- Lưu ý: task này chỉ làm manifest + service worker; chưa có UI/đăng ký push subscription nên chưa thể nhận push thật. SW chỉ được test bằng Vitest (môi trường giả), không thử trên trình duyệt thật.

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
