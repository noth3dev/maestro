-- Phase 3 work-sequence step 7: certification conflict adjudication and
-- bounded waivers. Additive only.

CREATE TABLE IF NOT EXISTS certification_waivers (
  waiver_id uuid PRIMARY KEY,
  certification_table text NOT NULL CHECK (certification_table IN ('quality_certifications', 'conditional_certifications')),
  certification_id uuid NOT NULL,
  finding_id text NOT NULL CHECK (btrim(finding_id) <> ''),
  authority text NOT NULL CHECK (btrim(authority) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  consequence text NOT NULL CHECK (btrim(consequence) <> ''),
  follow_up text NOT NULL CHECK (btrim(follow_up) <> ''),
  granted_by text NOT NULL CHECK (granted_by <> ''),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  CHECK (expires_at > created_at),
  UNIQUE (certification_table, certification_id, finding_id)
);
CREATE INDEX IF NOT EXISTS certification_waivers_lookup_idx ON certification_waivers (certification_table, certification_id);

CREATE OR REPLACE FUNCTION reject_certification_waiver_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Certification waivers are immutable once granted';
END;
$$;
DROP TRIGGER IF EXISTS certification_waivers_immutable ON certification_waivers;
CREATE TRIGGER certification_waivers_immutable
  BEFORE UPDATE OR DELETE ON certification_waivers
  FOR EACH ROW EXECUTE FUNCTION reject_certification_waiver_mutation();

-- Links a certification conflict to the Overwatch Council round that
-- adjudicated it, so the ruling is traceable and durable.
CREATE TABLE IF NOT EXISTS certification_conflict_resolutions (
  resolution_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goals (goal_id),
  round_id uuid NOT NULL REFERENCES overwatch_council_rounds (round_id),
  conflicting_verdicts jsonb NOT NULL CHECK (jsonb_typeof(conflicting_verdicts) = 'array'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime'
);
CREATE INDEX IF NOT EXISTS certification_conflict_resolutions_goal_idx ON certification_conflict_resolutions (goal_id, created_at);
DROP TRIGGER IF EXISTS certification_conflict_resolutions_immutable ON certification_conflict_resolutions;
CREATE TRIGGER certification_conflict_resolutions_immutable
  BEFORE UPDATE OR DELETE ON certification_conflict_resolutions
  FOR EACH ROW EXECUTE FUNCTION reject_certification_waiver_mutation();
