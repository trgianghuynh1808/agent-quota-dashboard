# Task: Phase 2g — banner onboarding iOS Safari trước khi xin quyền thông báo

APPROVED_BY_MANAGER

Verify mode: light

## Mục tiêu
- Người dùng iOS Safari (chưa cài PWA) thấy banner hướng dẫn "Share → Add to Home Screen" thay vì bị xin quyền thông báo ngay (iOS chỉ hỗ trợ Web Push khi chạy standalone).
- `Notification.requestPermission()` chỉ được gọi khi người dùng bấm nút "Bật thông báo", và chỉ khi app đã chạy standalone (hoặc không phải iOS Safari).
- Banner có thể đóng, nhớ lựa chọn trong `localStorage`.

## Ý tưởng
- Hàm thuần `getOnboardingState(env)` quyết định trạng thái: `install` (iOS Safari, chưa standalone), `enable` (được phép xin quyền, permission `default`), `hidden` (còn lại).
- Component `PushOnboardingBanner` đọc môi trường thật (userAgent, `navigator.standalone`, `matchMedia`, `Notification.permission`) rồi render theo state; nút "Bật thông báo" mới gọi `Notification.requestPermission()`.
- Gắn banner trên đầu `App.tsx`; chưa đăng ký push subscription (việc đó thuộc task khác).

## Quyết định đã chốt
- Không gọi `requestPermission()` tự động khi mở trang, chỉ khi bấm nút.
- Không đăng ký `PushManager.subscribe` / gọi `/api/subscribe` trong task này.
- Test chỉ bằng Vitest cho hàm thuần (không có Playwright trong repo).

## Ngữ cảnh
- `src/App.tsx`: `<main className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">` chứa 4 component; import dùng đuôi `.js` (vd `./components/QuotaHealthCards.js`).
- Components hiện có là function component + Tailwind v4, tên export có tên (vd `export function CircuitBreakerControls`). Theme tối `#0f172a`.
- Logic thuần nằm ở `src/lib/*.ts`, test Vitest (môi trường Node) ở `tests/<name>.test.ts`, import `../src/lib/x.js`.
- Nhận diện iOS: UA khớp `/iPad|iPhone|iPod/` hoặc (`platform === 'MacIntel'` và `maxTouchPoints > 1`) cho iPadOS. Safari: UA không chứa `CriOS|FxiOS|EdgiOS|OPiOS`. Standalone: `navigator.standalone === true` hoặc `matchMedia('(display-mode: standalone)').matches`.
- Signature đề xuất:
```ts
export type OnboardingState = 'install' | 'enable' | 'hidden'
export interface OnboardingEnv {
  userAgent: string
  platform: string
  maxTouchPoints: number
  standalone: boolean
  notificationPermission: NotificationPermission | 'unsupported'
  dismissed: boolean
}
export function getOnboardingState(env: OnboardingEnv): OnboardingState
export const DISMISS_KEY = 'push-onboarding-dismissed'
```
- Quy tắc: `dismissed` → `hidden`; iOS Safari + chưa standalone → `install`; permission `unsupported`/`granted`/`denied` → `hidden`; còn lại (`default`) → `enable`.
- Lưu ý iOS Safari (chưa standalone) không có `Notification` global nên phải kiểm tra `typeof Notification !== 'undefined'` trước khi đọc.
- Lệnh: `npm run typecheck`, `npx vitest run tests/push-onboarding.test.ts`.

## Plan
- [x] 1. [dễ] `src/lib/push-onboarding.ts` → tạo `getOnboardingState`, `OnboardingState`, `OnboardingEnv`, `DISMISS_KEY` theo quy tắc ở Ngữ cảnh (hàm thuần, không đụng `window`). Chạy `npm run typecheck`.
- [x] 2. [vừa] `src/components/PushOnboardingBanner.tsx` → component `PushOnboardingBanner`: đọc env thật trong `useState` initializer (guard `typeof window/Notification`), dùng `getOnboardingState`; state `install` hiển thị 3 bước "Nhấn Share → Add to Home Screen → mở app từ Home Screen"; state `enable` hiển thị nút "Bật thông báo" gọi `Notification.requestPermission()` rồi cập nhật permission; nút "Đóng" ghi `localStorage[DISMISS_KEY]='1'`. Thêm `data-testid="push-onboarding"` và `data-state`. Rồi `src/App.tsx` → render `<PushOnboardingBanner />` ngay trên `<main>` (bọc fragment) hoặc làm item `md:col-span-3` đầu grid. Ghi dòng `Selectors:` vào "Trạng thái hiện tại". Chạy `npm run typecheck`.
- [x] 3. [vừa] `tests/push-onboarding.test.ts` → viết T1, T2. Chạy `npx vitest run tests/push-onboarding.test.ts`.
- [x] 4. [dễ] `README.md`, `AGENTS.md` → thêm banner onboarding vào Codebase Map (`src/lib/push-onboarding.ts`, `PushOnboardingBanner.tsx`) và tính năng PWA trong README; cập nhật câu "push subscription registration are pending" nếu cần cho đúng. Ghi "Docs checked" vào Trạng thái hiện tại.

## Test cases
- [x] T1. iOS Safari chưa cài PWA → install — `getOnboardingState` trả `install` cho iPhone Safari và iPadOS (MacIntel + touch) khi chưa standalone, kể cả permission `default` — tests/push-onboarding.test.ts
  - Setup: env iPhone UA `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1`, `platform: 'iPhone'`, `standalone: false`, `notificationPermission: 'unsupported'`, `dismissed: false`; biến thể iPad: UA Macintosh, `platform: 'MacIntel'`, `maxTouchPoints: 5`
  - Steps: 1. gọi `getOnboardingState` với từng env · 2. đổi UA sang Chrome iOS (`CriOS/120`) và gọi lại
  - Assert: iPhone → `install`; iPad → `install`; Chrome iOS (CriOS) không phải Safari → không phải `install` (kỳ vọng `hidden` khi permission `unsupported`)
- [x] T2. Standalone/desktop và dismissed — sau khi cài PWA hoặc trên desktop chỉ hiện `enable` khi permission `default`; `dismissed` luôn ẩn — tests/push-onboarding.test.ts
  - Setup: env iPhone Safari với `standalone: true`; env desktop Chrome UA `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/120 Safari/537.36`, `platform: 'MacIntel'`, `maxTouchPoints: 0`
  - Steps: 1. iPhone standalone + permission `default` · 2. cùng env + `granted` · 3. cùng env + `denied` · 4. desktop + `default` · 5. desktop + `default` + `dismissed: true`
  - Assert: 1 → `enable`; 2 → `hidden`; 3 → `hidden`; 4 → `enable`; 5 → `hidden`

## Trạng thái hiện tại
- Bước 1 xong: `src/lib/push-onboarding.ts` (hàm thuần `getOnboardingState`, `OnboardingState`, `OnboardingEnv`, `DISMISS_KEY`). `npm run typecheck` PASS.
- Bước 2 xong: `src/components/PushOnboardingBanner.tsx` (banner `install`/`enable`, nút "Bật thông báo", nút "Đóng") gắn làm item `md:col-span-3` đầu grid trong `src/App.tsx`. `npm run typecheck` PASS.
- Selectors: `[data-testid="push-onboarding"]`, `[data-state="install|enable"]`, nút "Bật thông báo", nút "Đóng" (src/components/PushOnboardingBanner.tsx)
- Bước 3 xong: `tests/push-onboarding.test.ts` (T1, T2). `npm run typecheck` PASS, `npx vitest run tests/push-onboarding.test.ts` PASS (2/2).
- Bước 4 xong: cập nhật `README.md` (Phase 2 overview, project structure, Dashboard, PWA onboarding, Not implemented yet) và `AGENTS.md` (Project Overview, `src/` Codebase Map có `push-onboarding.ts` + `PushOnboardingBanner.tsx`). `npm run typecheck` PASS. Docs checked: đã rà README/AGENTS so với code, các câu về "push subscription registration pending" vẫn đúng (banner chỉ xin quyền, chưa subscribe).

## Test status
- Lần chạy cuối: 2026-11-26 — `npx vitest run tests/push-onboarding.test.ts` (2 passed)
- Kết quả từng test:
  - T1: PASS
  - T2: PASS
- Fail chi tiết: không

## Verify
- Light: typecheck PASS, full vitest 45/45 PASS (T1, T2 PASS), build PASS; không cần kiểm trình duyệt (T1/T2 là hàm thuần).

VERIFY: PASS

## Lưu ý
Lưu ý: banner chỉ xin quyền thông báo, chưa đăng ký push subscription / gọi `/api/subscribe` (task riêng); UI banner chỉ kiểm bằng typecheck và quan sát, không có spec trình duyệt.
Lưu ý: `OnboardingEnv.notificationPermission` dùng union `'default' | 'granted' | 'denied' | 'unsupported'` (tương đương `NotificationPermission | 'unsupported'`) thay vì type DOM toàn cục, vì `tsconfig.api.json` (chiếu `tests/**`) không bật lib DOM nên `NotificationPermission` không tồn tại khi test import module.

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
