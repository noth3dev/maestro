-- Phase 4 work-sequence step 8: link one Discord incident to exactly one
-- remediation Goal, and record its eventual closure. Additive only.
ALTER TABLE discord_incidents
  ADD COLUMN IF NOT EXISTS linked_goal_id uuid REFERENCES goals(goal_id),
  ADD COLUMN IF NOT EXISTS resolution_summary text,
  ADD COLUMN IF NOT EXISTS retained_risk text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discord_incidents_linked_goal_unique' AND conrelid = 'discord_incidents'::regclass) THEN
    ALTER TABLE discord_incidents ADD CONSTRAINT discord_incidents_linked_goal_unique UNIQUE (linked_goal_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS discord_incidents_linked_goal_idx ON discord_incidents (linked_goal_id);

-- A resolved or false-positive incident is closed and durable; its closure
-- fields cannot be edited or removed once set, and status cannot leave a
-- closed state. Linking a Goal is only permitted while open/triaging.
CREATE OR REPLACE FUNCTION reject_discord_incident_closure_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('resolved', 'false_positive') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.resolution_summary IS DISTINCT FROM OLD.resolution_summary
      OR NEW.retained_risk IS DISTINCT FROM OLD.retained_risk
      OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
      RAISE EXCEPTION 'A closed Discord incident is final';
    END IF;
  END IF;
  IF NEW.linked_goal_id IS DISTINCT FROM OLD.linked_goal_id AND OLD.linked_goal_id IS NOT NULL THEN
    RAISE EXCEPTION 'A Discord incident''s linked Goal is immutable once set';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS discord_incidents_closure_immutable ON discord_incidents;
CREATE TRIGGER discord_incidents_closure_immutable BEFORE UPDATE ON discord_incidents
  FOR EACH ROW EXECUTE FUNCTION reject_discord_incident_closure_mutation();
