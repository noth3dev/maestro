-- Phase 3 work-sequence step 8: evidence-bundle assembly and integrity
-- verification. A bundle is an immutable snapshot; a re-assembly is a new
-- row, never an edit. Additive only.

CREATE TABLE IF NOT EXISTS evidence_bundles (
  bundle_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goals (goal_id),
  content jsonb NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  assembled_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime'
);
CREATE INDEX IF NOT EXISTS evidence_bundles_goal_idx ON evidence_bundles (goal_id, assembled_at);

CREATE OR REPLACE FUNCTION reject_evidence_bundle_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Evidence bundles are immutable once assembled';
END;
$$;
DROP TRIGGER IF EXISTS evidence_bundles_immutable ON evidence_bundles;
CREATE TRIGGER evidence_bundles_immutable
  BEFORE UPDATE OR DELETE ON evidence_bundles
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_bundle_mutation();
