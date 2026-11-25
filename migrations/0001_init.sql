-- 0001_init: initial schema for agent-quota-dashboard (SPEC §3 + push subscriptions)
-- Tables: quota_snapshots, agent_telemetry_logs, orchestrator_control, push_subscriptions

CREATE TABLE IF NOT EXISTS quota_snapshots (
  provider TEXT PRIMARY KEY,
  window_5h_percent REAL,
  window_7d_percent REAL,
  cycle_tokens_used INTEGER NOT NULL DEFAULT 0,
  cycle_token_limit INTEGER,
  reset_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_telemetry_logs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_name TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orchestrator_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  global_status TEXT NOT NULL DEFAULT 'running',
  auto_pause_threshold INTEGER NOT NULL DEFAULT 90,
  downgrade_model_threshold INTEGER NOT NULL DEFAULT 80,
  updated_at TEXT
);

INSERT INTO orchestrator_control (id, global_status, auto_pause_threshold, downgrade_model_threshold, updated_at)
VALUES (1, 'running', 90, 80, NULL)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);
