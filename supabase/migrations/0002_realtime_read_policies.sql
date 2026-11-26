-- Phase 2: allow the PWA (anon key) to read the dashboard data over Realtime.
-- The three data tables get a select policy for anon/authenticated;
-- push_subscriptions stays fully locked to the service role.
-- Apply with `supabase db push` or paste into the Supabase SQL editor.

create policy "quota_snapshots_read_realtime" on quota_snapshots
  for select to anon, authenticated using (true);

create policy "agent_telemetry_logs_read_realtime" on agent_telemetry_logs
  for select to anon, authenticated using (true);

create policy "orchestrator_control_read_realtime" on orchestrator_control
  for select to anon, authenticated using (true);
