-- Phase 2 work-sequence step 9: worker request-for-help / bounded
-- team-lead exception. Additive only.

CREATE TABLE IF NOT EXISTS team_lead_grants (
  grant_id uuid PRIMARY KEY,
  worker_id uuid NOT NULL REFERENCES workers (worker_id),
  council_id uuid NOT NULL,
  department_id text NOT NULL,
  plan_version integer NOT NULL,
  item_id text NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  max_helpers integer NOT NULL CHECK (max_helpers > 0),
  cost_ceiling text NOT NULL CHECK (btrim(cost_ceiling) <> ''),
  duration_ceiling text NOT NULL CHECK (btrim(duration_ceiling) <> ''),
  task_scope text NOT NULL CHECK (btrim(task_scope) <> ''),
  reporting_requirement text NOT NULL CHECK (btrim(reporting_requirement) <> ''),
  granted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  revoked_at timestamptz,
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  -- One active grant per worker at a time.
  UNIQUE (worker_id)
);
CREATE INDEX IF NOT EXISTS team_lead_grants_mission_idx ON team_lead_grants (council_id, department_id, plan_version, item_id);

-- A grant is immutable except for its single allowed transition: revocation.
CREATE OR REPLACE FUNCTION reject_team_lead_grant_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Team-lead grant is already revoked and immutable';
  END IF;
  IF NEW.worker_id IS DISTINCT FROM OLD.worker_id
     OR NEW.council_id IS DISTINCT FROM OLD.council_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.plan_version IS DISTINCT FROM OLD.plan_version
     OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.max_helpers IS DISTINCT FROM OLD.max_helpers
     OR NEW.cost_ceiling IS DISTINCT FROM OLD.cost_ceiling
     OR NEW.duration_ceiling IS DISTINCT FROM OLD.duration_ceiling
     OR NEW.task_scope IS DISTINCT FROM OLD.task_scope
     OR NEW.reporting_requirement IS DISTINCT FROM OLD.reporting_requirement
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at THEN
    RAISE EXCEPTION 'Team-lead grant terms are immutable; only revocation is allowed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS team_lead_grants_immutable ON team_lead_grants;
CREATE TRIGGER team_lead_grants_immutable
  BEFORE UPDATE ON team_lead_grants
  FOR EACH ROW EXECUTE FUNCTION reject_team_lead_grant_mutation();
DROP TRIGGER IF EXISTS team_lead_grants_no_delete ON team_lead_grants;
CREATE OR REPLACE FUNCTION reject_team_lead_grant_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Team-lead grants are never deleted, only revoked';
END;
$$;
CREATE TRIGGER team_lead_grants_no_delete
  BEFORE DELETE ON team_lead_grants
  FOR EACH ROW EXECUTE FUNCTION reject_team_lead_grant_delete();

-- Helper workers spawned under a grant still belong to the same Department
-- Plan mission and remain visible to the Head and Sentinel. A helper cannot
-- itself receive a grant (unbounded recursive spawning is forbidden), so
-- `parent_worker_id` is only ever one level deep by application discipline
-- (enforced in application code: grantTeamLead rejects a worker that is
-- itself a helper).
ALTER TABLE workers ADD COLUMN IF NOT EXISTS parent_worker_id uuid REFERENCES workers (worker_id);
ALTER TABLE workers ADD COLUMN IF NOT EXISTS grant_id uuid REFERENCES team_lead_grants (grant_id);
CREATE INDEX IF NOT EXISTS workers_parent_idx ON workers (parent_worker_id);
CREATE INDEX IF NOT EXISTS workers_grant_idx ON workers (grant_id);

-- The original per-mission attempt uniqueness (0024) must scope only the
-- main mission attempt sequence, not helper workers spawned under a grant
-- (which have their own independent per-grant sequence). Replace the plain
-- table constraint with two partial unique indexes.
ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_council_id_department_id_plan_version_item_id_attempt_key;
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'workers'::regclass AND contype = 'u'
       AND pg_get_constraintdef(oid) LIKE '%council_id, department_id, plan_version, item_id, attempt%'
  LOOP
    EXECUTE format('ALTER TABLE workers DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS workers_mission_attempt_idx
  ON workers (council_id, department_id, plan_version, item_id, attempt)
  WHERE grant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS workers_grant_helper_attempt_idx
  ON workers (grant_id, attempt)
  WHERE grant_id IS NOT NULL;
