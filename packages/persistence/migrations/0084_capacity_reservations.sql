CREATE TABLE IF NOT EXISTS capacity_inventories (
  project_id uuid PRIMARY KEY,
  provider_rate integer NOT NULL CHECK (provider_rate >= 0),
  provider_rate_floor integer NOT NULL DEFAULT 0 CHECK (provider_rate_floor >= 0 AND provider_rate_floor <= provider_rate),
  spend_cents bigint NOT NULL CHECK (spend_cents >= 0),
  spend_cents_floor bigint NOT NULL DEFAULT 0 CHECK (spend_cents_floor >= 0 AND spend_cents_floor <= spend_cents),
  worker_slots integer NOT NULL CHECK (worker_slots >= 0),
  worker_slots_floor integer NOT NULL DEFAULT 0 CHECK (worker_slots_floor >= 0 AND worker_slots_floor <= worker_slots),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE IF NOT EXISTS capacity_reservations (
  reservation_id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  command_id uuid NOT NULL,
  provider_rate integer NOT NULL CHECK (provider_rate > 0),
  spend_cents bigint NOT NULL CHECK (spend_cents > 0),
  worker_slots integer NOT NULL CHECK (worker_slots > 0),
  requirement text NOT NULL CHECK (requirement IN ('low', 'medium', 'high')),
  pressure text NOT NULL CHECK (pressure IN ('normal', 'elevated', 'critical')),
  status text NOT NULL CHECK (status IN ('reserved', 'queued', 'released')),
  queue_reason text CHECK (queue_reason IN ('provider_rate', 'spend_cents', 'worker_slots')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  released_at timestamptz,
  demand_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(demand_snapshot) = 'object'),
  actor_id text,
  session_ref text,
  fencing_token bigint,
  UNIQUE (project_id, command_id),
  CHECK ((status = 'queued') = (queue_reason IS NOT NULL)),
  CHECK (status <> 'queued' OR released_at IS NULL),
  CHECK (status <> 'reserved' OR (queue_reason IS NULL AND released_at IS NULL)),
  CHECK ((status = 'released') = (released_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS capacity_reservations_project_status_idx ON capacity_reservations (project_id, status, created_at);
CREATE INDEX IF NOT EXISTS capacity_reservations_goal_idx ON capacity_reservations (goal_id, status);
CREATE INDEX IF NOT EXISTS capacity_reservations_command_idx ON capacity_reservations (command_id);

CREATE OR REPLACE FUNCTION protect_capacity_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'capacity reservations are not deleted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM goals g WHERE g.goal_id = NEW.goal_id AND g.project_id = NEW.project_id) THEN RAISE EXCEPTION 'capacity reservation Goal/project mismatch'; END IF;
  IF (NEW.demand_snapshot->>'projectId')::uuid IS DISTINCT FROM NEW.project_id OR (NEW.demand_snapshot->>'goalId')::uuid IS DISTINCT FROM NEW.goal_id OR (NEW.demand_snapshot->>'commandId')::uuid IS DISTINCT FROM NEW.command_id THEN RAISE EXCEPTION 'capacity reservation demand snapshot identity mismatch'; END IF;
  IF NEW.demand_snapshot->>'providerRate' IS DISTINCT FROM NEW.provider_rate::text OR NEW.demand_snapshot->>'spendCents' IS DISTINCT FROM NEW.spend_cents::text OR NEW.demand_snapshot->>'workerSlots' IS DISTINCT FROM NEW.worker_slots::text OR NEW.demand_snapshot->>'requirement' IS DISTINCT FROM NEW.requirement OR NEW.demand_snapshot->>'pressure' IS DISTINCT FROM NEW.pressure THEN RAISE EXCEPTION 'capacity reservation demand snapshot mismatch'; END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF NEW.reservation_id <> OLD.reservation_id OR NEW.project_id <> OLD.project_id OR NEW.goal_id <> OLD.goal_id OR NEW.command_id <> OLD.command_id
     OR NEW.provider_rate <> OLD.provider_rate OR NEW.spend_cents <> OLD.spend_cents OR NEW.worker_slots <> OLD.worker_slots
     OR NEW.requirement <> OLD.requirement OR NEW.pressure <> OLD.pressure OR NEW.created_at <> OLD.created_at
     OR NEW.demand_snapshot <> OLD.demand_snapshot OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.session_ref IS DISTINCT FROM OLD.session_ref OR NEW.fencing_token IS DISTINCT FROM OLD.fencing_token THEN
    RAISE EXCEPTION 'capacity reservation identity and demand are immutable';
  END IF;
  IF NOT ((OLD.status = 'queued' AND NEW.status IN ('reserved', 'released')) OR (OLD.status = 'reserved' AND NEW.status IN ('queued', 'released'))) THEN
    RAISE EXCEPTION 'invalid capacity reservation lifecycle transition';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS capacity_reservation_guard ON capacity_reservations;
CREATE TRIGGER capacity_reservation_guard BEFORE INSERT OR UPDATE OR DELETE ON capacity_reservations FOR EACH ROW EXECUTE FUNCTION protect_capacity_reservation();
