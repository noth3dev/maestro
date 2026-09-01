-- Phase 2 work-sequence step 6: Department Plans.
--
-- A Department Plan is owned by exactly one captured Council participant
-- (Department) and derives its entire identity/binding from the resolved,
-- executable Council decision -- never from caller input. This migration
-- is additive only; it does not introduce workers, mission bundles, Git
-- integration, or budget reservation state.

CREATE TABLE IF NOT EXISTS department_plans (
  council_id uuid NOT NULL REFERENCES head_councils(council_id),
  department_id text NOT NULL REFERENCES departments(department_id),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  head_role_id text NOT NULL CHECK (btrim(head_role_id) <> ''),
  council_snapshot_hash text NOT NULL CHECK (council_snapshot_hash ~ '^[0-9a-f]{64}$'),
  decision_packet_hash text NOT NULL CHECK (decision_packet_hash ~ '^[0-9a-f]{64}$'),
  contract_id uuid NOT NULL REFERENCES task_contracts(contract_id),
  contract_version bigint NOT NULL CHECK (contract_version > 0),
  contract_content_hash char(64) NOT NULL CHECK (contract_content_hash ~ '^[0-9a-f]{64}$'),
  current_version integer NOT NULL CHECK (current_version > 0),
  substance jsonb NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  PRIMARY KEY (council_id, department_id),
  -- The owning Department must be an actual captured Council participant.
  FOREIGN KEY (council_id, department_id) REFERENCES council_participants (council_id, department_id)
);
CREATE INDEX IF NOT EXISTS department_plans_goal_idx ON department_plans (goal_id, department_id);

-- The Council/Contract binding that identifies the frozen decision this plan
-- derives from is immutable once set; only the current version/substance may
-- change (via reviseDepartmentPlan, which also updates updated_at).
CREATE OR REPLACE FUNCTION reject_department_plan_binding_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.goal_id IS DISTINCT FROM OLD.goal_id
     OR NEW.head_role_id IS DISTINCT FROM OLD.head_role_id
     OR NEW.council_snapshot_hash IS DISTINCT FROM OLD.council_snapshot_hash
     OR NEW.decision_packet_hash IS DISTINCT FROM OLD.decision_packet_hash
     OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
     OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
     OR NEW.contract_content_hash IS DISTINCT FROM OLD.contract_content_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Department Plan Council/Contract binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS department_plans_binding_immutable ON department_plans;
CREATE TRIGGER department_plans_binding_immutable
  BEFORE UPDATE ON department_plans
  FOR EACH ROW EXECUTE FUNCTION reject_department_plan_binding_mutation();

CREATE TABLE IF NOT EXISTS department_plan_revisions (
  revision_id uuid PRIMARY KEY,
  council_id uuid NOT NULL,
  department_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  substance jsonb NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  affected_item_ids jsonb NOT NULL CHECK (jsonb_typeof(affected_item_ids) = 'array'),
  actor_id text NOT NULL CHECK (actor_id <> ''),
  session_ref text NOT NULL CHECK (session_ref <> ''),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (council_id, department_id, version),
  FOREIGN KEY (council_id, department_id) REFERENCES department_plans (council_id, department_id)
);
CREATE INDEX IF NOT EXISTS department_plan_revisions_plan_idx ON department_plan_revisions (council_id, department_id, version);

CREATE OR REPLACE FUNCTION reject_department_plan_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Department Plan revision history is append-only';
END;
$$;
DROP TRIGGER IF EXISTS department_plan_revisions_append_only ON department_plan_revisions;
CREATE TRIGGER department_plan_revisions_append_only
  BEFORE UPDATE OR DELETE ON department_plan_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_department_plan_revision_mutation();
