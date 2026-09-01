-- Phase 3 work-sequence step 5: Department acceptance and independent
-- Quality certification. Additive only.

CREATE TABLE IF NOT EXISTS department_acceptances (
  acceptance_id uuid PRIMARY KEY,
  worker_id uuid NOT NULL,
  commit_sha char(40) NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  accepted_by text NOT NULL CHECK (accepted_by <> ''),
  session_ref text NOT NULL CHECK (session_ref <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (worker_id),
  -- The accepted commit must be a real, previously recorded integration commit for this worker.
  FOREIGN KEY (worker_id, commit_sha) REFERENCES integration_commits (worker_id, commit_sha)
);

CREATE OR REPLACE FUNCTION reject_certification_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Certification records are immutable once produced';
END;
$$;
DROP TRIGGER IF EXISTS department_acceptances_immutable ON department_acceptances;
CREATE TRIGGER department_acceptances_immutable
  BEFORE UPDATE OR DELETE ON department_acceptances
  FOR EACH ROW EXECUTE FUNCTION reject_certification_mutation();

CREATE TABLE IF NOT EXISTS quality_certifications (
  certification_id uuid PRIMARY KEY,
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
CREATE INDEX IF NOT EXISTS quality_certifications_goal_idx ON quality_certifications (goal_id, created_at);
DROP TRIGGER IF EXISTS quality_certifications_immutable ON quality_certifications;
CREATE TRIGGER quality_certifications_immutable
  BEFORE UPDATE OR DELETE ON quality_certifications
  FOR EACH ROW EXECUTE FUNCTION reject_certification_mutation();
