-- Phase 3 work-sequence step 1: Metronome event consumer and deterministic
-- rule catalog. Findings are durable, deduplicated by (goal, rule, evidence
-- identity, plan version), and resolvable exactly once (one-way, matching
-- the immutable-except-revocation pattern already used for team_lead_grants).
-- Additive only.

CREATE TABLE IF NOT EXISTS metronome_findings (
  finding_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goals (goal_id),
  rule_id text NOT NULL CHECK (rule_id IN ('stale_worker_superseded_plan', 'worker_missing_plan_item', 'missing_evidence_reference')),
  evidence_identity text NOT NULL CHECK (btrim(evidence_identity) <> ''),
  plan_version integer NOT NULL,
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  detected_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  resolved_at timestamptz,
  resolution_reason text,
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  CHECK ((resolved_at IS NULL) = (resolution_reason IS NULL)),
  UNIQUE (goal_id, rule_id, evidence_identity, plan_version)
);
CREATE INDEX IF NOT EXISTS metronome_findings_goal_idx ON metronome_findings (goal_id, detected_at);
CREATE INDEX IF NOT EXISTS metronome_findings_unresolved_idx ON metronome_findings (goal_id) WHERE resolved_at IS NULL;

CREATE OR REPLACE FUNCTION reject_metronome_finding_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Metronome finding is already resolved and immutable';
  END IF;
  IF NEW.goal_id IS DISTINCT FROM OLD.goal_id OR NEW.rule_id IS DISTINCT FROM OLD.rule_id
     OR NEW.evidence_identity IS DISTINCT FROM OLD.evidence_identity OR NEW.plan_version IS DISTINCT FROM OLD.plan_version
     OR NEW.details IS DISTINCT FROM OLD.details OR NEW.detected_at IS DISTINCT FROM OLD.detected_at THEN
    RAISE EXCEPTION 'Metronome finding identity/detection facts are immutable; only resolution is allowed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS metronome_findings_immutable ON metronome_findings;
CREATE TRIGGER metronome_findings_immutable
  BEFORE UPDATE ON metronome_findings
  FOR EACH ROW EXECUTE FUNCTION reject_metronome_finding_mutation();
DROP TRIGGER IF EXISTS metronome_findings_no_delete ON metronome_findings;
CREATE OR REPLACE FUNCTION reject_metronome_finding_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Metronome findings are never deleted, only resolved';
END;
$$;
CREATE TRIGGER metronome_findings_no_delete
  BEFORE DELETE ON metronome_findings
  FOR EACH ROW EXECUTE FUNCTION reject_metronome_finding_delete();
