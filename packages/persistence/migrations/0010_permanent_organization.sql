CREATE TABLE IF NOT EXISTS organization_groups (
  group_id text PRIMARY KEY CHECK (group_id IN ('product', 'tech', 'intelligence', 'assurance', 'operations')),
  display_name text NOT NULL CHECK (display_name <> '')
);

CREATE TABLE IF NOT EXISTS departments (
  department_id text PRIMARY KEY CHECK (department_id IN ('product', 'design', 'engineering', 'security', 'infrastructure', 'research', 'data-analysis', 'quality', 'safety-compliance', 'operations')),
  group_id text NOT NULL REFERENCES organization_groups(group_id),
  display_name text NOT NULL CHECK (display_name <> ''),
  status text NOT NULL CHECK (status = 'sleeping'),
  CHECK ((department_id IN ('product', 'design') AND group_id = 'product')
    OR (department_id IN ('engineering', 'security', 'infrastructure') AND group_id = 'tech')
    OR (department_id IN ('research', 'data-analysis') AND group_id = 'intelligence')
    OR (department_id IN ('quality', 'safety-compliance') AND group_id = 'assurance')
    OR (department_id = 'operations' AND group_id = 'operations'))
);
CREATE INDEX IF NOT EXISTS departments_group_id_idx ON departments (group_id, department_id);

CREATE TABLE IF NOT EXISTS permanent_roles (
  role_id text PRIMARY KEY CHECK (role_id <> ''),
  display_name text NOT NULL CHECK (display_name <> ''),
  status text NOT NULL CHECK (status = 'standing'),
  department_id text REFERENCES departments(department_id),
  CHECK (department_id IS NULL)
);

CREATE TABLE IF NOT EXISTS role_persona_axes (
  role_id text NOT NULL REFERENCES permanent_roles(role_id) ON DELETE CASCADE,
  axis text NOT NULL CHECK (axis IN (
    'agreeableness', 'extraversion', 'imagination', 'realism', 'conscientiousness',
    'caution', 'initiative', 'empathy', 'adaptability', 'sociability'
  )),
  value numeric(3,2) NOT NULL CHECK (value >= 0 AND value <= 1),
  PRIMARY KEY (role_id, axis)
);

CREATE OR REPLACE FUNCTION reject_permanent_taxonomy_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'permanent organization taxonomy is immutable';
END;
$$;

DROP TRIGGER IF EXISTS organization_groups_immutable ON organization_groups;
CREATE TRIGGER organization_groups_immutable
BEFORE UPDATE OR DELETE ON organization_groups
FOR EACH ROW EXECUTE FUNCTION reject_permanent_taxonomy_mutation();

DROP TRIGGER IF EXISTS departments_immutable ON departments;
CREATE TRIGGER departments_immutable
BEFORE UPDATE OR DELETE ON departments
FOR EACH ROW EXECUTE FUNCTION reject_permanent_taxonomy_mutation();

CREATE OR REPLACE FUNCTION assert_complete_role_persona()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  checked_role_id text := COALESCE(NEW.role_id, OLD.role_id);
BEGIN
  IF (SELECT count(*) FROM role_persona_axes WHERE role_id = checked_role_id) <> 10 THEN
    RAISE EXCEPTION 'permanent role persona must contain exactly ten axes';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS permanent_roles_complete_persona ON permanent_roles;
CREATE CONSTRAINT TRIGGER permanent_roles_complete_persona
AFTER INSERT OR UPDATE ON permanent_roles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_complete_role_persona();

DROP TRIGGER IF EXISTS role_persona_axes_complete_persona ON role_persona_axes;
CREATE CONSTRAINT TRIGGER role_persona_axes_complete_persona
AFTER INSERT OR UPDATE OR DELETE ON role_persona_axes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_complete_role_persona();
