# Task: Phase 2e — Remote Circuit Breaker Controls (mock API)

APPROVED_BY_MANAGER

Verify mode: light

## Mục tiêu
- Thêm component `CircuitBreakerControls` vào dashboard: toggle RUNNING/PAUSED, input ngưỡng cảnh báo (mặc định 80) và ngưỡng auto-pause (mặc định 90).
- Component gọi qua interface `ControlApi` (có thể giả lập); hiện dùng bản mock trong bộ nhớ, chưa gọi `/api/control` thật (việc của T15).
- Validate ngưỡng giống server: số nguyên 1..100, cảnh báo ≤ auto-pause.

## Ý tưởng
- Logic thuần ở `src/lib/circuit-breaker.ts` (validate ngưỡng, dựng patch chỉ chứa field đã đổi) để test bằng Vitest.
- Interface `ControlApi { getControl(); updateControl(patch) }` ở `src/lib/control-api.ts` + `createMockControlApi()` giữ state trong bộ nhớ; component nhận `api` qua prop.
- Component `src/components/CircuitBreakerControls.tsx` (Tailwind, cùng style card hiện có), gắn vào `App.tsx`.

## Quyết định đã chốt
- Dùng lại type `Control`, `ControlPatch`, `GlobalStatus` từ `api/_lib/types.ts` (field `downgrade_model_threshold` = ngưỡng cảnh báo, `auto_pause_threshold` = auto-pause).
- Không thêm thư viện test UI (không có jsdom/testing-library/Playwright config); test chỉ Vitest cho logic thuần + mock API.
- Không gọi mạng thật, không đụng `api/`.

## Ngữ cảnh
- `api/_lib/types.ts`: `Control { global_status: GlobalStatus ('running'|'paused'); auto_pause_threshold: number; downgrade_model_threshold: number }`, `ControlPatch = Partial<Control>`.
- Server rule (`api/_lib/validate.ts`, `api/control.ts`): threshold là số nguyên 1..100; `downgrade_model_threshold <= auto_pause_threshold`, nếu không trả 400.
- Import trong `src/` dùng đuôi `.js` (vd `import { x } from '../lib/quota.js'`); import type từ `'../../api/_lib/types.js'`.
- Style card hiện có (xem `src/components/BurnRateMonitor.tsx`): `<section data-testid="..." className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">`.
- `src/App.tsx`: `<main className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">` chứa QuotaHealthCards, BurnRateMonitor, rồi `<div className="md:col-span-3">` bọc ActiveAgentsFeed. Thêm component mới vào grid (một ô, không phá layout).
- Vitest chạy môi trường Node: spec chỉ import `src/lib/*.ts`, KHÔNG import `.tsx`.
- Giá trị mặc định của mock: `{ global_status: 'running', auto_pause_threshold: 90, downgrade_model_threshold: 80 }`.
- Doc cần cập nhật: `README.md` (mục "Dashboard (Phase 2, mock data)", project structure) và `AGENTS.md` (Codebase Map dòng `src/`).

## Plan
- [x] 1. [vừa] `src/lib/circuit-breaker.ts` → tạo `validateThresholds(warn: number, pause: number): string | null` (null = hợp lệ; lỗi nếu không phải số nguyên 1..100 hoặc warn > pause) và `buildControlPatch(current: Control, draft: { global_status; warn: number; pause: number }): ControlPatch` (chỉ chứa field khác `current`). Tạo `src/lib/control-api.ts` → `interface ControlApi { getControl(): Promise<Control>; updateControl(patch: ControlPatch): Promise<Control> }` và `createMockControlApi(initial?: Control, delayMs = 0): ControlApi` (state trong bộ nhớ, updateControl merge patch và trả bản sao; từ chối bằng Error nếu merged vi phạm `validateThresholds`). Chạy `npm run typecheck`.
- [x] 2. [vừa] `src/components/CircuitBreakerControls.tsx` → `CircuitBreakerControls({ api }: { api: ControlApi })`: load `api.getControl()` khi mount; nút toggle `role="switch"` hiển thị "RUNNING"/"PAUSED" (đổi trạng thái gọi `updateControl({ global_status })`); hai `<input type="number" min=1 max=100>` cho ngưỡng cảnh báo/auto-pause cùng nút "Lưu" (disabled khi `validateThresholds` trả lỗi hoặc chưa có thay đổi; gọi `updateControl(buildControlPatch(...))`); hiện thông báo lỗi validate và lỗi từ api; trạng thái PAUSED nhấn mạnh màu đỏ. Thêm `data-testid`: `circuit-breaker`, `cb-toggle`, `cb-warn-input`, `cb-pause-input`, `cb-save`, `cb-error`. Sửa `src/App.tsx`: tạo api một lần bằng `useMemo(() => createMockControlApi(), [])` và render `<CircuitBreakerControls api={api} />` trong grid. Chạy `npm run typecheck && npm run build`. Ghi dòng `Selectors:` vào "Trạng thái hiện tại".
- [x] 3. [vừa] `tests/circuit-breaker.test.ts` → viết spec cho T1–T2 (Vitest, import từ `../src/lib/circuit-breaker.js` và `../src/lib/control-api.js`). Chạy `npx vitest run tests/circuit-breaker.test.ts`.
- [x] 4. [dễ] `README.md` → cập nhật mục Dashboard + project structure (CircuitBreakerControls, control-api mock, circuit-breaker lib) và `AGENTS.md` Codebase Map (dòng `src/`); sửa mọi câu không còn đúng. Ghi "Docs checked" vào "Trạng thái hiện tại".

## Test cases
- [x] T1. Validate ngưỡng — `validateThresholds` khớp luật server — tests/circuit-breaker.test.ts
  - Setup: không cần dữ liệu.
  - Steps: 1. gọi `validateThresholds(80, 90)` · 2. `(90, 90)` · 3. `(91, 90)` · 4. `(0, 90)` · 5. `(80, 101)` · 6. `(80.5, 90)`.
  - Assert: 1–2 trả `null`; 3–6 trả chuỗi lỗi không rỗng.
- [x] T2. Patch + mock API — `buildControlPatch` chỉ gồm field đổi; `createMockControlApi` merge và từ chối giá trị sai — tests/circuit-breaker.test.ts
  - Setup: `api = createMockControlApi()` (mặc định running/90/80).
  - Steps: 1. `buildControlPatch(current, { global_status: 'paused', warn: 80, pause: 90 })` · 2. `await api.updateControl({ global_status: 'paused' })` rồi `getControl()` · 3. `await api.updateControl({ downgrade_model_threshold: 95 })`.
  - Assert: 1 → `{ global_status: 'paused' }` đúng bằng; 2 → `global_status === 'paused'`, hai ngưỡng giữ 90/80; 3 → promise reject (95 > 90) và `getControl()` vẫn trả `downgrade_model_threshold === 80`.

## Trạng thái hiện tại
- Bước 1 xong: tạo `src/lib/circuit-breaker.ts` (`validateThresholds` khớp luật server: số nguyên 1..100, warn <= pause; `buildControlPatch` chỉ gồm field khác `current`) và `src/lib/control-api.ts` (`ControlApi`, `createMockControlApi(initial?, delayMs=0)`: state in-memory, merge patch, trả bản sao, throw Error khi merged vi phạm `validateThresholds`). `npm run typecheck` PASS.
- Bước 2 xong: thêm `src/components/CircuitBreakerControls.tsx` (toggle RUNNING/PAUSED qua `updateControl({ global_status })`, hai input number 1..100, nút "Lưu" disabled khi validate lỗi hoặc chưa đổi, hiện lỗi validate/api ở `cb-error`, PAUSED nền đỏ) và render trong grid `src/App.tsx` qua `useMemo(() => createMockControlApi(), [])`. `npm run typecheck && npm run build` PASS (không có Playwright spec liên quan).
- Bước 3 xong: viết `tests/circuit-breaker.test.ts` (T1: 6 case cho `validateThresholds`; T2: 3 case cho `buildControlPatch` + `createMockControlApi`). `npx vitest run tests/circuit-breaker.test.ts` PASS 9/9.
- Bước 4 xong: `README.md` cập nhật mục Dashboard (thêm Circuit Breaker Controls + rule validate + ghi rõ đang dùng mock `ControlApi`, chưa gọi `/api/control`), project structure (`components/`, `lib/`) và mục "Not implemented yet"; `AGENTS.md` cập nhật Project Overview và Codebase Map dòng `src/` (component + `circuit-breaker.ts`/`control-api.ts`). Docs checked: no stale statements left. Docs-only, không có Playwright spec; `npm run typecheck` PASS.
Selectors: [data-testid="circuit-breaker"], [data-testid="cb-toggle"] (role="switch"), [data-testid="cb-warn-input"], [data-testid="cb-pause-input"], [data-testid="cb-save"], [data-testid="cb-error"] (src/components/CircuitBreakerControls.tsx)

## Test status
- Lần chạy cuối: npx vitest run tests/circuit-breaker.test.ts (sau bước 3, kèm npm run typecheck trước đó). Bước 4 là docs-only: không có test mới, chỉ chạy `npm run typecheck` (PASS).
- Kết quả từng test:
  - T1: PASS (6 assertions — null cho (80,90) và (90,90); lỗi không rỗng cho (91,90), (0,90), (80,101), (80.5,90))
  - T2: PASS (3 assertions — patch chỉ gồm `global_status`; merge giữ 90/80; reject khi warn 95 > pause 90 và state giữ 80)
- Fail chi tiết:

## Verify
- Typecheck + vitest (41 test) PASS; T1, T2 PASS.
- Browser (cổng 4817): bấm toggle -> chuyển PAUSED (PASS); nhập cảnh báo 95 > auto-pause 90 -> hiện lỗi validate ở `cb-error` (PASS). Ảnh: `.agents/screenshots/task-12-circuit-breaker.png`.

VERIFY: PASS

## Lưu ý

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
