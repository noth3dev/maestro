-- Phase 3 remediation: durable incurred spend, separate from reservations/forecasts.
-- Additive only; every entry is immutable and contributes to the Goal's actual spend.

CREATE TABLE IF NOT EXISTS goal_actual_costs (
  cost_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goals (goal_id),
  command_id uuid NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  source text NOT NULL CHECK (btrim(source) <> ''),
  actor_id text NOT NULL CHECK (btrim(actor_id) <> ''),
  session_ref text NOT NULL CHECK (btrim(session_ref) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime'
);
CREATE INDEX IF NOT EXISTS goal_actual_costs_goal_idx ON goal_actual_costs (goal_id, recorded_at, cost_id);
CREATE UNIQUE INDEX IF NOT EXISTS goal_actual_costs_command_idx ON goal_actual_costs (goal_id, command_id);

CREATE OR REPLACE FUNCTION reject_goal_actual_cost_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Goal actual cost records are immutable once recorded';
END;
$$;
DROP TRIGGER IF EXISTS goal_actual_costs_immutable ON goal_actual_costs;
CREATE TRIGGER goal_actual_costs_immutable
  BEFORE UPDATE OR DELETE ON goal_actual_costs
  FOR EACH ROW EXECUTE FUNCTION reject_goal_actual_cost_mutation();
