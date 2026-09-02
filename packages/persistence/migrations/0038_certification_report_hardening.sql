-- Phase 3 certification/report hardening.
--
-- A Goal integration revision is an immutable, Git-derived snapshot.  A
-- certification is valid only when it points at this exact snapshot and at
-- the durable worker acceptance that is included in it.

CREATE TABLE IF NOT EXISTS goal_integration_revisions (
  revision_id uuid PRIMARY KEY,
  revision_number bigint GENERATED ALWAYS AS IDENTITY NOT NULL UNIQUE,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  repository_path text NOT NULL CHECK (btrim(repository_path) <> ''),
  branch_name text NOT NULL CHECK (btrim(branch_name) <> ''),
  commit_sha char(40) NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  base_revision char(40) NOT NULL CHECK (base_revision ~ '^[0-9a-f]{40}$'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  UNIQUE (goal_id, revision_id),
  UNIQUE (goal_id, commit_sha)
);
CREATE INDEX IF NOT EXISTS goal_integration_revisions_current_idx
  ON goal_integration_revisions (goal_id, revision_number DESC);

CREATE TABLE IF NOT EXISTS goal_integration_revision_commits (
  revision_id uuid NOT NULL REFERENCES goal_integration_revisions(revision_id),
  worker_id uuid NOT NULL,
  commit_sha char(40) NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  PRIMARY KEY (revision_id, worker_id, commit_sha),
  FOREIGN KEY (worker_id, commit_sha) REFERENCES integration_commits(worker_id, commit_sha)
);
ALTER TABLE goal_integration_revision_commits ADD COLUMN IF NOT EXISTS member_id uuid;
CREATE INDEX IF NOT EXISTS goal_integration_revision_commits_worker_idx
  ON goal_integration_revision_commits (worker_id, commit_sha);

CREATE OR REPLACE FUNCTION assert_goal_integration_revision_commit_goal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM goal_integration_revisions revision
      JOIN workers worker ON worker.worker_id = NEW.worker_id
      JOIN department_plans plan
        ON plan.council_id = worker.council_id
       AND plan.department_id = worker.department_id
       AND plan.goal_id = revision.goal_id
     WHERE revision.revision_id = NEW.revision_id
  ) THEN
    RAISE EXCEPTION 'Goal integration revision commit is not bound to the revision Goal';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS goal_integration_revision_commits_goal_binding ON goal_integration_revision_commits;
CREATE TRIGGER goal_integration_revision_commits_goal_binding
  BEFORE INSERT ON goal_integration_revision_commits
  FOR EACH ROW EXECUTE FUNCTION assert_goal_integration_revision_commit_goal();

CREATE OR REPLACE FUNCTION reject_goal_integration_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Goal integration revisions are immutable once frozen';
END;
$$;
DROP TRIGGER IF EXISTS goal_integration_revisions_immutable ON goal_integration_revisions;
CREATE TRIGGER goal_integration_revisions_immutable
  BEFORE UPDATE OR DELETE ON goal_integration_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_goal_integration_revision_mutation();
DROP TRIGGER IF EXISTS goal_integration_revision_commits_immutable ON goal_integration_revision_commits;
CREATE TRIGGER goal_integration_revision_commits_immutable
  BEFORE UPDATE OR DELETE ON goal_integration_revision_commits
  FOR EACH ROW EXECUTE FUNCTION reject_goal_integration_revision_mutation();

-- Certification rows written before this hardening migration remain readable
-- as historical rows, but new rows must carry complete replay lineage.
ALTER TABLE quality_certifications
  ADD COLUMN IF NOT EXISTS worker_id uuid,
  ADD COLUMN IF NOT EXISTS department_acceptance_id uuid,
  ADD COLUMN IF NOT EXISTS integration_revision_id uuid;
ALTER TABLE conditional_certifications
  ADD COLUMN IF NOT EXISTS worker_id uuid,
  ADD COLUMN IF NOT EXISTS department_acceptance_id uuid,
  ADD COLUMN IF NOT EXISTS integration_revision_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'quality_certifications'::regclass AND conname = 'quality_certifications_worker_fk'
  ) THEN
    ALTER TABLE quality_certifications ADD CONSTRAINT quality_certifications_worker_fk
      FOREIGN KEY (worker_id) REFERENCES workers(worker_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'quality_certifications'::regclass AND conname = 'quality_certifications_acceptance_fk'
  ) THEN
    ALTER TABLE quality_certifications ADD CONSTRAINT quality_certifications_acceptance_fk
      FOREIGN KEY (department_acceptance_id) REFERENCES department_acceptances(acceptance_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'quality_certifications'::regclass AND conname = 'quality_certifications_revision_goal_fk'
  ) THEN
    ALTER TABLE quality_certifications ADD CONSTRAINT quality_certifications_revision_goal_fk
      FOREIGN KEY (goal_id, integration_revision_id) REFERENCES goal_integration_revisions(goal_id, revision_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'conditional_certifications'::regclass AND conname = 'conditional_certifications_worker_fk'
  ) THEN
    ALTER TABLE conditional_certifications ADD CONSTRAINT conditional_certifications_worker_fk
      FOREIGN KEY (worker_id) REFERENCES workers(worker_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'conditional_certifications'::regclass AND conname = 'conditional_certifications_acceptance_fk'
  ) THEN
    ALTER TABLE conditional_certifications ADD CONSTRAINT conditional_certifications_acceptance_fk
      FOREIGN KEY (department_acceptance_id) REFERENCES department_acceptances(acceptance_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'conditional_certifications'::regclass AND conname = 'conditional_certifications_revision_goal_fk'
  ) THEN
    ALTER TABLE conditional_certifications ADD CONSTRAINT conditional_certifications_revision_goal_fk
      FOREIGN KEY (goal_id, integration_revision_id) REFERENCES goal_integration_revisions(goal_id, revision_id);
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS quality_certifications_revision_idx
  ON quality_certifications (goal_id, integration_revision_id, created_at);
CREATE INDEX IF NOT EXISTS conditional_certifications_revision_idx
  ON conditional_certifications (goal_id, integration_revision_id, kind, created_at);

CREATE OR REPLACE FUNCTION assert_certification_lineage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  worker_row workers%ROWTYPE;
  plan_goal uuid;
  council_contract uuid;
  contract_row task_contracts%ROWTYPE;
  acceptance_row department_acceptances%ROWTYPE;
  revision_row goal_integration_revisions%ROWTYPE;
BEGIN
  IF NEW.worker_id IS NULL OR NEW.department_acceptance_id IS NULL OR NEW.integration_revision_id IS NULL THEN
    RAISE EXCEPTION 'Certification must bind a worker, Department acceptance, and Goal integration revision';
  END IF;
  SELECT * INTO worker_row FROM workers WHERE worker_id = NEW.worker_id;
  IF NOT FOUND OR worker_row.status <> 'succeeded' THEN
    RAISE EXCEPTION 'Certification worker must have durably succeeded';
  END IF;
  SELECT plan.goal_id INTO plan_goal
    FROM department_plans plan
   WHERE plan.council_id = worker_row.council_id
     AND plan.department_id = worker_row.department_id;
  IF plan_goal IS NULL OR plan_goal <> NEW.goal_id THEN
    RAISE EXCEPTION 'Certification worker is not bound to the certification Goal';
  END IF;
  SELECT * INTO acceptance_row FROM department_acceptances WHERE acceptance_id = NEW.department_acceptance_id;
  IF NOT FOUND OR acceptance_row.worker_id <> NEW.worker_id THEN
    RAISE EXCEPTION 'Certification must bind the worker Department acceptance';
  END IF;
  SELECT * INTO revision_row FROM goal_integration_revisions WHERE revision_id = NEW.integration_revision_id AND goal_id = NEW.goal_id;
  IF NOT FOUND OR revision_row.commit_sha <> NEW.integrated_commit_sha THEN
    RAISE EXCEPTION 'Certification must bind the exact Goal integration revision';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM goal_integration_revision_commits member
     WHERE member.revision_id = NEW.integration_revision_id
       AND member.worker_id = NEW.worker_id
       AND member.commit_sha = acceptance_row.commit_sha
  ) THEN
    RAISE EXCEPTION 'Certification worker acceptance is not included in the Goal integration revision';
  END IF;
  SELECT council.contract_id INTO council_contract FROM head_councils council WHERE council.council_id = worker_row.council_id;
  SELECT * INTO contract_row FROM task_contracts WHERE contract_id = NEW.contract_id;
  IF council_contract IS NULL OR council_contract <> NEW.contract_id
     OR NOT FOUND OR contract_row.version <> NEW.contract_version
     OR contract_row.content_hash <> NEW.contract_content_hash THEN
    RAISE EXCEPTION 'Certification must bind the exact current Task Contract';
  END IF;
  -- Only fields shared by both certification tables are referenced here.
  -- Table-specific fields belong in table-specific trigger functions: quality
  -- rows do not have `kind`, so even a conditional branch must not touch NEW.kind.
  IF TG_TABLE_NAME = 'quality_certifications' AND NEW.certified_by_department <> 'quality' THEN
    RAISE EXCEPTION 'Quality certification requires the Quality Department authority';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION assert_conditional_certification_authority()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.kind = 'security' AND NEW.certified_by_department <> 'security')
     OR (NEW.kind = 'safety_compliance' AND NEW.certified_by_department <> 'safety-compliance') THEN
    RAISE EXCEPTION 'Conditional certification requires its designated authority Department';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quality_certifications_lineage ON quality_certifications;
CREATE TRIGGER quality_certifications_lineage
  BEFORE INSERT ON quality_certifications
  FOR EACH ROW EXECUTE FUNCTION assert_certification_lineage();
DROP TRIGGER IF EXISTS conditional_certifications_lineage ON conditional_certifications;
CREATE TRIGGER conditional_certifications_lineage
  BEFORE INSERT ON conditional_certifications
  FOR EACH ROW EXECUTE FUNCTION assert_certification_lineage();
DROP TRIGGER IF EXISTS conditional_certifications_authority ON conditional_certifications;
CREATE TRIGGER conditional_certifications_authority
  BEFORE INSERT ON conditional_certifications
  FOR EACH ROW EXECUTE FUNCTION assert_conditional_certification_authority();

-- Conflict resolutions must name the actual immutable certification rows.  A
-- resolution that merely repeats verdict text is not sufficient evidence.
ALTER TABLE certification_conflict_resolutions
  ADD COLUMN IF NOT EXISTS resolution_verdict text,
  ADD COLUMN IF NOT EXISTS contract_id uuid,
  ADD COLUMN IF NOT EXISTS contract_version bigint,
  ADD COLUMN IF NOT EXISTS contract_content_hash char(64),
  ADD COLUMN IF NOT EXISTS integration_revision_id uuid,
  ADD COLUMN IF NOT EXISTS integrated_commit_sha char(40);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'certification_conflict_resolutions'::regclass AND conname = 'certification_conflict_resolution_verdict_check'
  ) THEN
    ALTER TABLE certification_conflict_resolutions ADD CONSTRAINT certification_conflict_resolution_verdict_check
      CHECK (resolution_verdict IS NULL OR resolution_verdict IN ('proceed', 'do_not_proceed', 'escalate'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'certification_conflict_resolutions'::regclass AND conname = 'certification_conflict_resolution_revision_fk'
  ) THEN
    ALTER TABLE certification_conflict_resolutions ADD CONSTRAINT certification_conflict_resolution_revision_fk
      FOREIGN KEY (goal_id, integration_revision_id) REFERENCES goal_integration_revisions(goal_id, revision_id);
  END IF;
END;
$$;
CREATE TABLE IF NOT EXISTS certification_conflict_resolution_members (
  member_id uuid PRIMARY KEY,
  resolution_id uuid NOT NULL REFERENCES certification_conflict_resolutions(resolution_id),
  quality_certification_id uuid REFERENCES quality_certifications(certification_id),
  conditional_certification_id uuid REFERENCES conditional_certifications(certification_id),
  UNIQUE (resolution_id, quality_certification_id, conditional_certification_id),
  CHECK ((quality_certification_id IS NULL)::integer + (conditional_certification_id IS NULL)::integer = 1)
);
CREATE OR REPLACE FUNCTION assert_conflict_member_goal()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resolution_goal uuid;
DECLARE certification_goal uuid;
BEGIN
  SELECT goal_id INTO resolution_goal FROM certification_conflict_resolutions WHERE resolution_id = NEW.resolution_id;
  IF NEW.quality_certification_id IS NOT NULL THEN
    SELECT goal_id INTO certification_goal FROM quality_certifications WHERE certification_id = NEW.quality_certification_id;
  ELSE
    SELECT goal_id INTO certification_goal FROM conditional_certifications WHERE certification_id = NEW.conditional_certification_id;
  END IF;
  IF resolution_goal IS NULL OR certification_goal IS NULL OR resolution_goal <> certification_goal THEN
    RAISE EXCEPTION 'Certification conflict member is not bound to the resolution Goal';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS certification_conflict_member_goal_binding ON certification_conflict_resolution_members;
CREATE TRIGGER certification_conflict_member_goal_binding
  BEFORE INSERT ON certification_conflict_resolution_members
  FOR EACH ROW EXECUTE FUNCTION assert_conflict_member_goal();

-- Database-level defense in depth for the critical-finding waiver rule.
CREATE OR REPLACE FUNCTION reject_critical_certification_waiver()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE finding_severity text;
BEGIN
  IF NEW.certification_table = 'quality_certifications' THEN
    SELECT finding->>'severity' INTO finding_severity
      FROM quality_certifications cert, jsonb_array_elements(cert.findings) finding
     WHERE cert.certification_id = NEW.certification_id AND finding->>'findingId' = NEW.finding_id;
  ELSE
    SELECT finding->>'severity' INTO finding_severity
      FROM conditional_certifications cert, jsonb_array_elements(cert.findings) finding
     WHERE cert.certification_id = NEW.certification_id AND finding->>'findingId' = NEW.finding_id;
  END IF;
  IF finding_severity = 'critical' THEN
    RAISE EXCEPTION 'A critical certification finding cannot be waived';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS certification_waivers_no_critical ON certification_waivers;
CREATE TRIGGER certification_waivers_no_critical
  BEFORE INSERT ON certification_waivers
  FOR EACH ROW EXECUTE FUNCTION reject_critical_certification_waiver();
