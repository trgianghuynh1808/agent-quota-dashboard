-- Store the OpenCode Go quota windows (5h / 7d / 30d) entered from the console
-- via `hooks/opencode/set-quota.sh` -> POST /api/ingest. The dashboard always
-- renders the three OpenCode rows from this column (no estimated cycle row).
-- Apply with `supabase db push` or paste into the Supabase SQL editor.

alter table quota_snapshots add column if not exists opencode_windows jsonb;
