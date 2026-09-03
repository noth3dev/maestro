-- Phase 4 work-sequence step 8: link one Firefly incident to exactly one
-- remediation Goal, and record its eventual closure. Additive only.
ALTER TABLE firefly_incidents
  ADD COLUMN IF NOT EXISTS linked_goal_id uuid REFERENCES goals(goal_id),
  ADD COLUMN IF NOT EXISTS resolution_summary text,
  ADD COLUMN IF NOT EXISTS retained_risk text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'firefly_incidents_linked_goal_unique' AND conrelid = 'firefly_incidents'::regclass) THEN
    ALTER TABLE firefly_incidents ADD CONSTRAINT firefly_incidents_linked_goal_unique UNIQUE (linked_goal_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS firefly_incidents_linked_goal_idx ON firefly_incidents (linked_goal_id);

-- A resolved or false-positive incident is closed and durable; its closure
-- fields cannot be edited or removed once set, and status cannot leave a
-- closed state. Linking a Goal is only permitted while open/triaging.
CREATE OR REPLACE FUNCTION reject_firefly_incident_closure_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('resolved', 'false_positive') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.resolution_summary IS DISTINCT FROM OLD.resolution_summary
      OR NEW.retained_risk IS DISTINCT FROM OLD.retained_risk
      OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
      RAISE EXCEPTION 'A closed Firefly incident is final';
    END IF;
  END IF;
  IF NEW.linked_goal_id IS DISTINCT FROM OLD.linked_goal_id AND OLD.linked_goal_id IS NOT NULL THEN
    RAISE EXCEPTION 'A Firefly incident''s linked Goal is immutable once set';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS firefly_incidents_closure_immutable ON firefly_incidents;
CREATE TRIGGER firefly_incidents_closure_immutable BEFORE UPDATE ON firefly_incidents
  FOR EACH ROW EXECUTE FUNCTION reject_firefly_incident_closure_mutation();
