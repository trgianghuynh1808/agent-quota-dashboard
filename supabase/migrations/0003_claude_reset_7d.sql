-- Store the Claude Code 7d window reset separately from the 5h reset.
-- `reset_at` keeps holding the 5h reset (OpenCode Go still uses it).
-- Apply with `supabase db push` or paste into the Supabase SQL editor.

alter table quota_snapshots add column if not exists reset_7d_at timestamptz;
