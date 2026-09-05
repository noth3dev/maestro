-- Phase 5 Track A Slice 1: durable worker ownership, cancellation intent,
-- and append-only restart recovery decisions. Provider execution/invocation
-- references remain the authoritative worker identity.
ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS owner_id text,
  ADD COLUMN IF NOT EXISTS owner_fencing_token bigint,
  ADD COLUMN IF NOT EXISTS owner_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_state text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS cancellation_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_owner_id text,
  ADD COLUMN IF NOT EXISTS cancellation_fencing_token bigint;

ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_recovery_state_check;
ALTER TABLE workers ADD CONSTRAINT workers_recovery_state_check
  CHECK (recovery_state IN ('none', 'fenced', 'provider_cancelled'));
ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_owner_binding_check;
ALTER TABLE workers ADD CONSTRAINT workers_owner_binding_check
  CHECK ((owner_id IS NULL) = (owner_fencing_token IS NULL)
     AND (owner_id IS NULL) = (owner_lease_expires_at IS NULL)
     AND (owner_id IS NULL OR btrim(owner_id) <> '')
     AND (owner_fencing_token IS NULL OR owner_fencing_token > 0));
ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_cancellation_intent_check;
ALTER TABLE workers ADD CONSTRAINT workers_cancellation_intent_check
  CHECK ((cancellation_requested_at IS NULL) = (cancellation_owner_id IS NULL AND cancellation_fencing_token IS NULL)
     AND (cancellation_owner_id IS NULL) = (cancellation_fencing_token IS NULL)
     AND (cancellation_owner_id IS NULL OR btrim(cancellation_owner_id) <> '')
     AND (cancellation_fencing_token IS NULL OR cancellation_fencing_token > 0));

UPDATE workers
SET heartbeat_at = COALESCE(heartbeat_at, observed_at)
WHERE heartbeat_at IS NULL;

CREATE INDEX IF NOT EXISTS workers_owner_lease_idx
  ON workers (owner_id, owner_lease_expires_at)
  WHERE owner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS worker_recovery_decisions (
  decision_id uuid PRIMARY KEY,
  worker_id uuid NOT NULL REFERENCES workers(worker_id),
  owner_id text NOT NULL CHECK (btrim(owner_id) <> ''),
  owner_fencing_token bigint NOT NULL CHECK (owner_fencing_token > 0),
  decision text NOT NULL CHECK (decision IN ('fenced', 'provider_cancelled', 'unknown')),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (worker_id)
);
CREATE INDEX IF NOT EXISTS worker_recovery_decisions_created_idx
  ON worker_recovery_decisions (created_at, decision_id);

CREATE OR REPLACE FUNCTION reject_worker_owner_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR NEW.owner_fencing_token IS DISTINCT FROM OLD.owner_fencing_token)
     AND NOT (OLD.recovery_state <> 'fenced'
          AND NEW.recovery_state = 'fenced'
          AND NEW.status = 'unknown'
          AND NEW.owner_id IS NOT NULL
          AND NEW.owner_fencing_token IS NOT NULL
          AND NEW.owner_lease_expires_at > clock_timestamp()
          AND EXISTS (
            SELECT 1
              FROM head_councils hc
              JOIN goal_leases gl ON gl.goal_id = hc.goal_id
             WHERE hc.council_id = NEW.council_id
               AND gl.owner_id = NEW.owner_id
               AND gl.fencing_token = NEW.owner_fencing_token
               AND gl.expires_at > clock_timestamp()
          )) THEN
    RAISE EXCEPTION 'Worker owner can only change during a first fencing recovery transition';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS workers_owner_immutable ON workers;
CREATE TRIGGER workers_owner_immutable
  BEFORE UPDATE ON workers
  FOR EACH ROW EXECUTE FUNCTION reject_worker_owner_mutation();

CREATE OR REPLACE FUNCTION reject_worker_recovery_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Worker recovery decisions are append-only';
  END IF;
  IF OLD.decision_id IS DISTINCT FROM NEW.decision_id
     OR OLD.worker_id IS DISTINCT FROM NEW.worker_id
     OR OLD.owner_id IS DISTINCT FROM NEW.owner_id
     OR OLD.owner_fencing_token IS DISTINCT FROM NEW.owner_fencing_token
     OR OLD.decision IS DISTINCT FROM NEW.decision
     OR OLD.reason IS DISTINCT FROM NEW.reason
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Worker recovery decisions are append-only';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS worker_recovery_decisions_immutable ON worker_recovery_decisions;
CREATE TRIGGER worker_recovery_decisions_immutable
  BEFORE UPDATE OR DELETE ON worker_recovery_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_worker_recovery_mutation();
