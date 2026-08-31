DO $$ BEGIN
  CREATE TYPE retention_class AS ENUM (
    '30_days_after_goal_close', '90_days', 'project_lifetime', 'until_superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS command_receipts (
  command_id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  actor_id text NOT NULL CHECK (actor_id <> ''),
  command_type text NOT NULL CHECK (command_type <> ''),
  expected_version bigint NOT NULL CHECK (expected_version >= 0),
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'version_conflict', 'rejected')),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  record_version integer NOT NULL DEFAULT 1 CHECK (record_version = 1),
  retention retention_class NOT NULL DEFAULT 'project_lifetime'
);
CREATE INDEX IF NOT EXISTS command_receipts_goal_created_idx ON command_receipts (goal_id, created_at, command_id);

CREATE TABLE IF NOT EXISTS goal_events (
  global_position bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
  event_type text NOT NULL CHECK (event_type <> ''),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  command_id uuid NOT NULL REFERENCES command_receipts(command_id),
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (goal_id, aggregate_version)
);
CREATE INDEX IF NOT EXISTS goal_events_command_idx ON goal_events (command_id);

CREATE TABLE IF NOT EXISTS goals (
  goal_id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('draft','ready_for_confirmation','launched','active','pausing','paused','resuming','stopping','stopped','blocked','certifying','succeeded','failed','recovering')),
  version bigint NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  retention retention_class NOT NULL DEFAULT 'project_lifetime'
);
CREATE INDEX IF NOT EXISTS goals_nonterminal_recovery_idx ON goals (project_id, updated_at, goal_id) WHERE state NOT IN ('stopped','succeeded','failed');

CREATE TABLE IF NOT EXISTS outbox (
  outbox_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE REFERENCES goal_events(event_id),
  topic text NOT NULL CHECK (topic <> ''),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  available_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  locked_by text,
  locked_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK ((locked_by IS NULL) = (locked_until IS NULL)),
  CHECK (delivered_at IS NULL OR delivered_at >= created_at)
);
CREATE INDEX IF NOT EXISTS outbox_ready_idx ON outbox (available_at, outbox_id) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS outbox_expired_claim_idx ON outbox (locked_until, outbox_id) WHERE delivered_at IS NULL AND locked_until IS NOT NULL;
