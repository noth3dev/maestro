-- Durable state for the first automatic post-Launch orchestration stage.
-- This records only the Head activation stage; Council and later stages remain
-- separate consumers and must not be inferred from this row.
CREATE TABLE IF NOT EXISTS goal_orchestration_runs (
  goal_id uuid PRIMARY KEY REFERENCES goals(goal_id),
  project_id uuid NOT NULL,
  task_contract_id uuid NOT NULL,
  start_command_id uuid NOT NULL UNIQUE,
  actor_id text,
  stage text NOT NULL CHECK (stage = 'head_activation'),
  state text NOT NULL CHECK (state IN ('running', 'blocked', 'unknown', 'completed')),
  head_activation_plan_hash char(64),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (head_activation_plan_hash IS NULL OR head_activation_plan_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS goal_orchestration_runs_project_idx ON goal_orchestration_runs(project_id, state);

CREATE TABLE IF NOT EXISTS goal_orchestration_history (
  history_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goal_orchestration_runs(goal_id),
  command_id uuid NOT NULL,
  event_key text NOT NULL CHECK (btrim(event_key) <> ''),
  stage text NOT NULL CHECK (stage = 'head_activation'),
  state text NOT NULL CHECK (state IN ('running', 'blocked', 'unknown', 'completed')),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (goal_id, event_key)
);
CREATE INDEX IF NOT EXISTS goal_orchestration_history_goal_idx ON goal_orchestration_history(goal_id, created_at, history_id);
