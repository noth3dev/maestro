ALTER TABLE head_councils ADD COLUMN IF NOT EXISTS snapshot_payload jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'head_councils_snapshot_payload_object') THEN
    ALTER TABLE head_councils ADD CONSTRAINT head_councils_snapshot_payload_object
      CHECK (jsonb_typeof(snapshot_payload) = 'object');
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM head_councils WHERE snapshot_payload IS NULL) THEN
    RAISE EXCEPTION 'cannot backfill complete sealed-submission snapshots for existing councils';
  END IF;
END $$;
ALTER TABLE head_councils ALTER COLUMN snapshot_payload SET NOT NULL;

ALTER TABLE council_participants ADD COLUMN IF NOT EXISTS session_ref text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'council_participants_session_ref_nonblank') THEN
    ALTER TABLE council_participants ADD CONSTRAINT council_participants_session_ref_nonblank
      CHECK (session_ref IS NOT NULL AND btrim(session_ref) <> '');
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM council_participants WHERE session_ref IS NULL) THEN
    RAISE EXCEPTION 'cannot backfill frozen participant session references for existing councils';
  END IF;
END $$;
ALTER TABLE council_participants ALTER COLUMN session_ref SET NOT NULL;

ALTER TABLE independent_briefs ADD COLUMN IF NOT EXISTS payload_hash char(64);
ALTER TABLE independent_briefs ADD COLUMN IF NOT EXISTS idempotency_key text;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM independent_briefs WHERE payload_hash IS NULL OR idempotency_key IS NULL) THEN
    RAISE EXCEPTION 'cannot backfill brief payload identities for existing councils';
  END IF;
END $$;
ALTER TABLE independent_briefs ALTER COLUMN payload_hash SET NOT NULL;
ALTER TABLE independent_briefs ALTER COLUMN idempotency_key SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'independent_briefs_payload_hash_format') THEN
    ALTER TABLE independent_briefs ADD CONSTRAINT independent_briefs_payload_hash_format CHECK (payload_hash ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'independent_briefs_idempotency_key_nonblank') THEN
    ALTER TABLE independent_briefs ADD CONSTRAINT independent_briefs_idempotency_key_nonblank CHECK (btrim(idempotency_key) <> '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'independent_briefs_idempotency_key_unique') THEN
    ALTER TABLE independent_briefs ADD CONSTRAINT independent_briefs_idempotency_key_unique UNIQUE (council_id, idempotency_key);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'head_councils_escalation_non_executable') THEN
    ALTER TABLE head_councils ADD CONSTRAINT head_councils_escalation_non_executable
      CHECK (
        state <> 'escalated' OR (
          decision_packet->>'outcome' = 'escalated'
          AND decision_packet->>'executionDisposition' = 'non_executable'
          AND jsonb_typeof(decision_packet->'workerPlan') = 'array'
          AND jsonb_array_length(decision_packet->'workerPlan') = 0
          AND jsonb_typeof(decision_packet->'criticalActions') = 'array'
          AND jsonb_array_length(decision_packet->'criticalActions') = 0
        ) IS TRUE
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS council_protocol_events (
  event_sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  council_id uuid NOT NULL REFERENCES head_councils(council_id),
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  event_type text NOT NULL CHECK (event_type IN (
    'council_created', 'brief_submitted', 'participant_absent', 'briefs_revealed',
    'round_recorded', 'council_stopped', 'decision_resolved', 'decision_escalated'
  )),
  actor_id text NOT NULL CHECK (btrim(actor_id) <> ''),
  session_ref text NOT NULL CHECK (btrim(session_ref) <> ''),
  command_id text,
  idempotency_key text,
  command_or_idempotency_id text NOT NULL CHECK (btrim(command_or_idempotency_id) <> ''),
  snapshot_hash char(64) NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  evidence_lineage jsonb NOT NULL CHECK (jsonb_typeof(evidence_lineage) = 'object'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (command_id IS NOT NULL OR idempotency_key IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS council_protocol_events_council_sequence_idx
  ON council_protocol_events (council_id, event_sequence);
CREATE INDEX IF NOT EXISTS council_protocol_events_goal_occurred_idx
  ON council_protocol_events (goal_id, occurred_at, event_sequence);

CREATE OR REPLACE FUNCTION reject_council_protocol_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'council protocol events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS council_protocol_events_append_only ON council_protocol_events;
CREATE TRIGGER council_protocol_events_append_only
  BEFORE UPDATE OR DELETE ON council_protocol_events
  FOR EACH ROW EXECUTE FUNCTION reject_council_protocol_event_mutation();

CREATE OR REPLACE FUNCTION council_participant_identity_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.council_id IS DISTINCT FROM OLD.council_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.session_ref IS DISTINCT FROM OLD.session_ref THEN
    RAISE EXCEPTION 'frozen Council participant identity is immutable';
  END IF;
  IF OLD.absent_at IS NOT NULL
     AND (NEW.absent_at IS DISTINCT FROM OLD.absent_at OR NEW.absence_reason IS DISTINCT FROM OLD.absence_reason) THEN
    RAISE EXCEPTION 'Council participant absence is immutable';
  END IF;
  IF OLD.absent_at IS NULL
     AND (NEW.absent_at IS NULL OR NEW.absence_reason IS NULL) THEN
    RAISE EXCEPTION 'Council participant absence must be recorded atomically';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS council_participant_identity_immutable ON council_participants;
CREATE TRIGGER council_participant_identity_immutable
  BEFORE UPDATE ON council_participants
  FOR EACH ROW EXECUTE FUNCTION council_participant_identity_immutable();
