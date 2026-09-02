-- Phase 2 P2S5 authority/idempotency hardening. Additive and reapply-safe.

-- One Head Council per (Goal, Task Contract): a lost-response retry must
-- reuse the existing Council, never create a conflicting one.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'head_councils'::regclass AND conname = 'head_councils_goal_contract_unique') THEN
    ALTER TABLE head_councils ADD CONSTRAINT head_councils_goal_contract_unique UNIQUE (goal_id, contract_id);
  END IF;
END $$;

-- Once a decision packet is set (resolved or escalated), it is immutable.
-- Application-level idempotent replay short-circuits before reaching the
-- database for identical content; any UPDATE that changes it is a bug or
-- tamper attempt and must fail closed.
CREATE OR REPLACE FUNCTION reject_council_decision_packet_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.decision_packet IS NOT NULL AND NEW.decision_packet IS DISTINCT FROM OLD.decision_packet THEN
    RAISE EXCEPTION 'Council decision packet is immutable once resolved or escalated';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS head_councils_decision_packet_immutable ON head_councils;
CREATE TRIGGER head_councils_decision_packet_immutable
  BEFORE UPDATE ON head_councils
  FOR EACH ROW EXECUTE FUNCTION reject_council_decision_packet_mutation();

-- At most one decision_resolved/decision_escalated event per Council: the
-- read-time anchor check (assertCouncilCreationAnchor's decision counterpart)
-- depends on exactly one durable decision event existing.
CREATE UNIQUE INDEX IF NOT EXISTS council_protocol_events_single_decision_idx
  ON council_protocol_events (council_id)
  WHERE event_type IN ('decision_resolved', 'decision_escalated');

-- A round contribution must be recorded only for a Department actually
-- captured as a participant of that Council; a direct/accidental insert for
-- an uncaptured Department must fail rather than silently succeed.
CREATE OR REPLACE FUNCTION assert_council_round_contribution_participant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  contribution_council_id uuid;
BEGIN
  SELECT r.council_id INTO contribution_council_id FROM council_rounds r WHERE r.round_id = NEW.round_id;
  IF NOT EXISTS (
    SELECT 1 FROM council_participants p
    WHERE p.council_id = contribution_council_id AND p.department_id = NEW.department_id
  ) THEN
    RAISE EXCEPTION 'Council round contribution Department is not a captured participant';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS council_round_contributions_participant_check ON council_round_contributions;
CREATE TRIGGER council_round_contributions_participant_check
  BEFORE INSERT ON council_round_contributions
  FOR EACH ROW EXECUTE FUNCTION assert_council_round_contribution_participant();
