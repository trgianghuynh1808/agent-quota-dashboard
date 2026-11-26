# Task: Phase 3b — plugin OpenCode quota-sync.ts với backfillInitialUsage()

APPROVED_BY_USER

Verify mode: none

## Mục tiêu
- Có plugin global `hooks/opencode/quota-sync.ts` (chép vào `~/.config/opencode/plugin/`) đẩy token delta của OpenCode Go tới `POST /api/ingest` (provider `opencode_go`) bằng `fetch()` không chặn, timeout ngắn.
- Có `backfillInitialUsage()` chạy đúng 1 lần ở lần đầu: đọc usage sẵn có trong `~/.local/share/opencode/opencode.db` để lập baseline `cycle_tokens_used`.
- Test bằng `fetch` giả: payload hợp lệ qua `parseIngestPayload`, không đếm trùng, lỗi mạng không làm hỏng OpenCode.

## Ý tưởng
- Logic thuần nằm trong factory có thể inject (`fetch`, đọc usage, đọc/ghi state, env) để test không cần OpenCode, SQLite hay mạng; phần plugin export mỏng bọc factory.
- Event `message.updated` có `info.role === "assistant"`, `info.time.completed`, `info.providerID === "opencode-go"` thì gửi `delta_tokens = info.tokens.total`; dedupe theo `info.id` để mỗi message chỉ đếm 1 lần.
- Backfill: tổng `tokens.total` của message assistant `providerID = 'opencode-go'` trong N ngày gần nhất (mặc định 30) từ SQLite (`bun:sqlite`, mở readonly), gửi 1 delta; ghi file state để không backfill lần nữa.
- Mọi lỗi (fetch, DB, thiếu env) bị nuốt, không bao giờ throw ra ngoài.

## Quyết định đã chốt
- Chỉ làm plugin OpenCode (Phase 3b); không sửa `api/`, không động tới hook Claude Code (T04) hay circuit breaker (T06).
- Secret chỉ lấy từ env `APP_URL`, `INGEST_API_KEY` (tuỳ chọn `OPENCODE_CYCLE_TOKEN_LIMIT`, `OPENCODE_CYCLE_DAYS`, `AGENT_ID`).
- Chu kỳ OpenCode Go không biết chính xác ngày reset: dùng cửa sổ `OPENCODE_CYCLE_DAYS` (mặc định 30) cho backfill.

## Ngữ cảnh
- Payload `opencode_go` (`api/_lib/validate.ts` `parseIngestPayload`): bắt buộc `provider:"opencode_go"`, `agent_id` (non-empty), `delta_tokens` (int >= 0); tuỳ chọn `task_name`, `model`, `input_tokens`/`output_tokens`/`cache_read_tokens` (int >= 0), `cycle_token_limit` (int > 0), `reset_at` (ISO). Auth `Authorization: Bearer $INGEST_API_KEY`, URL `$APP_URL/api/ingest`.
- Dữ liệu local: `~/.local/share/opencode/opencode.db` (SQLite). Bảng `message(id, session_id, time_created, time_updated, data)`, cột `data` là JSON, ví dụ message assistant:
  `{"role":"assistant","modelID":"glm-5.3","providerID":"opencode-go","tokens":{"total":11917,"input":11816,"output":37,"reasoning":64,"cache":{"write":0,"read":0}},"time":{"created":1795255318962,"completed":1795255329622},"finish":"tool-calls"}` (thời gian là epoch ms). Query gợi ý: `SELECT json_extract(data,'$.tokens.total') ...  WHERE json_extract(data,'$.role')='assistant' AND json_extract(data,'$.providerID')='opencode-go' AND time_created >= ?`.
- Plugin OpenCode: file `.ts` export `async ({ client, directory }) => ({ event: async ({ event }) => {...} })`; `event.type === "message.updated"` với `event.properties.info` (cùng shape như `data` ở trên + `id`). Không có package `@opencode-ai/plugin` trong repo: khai báo type tối thiểu tại chỗ, KHÔNG thêm dependency.
- Runtime plugin là Bun, test là Vitest (Node): `bun:sqlite` không import được trong test và `tsc` (tsconfig.api.json include `api/`, `tests/`, không include `hooks/`). Vì vậy: `import("bun:sqlite")` chỉ nằm trong hàm `readUsageFromDb` mặc định (dynamic import, bọc try/catch), logic khác nhận `readUsage` inject. Test import thẳng `../hooks/opencode/quota-sync.js`; để `npm run typecheck` phủ được file này, thêm `"hooks/**/*.ts"` vào `include` của `tsconfig.api.json` và khai báo `declare module "bun:sqlite"` tối thiểu trong `hooks/opencode/bun-sqlite.d.ts` (hoặc cast `as any` tại chỗ dynamic import, chọn cách nào ít file hơn).
- Interface gợi ý:
  ```ts
  export interface SyncDeps {
    fetch: typeof fetch
    env: Record<string, string | undefined>
    now: () => number
    readUsage: (sinceMs: number) => Promise<number>   // tổng tokens.total từ DB
    readState: () => Promise<{ backfilled?: boolean } | null>
    writeState: (s: { backfilled: boolean }) => Promise<void>
  }
  export function createQuotaSync(deps: SyncDeps): {
    backfillInitialUsage(): Promise<void>
    handleEvent(event: unknown): Promise<void>
  }
  export default QuotaSyncPlugin   // Plugin thật, dựng deps mặc định (global fetch, process.env, bun:sqlite, file state ~/.config/opencode/quota-sync.state.json)
  ```
- Fetch fire-and-forget: `deps.fetch(url, { method:"POST", headers, body, signal: AbortSignal.timeout(5000) }).catch(() => {})`; `handleEvent` không await kết quả mạng lâu (test vẫn chờ được vì fetch giả trả ngay).
- Dễ nhầm: `tokens.total` đã gồm cả input + output + reasoning; gửi `delta_tokens = tokens.total`, còn `input_tokens`/`output_tokens`/`cache_read_tokens` gửi kèm riêng (`cache.read`) chỉ để log, không cộng thêm. Backfill gửi `delta_tokens = tổng`, input/output = 0.
- Test: `tests/*.test.ts` (Vitest node, include `tests/**/*.test.ts`). Dùng `vi.fn()` làm `fetch` giả, đọc body bằng `JSON.parse(call[1].body)`. Dữ liệu duy nhất mỗi lần chạy: message id `msg-${Date.now()}`.

## Plan
- [x] 1. [khó] `hooks/opencode/quota-sync.ts` → viết `createQuotaSync(deps)` (`backfillInitialUsage`, `handleEvent`, dedupe theo message id, bỏ qua message chưa `time.completed` / không phải assistant / providerID khác `opencode-go`, thiếu `APP_URL`/`INGEST_API_KEY` thì no-op, nuốt mọi lỗi) và plugin `export default` dựng deps thật (`readUsageFromDb` bằng dynamic `import("bun:sqlite")` mở readonly, state file JSON). Thêm `"hooks/**/*.ts"` vào `include` trong `tsconfig.api.json` (+ khai báo type cho `bun:sqlite` nếu cần). Chạy `npm run typecheck`.
- [x] 2. [vừa] `tests/opencode-plugin.test.ts` → viết spec T1, T2, T3 với `fetch` giả. Chạy: `npx vitest run tests/opencode-plugin.test.ts` và `npm run typecheck`.
- [x] 3. [dễ] `README.md` + `AGENTS.md` → thêm mục cài plugin OpenCode (chép `hooks/opencode/quota-sync.ts` vào `~/.config/opencode/plugin/`, env `APP_URL`/`INGEST_API_KEY`, backfill chạy 1 lần), cập nhật Codebase Map (`hooks/opencode/`) và dòng "Phase 3 chưa build"; không sửa phần Claude hook/circuit breaker của task khác (nếu `hooks/` đã có mô tả từ T04 thì chỉ bổ sung).

## Test cases
- [x] T1. Delta message hoàn tất — plugin gửi payload hợp lệ, không đếm trùng — tests/opencode-plugin.test.ts
  - Setup: `createQuotaSync` với `fetch = vi.fn(async () => new Response("{}"))`, `env = {APP_URL:"http://x.test", INGEST_API_KEY:"k-"+Date.now()}`, `readUsage` trả 0, `readState` trả `{backfilled:true}` (bỏ qua backfill).
  - Steps: 1. `handleEvent({type:"message.updated",properties:{info:{id:"msg-A",role:"assistant",providerID:"opencode-go",modelID:"glm-5.3",tokens:{total:1000,input:900,output:100,reasoning:0,cache:{read:50,write:0}},time:{created:1,completed:2}}}})` 2. gọi lại y hệt lần nữa (cùng id) 3. gọi với message chưa completed (`time:{created:1}`, id `msg-B`) 4. gọi với `providerID:"anthropic"` (id `msg-C`).
  - Assert: `fetch` được gọi đúng 1 lần, tới `http://x.test/api/ingest`, header `Authorization: Bearer <key>`; body qua `parseIngestPayload` ok với `provider="opencode_go"`, `delta_tokens=1000`, `model="glm-5.3"`, `input_tokens=900`, `output_tokens=100`, `cache_read_tokens=50`.
- [x] T2. Backfill 1 lần — baseline từ usage local rồi không lặp — tests/opencode-plugin.test.ts
  - Setup: `readUsage = vi.fn(async () => 123456)`; `readState`/`writeState` giữ state trong biến (ban đầu `null`); fetch giả như T1.
  - Steps: 1. `await backfillInitialUsage()` 2. `await backfillInitialUsage()` lần nữa 3. tạo instance mới dùng chung state, gọi `backfillInitialUsage()`.
  - Assert: `fetch` đúng 1 lần với `delta_tokens=123456` (qua `parseIngestPayload` ok); `writeState` đã được gọi với `{backfilled:true}`; `readUsage` được gọi với `sinceMs` ≈ `now - 30 ngày`; lần 2 và lần 3 không gọi thêm `fetch`.
- [x] T3. Không phá OpenCode — lỗi/thiếu cấu hình thì im lặng — tests/opencode-plugin.test.ts
  - Setup: (a) `fetch` luôn `throw new Error("network")`, env đủ; (b) env thiếu `INGEST_API_KEY` với fetch giả bình thường; `readUsage` có thể throw.
  - Steps: 1. (a) gọi `handleEvent` với message assistant completed hợp lệ và `backfillInitialUsage()` 2. (b) gọi `handleEvent` hợp lệ và `backfillInitialUsage()` với `readUsage` throw.
  - Assert: không promise nào reject; ở (b) `fetch` không được gọi lần nào; backfill lỗi thì không ghi state `backfilled:true` (để thử lại lần sau).

## Trạng thái hiện tại
- Đã hoàn thành bước 1: thêm `createQuotaSync` với backfill một lần, delta `message.updated`, dedupe theo message id, cấu hình env và xử lý lỗi không làm reject; thêm deps thật cho SQLite readonly và state JSON.
- Đã thêm `hooks/**/*.ts` vào `tsconfig.api.json`; dùng dynamic import với tên module biến nên không cần file khai báo `bun:sqlite`.
- Đã hoàn thành bước 2: viết `tests/opencode-plugin.test.ts` (T1–T3) với `vi.fn` làm fetch giả, đọc body qua `parseIngestPayload`, dữ liệu duy nhất mỗi lần chạy (`INGEST_API_KEY: k-${Date.now()}`, message id có hậu tố `Date.now()` ở T3). `npx vitest run tests/opencode-plugin.test.ts` PASS 3/3, `npm run typecheck` PASS.
- Đã hoàn thành bước 3: `README.md` thêm mục "OpenCode Go plugin" (cách chép plugin vào `~/.config/opencode/plugin/`, bảng env `APP_URL`/`INGEST_API_KEY`/`AGENT_ID`/`OPENCODE_CYCLE_TOKEN_LIMIT`/`OPENCODE_CYCLE_DAYS`, backfill 1 lần qua state file), cập nhật Project structure, dòng "Phase 3 chưa build" và "Not implemented yet". `AGENTS.md` cập nhật Project Overview, Architecture (plugin), Codebase Map (`hooks/opencode/`) và App source folders (`hooks/`). Không đụng hook Claude Code/circuit breaker.
- Docs checked: README.md và AGENTS.md đã cập nhật theo code (`hooks/opencode/quota-sync.ts`).

## Test status
- Lần chạy cuối: `npm run typecheck` — PASS (bước 3 chỉ sửa docs, không đổi code nên không chạy lại spec; lần chạy spec gần nhất `npx vitest run tests/opencode-plugin.test.ts` — PASS 3/3).
- Kết quả từng test:
  - T1: PASS
  - T2: PASS
  - T3: PASS
- Fail chi tiết: không có.

## Verify

## Lưu ý
Lưu ý: shape event `message.updated` và schema SQLite của OpenCode (`message.data` JSON) dựa trên dữ liệu thấy trên máy hiện tại; chỉ test bằng fetch/usage giả, chưa chạy trong OpenCode thật.
Lưu ý: ngày reset chu kỳ OpenCode Go không có trong dữ liệu local nên backfill dùng cửa sổ 30 ngày (`OPENCODE_CYCLE_DAYS`), baseline có thể lệch so với chu kỳ thực.

## Đã thử mà không được
-

## Số liệu
- Quota Claude:
- Quota Go:
- Số lần tự sửa:
- Model dùng:
