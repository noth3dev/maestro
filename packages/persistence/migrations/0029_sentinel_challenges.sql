-- Phase 3 work-sequence step 2: Sentinel challenges, evidence attachments,
-- bounded correction requests, and safe-pause requests. Additive only.

CREATE TABLE IF NOT EXISTS sentinel_challenges (
  challenge_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goals (goal_id),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  evidence_references jsonb NOT NULL CHECK (jsonb_typeof(evidence_references) = 'array'),
  status text NOT NULL CHECK (status IN ('open', 'correction_requested', 'safe_paused', 'resolved')),
  correction_request text,
  raised_by text NOT NULL CHECK (raised_by <> ''),
  resolved_by text,
  resolution_reason text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  resolved_at timestamptz,
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_reason IS NOT NULL)),
  CHECK (status <> 'correction_requested' OR correction_request IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS sentinel_challenges_goal_idx ON sentinel_challenges (goal_id, created_at);
CREATE INDEX IF NOT EXISTS sentinel_challenges_open_idx ON sentinel_challenges (goal_id) WHERE status <> 'resolved';

-- Which Sentinel findings a challenge is grounded in. A challenge may cite
-- zero, one, or several findings; this is append-only.
CREATE TABLE IF NOT EXISTS sentinel_challenge_findings (
  challenge_id uuid NOT NULL REFERENCES sentinel_challenges (challenge_id),
  finding_id uuid NOT NULL REFERENCES sentinel_findings (finding_id),
  PRIMARY KEY (challenge_id, finding_id)
);

CREATE OR REPLACE FUNCTION reject_sentinel_challenge_resolved_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'resolved' THEN
    RAISE EXCEPTION 'Sentinel challenge is already resolved and immutable';
  END IF;
  IF NEW.goal_id IS DISTINCT FROM OLD.goal_id OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.evidence_references IS DISTINCT FROM OLD.evidence_references OR NEW.raised_by IS DISTINCT FROM OLD.raised_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Sentinel challenge identity facts are immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sentinel_challenges_immutable ON sentinel_challenges;
CREATE TRIGGER sentinel_challenges_immutable
  BEFORE UPDATE ON sentinel_challenges
  FOR EACH ROW EXECUTE FUNCTION reject_sentinel_challenge_resolved_mutation();
DROP TRIGGER IF EXISTS sentinel_challenges_no_delete ON sentinel_challenges;
CREATE OR REPLACE FUNCTION reject_sentinel_challenge_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sentinel challenges are never deleted';
END;
$$;
CREATE TRIGGER sentinel_challenges_no_delete
  BEFORE DELETE ON sentinel_challenges
  FOR EACH ROW EXECUTE FUNCTION reject_sentinel_challenge_delete();
