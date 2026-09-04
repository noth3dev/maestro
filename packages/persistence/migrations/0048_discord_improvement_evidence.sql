-- Phase 4 work-sequence step 9: durable, append-only improvement evidence
-- for every closed Discord incident. This table is read-only evidence for a
-- later Encore Improvement Digest; nothing in this migration or its
-- writer triggers any automatic change.

-- 0047 recorded the link in updated_at, which a later closure also
-- overwrites; a dedicated, immutable-once-set column is required to
-- correctly compute detection-to-triage duration at closure time.
ALTER TABLE discord_incidents ADD COLUMN IF NOT EXISTS linked_at timestamptz;

CREATE OR REPLACE FUNCTION reject_discord_incident_linked_at_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.linked_at IS NOT NULL AND NEW.linked_at IS DISTINCT FROM OLD.linked_at THEN
    RAISE EXCEPTION 'A Discord incident''s linked_at is immutable once set';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS discord_incidents_linked_at_immutable ON discord_incidents;
CREATE TRIGGER discord_incidents_linked_at_immutable BEFORE UPDATE ON discord_incidents
  FOR EACH ROW EXECUTE FUNCTION reject_discord_incident_linked_at_mutation();

CREATE TABLE IF NOT EXISTS discord_improvement_evidence (
  evidence_id uuid PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES discord_incidents(incident_id),
  outcome text NOT NULL CHECK (outcome IN ('resolved', 'false_positive')),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  detection_to_triage_ms bigint CHECK (detection_to_triage_ms IS NULL OR detection_to_triage_ms >= 0),
  triage_to_close_ms bigint CHECK (triage_to_close_ms IS NULL OR triage_to_close_ms >= 0),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (incident_id)
);
CREATE INDEX IF NOT EXISTS discord_improvement_evidence_outcome_idx ON discord_improvement_evidence (outcome, recorded_at);

CREATE OR REPLACE FUNCTION reject_discord_improvement_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Discord improvement evidence is append-only';
END;
$$;
DROP TRIGGER IF EXISTS discord_improvement_evidence_immutable ON discord_improvement_evidence;
CREATE TRIGGER discord_improvement_evidence_immutable
  BEFORE UPDATE OR DELETE ON discord_improvement_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_discord_improvement_evidence_mutation();
