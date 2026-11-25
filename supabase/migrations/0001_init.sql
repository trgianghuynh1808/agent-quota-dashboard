-- Phase 1 schema: Unified Multi-Agent Quota & Telemetry Dashboard.
-- Apply with `supabase db push` or paste into the Supabase SQL editor.

create table if not exists quota_snapshots (
  provider text primary key check (provider in ('claude_code', 'opencode_go')),
  window_5h_percent float8,
  window_7d_percent float8,
  cycle_tokens_used bigint not null default 0,
  cycle_token_limit bigint,
  reset_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists agent_telemetry_logs (
  id uuid primary key default gen_random_uuid(),
  provider text,
  agent_id text not null,
  task_name text,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists agent_telemetry_logs_created_at_idx
  on agent_telemetry_logs (created_at desc);

create index if not exists agent_telemetry_logs_agent_id_created_at_idx
  on agent_telemetry_logs (agent_id, created_at desc);

create table if not exists orchestrator_control (
  id int primary key default 1 check (id = 1),
  global_status text not null default 'running' check (global_status in ('running', 'paused')),
  auto_pause_threshold int not null default 90,
  downgrade_model_threshold int not null default 80,
  updated_at timestamptz not null default now()
);

insert into orchestrator_control (id) values (1) on conflict do nothing;

create table if not exists push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

-- Only the service role touches these tables in Phase 1; Realtime read
-- policies for the PWA are added in Phase 2.
alter table quota_snapshots enable row level security;
alter table agent_telemetry_logs enable row level security;
alter table orchestrator_control enable row level security;
alter table push_subscriptions enable row level security;

alter publication supabase_realtime add table quota_snapshots, agent_telemetry_logs, orchestrator_control;

create or replace function increment_opencode_usage(
  delta bigint,
  p_limit bigint default null,
  p_reset_at timestamptz default null
)
returns quota_snapshots
language sql
security definer
set search_path = public
as $$
  insert into quota_snapshots (provider, cycle_tokens_used, cycle_token_limit, reset_at)
  values ('opencode_go', delta, p_limit, p_reset_at)
  on conflict (provider) do update
    set cycle_tokens_used = quota_snapshots.cycle_tokens_used + delta,
        cycle_token_limit = coalesce(p_limit, quota_snapshots.cycle_token_limit),
        reset_at = coalesce(p_reset_at, quota_snapshots.reset_at),
        updated_at = now()
  returning *;
$$;

revoke execute on function increment_opencode_usage(bigint, bigint, timestamptz) from public, anon, authenticated;
