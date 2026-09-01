-- Phase 3 work-sequence step 6: conditional Security and Safety &
-- Compliance certification. Structurally identical guarantees to Quality
-- certification (0032): the producing Department can never certify itself,
-- the certifying Department must be a captured active Council Head, and
-- the exact Contract/commit identity is bound. Additive only.

CREATE TABLE IF NOT EXISTS conditional_certifications (
  certification_id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('security', 'safety_compliance')),
  goal_id uuid NOT NULL REFERENCES goals (goal_id),
  contract_id uuid NOT NULL REFERENCES task_contracts (contract_id),
  contract_version bigint NOT NULL CHECK (contract_version > 0),
  contract_content_hash char(64) NOT NULL CHECK (contract_content_hash ~ '^[0-9a-f]{64}$'),
  integrated_commit_sha char(40) NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('passed', 'failed', 'blocked')),
  findings jsonb NOT NULL CHECK (jsonb_typeof(findings) = 'array'),
  test_evidence_ids jsonb NOT NULL CHECK (jsonb_typeof(test_evidence_ids) = 'array'),
  certified_by_department text NOT NULL CHECK (certified_by_department <> ''),
  producing_department text NOT NULL CHECK (producing_department <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  CHECK (certified_by_department <> producing_department)
);
CREATE INDEX IF NOT EXISTS conditional_certifications_goal_idx ON conditional_certifications (goal_id, kind, created_at);

CREATE OR REPLACE FUNCTION reject_conditional_certification_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Certification records are immutable once produced';
END;
$$;
DROP TRIGGER IF EXISTS conditional_certifications_immutable ON conditional_certifications;
CREATE TRIGGER conditional_certifications_immutable
  BEFORE UPDATE OR DELETE ON conditional_certifications
  FOR EACH ROW EXECUTE FUNCTION reject_conditional_certification_mutation();
