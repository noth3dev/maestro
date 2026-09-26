-- A Head that finds its department unnecessary for the Goal withdraws from the
-- Council before the brief deadline, with a reason, and goes back to sleep.
-- Withdrawal settles the participant for reveal like a submitted brief does.
ALTER TABLE council_participants ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
ALTER TABLE council_participants ADD COLUMN IF NOT EXISTS withdrawal_reason text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'council_participants'::regclass AND conname = 'council_participants_withdrawal_complete') THEN
    ALTER TABLE council_participants ADD CONSTRAINT council_participants_withdrawal_complete
      CHECK ((withdrawn_at IS NULL AND withdrawal_reason IS NULL) OR (withdrawn_at IS NOT NULL AND btrim(withdrawal_reason) <> ''));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'council_participants'::regclass AND conname = 'council_participants_withdrawal_or_absence') THEN
    ALTER TABLE council_participants ADD CONSTRAINT council_participants_withdrawal_or_absence
      CHECK (withdrawn_at IS NULL OR absent_at IS NULL);
  END IF;
END;
$$;

-- An update records exactly one settlement: absence (after the deadline) or
-- withdrawal (before it). Both are immutable once recorded.
CREATE OR REPLACE FUNCTION council_participant_identity_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.council_id IS DISTINCT FROM OLD.council_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.head_role_id IS DISTINCT FROM OLD.head_role_id
     OR NEW.session_ref IS DISTINCT FROM OLD.session_ref THEN
    RAISE EXCEPTION 'frozen Council participant identity is immutable';
  END IF;
  IF OLD.absent_at IS NOT NULL OR OLD.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'Council participant settlement is immutable';
  END IF;
  IF NEW.absent_at IS NOT NULL AND NEW.absence_reason IS NOT NULL AND NEW.withdrawn_at IS NULL AND NEW.withdrawal_reason IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.withdrawn_at IS NOT NULL AND NEW.withdrawal_reason IS NOT NULL AND NEW.absent_at IS NULL AND NEW.absence_reason IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Council participant absence or withdrawal must be recorded atomically';
END;
$$;

ALTER TABLE council_protocol_events DROP CONSTRAINT IF EXISTS council_protocol_events_event_type_check;
ALTER TABLE council_protocol_events ADD CONSTRAINT council_protocol_events_event_type_check CHECK (event_type IN (
  'council_created', 'brief_submitted', 'participant_absent', 'participant_withdrew', 'briefs_revealed',
  'round_recorded', 'council_stopped', 'decision_resolved', 'decision_escalated'
));
