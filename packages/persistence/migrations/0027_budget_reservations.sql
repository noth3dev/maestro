-- Phase 2 work-sequence step 11: budget reservations and milestone
-- forecasts. Additive only. Reservations are hierarchical and append-only:
-- a Goal-level reservation is the top envelope; Department reservations are
-- carved from it (bounded by the quality/recovery reserve); Mission
-- reservations are carved from their Department. Increasing a Goal-level
-- envelope beyond its prior amount requires an explicit CEO approval flag.

CREATE TABLE IF NOT EXISTS budget_reservations (
  reservation_id uuid PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('goal', 'department', 'mission')),
  goal_id uuid NOT NULL REFERENCES goals (goal_id),
  department_id text REFERENCES departments (department_id),
  council_id uuid,
  plan_version integer,
  item_id text,
  parent_reservation_id uuid REFERENCES budget_reservations (reservation_id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  ceo_approved boolean NOT NULL DEFAULT false,
  actor_id text NOT NULL CHECK (actor_id <> ''),
  session_ref text NOT NULL CHECK (session_ref <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  CHECK ((scope = 'goal') = (department_id IS NULL AND parent_reservation_id IS NULL)),
  CHECK ((scope = 'department') = (department_id IS NOT NULL AND council_id IS NOT NULL AND parent_reservation_id IS NOT NULL AND plan_version IS NULL AND item_id IS NULL)),
  CHECK ((scope = 'mission') = (department_id IS NOT NULL AND council_id IS NOT NULL AND plan_version IS NOT NULL AND item_id IS NOT NULL AND parent_reservation_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS budget_reservations_goal_idx ON budget_reservations (goal_id, scope, created_at);
CREATE INDEX IF NOT EXISTS budget_reservations_parent_idx ON budget_reservations (parent_reservation_id);

CREATE OR REPLACE FUNCTION reject_budget_reservation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Budget reservations are append-only';
END;
$$;
DROP TRIGGER IF EXISTS budget_reservations_immutable ON budget_reservations;
CREATE TRIGGER budget_reservations_immutable
  BEFORE UPDATE OR DELETE ON budget_reservations
  FOR EACH ROW EXECUTE FUNCTION reject_budget_reservation_mutation();

-- A milestone forecast is a durable, revisable (append-only, latest wins by
-- recorded_at) projection against one reservation; not itself a spend.
CREATE TABLE IF NOT EXISTS budget_forecasts (
  forecast_id uuid PRIMARY KEY,
  reservation_id uuid NOT NULL REFERENCES budget_reservations (reservation_id),
  milestone text NOT NULL CHECK (btrim(milestone) <> ''),
  projected_cents bigint NOT NULL CHECK (projected_cents >= 0),
  confidence text NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  actor_id text NOT NULL CHECK (actor_id <> ''),
  session_ref text NOT NULL CHECK (session_ref <> ''),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime'
);
CREATE INDEX IF NOT EXISTS budget_forecasts_reservation_idx ON budget_forecasts (reservation_id, recorded_at);
DROP TRIGGER IF EXISTS budget_forecasts_immutable ON budget_forecasts;
CREATE TRIGGER budget_forecasts_immutable
  BEFORE UPDATE OR DELETE ON budget_forecasts
  FOR EACH ROW EXECUTE FUNCTION reject_budget_reservation_mutation();
