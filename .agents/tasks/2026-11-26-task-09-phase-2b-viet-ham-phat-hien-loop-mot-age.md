# Task: Phase 2b — hàm phát hiện loop theo agent_id (src/lib/anomaly.ts)

APPROVED_BY_MANAGER

Verify mode: none

## Mục tiêu
Hàm thuần `detectLoops` báo agent_id nào đang "đốt token liên tục" trong cửa sổ 3 phút (SPEC mục Burn Rate & Anomaly Monitor), kèm test Vitest, không cần mạng/UI.

## Ý tưởng
- Gom mẫu token theo `agent_id` trong cửa sổ `(now-3p, now]`, tham số `now` truyền vào như `src/lib/quota.ts`.
- Một agent bị coi là loop khi đốt liên tục: cả 3 khoảng 60s của cửa sổ đều có ít nhất 1 mẫu, và tổng token trong cửa sổ ≥ ngưỡng (mặc định 30_000).
- Trả về danh sách `{ agentId, totalTokens, turns, tpm }` sắp xếp theo totalTokens giảm dần.

## Quyết định đã chốt
- Ngưỡng/cửa sổ có mặc định nhưng cho override qua tham số `opts`.
- Chỉ nhận mẫu đã chuẩn hóa (`at` là ms); chưa nối Supabase hay UI (việc của T11).

## Ngữ cảnh
- `src/lib/quota.ts` đã có `TokenSample { at: number; tokens: number }` và `tokensPerMinute(samples, now, windowMs = 180_000)`; cửa sổ là `(now - windowMs, now]`. Có thể import `tokensPerMinute` để tính tpm.
- `LogEntry` ở `api/_lib/types.ts` có `agent_id`, `input_tokens`, `output_tokens`, `cache_read_tokens`. Tokens của một lượt = input + output (không cộng cache_read).
- Import trong `src/` và `tests/` dùng đuôi `.js` (vd `'../src/lib/anomaly.js'`).
- Test kiểu Vitest như `tests/quota.test.ts` (`describe/it/expect` từ 'vitest').
- Chữ ký:
```ts
export interface AgentTokenSample { agentId: string; at: number; tokens: number }
export interface LoopOptions { windowMs?: number; minTokens?: number; buckets?: number }
export interface LoopAlert { agentId: string; totalTokens: number; turns: number; tpm: number }
export const LOOP_WINDOW_MS = 180_000
export const LOOP_MIN_TOKENS = 30_000
export function toAgentSample(e: Pick<LogEntry,'agent_id'|'input_tokens'|'output_tokens'>, at: number): AgentTokenSample
export function detectLoops(samples: AgentTokenSample[], now: number, opts?: LoopOptions): LoopAlert[]
```
- Bucket: chia cửa sổ thành `buckets` (mặc định 3) khoảng bằng nhau; bucket i chứa mẫu có `at` trong `(now - windowMs + i*size, now - windowMs + (i+1)*size]`.

## Plan
- [x] 1. [dễ] `src/lib/anomaly.ts` → tạo file với `toAgentSample` và `detectLoops` theo chữ ký ở Ngữ cảnh (lọc mẫu ngoài cửa sổ, bỏ tokens ≤ 0, gom theo agentId, kiểm tra đủ bucket và tổng ≥ minTokens, sort giảm dần theo totalTokens). Chạy `npm run typecheck`.
- [x] 2. [vừa] `tests/anomaly.test.ts` → viết spec cho T1–T3 bên dưới. Chạy `npx vitest run tests/anomaly.test.ts`.
- [x] 3. [dễ] `AGENTS.md` → cập nhật dòng `src/` trong Codebase Map: thêm `src/lib/anomaly.ts` (loop detection theo agent_id, nhận `now` như tham số). Ghi "Docs checked" vào Trạng thái hiện tại (README không nhắc helper nên không đổi).

## Test cases
- [x] T1. Phát hiện loop — agent đốt đều 3 bucket vượt ngưỡng bị báo — tests/anomaly.test.ts
  - Setup: now = 1_000_000; agent 'a' có mẫu 12_000 token tại now-150_000, now-90_000, now-30_000 (tổng 36_000).
  - Steps: gọi `detectLoops(samples, now)`.
  - Assert: đúng 1 alert, `agentId` 'a', `totalTokens` 36000, `turns` 3, `tpm` 12000.
- [x] T2. Không báo nhầm — burn dồn một cục, không liên tục, hoặc dưới ngưỡng — tests/anomaly.test.ts
  - Setup: agent 'b' 40_000 token chỉ tại now-10_000 (thiếu bucket); agent 'c' 3 mẫu 1_000 đủ 3 bucket (dưới ngưỡng); agent 'd' đủ 3 bucket nhưng mẫu cũ nằm tại now-200_000 (ngoài cửa sổ) làm thiếu bucket đầu.
  - Steps: gọi `detectLoops` với các mẫu trên.
  - Assert: kết quả `[]`.
- [x] T3. Nhiều agent + override + toAgentSample — sort giảm dần, tách theo agent, opts hoạt động — tests/anomaly.test.ts
  - Setup: agent 'x' tổng 36_000, agent 'y' tổng 60_000, đều đủ 3 bucket; một mẫu với `toAgentSample({agent_id:'x',input_tokens:100,output_tokens:50}, 5)`.
  - Steps: `detectLoops` mặc định; rồi `detectLoops(..., { minTokens: 50_000 })`.
  - Assert: mặc định → thứ tự ['y','x']; với minTokens 50_000 → chỉ ['y']; `toAgentSample` trả `{ agentId:'x', at:5, tokens:150 }`.

## Trạng thái hiện tại
- Bước 1 xong: tạo `src/lib/anomaly.ts` với `LOOP_WINDOW_MS`, `LOOP_MIN_TOKENS`, `toAgentSample`, `detectLoops`. Bucket theo đúng định nghĩa `(start + i*size, start + (i+1)*size]` (dùng `Math.ceil` khi tính index). `npm run typecheck` PASS.
- Bước 2 xong: thêm `tests/anomaly.test.ts` cho T1–T3. `npx vitest run tests/anomaly.test.ts` PASS (3/3).
- Bước 3 xong: cập nhật dòng `src/` trong `AGENTS.md` Codebase Map, thêm `src/lib/anomaly.ts`. Docs checked: README không nhắc helper nên không đổi; spec `docs/SPEC.md` đã mô tả Burn Rate & Anomaly Monitor ở mức sản phẩm, không cần sửa.
- Không có thay đổi UI nên không có dòng Selectors.

## Test status
- Lần chạy cuối: bước 3 — `npm run typecheck` PASS; spec gần nhất `npx vitest run tests/anomaly.test.ts` PASS (1 file, 3 test)
- Kết quả từng test:
  - T1: PASS
  - T2: PASS
  - T3: PASS
- Fail chi tiết: không

## Verify

## Lưu ý

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
