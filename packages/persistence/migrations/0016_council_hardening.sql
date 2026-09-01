-- Phase 2 Council hardening. This migration is additive and safe to reapply.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'head_councils_decision_outcome_matches_state') THEN
    ALTER TABLE head_councils ADD CONSTRAINT head_councils_decision_outcome_matches_state
      CHECK ((
        (state = 'resolved' AND decision_packet->>'outcome' = 'decided')
        OR (state = 'escalated' AND decision_packet->>'outcome' = 'escalated')
        OR (state NOT IN ('resolved', 'escalated') AND decision_packet IS NULL)
      ) IS TRUE);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS council_protocol_events_single_creation_idx
  ON council_protocol_events (council_id)
  WHERE event_type = 'council_created';

CREATE OR REPLACE FUNCTION reject_council_snapshot_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.brief_deadline IS DISTINCT FROM OLD.brief_deadline
     OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
     OR NEW.snapshot_payload IS DISTINCT FROM OLD.snapshot_payload THEN
    RAISE EXCEPTION 'Council snapshot identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS head_councils_snapshot_identity_immutable ON head_councils;
CREATE TRIGGER head_councils_snapshot_identity_immutable
  BEFORE UPDATE ON head_councils
  FOR EACH ROW EXECUTE FUNCTION reject_council_snapshot_identity_mutation();
