-- Runtime identity and binding hardening for Goal-scoped Department Heads.
-- This migration is intentionally additive: 0012 remains the initial schema and
-- existing participation rows are assigned their canonical permanent Head role.

CREATE TABLE IF NOT EXISTS permanent_head_roles (
  head_role_id text PRIMARY KEY CHECK (head_role_id <> ''),
  department_id text NOT NULL UNIQUE REFERENCES departments(department_id),
  status text NOT NULL CHECK (status = 'standing')
);

-- Department rows are bootstrapped after migrations. Seed any departments that
-- already exist and register future canonical departments on insertion.
INSERT INTO permanent_head_roles (head_role_id, department_id, status)
SELECT seed.head_role_id, seed.department_id, 'standing'
FROM (VALUES
  ('head:product', 'product'),
  ('head:design', 'design'),
  ('head:engineering', 'engineering'),
  ('head:security', 'security'),
  ('head:infrastructure', 'infrastructure'),
  ('head:research', 'research'),
  ('head:data-analysis', 'data-analysis'),
  ('head:quality', 'quality'),
  ('head:safety-compliance', 'safety-compliance'),
  ('head:operations', 'operations')
) AS seed(head_role_id, department_id)
JOIN departments ON departments.department_id = seed.department_id
ON CONFLICT (head_role_id) DO NOTHING;

CREATE OR REPLACE FUNCTION register_permanent_head_role()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO permanent_head_roles (head_role_id, department_id, status)
  VALUES ('head:' || NEW.department_id, NEW.department_id, 'standing')
  ON CONFLICT (head_role_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS departments_register_head_role ON departments;
CREATE TRIGGER departments_register_head_role
AFTER INSERT ON departments FOR EACH ROW EXECUTE FUNCTION register_permanent_head_role();

CREATE OR REPLACE FUNCTION reject_permanent_head_role_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'permanent Head role mapping is immutable';
END;
$$;
DROP TRIGGER IF EXISTS permanent_head_roles_immutable ON permanent_head_roles;
CREATE TRIGGER permanent_head_roles_immutable
BEFORE UPDATE OR DELETE ON permanent_head_roles
FOR EACH ROW EXECUTE FUNCTION reject_permanent_head_role_mutation();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'permanent_head_roles_role_department_key'
  ) THEN
    ALTER TABLE permanent_head_roles
      ADD CONSTRAINT permanent_head_roles_role_department_key UNIQUE (head_role_id, department_id);
  END IF;
END;
$$;

ALTER TABLE goal_head_participations
  ADD COLUMN IF NOT EXISTS head_role_id text,
  ADD COLUMN IF NOT EXISTS context_id text;

UPDATE goal_head_participations participation
SET head_role_id = head.head_role_id
FROM permanent_head_roles head
WHERE participation.department_id = head.department_id
  AND participation.head_role_id IS NULL;

ALTER TABLE goal_head_participations
  ALTER COLUMN head_role_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'goal_head_participations_head_role_fk'
  ) THEN
    ALTER TABLE goal_head_participations
      ADD CONSTRAINT goal_head_participations_head_role_fk
      FOREIGN KEY (head_role_id, department_id)
      REFERENCES permanent_head_roles (head_role_id, department_id);
  END IF;
  -- Keep this binding at the write boundary rather than adding a cross-table
  -- FK: a participation may only reference a currently launched contract, and
  -- the trigger below enforces that rule without coupling table lifecycles.
  ALTER TABLE goal_head_participations DROP CONSTRAINT IF EXISTS goal_head_participations_contract_fk;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'goal_head_participations_context_check'
  ) THEN
    ALTER TABLE goal_head_participations
      ADD CONSTRAINT goal_head_participations_context_check
      CHECK (context_id IS NULL OR context_id <> '');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION assert_head_contract_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contract_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM task_contracts
    WHERE contract_id = NEW.contract_id AND launch_state = 'launched'
  ) THEN
    RAISE EXCEPTION 'Head participation must bind an existing launched Task Contract';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS goal_head_participations_contract_binding ON goal_head_participations;
CREATE TRIGGER goal_head_participations_contract_binding
BEFORE INSERT OR UPDATE OF contract_id ON goal_head_participations
FOR EACH ROW EXECUTE FUNCTION assert_head_contract_binding();

-- One permanent Head may reserve separate Goal rows, but only one provider
-- session may be active for that Head at a time. Session refs are also unique
-- while active, so one provider session cannot serve two Goal bindings.
CREATE UNIQUE INDEX IF NOT EXISTS goal_head_participations_head_role_goal_idx
  ON goal_head_participations (head_role_id, goal_id);
CREATE UNIQUE INDEX IF NOT EXISTS goal_head_participations_active_head_idx
  ON goal_head_participations (head_role_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS goal_head_participations_active_session_idx
  ON goal_head_participations (active_session_ref) WHERE status = 'active';

ALTER TABLE head_activation_attempts
  ADD COLUMN IF NOT EXISTS head_role_id text,
  ADD COLUMN IF NOT EXISTS requester_head_role_id text;

UPDATE head_activation_attempts attempt
SET head_role_id = head.head_role_id
FROM permanent_head_roles head
WHERE attempt.department_id = head.department_id
  AND attempt.head_role_id IS NULL;

UPDATE head_activation_attempts attempt
SET requester_head_role_id = head.head_role_id
FROM permanent_head_roles head
WHERE attempt.requester_department_id = head.department_id
  AND attempt.requester_head_role_id IS NULL;

ALTER TABLE head_activation_attempts
  ALTER COLUMN head_role_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'head_activation_attempts_head_role_fk'
  ) THEN
    ALTER TABLE head_activation_attempts
      ADD CONSTRAINT head_activation_attempts_head_role_fk
      FOREIGN KEY (head_role_id) REFERENCES permanent_head_roles (head_role_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'head_activation_attempts_requester_head_role_fk'
  ) THEN
    ALTER TABLE head_activation_attempts
      ADD CONSTRAINT head_activation_attempts_requester_head_role_fk
      FOREIGN KEY (requester_head_role_id) REFERENCES permanent_head_roles (head_role_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'head_activation_attempts_role_binding_check'
  ) THEN
    ALTER TABLE head_activation_attempts
      ADD CONSTRAINT head_activation_attempts_role_binding_check
      CHECK ((requester_role = 'Sane' AND requester_head_role_id IS NULL)
          OR (requester_role = 'Head' AND requester_head_role_id IS NOT NULL));
  END IF;
  -- 0012's original check did not include durable runtime/binding rejections.
  ALTER TABLE head_activation_attempts DROP CONSTRAINT IF EXISTS head_activation_attempts_outcome_check;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'head_activation_attempts_outcome_check'
  ) THEN
    ALTER TABLE head_activation_attempts
      ADD CONSTRAINT head_activation_attempts_outcome_check
      CHECK (outcome IN ('reserved', 'already_active', 'cycle_rejected', 'runtime_conflict', 'binding_conflict'));
  END IF;
END;
$$;


-- Preserve the complete bounded activation brief with every attempt. Defaults
-- keep pre-hardening rows readable while new callers can provide precise data.
ALTER TABLE head_activation_attempts
  ADD COLUMN IF NOT EXISTS requested_contribution text NOT NULL DEFAULT 'unspecified',
  ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS context_scope jsonb NOT NULL DEFAULT '["goal"]'::jsonb,
  ADD COLUMN IF NOT EXISTS budget_effect text NOT NULL DEFAULT 'unspecified';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'head_activation_attempts_brief_check'
  ) THEN
    ALTER TABLE head_activation_attempts
      ADD CONSTRAINT head_activation_attempts_brief_check
      CHECK (requested_contribution <> '' AND urgency <> '' AND budget_effect <> ''
        AND jsonb_typeof(context_scope) = 'array');
  END IF;
END;
$$;
